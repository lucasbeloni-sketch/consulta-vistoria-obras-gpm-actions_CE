// Calibrador interativo (rodar LOCAL, headed). Abre o GPM e ESPERA voce:
//   1) fazer login;
//   2) navegar ate Obras Eletricas > Vistoria > Consulta Vistoria de Obras;
//   3) selecionar o Contrato e clicar Pesquisar (pra a toolbar "CSV" aparecer).
// Varre TODAS as abas e TODOS os frames procurando a tela (botao CSV / campo
// Contrato / titulo). Assim que achar o botao CSV (ou esgotar o tempo), captura
// a URL REAL do frame/aba, enumera os controles e dumpa HTML/PNG em ./debug.
// Uso: node tools/calibrar.js   (ou: npm run calibrar)

const { chromium } = require("playwright");
const fs = require("fs");
const cfg = require("../config.json");

const ESPERA_MS = 240000; // 4 min: tempo de sobra pra logar + navegar + pesquisar

process.on("unhandledRejection", (e) => console.warn(`[calibrar] rejeicao ignorada: ${e && e.message}`));

// Testa um frame: retorna que sinais da tela de Vistoria ele tem.
async function sinais(frame) {
  try {
    return await frame.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const txt = (document.body && document.body.innerText || "");
      return {
        temCsv: !!q("a.buttons-csv, button.buttons-csv") ||
                [...document.querySelectorAll(".dt-button,.dt-buttons a,.dt-buttons button")]
                  .some((b) => /^\s*csv\s*$/i.test(b.textContent || "")),
        temContrato: !!q("#contrato") || /Selecione o Contrato/i.test(txt),
        temTitulo: /Consulta\s+Vistoria\s+de\s+Obras/i.test(txt),
        temPesquisar: [...document.querySelectorAll("button,input[type=submit],input[type=button],a")]
          .some((b) => /^\s*pesquisar\s*$/i.test((b.textContent || b.value || ""))),
      };
    });
  } catch (_) { return null; }
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(ESPERA_MS);

  await page.goto(cfg.baseUrl, { waitUntil: "domcontentloaded" });
  console.log("\n==================================================================");
  console.log(" CALIBRACAO — na JANELA que abriu (tem ate 4 min, sem pressa):");
  console.log("   1) LOGIN");
  console.log("   2) menu: Obras Eletricas > Vistoria > Consulta Vistoria de Obras");
  console.log("   3) selecione o Contrato e clique PESQUISAR (pra ver o botao CSV)");
  console.log(" Detecto o botao 'CSV' sozinho (varrendo todas as abas/frames) e capturo tudo.");
  console.log("==================================================================\n");

  // Varre todas as abas do contexto e todos os frames de cada uma.
  const varrer = async () => {
    let melhor = null; // {frame, page, s, score}
    for (const p of context.pages()) {
      let frames = [];
      try { frames = p.frames(); } catch (_) { continue; }
      for (const f of frames) {
        const s = await sinais(f);
        if (!s) continue;
        const score = (s.temCsv ? 8 : 0) + (s.temContrato ? 4 : 0) + (s.temTitulo ? 2 : 0) + (s.temPesquisar ? 1 : 0);
        if (score > 0 && (!melhor || score > melhor.score)) melhor = { frame: f, page: p, s, score };
      }
    }
    return melhor;
  };

  const deadline = Date.now() + ESPERA_MS;
  let alvo = null;
  while (Date.now() < deadline) {
    const m = await varrer();
    if (m) {
      alvo = m;
      if (m.s.temCsv) { console.log("[calibrar] botao CSV detectado!"); break; }
    }
    await page.waitForTimeout(1500);
  }

  if (!alvo) {
    console.log("[calibrar] nao achei a tela de Vistoria em nenhuma aba/frame (timeout). Capturando a aba ativa.");
    alvo = { frame: page.mainFrame(), page, s: {}, score: 0 };
  } else if (!alvo.s.temCsv) {
    console.log(`[calibrar] tempo esgotou; melhor match parcial (score=${alvo.score}, sinais=${JSON.stringify(alvo.s)}). Capturando esse.`);
  }

  await alvo.page.waitForTimeout(1200);
  const frame = alvo.frame;
  const ehIframe = frame !== alvo.page.mainFrame();
  console.log(`\n[calibrar] URL da aba: ${alvo.page.url()}`);
  console.log(`[calibrar] tela dentro de um iframe? ${ehIframe}`);
  console.log(`[calibrar] URL REAL da tela (use em config.json -> consultaUrl): ${frame.url()}`);

  fs.mkdirSync("debug", { recursive: true });
  await alvo.page.screenshot({ path: "debug/calibrar.png", fullPage: true }).catch(() => {});
  try { fs.writeFileSync("debug/calibrar-frame.html", await frame.content()); } catch (_) {}

  let tela = null;
  try {
    tela = await frame.evaluate(() => {
      const desc = (el) => ({
        tag: el.tagName.toLowerCase(), type: el.type || null, name: el.name || null,
        id: el.id || null, cls: (el.className && el.className.toString().slice(0, 90)) || null,
        title: el.title || el.getAttribute("data-original-title") || null,
        text: (el.innerText || el.value || "").trim().slice(0, 45) || null,
      });
      const contrato = document.querySelector("#contrato");
      return {
        exportLike: [...document.querySelectorAll("button,input,a")].map(desc)
          .filter((d) => /csv|excel|copiar|copy|buttons-|dt-button/i.test(`${d.text} ${d.title} ${d.cls}`)),
        pesquisarLike: [...document.querySelectorAll("button,input[type=submit],input[type=button],a")].map(desc)
          .filter((d) => /pesquisar/i.test(`${d.text} ${d.title}`)),
        contrato: contrato ? {
          id: contrato.id, name: contrato.name, multiple: contrato.multiple,
          temChoices: !!document.querySelector("div.choices"),
          opcoes: [...contrato.options].slice(0, 15).map((o) => o.text.trim()),
        } : null,
        selects: [...document.querySelectorAll("select")].map((s) => ({ id: s.id, name: s.name, multiple: s.multiple })),
        toolbarDataTables: [...document.querySelectorAll(".dt-buttons")].map((tb) => tb.outerHTML.slice(0, 400)),
      };
    });
  } catch (e) {
    console.warn(`[calibrar] evaluate falhou (${e && e.message}); use o dump debug/calibrar-frame.html.`);
  }
  console.log("\n[calibrar] === CONTROLES DA TELA ===");
  console.log(JSON.stringify(tela, null, 2));

  await alvo.page.waitForTimeout(1500);
  await browser.close();
  console.log("\n[calibrar] Pronto. Dumps em debug/calibrar.png e debug/calibrar-frame.html.");
})();
