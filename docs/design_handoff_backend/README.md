# Handoff: Sistema de Gestão de Abastecimento — Back-end

## Overview
Painel de gestão de abastecimento (ruptura projetada, cobertura de estoque / PME, perda
de vendas e gestão de SKUs por CD). Hoje é um **protótipo front-end funcional em HTML**
que roda com **dados simulados** gerados no próprio arquivo. O objetivo deste handoff é
implementar o **back-end real** (API + banco) que alimente este painel com dados de
produção, e recriar o front-end no ambiente do seu codebase.

## Sobre os arquivos deste pacote
Os arquivos são **referências de design / protótipo** — mostram o visual e o comportamento
pretendidos, não código de produção para copiar direto.
- `Gestão de Abastecimento.dc.html` — o painel completo (UI + lógica + dados simulados).
- `support.js` — runtime do componente (não precisa ser portado; é o motor do protótipo).

**Fidelidade: alta (hi-fi).** Cores, tipografia, espaçamentos, estados e interações são
finais. Recrie a UI fielmente usando as bibliotecas/padrões do seu codebase (React, Vue,
etc.); se ainda não houver front-end, escolha o framework mais adequado.

O foco deste documento é o **contrato de dados e a lógica de negócio**, que é o que o
back-end precisa entregar.

---

## ⭐ Ponto único de integração (já preparado no protótipo)
O protótipo foi refatorado para ter **um único ponto de troca** entre dados simulados e a
API real. Você não precisa caçar a geração de dados pelo código:

1. **`buildFromRows(rows)`** — recebe **um array de linhas** (uma por *produto × CD*) e
   monta tudo que a UI consome (lista de produtos, opções de filtro, campos derivados).
   É a fronteira entre "dados" e "tela".
2. **`maybeLoadFromApi()`** — chamado no `componentDidMount`. Se houver uma URL de API
   configurada, faz `fetch`, e passa o JSON para `buildFromRows`. Configuração:
   - `window.ABASTECIMENTO_API_URL = 'https://.../api/abastecimento'` **ou**
   - a prop `apiUrl` do componente.
   - Sem nenhuma das duas, o painel roda com os dados simulados de `buildData()`.
3. **`buildData()`** — apenas o **gerador simulado**. Pode ser deletado quando a API
   estiver pronta.

Ou seja: **a API só precisa devolver o array de linhas no formato abaixo.** Todo o resto
(agrupamento, agregação, faixas, perda, ordenação) já está implementado no front-end e
pode ser mantido no cliente — ou movido para o servidor, se preferir (ver "Onde calcular").

---

## Contrato de dados — a "linha" (granularidade: produto × CD)
A API deve devolver `{ "linhas": [ ... ] }` **ou** diretamente um array `[ ... ]`. Cada
item representa **um produto em um Centro de Distribuição (CD)**.

### Identificação / dimensões (strings, exceto `cd`)
| Campo        | Tipo   | Descrição |
|--------------|--------|-----------|
| `codsemDv`   | string | Código do produto sem dígito verificador (chave do produto) |
| `produto`    | string | Descrição do produto |
| `cd`         | number | Número do Centro de Distribuição (1..N) |
| `catN2`      | string | Categoria nível 2 (ex.: "MEDICAMENTOS") |
| `cat3`/`catN3` | string | Categoria nível 3 (ex.: "DIABETES"). Aceita qualquer um dos dois nomes |
| `catN4`      | string | Categoria nível 4 (subcategoria) |
| `situacao`   | string | Situação do produto (ex.: "Ativo", "Sazonal", "Em saída", "Novo", "Bloqueado") |
| `com`        | string | Fornecedor comercial (COM) |
| `log`        | string | Fornecedor logístico (LOG) |
| `analista`   | string | Analista responsável |
| `comprador`  | string | Comprador responsável |

### Medidas — quantidades/estoque (inteiros; agregadas por **soma**)
| Campo          | Descrição |
|----------------|-----------|
| `qtdMedia3m`   | Quantidade média de venda dos últimos 3 meses (**peso das médias ponderadas**) |
| `vendaKardex30`| Venda registrada no Kardex nos últimos 30 dias |
| `eo`           | Estoque em ordem |
| `stkCd`        | Estoque disponível no CD (**`0` aciona a regra de perda**) |
| `nna`          | Itens não negociáveis / não atendidos |
| `trasNsf`      | Transferências sem NF em trânsito |
| `pend`         | Pedidos pendentes de recebimento |
| `ea`           | Estoque em aberto |
| `stkLoja`      | Estoque disponível nas lojas |

### Medidas — PME em dias (inteiros; agregadas por **média ponderada** por `qtdMedia3m`)
`pmeCd`, `pmeNna`, `pmePend`, `pmeCdPend`, `pmeLoja`, `pmeGeral`, `pmeGeralPend`, `leadTime`.
`pmeGeral` é o que define a faixa de cobertura.

### Medidas — financeiras (R$)
| Campo     | Tipo   | Descrição |
|-----------|--------|-----------|
| `custo`   | number | Custo unitário de reposição (R$). Usado no cálculo de perda |
| `ruptura` | number | Valor financeiro projetado de ruptura (R$), agregado por **soma** |

