// Lectura de una base de ChessBase en formato clásico (.cbh + .cbg + .cbp + .cbt), solo lectura
// (Services/ChessBase/ChessBaseDatabase.cs y CbGameDecoder.cs). El ID FIDE no está en estos archivos, así que los jugadores se buscan
// por nombre y se desambiguan con el ELO que figura en cada partida. Los archivos se leen por trozos: la MegaDatabase pesa cientos de MB.
import { Chess } from './vendor/chess.js';
import { PartidaPgn, leerPgn, palabras } from './pgn.js';
import { buscarApertura, epdDe } from './aperturas.js';
import { FEN_INICIAL } from './arbol.js';

const TAM_REGISTRO = 46;      // el primer registro es la cabecera del archivo
const TAM_JUGADOR = 67;
const TAM_TORNEO = 99;
const MAX_JUGADORES_POR_LECTURA = 30;

export class ErrorBase extends Error {}

// ---------- Decodificador de partidas (.cbg) ----------

const NOT_INITIAL = 0x40000000, NOT_ENCODED = 0x80000000, SPECIAL_ENCODING = 0x04000000, IS_960 = 0x0A000000, GAME_LENGTH = 0x00FFFFFF;
// Tipos de pieza de ChessBase
const WQ = 1, WN = 2, WB = 3, WR = 4, BQ = 5, BN = 6, BB = 7, BR = 8, WK = 9, BK = 10, WP = 11, BP = 12;

const esEspecial = (t) => t === 0x29 || t === 0xDC || t === 0x0C || t === 0x9F;

const DESOFUSCAR_2B = Uint8Array.from([
  0xA2,0x95,0x43,0xF5,0xC1,0x3D,0x4A,0x6C,0x53,0x83,0xCC,0x7C,0xFF,0xAE,0x68,0xAD,0xD1,0x92,0x8B,0x8D,0x35,0x81,0x5E,0x74,0x26,0x8E,0xAB,0xCA,0xFD,0x9A,0xF3,0xA0,
  0xA5,0x15,0xFC,0xB1,0x1E,0xED,0x30,0xEA,0x22,0xEB,0xA7,0xCD,0x4E,0x6F,0x2E,0x24,0x32,0x94,0x41,0x8C,0x6E,0x58,0x82,0x50,0xBB,0x02,0x8A,0xD8,0xFA,0x60,0xDE,0x52,
  0xBA,0x46,0xAC,0x29,0x9D,0xD7,0xDF,0x08,0x21,0x01,0x66,0xA3,0xF1,0x19,0x27,0xB5,0x91,0xD5,0x42,0x0E,0xB4,0x4C,0xD9,0x18,0x5F,0xBC,0x25,0xA6,0x96,0x04,0x56,0x6A,
  0xAA,0x33,0x1C,0x2B,0x73,0xF0,0xDD,0xA4,0x37,0xD3,0xC5,0x10,0xBF,0x5A,0x23,0x34,0x75,0x5B,0xB8,0x55,0xD2,0x6B,0x09,0x3A,0x57,0x12,0xB3,0x77,0x48,0x85,0x9B,0x0F,
  0x9E,0xC7,0xC8,0xA1,0x7F,0x7A,0xC0,0xBD,0x31,0x6D,0xF6,0x3E,0xC3,0x11,0x71,0xCE,0x7D,0xDA,0xA8,0x54,0x90,0x97,0x1F,0x44,0x40,0x16,0xC9,0xE3,0x2C,0xCB,0x84,0xEC,
  0x9F,0x3F,0x5C,0xE6,0x76,0x0B,0x3C,0x20,0xB7,0x36,0x00,0xDC,0xE7,0xF9,0x4F,0xF7,0xAF,0x06,0x07,0xE0,0x1A,0x0A,0xA9,0x4B,0x0C,0xD6,0x63,0x87,0x89,0x1D,0x13,0x1B,
  0xE4,0x70,0x05,0x47,0x67,0x7B,0x2F,0xEE,0xE2,0xE8,0x98,0x0D,0xEF,0xCF,0xC4,0xF4,0xFB,0xB0,0x17,0x99,0x64,0xF2,0xD4,0x2A,0x03,0x4D,0x78,0xC6,0xFE,0x65,0x86,0x88,
  0x79,0x45,0x3B,0xE5,0x49,0x8F,0x2D,0xB9,0xBE,0x62,0x93,0x14,0xE9,0xD0,0x38,0x9C,0xB2,0xC2,0x59,0x5D,0xB6,0x72,0x51,0xF8,0x28,0x7E,0x61,0x39,0xE1,0xDB,0x69,0x80
]);

