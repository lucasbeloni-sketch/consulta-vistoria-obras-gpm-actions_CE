# Consulta Vistoria de Obras GPM — download automatico (GitHub Actions)

Versao headless e autonoma da Skill `baixar-consulta-vistoria-obras-gpm`. Baixa o
relatorio **Consulta Vistoria de Obras** do GPM CE (`https://sirtecce.gpm.srv.br/`,
Obras Eletricas > Vistoria > Consulta Vistoria de Obras) e envia o CSV —
renomeado `PREFIXO.csv` (ex.: `SOC.SOT.csv`) — para a pasta `Consulta_Vistoria`
no Google Drive, **sobrescrevendo** o arquivo do contrato. Irma dos repos
`consulta-servico-gpm-actions_CE` e `exportacao-obras-gpm-actions_CE` (mesma stack).

E a mais **simples** das tres: **sem filtro de data** e o export baixa o **CSV
direto** (nao um `.zip`, nao um form-submit em popup).

## O que mudou em relacao a Skill

| Skill (Claude Desktop) | Aqui (Actions) |
|---|---|
| Login **manual** no Chrome | Login automatico via `GPM_USER`/`GPM_PASS` (secrets) |
| **Claude in Chrome** clicando na UI | **Playwright headless** replicando os cliques |
| Grava no **Drive Desktop** (G:) via Write/Edit | Sobe pela **Drive API** (service account) na mesma pasta |
| Write normalizava **CRLF -> LF** (perdia bytes) | Sobe os **bytes crus** do CSV: **BOM e CRLF preservados** |
| BOM sumia e precisava de 2o passo (Edit) | Bytes verbatim, sem pos-processamento |

Pasta-destino: `1TRlNBxcSMWiQ8Jkhez7-cIPDaVQhN-l0` (Consulta_Vistoria, em
`PCP > Time CCM - CE > Sistemas > Bases`).

## Diferencas vs os repos irmaos

- **Sem data**: nao seta Data Vistoria Inicial/Final — traz todas as vistorias do contrato.
- **Export**: botao verde **"CSV"** da toolbar DataTables (`buttons-csv`) → download **direto** do `.csv`. (Consulta Servicos: form-submit em popup; Exportacao Obras: `.zip` "Detalhado".)
- **Nome**: `PREFIXO.csv` (sem data, sobrescreve). (Consulta Servicos: `PREFIXO - mm.aaaa.csv`; Exportacao Obras: `mm.aaaa.csv`.)
- **CSV**: `;`, UTF-8 **BOM**, quebras **CRLF** (as irmas vem em LF).

## Estrutura

```
config.json              consultaUrl, contratos, pasta-destino, minLinhasDados, seletores
src/baixar.js            orquestrador (login -> por contrato: baixar + retry + guard + enviar)
src/gpm.js               Playwright: login, navegacao, contrato (Choices.js), Pesquisar, export "CSV", extracao
src/drive.js             upload/update na pasta do Drive (service account) + auto-dedup
src/util.js              funcao pura (contagem de linhas) — testada. Sem funcoes de data (Vistoria nao usa)
lib/google.js            auth da service account + withRetry
test/                    testes unitarios (node --test): extrairCsv + contagem de linhas (LF e CRLF)
tools/                   helpers: inspect (calibrar seletores), check-drive (auditar duplicatas)
.github/workflows/baixar.yml   testes + cron diario + botao manual + notificacao de falha
```

Guards: `minLinhasDados` impede sobrescrever com CSV so-cabecalho (glitch do GPM);
busca vazia ("Nenhum registro encontrado") tambem NAO sobrescreve. `drive.js` faz
auto-dedup (manda copias extras do mesmo nome pra lixeira). `baixar.js` retenta a
rodada 2x por contrato (GPM e flaky).

## Secrets (GitHub → Settings → Secrets and variables → Actions)

- `GOOGLE_CREDENTIALS` — JSON **inteiro** da key da service account. A SA precisa
  de acesso **Editor** na pasta `Consulta_Vistoria`
  (`robo-api-python-google-drive@angelic-edition-484319-p0.iam.gserviceaccount.com`).
- `GPM_USER` — usuario do GPM CE (ex.: `SIR795027`).
- `GPM_PASS` — senha do GPM CE.

## ⚠️ Calibracao dos seletores (faca ANTES do primeiro run de verdade)

A tela **Consulta Vistoria de Obras nao foi validada contra o DOM real** — os
seletores em `config.json` sao a melhor aproximacao a partir da Skill + repos
irmaos. Confirme, nesta ordem:

1. **`consultaUrl`** em `config.json` — o valor atual
   (`/ci/Vistoria/ConsultaVistoriaObras`) e um **chute**. Rode
   `HEADED=1 npm run inspect`, veja se a tela certa carrega (breadcrumb
   "Obras Eletricas > Vistoria > Consulta Vistoria de Obras", campos Contrato /
   Data Vistoria, botao Pesquisar). Se a URL direta nao existir, pegue a real
   navegando pelo menu com o browser aberto e ajuste.
2. **Botao "CSV"** (`selectors.exportarCsv`) — o inspect lista `exportLike`;
   confirme o seletor do **verde "CSV"** (DataTables `buttons-csv`), NAO o
   "Excel" nem o "Copiar".
3. **Contrato** e **Pesquisar** — o codigo acha por heuristica; se errar,
   preencha `selectors.contratoDropdown`/`pesquisar`.
4. Rode `DRY_RUN=1 HEADED=1 npm start` e ajuste ate baixar o `.csv` certo
   (md5/linhas no log).

Em falha, o codigo grava screenshot + HTML em `./debug` (o workflow sobe esses
artefatos). Use-os pra calibrar.

## Rodar local (teste / calibracao)

```powershell
cd C:\Users\sirte\Documents\GitHub\consulta-vistoria-obras-gpm-actions_CE
npm install
npx playwright install chromium
$env:GOOGLE_CREDENTIALS = Get-Content credentials.json -Raw

# 1) Calibrar seletores (abre o browser; logue na janela e clique Pesquisar
#    pra ver o botao "CSV"):
$env:HEADED = "1"; npm run inspect    # gera ./debug/*.html e *.png

# 2) Teste sem mexer no Drive (baixa e extrai, NAO envia):
$env:DRY_RUN = "1"; $env:HEADED = "1"; npm start

# 3) Rodada real:
Remove-Item Env:DRY_RUN, Env:HEADED -ErrorAction SilentlyContinue; npm start
```

`credentials.json` esta no `.gitignore` — nunca commitar.

## Contratos

Edite `config.json → contratos`. Cada item:
`{ "dropdown": "<texto exato no GPM>", "prefixo": "<PREFIXO>" }`
(opcional `"search"` p/ forcar o token do filtro Choices.js). Cada contrato vira
um `PREFIXO.csv` proprio, sempre sobrescrito. Hoje ha **1** contrato liberado:
`JA10188071/2026_SOC_SOT` → `SOC.SOT`.

## Cron

`0 9 * * *` = diario 09:00 UTC (06:00 BRT). Ajuste em `.github/workflows/baixar.yml`.

## Limitacoes conhecidas

- **Captcha / 2FA no login**: se o GPM exigir, o login automatico nao passa.
- **DOM muda**: se a UI do GPM mudar, recalibre os seletores (passo acima).
- **Filtro de data**: hoje sem data (todas as vistorias). Se precisar, da pra
  adicionar depois (a Skill deixou esse incremento em aberto).
