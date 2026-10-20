// Bandera de la federación: del código FIDE («ESP», «NOR») al del país en dos letras para flagcdn.com.
const ESPECIAL = {
  ALG: 'dz', ANG: 'ao', ANT: 'ag', ARU: 'aw', BAH: 'bs', BAN: 'bd', BAR: 'bb', BER: 'bm', BHU: 'bt', BIZ: 'bz', BOT: 'bw',
  BRN: 'bh', BRU: 'bn', BUL: 'bg', BUR: 'bf', CAM: 'kh', CAY: 'ky', CHA: 'td', CHI: 'cl', CRC: 'cr', CRO: 'hr', CUR: 'cw',
  DEN: 'dk', ENG: 'gb-eng', ESA: 'sv', ESP: 'es', FAI: 'fo', FIJ: 'fj', GAM: 'gm', GCI: 'gg', GER: 'de', GEQ: 'gq', SUI: 'ch',
  NED: 'nl', GRE: 'gr', GRN: 'gd', GUA: 'gt', GUI: 'gn', HAI: 'ht', HON: 'hn', INA: 'id', IOM: 'im', IRI: 'ir', ISV: 'vi',
  IVB: 'vg', JCI: 'je', KOS: 'xk', KSA: 'sa', KUW: 'kw', LAT: 'lv', LBA: 'ly', LES: 'ls', MAD: 'mg', MAS: 'my', MAW: 'mw',
  MGL: 'mn', MNC: 'mc', MRI: 'mu', MTN: 'mr', MYA: 'mm', NCA: 'ni', NEP: 'np', NGR: 'ng', NIG: 'ne', OMA: 'om', PAR: 'py',
  PHI: 'ph', PLE: 'ps', POR: 'pt', PUR: 'pr', RSA: 'za', SCO: 'gb-sct', SEY: 'sc', SKN: 'kn', SLO: 'si', SOL: 'sb', SRI: 'lk',
  SUD: 'sd', TAN: 'tz', TGA: 'to', TOG: 'tg', TPE: 'tw', UAE: 'ae', URU: 'uy', VAN: 'vu', VIE: 'vn', VIN: 'vc', WLS: 'gb-wls',
  NIR: 'gb-nir', ZAM: 'zm', ZIM: 'zw', FID: '', NON: ''
};

// El resto de federaciones: el código FIDE coincide con el ISO de tres letras.
const ISO3 = {
  ALB: 'al', AND: 'ad', ARG: 'ar', ARM: 'am', AUS: 'au', AUT: 'at', AZE: 'az', BEL: 'be', BIH: 'ba', BLR: 'by', BOL: 'bo',
  BRA: 'br', CAN: 'ca', CHN: 'cn', COL: 'co', CUB: 'cu', CYP: 'cy', CZE: 'cz', DOM: 'do', ECU: 'ec', EGY: 'eg', EST: 'ee',
  FIN: 'fi', FRA: 'fr', GBR: 'gb', GEO: 'ge', GHA: 'gh', HKG: 'hk', HUN: 'hu', IND: 'in', IRL: 'ie', IRQ: 'iq', ISL: 'is',
  ISR: 'il', ITA: 'it', JAM: 'jm', JOR: 'jo', JPN: 'jp', KAZ: 'kz', KEN: 'ke', KGZ: 'kg', KOR: 'kr', LBN: 'lb', LIE: 'li',
  LTU: 'lt', LUX: 'lu', MAR: 'ma', MDA: 'md', MEX: 'mx', MKD: 'mk', MLT: 'mt', MNE: 'me', NOR: 'no', NZL: 'nz', PAK: 'pk',
  PAN: 'pa', PER: 'pe', POL: 'pl', PRK: 'kp', QAT: 'qa', ROU: 'ro', RUS: 'ru', SGP: 'sg', SMR: 'sm', SRB: 'rs', SVK: 'sk',
  SWE: 'se', SYR: 'sy', THA: 'th', TJK: 'tj', TKM: 'tm', TUN: 'tn', TUR: 'tr', UKR: 'ua', USA: 'us', UZB: 'uz', VEN: 've',
  YEM: 'ye'
};

export function codigoPais(federacion) {
  const c = (federacion ?? '').trim().toUpperCase();
  if (!c) return '';
  if (c in ESPECIAL) return ESPECIAL[c];
  if (c in ISO3) return ISO3[c];
  return c.length === 2 ? c.toLowerCase() : '';
}

/** Dirección de la imagen de la bandera, o '' si no se reconoce. */
export function urlBandera(federacion) {
  const c = codigoPais(federacion);
  return c ? `https://flagcdn.com/w40/${c}.png` : '';
}
