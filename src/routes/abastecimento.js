'use strict';

const express = require('express');
const { listarLinhas, geradoEm } = require('../services/abastecimentoService');
const { resumir } = require('../services/calculosService');

const router = express.Router();

// Cache HTTP curto: junto do `geradoEm` estável (timestamp da carga, não do
// request) permite que o ETag do Express devolva 304 em requisições idênticas.
const CACHE_HTTP = 'public, max-age=30';

/**
 * GET /api/abastecimento
 *
 * Devolve { linhas: [...] } no formato do contrato (uma linha por produto × CD).
 * É o "ponto único de integração" consumido pelo front-end
 * (window.ABASTECIMENTO_API_URL / buildFromRows).
 *
 * Filtros opcionais via query (todos combináveis; ausentes = sem filtro):
 *   ?produto=, ?situacao=, ?catN2=, ?cat3= (ou ?catN3=), ?catN4=,
 *   ?com=, ?log=, ?analista=, ?comprador=  -> multi-valor: "A,B"
 *   ?cd=3                                   -> CD único
 *   ?search= / ?q=                          -> busca em produto + codsemDv
 */
router.get('/abastecimento', (req, res, next) => {
  try {
    const linhas = listarLinhas(req.query);
    res.set('Cache-Control', CACHE_HTTP);
    res.json({ linhas, total: linhas.length, geradoEm: geradoEm() });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/abastecimento/resumo
 *
 * Devolve os dados já CALCULADOS no servidor (estratégia "Escalável" do handoff),
 * reproduzindo as fórmulas do front-end: PME (média ponderada + base de demanda),
 * ruptura projetada (soma), perda hoje (derivada + soma), faixa de cobertura,
 * agrupamento dinâmico e linha de totais.
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
 *             tamanhoPagina, totalPaginas, geradoEm }
 */
router.get('/abastecimento/resumo', (req, res, next) => {
  try {
    const linhas = listarLinhas(req.query);
    const resumo = resumir(linhas, {
      pmeBase: req.query.pmeBase,
      groupBy: req.query.groupBy,
      sortKey: req.query.sortKey,
      sortDir: req.query.sortDir,
      pagina: req.query.pagina,
      tamanhoPagina: req.query.tamanhoPagina,
      todos: req.query.todos === 'true' || req.query.todos === '1',
      incluirLinhas: req.query.detalhe === 'true' || req.query.incluirLinhas === 'true'
    });
    res.set('Cache-Control', CACHE_HTTP);
    res.json({ ...resumo, geradoEm: geradoEm() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
