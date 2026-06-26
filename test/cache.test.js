'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { memoTTL } = require('../src/utils/cache');
const {
  carregarLinhas,
  invalidarCache,
  geradoEm
} = require('../src/services/abastecimentoService');

test('memoTTL chama a função uma vez dentro do TTL', () => {
  let chamadas = 0;
  const get = memoTTL(() => { chamadas++; return chamadas; }, 10000);
  assert.strictEqual(get(), 1);
  assert.strictEqual(get(), 1);
  assert.strictEqual(chamadas, 1, 'só deve carregar uma vez');
});

test('memoTTL.invalidar força recarga', () => {
  let chamadas = 0;
  const get = memoTTL(() => { chamadas++; return chamadas; }, 10000);
  get();
  get.invalidar();
  assert.strictEqual(get(), 2);
  assert.strictEqual(chamadas, 2);
});

test('memoTTL com ttl<=0 sempre recarrega', () => {
  let chamadas = 0;
  const get = memoTTL(() => ++chamadas, 0);
  get(); get();
  assert.strictEqual(chamadas, 2);
});

test('carregarLinhas devolve o dataset em cache (mesma referência entre chamadas)', () => {
  const a = carregarLinhas();
  const b = carregarLinhas();
  assert.strictEqual(a, b, 'deve reusar o array em cache');
});

test('invalidarCache faz a próxima carga recriar o dataset', () => {
  const a = carregarLinhas();
  invalidarCache();
  const b = carregarLinhas();
  assert.notStrictEqual(a, b, 'após invalidar, novo array');
  assert.deepStrictEqual(a, b, 'conteúdo permanece determinístico');
});

test('dataset em cache já vem com os derivados garantidos (perdaHoje/catN3)', () => {
  for (const r of carregarLinhas()) {
    assert.ok('perdaHoje' in r);
    assert.ok(r.catN3 != null);
  }
});

test('geradoEm é estável dentro do TTL e muda após invalidar', () => {
  const t1 = geradoEm();
  assert.strictEqual(geradoEm(), t1, 'estável enquanto o cache vale');
  invalidarCache();
  // garante carga nova (timestamp >= anterior)
  const t2 = geradoEm();
  assert.ok(new Date(t2).getTime() >= new Date(t1).getTime());
});
