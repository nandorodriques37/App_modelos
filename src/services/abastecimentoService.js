'use strict';

const { gerarLinhas } = require('../data/mockData');
const { garantirDerivados } = require('./calculosService');
const { memoTTL } = require('../utils/cache');

/**
 * Camada de serviço do painel de abastecimento.
 *
 * Hoje a fonte de dados é o gerador simulado (mockData). Quando o back-end
 * real estiver pronto, troque `consultarFonte()` por uma consulta ao banco
 * que devolva linhas com os mesmos campos do contrato
 * (docs/design_handoff_backend/README.md) — o resto da aplicação não muda.
 *
 * Performance: a carga da fonte passa por um cache com TTL (memoTTL). Assim a
 * "consulta" (cara) é feita uma vez por janela e os requests seguintes apenas
 * filtram/agregam sobre o dataset já em memória — com os campos derivados
 * (perdaHoje/catN3) garantidos uma única vez por carga.
 */

// Dimensões que aceitam filtro multi-valor (ex.: ?cat3=DIABETES,GASTRO).
const DIMENSOES_MULTI = [
  'produto',
  'situacao',
  'catN2',
  'cat3',
  'catN4',
  'com',
  'log',
  'analista',
  'comprador'
];

// TTL do cache do dataset (ms). Com dados simulados (determinísticos) pode ser
// longo; com banco real, ajuste via env para o frescor desejado.
const CACHE_TTL_MS = Number(process.env.DADOS_CACHE_TTL_MS || 60000);

// "Consulta" à fonte de dados. PONTO DE TROCA para o banco real.
// Garante os derivados (perdaHoje/catN3) uma vez por carga, para que filtros e
// agregações nas requisições seguintes não precisem recalcular linha a linha.
function consultarFonte() {
  return garantirDerivados(gerarLinhas());
}

const carregarCache = memoTTL(consultarFonte, CACHE_TTL_MS);

// Retorna o dataset (de cache). Não mutar as linhas devolvidas — são compartilhadas.
function carregarLinhas() {
  return carregarCache();
}

// Invalida o cache do dataset (ex.: após uma escrita no banco). Próxima carga reconsulta.
function invalidarCache() {
  carregarCache.invalidar();
}

// Momento (ISO) da última carga efetiva do dataset — base para `geradoEm`/ETag estável.
function geradoEm() {
  return new Date(carregarCache.carregadoEm()).toISOString();
}

// Normaliza um valor de query em lista (aceita "a,b" ou ["a","b"]).
function comoLista(valor) {
  if (valor == null) return null;
  const arr = Array.isArray(valor) ? valor : String(valor).split(',');
  const limpos = arr.map((v) => String(v).trim()).filter(Boolean);
  return limpos.length ? limpos : null;
}

/**
 * Aplica os filtros do contrato sobre as linhas. Filtros ausentes são
 * ignorados, então sem query devolve tudo (estratégia "simples" do handoff).
 *
 * @param {Array<Object>} linhas
 * @param {Object} query - req.query do Express
 * @returns {Array<Object>}
 */
function filtrar(linhas, query = {}) {
  const filtros = {};
  DIMENSOES_MULTI.forEach((dim) => {
    const lista = comoLista(query[dim] ?? query[dim === 'cat3' ? 'catN3' : dim]);
    if (lista) filtros[dim] = new Set(lista);
  });

  const cd = query.cd != null && query.cd !== '' ? Number(query.cd) : null;
  const busca = (query.search || query.q || '').trim().toLowerCase();

  return linhas.filter((r) => {
    for (const dim of DIMENSOES_MULTI) {
      if (filtros[dim] && !filtros[dim].has(r[dim])) return false;
    }
    if (cd != null && !Number.isNaN(cd) && r.cd !== cd) return false;
    if (
      busca &&
      !(String(r.produto).toLowerCase().includes(busca) || String(r.codsemDv).includes(busca))
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Retorna as linhas do painel já filtradas pelo escopo da query.
 * @param {Object} query
 * @returns {Array<Object>} linhas no formato do contrato
 */
function listarLinhas(query = {}) {
  return filtrar(carregarLinhas(), query);
}

module.exports = {
  listarLinhas,
  carregarLinhas,
  invalidarCache,
  geradoEm,
  filtrar,
  DIMENSOES_MULTI
};
