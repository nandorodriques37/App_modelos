# 2. As fórmulas — referência completa

Este é o documento central da entrega. Ele descreve **todas as regras de cálculo**
do painel: o que cada medida significa, como é calculada **por linha** (produto ×
CD) e como é **agregada** num grupo.

Cada fórmula aparece em **duas formas equivalentes**:

- 🟦 **Referência (JavaScript)** — em `src/services/calculosService.js`. É a
  "fonte da verdade" legível e o que roda no modo mock.
- 🟩 **Produção (SQL/Spark)** — em `src/databricks/contrato.js` e
  `src/databricks/consulta.js`. É o que roda no Databricks.

> ⚠️ **Atenção, TI:** as fórmulas de **PME** e **ruptura** na versão SQL são hoje
> **placeholders** (provisórias). Elas mantêm o sistema rodável, mas **não são as
> regras oficiais de negócio**. Onde isso aparece está marcado com 🔴 **PLACEHOLDER**.
> Use o [`TEMPLATE-FORMULAS.md`](TEMPLATE-FORMULAS.md) para coletar as fórmulas
> reais e troque-as **só no `contrato.js`**.

---

## 2.0 Mapa rápido das medidas

| Medida | Unidade | Tipo de cálculo | Agregação no grupo | Fórmula oficial definida? |
|--------|---------|-----------------|--------------------|---------------------------|
| `qtdMedia3m` | unidades | bruto (da fonte) | **soma** | ✅ vem do bruto |
| `vendaKardex30` | unidades | bruto | **soma** | ✅ vem do bruto |
| `eo`, `stkCd`, `nna`, `trasNsf`, `pend`, `ea`, `stkLoja` | unidades | bruto | **soma** | ✅ vem do bruto |
| `custo` | R$ | bruto ou derivado | (usado nas fórmulas) | ⚠️ **confirmar** |
| `pmeCd`, `pmeNna`, `pmePend`, `pmeCdPend`, `pmeLoja`, `pmeGeral`, `pmeGeralPend` | dias | derivado | **média ponderada** | 🔴 **PLACEHOLDER** |
| `leadTime` | dias | bruto/derivado | **média ponderada** | 🔴 **PLACEHOLDER** |
| `ruptura` | R$ | derivado | **soma** | 🔴 **PLACEHOLDER** |
| `perdaHoje` | R$ | derivado | **soma** | ✅ definida pelo contrato |
| `faixa` | categoria | derivada de `pmeGeral` | recalculada no agregado | ✅ definida |

As listas que dizem **o que soma** e **o que é média ponderada** estão no topo de
`calculosService.js` e são **importadas** pelo SQL, garantindo que os dois lados
nunca divirjam:

```js
// src/services/calculosService.js
const COLS_SOMA = ['qtdMedia3m','vendaKardex30','eo','stkCd','nna','trasNsf',
                   'pend','ea','stkLoja','perdaHoje','ruptura'];          // → SOMA
const COLS_WAVG = ['pmeCd','pmeNna','pmePend','pmeCdPend','pmeLoja',
                   'pmeGeral','pmeGeralPend','leadTime'];                  // → MÉDIA PONDERADA
const COLS_PME  = ['pmeCd','pmeNna','pmePend','pmeCdPend','pmeLoja',
                   'pmeGeral','pmeGeralPend'];   // recalculadas quando base = kardex30
```

---

## 2.1 PME — cobertura de estoque (em dias)

**O que é:** quantos **dias** o estoque cobre a demanda. É a medida central do
painel. Existem variações conforme *qual estoque* entra na conta:

| Campo | Significado |
|-------|-------------|
| `pmeCd` | cobertura considerando só o estoque do CD |
| `pmeNna` | cobertura ligada a itens não negociáveis/não atendidos |
| `pmePend` | cobertura considerando pedidos pendentes |
| `pmeCdPend` | cobertura do CD + pendências |
| `pmeLoja` | cobertura do estoque nas lojas |
| `pmeGeral` | **cobertura geral — é a que define a FAIXA** |
| `pmeGeralPend` | cobertura geral + pendências |
| `leadTime` | tempo de reposição (dias) |

