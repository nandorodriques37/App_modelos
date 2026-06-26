'use strict';

/**
 * Utilitários de cache em memória — o ponto onde o custo de "ir buscar os dados"
 * (hoje o gerador simulado, amanhã uma consulta ao banco) deixa de ser pago a
 * cada request. Mantém a API performática sob carga sem mudar o contrato.
 */

/**
 * Memoiza uma função sem argumentos com expiração por tempo (TTL).
 * Útil para a "consulta" que carrega o dataset: a primeira chamada executa,
 * as seguintes (dentro do TTL) devolvem o valor em cache.
 *
 * @param {Function} fn função de carga (executada quando o cache expira)
 * @param {number} ttlMs validade do valor em milissegundos (<=0 = sempre recarrega)
 * @returns {Function & {invalidar:Function, carregadoEm:Function}}
 */
function memoTTL(fn, ttlMs) {
  let valor;
  let carregado = false;
  let carregadoEm = 0;
  let expiraEm = 0;

  function get() {
    const agora = Date.now();
    if (!carregado || ttlMs <= 0 || agora >= expiraEm) {
      valor = fn();
      carregado = true;
      carregadoEm = agora;
      expiraEm = agora + ttlMs;
    }
    return valor;
  }

  // Força a próxima chamada a recarregar (ex.: após escrita no banco).
  get.invalidar = () => {
    carregado = false;
    valor = undefined;
    carregadoEm = 0;
    expiraEm = 0;
  };

  // Momento (epoch ms) da última carga efetiva — base para ETag/`geradoEm` estável.
  get.carregadoEm = () => {
    get();
    return carregadoEm;
  };

  return get;
}

module.exports = { memoTTL };
