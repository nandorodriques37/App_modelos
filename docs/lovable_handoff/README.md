# Handoff Lovable — Painel de Gestão de Abastecimento

Pacote para **construir o front-end no Lovable** e **conectar a fonte real
(Databricks, 700k+ linhas)**. O cálculo (PME, ruptura, perda, faixa, agregação)
fica **100% no back-end desta aplicação**, que empurra a agregação como SQL para
o Databricks. O Lovable apenas consome a API e desenha a UI.

> Para colar direto no Lovable e gerar a tela, use **`PROMPT_LOVABLE.md`** (ao
> lado deste arquivo). Este README é a referência técnica completa.

---

## 1. Arquitetura

```
┌─────────────┐   fetch (HTTPS)   ┌──────────────────────────┐   SQL (agregação)   ┌──────────────┐
│   Lovable   │ ────────────────▶ │  Back-end (Node/Express) │ ──────────────────▶ │  Databricks  │
│  (React UI) │ ◀──────────────── │  cálculo + contrato API  │ ◀────────────────── │ SQL Warehouse│
└─────────────┘   JSON agregado   └──────────────────────────┘   resultado pequeno  └──────────────┘
```

- **Lovable** chama a API do back-end via `fetch` (não usa o conector de banco
  para isto — o conector dele é Postgres e não fala Databricks).
- **Back-end** recebe filtros/opções, gera o SQL de agregação (com as fórmulas
  de negócio) e o executa no **Databricks SQL Warehouse**. Volta para o Node
  apenas o resultado já agregado (a página de grupos + a linha de totais) —
  **nunca as 700k linhas brutas**.
- Escala: filtros, derivação de PME/ruptura/perda, somas, médias ponderadas,
  faixa, agrupamento e paginação rodam no Databricks (engine feita para isso).

Por que não o conector de banco do Lovable direto no Databricks: o conector lê
Postgres; Databricks não é Postgres-wire. E a regra de negócio (fórmulas, PME
ponderado, faixa, toggle Kardex) precisa de um lugar para rodar a cada filtro —
esse lugar é o back-end.

---

## 2. Contrato da API (o que o Lovable consome)

Base URL = a URL pública do back-end (ex.: deploy na Vercel). Configurável no
Lovable como variável (ex.: `VITE_API_URL`).

### `GET /api/abastecimento/resumo` — endpoint principal do painel

Devolve tudo já calculado e agrupado. **Filtros** (todos opcionais, combináveis,
multi-valor separado por vírgula):

| Param | Ex. | Descrição |
|-------|-----|-----------|
| `produto`, `situacao`, `catN2`, `cat3` (ou `catN3`), `catN4`, `com`, `log`, `analista`, `comprador` | `?cat3=DIABETES,GASTRO` | multi-seleção |
| `cd` | `?cd=3` | CD único |
| `search` / `q` | `?q=mounjaro` | busca em produto + código |
| `pmeBase` | `?pmeBase=kardex30` | base de demanda do PME: `media3m` (padrão) ou `kardex30` |
| `groupBy` | `?groupBy=cd` | `produto` (padrão), `cd` ou `total` |
| `sortKey` | `?sortKey=perdaHoje` | medida ou `produto`/`codsemDv`/`cds` (padrão `ruptura`) |
| `sortDir` | `?sortDir=asc` | `asc`/`desc` (padrão `desc`) |
| `pagina` | `?pagina=2` | página dos grupos, 1-based |
| `tamanhoPagina` | `?tamanhoPagina=50` | grupos por página (`0`/`?todos=true` = tudo) |
| `detalhe` | `?detalhe=true` | inclui as linhas (produto × CD) dentro de cada grupo |

**Resposta:**

```jsonc
{
  "pmeBase": "media3m",
  "groupBy": "produto",
  "grupos": [
    {
      "key": "79444",
      "meta": { "codsemDv": "79444", "produto": "MOUNJARO 5MG C/4 SERINGAS",
                "cd": null, "catN2": "MEDICAMENTOS", "cat3": "DIABETES",
                "catN3": "DIABETES", "catN4": "ANÁLOGOS GLP-1", "situacao": "Ativo",
                "com": "LILLY MOUNJARO", "log": "LOG FRIO SP",
                "analista": "DANIELY SIPRIANO", "comprador": "Bianca Mota" },
      "agg": { "qtdMedia3m": 13808, "vendaKardex30": 14123, "eo": 540, "stkCd": 0,
               "nna": 120, "trasNsf": 0, "pend": 900, "ea": 1800, "stkLoja": 430,
               "pmeCd": 12.4, "pmeNna": 4, "pmePend": 8, "pmeCdPend": 20,
               "pmeLoja": 18, "pmeGeral": 15.2, "pmeGeralPend": 23, "leadTime": 21,
               "perdaHoje": 15472, "ruptura": 94397, "faixa": "rup" },
      "qtdLinhas": 6
    }
  ],
  "totais": { "ruptura": 814265, "perdaHoje": 37948, "pmeGeral": 30, "faixa": "faixa", "...": "..." },
  "faixas": { "rup": 29, "faixa": 65, "exc": 18 },
  "total": 112, "totalGrupos": 18,
  "pagina": 1, "tamanhoPagina": 50, "totalPaginas": 1,
  "fonte": "databricks", "geradoEm": "2026-06-26T..."
}
```