### 🟩 Produção (SQL) — 🔴 **PLACEHOLDER, trocar pela fórmula real**

Em `src/databricks/contrato.js`, hoje o PME usa um modelo genérico de cobertura
(`estoque ÷ demanda diária`), só para a pipeline ficar válida:

```js
// apoio: demanda diária estimada = venda média de 3 meses distribuída em 30 dias
const DEMANDA_DIARIA = `(NULLIF(qtd_media_3m, 0) / 30.0)`;

pmeCd:        `COALESCE(stk_cd / ${DEMANDA_DIARIA}, 0)`,                    // 🔴
pmeNna:       `COALESCE(nna / ${DEMANDA_DIARIA}, 0)`,                       // 🔴
pmePend:      `COALESCE(pend / ${DEMANDA_DIARIA}, 0)`,                      // 🔴
pmeCdPend:    `COALESCE((stk_cd + pend) / ${DEMANDA_DIARIA}, 0)`,          // 🔴
pmeLoja:      `COALESCE(stk_loja / ${DEMANDA_DIARIA}, 0)`,                 // 🔴
pmeGeral:     `COALESCE((stk_cd + stk_loja) / ${DEMANDA_DIARIA}, 0)`,      // 🔴 define a faixa
pmeGeralPend: `COALESCE((stk_cd + stk_loja + pend) / ${DEMANDA_DIARIA}, 0)`, // 🔴
leadTime:     `COALESCE(lead_time, 0)`,                                    // 🔴
```

> **Ação da TI:** substituir cada uma dessas expressões pela **fórmula oficial**
> de cobertura do negócio. Coletar em [`TEMPLATE-FORMULAS.md`](TEMPLATE-FORMULAS.md).

### 🟦 Referência (JS)

No modo mock, os `pme*` já vêm prontos como valores por linha (não há fórmula a
recalcular, a não ser o ajuste de base abaixo). Servem para comparar resultados.

---

## 2.2 Base de demanda do PME — toggle `media3m` × `kardex30`

A tela tem um **interruptor** que troca a "demanda diária" usada na cobertura:

- **`media3m` (padrão)** — usa o PME como veio (demanda = média de 3 meses).
- **`kardex30`** — recalcula a cobertura usando a **venda dos últimos 30 dias**
  (Kardex) como demanda. Na prática, multiplica cada `pme*` por um **fator** e
  limita o resultado a `0..120` dias.

### A fórmula do fator

```
fator = (vendaKardex30 > 0) ? (qtdMedia3m / vendaKardex30) : 1
pme_ajustado = arredonda( limita(0, 120, pme * fator) )
```

> Intuição: se a venda recente (Kardex 30d) está **maior** que a média de 3 meses,
> a demanda diária sobe e a cobertura em dias **cai** (e vice-versa).

### 🟦 Referência (JS) — `calculosService.js`

```js
function ajustarPme(linhas, base = 'media3m') {
  if (base !== 'kardex30') return linhas;          // media3m: não mexe
  return linhas.map((r) => {
    const fator = r.vendaKardex30 > 0 ? r.qtdMedia3m / r.vendaKardex30 : 1;
    const o = { ...r };
    COLS_PME.forEach((k) => { o[k] = Math.round(clamp((r[k] || 0) * fator, 0, 120)); });
    return o;
  });
}
```

### 🟩 Produção (SQL) — `consulta.js`

O mesmo fator (`f`) é calculado por linha na CTE base, e aplicado a cada PME:

```sql
-- por linha:
CASE WHEN venda_kardex_30 > 0 THEN qtd_media_3m / venda_kardex_30 ELSE 1 END AS f
-- ao usar o PME na base kardex30:
ROUND(LEAST(120, GREATEST(0, `pmeGeral` * f)))
```

