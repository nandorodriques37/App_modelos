'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { gerarLinhas } = require('../src/data/mockData');
const {
  faixaDe,
  perdaHojeDe,
  garantirDerivados,
  ajustarPme,
  agregar,
  distribuicaoFaixa,
  agrupar,
  resumir,
  COLS_PME
} = require('../src/services/calculosService');

test('faixaDe respeita os cortes do handoff (<20 rup, 20-40 faixa, >40 exc)', () => {
  assert.strictEqual(faixaDe(0), 'rup');
  assert.strictEqual(faixaDe(19), 'rup');
  assert.strictEqual(faixaDe(20), 'faixa');
  assert.strictEqual(faixaDe(40), 'faixa');
  assert.strictEqual(faixaDe(41), 'exc');
});

test('perdaHojeDe só é não-zero quando stkCd === 0', () => {
  assert.strictEqual(perdaHojeDe({ stkCd: 10, qtdMedia3m: 300, custo: 5 }), 0);
  // (300/30)*5 = 50
  assert.strictEqual(perdaHojeDe({ stkCd: 0, qtdMedia3m: 300, custo: 5 }), 50);
});

test('garantirDerivados preenche catN3/perdaHoje sem mutar a linha original', () => {
  const orig = { codsemDv: '1', cat3: 'DIABETES', stkCd: 0, qtdMedia3m: 300, custo: 5 };
  const [d] = garantirDerivados([orig]);
  assert.strictEqual(d.catN3, 'DIABETES');
  assert.strictEqual(d.perdaHoje, 50);
  assert.ok(!('perdaHoje' in orig), 'não deve mutar a linha original');
});

test('ajustarPme(media3m) não altera; kardex30 aplica o fator qtdMedia3m/vendaKardex30', () => {
  const linha = { qtdMedia3m: 300, vendaKardex30: 150, pmeGeral: 20, pmeCd: 10 };
  assert.strictEqual(ajustarPme([linha], 'media3m')[0].pmeGeral, 20);
  // fator = 300/150 = 2  ->  pmeGeral 20*2 = 40 (limitado a 0..120)
  const [k] = ajustarPme([linha], 'kardex30');
  assert.strictEqual(k.pmeGeral, 40);
  assert.strictEqual(k.pmeCd, 20);
});

test('ajustarPme(kardex30) limita o PME a 120 dias', () => {
  const linha = { qtdMedia3m: 1000, vendaKardex30: 10, pmeGeral: 80 };
  assert.strictEqual(ajustarPme([linha], 'kardex30')[0].pmeGeral, 120);
});

test('ajustarPme(kardex30) usa fator 1 quando vendaKardex30 é 0', () => {
  const linha = {};
  COLS_PME.forEach((k) => { linha[k] = 30; });
  linha.qtdMedia3m = 300;
  linha.vendaKardex30 = 0;
  const [k] = ajustarPme([linha], 'kardex30');
  COLS_PME.forEach((c) => assert.strictEqual(k[c], 30));
});

test('agregar soma quantidades e faz média ponderada do PME (peso = qtdMedia3m)', () => {
  const linhas = [
    { qtdMedia3m: 100, ruptura: 10, perdaHoje: 0, pmeGeral: 10 },
    { qtdMedia3m: 300, ruptura: 30, perdaHoje: 5, pmeGeral: 50 }
  ];
  const agg = agregar(linhas);
  assert.strictEqual(agg.ruptura, 40, 'ruptura somada');
  assert.strictEqual(agg.perdaHoje, 5, 'perda somada');
  // wavg = (10*100 + 50*300) / 400 = 16000/400 = 40
  assert.strictEqual(agg.pmeGeral, 40);
  assert.strictEqual(agg.faixa, 'faixa');
});

test('distribuicaoFaixa conta as linhas por faixa de cobertura', () => {
  const linhas = [{ pmeGeral: 5 }, { pmeGeral: 30 }, { pmeGeral: 50 }, { pmeGeral: 10 }];
  assert.deepStrictEqual(distribuicaoFaixa(linhas), { rup: 2, faixa: 1, exc: 1 });
});

test('agrupar por produto cria um grupo por codsemDv', () => {
  const linhas = garantirDerivados(gerarLinhas());
  const grupos = agrupar(linhas, { groupBy: 'produto' });
  const codigosUnicos = new Set(linhas.map((r) => r.codsemDv));
  assert.strictEqual(grupos.length, codigosUnicos.size);
  assert.ok(grupos.every((g) => g.agg && typeof g.agg.ruptura === 'number'));
});

test('agrupar por cd soma todos os produtos do CD', () => {
  const linhas = garantirDerivados(gerarLinhas());
  const grupos = agrupar(linhas, { groupBy: 'cd' });
  const cdsUnicos = new Set(linhas.map((r) => r.cd));
  assert.strictEqual(grupos.length, cdsUnicos.size);
});

test('agrupar por total devolve um único grupo com todas as linhas', () => {
  const linhas = garantirDerivados(gerarLinhas());
  const grupos = agrupar(linhas, { groupBy: 'total' });
  assert.strictEqual(grupos.length, 1);
  assert.strictEqual(grupos[0].linhas.length, linhas.length);
});

test('agrupar ordena por sortKey/sortDir (ruptura desc por padrão)', () => {
  const linhas = garantirDerivados(gerarLinhas());
  const grupos = agrupar(linhas, { groupBy: 'produto', sortKey: 'ruptura', sortDir: 'desc' });
  for (let i = 1; i < grupos.length; i++) {
    assert.ok(grupos[i - 1].agg.ruptura >= grupos[i].agg.ruptura);
  }
});

test('resumir devolve grupos, totais coerentes e distribuição por faixa', () => {
  const linhas = gerarLinhas();
  const resumo = resumir(linhas, { groupBy: 'produto', pmeBase: 'media3m' });
  assert.strictEqual(resumo.total, linhas.length);

  // o total de ruptura/perda do agregado bate com a soma direta das linhas
  const somaRup = linhas.reduce((s, r) => s + r.ruptura, 0);
  const somaPerda = linhas.reduce((s, r) => s + r.perdaHoje, 0);
  assert.strictEqual(resumo.totais.ruptura, somaRup);
  assert.strictEqual(resumo.totais.perdaHoje, somaPerda);

  const totalFaixas = resumo.faixas.rup + resumo.faixas.faixa + resumo.faixas.exc;
  assert.strictEqual(totalFaixas, linhas.length);
});

test('resumir normaliza opções inválidas para os padrões', () => {
  const resumo = resumir(gerarLinhas(), { pmeBase: 'xpto', groupBy: 'nada' });
  assert.strictEqual(resumo.pmeBase, 'media3m');
  assert.strictEqual(resumo.groupBy, 'produto');
});
