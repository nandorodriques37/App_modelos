'use strict';

/**
 * Gerador de dados simulados — porte fiel do `buildData()` do protótipo
 * (docs/design_handoff_backend). Produz o array de "linhas" no formato do
 * contrato (uma linha por produto × CD), exatamente como a API real deve
 * devolver. Use isto como fonte de dados temporária até plugar o banco.
 *
 * Quando o back-end real estiver pronto, substitua a chamada a
 * `gerarLinhas()` no service por uma consulta ao banco que devolva linhas
 * com os mesmos campos (ver docs/design_handoff_backend/README.md).
 */

// PRNG determinístico (mulberry32) — mesmas sequências do protótipo,
// garantindo um dataset estável entre execuções.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// [codsemDv, produto, cat3, com, log, analista, fatorPreco]
const SEEDS = [
  ['80242', 'CR DTL SENSODYNE CLINICALWHITE 100G', 'HIGIENE ORAL', 'HALEON HB PANGEA', 'LOG SUDESTE', 'PEDRO CRUZ', 1.4],
  ['79444', 'MOUNJARO 5MG C/4 SERINGAS', 'DIABETES', 'LILLY MOUNJARO', 'LOG FRIO SP', 'DANIELY SIPRIANO', 9],
  ['78463', 'ATIVDAY VITC TRIPLAÇÃO 60CPR', 'VITAMINAS E MINERAIS', 'AIRELA MP VIT', 'LOG CENTRO', 'AMANDA SILVA', 1.1],
  ['81120', 'OZEMPIC 1MG CANETA APLICADORA', 'DIABETES', 'NOVO NORDISK', 'LOG FRIO SP', 'DANIELY SIPRIANO', 8],
  ['77310', 'PANTOPRAZOL 40MG 28CPR', 'GASTRO', 'EMS PRESCRIÇÃO', 'LOG SUL', 'JANIELE MONTEIRO', 1.6],
  ['76900', 'LOSARTANA POT 50MG 30CPR', 'SIST. CARDIOVASC.', 'TORRENT DO BRASIL', 'LOG SUDESTE', 'MICHELE CRUZ', 1.2],
  ['82001', 'ESCITALOPRAM 10MG 30CPR', 'SIST. NERVOSO', 'LIBBS RX', 'LOG SUL', 'LOUISE ROCHA', 1.5],
  ['75522', 'FRALDA TURMA MEGA G 40UN', 'TROCA FRALDA', 'PROCTER', 'LOG CENTRO', 'ALANA BARROS', 1.3],
  ['83440', 'HIDRATANTE CORPORAL NUTRI 400ML', 'CUIDADO CORPORAL', 'PRONOVA', 'LOG SUDESTE', 'PRISCILA ALENCAR', 1.1],
  ['84102', 'PROTETOR SOLAR FPS70 FACIAL 50G', 'CUIDADO FACIAL', 'GSK FARMA', 'LOG NORDESTE', 'PEDRO CRUZ', 1.7],
  ['70233', 'AGUA MICELAR 5EM1 200ML', 'CUIDADO FACIAL', 'CIFARMA QUÍMICA', 'LOG CENTRO', '(Em branco)', 1.0],
  ['71890', 'OMEPRAZOL 20MG 28CPR', 'GASTRO', 'EMS PRESCRIÇÃO', 'LOG SUL', 'JANIELE MONTEIRO', 1.4],
  ['72540', 'ANTICONCEP CICLO21 21CPR', 'SIST. GENIT. HORM.', 'LIBBS RX', 'LOG SUDESTE', 'MICHELE CRUZ', 1.2],
  ['73111', 'PILHA ALCALINA AA C/4UN', 'CONVENIÊNCIA', 'PRONOVA', 'LOG NORDESTE', 'ALANA BARROS', 0.8],
  ['74600', 'VIT D 2000UI 60CPS GEL', 'VITAMINAS E MINERAIS', 'AIRELA MP VIT', 'LOG CENTRO', 'AMANDA SILVA', 1.1],
  ['85220', 'DIPIRONA SÓDICA 1G 10CPR', 'SIST. NERVOSO', 'EMS PRESCRIÇÃO', 'LOG SUL', 'LOUISE ROCHA', 0.9],
  ['86010', 'SHAMPOO ANTICASPA 200ML', 'CUIDADO CORPORAL', 'PROCTER', 'LOG NORDESTE', 'PRISCILA ALENCAR', 1.0],
  ['87330', 'GLIFAGE XR 1000MG 30CPR', 'DIABETES', 'TORRENT DO BRASIL', 'LOG SUDESTE', 'DANIELY SIPRIANO', 1.8]
];

const N2_OF = {
  'HIGIENE ORAL': 'HIGIENE & BELEZA',
  'CUIDADO CORPORAL': 'HIGIENE & BELEZA',
  'CUIDADO FACIAL': 'DERMOCOSMÉTICOS',
  'TROCA FRALDA': 'INFANTIL',
  'DIABETES': 'MEDICAMENTOS',
  'GASTRO': 'MEDICAMENTOS',
  'SIST. CARDIOVASC.': 'MEDICAMENTOS',
  'SIST. NERVOSO': 'MEDICAMENTOS',
  'SIST. GENIT. HORM.': 'MEDICAMENTOS',
  'VITAMINAS E MINERAIS': 'SAÚDE & BEM-ESTAR',
  'CONVENIÊNCIA': 'CONVENIÊNCIA'
};