### Campos derivados (calculados no front-end — **NÃO precisam vir da API**)
| Campo       | Fórmula |
|-------------|---------|
| `perdaHoje` | `stkCd === 0 ? round((qtdMedia3m / 30) * custo) : 0` — perda de vendas de hoje, apenas em CDs zerados |
| `catN3`     | alias de `cat3` (preenchido automaticamente se faltar) |

> Você pode optar por já mandar `perdaHoje`/`ruptura` calculados pelo back-end. Se vierem
> preenchidos, o front-end os respeita; se vierem nulos, ele calcula `perdaHoje` sozinho.

### Exemplo de payload
```json
{
  "linhas": [
    {
      "codsemDv": "79444", "produto": "MOUNJARO 5MG C/4 SERINGAS",
      "cd": 3, "catN2": "MEDICAMENTOS", "cat3": "DIABETES", "catN4": "ANÁLOGOS GLP-1",
      "situacao": "Ativo", "com": "LILLY MOUNJARO", "log": "LOG FRIO SP",
      "analista": "DANIELY SIPRIANO", "comprador": "Bianca Mota",
      "qtdMedia3m": 13808, "vendaKardex30": 14123,
      "eo": 540, "stkCd": 0, "nna": 120, "trasNsf": 0, "pend": 900, "ea": 1800, "stkLoja": 430,
      "pmeCd": 12, "pmeNna": 4, "pmePend": 8, "pmeCdPend": 20, "pmeLoja": 18,
      "pmeGeral": 15, "pmeGeralPend": 23, "leadTime": 21,
      "custo": 320.50, "ruptura": 136000
    }
  ]
}
```

---

## Regras de negócio já implementadas no front-end

### 1. Agregação por grupo
- **Soma** para todas as medidas de quantidade/estoque e financeiras (`ruptura`, `perdaHoje`).
- **Média ponderada** (peso = `qtdMedia3m`) para as colunas de PME e `leadTime`.

### 2. Faixa de cobertura (a partir de `pmeGeral`)
- `< 20 dias` → **Ruptura** (vermelho)
- `20 a 40 dias` → **Na faixa** (verde)
- `> 40 dias` → **Excesso** (âmbar)

### 3. Base de cálculo do PME (toggle na tela)
- **Média 3 meses** (padrão): usa os `pme*` como vieram.
- **Kardex 30 dias**: multiplica cada `pme*` pelo fator `qtdMedia3m / vendaKardex30`
  (limitado a 0..120). Representa "trocar a demanda diária" do denominador da cobertura.

### 4. Agrupamento dinâmico (depende das colunas visíveis na tabela)
- **Produto/CodsemDv visível** → agrupa por **produto** (detalhe expansível por CD).
- **Produto e CodsemDv ocultos, CDs visível** → agrupa por **CD** (soma todos os produtos do CD).
- **Todas as colunas de identidade ocultas** → **total geral** (uma linha).

### 5. Filtros
Multi-seleção: `produto`, `situacao`, `catN2`, `cat3` (N3), `catN4`, `com`, `log`,
`analista`, `comprador`. Seleção única via gráficos: `cd`. Busca textual em `produto` + `codsemDv`.

### 6. Totalizador
Rodapé fixo da tabela com soma das medidas e média ponderada dos PME do escopo filtrado.

---

## Onde calcular: cliente x servidor
O protótipo faz **tudo no cliente** sobre o array completo de linhas. Para volumes reais
escolha uma das estratégias:

- **Simples (recomendado para começar):** a API devolve **todas as linhas** já filtradas
  pelo escopo do usuário; o front-end mantém agrupamento/agregação/ordenação no cliente.
  Funciona bem até dezenas de milhares de linhas.
- **Escalável:** mova filtros, agregação e paginação para o servidor. Sugestão de endpoint:
  `GET /api/abastecimento?cat3=...&com=...&situacao=...&pmeBase=media3m|kardex30&groupBy=produto|cd`
  devolvendo já as linhas agregadas + a linha de totais. Nesse caso, replique no servidor as
  fórmulas das seções "Regras de negócio".

---

## Passos sugeridos no Claude Code
1. Abra a pasta do projeto no Claude Code e **inclua esta pasta de handoff** no contexto.
2. Modele a tabela/consulta que produz a "linha" (produto × CD) com os campos do contrato.
3. Implemente o endpoint que devolve `{ "linhas": [...] }` (comece devolvendo tudo; otimize depois).
4. Recrie o painel no seu front-end (ou aponte o protótipo para a API definindo
   `window.ABASTECIMENTO_API_URL` / a prop `apiUrl` — `buildFromRows` faz o resto).
5. Decida cliente x servidor (seção acima). Se for servidor, porte as fórmulas de PME,
   faixa, perda e agregação.
6. Adicione autenticação e o recorte de escopo por usuário (analista/comprador/CD), se aplicável.

## Arquivos neste pacote
- `Gestão de Abastecimento.dc.html` — protótipo completo (referência de UI + lógica + fórmulas).
- `support.js` — runtime do protótipo (não portar).
- `README.md` — este documento (auto-suficiente).
