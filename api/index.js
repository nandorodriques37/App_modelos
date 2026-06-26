'use strict';

/**
 * Entrypoint da Serverless Function da Vercel.
 *
 * Reexporta o app Express (src/server.js). Como `require.main !== module`
 * neste contexto, o server NÃO chama app.listen() — a Vercel invoca o app
 * como handler (req, res). Localmente continua-se usando `npm start`.
 */
module.exports = require('../src/server');
