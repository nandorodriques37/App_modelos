'use strict';

// SEM env do Databricks -> serviço deve usar o mock (fallback de dev).
const { test } = require('node:test');
const assert = require('node:assert');

const { obterResumo, obterLinhas, usandoDatabricks, parseOpts } = require('../src/services/resumoService');
const { gerarLinhas } = require('../src/data/mockData');

test('sem Databricks configurado, usandoDatabricks() é false', () => {
  assert.strictEqual(usandoDatabricks(), false);
});

test('parseOpts normaliza filtros multi-valor, cd e busca', () => {
  const o = parseOpts({ cat3: 'DIABETES,GASTRO', cd: '3', q: 'mounjaro', detalhe: 'true', tamanhoPagina: '10' });
  assert.deepStrictEqual(o.cat3, ['DIABETES', 'GASTRO']);
  assert.strictEqual(o.cd, 3);
  assert.strictEqual(o.busca, 'mounjaro');
  assert.strictEqual(o.incluirLinhas, true);
  assert.strictEqual(o.tamanhoPagina, '10');
});

test('parseOpts aceita catN3 como alias de cat3', () => {
  const o = parseOpts({ catN3: 'GASTRO' });
  assert.deepStrictEqual(o.cat3, ['GASTRO']);
});

test('obterResumo (mock) devolve resumo coerente com o dataset', async () => {
  const resumo = await obterResumo({ groupBy: 'produto' });
  assert.strictEqual(resumo.fonte, undefined, 'fonte é setado na rota, não no serviço');
  const linhas = gerarLinhas();
  const somaRup = linhas.reduce((s, r) => s + r.ruptura, 0);
  assert.strictEqual(resumo.totais.ruptura, somaRup);
  assert.strictEqual(resumo.total, linhas.length);
});

test('obterResumo (mock) respeita filtros da query', async () => {
  const resumo = await obterResumo({ cat3: 'DIABETES', groupBy: 'produto', todos: 'true' });
  assert.ok(resumo.grupos.length > 0);
  assert.ok(resumo.grupos.length <= 3, 'só produtos de DIABETES');
});

test('obterLinhas (mock) devolve linhas filtradas', async () => {
  const linhas = await obterLinhas({ cd: '3' });
  assert.ok(linhas.length > 0);
  assert.ok(linhas.every((r) => r.cd === 3));
});
