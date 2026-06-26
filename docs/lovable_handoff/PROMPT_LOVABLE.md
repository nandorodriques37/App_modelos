# Prompt para o Lovable — Painel de Gestão de Abastecimento

> Cole o texto abaixo no Lovable para gerar o front-end. Anexe também os
> screenshots de `docs/screenshots/` (principalmente `full.png`, `table.png`,
> `perda-charts.png`, `pme-toggle.png`, `group-cd.png`, `totalizer.png`,
> `drawer.png`) como referência visual. **Não** crie banco no Lovable: este app
> consome uma API REST externa (o back-end já existe).

---

Construa um **painel de Gestão de Abastecimento** (farma/varejo) em React +
TypeScript + Tailwind + shadcn/ui. Os dados vêm de uma **API REST externa** — não
crie banco nem use o conector de dados. Toda agregação já vem pronta da API.

## Configuração da API
- Base URL numa env `VITE_API_URL` (ex.: `https://seu-backend.vercel.app`).
- Endpoint principal: `GET {VITE_API_URL}/api/abastecimento/resumo` (querystring).
- Use React Query (TanStack) para buscar/cachear; refazer a busca quando filtros,
  `pmeBase`, `groupBy`, ordenação ou página mudarem.

### Parâmetros (querystring, todos opcionais)
- Filtros multi-valor (vírgula): `produto`, `situacao`, `catN2`, `cat3`, `catN4`,
  `com`, `log`, `analista`, `comprador`. CD único: `cd`. Busca: `q`.
- `pmeBase` = `media3m` (padrão) | `kardex30`.
- `groupBy` = `produto` (padrão) | `cd` | `total`.
- `sortKey` (medida ou `produto`/`codsemDv`/`cds`), `sortDir` = `asc`|`desc`.
- `pagina` (1-based), `tamanhoPagina` (padrão 50).

### Formato da resposta
```ts
type Faixa = 'rup' | 'faixa' | 'exc';
type Agg = {
  qtdMedia3m: number; vendaKardex30: number; eo: number; stkCd: number;
  nna: number; trasNsf: number; pend: number; ea: number; stkLoja: number;
  pmeCd: number; pmeNna: number; pmePend: number; pmeCdPend: number;
  pmeLoja: number; pmeGeral: number; pmeGeralPend: number; leadTime: number;
  perdaHoje: number; ruptura: number; faixa: Faixa;
};
type Grupo = { key: string; cd?: number; meta: Record<string,string|null>;
               agg: Agg; qtdLinhas: number; linhas?: any[] };
type Resumo = {
  pmeBase: string; groupBy: string; grupos: Grupo[]; totais: Agg;
  faixas: { rup: number; faixa: number; exc: number };
  total: number; totalGrupos: number;
  pagina: number; tamanhoPagina: number; totalPaginas: number;
};
```

## Layout (de cima para baixo)
1. **Cabeçalho**: título "Gestão de Abastecimento", busca (`q`) e botão de
   filtros (abre um drawer/sheet com as multi-seleções acima). Toggle de
   **base do PME**: "Média 3 meses" vs "Kardex 30 dias" (`pmeBase`).

2. **Linha de cards — Risco** (de `totais` e `faixas`):
   - **Ruptura projetada** (R$): `totais.ruptura`, com mini-gráfico de barras de
     ruptura por CD (chame `groupBy=cd` e use `agg.ruptura`).
   - **Perda de vendas hoje** (R$): `totais.perdaHoje`, com barras por fornecedor
     (`groupBy`/agg ou agregando no cliente a partir dos grupos).

3. **Card — Saúde da cobertura (PME GERAL por faixa)**: barra segmentada com as
   proporções de `faixas` (rup vermelho `<20d`, faixa verde `20–40d`, exc âmbar
   `>40d`) + legenda com as contagens. Mostre "PME geral médio" = `totais.pmeGeral`
   e "lead time médio" = `totais.leadTime`.

4. **Tabela principal** (linha por grupo, vinda de `grupos`):
   - Colunas de identidade (conforme `groupBy`): Produto + CodsemDv, ou CD.
   - Demanda: `qtdMedia3m`, `vendaKardex30`. Estoque: `eo`, `stkCd`, `nna`,
     `trasNsf`, `pend`, `ea`, `stkLoja`. PME (dias): `pmeCd`, `pmeNna`, `pmePend`,
     `pmeCdPend`, `pmeLoja`, `pmeGeral`, `pmeGeralPend`. Risco: `leadTime`,
     `perdaHoje` (R$), `ruptura` (R$).
   - **Colorir** a célula de PME pela faixa (`agg.faixa`): vermelho/verde/âmbar.
   - Cabeçalhos clicáveis ordenam (`sortKey`/`sortDir`).
   - Esconder/mostrar colunas (painel de colunas). Densidade compacta opcional.
   - Expandir um produto para ver o detalhe por CD: refaça a busca com
     `?codsemDv=...&detalhe=true` ou `groupBy=produto&detalhe=true`.
   - **Rodapé fixo de totais** usando `totais` (somas + PME ponderado).
   - **Paginação** dos grupos (`pagina`/`totalPaginas`).

## Estilo
Hi-fi, limpo, corporativo. Siga os screenshots: superfícies brancas, bordas
suaves (raio ~13px), tipografia ~12.5px, números alinhados à direita e
formatados em pt-BR (R$ e milhares). Semáforo de faixa: ruptura `#c0392b`,
na faixa `#2f8f5b`, excesso `#b7791f` (ajuste fino pelos prints).

## Importante
- **Não recalcule** PME/ruptura/perda/faixa no front — tudo vem pronto da API.
- Trate carregando/erro/vazio. Formate moeda/inteiros em pt-BR.
- Mantenha o estado dos filtros na URL (querystring) para compartilhar visões.
