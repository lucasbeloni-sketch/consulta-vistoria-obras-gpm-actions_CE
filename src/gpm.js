// Automacao do GPM CE via Playwright (headless).
// Replica os passos da Skill "baixar-consulta-vistoria-obras-gpm":
//   login -> Obras Eletricas > Vistoria > Consulta Vistoria de Obras
//   -> Contrato (SEM filtro de data: traz todas as vistorias do contrato)
//   -> Pesquisar -> clica no botao verde "CSV" (DataTables, download DIRETO
//   do .csv, sem zip e sem popup) -> devolve os bytes do CSV.
//
// O GPM e uma SPA tema Falcon: as telas /ci/ carregam DENTRO de um iframe
// (#frameTelasGPM). Login opera em `page`; o formulario opera no `frame`.
// O download do DataTables dispara no nivel de `page`/contexto.
//
// Difere das irmas:
//  - Consulta Servicos: tem filtro de data + export por form-submit em popup.
//  - Exportacao Obras: 2 datas + multi-contrato + export .zip "Detalhado".
//  - AQUI (Vistoria): SEM data; export = botao DataTables "CSV" que baixa o
//    .csv cru direto (nao zip); nome final = PREFIXO.csv (sem data, sobrescreve).
//
// CSV do GPM: separador ";", UTF-8 com BOM, quebras CRLF. Subimos os bytes crus
// (BOM e CRLF preservados; a Skill do Desktop normalizava CRLF->LF no Write).
//
// Seletores de dentro da tela usam override de config.json -> selectors quando
// presente, senao heuristica por texto/papel. Em falha gravamos screenshot+HTML.

const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const crypto = require("crypto");
const { contarLinhasDados } = require("./util");

const DEBUG_DIR = path.join(process.cwd(), "debug");
const FRAME_SEL = "#frameTelasGPM";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Acha um locator visivel por uma lista de candidatos (string CSS/seletor ou
// funcao (root)=>Locator). `root` pode ser Page ou Frame.
async function primeiroVisivel(root, candidatos, { timeout = 8000 } = {}) {
  const deadline = Date.now() + timeout;
  let ultimoErro;
  while (Date.now() < deadline) {
    for (const c of candidatos) {
      if (!c) continue;
      try {
        const loc = typeof c === "function" ? c(root) : root.locator(c);
        const first = loc.first();
        if (await first.isVisible().catch(() => false)) return first;
      } catch (e) {
        ultimoErro = e;
      }
    }
    await sleep(250);
  }
  throw new Error("Nenhum candidato visivel encontrado." + (ultimoErro ? ` Ultimo erro: ${ultimoErro.message}` : ""));
}

async function dump(page, tag) {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    await page.screenshot({ path: path.join(DEBUG_DIR, `${tag}.png`), fullPage: true }).catch(() => {});
    const html = await page.content().catch(() => "");
    fs.writeFileSync(path.join(DEBUG_DIR, `${tag}.html`), html);
    console.warn(`[debug] artefatos salvos: debug/${tag}.png e debug/${tag}.html`);
  } catch (_) {}
}

async function dumpFrame(frame, tag) {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    fs.writeFileSync(path.join(DEBUG_DIR, `${tag}.html`), await frame.content());
    console.warn(`[debug] HTML do iframe salvo: debug/${tag}.html`);
  } catch (_) {}
}

// Sessao ativa = campo de senha do login NAO esta mais visivel.
async function estaLogado(page) {
  const senhaVisivel = await page.locator("#idSenha, input[type=password]").first()
    .isVisible().catch(() => false);
  return !senhaVisivel;
}