// Tablas de jugadas: cada byte indica un desplazamiento (dx, dy) de una pieza concreta
const rango = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const DELTAS_DAMA = [...rango(1, 7).map(n => [0, n]), ...rango(1, 7).map(n => [n, 0]), ...rango(1, 7).map(n => [n, n]), ...rango(1, 7).map(n => [n, 8 - n])];
const DELTAS_TORRE = DELTAS_DAMA.slice(0, 14);
const DELTAS_ALFIL = [...rango(1, 7).map(n => [n, n]), ...rango(1, 7).map(n => [n, 8 - n])];
const DELTAS_CABALLO = [[2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2], [1, -2], [2, -1]];
const DELTAS_PEON = [[0, 1], [0, 2], [1, 1], [-1, 1]];
const tabla = (teclas, deltas) => new Map(teclas.map((t, i) => [t, deltas[i]]));

const REY = tabla([0x49, 0x39, 0xD8, 0x5D, 0xC2, 0xB1, 0xB2, 0x47, 0x76, 0xB5], [[0, 1], [1, 1], [1, 0], [1, 7], [0, 7], [7, 7], [7, 0], [7, 1], [2, 0], [-2, 0]]);
const DAMAS = [
  tabla([0xA5,0xB8,0xCB,0x53,0x7F,0x6B,0x8D,0x79,0xBE,0xEB,0x21,0x99,0xD2,0x57,0x4D,0xB4,0xBF,0x62,0xBD,0x24,0x96,0xA7,0x48,0x28,0x6E,0x2F,0x5A,0x18], DELTAS_DAMA),
  tabla([0xE5,0x94,0x50,0x11,0xEA,0x31,0x01,0x5C,0x95,0xCA,0xD3,0x1D,0x7E,0xEF,0x44,0x80,0xA0,0x1F,0x83,0x00,0x4B,0x67,0x20,0x5B,0x2A,0x92,0xB6,0x60], DELTAS_DAMA),
  tabla([0x1A,0x42,0x0F,0x0D,0xB0,0xD1,0x23,0xF0,0x7A,0x54,0x4F,0xF4,0xA8,0x72,0xE7,0x40,0x38,0x59,0x87,0xE8,0x6C,0x86,0x04,0xF1,0x8C,0xCE,0x6A,0xDB], DELTAS_DAMA)
];
const TORRES = [
  tabla([0x4E,0xF8,0x43,0xD7,0x63,0x9C,0xE6,0x2E,0xC6,0x26,0x88,0x30,0x61,0x6F], DELTAS_TORRE),
  tabla([0x14,0xA9,0x68,0xEE,0xFB,0x77,0xE2,0xA6,0x05,0x8B,0xA1,0x98,0x32,0x52], DELTAS_TORRE),
  tabla([0x81,0x82,0x9A,0x1B,0x9D,0x0A,0x2B,0x8F,0xCD,0xED,0x10,0x74,0x69,0xD6], DELTAS_TORRE)
];
const ALFILES = [
  tabla([0x02,0x97,0xE1,0x41,0xC3,0x7C,0xE4,0x06,0xB7,0x55,0xD9,0x2C,0xAE,0x37], DELTAS_ALFIL),
  tabla([0xF6,0x3F,0x08,0x93,0x73,0x5E,0x78,0x35,0xF2,0x6D,0x71,0xA2,0xF3,0x16], DELTAS_ALFIL),
  tabla([0x51,0xB9,0x45,0x3B,0x56,0x91,0xFD,0xAB,0x66,0x3E,0x46,0xB3,0xFC,0xC8], DELTAS_ALFIL)
];
const CABALLOS = [
  tabla([0x58,0x3D,0xFA,0xE9,0xBA,0xD4,0xDD,0x4A], DELTAS_CABALLO),
  tabla([0xC4,0x0E,0xFE,0x5F,0x75,0x07,0x89,0x34], DELTAS_CABALLO),
  tabla([0x9B,0xC0,0xE3,0xA3,0xAC,0xC9,0xEC,0x27], DELTAS_CABALLO)
];
const PEONES = [
  [0x2D,0xC1,0x8E,0xF5], [0x64,0x17,0x70,0xA4], [0x7B,0xDA,0xE0,0x85], [0xC5,0x0B,0x90,0xF9],
  [0x84,0xFF,0x15,0x36], [0x09,0x9E,0x7D,0xDE], [0xBB,0xDF,0xBC,0x3A], [0x12,0x33,0x13,0x19]
].map(t => tabla(t, DELTAS_PEON));

/** Qué hay en cada casilla (tipo y número de pieza) y dónde está cada pieza numerada. */
class Piezas {
  constructor() {
    this.casilla = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => [0, 0]));   // [columna][fila] = [tipo, nr]; tipo 0 = vacía
    this.lugar = Array.from({ length: 13 }, () => new Array(8).fill(-1));                       // columna * 8 + fila, o -1
  }
  colocar(tipo, nr, x, y) { this.casilla[x][y] = [tipo, nr]; this.lugar[tipo][nr] = x * 8 + y; }
}

