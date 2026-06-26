'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  SEAM DE FÓRMULAS — ponto ÚNICO onde as regras de negócio entram no SQL.   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * A fonte (Databricks) tem DADOS BRUTOS (estoque/venda). Aqui mapeamos cada
 * campo do contrato (camelCase, igual ao que o front-end/Lovable consome) para
 * uma EXPRESSÃO SQL (Spark SQL) sobre as colunas BRUTAS da tabela. O construtor
 * de SQL (consulta.js) injeta essas expressões para que toda a derivação +
 * agregação rode no Databricks — escalando para 700k+ linhas sem trazer linha
 * bruta para o Node.
 *
 *   ►►► Para finalizar: substitua os placeholders abaixo pelas FÓRMULAS REAIS
 *       e ajuste COLUNAS_BRUTAS aos nomes reais das colunas no Databricks. ◄◄◄
 *
 * Enquanto as fórmulas reais não chegam, os placeholders abaixo reproduzem a
 * semântica documentada no handoff (e o app continua rodável via mock).
 */

// Nome totalmente qualificado da tabela bruta no Databricks (catalog.schema.tabela).
// Ajuste via env (.env) — ver .env.example.
const TABELA = {
  catalog: process.env.DATABRICKS_CATALOG || 'main',
  schema: process.env.DATABRICKS_SCHEMA || 'abastecimento',
  tabela: process.env.DATABRICKS_TABLE || 'linhas_brutas'
};

function tabelaFQN() {
  return `${TABELA.catalog}.${TABELA.schema}.${TABELA.tabela}`;
}

/**
 * Colunas de IDENTIDADE (dimensões). Vêm direto do bruto — ajuste o lado
 * direito para o nome real da coluna no Databricks.
 *   contrato (camelCase) -> coluna bruta
 */
const COLUNAS_IDENTIDADE = {
  codsemDv: 'codsem_dv',
  produto: 'produto',
  cd: 'cd',
  catN2: 'cat_n2',
  cat3: 'cat3',
  catN4: 'cat_n4',
  situacao: 'situacao',
  com: 'com',
  log: 'log',
  analista: 'analista',
  comprador: 'comprador'
};

/**
 * Colunas BRUTAS de medida (estoque/venda) usadas nas fórmulas. Ajuste os
 * nomes às colunas reais. Servem de "vocabulário" para as expressões abaixo.
 */
const COLUNAS_BRUTAS = {
  qtdMedia3m: 'qtd_media_3m',
  vendaKardex30: 'venda_kardex_30',
  eo: 'eo',
  stkCd: 'stk_cd',
  nna: 'nna',
  trasNsf: 'tras_nsf',
  pend: 'pend',
  ea: 'ea',
  stkLoja: 'stk_loja',
  // custo unitário de reposição (se vier do bruto; senão derive em EXPRESSOES.custo)
  custo: 'custo'
};

const B = COLUNAS_BRUTAS; // atalho

/**
 * EXPRESSÕES DERIVADAS — fórmulas em SQL sobre as colunas brutas.
 *
 * ►►► SUBSTITUA pelos cálculos reais fornecidos pelo negócio. ◄◄◄
 * Placeholders atuais = semântica de cobertura padrão (PME ≈ estoque ÷ demanda
 * diária), só para manter a pipeline válida e demonstrável.
 *
 * Cada valor é uma expressão SQL válida no Databricks. Use os nomes de
 * COLUNAS_BRUTAS. `demanda_diaria` abaixo é só um apoio textual.
 */
// demanda diária estimada (apoio): venda média 3m distribuída em 30 dias.
const DEMANDA_DIARIA = `(NULLIF(${B.qtdMedia3m}, 0) / 30.0)`;

const EXPRESSOES = {
  // Medidas brutas repassadas (somadas no agregado).
  qtdMedia3m: B.qtdMedia3m,
  vendaKardex30: B.vendaKardex30,
  eo: B.eo,
  stkCd: B.stkCd,
  nna: B.nna,
  trasNsf: B.trasNsf,
  pend: B.pend,
  ea: B.ea,
  stkLoja: B.stkLoja,

  // Financeiras.
  custo: B.custo, // TODO: confirmar se custo é bruto ou derivado.

  // PME (dias de cobertura) — TODO: trocar pelas fórmulas reais.
  pmeCd: `COALESCE(${B.stkCd} / ${DEMANDA_DIARIA}, 0)`,
  pmeNna: `COALESCE(${B.nna} / ${DEMANDA_DIARIA}, 0)`,
  pmePend: `COALESCE(${B.pend} / ${DEMANDA_DIARIA}, 0)`,
  pmeCdPend: `COALESCE((${B.stkCd} + ${B.pend}) / ${DEMANDA_DIARIA}, 0)`,
  pmeLoja: `COALESCE(${B.stkLoja} / ${DEMANDA_DIARIA}, 0)`,
  pmeGeral: `COALESCE((${B.stkCd} + ${B.stkLoja}) / ${DEMANDA_DIARIA}, 0)`,
  pmeGeralPend: `COALESCE((${B.stkCd} + ${B.stkLoja} + ${B.pend}) / ${DEMANDA_DIARIA}, 0)`,
  leadTime: 'COALESCE(lead_time, 0)', // TODO: coluna/fórmula real.

  // RUPTURA PROJETADA (R$) — TODO: trocar pela fórmula real.
  // Placeholder: shortfall vs. meta de 22 dias × venda × custo.
  ruptura: `ROUND(
    GREATEST(0, (22 - COALESCE((${B.stkCd} + ${B.stkLoja}) / ${DEMANDA_DIARIA}, 0)) / 22.0)
    * ${B.vendaKardex30} * ${B.custo}
  )`
};

/**
 * PERDA HOJE (R$) — campo derivado fixo do contrato:
 *   stkCd === 0 ? round((qtdMedia3m / 30) * custo) : 0
 * Mantido em SQL para rodar junto no Databricks.
 */
const EXPR_PERDA_HOJE =
  `CASE WHEN ${B.stkCd} = 0 THEN ROUND((${B.qtdMedia3m} / 30.0) * ${EXPRESSOES.custo}) ELSE 0 END`;

module.exports = {
  TABELA,
  tabelaFQN,
  COLUNAS_IDENTIDADE,
  COLUNAS_BRUTAS,
  EXPRESSOES,
  EXPR_PERDA_HOJE
};