async function login(page, cfg) {
  const { baseUrl, selectors: s } = cfg;
  const user = process.env.GPM_USER;
  const pass = process.env.GPM_PASS;

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await sleep(1500);

  if (await estaLogado(page)) {
    console.log("[login] sessao ja ativa.");
    return;
  }
  if (!user || !pass) {
    // Sem creds: em HEADED (debug local) espera login manual; em CI, falha.
    if (process.env.HEADED) {
      console.log("[login] sem GPM_USER/GPM_PASS — FACA O LOGIN MANUAL na janela (ate 120s)...");
      try {
        await page.waitForFunction(
          () => !document.querySelector("#idSenha, input[type=password]") ||
                !document.querySelector("#idSenha, input[type=password]").offsetParent,
          { timeout: 120000 }
        );
      } catch (_) {}
      if (await estaLogado(page)) {
        console.log("[login] login manual detectado.");
        return;
      }
    }
    await dump(page, "login-sem-credenciais");
    throw new Error("Tela de login detectada mas faltam GPM_USER/GPM_PASS no ambiente.");
  }

  try {
    const campoUser = await primeiroVisivel(page, [
      s.loginUser, "#idLogin", 'input[name="login"]', 'input[type="text"]',
    ]);
    await campoUser.fill(user);

    const campoPass = await primeiroVisivel(page, [
      s.loginPass, "#idSenha", 'input[name="password"]', 'input[type="password"]',
    ]);
    await campoPass.fill(pass);

    const botao = await primeiroVisivel(page, [
      s.loginSubmit, "button:has-text('Entrar')",
      (p) => p.getByRole("button", { name: /entrar|acessar|login/i }),
    ]);
    await Promise.all([
      page.waitForLoadState("networkidle").catch(() => {}),
      botao.click(),
    ]);
    await sleep(2000);
  } catch (e) {
    await dump(page, "login-falha");
    throw new Error(`Falha ao preencher/enviar o login: ${e.message}`);
  }

  if (!(await estaLogado(page))) {
    await dump(page, "login-pos-submit");
    throw new Error("Login enviado mas a area interna nao apareceu (credenciais invalidas, captcha ou seletor errado?).");
  }
  console.log("[login] autenticado com sucesso.");
}

// Abre a Consulta Vistoria de Obras e devolve o "root" onde a tela vive: o
// Frame do iframe (#frameTelasGPM) se houver, ou a propria Page. A URL /ci/
// direta vem no shell com o iframe; se o goto vier cru, operamos na page.
async function abrirConsulta(page, cfg) {
  await page.goto(cfg.consultaUrl, { waitUntil: "domcontentloaded" });
  let root = page;
  const iframeEl = await page.waitForSelector(FRAME_SEL, { timeout: 8000 }).catch(() => null);
  if (iframeEl) {
    const frame = await iframeEl.contentFrame();
    if (frame) {
      await frame.waitForLoadState("domcontentloaded").catch(() => {});
      root = frame;
      console.log("[gpm] tela carregada DENTRO do iframe #frameTelasGPM.");
    }
  } else {
    console.log("[gpm] sem iframe — operando na propria pagina.");
  }
  // Confirma que a tela certa carregou (Contrato / botao Pesquisar / titulo).
  await primeiroVisivel(root, [
    cfg.selectors.pesquisar,
    (r) => r.getByRole("button", { name: /Pesquisar/i }),
    "text=/Consulta\\s+Vistoria\\s+de\\s+Obras/i",
    "text=/Contrato/i",
  ], { timeout: 20000 });
  console.log("[gpm] Consulta Vistoria de Obras aberta.");
  return root;
}

// Page subjacente de um root (Frame tem .page(); Page e ela mesma).
function paginaDe(root) {
  return typeof root.page === "function" ? root.page() : root;
}

// Le {value,text} do <select> nativo do contrato (e o que o submit usa).
async function lerContratoSelecionado(frame) {
  return frame.evaluate(() => {
    const s = document.querySelector("#contrato");
    if (!s) return { value: "", text: "" };
    const opt = s.options[s.selectedIndex];
    return { value: s.value || "", text: opt ? opt.text.trim() : "" };
  });
}