function posicionInicial() {
  const p = new Piezas();
  const blancas = [WR, WN, WB, WQ, WK, WB, WN, WR], negras = [BR, BN, BB, BQ, BK, BB, BN, BR], orden = [0, 0, 0, 0, 0, 1, 1, 1];
  for (let x = 0; x < 8; x++) {
    p.colocar(blancas[x], orden[x], x, 0); p.colocar(WP, x, x, 1); p.colocar(BP, x, x, 6); p.colocar(negras[x], orden[x], x, 7);
  }
  return p;
}

const CODIGOS_PIEZA = { '10001': WK, '10010': WQ, '10011': WN, '10100': WB, '10101': WR, '10110': WP, '11001': BK, '11010': BQ, '11011': BN, '11100': BB, '11101': BR, '11110': BP };
const SIMBOLO = { [WK]: 'K', [WQ]: 'Q', [WR]: 'R', [WB]: 'B', [WN]: 'N', [WP]: 'P', [BK]: 'k', [BQ]: 'q', [BR]: 'r', [BB]: 'b', [BN]: 'n', [BP]: 'p' };

function posicionDesdeCabecera(cbg, inicio) {
  const epColumna = cbg[inicio + 5] & 0x7, juegaNegro = (cbg[inicio + 5] & 0x10) !== 0, enroques = cbg[inicio + 6];
  const siguiente = cbg[inicio + 7] === 0 ? 1 : cbg[inicio + 7];
  let cadena = '';
  for (let i = inicio + 8; i < inicio + 32 && i < cbg.length; i++) cadena += cbg[i].toString(2).padStart(8, '0');

  const piezas = new Piezas(), contadores = new Array(13).fill(0);
  let bit = 0;
  for (let casilla = 0; casilla < 64 && bit < cadena.length; casilla++) {
    if (cadena[bit] === '0') { bit++; continue; }
    const tipo = bit + 5 > cadena.length ? undefined : CODIGOS_PIEZA[cadena.substr(bit, 5)];
    if (tipo === undefined) throw new ErrorBase('Posición inicial de ChessBase no reconocida.');
    bit += 5;
    const x = Math.floor(casilla / 8), y = casilla % 8;
    const nr = tipo === WK || tipo === BK ? 0 : contadores[tipo];
    contadores[tipo]++;
    if (nr > 7) throw new ErrorBase('Demasiadas piezas del mismo tipo.');
    piezas.colocar(tipo, nr, x, y);
  }

  const filas = [];
  for (let y = 7; y >= 0; y--) {
    let fila = '', vacias = 0;
    for (let x = 0; x < 8; x++) {
      const tipo = piezas.casilla[x][y][0];
      if (tipo === 0) { vacias++; continue; }
      if (vacias) { fila += vacias; vacias = 0; }
      fila += SIMBOLO[tipo];
    }
    filas.push(fila + (vacias || ''));
  }
  let derechos = '';
  if (enroques & 0x02) derechos += 'K'; if (enroques & 0x01) derechos += 'Q'; if (enroques & 0x08) derechos += 'k'; if (enroques & 0x04) derechos += 'q';
  const alPaso = epColumna ? `${String.fromCharCode(97 + epColumna - 1)}${juegaNegro ? '3' : '6'}` : '-';
  return { fen: `${filas.join('/')} ${juegaNegro ? 'b' : 'w'} ${derechos || '-'} ${alPaso} 0 ${siguiente}`, piezas };
}

const mod8 = (v) => ((v % 8) + 8) % 8;

function renumerarTrasCaptura(p, tipo, nr) {
  if (tipo === WP || tipo === BP || tipo === WK || tipo === BK) { if (nr >= 0 && nr < 8) p.lugar[tipo][nr] = -1; return; }
  for (let i = nr; i < 7; i++) p.lugar[tipo][i] = p.lugar[tipo][i + 1];
  p.lugar[tipo][7] = -1;
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
    const [t, n] = p.casilla[x][y];
    if (t === tipo && n > nr) p.casilla[x][y] = [t, n - 1];
  }
}

function capturar(p, tipoQueMueve, x, y, x1, y1) {
  let capX = x1, capY = y1;
  // Captura al paso: un peón se mueve en diagonal a una casilla vacía; el peón capturado está en su fila de origen.
  if ((tipoQueMueve === WP || tipoQueMueve === BP) && x1 !== x && p.casilla[x1][y1][0] === 0) capY = y;
  const [tipo, nr] = p.casilla[capX][capY];
  if (tipo !== 0) { renumerarTrasCaptura(p, tipo, nr); p.casilla[capX][capY] = [0, 0]; }
}