Regras embutidas na resposta (o front **não recalcula**):
- **Faixa de cobertura** (`agg.faixa` / `totais.faixa`): `rup` (<20d) · `faixa`
  (20–40d) · `exc` (>40d), a partir do `pmeGeral`.
- **PME** = média ponderada por `qtdMedia3m`. `totais`/`faixas` consideram o
  conjunto filtrado inteiro, não só a página.
- **Perda hoje** e **ruptura projetada** já vêm somadas (R$).

### `GET /api/abastecimento` — linhas (produto × CD)

Para detalhe/expansão. Com Databricks é **sempre paginada** (use `pagina`,
`tamanhoPagina`; teto padrão de 200). Mesmos filtros do resumo.

### `GET /health` — healthcheck.

### Exemplo de chamada (cliente do Lovable)

```ts
const API = import.meta.env.VITE_API_URL; // ex.: https://seu-backend.vercel.app
async function carregarResumo(params: Record<string,string>) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API}/api/abastecimento/resumo?${qs}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}
// carregarResumo({ cat3: 'DIABETES,GASTRO', groupBy: 'produto', pmeBase: 'kardex30', tamanhoPagina: '50' })
```

---

## 3. Conectar o Databricks (back-end)

1. Crie um **SQL Warehouse** no Databricks e gere um **token** de acesso.
2. Garanta a tabela bruta (produto × CD) com as colunas de estoque/venda.
3. Defina as variáveis no deploy do back-end (ver `.env.example`):
   `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `DATABRICKS_WAREHOUSE_ID`,
   `DATABRICKS_CATALOG`, `DATABRICKS_SCHEMA`, `DATABRICKS_TABLE`.
4. Ajuste **`src/databricks/contrato.js`**:
   - `COLUNAS_IDENTIDADE` e `COLUNAS_BRUTAS` → nomes reais das colunas;
   - `EXPRESSOES` e `EXPR_PERDA_HOJE` → **as fórmulas reais** (ver §4).

Sem essas variáveis, o back-end roda no **mock determinístico** (dev/preview),
com o mesmo contrato — útil para o Lovable já construir a UI antes do banco.

---

## 4. ⚠️ Pendente: fórmulas de negócio (dados são brutos)

A fonte tem **dados brutos** (estoque/venda); PME, ruptura e custo são
**derivados**. As expressões SQL vivem em **um único arquivo**:
`src/databricks/contrato.js` → `EXPRESSOES`. Hoje contêm **placeholders** de
cobertura padrão; substitua pelas regras oficiais.

Preencha esta tabela e me envie (ou edite direto o `contrato.js`):

| Campo | Como calcular a partir do bruto |
|-------|----------------------------------|
| `custo` | _(coluna bruta? ou fórmula?)_ |
| `pmeCd` | _(ex.: STK_CD ÷ demanda diária)_ |
| `pmeNna` | |
| `pmePend` | |
| `pmeCdPend` | |
| `pmeLoja` | |
| `pmeGeral` | _(define a faixa)_ |
| `pmeGeralPend` | |
| `leadTime` | |
| `ruptura` | _(valor R$ projetado de ruptura)_ |

`perdaHoje` já está definido pelo contrato: `stkCd==0 ? round((qtdMedia3m/30)*custo) : 0`.

Enquanto não chegam, a pipeline e a UI funcionam com os placeholders + mock.

---

## 5. Deploy & CORS

- O back-end já está pronto para **Vercel** (`vercel.json`, `api/index.js`).
  Configure as variáveis do Databricks no projeto da Vercel.
- Em produção, restrinja `CORS_ORIGIN` ao domínio do app no Lovable
  (ex.: `https://seu-app.lovable.app`).
- O front-end no Lovable aponta para a base URL via `VITE_API_URL`.

---

## 6. Referência de design

O visual final (cards de ruptura/perda, saúde da cobertura por faixa, tabela com
colunas de PME, filtros, toggle de base do PME) está em
[`../design_handoff_backend/`](../design_handoff_backend/) (protótipo `.dc.html`)
e nos screenshots em [`../screenshots/`](../screenshots/). O `PROMPT_LOVABLE.md`
resume isso para o Lovable recriar a UI fielmente.
