// Funcoes puras (sem browser/rede) — testaveis isoladamente.
// A Vistoria nao usa filtro de data (traz todas as vistorias do contrato) —
// por isso, ao contrario das irmas, aqui NAO ha funcoes de mes/ano.

// Conta linhas de DADOS de um CSV (buffer com/sem BOM). Cabecalho nao conta.
function contarLinhasDados(buffer) {
  let txt = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer);
  if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1); // tira BOM
  const linhas = txt.split(/\r?\n/).filter((l) => l.trim() !== "");
  return Math.max(0, linhas.length - 1);
}

// Parser de CSV do GPM (delimitador ";", aspas duplas, escape "" para aspas
// literal, quebras LF ou CRLF, campos podendo conter ";" e quebras de linha
// dentro de aspas). Tira BOM. Retorna array de linhas (array de strings).
// Necessario porque split(";") quebraria em campos com ";" citado (ex.: enderecos).
function parseCsv(buffer, delim = ";") {
  let s = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // tira BOM
  const rows = [];
  let row = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } // "" -> "
        else inQ = false;
      } else field += c;
    } else if (c === '"') {
      inQ = true;
    } else if (c === delim) {
      row.push(field); field = "";
    } else if (c === "\r") {
      // ignora; o \n fecha a linha
    } else if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else {
      field += c;
    }
  }
  // ultimo campo/linha (arquivo sem quebra final)
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

module.exports = { contarLinhasDados, parseCsv };