const nombreCasilla = (x, y) => 'abcdefgh'[x] + (y + 1);
const PROMO = ['q', 'r', 'b', 'n'];

/** Aplica al tablero la jugada (casillas x,y) y la devuelve con su SAN; null si no es legal. Va directa a «move»: generar antes todas
 *  las jugadas legales para buscarla costaba 15 veces más. */
function mover(tablero, x, y, x1, y1, promo) {
  try { return tablero.move({ from: nombreCasilla(x, y), to: nombreCasilla(x1, y1), promotion: promo || undefined }); } catch { return null; }
}

function aplicarUna(tablero, p, tipo, nr, tab, token, invertir, san) {
  const origen = p.lugar[tipo][nr];
  if (origen < 0) return false;
  const x = Math.floor(origen / 8), y = origen % 8;
  let [dx, dy] = tab.get(token);
  if (invertir) { dx = -dx; dy = -dy; }
  const x1 = mod8(x + dx), y1 = mod8(y + dy);

  const jugada = mover(tablero, x, y, x1, y1, '');
  if (!jugada) return false;
  san.push(jugada.san);

  capturar(p, tipo, x, y, x1, y1);
  p.casilla[x][y] = [0, 0];
  p.colocar(tipo, nr, x1, y1);

  // Enroque: el byte mueve el rey y hay que mover también la torre en la numeración de ChessBase.
  if ((tipo === WK || tipo === BK) && (token === 0x76 || token === 0xB5)) {
    const fila = tipo === WK ? 0 : 7, torre = tipo === WK ? WR : BR;
    const [vieja, nueva] = token === 0x76 ? [7, 5] : [0, 3];
    for (let n = 0; n < 8; n++) {
      if (p.lugar[torre][n] !== vieja * 8 + fila) continue;
      p.casilla[vieja][fila] = [0, 0];
      p.colocar(torre, n, nueva, fila);
      break;
    }
  }
  return true;
}

function aplicarDos(tablero, p, origen, destino, codigoPromo, san) {
  const x = Math.floor(origen / 8), y = origen % 8, x1 = Math.floor(destino / 8), y1 = destino % 8;
  const [tipo, nr] = p.casilla[x][y];
  if (tipo === 0) return false;

  let promoCb = 0, promoLetra = '';
  if (tipo === WP && y1 === 7) { promoCb = [WQ, WR, WB, WN][codigoPromo]; promoLetra = PROMO[codigoPromo]; }
  else if (tipo === BP && y1 === 0) { promoCb = [BQ, BR, BB, BN][codigoPromo]; promoLetra = PROMO[codigoPromo]; }

  const jugada = mover(tablero, x, y, x1, y1, promoLetra);
  if (!jugada) return false;
  san.push(jugada.san);

  capturar(p, tipo, x, y, x1, y1);
  p.casilla[x][y] = [0, 0];
  if (promoCb) {
    p.lugar[tipo][nr] = -1;
    let libre = -1;
    for (let i = 0; i < 8; i++) if (p.lugar[promoCb][i] < 0) { libre = i; break; }
    if (libre < 0) return false;
    p.colocar(promoCb, libre, x1, y1);
  } else p.colocar(tipo, nr, x1, y1);
  return true;
}

function buscarTabla(blancas, token) {
  if (REY.has(token)) return { tab: REY, tipo: blancas ? WK : BK, nr: 0, invertir: false };
  for (let i = 0; i < 3; i++) {
    if (DAMAS[i].has(token)) return { tab: DAMAS[i], tipo: blancas ? WQ : BQ, nr: i, invertir: false };
    if (TORRES[i].has(token)) return { tab: TORRES[i], tipo: blancas ? WR : BR, nr: i, invertir: false };
    if (ALFILES[i].has(token)) return { tab: ALFILES[i], tipo: blancas ? WB : BB, nr: i, invertir: false };
    if (CABALLOS[i].has(token)) return { tab: CABALLOS[i], tipo: blancas ? WN : BN, nr: i, invertir: false };
  }
  for (let i = 0; i < 8; i++) if (PEONES[i].has(token)) return { tab: PEONES[i], tipo: blancas ? WP : BP, nr: i, invertir: !blancas };
  return null;
}

/** Chess960 y las codificaciones especiales no se leen. */
export const tieneBanderasValidas = (info) => (info & NOT_ENCODED) === 0 && (info & SPECIAL_ENCODING) === 0 && (info & IS_960) === 0;
const info32 = (b, i = 0) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
export const longitudDeLaPartida = (info) => info & GAME_LENGTH;

