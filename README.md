# Gestão de Abastecimento

Painel de gestão de abastecimento (ruptura projetada, cobertura de estoque / PME,
perda de vendas e gestão de SKUs por CD).

Este repositório transforma o **protótipo de design** (Claude Design) em um
projeto rodável: um servidor **Node.js + Express** que serve o painel e expõe a
**API real** que o alimenta. Hoje a API responde com **dados simulados**
determinísticos (porte fiel do gerador do protótipo); o próximo passo é plugar o
banco de dados real mantendo o mesmo contrato.

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

## Estrutura

```
public/                       Front-end (protótipo de design servido como estático)
  index.html                  Painel; configura ABASTECIMENTO_API_URL -> /api/abastecimento
  support.js                  Runtime do protótipo (não editar)
  vendor/                     React 18 UMD local (dispensa CDN externo)
src/
  server.js                   App Express (API + estáticos + health + CORS)
  routes/abastecimento.js     GET /api/abastecimento
  services/abastecimentoService.js  Carga + filtros (ponto de troca p/ o banco)
  data/mockData.js            Gerador simulado (porte do buildData do protótipo)
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

## Próximos passos (back-end)

1. **Modelar** a tabela/consulta que produz a "linha" (produto × CD) com os
   campos do contrato.
2. **Substituir** `carregarLinhas()` em `src/services/abastecimentoService.js`
   por uma consulta ao banco — o resto da aplicação não muda.
3. **Decidir cliente × servidor**: para volumes grandes, mover agregação e
   paginação para o servidor (replicando as fórmulas de PME, faixa, perda e
   agregação descritas no handoff).
4. **Autenticação** e recorte de escopo por usuário (analista/comprador/CD).

O gerador simulado (`src/data/mockData.js`) pode ser removido quando o banco
estiver ligado.
