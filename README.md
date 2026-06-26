# Gestão de Abastecimento

Painel de gestão de abastecimento (ruptura projetada, cobertura de estoque / PME,
perda de vendas e gestão de SKUs por CD).

Este repositório transforma o **protótipo de design** (Claude Design) em um
projeto rodável: um servidor **Node.js + Express** que serve o painel e expõe a
**API real** que o alimenta. Hoje a API responde com **dados simulados**
determinísticos (porte fiel do gerador do protótipo); o próximo passo é plugar o
banco de dados real mantendo o mesmo contrato.

## Como rodar

```bash
npm install
npm start         # produção
npm run dev       # com --watch (reinicia ao salvar)
```

Depois acesse:

- Painel:  http://localhost:3000/
- API:     http://localhost:3000/api/abastecimento
- Health:  http://localhost:3000/health

O painel (em `public/index.html`) já aponta para a API local via
`window.ABASTECIMENTO_API_URL = '/api/abastecimento'`. O React 18 é servido
localmente em `public/vendor/` (o `support.js` detecta `window.React` e dispensa
o CDN), então **o painel roda sem depender de internet externa**.

## Testes

```bash
npm test
```

Cobrem o contrato de dados, o determinismo do gerador, a regra de `perdaHoje` e
os filtros do serviço.

## Deploy na Vercel

O projeto já está pronto para a Vercel — toda a configuração está em
`vercel.json`, sem necessidade de ajustes no painel.

- O app Express é exposto como Serverless Function em `api/index.js`
  (atende `/api/*` e `/health`).
- Os estáticos do painel (`public/`: `index.html`, `support.js`, `vendor/`)
  são servidos diretamente pela CDN da Vercel.

Como publicar:

1. **Via dashboard:** importe o repositório em vercel.com → "Add New… → Project".
   Não é preciso definir Build Command nem Output Directory; o `vercel.json`
   cuida do roteamento. Clique em Deploy.
2. **Via CLI:**
   ```bash
   npm i -g vercel
   vercel          # preview
   vercel --prod   # produção
   ```

Como o painel chama a API na mesma origem (`/api/abastecimento`), não há nada a
configurar: assim que o deploy sobe, o painel já consome a API publicada. Para
apontar o painel para outra API, defina `window.ABASTECIMENTO_API_URL` em
`public/index.html`.

## Estrutura

```
api/
  index.js                    Entrypoint da Serverless Function (Vercel) -> app Express
vercel.json                   Roteamento da Vercel (functions + estáticos)
public/                       Front-end (protótipo de design servido como estático)
  index.html                  Painel; configura ABASTECIMENTO_API_URL -> /api/abastecimento
  support.js                  Runtime do protótipo (não editar)
  vendor/                     React 18 UMD local (dispensa CDN externo)
src/
  server.js                   App Express (API + estáticos + health + CORS)
  routes/abastecimento.js     GET /api/abastecimento e /api/abastecimento/resumo
  services/abastecimentoService.js  Carga + filtros (ponto de troca p/ o banco)
  services/calculosService.js Cálculos (PME, ruptura, perda hoje, faixa, agregação, paginação)
  utils/cache.js              Cache em memória com TTL (memoTTL) p/ a carga do dataset
  data/mockData.js            Gerador simulado (porte do buildData do protótipo)
test/                         Testes (node:test)
docs/
  design_handoff_backend/     Handoff original de design (contrato + regras)
  screenshots/                Referências visuais do painel
```

## A API — contrato

`GET /api/abastecimento` devolve:

```json
{ "linhas": [ { "codsemDv": "79444", "produto": "...", "cd": 3, "...": "..." } ],
  "total": 112, "geradoEm": "2026-06-25T..." }
```

Cada **linha** representa **um produto × um Centro de Distribuição (CD)**. O
front-end consome `linhas` no ponto único `buildFromRows(rows)`; todo o
agrupamento, agregação, faixas e cálculo de perda já estão implementados no
cliente. A especificação completa dos campos e regras de negócio está em
[`docs/design_handoff_backend/README.md`](docs/design_handoff_backend/README.md).

### Filtros (opcionais, combináveis)

Todos via query string; ausentes = sem filtro (devolve tudo).

| Parâmetro | Exemplo | Tipo |
|-----------|---------|------|
| `produto`, `situacao`, `catN2`, `cat3` (ou `catN3`), `catN4`, `com`, `log`, `analista`, `comprador` | `?cat3=DIABETES,GASTRO` | multi-valor (separe por vírgula) |
| `cd` | `?cd=3` | CD único |
| `search` / `q` | `?q=mounjaro` | busca em `produto` + `codsemDv` |

