'use strict';

// Configura o Databricks ANTES de carregar os módulos (o cliente lê env no load).
process.env.DATABRICKS_HOST = 'dbc-teste.cloud.databricks.com';
process.env.DATABRICKS_TOKEN = 'token-teste';
process.env.DATABRICKS_WAREHOUSE_ID = 'wh-123';
process.env.DATABRICKS_CATALOG = 'main';
process.env.DATABRICKS_SCHEMA = 'abastecimento';
process.env.DATABRICKS_TABLE = 'linhas_brutas';

const { test } = require('node:test');
const assert = require('node:assert');

const { sqlGrupos, sqlTotais, sqlLinhas } = require('../src/databricks/consulta');
const cliente = require('../src/databricks/cliente');
const fonte = require('../src/databricks/fonte');

// ---------------------------------------------------------------------------
// Construtor de SQL
// ---------------------------------------------------------------------------

test('sqlGrupos: filtros, agrupamento, ordenação e paginação no SQL', () => {
  const sql = sqlGrupos({
    groupBy: 'cd', pmeBase: 'media3m', cat3: ['DIABETES', 'GASTRO'], cd: 3,
    sortKey: 'ruptura', sortDir: 'desc', pagina: 2, tamanhoPagina: 5
  });
  assert.match(sql, /FROM main\.abastecimento\.linhas_brutas/);
  assert.match(sql, /cat3 IN \('DIABETES', 'GASTRO'\)/);
  assert.match(sql, /cd = 3/);
  assert.match(sql, /GROUP BY `cd`/);
  assert.match(sql, /ORDER BY `ruptura` DESC/);
  assert.match(sql, /LIMIT 5 OFFSET 5/); // página 2
  assert.match(sql, /COUNT\(\*\) OVER \(\) AS `totalGrupos`/);
});

test('sqlGrupos kardex30 arredonda/clampa o PME por linha antes de ponderar', () => {
  const sql = sqlGrupos({ groupBy: 'produto', pmeBase: 'kardex30' });
  assert.match(sql, /SUM\(ROUND\(LEAST\(120, GREATEST\(0, `pmeGeral` \* f\)\)\) \* w\) \/ NULLIF\(SUM\(w\), 0\)/);
});

