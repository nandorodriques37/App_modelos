'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { gerarLinhas } = require('../src/data/mockData');
const { listarLinhas, filtrar } = require('../src/services/abastecimentoService');

// Campos obrigatórios do contrato (docs/design_handoff_backend/README.md).
const CAMPOS_CONTRATO = [
  'codsemDv', 'produto', 'cd', 'catN2', 'cat3', 'catN3', 'catN4', 'situacao',
  'com', 'log', 'analista', 'comprador', 'qtdMedia3m', 'vendaKardex30', 'eo',
  'stkCd', 'nna', 'trasNsf', 'pend', 'ea', 'stkLoja', 'pmeCd', 'pmeNna',
  'pmePend', 'pmeCdPend', 'pmeLoja', 'pmeGeral', 'pmeGeralPend', 'leadTime',
  'custo', 'ruptura'
];

test('gerarLinhas produz linhas no formato do contrato', () => {
  const linhas = gerarLinhas();
  assert.ok(linhas.length > 0, 'deve gerar ao menos uma linha');
  for (const campo of CAMPOS_CONTRATO) {
    assert.ok(campo in linhas[0], `linha deve conter "${campo}"`);
  }
});

test('gerarLinhas é determinístico (mesmo dataset entre execuções)', () => {
  assert.deepStrictEqual(gerarLinhas(), gerarLinhas());
});

test('perdaHoje só é não-zero quando stkCd === 0', () => {
  for (const r of gerarLinhas()) {
    if (r.stkCd !== 0) assert.strictEqual(r.perdaHoje, 0);
    else assert.ok(r.perdaHoje >= 0);
  }
});

test('filtro por cd retorna apenas o CD pedido', () => {
  const linhas = filtrar(gerarLinhas(), { cd: '3' });
  assert.ok(linhas.length > 0);
  assert.ok(linhas.every((r) => r.cd === 3));
});

test('filtro multi-valor por cat3 aceita lista separada por vírgula', () => {
  const linhas = filtrar(gerarLinhas(), { cat3: 'DIABETES,GASTRO' });
  assert.ok(linhas.length > 0);
  assert.ok(linhas.every((r) => r.cat3 === 'DIABETES' || r.cat3 === 'GASTRO'));
});

test('busca textual encontra por produto e por código', () => {
  assert.ok(filtrar(gerarLinhas(), { search: 'mounjaro' }).length > 0);
  assert.ok(filtrar(gerarLinhas(), { q: '79444' }).length > 0);
});

test('listarLinhas sem filtros devolve todas as linhas', () => {
  assert.strictEqual(listarLinhas({}).length, gerarLinhas().length);
});
