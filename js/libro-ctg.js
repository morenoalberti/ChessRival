// Lector de libros de aperturas CTG de ChessBase (Power Book y los libros de Fritz): Services/ChessBase/LibroCtg.cs.
// Un libro son tres archivos con el mismo nombre: .ctg (las posiciones), .ctb (los límites del índice) y .cto (el índice).
// El formato y el cálculo de las claves son los del lector de código abierto «chess-opening-book-reader» (el mismo que usa ChessVision).
import { Chess } from './vendor/chess.js';
import { HASH_BITS, CODIGO_PIEZA, INDICE_PIEZA, ADELANTE, IZQUIERDA } from './libro-ctg-tablas.js';

export class ErrorLibro extends Error {}

/** Una jugada del libro: { san, uci, anotacion, partidas, puntosQuienJuega (0-100 o null), desde, hasta }. */
/** Lo que dice el libro de una posición: { totalPartidas, victoriasBlancas, tablas, victoriasNegras, jugadas }. */

const PAGINA = 4096;

const BITS_PIEZA = {
  '': [0x0, 1],
  P: [0x3, 3], p: [0x7, 3], N: [0x9, 5], n: [0x19, 5], B: [0x5, 5], b: [0x15, 5],
  R: [0xd, 5], r: [0x1d, 5], Q: [0x11, 6], q: [0x31, 6], K: [0x1, 6], k: [0x21, 6]
};

const ANOTACIONES = {
  0x01: '!', 0x02: '?', 0x03: '!!', 0x04: '??', 0x05: '!?', 0x06: '?!', 0x08: 'única', 0x16: 'zugzwang',
  0x0b: '=', 0x0d: 'poco claro', 0x0e: '=+', 0x0f: '+=', 0x10: '-/+', 0x11: '+/-', 0x13: '+-',
  0x20: 'ventaja de desarrollo', 0x24: 'iniciativa', 0x28: 'con ataque', 0x2c: 'compensación', 0x84: 'contrajuego', 0x8a: 'apuros de tiempo'
};

