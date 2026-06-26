# 3. Migração: do mock para a API real (Databricks)

Guia **passo a passo** para virar a chave do modo de demonstração (mock) para a
fonte de produção (Databricks). Todo o cálculo já está implementado — esta
migração é, em essência, **configurar o acesso + mapear colunas + confirmar
fórmulas**.

> **Tempo estimado:** algumas horas, sendo a maior parte **coletar as fórmulas
> oficiais com o negócio** (não é trabalho de código). O código a editar está
> concentrado em **um arquivo**: `src/databricks/contrato.js`.

---

## Visão geral dos passos

```
PASSO 1  Provisionar o Databricks e gerar credenciais
PASSO 2  Configurar as variáveis de ambiente
PASSO 3  Mapear as colunas reais da tabela bruta
PASSO 4  Confirmar / preencher as fórmulas oficiais
PASSO 5  Testar (mock → Databricks) e validar os números
PASSO 6  Deploy + CORS
```

---

## PASSO 1 — Provisionar o Databricks

1. Garanta (ou crie) um **SQL Warehouse** no workspace do Databricks.
   - Anote o **Warehouse ID** (aparece na URL/painel do warehouse).
2. Garanta a **tabela bruta** com granularidade **produto × CD**, contendo as
   colunas de estoque/venda. Anote `catalog.schema.tabela`.
3. Gere um **token de acesso** (Personal Access Token ou OAuth) com permissão de
   leitura na tabela e uso do warehouse.
   - ⚠️ O token é **secreto**: nunca comitar no Git; só nas variáveis do deploy.
4. Anote o **host** do workspace, **sem** `https://`
   (ex.: `dbc-xxxxxxxx-xxxx.cloud.databricks.com`).

---

## PASSO 2 — Configurar as variáveis de ambiente

Copie `.env.example` para `.env` (local) ou configure no painel do deploy
(Vercel/container). As variáveis:

| Variável | Obrigatória | Exemplo / padrão | O que é |
|----------|:-----------:|------------------|---------|
| `DATABRICKS_HOST` | ✅ | `dbc-xxxx.cloud.databricks.com` | host do workspace, sem `https://` |
| `DATABRICKS_TOKEN` | ✅ | `dapi...` (**secreto**) | token de acesso |
| `DATABRICKS_WAREHOUSE_ID` | ✅ | `abc123...` | ID do SQL Warehouse |
| `DATABRICKS_CATALOG` | ⚪ | `main` | catálogo da tabela |
| `DATABRICKS_SCHEMA` | ⚪ | `abastecimento` | schema da tabela |
| `DATABRICKS_TABLE` | ⚪ | `linhas_brutas` | nome da tabela bruta |
| `DATABRICKS_TIMEOUT_MS` | ⚪ | `60000` | timeout por consulta (ms) |
| `CORS_ORIGIN` | ⚪ | `*` → restringir em prod | domínio liberado p/ o front-end |
| `PORT` | ⚪ | `3000` | porta do servidor |

> **A regra do interruptor:** basta `DATABRICKS_HOST` + `DATABRICKS_TOKEN` +
> `DATABRICKS_WAREHOUSE_ID` estarem presentes para a aplicação **deixar o mock e
> usar o Databricks**. Sem isso, ela continua no mock.

---

## PASSO 3 — Mapear as colunas reais

Abra **`src/databricks/contrato.js`** e ajuste os **dois dicionários** que
traduzem "nome no contrato" → "coluna real no Databricks".

### 3.1 Dimensões (identidade)

```js
const COLUNAS_IDENTIDADE = {
  codsemDv: 'codsem_dv',   // ◀── troque o lado DIREITO pelo nome real da coluna
  produto:  'produto',
  cd:       'cd',
  catN2:    'cat_n2',
  cat3:     'cat3',
  catN4:    'cat_n4',
  situacao: 'situacao',
  com:      'com',
  log:      'log',
  analista: 'analista',
  comprador:'comprador'
};
```

### 3.2 Medidas brutas (estoque/venda)

```js
const COLUNAS_BRUTAS = {
  qtdMedia3m:    'qtd_media_3m',   // ◀── troque pelo nome real
  vendaKardex30: 'venda_kardex_30',
  eo:            'eo',
  stkCd:         'stk_cd',
  nna:           'nna',
  trasNsf:       'tras_nsf',
  pend:          'pend',
  ea:            'ea',
  stkLoja:       'stk_loja',
  custo:         'custo'          // ⚠️ confirmar (coluna ou derivado — ver §4)
};
```

> **Só o lado direito muda.** O lado esquerdo (camelCase) é o nome do contrato que
> o front-end consome — **não alterar**, senão o payload muda.

---

## PASSO 4 — Confirmar / preencher as fórmulas oficiais

