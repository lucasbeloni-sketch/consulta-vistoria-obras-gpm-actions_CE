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

module.exports = { contarLinhasDados };