// Contrato via widget de chip (Choices.js: rotulo "Selecione o Contrato"). As
// opcoes ja existem ao abrir. Abrir = clicar em .choices__inner. NAO digitar a
// string completa (a busca fuzzy filtra pra fora): token curto + Enter, e
// confere pelo <select> nativo. Fallback: clicar a opcao direto.
async function selecionarContrato(frame, cfg, contrato) {
  const wrap = frame.locator('div.choices:has(#contrato)').first();
  const inner = wrap.locator(".choices__inner").first();
  const busca = wrap.locator("input.choices__input--cloned").first();
  const token = contrato.search
    || (contrato.dropdown.match(/\d{5,}/) || [])[0]
    || contrato.dropdown.slice(0, 6);
  const baterTexto = (t) => t && t.includes(contrato.dropdown.slice(0, 10));

  await inner.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  await wrap.scrollIntoViewIfNeeded().catch(() => {});

  for (let i = 0; i < 3; i++) {
    const aberto = await wrap.evaluate((el) => el.classList.contains("is-open")).catch(() => false);
    if (aberto) break;
    await inner.click({ force: true }).catch(() => {});
    await sleep(400);
  }

  if (await busca.isVisible().catch(() => false)) {
    await busca.fill(token);
    await sleep(900);
    await busca.press("Enter").catch(() => {});
    await sleep(400);
  }

  let sel = await lerContratoSelecionado(frame);

  if (!sel.value || !baterTexto(sel.text)) {
    const opcao = frame
      .locator("#contrato")
      .locator("xpath=ancestor::div[contains(@class,'choices')][1]")
      .locator('.choices__list[role="listbox"] .choices__item--choice', { hasText: contrato.dropdown })
      .first();
    await opcao.click({ timeout: 8000 }).catch(() => {});
    await sleep(400);
    sel = await lerContratoSelecionado(frame);
  }

  if (!sel.value || !baterTexto(sel.text)) {
    await dump(paginaDe(frame), `contrato-falha-${contrato.prefixo}`);
    throw new Error(`Contrato nao selecionado (value="${sel.value}", text="${sel.text}").`);
  }
  console.log(`[gpm] Contrato selecionado: ${sel.text} (value=${sel.value}).`);
}

// Clica Pesquisar e espera os resultados. Sinal confiavel de que a tabela +
// a toolbar DataTables (Copiar/CSV/Excel) renderizaram: a presenca do botao de
// export ou do texto "registros". No CI (mais lento) sem essa espera o export
// rodava antes da toolbar existir.
async function pesquisar(frame, cfg) {
  const { selectors: s } = cfg;
  const texto = cfg.exportButtonText || "CSV";
  const botao = await primeiroVisivel(frame, [
    s.pesquisar, (f) => f.getByRole("button", { name: /Pesquisar/i }),
  ]);
  await botao.click();
  try {
    await primeiroVisivel(frame, [
      s.exportarCsv,
      ".dt-buttons a.buttons-csv", ".dt-buttons button.buttons-csv",
      (f) => f.getByRole("button", { name: new RegExp(`^\\s*${texto}\\s*$`, "i") }),
      "text=/Mostrando de .* registros/i", "text=/registros/i",
    ], { timeout: 45000 });
  } catch (e) {
    await dumpFrame(frame, "pesquisa-sem-resultados");
    throw new Error(`Pesquisa: nem toolbar de export nem contagem apareceram em 45s apos Pesquisar. (${e.message})`);
  }

  // Deixa a tabela ASSENTAR antes de exportar. Colunas como Data/Hora / Data
  // Despacho / Coordenadas sao preenchidas por renderizacao deferida — no
  // headless o export disparava antes e elas saiam VAZIAS no CSV. Esperamos:
  // (1) rede ociosa; (2) a coluna Data/Hora ter valor em alguma linha (o sinal
  // direto de que os dados deferidos chegaram); (3) um respiro final.
  const pg = paginaDe(frame);
  await pg.waitForLoadState("networkidle").catch(() => {});
  await frame.waitForFunction(() => {
    const t = document.querySelector("#tab_resultados");
    if (!t) return false;
    const ths = [...t.querySelectorAll("thead th")];
    const idx = ths.findIndex((th) => /Data\s*\/?\s*Hora/i.test(th.textContent || ""));
    if (idx < 0) return true; // sem a coluna: nao trava
    const rows = [...t.querySelectorAll("tbody tr")];
    if (!rows.length) return true;
    return rows.some((r) => r.children[idx] && (r.children[idx].textContent || "").trim() !== "");
  }, { timeout: 20000 }).catch(() => console.warn("[gpm] aviso: coluna Data/Hora nao populou no tempo; seguindo mesmo assim."));
  await sleep(1500);
  console.log("[gpm] Pesquisa concluida.");
}

