'use strict';

/**
 * Cálculos do painel de abastecimento — porte fiel das fórmulas do protótipo
 * (docs/design_handoff_backend). Centraliza no back-end tudo o que hoje o
 * front-end faz sobre as linhas cruas:
 *
 *   • PME (dias)            — média ponderada por `qtdMedia3m` + base de demanda
 *                             (média 3 meses × Kardex 30 dias) + faixa de cobertura.
 *   • RUPTURA PROJETADA     — valor financeiro (R$), agregado por soma.
 *   • PERDA HOJE            — perda de vendas de hoje, derivada e agregada por soma.
 *
 * Assim o servidor pode devolver dados já calculados (estratégia "Escalável" do
 * handoff) em vez de apenas linhas cruas, mantendo exatamente as mesmas regras
 * de negócio do protótipo (aggregate / adjustPme / faixaOf / groupsFrom).
 */

// ---------------------------------------------------------------------------
// Metadados das medidas — qual coluna soma e qual usa média ponderada.
// Espelha a tabela COLS do protótipo (agg: 'sum' | 'wavg').
// ---------------------------------------------------------------------------

// Medidas de quantidade/estoque + financeiras (ruptura, perdaHoje): agregadas por SOMA.
const COLS_SOMA = [
  'qtdMedia3m', 'vendaKardex30', 'eo', 'stkCd', 'nna', 'trasNsf', 'pend', 'ea',
  'stkLoja', 'perdaHoje', 'ruptura'
];

// Medidas em dias (PME + leadTime): agregadas por MÉDIA PONDERADA (peso = qtdMedia3m).
const COLS_WAVG = [
  'pmeCd', 'pmeNna', 'pmePend', 'pmeCdPend', 'pmeLoja', 'pmeGeral', 'pmeGeralPend',
  'leadTime'
];

// Colunas de PME recalculadas quando a base de demanda é "kardex30".
const COLS_PME = [
  'pmeCd', 'pmeNna', 'pmePend', 'pmeCdPend', 'pmeLoja', 'pmeGeral', 'pmeGeralPend'
];

// Modos de agrupamento aceitos (espelham groupMode() do protótipo).
const MODOS_AGRUPAMENTO = ['produto', 'cd', 'total'];

// Bases de demanda aceitas para o cálculo do PME.
const BASES_PME = ['media3m', 'kardex30'];

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------
// Regras unitárias (por linha = produto × CD)
// ---------------------------------------------------------------------------

/**
 * Faixa de cobertura a partir do PME geral (em dias).
 *   < 20      → 'rup'   (Ruptura)
 *   20 a 40   → 'faixa' (Na faixa)
 *   > 40      → 'exc'   (Excesso)
 */
function faixaDe(pmeGeral) {
  return pmeGeral < 20 ? 'rup' : (pmeGeral <= 40 ? 'faixa' : 'exc');
}

/**
 * Perda de vendas de hoje (R$) — só ocorre quando o CD está zerado.
 *   stkCd === 0 ? round((qtdMedia3m / 30) * custo) : 0
 */
function perdaHojeDe(r) {
  return r.stkCd === 0 ? Math.round((r.qtdMedia3m / 30) * (r.custo || 0)) : 0;
}

/**
 * Garante os campos derivados de cada linha sem mutar o objeto original:
 *  - `catN3`/`cat3` (um preenche o outro quando faltar);
 *  - `perdaHoje` (calculada quando não vier pronta da fonte de dados).
 *
 * @param {Array<Object>} linhas
 * @returns {Array<Object>} novas linhas com os derivados garantidos
 */
function garantirDerivados(linhas) {
  return linhas.map((r) => {
    const o = { ...r };
    if (o.catN3 == null) o.catN3 = o.cat3;
    if (o.cat3 == null) o.cat3 = o.catN3;
    if (o.perdaHoje == null) o.perdaHoje = perdaHojeDe(o);
    return o;
  });
}