/** Decodifica la partida (el bloque entero del .cbg). Devuelve { startFen, san, eco, opening } o null si el formato no es compatible
 *  (Chess960, codificación especial) o si alguna jugada resulta ilegal: es mejor descartar una partida que guardarla corrupta. */
export function decodificarPartida(bloque) {
  if (bloque.length < 4) return null;
  const info = info32(bloque);
  if (!tieneBanderasValidas(info)) return null;

  let fen, piezas, inicioDatos;
  if (info & NOT_INITIAL) {
    if (bloque.length < 32) return null;
    try { ({ fen, piezas } = posicionDesdeCabecera(bloque, 0)); } catch { return null; }
    inicioDatos = 32;
  } else { fen = FEN_INICIAL; piezas = posicionInicial(); inicioDatos = 4; }

  let tablero;
  try { tablero = new Chess(fen); } catch { return null; }
  const san = [];
  let procesados = 0, saltoVariante = 0, idx = inicioDatos;
  const desdeInicio = fen === FEN_INICIAL;
  let apertura = null;
  const clasificar = () => {                          // la posición más profunda (de las primeras 40 jugadas) que figure en el libro
    if (!desdeInicio || san.length === 0 || san.length > 40) return;
    const e = buscarApertura(epdDe(tablero.fen()));
    if (e) apertura = e;
  };

  while (idx < bloque.length) {
    const token = (((bloque[idx] - procesados) % 256) + 256) % 256;
    if (!esEspecial(token)) procesados = (procesados + 1) % 256;

    // Variantes: se saltan conservando el contador de ofuscación.
    if (saltoVariante > 0) {
      if (token === 0xDC) { saltoVariante++; idx++; continue; }
      if (token === 0x0C) { saltoVariante--; idx++; continue; }
      if (token === 0x29) { if (idx + 2 >= bloque.length) break; procesados = (procesados + 1) % 256; idx += 3; continue; }
      idx++;
      continue;
    }
    if (token === 0x9F) { idx++; continue; }
    if (token === 0xAA) return null;                  // jugada nula: chess.js no la admite, se descarta la partida

    if (token === 0x29) {
      if (idx + 2 >= bloque.length) break;
      const b0 = DESOFUSCAR_2B[(((bloque[idx + 1] - procesados) % 256) + 256) % 256];
      const b1 = DESOFUSCAR_2B[(((bloque[idx + 2] - procesados) % 256) + 256) % 256];
      const empaquetado = (b0 << 8) | b1;
      if (!aplicarDos(tablero, piezas, empaquetado & 0x3F, (empaquetado >> 6) & 0x3F, (empaquetado >> 12) & 0x3, san)) return null;
      clasificar();
      procesados = (procesados + 1) % 256;
      idx += 3;
      continue;
    }
    if (token === 0xDC) { saltoVariante = 1; idx++; continue; }
    if (token === 0x0C) { idx++; continue; }

    const spec = buscarTabla(tablero.turn() === 'w', token);
    if (!spec) { idx++; continue; }                   // byte de metadatos que no es una jugada
    if (!aplicarUna(tablero, piezas, spec.tipo, spec.nr, spec.tab, token, spec.invertir, san)) return null;
    clasificar();
    idx++;
  }
  return { startFen: fen, san, eco: apertura?.eco ?? null, opening: apertura?.nombre ?? null };
}

// ---------- La base ----------

const int24 = (d, i) => (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
const DEC_UTF8 = new TextDecoder('utf-8', { fatal: true }), DEC_LATIN1 = new TextDecoder('windows-1252');

function texto(datos, inicio, longitud) {
  let fin = inicio + longitud, ascii = true;
  for (let i = inicio; i < inicio + longitud; i++) { const b = datos[i]; if (b === 0) { fin = i; break; } if (b > 0x7F) ascii = false; }
  if (fin <= inicio) return '';
  let valor;
  if (ascii) { valor = ''; for (let i = inicio; i < fin; i++) valor += String.fromCharCode(datos[i]); }
  else { const sub = datos.subarray(inicio, fin); try { valor = DEC_UTF8.decode(sub); } catch { valor = DEC_LATIN1.decode(sub); } }
  return valor.replace(/[\u0000-\u001F\u007F-\u009F\uFFFD]/g, '').trim();
}

// Un mismo nombre de pila escrito de dos maneras: la catalana (como figura en la FIDE y en los torneos) y la castellana (como la guarda ChessBase).
const NOMBRES_EQUIVALENTES = [
  ['joan', 'juan', 'jan'], ['josep', 'jose'], ['jordi', 'jorge'], ['jaume', 'jaime'], ['pere', 'pedro'], ['miquel', 'miguel'], ['lluis', 'luis'],
  ['xavier', 'javier'], ['enric', 'enrique'], ['francesc', 'francisco'], ['antoni', 'antonio'], ['albert', 'alberto'], ['ferran', 'fernando'],
  ['rafel', 'rafael'], ['sergi', 'sergio'], ['joaquim', 'joaquin'], ['esteve', 'esteban'], ['carles', 'carlos'], ['ramon', 'raimon'], ['pau', 'pablo'],
  ['vicenc', 'vicente'], ['eduard', 'eduardo'], ['ricard', 'ricardo'], ['guillem', 'guillermo'], ['ignasi', 'ignacio'], ['isidre', 'isidro'],
  ['jeroni', 'jeronimo'], ['gerard', 'gerardo'], ['anna', 'ana'], ['montserrat', 'montse'], ['merce', 'mercedes'], ['joana', 'juana'],
  ['lluisa', 'luisa'], ['concepcio', 'concepcion']
];
const equivalentes = (a, b) => NOMBRES_EQUIVALENTES.some(g => g.includes(a) && g.includes(b));
const compatible = (a, b) => a === b || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b)) || equivalentes(a, b);
const esSubconjunto = (a, b) => [...a].every(x => b.has(x));