test('sqlGrupos media3m pondera o PME direto (sem round/clamp)', () => {
  const sql = sqlGrupos({ groupBy: 'produto', pmeBase: 'media3m' });
  assert.match(sql, /SUM\(`pmeGeral` \* w\) \/ NULLIF\(SUM\(w\), 0\)/);
  assert.doesNotMatch(sql, /ROUND\(LEAST\(120/);
});

test('sqlTotais traz somas, médias ponderadas e a distribuição por faixa', () => {
  const sql = sqlTotais({ pmeBase: 'media3m' });
  assert.match(sql, /SUM\(`ruptura`\) AS `ruptura`/);
  assert.match(sql, /SUM\(`perdaHoje`\) AS `perdaHoje`/);
  assert.match(sql, /CASE WHEN `pmeGeral` < 20 THEN 1 ELSE 0 END/);
  assert.match(sql, /CASE WHEN `pmeGeral` >= 20 AND `pmeGeral` <= 40 THEN 1 ELSE 0 END/);
});

test('sqlLinhas é sempre paginada (nunca despeja tudo)', () => {
  assert.match(sqlLinhas({}), /LIMIT 200 OFFSET 0/);
  assert.match(sqlLinhas({ tamanhoPagina: 50, pagina: 3 }), /LIMIT 50 OFFSET 100/);
});

test('escape de aspas simples nos filtros (anti-injeção básica)', () => {
  const sql = sqlGrupos({ produto: ["O'BRIEN"] });
  assert.match(sql, /produto IN \('O''BRIEN'\)/);
});

// ---------------------------------------------------------------------------
// Cliente (fetch mockado)
// ---------------------------------------------------------------------------

function payloadSucesso(columns, dataArray) {
  return {
    statement_id: 'st-1',
    status: { state: 'SUCCEEDED' },
    manifest: { schema: { columns } },
    result: { data_array: dataArray }
  };
}

function respOk(corpo) {
  return { ok: true, status: 200, text: async () => JSON.stringify(corpo) };
}

test('cliente.converter respeita os tipos numéricos', () => {
  assert.strictEqual(cliente.converter('42', 'INT'), 42);
  assert.strictEqual(cliente.converter('3.5', 'DOUBLE'), 3.5);
  assert.strictEqual(cliente.converter('x', 'STRING'), 'x');
  assert.strictEqual(cliente.converter(null, 'INT'), null);
});

test('cliente.executarSql mapeia colunas->valores e segue o polling', async (t) => {
  const original = global.fetch;
  let chamada = 0;
  global.fetch = async () => {
    chamada++;
    if (chamada === 1) {
      // submit ainda RUNNING
      return respOk({ statement_id: 'st-1', status: { state: 'RUNNING' } });
    }
    // poll -> SUCCEEDED
    return respOk(payloadSucesso(
      [{ name: 'ruptura', type_name: 'DECIMAL' }, { name: 'key', type_name: 'STRING' }],
      [['136000', '79444']]
    ));
  };
  t.after(() => { global.fetch = original; });

  const linhas = await cliente.executarSql('SELECT 1');
  assert.deepStrictEqual(linhas, [{ ruptura: 136000, key: '79444' }]);
  assert.ok(chamada >= 2, 'deve ter feito polling');
});

// ---------------------------------------------------------------------------
// Fonte (montagem do resumo a partir dos resultados do Databricks)
// ---------------------------------------------------------------------------

test('fonte.resumir monta grupos, totais e faixas no formato do contrato', async (t) => {
  const original = global.fetch;
  global.fetch = async (url, init) => {
    const stmt = JSON.parse(init.body).statement;
    if (stmt.includes('faixaRup')) {
      // query de TOTAIS
      return respOk(payloadSucesso(
        [
          { name: 'total', type_name: 'INT' },
          { name: 'ruptura', type_name: 'DECIMAL' },
          { name: 'perdaHoje', type_name: 'DECIMAL' },
          { name: 'pmeGeral', type_name: 'DOUBLE' },
          { name: 'faixaRup', type_name: 'INT' },
          { name: 'faixaFaixa', type_name: 'INT' },
          { name: 'faixaExc', type_name: 'INT' }
        ],
        [['112', '814265', '37948', '30', '29', '65', '18']]
      ));
    }
    // query de GRUPOS
    return respOk(payloadSucesso(
      [
        { name: 'key', type_name: 'STRING' },
        { name: 'm_produto', type_name: 'STRING' },
        { name: 'm_codsemDv', type_name: 'STRING' },
        { name: 'qtdLinhas', type_name: 'INT' },
        { name: 'ruptura', type_name: 'DECIMAL' },
        { name: 'pmeGeral', type_name: 'DOUBLE' },
        { name: 'totalGrupos', type_name: 'INT' }
      ],
      [
        ['79444', 'MOUNJARO 5MG C/4 SERINGAS', '79444', '6', '94397', '15', '18'],
        ['81120', 'OZEMPIC 1MG CANETA', '81120', '5', '0', '35', '18']
      ]
    ));
  };
  t.after(() => { global.fetch = original; });

  const resumo = await fonte.resumir({ groupBy: 'produto', pmeBase: 'media3m', tamanhoPagina: 50 });

  assert.strictEqual(resumo.grupos.length, 2);
  assert.strictEqual(resumo.grupos[0].key, '79444');
  assert.strictEqual(resumo.grupos[0].meta.produto, 'MOUNJARO 5MG C/4 SERINGAS');
  assert.strictEqual(resumo.grupos[0].agg.ruptura, 94397);
  assert.strictEqual(resumo.grupos[0].agg.faixa, 'rup'); // pmeGeral 15 < 20
  assert.strictEqual(resumo.grupos[1].agg.faixa, 'faixa'); // pmeGeral 35
  assert.strictEqual(resumo.totalGrupos, 18);
  assert.strictEqual(resumo.total, 112);
  assert.strictEqual(resumo.totais.ruptura, 814265);
  assert.deepStrictEqual(resumo.faixas, { rup: 29, faixa: 65, exc: 18 });
  assert.strictEqual(resumo.totais.faixa, 'faixa'); // pmeGeral 30
  assert.strictEqual(resumo.totalPaginas, 1);
});

test('fonte.estaConfigurado true quando há env do Databricks', () => {
  assert.strictEqual(fonte.estaConfigurado(), true);
});
