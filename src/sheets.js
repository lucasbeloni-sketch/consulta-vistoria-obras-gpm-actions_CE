// Parte #2 (compilador): escreve as colunas selecionadas na aba de destino do
// Google Sheets, via service account. NAO toca as linhas de cabecalho (1-2):
// limpa e reescreve SO da linha `linhaInicioDados` (3) pra baixo, nas colunas
// de dados. Se a aba tiver menos colunas que o necessario, cresce a grade.

const { google } = require("googleapis");
const { getAuthClient, withRetry, stampBR } = require("../lib/google");

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

async function getSheets() {
  const auth = await getAuthClient(SCOPES);
  return google.sheets({ version: "v4", auth });
}

// Numero da coluna (1-based) -> letra A1 (1->A, 27->AA).
function colLetra(n) {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}

async function propsAba(sheets, spreadsheetId, aba) {
  const meta = await withRetry(
    () => sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(title,sheetId,gridProperties)" }),
    { label: "get meta" }
  );
  const s = (meta.data.sheets || []).find((x) => x.properties.title === aba);
  if (!s) throw new Error(`aba "${aba}" nao existe na planilha ${spreadsheetId}.`);
  return s.properties;
}

// Grava `matriz` (array de linhas) a partir de A{linhaInicioDados}. Limpa antes
// so o bloco A{inicio}:{ultimaCol} (colunas de dados, da linha inicial pra
// baixo) — cabecalho nas linhas 1-2 fica intacto.
async function gravarDados(matriz, cfg) {
  const sheets = await getSheets();
  const { spreadsheetId, aba, linhaInicioDados } = cfg.sheet;
  const vio = cfg.sheet.valueInputOption || "USER_ENTERED";
  const nCols = matriz.reduce((m, r) => Math.max(m, r.length), 1);
  const ate = colLetra(nCols);

  const props = await propsAba(sheets, spreadsheetId, aba);
  if ((props.gridProperties.columnCount || 0) < nCols) {
    await withRetry(
      () => sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            updateSheetProperties: {
              properties: { sheetId: props.sheetId, gridProperties: { columnCount: nCols } },
              fields: "gridProperties.columnCount",
            },
          }],
        },
      }),
      { label: "crescer colunas" }
    );
  }

  await withRetry(
    () => sheets.spreadsheets.values.clear({ spreadsheetId, range: `${aba}!A${linhaInicioDados}:${ate}` }),
    { label: "clear" }
  );
  const res = await withRetry(
    () => sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${aba}!A${linhaInicioDados}`,
      valueInputOption: vio,
      requestBody: { values: matriz },
    }),
    { label: "update" }
  );

  // Timestamp de "ultima atualizacao" na celula configurada (default B1, ao
  // lado do rotulo em A1). Em BRT (stampBR), formato dd/MM/aaaa HH:mm:ss.
  const cel = cfg.sheet.timestampCell || "B1";
  const stamp = stampBR(cfg.timezone);
  await withRetry(
    () => sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${aba}!${cel}`,
      valueInputOption: vio,
      requestBody: { values: [[stamp]] },
    }),
    { label: "timestamp" }
  );
  console.log(`[sheets] timestamp ${stamp} gravado em ${aba}!${cel}.`);
  return res.data;
}

module.exports = { gravarDados };