function preparar({ nombre, elo }) {
  const partes = nombre.split(/,(.*)/s);
  return { apellidos: palabras(partes[0]), nombres: partes.length > 1 ? palabras(partes[1]) : new Set(), todos: palabras(nombre), tieneComa: partes.length > 1, elo };
}

/** ¿El registro de la base (apellido + nombre) es la persona buscada? */
function coincide(obj, apellido, nombre) {
  const ap = palabras(apellido);
  if (ap.size === 0) return false;
  const nom = palabras(nombre);
  if (!obj.tieneComa) {
    const todos = new Set([...ap, ...nom]);
    return todos.size >= 2 && (esSubconjunto(todos, obj.todos) || esSubconjunto(obj.todos, todos));
  }
  if (!esSubconjunto(ap, obj.apellidos)) return false;
  if (nom.size === 0) return ap.size >= 2;           // sin nombre de pila solo si el apellido es compuesto
  return [...nom].every(n => [...obj.nombres].some(g => compatible(n, g)));
}

const cede = () => new Promise(r => setTimeout(r));
const leerTrozo = async (archivo, desde, hasta) => new Uint8Array(await archivo.slice(desde, hasta).arrayBuffer());

export class ChessBaseDatabase {
  constructor(archivos, total, nombre) { this.archivos = archivos; this.totalPartidas = total; this.nombre = nombre; this.cbp = null; this.cbt = null; }

  /** «handles»: los FileSystemFileHandle elegidos (al menos .cbh, .cbg, .cbp y .cbt de la misma base). */
  static async abrir(handles) {
    const porExt = new Map();
    for (const h of handles) {
      const m = /^(.*)\.(cbh|cbg|cbp|cbt)$/i.exec(h.name);
      if (m) porExt.set(m[2].toLowerCase(), { handle: h, base: m[1] });
    }
    if (!porExt.has('cbh')) throw new ErrorBase('No se encuentra el archivo .cbh de la base. Elige la carpeta que lo contiene.');
    const faltan = ['cbg', 'cbp', 'cbt'].filter(e => !porExt.has(e)).map(e => `${porExt.get('cbh').base}.${e}`);
    if (faltan.length) throw new ErrorBase('La base está incompleta. No encuentro: ' + faltan.join(', ') + ' en esa carpeta.');

    const archivos = {};
    for (const e of ['cbh', 'cbg', 'cbp', 'cbt']) archivos[e] = await porExt.get(e).handle.getFile();
    if (archivos.cbh.size < TAM_REGISTRO * 2) throw new ErrorBase('El archivo .cbh está vacío o es demasiado pequeño.');
    const version = (await leerTrozo(archivos.cbp, 0x18, 0x19))[0];
    if (version !== 0 && version !== 4) throw new ErrorBase('Esta base usa un formato de ChessBase que todavía no se puede leer (por ejemplo el nuevo .2cbh).');
    return new ChessBaseDatabase(archivos, Math.floor(archivos.cbh.size / TAM_REGISTRO) - 1, porExt.get('cbh').base);
  }

  async _cargarIndices() {
    this.cbp ??= new Uint8Array(await this.archivos.cbp.arrayBuffer());
    this.cbt ??= new Uint8Array(await this.archivos.cbt.arrayBuffer());
  }

  get _baseJugadores() { return this.cbp[0x18] === 4 ? 32 : 28; }
  get _baseTorneos() { return this.cbt[0x18] === 4 ? 32 : 28; }
  get _numeroJugadores() { return Math.floor((this.cbp.length - this._baseJugadores) / TAM_JUGADOR); }