> ⚠️ **Importante:** `leadTime` **não** é ajustado pelo fator Kardex (não está em
> `COLS_PME`). Só as 7 colunas de PME de cobertura são. Os dois lados (JS e SQL)
> já respeitam isso por importarem a mesma lista `COLS_PME`.

---

## 2.3 Faixa de cobertura (a "saúde" do estoque)

**O que é:** classifica cada produto/grupo em três faixas, a partir do
`pmeGeral`. É o que pinta os cartões de "saúde da cobertura".

| Faixa | Regra (sobre `pmeGeral`) | Significado | Cor na UI |
|-------|--------------------------|-------------|-----------|
| `rup` | `< 20` dias | **Ruptura** (cobertura baixa) | vermelho |
| `faixa` | `20` a `40` dias (inclusive) | **Na faixa** (saudável) | verde |
| `exc` | `> 40` dias | **Excesso** | âmbar |

### 🟦 Referência (JS)

```js
function faixaDe(pmeGeral) {
  return pmeGeral < 20 ? 'rup' : (pmeGeral <= 40 ? 'faixa' : 'exc');
}
```

### 🟩 Produção (SQL) — `consulta.js` (contagem por faixa nos totais)

```sql
SUM(CASE WHEN pmeGeral < 20                         THEN 1 ELSE 0 END) AS faixaRup,
SUM(CASE WHEN pmeGeral >= 20 AND pmeGeral <= 40     THEN 1 ELSE 0 END) AS faixaFaixa,
SUM(CASE WHEN pmeGeral > 40                         THEN 1 ELSE 0 END) AS faixaExc
```

> Os cortes (20 e 40) são **regra de negócio**. Se mudarem, ajuste **nos dois
> lados** (a função `faixaDe` no JS e os `CASE WHEN` no `consulta.js`). Hoje os
> valores 20/40 estão fixos no código — se forem virar parâmetro, é uma pequena
> extensão.

---

## 2.4 Perda de vendas de hoje (R$)

**O que é:** o valor de venda que se perde **hoje** porque o **CD está zerado**.
Só existe quando `stkCd === 0`.

### A fórmula (definida pelo contrato — ✅ oficial)

```
perdaHoje = (stkCd == 0) ? arredonda( (qtdMedia3m / 30) * custo ) : 0
```

Ou seja: a venda média diária (`qtdMedia3m / 30`) vezes o custo unitário, **apenas
quando não há estoque no CD**.

### 🟦 Referência (JS)

```js
function perdaHojeDe(r) {
  return r.stkCd === 0 ? Math.round((r.qtdMedia3m / 30) * (r.custo || 0)) : 0;
}
```

### 🟩 Produção (SQL) — `contrato.js`

```js
const EXPR_PERDA_HOJE =
  `CASE WHEN stk_cd = 0 THEN ROUND((qtd_media_3m / 30.0) * custo) ELSE 0 END`;
```

> Esta fórmula **já é a oficial** — só depende de `custo` estar correto (ver §2.6).

---

## 2.5 Ruptura projetada (R$)

**O que é:** o valor financeiro projetado de ruptura. Aparece somado nos cartões e
é a ordenação padrão das tabelas.

### 🟩 Produção (SQL) — 🔴 **PLACEHOLDER, trocar pela fórmula real**

Hoje, em `contrato.js`, há um placeholder de "déficit vs. meta de 22 dias":

```js
ruptura: `ROUND(
  GREATEST(0, (22 - COALESCE((stk_cd + stk_loja) / ${DEMANDA_DIARIA}, 0)) / 22.0)
  * venda_kardex_30 * custo
)`   // 🔴 PLACEHOLDER — não é a regra oficial
```

> **Ação da TI:** substituir pela **fórmula oficial de ruptura projetada (R$)**.
> Coletar em [`TEMPLATE-FORMULAS.md`](TEMPLATE-FORMULAS.md).

### 🟦 Referência (JS)

No mock, `ruptura` vem como valor pronto na linha e é apenas **somada** na
agregação (está em `COLS_SOMA`).

