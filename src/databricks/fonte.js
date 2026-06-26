'use strict';

/**
 * Fonte Databricks do resumo — orquestra as consultas (consulta.js) no
 * SQL Warehouse (cliente.js) e monta a MESMA estrutura devolvida por
 * calculosService.resumir(), para que a rota/contrato não mude conforme a
 * fonte (mock x Databricks).
 *
 * O cálculo pesado roda no Databricks; aqui só montamos o JSON do resumo a
 * partir dos resultados já agregados (página de grupos + linha de totais).
 */

const { executarSql, estaConfigurado } = require('./cliente');
const { sqlGrupos, sqlTotais, sqlLinhas } = require('./consulta');
const {
  COLS_SOMA,
  COLS_WAVG,
  faixaDe
} = require('../services/calculosService');

const { COLUNAS_IDENTIDADE } = require('./contrato');

const CAMPOS_MEDIDA = [...COLS_SOMA, ...COLS_WAVG];
const CAMPOS_META = Object.keys(COLUNAS_IDENTIDADE);

// Monta o objeto `agg` (medidas) a partir de uma linha de resultado.
function aggDe(linha) {
  const agg = {};
  CAMPOS_MEDIDA.forEach((c) => { agg[c] = num(linha[c]); });
  agg.faixa = faixaDe(agg.pmeGeral);
  return agg;
}

// Monta o `meta` (identidade) a partir das colunas m_<campo>.
function metaDe(linha) {
  const meta = {};
  CAMPOS_META.forEach((c) => { meta[c] = linha['m_' + c] ?? null; });
  if (meta.catN3 == null) meta.catN3 = meta.cat3; // alias do contrato
  return meta;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Calcula o resumo consultando o Databricks. Mesma assinatura/saída de
 * calculosService.resumir().
 *
 * @param {Object} opts {pmeBase, groupBy, sortKey, sortDir, pagina, tamanhoPagina, incluirLinhas, + filtros}
 * @returns {Promise<Object>}
 */
async function resumir(opts = {}) {
  const pmeBase = opts.pmeBase === 'kardex30' ? 'kardex30' : 'media3m';
  const groupBy = ['produto', 'cd', 'total'].includes(opts.groupBy) ? opts.groupBy : 'produto';
  const tamanhoPagina = Number.isFinite(Number(opts.tamanhoPagina))
    ? Math.max(0, Math.trunc(Number(opts.tamanhoPagina))) : 50;
  const pagina = Math.max(1, Math.trunc(Number(opts.pagina) || 1));

  // As duas consultas são independentes — roda em paralelo.
  const [linhasGrupos, linhasTotais] = await Promise.all([
    executarSql(sqlGrupos({ ...opts, pmeBase, groupBy, tamanhoPagina, pagina })),
    executarSql(sqlTotais({ ...opts, pmeBase }))
  ]);

  const grupos = linhasGrupos.map((g) => ({
    key: g.key,
    ...(groupBy === 'cd' ? { cd: num(g.m_cd) } : {}),
    meta: metaDe(g),
    agg: aggDe(g),
    qtdLinhas: num(g.qtdLinhas)
  }));

  const totalGrupos = linhasGrupos.length ? num(linhasGrupos[0].totalGrupos) : 0;

  const t = linhasTotais[0] || {};
  const totais = aggDe(t);
  const faixas = {
    rup: num(t.faixaRup),
    faixa: num(t.faixaFaixa),
    exc: num(t.faixaExc)
  };
  const total = num(t.total);

  return {
    pmeBase,
    groupBy,
    grupos,
    totais,
    faixas,
    total,
    totalGrupos,
    pagina,
    tamanhoPagina,
    totalPaginas: tamanhoPagina ? Math.ceil(totalGrupos / tamanhoPagina) || 1 : 1
  };
}

/**
 * Lista linhas (produto × CD) já derivadas, sempre paginadas, consultando o
 * Databricks. Para o endpoint cru / detalhe por produto — nunca despeja 700k.
 *
 * @param {Object} opts {pmeBase, sortKey, sortDir, pagina, tamanhoPagina, + filtros}
 * @returns {Promise<Array<Object>>}
 */
async function listarLinhas(opts = {}) {
  const linhas = await executarSql(sqlLinhas(opts));
  return linhas.map((r) => {
    if (r.catN3 == null && r.cat3 != null) r.catN3 = r.cat3;
    return r;
  });
}

module.exports = { resumir, listarLinhas, estaConfigurado };