### Endpoint calculado — `GET /api/abastecimento/resumo`

Para os casos em que se prefere o cálculo **no servidor** (estratégia
"Escalável" do handoff), este endpoint devolve os dados **já agregados**, com as
mesmas fórmulas do front-end portadas para `src/services/calculosService.js`:

- **PME (dias)** — média ponderada por `qtdMedia3m`, com base de demanda
  selecionável (`pmeBase=media3m|kardex30`) e a **faixa de cobertura**
  (`rup` < 20d · `faixa` 20–40d · `exc` > 40d).
- **Ruptura projetada (R$)** — agregada por soma.
- **Perda hoje (R$)** — derivada (`stkCd === 0 ? round((qtdMedia3m/30) × custo) : 0`)
  e agregada por soma.

Aceita **todos os filtros acima**, mais:

| Parâmetro | Exemplo | Descrição |
|-----------|---------|-----------|
| `pmeBase` | `?pmeBase=kardex30` | base de demanda do PME (padrão `media3m`) |
| `groupBy` | `?groupBy=cd` | agrupamento: `produto` (padrão), `cd` ou `total` |
| `sortKey` | `?sortKey=perdaHoje` | medida (ou `produto`/`codsemDv`/`cds`) de ordenação (padrão `ruptura`) |
| `sortDir` | `?sortDir=asc` | direção (padrão `desc`) |
| `pagina` | `?pagina=2` | página dos grupos, 1-based (padrão `1`) |
| `tamanhoPagina` | `?tamanhoPagina=50` | grupos por página; `0` ou `?todos=true` = sem paginação (padrão `50`) |
| `detalhe` | `?detalhe=true` | inclui as linhas (produto × CD) de cada grupo (padrão `false`) |

Resposta (por padrão **sem** as linhas de detalhe — só a contagem `qtdLinhas`):

```json
{ "pmeBase": "media3m", "groupBy": "produto",
  "grupos": [ { "key": "79444", "meta": { "...": "..." },
               "agg": { "ruptura": 94397, "perdaHoje": 15472, "pmeGeral": 15.2, "faixa": "rup", "...": "..." },
               "qtdLinhas": 6 } ],
  "totais": { "ruptura": 814265, "perdaHoje": 37948, "pmeGeral": 30, "faixa": "faixa", "...": "..." },
  "faixas": { "rup": 29, "faixa": 65, "exc": 18 },
  "total": 112, "totalGrupos": 18, "pagina": 1, "tamanhoPagina": 50, "totalPaginas": 1,
  "geradoEm": "2026-06-25T..." }
```

`totais` e `faixas` são sempre calculados sobre o **conjunto filtrado inteiro**,
não sobre a página. Use `?detalhe=true` (ou filtre por um `codsemDv`) quando
precisar abrir o detalhe por CD de um grupo.

### Escala & performance

O caminho quente foi preparado para volume de produção sem mudar o contrato:

- **Cache do dataset** (`src/utils/cache.js` · `memoTTL`): a "consulta" à fonte é
  feita uma vez por janela (`DADOS_CACHE_TTL_MS`, padrão 60s) e reaproveitada
  pelos requests seguintes. É o ponto exato onde o banco real entra
  (`consultarFonte()`), e `invalidarCache()` força recarga após escritas.
- **Derivados uma vez por carga**: `perdaHoje`/`catN3` são garantidos na carga,
  então filtros/agregações não re-clonam linha a linha.
- **Paginação dos grupos** e **payload enxuto** (detalhe opt-in) — resposta
  ~5× menor por padrão.
- **gzip** (`compression`) em todas as respostas.
- **Cache HTTP**: `Cache-Control: public, max-age=30` + `geradoEm` derivado do
  momento da carga (não do request), o que torna o **ETag estável** e devolve
  `304 Not Modified` em requisições idênticas.

## Próximos passos (back-end)

1. **Modelar** a tabela/consulta que produz a "linha" (produto × CD) com os
   campos do contrato.
2. **Substituir** `consultarFonte()` em `src/services/abastecimentoService.js`
   por uma consulta ao banco — o cache, os filtros e os cálculos não mudam.
3. ✅ **Cálculo no servidor** disponível em `GET /api/abastecimento/resumo`
   (`src/services/calculosService.js`): PME, ruptura, perda hoje, faixa,
   agrupamento, paginação e totais — com cache, gzip e cache HTTP (ver
   "Escala & performance"). Para volumes muito grandes, o próximo passo é
   empurrar filtros/agregação/paginação para a própria consulta SQL.
4. **Autenticação** e recorte de escopo por usuário (analista/comprador/CD).

O gerador simulado (`src/data/mockData.js`) pode ser removido quando o banco
estiver ligado.