Ainda em **`src/databricks/contrato.js`**, no objeto `EXPRESSOES`. Hoje há
**placeholders** (ver [`02-FORMULAS.md`](02-FORMULAS.md)). Substitua pelas regras
oficiais coletadas no [`TEMPLATE-FORMULAS.md`](TEMPLATE-FORMULAS.md).

O que precisa virar fórmula oficial:

- [ ] `custo` — coluna bruta ou derivada?
- [ ] `pmeCd`, `pmeNna`, `pmePend`, `pmeCdPend`, `pmeLoja`, **`pmeGeral`**, `pmeGeralPend`
- [ ] `leadTime`
- [ ] `ruptura` (valor R$ projetado)

> `perdaHoje` (`EXPR_PERDA_HOJE`) **já é a fórmula oficial** — só depende de `custo`
> estar correto.

### Regras ao escrever as expressões

- Cada valor é uma **expressão Spark SQL válida**, usando os nomes de
  `COLUNAS_BRUTAS` (ex.: `stk_cd`, `qtd_media_3m`).
- Proteja divisões com `NULLIF(denominador, 0)` e envolva com `COALESCE(..., 0)`
  para nunca devolver `NULL`.
- **Não** precisa colar `AS apelido` — o construtor (`consulta.js`) cuida do alias.
- Mantenha a **mesma semântica** da versão JS (`calculosService.js`). Se a regra
  mudar de fato, alinhe os dois lados (ver §4 da [`02-FORMULAS.md`](02-FORMULAS.md)).

### Exemplo (antes → depois)

```js
// ANTES (placeholder)
pmeGeral: `COALESCE((stk_cd + stk_loja) / (NULLIF(qtd_media_3m,0)/30.0), 0)`,

// DEPOIS (exemplo de fórmula oficial hipotética)
pmeGeral: `COALESCE((stk_cd + stk_loja + em_transito) / (venda_diaria_ajustada), 0)`,
```

---

## PASSO 5 — Testar e validar

### 5.1 Sem o Databricks (sanidade do código)

```bash
npm install
npm test       # a suíte cobre fórmulas, contrato, geração do SQL e despacho de fonte
npm start      # sobe em modo mock
curl http://localhost:3000/api/abastecimento/resumo | head
# espere "fonte":"mock"
```

### 5.2 Com o Databricks (validação real)

1. Defina as variáveis (PASSO 2) no `.env`.
2. Suba a app e chame o resumo:

```bash
npm start
curl "http://localhost:3000/api/abastecimento/resumo?groupBy=total"
# espere "fonte":"databricks"
```

3. **Validação de números** — compare alguns grupos com a referência do negócio:
   - Pegue um produto conhecido: `?produto=MOUNJARO 5MG C/4 SERINGAS&detalhe=true`.
   - Confira `pmeGeral`, `ruptura`, `perdaHoje`, `faixa` contra o esperado.
   - Teste o toggle: `?pmeBase=kardex30` deve mudar os PME conforme o fator.

### 5.3 Diagnóstico rápido

| Sintoma | Provável causa |
|---------|----------------|
| Resposta com `"fonte":"mock"` mesmo com env setado | Falta uma das 3 vars obrigatórias; confira nomes |
| `Databricks HTTP 401/403` | Token inválido / sem permissão na tabela ou warehouse |
| `Databricks HTTP 404` | Host errado, ou catálogo/schema/tabela incorretos |
| `timeout aguardando o statement` | Warehouse frio/parado, ou consulta pesada → suba `DATABRICKS_TIMEOUT_MS` ou o tamanho do warehouse |
| Erro de coluna inexistente | Nome em `COLUNAS_*` não bate com a tabela real (PASSO 3) |
| Números estranhos | Fórmula placeholder ainda ativa (PASSO 4) |

> Os erros do Databricks são propagados com contexto (`submit`/`poll`) pelo
> cliente REST — a mensagem HTTP costuma apontar a causa exata.

---

## PASSO 6 — Deploy + CORS

- O back-end já tem `vercel.json` + `api/index.js` (Serverless Function). Também
  roda em qualquer host com **Node 18+**.
- Configure as **mesmas variáveis** (PASSO 2) no ambiente de deploy.
- Em produção, **restrinja `CORS_ORIGIN`** ao domínio do front-end (ex.:
  `https://seu-app.lovable.app`) — não deixe `*`.
- O front-end aponta para a base URL da API (no protótipo,
  `window.ABASTECIMENTO_API_URL`; no Lovable, `VITE_API_URL`).

---

## Depois da migração

Quando o Databricks for a única fonte, o **mock** (`src/data/mockData.js`) e a
camada de cálculo em JS (`calculosService.js`) podem ser mantidos como
**referência/testes** ou removidos. Recomendação: **manter** — `calculosService.js`
é a documentação executável das fórmulas e a base dos testes; remover só o
`mockData.js` se quiser.

➡️ Use o [`05-CHECKLIST-E-FAQ.md`](05-CHECKLIST-E-FAQ.md) para acompanhar a entrega.
