'use strict';

/**
 * Serviço de resumo do painel — ponto de DESPACHO entre as fontes de dados:
 *
 *   • Databricks (produção): quando configurado (ver src/databricks/cliente.js),
 *     todo o cálculo é empurrado como SQL para o warehouse — escala para 700k+.
 *   • Mock (desenvolvimento): cai no gerador determinístico + cálculo em JS
 *     (calculosService), para rodar/local e testes sem banco.
 *
 * Ambos devolvem EXATAMENTE o mesmo formato, então a rota e o front-end/Lovable
 * não sabem (nem precisam saber) qual fonte respondeu.
 */

const { listarLinhas: listarLinhasMock } = require('./abastecimentoService');
const calculos = require('./calculosService');
const databricks = require('../databricks/fonte');

// Dimensões com filtro multi-valor (alinhado ao contrato).
const DIMENSOES_MULTI = [
  'produto', 'situacao', 'catN2', 'cat3', 'catN4', 'com', 'log', 'analista', 'comprador'
];

// Normaliza um valor de query em lista (aceita "a,b" ou ["a","b"]).
function comoLista(valor) {
  if (valor == null) return null;
  const arr = Array.isArray(valor) ? valor : String(valor).split(',');
  const limpos = arr.map((v) => String(v).trim()).filter(Boolean);
  return limpos.length ? limpos : null;
}

function bool(v) {
  return v === true || v === 'true' || v === '1';
}

/**
 * Converte a query da requisição nas opções normalizadas usadas pelas fontes.
 * @param {Object} query req.query
 * @returns {Object}
 */
function parseOpts(query = {}) {
  const opts = {
    pmeBase: query.pmeBase,
    groupBy: query.groupBy,
    sortKey: query.sortKey,
    sortDir: query.sortDir,
    pagina: query.pagina,
    tamanhoPagina: query.tamanhoPagina,
    todos: bool(query.todos),
    incluirLinhas: bool(query.detalhe) || bool(query.incluirLinhas),
    cd: query.cd != null && query.cd !== '' ? Number(query.cd) : null,
    busca: (query.search || query.q || '').trim() || null
  };
  DIMENSOES_MULTI.forEach((dim) => {
    const lista = comoLista(query[dim] ?? (dim === 'cat3' ? query.catN3 : undefined));
    if (lista) opts[dim] = lista;
  });
  return opts;
}

function usandoDatabricks() {
  return databricks.estaConfigurado();
}

/**
 * Resumo agregado (PME, ruptura, perda, faixa, totais), já calculado na fonte.
 * @param {Object} query req.query
 * @returns {Promise<Object>}
 */
async function obterResumo(query = {}) {
  const opts = parseOpts(query);
  if (usandoDatabricks()) {
    return databricks.resumir(opts);
  }
  // Fallback mock: filtra o dataset em memória e calcula em JS.
  const linhas = listarLinhasMock(query);
  return calculos.resumir(linhas, opts);
}

/**
 * Linhas (produto × CD) já derivadas. No Databricks é sempre paginada; no mock
 * devolve o conjunto filtrado (pequeno).
 * @param {Object} query req.query
 * @returns {Promise<Array<Object>>}
 */
async function obterLinhas(query = {}) {
  if (usandoDatabricks()) {
    return databricks.listarLinhas(parseOpts(query));
  }
  return listarLinhasMock(query);
}

module.exports = { obterResumo, obterLinhas, usandoDatabricks, parseOpts, DIMENSOES_MULTI };
