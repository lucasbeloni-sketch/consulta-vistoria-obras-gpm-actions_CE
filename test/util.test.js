const { test } = require("node:test");
const assert = require("node:assert");
const { contarLinhasDados } = require("../src/util");

test("contarLinhasDados: ignora cabecalho, BOM e linhas vazias (LF)", () => {
  assert.strictEqual(contarLinhasDados(Buffer.from("﻿a;b;c\n1;2;3\n4;5;6\n", "utf8")), 2);
  assert.strictEqual(contarLinhasDados(Buffer.from("﻿a;b\n", "utf8")), 0); // so cabecalho
  assert.strictEqual(contarLinhasDados(Buffer.from("a;b\n1;2\n\n\n", "utf8")), 1);
});

test("contarLinhasDados: quebras CRLF (como a Vistoria baixa)", () => {
  assert.strictEqual(contarLinhasDados(Buffer.from("﻿a;b\r\n1;2\r\n3;4\r\n", "utf8")), 2);
});