  _jugador(n) {
    const i = this._baseJugadores + n * TAM_JUGADOR;
    if (n < 0 || i + 59 > this.cbp.length) return ['', ''];
    return [texto(this.cbp, i + 9, 30), texto(this.cbp, i + 39, 20)];
  }
  _nombreCompleto(n) { const [a, b] = this._jugador(n); return a && b ? `${a}, ${b}` : a + b; }
  _torneo(n) {
    const i = this._baseTorneos + n * TAM_TORNEO;
    if (n < 0 || i + 79 > this.cbt.length) return ['', ''];
    return [texto(this.cbt, i + 9, 40), texto(this.cbt, i + 49, 30)];
  }

  /** Busca las partidas de cada objetivo ({ nombre, elo }) y devuelve, para cada uno, las más recientes (hasta «maxPorJugador»)
   *  ya decodificadas. Es una lectura completa del índice .cbh (unos 500 MB en la MegaDatabase): por eso se buscan todos a la vez.
   *  Devuelve [{ partidas: [{ partida (PartidaPgn), color }], candidatas, noLegibles }]. */
  async buscar(objetivos, maxPorJugador, progreso = () => {}, señal = null) {
    if (objetivos.length > MAX_JUGADORES_POR_LECTURA) throw new ErrorBase('Demasiados jugadores a la vez.');
    const cancelado = () => { if (señal?.aborted) throw new DOMException('Cancelado', 'AbortError'); };
    await this._cargarIndices();

    const preparados = objetivos.map(preparar);
    const resultados = objetivos.map(() => ({ partidas: [], candidatas: 0, noLegibles: 0 }));

    // 1) Qué números de jugador de la base corresponden a cada persona buscada.
    progreso('Buscando los nombres en la base…');
    const total = this._numeroJugadores;
    const mascara = new Int32Array(total);
    for (let i = 0; i < total; i++) {
      if (i % 40000 === 0) { cancelado(); progreso(`Buscando los nombres en la base… ${Math.round(i / total * 100)} %`); await cede(); }
      const [apellido, nombre] = this._jugador(i);
      if (!apellido) continue;
      for (let o = 0; o < preparados.length; o++) if (coincide(preparados[o], apellido, nombre)) mascara[i] |= 1 << o;
    }

    // 2) Todas sus partidas, recorriendo el índice una sola vez.
    progreso('Recorriendo las partidas de la base…');
    const aciertos = preparados.map(() => []);
    const REGISTROS_POR_BLOQUE = 90000;
    const cbhTam = this.archivos.cbh.size;
    // Se piden varios trozos por adelantado mientras se recorre el actual: así la transferencia y el cálculo se solapan.
    const BYTES_BLOQUE = REGISTROS_POR_BLOQUE * TAM_REGISTRO, ADELANTE = 3;
    const numBloques = Math.ceil((cbhTam - TAM_REGISTRO) / BYTES_BLOQUE);
    const pedir = (k) => { const a = TAM_REGISTRO + k * BYTES_BLOQUE; return leerTrozo(this.archivos.cbh, a, Math.min(cbhTam, a + BYTES_BLOQUE)); };
    const pendientes = [];
    for (let k = 0; k < Math.min(ADELANTE, numBloques); k++) pendientes.push(pedir(k));
    let registro = 1;
    for (let k = 0; k < numBloques; k++) {
      cancelado();
      progreso(`Recorriendo las partidas de la base… ${Math.round(k / numBloques * 100)} %`);
      const buf = await pendientes.shift();
      if (k + ADELANTE < numBloques) pendientes.push(pedir(k + ADELANTE));
      for (let p = 0; p + TAM_REGISTRO <= buf.length; p += TAM_REGISTRO, registro++) {
        const banderas = buf[p];
        if ((banderas & 0x01) === 0 || (banderas & 0x80) !== 0) continue;        // no es partida, o está borrada
        const blanco = int24(buf, p + 9), negro = int24(buf, p + 12);
        const mb = blanco < total ? mascara[blanco] : 0, mn = negro < total ? mascara[negro] : 0;
        if ((mb | mn) === 0) continue;

        const fecha = (buf[p + 24] << 16) | (buf[p + 25] << 8) | buf[p + 26];
        const eloB = (buf[p + 31] << 8) | buf[p + 32], eloN = (buf[p + 33] << 8) | buf[p + 34];
        let cabecera = null;
        for (let o = 0; o < preparados.length; o++) {
          for (const [m, color, elo] of [[mb, 'B', eloB], [mn, 'N', eloN]]) {
            if ((m & (1 << o)) === 0) continue;
            // Mismo nombre pero otra persona: el ELO de la partida debe ser parecido al actual.
            if (preparados[o].elo > 0 && elo > 0 && Math.abs(elo - preparados[o].elo) > 250) continue;
            cabecera ??= buf.slice(p, p + TAM_REGISTRO);
            aciertos[o].push({ registro, color, fecha, cabecera });
          }
        }
      }
      await cede();
    }

    // 3) Las más recientes de cada uno, decodificadas.
    progreso('Leyendo las partidas más recientes…');
    for (let o = 0; o < preparados.length; o++) {
      resultados[o].candidatas = aciertos[o].length;
      const mejores = aciertos[o].sort((a, b) => b.fecha - a.fecha || b.registro - a.registro).slice(0, maxPorJugador);
      let n = 0;
      for (const a of mejores) {
        cancelado();
        if (++n % 25 === 0) { progreso(`Leyendo las partidas más recientes… ${n} de ${mejores.length}`); await cede(); }
        const partida = await this._leerPartida(a.cabecera);
        if (!partida) resultados[o].noLegibles++; else resultados[o].partidas.push({ partida, color: a.color });
      }
    }
    return resultados;
  }