// Detecta busca sem resultados. NAO da pra usar o texto "Nenhum registro
// encontrado" do HTML: essa frase e o rotulo i18n do DataTables (emptyTable) e
// vem no HTML mesmo quando HA dados. Checamos a tabela real (#tab_resultados,
// confirmado no aria-controls dos botoes): vazia = linha .dataTables_empty ou
// tbody sem linhas de dados. Sem a tabela, NAO afirmamos vazio (deixa o export
// tentar) pra nao bloquear por engano.
async function buscaVazia(frame) {
  return frame.evaluate(() => {
    const t = document.querySelector("#tab_resultados");
    if (!t) return false;
    if (t.querySelector("td.dataTables_empty, tr.dataTables_empty")) return true;
    return t.querySelectorAll("tbody tr").length === 0;
  }).catch(() => false);
}

// Dispara o export clicando no botao verde "CSV" (DataTables HTML5 export:
// classe buttons-csv). Ele gera o .csv no cliente e dispara um download DIRETO
// (sem zip, sem popup) — diferente das irmas. Armamos o listener de download
// (page + eventual popup) ANTES do clique. CUIDADO: nao clicar em "Excel"
// (buttons-excel) nem "Copiar" (buttons-copy). Salva em ./debug.
async function exportarCsv(page, frame, cfg) {
  const ctx = page.context();
  const texto = cfg.exportButtonText || "CSV";

  if (process.env.DEBUG_DUMP) {
    await dumpFrame(frame, "pre-export");
    const amostra = await frame.evaluate(() => {
      const t = document.querySelector("#tab_resultados");
      if (!t) return "sem #tab_resultados";
      const ths = [...t.querySelectorAll("thead th")].map((th) => (th.textContent || "").trim());
      const r0 = [...(t.querySelector("tbody tr") ? t.querySelector("tbody tr").children : [])].map((td) => (td.textContent || "").trim());
      return { ths, r0 };
    }).catch((e) => `evaluate falhou: ${e.message}`);
    console.log("[gpm][debug] tabela:", JSON.stringify(amostra));
  }

  // Export = botao verde "CSV" (DataTables, classe buttons-csv). Ele exporta
  // TODAS as linhas (nao so a pagina) e baixa o .csv direto. A tela e
  // DataTables server-side: mexer em page.len/draw refaz a query SEM os filtros
  // do Pesquisar e zera a tabela — por isso NAO tocamos na paginacao; deixamos
  // o proprio botao cuidar do export completo. As datas dependem do locale/fuso
  // do browser (fixados: timezoneId America/Sao_Paulo, locale pt-BR).
  let botao;
  try {
    botao = await primeiroVisivel(frame, [
      cfg.selectors.exportarCsv,
      ".dt-buttons a.buttons-csv", ".dt-buttons button.buttons-csv",
      "a.buttons-csv", "button.buttons-csv",
      (f) => f.getByRole("button", { name: new RegExp(`^\\s*${texto}\\s*$`, "i") }),
      (f) => f.getByRole("link", { name: new RegExp(`^\\s*${texto}\\s*$`, "i") }),
      `.dt-button:has-text('${texto}')`,
    ], { timeout: 20000 });
  } catch (e) {
    await dumpFrame(frame, "export-sem-botao");
    throw new Error(`Botao "${texto}" (verde, DataTables) nao encontrado na tela de resultados: ${e.message}`);
  }

  let onPage;
  const viaPopup = new Promise((resolve) => {
    onPage = (p) => p.waitForEvent("download", { timeout: 30000 }).then(resolve).catch(() => {});
    ctx.on("page", onPage);
  });
  const viaPage = page.waitForEvent("download", { timeout: 32000 });

  let download;
  try {
    await botao.scrollIntoViewIfNeeded().catch(() => {});
    await botao.click({ force: true }).catch(() => {});
    download = await Promise.race([viaPage, viaPopup]);
  } catch (e) {
    await dumpFrame(frame, "export-sem-download");
    await dump(page, "export-sem-download-shell");
    throw new Error(`Cliquei no "${texto}" mas nenhum download veio em 30s. ${e.message}`);
  } finally {
    ctx.off("page", onPage);
    viaPage.catch(() => {});
  }
  if (!download) throw new Error("Export sem objeto de download.");

  const sug = download.suggestedFilename();
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const destino = path.join(DEBUG_DIR, `ultimo-download-${sug || "arquivo"}`);
  await download.saveAs(destino);
  console.log(`[gpm] download recebido: "${sug}" -> ${destino}`);
  return destino;
}