/**
 * Recalcula as colunas de PME conforme a base de demanda escolhida (toggle da tela).
 *   'media3m' (padrão): mantém os `pme*` como vieram.
 *   'kardex30': troca o denominador da cobertura pela venda dos últimos 30 dias,
 *               multiplicando cada `pme*` pelo fator `qtdMedia3m / vendaKardex30`
 *               (limitado a 0..120). Não muta as linhas originais.
 *
 * @param {Array<Object>} linhas
 * @param {('media3m'|'kardex30')} base
 * @returns {Array<Object>}
 */
function ajustarPme(linhas, base = 'media3m') {
  if (base !== 'kardex30') return linhas;
  return linhas.map((r) => {
    const fator = r.vendaKardex30 > 0 ? r.qtdMedia3m / r.vendaKardex30 : 1;
    const o = { ...r };
    COLS_PME.forEach((k) => {
      o[k] = Math.round(clamp((r[k] || 0) * fator, 0, 120));
    });
    return o;
  });
}

// ---------------------------------------------------------------------------
// Agregação de um conjunto de linhas
// ---------------------------------------------------------------------------

/**
 * Agrega um conjunto de linhas reproduzindo `aggregate()` do protótipo:
 *  - SOMA para quantidades/estoque e financeiras (ruptura, perdaHoje);
 *  - MÉDIA PONDERADA (peso = qtdMedia3m) para PME e leadTime.
 * Inclui também a `faixa` resultante do `pmeGeral` agregado.
 *
 * @param {Array<Object>} linhas
 * @returns {Object} medidas agregadas + `faixa`
 */
function agregar(linhas) {
  const out = {};
  COLS_SOMA.forEach((k) => {
    out[k] = linhas.reduce((s, r) => s + (r[k] || 0), 0);
  });
  COLS_WAVG.forEach((k) => {
    let somaPesada = 0;
    let somaPesos = 0;
    linhas.forEach((r) => {
      const peso = r.qtdMedia3m || 1;
      somaPesada += (r[k] || 0) * peso;
      somaPesos += peso;
    });
    out[k] = somaPesos ? somaPesada / somaPesos : 0;
  });
  out.faixa = faixaDe(out.pmeGeral);
  return out;
}

/**
 * Distribuição das linhas por faixa de cobertura (contagem por `pmeGeral`),
 * usada nos cartões "Saúde da cobertura".
 *
 * @param {Array<Object>} linhas
 * @returns {{rup:number, faixa:number, exc:number}}
 */
function distribuicaoFaixa(linhas) {
  const cont = { rup: 0, faixa: 0, exc: 0 };
  linhas.forEach((r) => { cont[faixaDe(r.pmeGeral)]++; });
  return cont;
}

// ---------------------------------------------------------------------------
// Agrupamento dinâmico
// ---------------------------------------------------------------------------

// Campos de identidade carregados no `meta` de cada grupo.
const CAMPOS_META = [
  'codsemDv', 'produto', 'cd', 'catN2', 'cat3', 'catN3', 'catN4', 'situacao',
  'com', 'log', 'analista', 'comprador'
];

function metaDe(linha) {
  const m = {};
  CAMPOS_META.forEach((k) => { m[k] = linha[k]; });
  return m;
}

/**
 * Agrupa as linhas e agrega cada grupo, reproduzindo `groupsFrom()` do protótipo.
 *   groupBy='produto' → um grupo por `codsemDv` (detalhe por CD em `linhas`).
 *   groupBy='cd'      → um grupo por CD (soma todos os produtos do CD).
 *   groupBy='total'   → um único grupo (total geral).
 *
 * @param {Array<Object>} linhas
 * @param {Object} [opts]
 * @param {('produto'|'cd'|'total')} [opts.groupBy='produto']
 * @param {string} [opts.sortKey='ruptura'] medida (ou 'produto'|'codsemDv'|'cds') de ordenação
 * @param {('asc'|'desc')} [opts.sortDir='desc']
 * @returns {Array<{key:string, cd?:number, meta:Object, linhas:Array<Object>, agg:Object}>}
 */
