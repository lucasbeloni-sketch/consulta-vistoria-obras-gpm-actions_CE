// Verificacao read-only: lista os "PREFIXO.csv" na pasta destino (um por
// contrato do config) e aponta duplicatas.
// Uso: GOOGLE_CREDENTIALS=... npm run check
const { google } = require("googleapis");
const { getAuthClient } = require("../lib/google");
const cfg = require("../config.json");

(async () => {
  const auth = await getAuthClient(["https://www.googleapis.com/auth/drive"]);
  const drive = google.drive({ version: "v3", auth });
  const folderId = cfg.destFolderId;
  const folder = await drive.files.get({ fileId: folderId, fields: "id,name,driveId", supportsAllDrives: true });
  const driveId = folder.data.driveId;
  console.log(`Pasta: ${folder.data.name} (${folderId}) | driveId=${driveId}`);

  const list = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
    fields: "files(id,name,modifiedTime,size)",
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "drive",
    driveId,
    orderBy: "name,modifiedTime",
  });
  const files = list.data.files || [];
  console.log(`\nArquivos na pasta: ${files.length}`);
  for (const f of files) {
    console.log(`  - ${f.name} | id=${f.id} | mod=${f.modifiedTime} | ${f.size || "?"} bytes`);
  }

  // Confere um PREFIXO.csv por contrato + duplicatas por nome.
  const esperados = cfg.contratos.map((c) => `${c.prefixo}.csv`);
  console.log(`\nEsperados (1 por contrato): ${esperados.join(", ")}`);
  const porNome = {};
  for (const f of files) (porNome[f.name] ||= []).push(f);
  for (const nome of esperados) {
    const n = (porNome[nome] || []).length;
    console.log(`  ${nome}: ${n === 1 ? "OK (1)" : n === 0 ? "AUSENTE" : `⚠️ ${n} copias`}`);
  }
  const dups = Object.entries(porNome).filter(([, arr]) => arr.length > 1);
  if (dups.length) {
    console.log("\n⚠️ DUPLICATAS:");
    for (const [nome, arr] of dups) console.log(`  "${nome}": ${arr.length} copias -> ids: ${arr.map((x) => x.id).join(", ")}`);
  } else {
    console.log("\n✓ Sem duplicatas (no maximo 1 por nome).");
  }
})();
