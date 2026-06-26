# Gestão de Abastecimento

Painel de gestão de abastecimento (ruptura projetada, cobertura de estoque / PME,
perda de vendas e gestão de SKUs por CD).

Este repositório é o **back-end** (Node.js + Express) que calcula e expõe a API
do painel. O **front-end será construído no Lovable** e consome esta API; a
**fonte de produção é o Databricks** (700k+ linhas), com todo o cálculo (PME,
ruptura, perda, faixa, agregação) **empurrado como SQL para o warehouse** —
escala sem trazer linha bruta para o Node.

- **Mock (dev):** sem variáveis do Databricks, a API roda com dados simulados
  determinísticos, com o mesmo contrato — útil para construir a UI no Lovable.
- **Databricks (produção):** com as variáveis configuradas (ver `.env.example`),
  a API calcula sobre a tabela real.

> 📦 **Para o Lovable + Databricks:** comece por
> [`docs/lovable_handoff/`](docs/lovable_handoff/) — arquitetura, contrato da
> API, setup do Databricks, as fórmulas pendentes e um **prompt pronto** para
> gerar a UI (`PROMPT_LOVABLE.md`).

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
  services/resumoService.js   Despacho de fonte: Databricks (produção) x mock (dev)
  services/abastecimentoService.js  Carga do mock + filtros + cache
  services/calculosService.js Cálculos do mock (PME, ruptura, perda, faixa, agregação)
  databricks/
    cliente.js                Cliente REST do Databricks SQL (Statement Execution API)
    contrato.js               SEAM de fórmulas: contrato -> SQL sobre as colunas brutas
    consulta.js               Construtor do SQL de agregação (roda no Databricks)
    fonte.js                  Orquestra as consultas e monta o resumo (mesmo contrato)
  utils/cache.js              Cache em memória com TTL (memoTTL) p/ a carga do mock
  data/mockData.js            Gerador simulado (porte do buildData do protótipo)
docs/
  lovable_handoff/            ► Handoff p/ o Lovable + Databricks (comece aqui)
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

- **Agregação no Databricks** (produção): filtros, derivação de PME/ruptura/
  perda, somas, médias ponderadas, faixa, agrupamento e paginação rodam **no
  SQL Warehouse** (`src/databricks/`). O Node só recebe a página de grupos + a
  linha de totais — nunca as 700k linhas brutas.
- **Cache do dataset do mock** (`src/utils/cache.js` · `memoTTL`): no modo dev,
  a carga é feita uma vez por janela (`DADOS_CACHE_TTL_MS`, padrão 60s).
- **Paginação dos grupos** e **payload enxuto** (detalhe opt-in) — resposta
  ~5× menor por padrão.
- **gzip** (`compression`) em todas as respostas.
- **Cache HTTP**: `Cache-Control: public, max-age=30` (+ ETag → `304` no mock).

## Próximos passos (back-end)

1. ✅ **Cálculo no servidor** em `GET /api/abastecimento/resumo`: PME, ruptura,
   perda hoje, faixa, agrupamento, paginação e totais. Em produção é empurrado
   como SQL para o Databricks (`src/databricks/`); no dev usa o mock.
2. **Plugar o Databricks**: configure as variáveis (`.env.example`) e ajuste o
   **seam de fórmulas** `src/databricks/contrato.js` aos nomes de coluna reais e
   às fórmulas de PME/ruptura/custo (dados brutos — ver handoff §4).
3. **Construir a UI no Lovable** com o `docs/lovable_handoff/PROMPT_LOVABLE.md`,
   apontando `VITE_API_URL` para o back-end publicado.
4. **Autenticação** e recorte de escopo por usuário (analista/comprador/CD).

O gerador simulado (`src/data/mockData.js`) e a camada de cálculo em JS
(`calculosService.js`) seguem como **fonte de referência das fórmulas** e
fallback de dev; podem ser removidos quando o Databricks for a única fonte.
