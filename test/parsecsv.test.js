const { test } = require("node:test");
const assert = require("node:assert");
const { parseCsv } = require("../src/util");

test("parseCsv: separador ; com aspas, BOM e CRLF", () => {
  const buf = Buffer.from('﻿"a";"b";"c"\r\n"1";"2";"3"\r\n', "utf8");
  assert.deepStrictEqual(parseCsv(buf), [["a", "b", "c"], ["1", "2", "3"]]);
});

test("parseCsv: campo com ; dentro de aspas nao quebra a coluna", () => {
  const buf = Buffer.from('"x";"Rua A, 10; ap 2";"y"\n', "utf8");
  assert.deepStrictEqual(parseCsv(buf), [["x", "Rua A, 10; ap 2", "y"]]);
});

test("parseCsv: escape de aspas \"\" e quebra de linha dentro de aspas", () => {
  const buf = Buffer.from('"diz ""oi""";"linha1\nlinha2"\n', "utf8");
  assert.deepStrictEqual(parseCsv(buf), [['diz "oi"', "linha1\nlinha2"]]);
});

test("parseCsv: selecao das colunas A,G,H,K (indices 0,6,7,10)", () => {
  const header = '"N. Vistoria";"Contrato";"Tipo";"Funcionario";"Obra";"Cod. Obra";"Ordem de Trabalho";"Ordem de Trabalho (OT) Principal";"Clientes";"Endereco";"Data/Hora";"Data Despacho";"Coordenadas";"Municipio"';
  const linha = '"232593493";"JA10188071/2026_SOC_SOT";"Form";"FULANO";"SETOR 0";"5000";"8452528";"";"";"Av X, 1";"20/07/2026 14:19:39";"";"";"Brejo Santo"';
  const rows = parseCsv(Buffer.from(`${header}\r\n${linha}\r\n`, "utf8"));
  const cols = [0, 6, 7, 10];
  assert.deepStrictEqual(cols.map((i) => rows[1][i]), ["232593493", "8452528", "", "20/07/2026 14:19:39"]);
});
