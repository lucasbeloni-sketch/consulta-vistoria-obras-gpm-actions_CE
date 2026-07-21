// Orquestrador: login -> por contrato (baixar CSV + extrair + enviar ao Drive).
// Roda igual local e no GitHub Actions. Headless por padrao; HEADED=1 abre o
// browser visivel (debug local). DRY_RUN=1 baixa mas nao envia ao Drive.
// Sem filtro de data (Vistoria): cada contrato -> um PREFIXO.csv que sobrescreve.

const { chromium } = require("playwright");
const cfg = require("../config.json");
const { login, baixarContrato, dump } = require("./gpm");
const { uploadCsv } = require("./drive");

// Retenta fn ate `tentativas` vezes (GPM e flaky). Loga cada tentativa.
async function comRetry(fn, label, tentativas = 2) {
  let err;
  for (let i = 1; i <= tentativas; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      if (i < tentativas) console.warn(`[run] ${label}: tentativa ${i}/${tentativas} falhou (${e.message}); tentando de novo...`);
    }
  }
  throw err;
}

(async () => {
  const headless = !process.env.HEADED;
  const dryRun = !!process.env.DRY_RUN;
  console.log(`[run] headless=${headless} | dryRun=${dryRun} | contratos=${cfg.contratos.length}`);

  const browser = await chromium.launch({ headless });
  // timezoneId America/Sao_Paulo: o GPM formata Data/Hora no fuso do browser; no
  // runner (UTC) as datas sairiam +3h. Fixamos BRT pra bater com o esperado.
  // Viewport largo: evita o DataTables/Responsive colapsar colunas.
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1920, height: 1200 },
    timezoneId: "America/Sao_Paulo",
    locale: "pt-BR",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  const resultados = [];
  let falhou = false;
  try {
    await login(page, cfg);

    const minLinhas = cfg.minLinhasDados ?? 1;
    for (const contrato of cfg.contratos) {
      try {
        const r0 = await comRetry(
          () => baixarContrato(page, cfg, contrato),
          `contrato ${contrato.prefixo}`
        );

        // Busca sem resultados: condicao anormal para a Vistoria (traz todas as
        // vistorias do contrato). Nao sobrescreve o arquivo; conta como falha.
        if (r0.vazio) {
          throw new Error("Busca sem resultados (Nenhum registro encontrado). NAO sobrescrevo o arquivo do contrato.");
        }
        const { buffer, md5, bytes, linhas, nomeFinal } = r0;

        // Guard anti-clobber: nao sobrescrever o arquivo com um CSV so-cabecalho
        // (provavel glitch/filtro errado do GPM).
        if (linhas < minLinhas) {
          throw new Error(`CSV com ${linhas} linha(s) de dados (< minimo ${minLinhas}). NAO sobrescrevo o arquivo (provavel glitch do GPM).`);
        }

        if (dryRun) {
          console.log(`[run] DRY_RUN: ${nomeFinal} (${bytes} bytes, ${linhas} linhas) NAO enviado ao Drive.`);
          resultados.push({ contrato: contrato.prefixo, nomeFinal, md5, bytes, acao: "dry-run" });
        } else {
          const r = await uploadCsv(buffer, nomeFinal, cfg);
          resultados.push({ contrato: contrato.prefixo, nomeFinal, md5, bytes, acao: r.acao });
        }
      } catch (e) {
        falhou = true;
        console.error(`[run] ERRO no contrato ${contrato.prefixo}: ${e.message}`);
      }
    }
  } catch (e) {
    falhou = true;
    console.error(`[run] ERRO fatal: ${e.message}`);
    await dump(page, "erro-fatal");
  } finally {
    await browser.close();
  }

  console.log("\n=== Resumo ===");
  for (const r of resultados) console.log(`  ${r.nomeFinal}: ${r.acao} (${r.bytes} bytes, md5=${r.md5})`);
  if (falhou || resultados.length < cfg.contratos.length) {
    console.error("[run] terminou COM falhas.");
    process.exit(1);
  }
  console.log("[run] terminou OK.");
})();
