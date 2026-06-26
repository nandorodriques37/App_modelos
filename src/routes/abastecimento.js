'use strict';

const express = require('express');
const { listarLinhas } = require('../services/abastecimentoService');

const router = express.Router();

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
    res.json({ linhas, total: linhas.length, geradoEm: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
