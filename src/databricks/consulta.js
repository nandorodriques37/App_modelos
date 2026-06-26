'use strict';

/**
 * Construtor de SQL (Spark SQL / Databricks) do resumo de abastecimento.
 *
 * Gera as consultas que rodam NO DATABRICKS — a derivação das medidas (via o
 * seam de fórmulas em contrato.js) e TODA a agregação (somas, médias ponderadas
 * de PME, faixa, agrupamento e paginação) acontecem no banco. O Node só recebe
 * o resultado pequeno (a página de grupos + a linha de totais), nunca as 700k
 * linhas brutas.
 *
 * As fórmulas (sum vs. média ponderada, cortes de faixa, fator Kardex) são as
 * MESMAS de src/services/calculosService.js — as listas de colunas são
 * importadas de lá para não divergir.
 */

const { COLS_SOMA, COLS_WAVG, COLS_PME } = require('../services/calculosService');
const {
  tabelaFQN,
  COLUNAS_IDENTIDADE,
  EXPRESSOES,
  EXPR_PERDA_HOJE
} = require('./contrato');

// Dimensões com filtro multi-valor (mesmo conjunto do serviço).
const DIMENSOES_MULTI = [
  'produto', 'situacao', 'catN2', 'cat3', 'catN4', 'com', 'log', 'analista', 'comprador'
];

// Chaves de ordenação válidas (medidas + identidade) — whitelist anti-injeção.
const SORT_KEYS = new Set([...COLS_SOMA, ...COLS_WAVG, 'produto', 'codsemDv', 'cds']);

const PME_SET = new Set(COLS_PME);

// ---------------------------------------------------------------------------
// helpers de literal/identificador seguros
// ---------------------------------------------------------------------------

