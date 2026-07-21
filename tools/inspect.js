// Helper de calibracao de seletores da tela Consulta Vistoria de Obras.
// Abre o GPM, loga (manual em HEADED, ou automatico com creds), navega ate a
// tela, despeja o HTML (iframe ou pagina) em ./debug e lista candidatos de
// seletor: contrato (Choices.js), botao Pesquisar e os botoes DataTables de
// export (procurando o verde "CSV", ao lado de "Excel" e "Copiar").
//
// Uso local:
//   HEADED=1 npm run inspect                 (abre o browser; faca o login e,
//                                             pra ver o botao CSV, clique
//                                             Pesquisar nos ~60s)
//   GPM_USER=... GPM_PASS=... npm run inspect (tenta logar sozinho)

const { chromium } = require("playwright");
const cfg = require("../config.json");
const { login, dump } = require("../src/gpm");

(async () => {
  const headless = process.env.HEADED ? false : !!process.env.CI;
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  // Login: automatico se houver creds; senao janela aberta p/ login manual.
  if (process.env.GPM_USER && process.env.GPM_PASS) {
    await login(page, cfg);
  } else {
    await page.goto(cfg.baseUrl, { waitUntil: "domcontentloaded" });
    await dump(page, "inspect-01-login");
    if (!headless) {
      console.log("\n[inspect] Faca o LOGIN na janela (e, se quiser ver o 'CSV', clique Pesquisar). ~60s...");
      await page.waitForTimeout(60000);
    }
  }

  // Vai pra tela de Vistoria. Pode vir dentro do iframe (#frameTelasGPM) ou crua.
  console.log(`[inspect] indo para ${cfg.consultaUrl} ...`);
  await page.goto(cfg.consultaUrl, { waitUntil: "domcontentloaded" });
  let frame = page;
  const iframeEl = await page.waitForSelector("#frameTelasGPM", { timeout: 8000 }).catch(() => null);
  if (iframeEl) {
    frame = await iframeEl.contentFrame();
    await frame.waitForLoadState("domcontentloaded").catch(() => {});
    console.log("[inspect] tela dentro do iframe #frameTelasGPM.");
  } else {
    console.log("[inspect] sem iframe — enumerando a propria pagina.");
  }
  await page.waitForTimeout(5000);
  await dump(page, "inspect-03-vistoria");
  try {
    const fs = require("fs");
    fs.writeFileSync("debug/inspect-04-frame.html", await frame.content());
    console.warn("[debug] HTML da tela salvo: debug/inspect-04-frame.html");
  } catch (_) {}

  const tela = await frame.evaluate(() => {
    const desc = (el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || null,
      name: el.name || null,
      id: el.id || null,
      cls: (el.className && el.className.toString().slice(0, 70)) || null,
      title: el.title || el.getAttribute("data-original-title") || null,
      text: (el.innerText || el.value || "").trim().slice(0, 40) || null,
    });
    return {
      inputs: [...document.querySelectorAll("input:not([type=hidden]),select,textarea")].map(desc),
      botoes: [...document.querySelectorAll("button,input[type=button],input[type=submit],a.btn,a.dt-button,a")]
        .map(desc).filter((d) => d.text || d.title || d.id).slice(0, 80),
      // Destaque dos botoes DataTables de export — procure aqui o verde "CSV".
      exportLike: [...document.querySelectorAll("button,input,a")]
        .map(desc)
        .filter((d) => /csv|excel|copiar|copy|buttons-/i.test(`${d.text} ${d.title} ${d.cls}`)),
      selects: [...document.querySelectorAll("select")].map((sel) => ({
        name: sel.name || sel.id, multiple: sel.multiple,
        options: [...sel.options].slice(0, 30).map((o) => o.text.trim()),
      })),
    };
  });
  console.log("\n[inspect] controles da tela Consulta Vistoria de Obras:");
  console.log(JSON.stringify(tela, null, 2));

  await browser.close();
  console.log("\n[inspect] Pronto. Veja ./debug/*.html e *.png. Ajuste config.json -> consultaUrl e selectors (em especial 'exportarCsv' e 'pesquisar').");
})();