const N4_OF = {
  'HIGIENE ORAL': ['CREME DENTAL', 'ENXAGUANTE BUCAL', 'ESCOVA DENTAL'],
  'DIABETES': ['ANÁLOGOS GLP-1', 'INSULINAS', 'ANTIDIABÉTICOS ORAIS'],
  'VITAMINAS E MINERAIS': ['POLIVITAMÍNICOS', 'VITAMINA C', 'VITAMINA D'],
  'GASTRO': ['INIBIDORES DE BOMBA', 'ANTIÁCIDOS', 'PROCINÉTICOS'],
  'SIST. CARDIOVASC.': ['ANTI-HIPERTENSIVOS', 'ESTATINAS', 'DIURÉTICOS'],
  'SIST. NERVOSO': ['ANTIDEPRESSIVOS', 'ANALGÉSICOS', 'ANSIOLÍTICOS'],
  'TROCA FRALDA': ['FRALDAS', 'LENÇOS UMEDECIDOS', 'POMADAS'],
  'CUIDADO CORPORAL': ['HIDRATANTES', 'SABONETES', 'SHAMPOOS'],
  'CUIDADO FACIAL': ['PROTETOR SOLAR', 'LIMPEZA FACIAL', 'ANTISSINAIS'],
  'SIST. GENIT. HORM.': ['CONTRACEPTIVOS', 'REPOSIÇÃO HORMONAL'],
  'CONVENIÊNCIA': ['PILHAS', 'ACESSÓRIOS', 'DESCARTÁVEIS']
};

const SIT = ['Ativo', 'Ativo', 'Ativo', 'Sazonal', 'Em saída', 'Novo', 'Bloqueado'];
const COMPRADORES = ['Rafael Antunes', 'Bianca Mota', 'Tiago Réus', 'Carla Esteves', 'Vinícius Pádua', 'Marina Lopes'];

/**
 * Gera o array completo de linhas (produto × CD) no formato do contrato.
 * @returns {Array<Object>} linhas
 */
function gerarLinhas() {
  const linhas = [];

  SEEDS.forEach((s) => {
    const [codsemDv, produto, cat3, com, log, analista, pf] = s;
    const r = rng(parseInt(codsemDv, 10));
    const r2 = rng(parseInt(codsemDv, 10) * 7 + 13);

    const catN2 = N2_OF[cat3] || 'OUTROS';
    const n4l = N4_OF[cat3] || [cat3];
    const catN4 = n4l[Math.floor(r2() * n4l.length)];
    const situacao = SIT[Math.floor(r2() * SIT.length)];
    const comprador = COMPRADORES[Math.floor(r2() * COMPRADORES.length)];
    const custo = Math.round((6 + r2() * 40) * pf * 100) / 100;

    const nCds = 4 + Math.floor(r() * 5);
    const pool = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const cds = [];
    while (cds.length < nCds) {
      const idx = Math.floor(r() * pool.length);
      cds.push(pool.splice(idx, 1)[0]);
    }
    cds.sort((a, b) => a - b);

    cds.forEach((cd) => {
      const qtdMedia3m = 60 + Math.floor(r() * 2900);
      const vendaKardex30 = Math.round(qtdMedia3m * (0.65 + r() * 0.75));
      const stkCd = r() < 0.13 ? 0 : Math.floor(r() * 3000);
      const eo = Math.floor(r() * 1100);
      const nna = Math.floor(r() * 380);
      const trasNsf = r() < 0.5 ? 0 : Math.floor(r() * 900);
      const pend = Math.floor(r() * 1100);
      const ea = Math.floor(r() * 2700);
      const stkLoja = r() < 0.1 ? 0 : Math.floor(r() * 1900);
      const pmeCd = Math.floor(r() * 60);
      const pmeNna = Math.floor(r() * 18);
      const pmePend = Math.floor(r() * 24);
      const pmeCdPend = clamp(pmeCd + pmePend, 0, 90);
      const pmeLoja = Math.floor(r() * 58);
      const pmeGeral = clamp(Math.round((pmeCd + pmeLoja) / 2 + (r() * 12 - 6)), 0, 72);
      const pmeGeralPend = clamp(pmeGeral + pmePend, 0, 95);
      const leadTime = 7 + Math.floor(r() * 58);
      const shortfall = Math.max(0, (22 - pmeGeral) / 22);
      const ruptura = Math.round(shortfall * vendaKardex30 * (9 + r() * 42) * pf);
      const perdaHoje = stkCd === 0 ? Math.round((qtdMedia3m / 30) * custo) : 0;

      linhas.push({
        codsemDv,
        produto,
        cd,
        catN2,
        cat3,
        catN3: cat3,
        catN4,
        situacao,
        com,
        log,
        analista,
        comprador,
        qtdMedia3m,
        vendaKardex30,
        eo,
        stkCd,
        nna,
        trasNsf,
        pend,
        ea,
        stkLoja,
        pmeCd,
        pmeNna,
        pmePend,
        pmeCdPend,
        pmeLoja,
        pmeGeral,
        pmeGeralPend,
        leadTime,
        custo,
        perdaHoje,
        ruptura
      });
    });
  });

  return linhas;
}

module.exports = { gerarLinhas };
