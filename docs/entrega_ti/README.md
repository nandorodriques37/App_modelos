# Entrega para a TI — Painel de Gestão de Abastecimento

> **Pacote de documentação para o time de TI / Engenharia de Dados.**
> Tudo o que é preciso para **entender as fórmulas** do painel e **migrar a API
> do modo de demonstração (mock) para a fonte real (Databricks)**.

Este painel mostra **ruptura projetada (R$)**, **cobertura de estoque (PME, em
dias)**, **perda de vendas de hoje (R$)** e a **saúde da cobertura por faixa**,
por produto e por Centro de Distribuição (CD).

O **back-end** (esta aplicação, Node.js + Express) já está pronto e roda hoje com
**dados simulados**. Ele já tem **todas as fórmulas implementadas** e já sabe
falar com o **Databricks**. Falta apenas **a TI ligar o Databricks e confirmar as
fórmulas reais de negócio**. É isso que esta documentação destrava.

---

## 🚦 O que a TI precisa fazer (resumo de 1 minuto)

A aplicação funciona em dois modos, com **exatamente o mesmo contrato de API**:

| Modo | Quando | Para quê |
|------|--------|----------|
| **Mock** (atual) | Sem variáveis do Databricks | Demonstração / desenvolvimento da UI |
| **Databricks** (alvo) | Com as variáveis configuradas | Produção, sobre a tabela real (700k+ linhas) |

Para virar a chave para produção, são **3 passos** (detalhados em
[`03-MIGRACAO-PARA-API-DATABRICKS.md`](03-MIGRACAO-PARA-API-DATABRICKS.md)):

1. **Configurar o acesso ao Databricks** — variáveis de ambiente (host, token,
   SQL Warehouse, catálogo/schema/tabela).
2. **Mapear as colunas reais** da tabela bruta para os nomes do contrato.
3. **Confirmar/ajustar as fórmulas** de negócio (PME, ruptura, custo) — hoje há
   *placeholders* que precisam virar as fórmulas oficiais.

> ⚠️ **O ponto mais importante:** as fórmulas de negócio (PME, ruptura) que rodam
> no Databricks hoje são **provisórias (placeholders)**. Elas mantêm o sistema
> funcionando, mas **não são as regras oficiais**. A TI/negócio precisa preencher
> o template em [`TEMPLATE-FORMULAS.md`](TEMPLATE-FORMULAS.md).
>
> **Há um único arquivo a editar para isso:** `src/databricks/contrato.js`.

---

## 📚 Índice da documentação

Leia nesta ordem:

| # | Documento | Para quem | O que cobre |
|---|-----------|-----------|-------------|
| 1 | [`01-ARQUITETURA.md`](01-ARQUITETURA.md) | Todos | Como as peças se encaixam, o fluxo de dados, mock × Databricks |
| 2 | [`02-FORMULAS.md`](02-FORMULAS.md) | Negócio + Dados | **Todas as fórmulas** explicadas (PME, faixa, perda, ruptura, agregação), com a versão de referência e a versão SQL |
| 3 | [`03-MIGRACAO-PARA-API-DATABRICKS.md`](03-MIGRACAO-PARA-API-DATABRICKS.md) | Engenharia/Dados | **Passo a passo** da migração: env, colunas, fórmulas, teste, deploy |
| 4 | [`04-REFERENCIA-DA-API.md`](04-REFERENCIA-DA-API.md) | Back-end + Front-end | Contrato da API: endpoints, parâmetros, payloads, campos |
| 5 | [`05-CHECKLIST-E-FAQ.md`](05-CHECKLIST-E-FAQ.md) | Todos | Checklist de entrega, perguntas frequentes e glossário |
| 6 | [`TEMPLATE-FORMULAS.md`](TEMPLATE-FORMULAS.md) | **Negócio** | Planilha para preencher as fórmulas reais e devolver para a TI |

---

## 🗂️ Onde estão as coisas no código

Os arquivos que importam para esta entrega (todos comentados em português):

```
src/
  databricks/
    contrato.js   ◀── ⭐ O "SEAM DE FÓRMULAS". É AQUI que a TI mexe:
                       nomes das colunas + fórmulas reais (PME, ruptura, custo).
    consulta.js       Monta o SQL de agregação que roda no Databricks (não muda).
    fonte.js          Orquestra as consultas e monta a resposta (não muda).
    cliente.js        Conexão REST com o Databricks SQL Warehouse (não muda).
  services/
    calculosService.js  ◀── A MESMA fórmula em JavaScript. É a "fonte da verdade"
                            de referência e o que roda no modo mock.
    resumoService.js    Decide a fonte: Databricks (se configurado) ou mock.
    abastecimentoService.js  Carga do mock + filtros + cache.
  routes/abastecimento.js   Os endpoints HTTP (/api/abastecimento e /resumo).
  data/mockData.js          Gerador de dados simulados (some quando o banco entra).
.env.example                Modelo das variáveis de ambiente (copiar para .env).
```

**Regra de ouro:** as fórmulas existem em **dois lugares espelhados** —
`calculosService.js` (JS, referência/mock) e `contrato.js` (SQL, produção). Eles
**precisam concordar**. As listas de colunas são importadas de um para o outro
justamente para não divergirem (ver [`02-FORMULAS.md`](02-FORMULAS.md)).

---

## ▶️ Como rodar localmente (validar o pacote)

Pré-requisito: **Node.js 18+**.

```bash
npm install
npm start            # sobe em http://localhost:3000
npm test             # roda a suíte de testes (fórmulas, contrato, SQL)
```

- Painel:  http://localhost:3000/
- API:     http://localhost:3000/api/abastecimento/resumo
- Health:  http://localhost:3000/health

Sem variáveis do Databricks, ele sobe em **modo mock** — útil para a TI ver o
contrato e o painel funcionando **antes** de plugar o banco.

---

## ✅ Definição de "pronto" (produção)

A migração está concluída quando:

- [ ] As variáveis do Databricks estão configuradas no ambiente de deploy.
- [ ] `COLUNAS_IDENTIDADE` e `COLUNAS_BRUTAS` apontam para as colunas reais.
- [ ] `EXPRESSOES` e `EXPR_PERDA_HOJE` contêm as **fórmulas oficiais**.
- [ ] `GET /api/abastecimento/resumo` responde com `"fonte": "databricks"`.
- [ ] Os números batem com a referência do negócio.

O checklist completo está em [`05-CHECKLIST-E-FAQ.md`](05-CHECKLIST-E-FAQ.md).
