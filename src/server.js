'use strict';

const path = require('path');
const express = require('express');

const abastecimentoRouter = require('./routes/abastecimento');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// CORS simples — permite que o painel rode em outra origem durante o dev.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Healthcheck.
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// API.
app.use('/api', abastecimentoRouter);

// Front-end estático (protótipo de design servido como SPA).
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// Tratamento de erros.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[erro]', err);
  res.status(500).json({ erro: 'Erro interno', detalhe: err.message });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Gestão de Abastecimento rodando em http://localhost:${PORT}`);
    console.log(`  • Painel:  http://localhost:${PORT}/`);
    console.log(`  • API:     http://localhost:${PORT}/api/abastecimento`);
  });
}

module.exports = app;
