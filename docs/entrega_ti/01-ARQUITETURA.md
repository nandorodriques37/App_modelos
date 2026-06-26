# 1. Arquitetura e fluxo de dados

Este documento explica **como as peças se encaixam** e por que o sistema é
desenhado assim. Não é preciso conhecer o código para entender — os diagramas e a
descrição bastam.

---

## 1.1 Visão de alto nível

```
┌─────────────┐   HTTPS (fetch)   ┌──────────────────────────┐   SQL agregação   ┌──────────────┐
│  Front-end  │ ────────────────▶ │  Back-end (Node/Express) │ ────────────────▶ │  Databricks  │
│  (painel /  │                   │                          │                   │ SQL Warehouse│
│   Lovable)  │ ◀──────────────── │  contrato + fórmulas     │ ◀──────────────── │ (tabela bruta│
└─────────────┘   JSON agregado   └──────────────────────────┘  resultado pequeno│   700k linhas)│
                                                                                  └──────────────┘
```

Três camadas:

1. **Front-end (painel)** — consome a API por HTTP e desenha a tela. **Não
   calcula nada de negócio**; recebe tudo pronto.
2. **Back-end (esta aplicação)** — recebe os filtros, **gera o SQL com as
   fórmulas** e o executa no Databricks. Devolve **apenas o resultado já
   agregado** (a página de grupos + a linha de totais) para o front-end.
3. **Databricks (SQL Warehouse)** — onde fica a **tabela bruta** (estoque/venda) e
   onde **o cálculo pesado roda** (derivação de PME/ruptura/perda + somas + médias
   ponderadas + faixa + agrupamento + paginação).

> **Princípio central:** as 700k+ linhas brutas **nunca** saem do Databricks. O
> back-end só recebe de volta o pedacinho que a tela precisa mostrar. Isso é o que
> faz o sistema escalar.

---

## 1.2 Os dois modos: Mock × Databricks

A aplicação **detecta sozinha** em qual modo rodar, olhando as variáveis de
ambiente. **O contrato da API é idêntico nos dois** — o front-end não sabe (nem
precisa saber) qual fonte respondeu.

```
                         ┌─────────────────────────────────────────┐
   request HTTP  ───────▶│  resumoService.js  (decide a fonte)      │
                         └───────────────┬──────────────┬──────────┘
                  Variáveis do Databricks │              │ Sem as variáveis
                       configuradas?  SIM │              │ NÃO
                                          ▼              ▼
                          ┌────────────────────┐  ┌────────────────────────┐
                          │ Databricks (SQL)   │  │ Mock (JS em memória)   │
                          │ src/databricks/*   │  │ calculosService.js +   │
                          │                    │  │ mockData.js            │
                          └────────────────────┘  └────────────────────────┘
                                          │              │
                                          └──────┬───────┘
                                                 ▼
                                    Mesma estrutura JSON de resposta
```

| | **Mock** | **Databricks** |
|---|----------|----------------|
| **Quando** | Variáveis do Databricks ausentes | Variáveis configuradas |
| **Dados** | Gerados em memória (`mockData.js`), determinísticos | Tabela real no warehouse |
| **Onde calcula** | JavaScript no Node (`calculosService.js`) | SQL no Databricks (`consulta.js` + `contrato.js`) |
| **Escala** | Dezenas/centenas de linhas | 700k+ linhas |
| **Uso** | Demonstração, dev da UI, testes | **Produção** |

O "interruptor" é a função `estaConfigurado()` em `src/databricks/cliente.js`:
basta `DATABRICKS_HOST` + `DATABRICKS_TOKEN` + `DATABRICKS_WAREHOUSE_ID` estarem
presentes para a aplicação usar o Databricks.

---

## 1.3 A granularidade do dado: a "linha"

A unidade básica é **uma linha = um produto em um CD** (produto × Centro de
Distribuição). Tudo parte daí:

```
produto 79444 (MOUNJARO) × CD 1  ─┐
produto 79444 (MOUNJARO) × CD 3  ─┤── agrupado por PRODUTO ──▶ 1 card "MOUNJARO"
produto 79444 (MOUNJARO) × CD 7  ─┘                            (soma/média dos 3 CDs)
```

A partir das linhas, o sistema **agrupa** de três formas (definidas pela tela):

- `groupBy=produto` (padrão) — um grupo por produto, detalhe por CD.
- `groupBy=cd` — um grupo por CD, somando todos os produtos daquele CD.
- `groupBy=total` — um único grupo (total geral).

E **agrega** cada grupo (soma ou média ponderada, conforme a medida — ver
[`02-FORMULAS.md`](02-FORMULAS.md)).

---

## 1.4 Caminho de um request (produção)

Exemplo: o painel pede o resumo dos produtos de DIABETES, agrupado por produto.

```
1. Front-end:  GET /api/abastecimento/resumo?cat3=DIABETES&groupBy=produto
                         │
2. routes/abastecimento.js  → chama resumoService.obterResumo(query)
                         │
3. resumoService.js  → vê que o Databricks está configurado → databricks.resumir(opts)
                         │
4. databricks/fonte.js  → monta 2 consultas (grupos + totais) com consulta.js
                         │   (as fórmulas vêm do contrato.js)
                         │
5. databricks/cliente.js  → executa o SQL no SQL Warehouse via REST, faz polling
                         │   até concluir, devolve as linhas (resultado pequeno)
                         │
6. databricks/fonte.js  → monta o JSON do resumo (grupos, totais, faixas, paginação)
                         │
7. routes  → responde { ...resumo, "fonte": "databricks", "geradoEm": "..." }
```

No **modo mock**, os passos 3–6 viram: filtra o dataset em memória → `calculosService.resumir()`.
**A resposta tem o mesmo formato.**

---

## 1.5 Por que o cálculo é "empurrado" para o SQL

Duas alternativas foram consideradas:

- ❌ **Trazer as 700k linhas para o Node e calcular em JS** — não escala (memória,
  rede, latência).
- ✅ **Gerar SQL que faz a derivação + agregação no Databricks** — o engine do
  warehouse é feito exatamente para isso; o Node só recebe o resultado final.

Por isso as fórmulas existem **duas vezes**:

- `calculosService.js` (JavaScript) — referência legível + modo mock/testes.
- `contrato.js` + `consulta.js` (SQL) — o que roda em produção.

As **listas de colunas** (o que soma, o que é média ponderada, o que é PME) são
**importadas do `calculosService.js` pelo `consulta.js`**, para que os dois lados
**nunca divirjam** sobre *como* agregar. O que pode (e deve) ser ajustado pela TI
é **a fórmula de cada medida** dentro do `contrato.js` — ver
[`02-FORMULAS.md`](02-FORMULAS.md) e [`03-MIGRACAO-PARA-API-DATABRICKS.md`](03-MIGRACAO-PARA-API-DATABRICKS.md).

---

## 1.6 Deploy

- O back-end já está pronto para **Vercel** (`vercel.json` + `api/index.js`), mas
  é um app Express comum — roda em qualquer lugar com Node 18+ (container, VM, etc.).
- As variáveis do Databricks são definidas no ambiente de deploy (não no código).
- Em produção, restrinja `CORS_ORIGIN` ao domínio do front-end.

Detalhes de deploy em [`03-MIGRACAO-PARA-API-DATABRICKS.md`](03-MIGRACAO-PARA-API-DATABRICKS.md) (§5).