  async _leerPartida(registro) {
    const desplazamiento = info32(registro, 1);
    const tam = this.archivos.cbg.size;
    if (desplazamiento <= 0 || desplazamiento + 4 > tam) return null;
    const cabeza = await leerTrozo(this.archivos.cbg, desplazamiento, desplazamiento + 4);
    const info = info32(cabeza);
    if (!tieneBanderasValidas(info)) return null;
    const longitud = longitudDeLaPartida(info);
    if (longitud < 4 || longitud > (1 << 20) || desplazamiento + longitud > tam) return null;
    const decodificada = decodificarPartida(await leerTrozo(this.archivos.cbg, desplazamiento, desplazamiento + longitud));
    if (!decodificada || decodificada.san.length === 0) return null;
    return leerPgn(this._construirPgn(registro, decodificada))[0] ?? null;
  }

  _construirPgn(r, partida) {
    const [evento, sitio] = this._torneo(int24(r, 15));
    const fecha = (r[24] << 16) | (r[25] << 8) | r[26];
    const año = (fecha & 0xFFFE00) >> 9, mes = (fecha & 0x0001E0) >> 5, dia = fecha & 0x1F;
    const ronda = r[29], subronda = r[30];
    const eloB = (r[31] << 8) | r[32], eloN = (r[33] << 8) | r[34];
    const resultado = { 2: '1-0', 1: '1/2-1/2', 0: '0-1' }[r[27]] ?? '*';
    const p2 = (n) => String(n).padStart(2, '0');
    const fechaTexto = año === 0 ? '????.??.??' : mes === 0 ? `${String(año).padStart(4, '0')}.??.??` : dia === 0 ? `${String(año).padStart(4, '0')}.${p2(mes)}.??` : `${String(año).padStart(4, '0')}.${p2(mes)}.${p2(dia)}`;
    const rondaTexto = ronda === 0 ? '?' : subronda !== 0 ? `${ronda}.${subronda}` : String(ronda);
    const cab = (k, v) => `[${k} "${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]\n`;

    let t = cab('Event', evento || '?') + cab('Site', sitio || '?') + cab('Date', fechaTexto) + cab('Round', rondaTexto)
      + cab('White', this._nombreCompleto(int24(r, 9)) || '?') + cab('Black', this._nombreCompleto(int24(r, 12)) || '?') + cab('Result', resultado);
    if (eloB > 0) t += cab('WhiteElo', eloB);
    if (eloN > 0) t += cab('BlackElo', eloN);
    // El ECO de la cabecera de ChessBase falla en ~8 % de las partidas: se usa el de la posición, que además reconoce transposiciones.
    if (partida.eco) t += cab('ECO', partida.eco);
    if (partida.opening) t += cab('Opening', partida.opening);
    if (partida.startFen !== FEN_INICIAL) t += cab('SetUp', '1') + cab('FEN', partida.startFen);
    t += '\n';

    // Numeración de jugadas según la posición de partida.
    const campos = partida.startFen.split(' ');
    let juegaBlancas = campos.length < 2 || campos[1] === 'w';
    let numero = campos.length > 5 && parseInt(campos[5], 10) ? Math.max(1, parseInt(campos[5], 10)) : 1;
    let jugadas = '';
    partida.san.forEach((s, i) => {
      if (juegaBlancas) jugadas += `${numero}. `; else if (i === 0) jugadas += `${numero}... `;
      jugadas += s + ' ';
      if (!juegaBlancas) numero++;
      juegaBlancas = !juegaBlancas;
    });
    return `${t}${jugadas}${resultado}\n\n`;
  }
}

export { PartidaPgn };
