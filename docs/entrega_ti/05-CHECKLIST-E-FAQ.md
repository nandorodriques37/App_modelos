# 5. Checklist de entrega, FAQ e glossário

---

## 5.1 Checklist da migração

### Preparação
- [ ] SQL Warehouse disponível no Databricks (Warehouse ID anotado)
- [ ] Tabela bruta (produto × CD) localizada (`catalog.schema.tabela`)
- [ ] Token de acesso gerado (leitura na tabela + uso do warehouse)
- [ ] Host do workspace anotado (sem `https://`)

### Negócio / Dados
- [ ] [`TEMPLATE-FORMULAS.md`](TEMPLATE-FORMULAS.md) preenchido pelo negócio
- [ ] Nomes reais das colunas confirmados (dimensões + medidas)
- [ ] Origem do `custo` definida (coluna ou fórmula)
- [ ] Fórmulas de PME oficiais (em especial `pmeGeral`)
- [ ] Fórmula de `ruptura` oficial
- [ ] Regras já implementadas (perda, faixa, kardex, agregação) confirmadas

### Código (`src/databricks/contrato.js`)
- [ ] `COLUNAS_IDENTIDADE` ajustado aos nomes reais
- [ ] `COLUNAS_BRUTAS` ajustado aos nomes reais
- [ ] `EXPRESSOES` com as fórmulas oficiais (PME, ruptura, custo)
- [ ] `EXPR_PERDA_HOJE` confirmado

### Ambiente
- [ ] Variáveis do Databricks configuradas no deploy
- [ ] `CORS_ORIGIN` restrito ao domínio do front-end (produção)

### Validação
- [ ] `npm test` passa
- [ ] `GET /api/abastecimento/resumo` responde `"fonte": "databricks"`
- [ ] Números batem com a referência do negócio (amostra de produtos/CDs)
- [ ] Toggle `pmeBase=kardex30` altera os PME como esperado
- [ ] Paginação e filtros funcionando

---

## 5.2 FAQ

**Onde mexo nas fórmulas?**
Em **um único arquivo**: `src/databricks/contrato.js`. Os demais arquivos do
diretório `src/databricks/` (montagem do SQL, conexão, orquestração) não precisam
de alteração.

**Por que as fórmulas aparecem em dois lugares (JS e SQL)?**
`calculosService.js` (JS) é a **referência legível** e roda no **modo mock/testes**.
`contrato.js`/`consulta.js` (SQL) é o que **roda em produção** no Databricks. As
**listas de colunas** (o que soma × o que é média ponderada) são importadas do JS
pelo SQL, então **não divergem**. O que pode mudar por medida é só a **fórmula**.

**Preciso mexer no `consulta.js`?**
Normalmente **não**. Ele monta o SQL genérico (filtros, agrupamento, agregação,
paginação) a partir das listas e das expressões do `contrato.js`. Só se mudar a
*estrutura* do cálculo (ex.: novos cortes de faixa parametrizáveis).

**Como o sistema decide entre mock e Databricks?**
Pela presença das variáveis `DATABRICKS_HOST` + `DATABRICKS_TOKEN` +
`DATABRICKS_WAREHOUSE_ID`. Com as três, usa o Databricks; sem elas, mock.

**As 700k linhas chegam ao Node?**
Não. Toda a derivação + agregação roda no Databricks; o Node recebe só a **página
de grupos + a linha de totais**. O endpoint de linhas cruas é **sempre paginado**.

**O front-end recalcula algo?**
Não. O endpoint `/resumo` entrega tudo pronto (PME, faixa, perda, ruptura, totais).

**Posso remover o mock depois?**
Pode remover `src/data/mockData.js`. Recomendo **manter** `calculosService.js` —
é a documentação executável das fórmulas e a base dos testes.

**O `custo` é obrigatório?**
Ele entra nas fórmulas de **perda** e **ruptura**. Se não houver custo, essas
medidas ficam zeradas/incorretas — defina a origem dele no template.

**Como restrinjo o acesso por usuário (analista/CD)?**
Não está implementado. É um próximo passo (autenticação + recorte de escopo). Os
filtros já existem; faltaria amarrá-los à identidade do usuário.

---

## 5.3 Glossário

| Termo | Significado |
|-------|-------------|
| **PME** | Cobertura de estoque em **dias** (quantos dias o estoque cobre a demanda) |
| **CD** | Centro de Distribuição |
| **Linha** | A unidade do dado: **um produto em um CD** (produto × CD) |
| **Ruptura** | Falta de produto; aqui, o **valor financeiro projetado (R$)** dessa falta |
| **Perda hoje** | Venda perdida **hoje** por CD zerado (R$) |
| **Faixa** | Classificação da cobertura: `rup` (<20d) · `faixa` (20–40d) · `exc` (>40d) |
| **Kardex** | Registro de movimentação de estoque; aqui, a **venda dos últimos 30 dias** |
| **Média ponderada** | Média em que cada item pesa por `qtdMedia3m` (volume de venda) |
| **Seam de fórmulas** | O ponto único (`contrato.js`) onde as regras de negócio entram no SQL |
| **Mock** | Modo de demonstração com dados simulados (sem banco) |
| **SQL Warehouse** | O motor do Databricks que executa as consultas |
| **Statement Execution API** | A API REST do Databricks usada para rodar o SQL |

---

## 5.4 Contatos / próximos passos sugeridos

1. Negócio preenche o [`TEMPLATE-FORMULAS.md`](TEMPLATE-FORMULAS.md).
2. TI provisiona Databricks + configura variáveis.
3. TI edita `src/databricks/contrato.js` (colunas + fórmulas).
4. TI valida (mock → Databricks) com a amostra de referência.
5. Deploy com `CORS_ORIGIN` restrito.
6. (Opcional) Autenticação e recorte de escopo por usuário.
