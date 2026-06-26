# 4. Referência da API (contrato)

A API tem **dois endpoints de dados** + um de health. O contrato é **o mesmo** nos
modos mock e Databricks — só muda o campo `fonte` na resposta.

Base URL = a URL pública do back-end (ex.: deploy na Vercel) ou
`http://localhost:3000` em dev.

---

## 4.1 `GET /api/abastecimento/resumo` — endpoint principal

Devolve os dados **já calculados e agrupados** (é o que o painel consome). O
front-end **não recalcula** nada.

### Parâmetros (query string, todos opcionais e combináveis)

| Parâmetro | Exemplo | Descrição |
|-----------|---------|-----------|
| `produto`, `situacao`, `catN2`, `cat3` (ou `catN3`), `catN4`, `com`, `log`, `analista`, `comprador` | `?cat3=DIABETES,GASTRO` | filtro multi-valor (separe por vírgula) |
| `cd` | `?cd=3` | CD único |
| `search` / `q` | `?q=mounjaro` | busca textual em `produto` + `codsemDv` |
| `pmeBase` | `?pmeBase=kardex30` | base de demanda do PME: `media3m` (padrão) ou `kardex30` |
| `groupBy` | `?groupBy=cd` | agrupamento: `produto` (padrão), `cd` ou `total` |
| `sortKey` | `?sortKey=perdaHoje` | medida (ou `produto`/`codsemDv`/`cds`) de ordenação (padrão `ruptura`) |
| `sortDir` | `?sortDir=asc` | direção: `asc` ou `desc` (padrão `desc`) |
| `pagina` | `?pagina=2` | página dos grupos, 1-based (padrão `1`) |
| `tamanhoPagina` | `?tamanhoPagina=50` | grupos por página; `0` ou `?todos=true` = sem paginação (padrão `50`) |
| `detalhe` | `?detalhe=true` | inclui as linhas (produto × CD) de cada grupo (padrão `false`) |

### Resposta

