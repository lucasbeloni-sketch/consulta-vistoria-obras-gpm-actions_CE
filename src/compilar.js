// Parte #2: le TODOS os CSVs da pasta Consulta_Vistoria no Drive, seleciona as
// colunas configuradas (N. Vistoria / Ordem de Trabalho / OT Principal /
// Data/Hora) e escreve na aba BD_Vistoria_GPM da planilha, a partir da linha 3
// (cabecalho na linha 2 fica por conta do usuario; nao tocamos linhas 1-2).
// DRY_RUN=1 le e mostra a amostra, mas NAO escreve na planilha.

const cfg = require("../config.json");
const { listarCsvsPasta } = require("./drive");
const { parseCsv } = require("./util");
const { gravarDados } = require("./sheets");

(async () => {
  const dryRun = !!process.env.DRY_RUN;
  const { colunasOrigem, aba, linhaInicioDados } = cfg.sheet;
  console.log(`[compilar] dryRun=${dryRun} | destino=${aba} a partir da linha ${linhaInicioDados} | colunas origem=${JSON.stringify(colunasOrigem)}`);

  const csvs = await listarCsvsPasta(cfg);
  console.log(`[compilar] ${csvs.length} CSV(s) na pasta: ${csvs.map((c) => c.name).join(", ") || "nenhum"}`);
  if (!csvs.length) {
    console.error("[compilar] nenhum CSV na pasta destino — nada a compilar.");
    process.exit(1);
  }

  const linhas = [];
  for (const c of csvs) {
    const rows = parseCsv(c.buffer);
    if (rows.length <= 1) { console.warn(`[compilar] ${c.name}: sem linhas de dados, pulando.`); continue; }
    const dados = rows.slice(1); // pula o cabecalho do CSV
    let add = 0;
    for (const r of dados) {
      if (r.every((v) => (v || "").trim() === "")) continue; // linha totalmente vazia
      linhas.push(colunasOrigem.map((i) => (r[i] !== undefined ? r[i] : "")));
      add++;
    }
    console.log(`[compilar] ${c.name}: +${add} linha(s).`);
  }

  console.log(`[compilar] total ${linhas.length} linha(s) x ${colunasOrigem.length} coluna(s).`);

  // Guard anti-clobber: nao apagar a aba se a origem veio vazia (glitch upstream).
  const min = cfg.sheet.minLinhas ?? 1;
  if (linhas.length < min) {
    console.error(`[compilar] ${linhas.length} linha(s) < minimo ${min}: NAO escrevo (evita apagar a aba por engano).`);
    process.exit(1);
  }

  if (dryRun) {
    console.log("[compilar] DRY_RUN: nao escreve na planilha. Amostra (3 primeiras):");
    console.log(JSON.stringify(linhas.slice(0, 3), null, 2));
    return;
  }

  const r = await gravarDados(linhas, cfg);
  console.log(`[compilar] OK: ${r.updatedRows ?? linhas.length} linha(s) x ${r.updatedColumns ?? colunasOrigem.length} coluna(s) em ${r.updatedRange || aba}.`);
})().catch((e) => { console.error("[compilar] ERRO:", e.message); process.exit(1); });