const leer24 = (d, i) => (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
const leerU32 = (d, i) => ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0;
const cambiar = (p) => (p === p.toUpperCase() ? p.toLowerCase() : p.toUpperCase());

/** Las piezas del FEN: piezas[columna 0-7 (a-h)][fila 0-7 (1-8)], '' si la casilla está vacía. */
function piezasDe(fen) {
  const piezas = Array.from({ length: 8 }, () => Array(8).fill(''));
  let fila = 7, columna = 0;
  for (const c of fen.split(' ')[0]) {
    if (c === '/') { fila--; columna = 0; }
    else if (c >= '0' && c <= '9') columna += Number(c);
    else piezas[columna++][fila] = c;
  }
  return piezas;
}

function columnaDelRey(piezas, rey) {
  for (let columna = 0; columna < 8; columna++) for (let fila = 0; fila < 8; fila++) if (piezas[columna][fila] === rey) return columna;
  return -1;
}

function ponerBits(bytes, bits, posicion, numero) {
  for (let i = 0; i < numero; i++, bits >>= 1) {
    const absoluta = posicion + i, indice = Math.floor(absoluta / 8);
    while (bytes.length <= indice) bytes.push(0);
    if (bits & 1) bytes[indice] |= 1 << (7 - (absoluta % 8));
  }
}

function puedeCapturarAlPaso(piezas, casilla, mueveNegras) {
  const columna = casilla.charCodeAt(0) - 97, fila = mueveNegras ? 3 : 4, peon = mueveNegras ? 'p' : 'P';
  return (columna > 0 && piezas[columna - 1][fila] === peon) || (columna < 7 && piezas[columna + 1][fila] === peon);
}

/** La firma de una posición: la clave con la que el libro la guarda (las negras al turno se «giran» y, si el rey está en el flanco de dama, se espeja). */
export function firmaDe(fen) {
  const partes = fen.split(' ');
  const turno = partes[1], enroques = partes[2] ?? '-';
  let alPaso = partes[3] ?? '-';
  const piezas = piezasDe(fen), girar = turno === 'b';
  if (alPaso !== '-' && !puedeCapturarAlPaso(piezas, alPaso, girar)) alPaso = '-';
  const rey = columnaDelRey(piezas, girar ? 'k' : 'K');
  const espejo = rey >= 0 && rey < 4 && enroques === '-';

  const bytes = [0];
  let posicionBit = 8;
  for (let columna = 0; columna < 8; columna++) for (let fila = 0; fila < 8; fila++) {
    let c = columna, f = fila;
    if (girar) f = 7 - f;
    if (espejo) c = 7 - c;
    let pieza = piezas[c][f];
    if (girar && pieza) pieza = cambiar(pieza);
    const [bits, numero] = BITS_PIEZA[pieza];
    ponerBits(bytes, bits, posicionBit, numero);
    posicionBit += numero;
  }

  let alPasoColumna = -1, bitsDeBanderas = 0;
  if (alPaso !== '-') {
    alPasoColumna = alPaso.charCodeAt(0) - 97;
    if (espejo) alPasoColumna = 7 - alPasoColumna;
    bitsDeBanderas = 3;
  }

  const muevenBlancas = !girar;
  const hay = (lado, blancas) => enroques.includes(blancas ? lado : lado.toLowerCase());
  let enroque = 0;
  if (hay('K', muevenBlancas)) enroque += 4;
  if (hay('Q', muevenBlancas)) enroque += 8;
  if (hay('K', !muevenBlancas)) enroque += 1;
  if (hay('Q', !muevenBlancas)) enroque += 2;
  if (enroque !== 0) bitsDeBanderas += 4;

  let banderas = enroque;
  if (alPasoColumna !== -1) {
    banderas <<= 3;
    let ep = alPasoColumna;
    for (let i = 0; i < 3; i++, ep >>= 1) if (ep & 1) banderas |= 1 << (2 - i);
  }

  let relleno;
  if (8 - (posicionBit % 8) < bitsDeBanderas) {
    relleno = 8 - (posicionBit % 8);
    ponerBits(bytes, 0, posicionBit, relleno);
    posicionBit += relleno;
  }
  relleno = 8 - (posicionBit % 8) - bitsDeBanderas;
  if (relleno < 0) relleno += 8;
  ponerBits(bytes, 0, posicionBit, relleno);
  posicionBit += relleno;
  ponerBits(bytes, banderas, posicionBit, bitsDeBanderas);
  posicionBit += bitsDeBanderas;

  const longitud = Math.ceil(posicionBit / 8);
  while (bytes.length < longitud) bytes.push(0);
  bytes.length = longitud;
  bytes[0] = longitud;
  if (alPaso !== '-') bytes[0] |= 1 << 5;
  if (enroque !== 0) bytes[0] |= 1 << 6;
  return Uint8Array.from(bytes);
}

function hashDeFirma(firma) {
  let hash = 0, tmp = 0;
  for (const b of firma) {
    tmp += ((0x0f - (b & 0x0f)) << 2) + 1;
    hash = (hash + HASH_BITS[tmp & 0x3f]) | 0;
    tmp += ((0xf0 - (b & 0xf0)) >> 2) + 1;
    hash = (hash + HASH_BITS[tmp & 0x3f]) | 0;
  }
  return hash >>> 0;
}

/** Una jugada del libro (su código de un byte) pasada a casillas y legalizada con las reglas del ajedrez. */
function decodificarJugada(fen, codigo, anotacion) {
  const partes = fen.split(' ');
  const girar = partes[1] === 'b', enroques = partes[2] ?? '-';
  const piezas = piezasDe(fen);
  const rey = columnaDelRey(piezas, girar ? 'k' : 'K');
  const espejo = rey >= 0 && rey < 4 && enroques === '-';

  let desdeColumna, desdeFila, haciaColumna, haciaFila;
  if (codigo === 107 || codigo === 246) {
    desdeFila = haciaFila = girar ? 7 : 0;
    desdeColumna = 4;
    haciaColumna = codigo === 107 ? 6 : 2;
  } else {
    const buscada = CODIGO_PIEZA[codigo], indice = INDICE_PIEZA[codigo];
    if (buscada === 'x' || indice < 1) return null;
    let columnaHallada = -1, filaHallada = -1, cuenta = 0;
    for (let columna = 0; columna < 8 && columnaHallada < 0; columna++) for (let fila = 0; fila < 8; fila++) {
      let c = columna, f = fila;
      if (girar) f = 7 - f;
      if (espejo) c = 7 - c;
      let pieza = piezas[c][f];
      if (girar && pieza) pieza = cambiar(pieza);
      if (pieza !== buscada) continue;
      if (++cuenta === indice) { columnaHallada = columna; filaHallada = fila; break; }
    }
    if (columnaHallada < 0) return null;
    haciaColumna = (columnaHallada - IZQUIERDA[codigo] + 8) % 8;
    haciaFila = (filaHallada + ADELANTE[codigo] + 8) % 8;
    desdeColumna = columnaHallada; desdeFila = filaHallada;
    if (girar) { desdeFila = 7 - desdeFila; haciaFila = 7 - haciaFila; }
    if (espejo) { desdeColumna = 7 - desdeColumna; haciaColumna = 7 - haciaColumna; }
  }

  const casilla = (c, f) => String.fromCharCode(97 + c) + (f + 1);
  const desde = casilla(desdeColumna, desdeFila), hacia = casilla(haciaColumna, haciaFila);
  let candidatas;
  try { candidatas = new Chess(fen).moves({ verbose: true }).filter(m => m.from === desde && m.to === hacia); } catch { return null; }
  if (!candidatas.length) return null;
  const m = candidatas.find(x => x.promotion === 'q') ?? candidatas[0];
  return { san: m.san, uci: m.from + m.to + (m.promotion ?? ''), anotacion: ANOTACIONES[anotacion] ?? '', partidas: 0, puntosQuienJuega: null, desde, hasta: hacia };
}

export class LibroCtg {
  /** @param {{ctg, cto}} lectores cada uno con { size, leer(desde, cuantos) → Promise<Uint8Array> }; «bajo» y «alto» salen del .ctb. */
  constructor(ctg, cto, bajo, alto) { this.ctg = ctg; this.cto = cto; this.bajo = bajo; this.alto = alto; }

  /** «ctg», «ctb» y «cto»: los tres archivos, con la forma { name, getFile() } de los archivos del navegador (o del servidor local). */
  static async abrir({ ctg, ctb, cto }) {
    for (const [ext, h] of [['ctg', ctg], ['ctb', ctb], ['cto', cto]]) if (!h) throw new ErrorLibro(`El libro está incompleto. No encuentro el archivo .${ext}.`);
    const fCtb = await ctb.getFile();
    const bytesCtb = new Uint8Array(await fCtb.arrayBuffer());
    if (bytesCtb.length < 12) throw new ErrorLibro('El archivo .ctb del libro no es válido.');
    const lector = async (h) => {
      const f = await h.getFile();
      return { size: f.size, leer: async (a, n) => new Uint8Array(await f.slice(a, Math.min(a + n, f.size)).arrayBuffer()) };
    };
    return new LibroCtg(await lector(ctg), await lector(cto), leerU32(bytesCtb, 4), leerU32(bytesCtb, 8));
  }

  /** Lo que dice el libro de la posición, o null si no la tiene. Con «conEstadisticas» se consulta también la posición que resulta de cada jugada,
   *  para saber cuántas partidas tiene y cómo le va a quien la juega. */
  async consultar(fen, conEstadisticas = false) {
    const basica = await this._basica(fen);
    if (!basica || !conEstadisticas) return basica;
    const mueveBlancas = fen.split(' ')[1] === 'w';
    const jugadas = [];
    for (const jugada of basica.jugadas) {
      let hijoFen;
      try { const t = new Chess(fen); t.move({ from: jugada.uci.slice(0, 2), to: jugada.uci.slice(2, 4), promotion: jugada.uci[4] }); hijoFen = t.fen(); } catch { jugadas.push(jugada); continue; }
      const hijo = await this._basica(hijoFen);
      if (!hijo || hijo.totalPartidas === 0) { jugadas.push(jugada); continue; }
      const mias = mueveBlancas ? hijo.victoriasBlancas : hijo.victoriasNegras;
      jugadas.push({ ...jugada, partidas: hijo.totalPartidas, puntosQuienJuega: 100 * (mias + hijo.tablas / 2) / hijo.totalPartidas });
    }
    return { ...basica, jugadas };
  }

  async _basica(fen) {
    const mueveNegras = fen.split(' ')[1] === 'b';
    const firma = firmaDe(fen);
    const pagina = await this._paginaDe(hashDeFirma(firma));
    if (pagina === null) return null;

    const datos = await this.ctg.leer(PAGINA * (pagina + 1), PAGINA);
    if (datos.length < 4) return null;
    const posiciones = (datos[0] << 8) | datos[1], bytesEnPagina = (datos[2] << 8) | datos[3];
    if (posiciones === 0 || bytesEnPagina < 4 || bytesEnPagina > datos.length) return null;

    let inicio = 4;
    for (let i = 0; i < posiciones && inicio < bytesEnPagina; i++) {
      const tamanoFirma = datos[inicio] & 0x1f;
      let coincide = firma.length === tamanoFirma;
      for (let k = 0; k < firma.length && coincide; k++) if (datos[inicio + k] !== firma[k]) coincide = false;

      // Cada registro: la firma de la posición, las jugadas del libro (de dos bytes cada una) y las estadísticas.
      let cursor = inicio + tamanoFirma;
      const tamanoJugadas = datos[cursor];
      const numeroJugadas = tamanoJugadas > 0 ? Math.trunc((tamanoJugadas - 1) / 2) : 0;
      const codigos = [];
      for (let m = 0; m < numeroJugadas; m++) codigos.push([datos[cursor + 1 + m * 2], datos[cursor + 2 + m * 2]]);
      cursor += tamanoJugadas;

      const total = leer24(datos, cursor); cursor += 3;
      const victoriasA = leer24(datos, cursor); cursor += 3;
      const victoriasB = leer24(datos, cursor); cursor += 3;
      const tablas = leer24(datos, cursor); cursor += 3;
      cursor += 4 + 3 + 4 + 3 + 4;   // otras estadísticas
      cursor += 3;                   // recomendación, reservado y comentario

      if (coincide) {
        // El libro guarda las posiciones con las blancas al turno: con las negras al turno los colores vienen cambiados.
        const blancas = mueveNegras ? victoriasB : victoriasA, negras = mueveNegras ? victoriasA : victoriasB;
        const jugadas = codigos.map(([codigo, anotacion]) => decodificarJugada(fen, codigo, anotacion)).filter(Boolean);
        return { totalPartidas: total, victoriasBlancas: blancas, tablas, victoriasNegras: negras, jugadas };
      }
      inicio = cursor;
    }
    return null;
  }

  async _paginaDe(hash) {
    let llave = 0n, mascara = 1n;
    const h = BigInt(hash), alto = BigInt(this.alto), bajo = BigInt(this.bajo);
    while (llave <= alto) {
      llave = (h & mascara) + mascara;
      if (llave >= bajo) {
        const posicion = 16 + Number(llave) * 4;
        if (posicion + 4 > this.cto.size) return null;
        const pagina = leerU32(await this.cto.leer(posicion, 4), 0);
        if (pagina < 0x80000000) return pagina;
      }
      mascara = (mascara << 1n) + 1n;
      if (mascara > 0xFFFFFFFFn) break;
    }
    return null;
  }
}