```jsonc
{
  "pmeBase": "media3m",
  "groupBy": "produto",
  "grupos": [
    {
      "key": "79444",
      "meta": {
        "codsemDv": "79444", "produto": "MOUNJARO 5MG C/4 SERINGAS",
        "cd": null, "catN2": "MEDICAMENTOS", "cat3": "DIABETES", "catN3": "DIABETES",
        "catN4": "ANÁLOGOS GLP-1", "situacao": "Ativo", "com": "LILLY MOUNJARO",
        "log": "LOG FRIO SP", "analista": "DANIELY SIPRIANO", "comprador": "Bianca Mota"
      },
      "agg": {
        "qtdMedia3m": 13808, "vendaKardex30": 14123, "eo": 540, "stkCd": 0,
        "nna": 120, "trasNsf": 0, "pend": 900, "ea": 1800, "stkLoja": 430,
        "pmeCd": 12.4, "pmeNna": 4, "pmePend": 8, "pmeCdPend": 20, "pmeLoja": 18,
        "pmeGeral": 15.2, "pmeGeralPend": 23, "leadTime": 21,
        "perdaHoje": 15472, "ruptura": 94397, "faixa": "rup"
      },
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

### Campos da resposta

| Campo | Descrição |
|-------|-----------|
| `pmeBase`, `groupBy` | ecoam os parâmetros aplicados |
| `grupos[]` | a página de grupos (cada um com `key`, `meta`, `agg`, `qtdLinhas`, e `cd` quando `groupBy=cd`) |
| `grupos[].meta` | identidade do grupo (dimensões) |
| `grupos[].agg` | medidas agregadas + `faixa` |
| `grupos[].qtdLinhas` | quantas linhas (produto × CD) o grupo contém |
| `grupos[].linhas` | só presente com `?detalhe=true` |
| `totais` | medidas agregadas do **conjunto filtrado inteiro** (não só a página) |
| `faixas` | contagem de linhas por faixa (`rup`/`faixa`/`exc`) no conjunto inteiro |
| `total` | total de linhas filtradas |
| `totalGrupos`, `pagina`, `tamanhoPagina`, `totalPaginas` | paginação dos grupos |
| `fonte` | `"databricks"` ou `"mock"` |
| `geradoEm` | timestamp ISO da resposta |

> ⚠️ `totais` e `faixas` são **sempre** sobre o conjunto filtrado **inteiro**, não
> sobre a página atual.

---

## 4.2 `GET /api/abastecimento` — linhas (produto × CD)

Para detalhe/expansão. Devolve `{ linhas: [...], total, fonte, geradoEm }`. Aceita
os mesmos filtros do resumo.

> Com Databricks é **sempre paginada** (teto padrão de 200 linhas) — nunca despeja
> as 700k. Use `pagina` e `tamanhoPagina`.

```jsonc
{
  "linhas": [
    { "codsemDv": "79444", "produto": "MOUNJARO 5MG C/4 SERINGAS", "cd": 3,
      "catN2": "MEDICAMENTOS", "cat3": "DIABETES", "catN3": "DIABETES", "...": "...",
      "qtdMedia3m": 13808, "stkCd": 0, "pmeGeral": 15, "ruptura": 136000, "perdaHoje": 14750 }
  ],
  "total": 112, "fonte": "databricks", "geradoEm": "2026-06-26T..."
}
```

A especificação completa de **cada campo da linha** (dimensões + medidas) está em
[`../design_handoff_backend/README.md`](../design_handoff_backend/README.md).

---

## 4.3 `GET /health` — healthcheck

Resposta simples para liveness/readiness do deploy.

---

## 4.4 Dicionário de campos (resumido)

### Dimensões (identidade)

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `codsemDv` | string | código do produto sem dígito verificador (chave do produto) |
| `produto` | string | descrição do produto |
| `cd` | number | número do Centro de Distribuição |
| `catN2` | string | categoria nível 2 (ex.: MEDICAMENTOS) |
| `cat3`/`catN3` | string | categoria nível 3 (ex.: DIABETES) — os dois nomes são aceitos |
| `catN4` | string | categoria nível 4 (subcategoria) |
| `situacao` | string | situação do produto (Ativo, Sazonal, ...) |
| `com` | string | fornecedor comercial |
| `log` | string | fornecedor logístico |
| `analista` | string | analista responsável |
| `comprador` | string | comprador responsável |

### Medidas (ver fórmulas em [`02-FORMULAS.md`](02-FORMULAS.md))

| Campo | Unidade | Agrega por |
|-------|---------|-----------|
| `qtdMedia3m` | unidades | soma (e é o **peso** das médias ponderadas) |
| `vendaKardex30` | unidades | soma |
| `eo`, `stkCd`, `nna`, `trasNsf`, `pend`, `ea`, `stkLoja` | unidades | soma |
| `custo` | R$ | (usado nas fórmulas) |
| `ruptura` | R$ | soma |
| `perdaHoje` | R$ | soma (derivada) |
| `pmeCd`, `pmeNna`, `pmePend`, `pmeCdPend`, `pmeLoja`, `pmeGeral`, `pmeGeralPend`, `leadTime` | dias | média ponderada |
| `faixa` | categoria | recalculada de `pmeGeral` (`rup`/`faixa`/`exc`) |

---

## 4.5 Exemplos de chamada

```bash
# Resumo dos produtos de DIABETES e GASTRO, agrupado por produto, base Kardex 30d:
curl "$API/api/abastecimento/resumo?cat3=DIABETES,GASTRO&groupBy=produto&pmeBase=kardex30"

# Total geral (uma linha) de um CD específico:
curl "$API/api/abastecimento/resumo?cd=3&groupBy=total"

# Top 10 grupos por perda de hoje:
curl "$API/api/abastecimento/resumo?sortKey=perdaHoje&sortDir=desc&tamanhoPagina=10"

# Detalhe por CD de um produto:
curl "$API/api/abastecimento/resumo?q=mounjaro&detalhe=true"
```

```ts
// Cliente típico (front-end)
const API = import.meta.env.VITE_API_URL;
async function carregarResumo(params: Record<string,string>) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API}/api/abastecimento/resumo?${qs}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}
```