// Escapa um literal string para SQL (dobra aspas simples).
function lit(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

// Inteiro validado (ou null).
function intOuNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// Expressão SQL bruta de uma medida do contrato (deriva do bruto via o seam).
function exprMedida(campo) {
  if (campo === 'perdaHoje') return EXPR_PERDA_HOJE;
  return EXPRESSOES[campo];
}

// Valor por linha do PME já na BASE escolhida (Kardex aplica fator + clamp/round).
function pmeEfetivo(campo, pmeBase) {
  const ref = '`' + campo + '`';
  if (pmeBase === 'kardex30' && PME_SET.has(campo)) {
    return `ROUND(LEAST(120, GREATEST(0, ${ref} * f)))`;
  }
  return ref;
}

// Média ponderada (peso = qtdMedia3m || 1) de um campo já efetivo.
function wavg(campo, pmeBase) {
  return `SUM(${pmeEfetivo(campo, pmeBase)} * w) / NULLIF(SUM(w), 0)`;
}

// ---------------------------------------------------------------------------
// WHERE (filtros do contrato)
// ---------------------------------------------------------------------------

function montarWhere(opts = {}) {
  const cond = [];
  DIMENSOES_MULTI.forEach((dim) => {
    const valores = opts[dim];
    if (Array.isArray(valores) && valores.length) {
      const col = COLUNAS_IDENTIDADE[dim] || dim;
      cond.push(`${col} IN (${valores.map(lit).join(', ')})`);
    }
  });
  const cd = intOuNull(opts.cd);
  if (cd != null) cond.push(`${COLUNAS_IDENTIDADE.cd} = ${cd}`);

  const busca = (opts.busca || '').trim();
  if (busca) {
    const termo = lit('%' + busca.toLowerCase() + '%');
    cond.push(
      `(LOWER(${COLUNAS_IDENTIDADE.produto}) LIKE ${termo} ` +
      `OR ${COLUNAS_IDENTIDADE.codsemDv} LIKE ${lit('%' + busca + '%')})`
    );
  }
  return cond.length ? 'WHERE ' + cond.join('\n    AND ') : '';
}

// ---------------------------------------------------------------------------
// CTE base: deriva cada medida do bruto + peso (w) e fator Kardex (f) por linha
// ---------------------------------------------------------------------------

function cteBase(opts) {
  const ids = Object.entries(COLUNAS_IDENTIDADE)
    .map(([campo, col]) => `${col} AS \`${campo}\``);

  const medidas = [...COLS_SOMA, ...COLS_WAVG]
    .map((campo) => `${exprMedida(campo)} AS \`${campo}\``);

  const w = `CASE WHEN COALESCE(${EXPRESSOES.qtdMedia3m}, 0) = 0 THEN 1 ELSE ${EXPRESSOES.qtdMedia3m} END AS w`;
  const f = `CASE WHEN ${EXPRESSOES.vendaKardex30} > 0 THEN ${EXPRESSOES.qtdMedia3m} / ${EXPRESSOES.vendaKardex30} ELSE 1 END AS f`;

  return (
    'base AS (\n' +
    '  SELECT\n    ' +
    [...ids, ...medidas, w, f].join(',\n    ') +
    `\n  FROM ${tabelaFQN()}\n  ` +
    montarWhere(opts) +
    '\n)'
  );
}

// Lista de agregações das medidas (somas + médias ponderadas) com alias camelCase.
function selectsMedidas(pmeBase) {
  const somas = COLS_SOMA.map((c) => `SUM(\`${c}\`) AS \`${c}\``);
  const medias = COLS_WAVG.map((c) => `${wavg(c, pmeBase)} AS \`${c}\``);
  return [...somas, ...medias];
}

// ---------------------------------------------------------------------------
// Query dos GRUPOS (página) — agrupa, agrega, ordena e pagina no banco
// ---------------------------------------------------------------------------

function ordenacao(opts) {
  const sortKey = SORT_KEYS.has(opts.sortKey) ? opts.sortKey : 'ruptura';
  const dir = opts.sortDir === 'asc' ? 'ASC' : 'DESC';
  if (sortKey === 'produto') return 'ORDER BY `produto` ' + dir;
  if (sortKey === 'codsemDv') return 'ORDER BY `key` ' + dir;
  if (sortKey === 'cds') return 'ORDER BY `qtdLinhas` ' + dir;
  return 'ORDER BY `' + sortKey + '` ' + dir;
}

function sqlGrupos(opts = {}) {
  const groupBy = ['produto', 'cd', 'total'].includes(opts.groupBy) ? opts.groupBy : 'produto';
  const pmeBase = opts.pmeBase === 'kardex30' ? 'kardex30' : 'media3m';

  // Identidade exposta no `meta` de cada grupo.
  const metaCampos = Object.keys(COLUNAS_IDENTIDADE);

  let chave;
  let groupByClause;
  let metaSelects;
  if (groupBy === 'produto') {
    chave = '`codsemDv`';
    groupByClause = 'GROUP BY `codsemDv`';
    metaSelects = metaCampos.map((c) =>
      c === 'codsemDv' ? '`codsemDv` AS `m_codsemDv`'
        : c === 'cd' ? 'CAST(NULL AS INT) AS `m_cd`'
          : `MAX(\`${c}\`) AS \`m_${c}\``);
  } else if (groupBy === 'cd') {
    chave = "CONCAT('cd', `cd`)";
    groupByClause = 'GROUP BY `cd`';
    metaSelects = metaCampos.map((c) =>
      c === 'cd' ? '`cd` AS `m_cd`' : `MAX(\`${c}\`) AS \`m_${c}\``);
  } else {
    chave = "'all'";
    groupByClause = '';
    metaSelects = metaCampos.map((c) =>
      c === 'cd' ? 'CAST(NULL AS INT) AS `m_cd`' : `MAX(\`${c}\`) AS \`m_${c}\``);
  }

  const limit = Math.max(0, intOuNull(opts.tamanhoPagina) ?? 50);
  const pagina = Math.max(1, intOuNull(opts.pagina) || 1);
  const offset = (pagina - 1) * limit;
  const paginacao = limit > 0 ? `LIMIT ${limit} OFFSET ${offset}` : '';

  const linhas = [
    'WITH ' + cteBase(opts),
    'SELECT',
    '  ' + [
      `${chave} AS \`key\``,
      ...metaSelects,
      'COUNT(*) AS `qtdLinhas`',
      ...selectsMedidas(pmeBase),
      'COUNT(*) OVER () AS `totalGrupos`'
    ].join(',\n  '),
    'FROM base',
    groupByClause,
    ordenacao(opts),
    paginacao
  ].filter(Boolean);

  return linhas.join('\n');
}

// ---------------------------------------------------------------------------
// Query de LINHAS (produto × CD) já derivadas — sempre paginada (nunca 700k)
// ---------------------------------------------------------------------------

function sqlLinhas(opts = {}) {
  const pmeBase = opts.pmeBase === 'kardex30' ? 'kardex30' : 'media3m';

  const ids = Object.keys(COLUNAS_IDENTIDADE).map((c) => `\`${c}\``);
  const somas = COLS_SOMA.map((c) => `\`${c}\``);
  // PME por linha já na base escolhida (Kardex aplica fator/clamp).
  const pmes = COLS_WAVG.map((c) => `${pmeEfetivo(c, pmeBase)} AS \`${c}\``);

  const limitBruto = intOuNull(opts.tamanhoPagina);
  const limit = limitBruto == null ? 200 : Math.max(0, limitBruto); // teto padrão de segurança
  const pagina = Math.max(1, intOuNull(opts.pagina) || 1);
  const offset = (pagina - 1) * (limit || 0);
  const paginacao = limit > 0 ? `LIMIT ${limit} OFFSET ${offset}` : 'LIMIT 1000';

  return [
    'WITH ' + cteBase(opts),
    'SELECT',
    '  ' + [...ids, ...somas, ...pmes].join(',\n  '),
    'FROM base',
    ordenacao(opts),
    paginacao
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Query dos TOTAIS + distribuição por faixa (sobre o conjunto filtrado inteiro)
// ---------------------------------------------------------------------------

function sqlTotais(opts = {}) {
  const pmeBase = opts.pmeBase === 'kardex30' ? 'kardex30' : 'media3m';
  const pmeGeralEff = pmeEfetivo('pmeGeral', pmeBase);

  const faixa = [
    `SUM(CASE WHEN ${pmeGeralEff} < 20 THEN 1 ELSE 0 END) AS \`faixaRup\``,
    `SUM(CASE WHEN ${pmeGeralEff} >= 20 AND ${pmeGeralEff} <= 40 THEN 1 ELSE 0 END) AS \`faixaFaixa\``,
    `SUM(CASE WHEN ${pmeGeralEff} > 40 THEN 1 ELSE 0 END) AS \`faixaExc\``
  ];

  return [
    'WITH ' + cteBase(opts),
    'SELECT',
    '  ' + [
      'COUNT(*) AS `total`',
      ...selectsMedidas(pmeBase),
      ...faixa
    ].join(',\n  '),
    'FROM base'
  ].join('\n');
}

module.exports = {
  DIMENSOES_MULTI,
  SORT_KEYS,
  montarWhere,
  sqlGrupos,
  sqlTotais,
  sqlLinhas,
  // exportados para teste
  _internos: { lit, intOuNull, pmeEfetivo, wavg, cteBase }
};