---

## 2.6 Custo unitário (R$)

**O que é:** custo de reposição por unidade. Entra nas fórmulas de **perda** e
**ruptura**.

### 🟩 Produção (SQL) — ⚠️ **confirmar**

```js
custo: `custo`,   // TODO: confirmar se é coluna bruta OU uma fórmula derivada
```

> **Ação da TI:** confirmar se `custo` é uma **coluna existente** na tabela bruta
> (e qual o nome real) ou se precisa ser **derivado** (ex.: preço × fator). Se for
> coluna, ajuste o nome em `COLUNAS_BRUTAS`; se for derivado, troque a expressão.

---

## 2.7 Agregação de um grupo

Depois de calcular cada linha, o sistema **junta** as linhas de um grupo (por
produto, por CD, ou total). A regra depende da medida:

| Medidas | Como agrega |
|---------|-------------|
| Quantidades/estoque + financeiras (`COLS_SOMA`) | **SOMA** simples |
| PME + leadTime (`COLS_WAVG`) | **MÉDIA PONDERADA**, peso = `qtdMedia3m` (ou `1` se zero) |

A faixa do grupo é recalculada a partir do `pmeGeral` **já agregado**.

### 🟦 Referência (JS)

```js
function agregar(linhas) {
  const out = {};
  COLS_SOMA.forEach((k) => { out[k] = linhas.reduce((s, r) => s + (r[k] || 0), 0); });
  COLS_WAVG.forEach((k) => {
    let somaPesada = 0, somaPesos = 0;
    linhas.forEach((r) => {
      const peso = r.qtdMedia3m || 1;
      somaPesada += (r[k] || 0) * peso;
      somaPesos  += peso;
    });
    out[k] = somaPesos ? somaPesada / somaPesos : 0;
  });
  out.faixa = faixaDe(out.pmeGeral);
  return out;
}
```

### 🟩 Produção (SQL) — `consulta.js`

```sql
-- somas:
SUM(`stkCd`) AS `stkCd`,  SUM(`ruptura`) AS `ruptura`,  ...
-- médias ponderadas (w = qtdMedia3m, ou 1 se zero):
SUM(`pmeGeral` * w) / NULLIF(SUM(w), 0) AS `pmeGeral`,  ...
```

> Por que **média ponderada** e não média simples? Porque um produto que vende
> 10.000 unidades/mês deve pesar mais na cobertura média do grupo do que um que
> vende 10. O peso é a `qtdMedia3m`.

---

## 2.8 Resumo: o que a TI precisa mexer × o que não mexe

| Item | Onde | A TI mexe? |
|------|------|-----------|
| **Quais colunas somam / são média ponderada** | `calculosService.js` (listas) | ❌ Não (já correto, e é compartilhado com o SQL) |
| **Fórmulas de PME** | `contrato.js → EXPRESSOES` | ✅ **Sim — trocar placeholder** |
| **Fórmula de ruptura** | `contrato.js → EXPRESSOES.ruptura` | ✅ **Sim — trocar placeholder** |
| **Origem do custo** | `contrato.js → custo` / `COLUNAS_BRUTAS` | ✅ **Sim — confirmar** |
| **Fórmula de perda hoje** | `contrato.js → EXPR_PERDA_HOJE` | ⚠️ Só se a regra mudar (já oficial) |
| **Cortes de faixa (20/40)** | `calculosService.js` + `consulta.js` | ⚠️ Só se mudarem |
| **Fator Kardex / clamp 0–120** | ambos | ⚠️ Só se mudar |
| **Nomes reais das colunas** | `contrato.js → COLUNAS_IDENTIDADE / COLUNAS_BRUTAS` | ✅ **Sim** |

➡️ Continue em [`03-MIGRACAO-PARA-API-DATABRICKS.md`](03-MIGRACAO-PARA-API-DATABRICKS.md)
para o passo a passo de **onde e como** fazer essas alterações.
