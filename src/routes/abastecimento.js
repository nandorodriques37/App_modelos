'use strict';

const express = require('express');
const { geradoEm } = require('../services/abastecimentoService');
const { obterResumo, obterLinhas, usandoDatabricks } = require('../services/resumoService');

const router = express.Router();

// Cache HTTP curto: junto do `geradoEm` estável (timestamp da carga, não do
// request) permite que o ETag do Express devolva 304 em requisições idênticas.
const CACHE_HTTP = 'public, max-age=30';

// `geradoEm` só faz sentido para a carga em cache do mock; com Databricks (dados
// ao vivo) usamos o instante da resposta.
function geradoEmAtual() {
  return usandoDatabricks() ? new Date().toISOString() : geradoEm();
}

/**
 * GET /api/abastecimento
 *
 * Devolve { linhas: [...] } no formato do contrato (uma linha por produto × CD).
 *
 * Com Databricks configurado a consulta é SEMPRE paginada (nunca devolve as
 * 700k linhas); use `?pagina` e `?tamanhoPagina`. No mock devolve o conjunto
 * filtrado (pequeno).
 *
 * Filtros opcionais via query (todos combináveis; ausentes = sem filtro):
 *   ?produto=, ?situacao=, ?catN2=, ?cat3= (ou ?catN3=), ?catN4=,
 *   ?com=, ?log=, ?analista=, ?comprador=  -> multi-valor: "A,B"
 *   ?cd=3                                   -> CD único
 *   ?search= / ?q=                          -> busca em produto + codsemDv
 *   ?pmeBase=, ?pagina=, ?tamanhoPagina=, ?sortKey=, ?sortDir=
 */
router.get('/abastecimento', async (req, res, next) => {
  try {
    const linhas = await obterLinhas(req.query);
    res.set('Cache-Control', CACHE_HTTP);
    res.json({ linhas, total: linhas.length, fonte: usandoDatabricks() ? 'databricks' : 'mock', geradoEm: geradoEmAtual() });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/abastecimento/resumo
 *
 * Endpoint principal do painel (consumido pelo Lovable). Devolve os dados já
 * CALCULADOS no back-end: PME (média ponderada + base de demanda), ruptura
 * projetada (soma), perda hoje (derivada + soma), faixa de cobertura,
 * agrupamento dinâmico, paginação e linha de totais. Com Databricks, todo o
 * cálculo é empurrado como SQL para o warehouse.
 *
 * Aceita os mesmos filtros de /abastecimento, mais:
 *   ?pmeBase=media3m|kardex30   -> base de demanda do PME (padrão: media3m)
 *   ?groupBy=produto|cd|total   -> agrupamento (padrão: produto)
 *   ?sortKey=<medida>|produto|codsemDv|cds   -> ordenação (padrão: ruptura)
 *   ?sortDir=asc|desc           -> direção (padrão: desc)
 *   ?pagina=2                   -> página dos grupos, 1-based (padrão: 1)
 *   ?tamanhoPagina=50           -> grupos por página (0 ou ?todos=true = sem paginação)
 *   ?detalhe=true               -> inclui as linhas (produto × CD) de cada grupo
 *
 * Resposta: { pmeBase, groupBy, grupos:[{key, cd?, meta, agg, qtdLinhas, linhas?}],
 *             totais, faixas:{rup,faixa,exc}, total, totalGrupos, pagina,
 *             tamanhoPagina, totalPaginas, fonte, geradoEm }
 */
router.get('/abastecimento/resumo', async (req, res, next) => {
  try {
    const resumo = await obterResumo(req.query);
    res.set('Cache-Control', CACHE_HTTP);
    res.json({ ...resumo, fonte: usandoDatabricks() ? 'databricks' : 'mock', geradoEm: geradoEmAtual() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