function agrupar(linhas, opts = {}) {
  const groupBy = MODOS_AGRUPAMENTO.includes(opts.groupBy) ? opts.groupBy : 'produto';
  const sortKey = opts.sortKey || 'ruptura';
  const dir = opts.sortDir === 'asc' ? 1 : -1;

  const map = new Map();
  if (groupBy === 'produto') {
    linhas.forEach((r) => {
      if (!map.has(r.codsemDv)) map.set(r.codsemDv, { key: r.codsemDv, meta: metaDe(r), linhas: [] });
      map.get(r.codsemDv).linhas.push(r);
    });
  } else if (groupBy === 'cd') {
    linhas.forEach((r) => {
      if (!map.has(r.cd)) map.set(r.cd, { key: 'cd' + r.cd, cd: r.cd, meta: metaDe(r), linhas: [] });
      map.get(r.cd).linhas.push(r);
    });
  } else if (linhas.length) {
    map.set('all', { key: 'all', meta: metaDe(linhas[0]), linhas: linhas.slice() });
  }

  const grupos = [];
  map.forEach((g) => { g.agg = agregar(g.linhas); grupos.push(g); });

  grupos.sort((a, b) => {
    if (groupBy === 'cd' && sortKey === 'cds') return (a.cd - b.cd) * dir;
    if (sortKey === 'produto') return a.meta.produto.localeCompare(b.meta.produto) * dir;
    if (sortKey === 'codsemDv') return (a.meta.codsemDv > b.meta.codsemDv ? 1 : -1) * dir;
    if (sortKey === 'cds') return (a.linhas.length - b.linhas.length) * dir;
    return ((a.agg[sortKey] || 0) - (b.agg[sortKey] || 0)) * dir;
  });

  return grupos;
}

// ---------------------------------------------------------------------------
// Ponto de entrada de alto nível
// ---------------------------------------------------------------------------

/**
 * Calcula o resumo completo do painel a partir das linhas cruas (produto × CD):
 * garante derivados (perdaHoje), aplica a base de demanda ao PME, agrupa,
 * agrega cada grupo e produz a linha de totais + a distribuição por faixa.
 *
 * @param {Array<Object>} linhas linhas no formato do contrato
 * @param {Object} [opts]
 * @param {('media3m'|'kardex30')} [opts.pmeBase='media3m']
 * @param {('produto'|'cd'|'total')} [opts.groupBy='produto']
 * @param {string} [opts.sortKey]
 * @param {('asc'|'desc')} [opts.sortDir]
 * @returns {{pmeBase:string, groupBy:string, grupos:Array, totais:Object, faixas:Object, total:number}}
 */
function resumir(linhas, opts = {}) {
  const pmeBase = BASES_PME.includes(opts.pmeBase) ? opts.pmeBase : 'media3m';
  const groupBy = MODOS_AGRUPAMENTO.includes(opts.groupBy) ? opts.groupBy : 'produto';

  const base = ajustarPme(garantirDerivados(linhas), pmeBase);
  const grupos = agrupar(base, { groupBy, sortKey: opts.sortKey, sortDir: opts.sortDir });

  return {
    pmeBase,
    groupBy,
    grupos,
    totais: agregar(base),
    faixas: distribuicaoFaixa(base),
    total: base.length
  };
}

module.exports = {
  COLS_SOMA,
  COLS_WAVG,
  COLS_PME,
  MODOS_AGRUPAMENTO,
  BASES_PME,
  faixaDe,
  perdaHojeDe,
  garantirDerivados,
  ajustarPme,
  agregar,
  distribuicaoFaixa,
  agrupar,
  resumir
};
