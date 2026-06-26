# Template — fórmulas oficiais de negócio (para preencher)

> **Para o time de negócio / dados preencher e devolver à TI.**
> Cada linha vira uma expressão em `src/databricks/contrato.js`. Escreva a regra em
> linguagem de negócio **e/ou** já como cálculo sobre as colunas da tabela bruta.
> Onde houver dúvida, deixe anotado — a TI converte para SQL.

Preencha também os **nomes reais das colunas** (PASSO 3 da migração).

---

## A) Nomes reais das colunas

### Dimensões (identidade)

| Contrato | Coluna real na tabela | OK? |
|----------|-----------------------|:---:|
| `codsemDv` | | ☐ |
| `produto` | | ☐ |
| `cd` | | ☐ |
| `catN2` | | ☐ |
| `cat3` | | ☐ |
| `catN4` | | ☐ |
| `situacao` | | ☐ |
| `com` | | ☐ |
| `log` | | ☐ |
| `analista` | | ☐ |
| `comprador` | | ☐ |

### Medidas brutas (estoque/venda)

| Contrato | Coluna real na tabela | OK? |
|----------|-----------------------|:---:|
| `qtdMedia3m` (venda média 3 meses) | | ☐ |
| `vendaKardex30` (venda Kardex 30 dias) | | ☐ |
| `eo` (estoque em ordem) | | ☐ |
| `stkCd` (estoque no CD) | | ☐ |
| `nna` | | ☐ |
| `trasNsf` (transferências sem NF) | | ☐ |
| `pend` (pedidos pendentes) | | ☐ |
| `ea` (estoque em aberto) | | ☐ |
| `stkLoja` (estoque nas lojas) | | ☐ |

---

## B) Custo unitário

| Pergunta | Resposta |
|----------|----------|
| `custo` é uma **coluna** que já existe na tabela bruta? | ☐ Sim, nome: ____________  ☐ Não |
| Se **não**, qual a **fórmula** do custo unitário (R$)? | |

---

## C) Fórmulas de PME (cobertura em dias)

> Definir a regra de cada uma. `pmeGeral` é a mais importante (define a faixa).
> Indique também o **denominador de demanda** usado (ex.: `qtdMedia3m / 30`).

| Campo | Significado | Fórmula oficial (negócio ou SQL) |
|-------|-------------|----------------------------------|
| `pmeCd` | cobertura só com estoque do CD | |
| `pmeNna` | cobertura ligada a NNA | |
| `pmePend` | cobertura considerando pendências | |
| `pmeCdPend` | cobertura CD + pendências | |
| `pmeLoja` | cobertura do estoque nas lojas | |
| **`pmeGeral`** | **cobertura geral (define a faixa)** | |
| `pmeGeralPend` | cobertura geral + pendências | |
| `leadTime` | tempo de reposição (dias) | |

---

## D) Ruptura projetada (R$)

| Pergunta | Resposta |
|----------|----------|
| Qual a **fórmula oficial** do valor financeiro de ruptura projetada? | |
| Há uma **meta de cobertura** (ex.: X dias) na conta? Qual? | |

---

## E) Confirmações das regras já implementadas

> Estas já estão no sistema. Confirme se continuam corretas (ou anote a mudança).

| Regra atual | Continua válida? |
|-------------|------------------|
| **Perda hoje** = `stkCd == 0 ? round((qtdMedia3m / 30) * custo) : 0` | ☐ Sim ☐ Não → nova: __________ |
| **Faixa**: `rup` < 20 dias · `faixa` 20–40 dias · `exc` > 40 dias | ☐ Sim ☐ Não → novos cortes: ____ / ____ |
| **Toggle Kardex**: `pme × (qtdMedia3m / vendaKardex30)`, limitado a 0–120 dias | ☐ Sim ☐ Não → ajuste: __________ |
| **Agregação**: estoque/financeiro = SOMA; PME/leadTime = MÉDIA PONDERADA por `qtdMedia3m` | ☐ Sim ☐ Não → ajuste: __________ |

---

## F) Tabela bruta — localização

| Item | Valor |
|------|-------|
| Catálogo (`DATABRICKS_CATALOG`) | |
| Schema (`DATABRICKS_SCHEMA`) | |
| Tabela (`DATABRICKS_TABLE`) | |
| Granularidade é **uma linha por produto × CD**? | ☐ Sim ☐ Não → __________ |

---

_Ao terminar, devolva este arquivo para a TI. Com ele, a edição de_
_`src/databricks/contrato.js` é direta (ver `03-MIGRACAO-PARA-API-DATABRICKS.md`)._