// Extrai os bytes do CSV do arquivo baixado, detectando o tipo:
//  - texto (CSV direto): usa como veio (caminho esperado aqui).
//  - ZIP ("PK"): pega o .csv de dentro (defesa; a Vistoria baixa CSV cru).
function extrairCsv(arqPath) {
  const raw = fs.readFileSync(arqPath);
  const ehZip = raw.length >= 2 && raw[0] === 0x50 && raw[1] === 0x4b; // "PK"

  let buffer;
  if (ehZip) {
    const zip = new AdmZip(raw);
    const nomes = zip.getEntries().map((e) => e.entryName);
    const entry = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith(".csv"));
    if (!entry) {
      const ehXlsx = nomes.some((n) => /^xl\//i.test(n));
      throw new Error(ehXlsx
        ? `O download foi um XLSX (Excel), nao CSV. Clicamos no controle errado (Excel em vez de CSV). Conteudo: ${nomes.join(", ")}`
        : `Zip sem .csv. Conteudo: ${nomes.join(", ")}`);
    }
    buffer = entry.getData();
  } else {
    const inicio = raw.slice(0, 64).toString("utf8").toLowerCase();
    if (inicio.includes("<!doctype") || inicio.includes("<html")) {
      throw new Error("O download veio como HTML (provavel pagina de erro/sessao), nao CSV.");
    }
    buffer = raw; // CSV cru: preserva BOM e CRLF
  }

  const md5 = crypto.createHash("md5").update(buffer).digest("hex");
  return { buffer, md5, bytes: buffer.length, linhas: contarLinhasDados(buffer), origem: ehZip ? "zip" : "csv-direto" };
}

// Rotina de um contrato: abre a tela, seleciona o contrato (sem data),
// pesquisa, exporta o "CSV" e extrai. Nome final = PREFIXO.csv (sobrescreve).
async function baixarContrato(page, cfg, contrato) {
  console.log(`\n=== Contrato ${contrato.dropdown} (${contrato.prefixo}) ===`);
  const frame = await abrirConsulta(page, cfg);
  await selecionarContrato(frame, cfg, contrato);
  await pesquisar(frame, cfg);

  if (await buscaVazia(frame)) {
    console.log("[gpm] Nenhum registro encontrado para o contrato — nada a exportar.");
    return { vazio: true };
  }

  let arqPath;
  try {
    arqPath = await exportarCsv(page, frame, cfg);
  } catch (e) {
    await dump(page, `export-falha-${contrato.prefixo}`);
    throw new Error(`Falha ao exportar ${contrato.prefixo}: ${e.message}`);
  }

  const { buffer, md5, bytes, linhas } = extrairCsv(arqPath);
  const nomeFinal = `${contrato.prefixo}.csv`; // ex.: SOC.SOT.csv (sem data, sobrescreve)
  console.log(`[gpm] ${nomeFinal} extraido: ${bytes} bytes, ${linhas} linhas de dados, md5=${md5}`);
  return { buffer, md5, bytes, linhas, nomeFinal };
}

module.exports = {
  login, baixarContrato, extrairCsv, dump, dumpFrame,
  // expostos p/ debug/calibracao (tools/*):
  abrirConsulta, selecionarContrato, pesquisar, exportarCsv,
};
