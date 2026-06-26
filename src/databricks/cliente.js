'use strict';

/**
 * Cliente do Databricks SQL — executa SQL num SQL Warehouse via a
 * Statement Execution API (REST), usando `fetch` nativo (Node 18+), sem
 * dependências extras.
 *
 * Config por ambiente (.env / variáveis do deploy):
 *   DATABRICKS_HOST          ex.: dbc-xxxx.cloud.databricks.com (sem https://)
 *   DATABRICKS_TOKEN         Personal Access Token (ou OAuth) — secret
 *   DATABRICKS_WAREHOUSE_ID  id do SQL Warehouse
 *   DATABRICKS_CATALOG / DATABRICKS_SCHEMA / DATABRICKS_TABLE  (ver contrato.js)
 *
 * Sem essas variáveis, `estaConfigurado()` retorna false e a aplicação cai no
 * mock (dev) — o contrato da API não muda.
 */

const HOST = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const WAREHOUSE_ID = process.env.DATABRICKS_WAREHOUSE_ID;
const CATALOG = process.env.DATABRICKS_CATALOG;
const SCHEMA = process.env.DATABRICKS_SCHEMA;

// Tempo máximo (ms) de espera ativa por uma consulta antes de desistir.
const TIMEOUT_MS = Number(process.env.DATABRICKS_TIMEOUT_MS || 60000);

function estaConfigurado() {
  return Boolean(HOST && TOKEN && WAREHOUSE_ID);
}

function baseUrl() {
  return `https://${HOST}/api/2.0/sql/statements`;
}

function headers() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json'
  };
}

async function comoJson(res, contexto) {
  const texto = await res.text();
  let corpo;
  try {
    corpo = texto ? JSON.parse(texto) : {};
  } catch (e) {
    throw new Error(`Databricks: resposta não-JSON (${contexto}): ${texto.slice(0, 200)}`);
  }
  if (!res.ok) {
    const msg = corpo && (corpo.message || corpo.error || JSON.stringify(corpo));
    throw new Error(`Databricks HTTP ${res.status} (${contexto}): ${msg}`);
  }
  return corpo;
}

// Converte o resultado da API (manifest + result.data_array) em array de objetos
// { coluna: valor } com tipos numéricos já convertidos.
function linhasDoResultado(payload) {
  const colunas = (payload.manifest && payload.manifest.schema && payload.manifest.schema.columns) || [];
  const dados = (payload.result && payload.result.data_array) || [];
  return dados.map((linha) => {
    const obj = {};
    colunas.forEach((c, i) => {
      const bruto = linha[i];
      obj[c.name] = converter(bruto, c.type_name);
    });
    return obj;
  });
}

function converter(valor, tipo) {
  if (valor == null) return null;
  switch (tipo) {
    case 'INT': case 'BIGINT': case 'SHORT': case 'LONG': case 'BYTE':
      return parseInt(valor, 10);
    case 'FLOAT': case 'DOUBLE': case 'DECIMAL':
      return Number(valor);
    default:
      return valor;
  }
}

/**
 * Executa um SQL e devolve as linhas como objetos. Faz polling até o statement
 * concluir (ou estourar TIMEOUT_MS). Resultados aqui são SEMPRE pequenos
 * (página de grupos / linha de totais), então o data_array inline basta.
 *
 * @param {string} sql
 * @returns {Promise<Array<Object>>}
 */
async function executarSql(sql) {
  if (!estaConfigurado()) {
    throw new Error('Databricks não configurado (defina DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_WAREHOUSE_ID).');
  }

  const corpo = {
    statement: sql,
    warehouse_id: WAREHOUSE_ID,
    wait_timeout: '30s',
    on_wait_timeout: 'CONTINUE',
    format: 'JSON_ARRAY',
    disposition: 'INLINE'
  };
  if (CATALOG) corpo.catalog = CATALOG;
  if (SCHEMA) corpo.schema = SCHEMA;

  let payload = await comoJson(
    await fetch(baseUrl(), { method: 'POST', headers: headers(), body: JSON.stringify(corpo) }),
    'submit'
  );

  const inicio = Date.now();
  while (payload.status && (payload.status.state === 'PENDING' || payload.status.state === 'RUNNING')) {
    if (Date.now() - inicio > TIMEOUT_MS) {
      throw new Error(`Databricks: timeout (${TIMEOUT_MS}ms) aguardando o statement ${payload.statement_id}`);
    }
    await espera(700);
    payload = await comoJson(
      await fetch(`${baseUrl()}/${payload.statement_id}`, { method: 'GET', headers: headers() }),
      'poll'
    );
  }

  const estado = payload.status && payload.status.state;
  if (estado !== 'SUCCEEDED') {
    const erro = payload.status && payload.status.error && payload.status.error.message;
    throw new Error(`Databricks: statement ${estado || 'sem estado'}${erro ? ' — ' + erro : ''}`);
  }

  return linhasDoResultado(payload);
}

function espera(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { estaConfigurado, executarSql, linhasDoResultado, converter };
