// Nombres y resúmenes de aperturas (Services/Aperturas.cs, OpeningBook.cs) y clasificación de una partida por sus jugadas.
import { Chess } from './vendor/chess.js';
import { FAMILIAS, LADOS, FAMILIAS_ES, VARIANTES_ES, PALABRAS, TIPOS } from './aperturas-datos.js';
import { jugadasDe } from './pgn.js';
import { convertirFiguras } from './figuritas.js';
import { registrarNombre } from './i18n.js';

// ---------- Libro de aperturas (Lichess, dominio público): posición EPD → { eco, nombre } ----------

let _libro = null, _propias = null;

export async function cargarLibroAperturas() {
  if (_libro) return _libro;
  const [libro, propias] = await Promise.all([
    fetch('assets/openings.json').then(r => r.json()).catch(() => ({})),
    fetch('assets/traducciones_aperturas.json').then(r => r.json()).catch(() => ({}))
  ]);
  _libro = new Map(Object.entries(libro).map(([epd, v]) => [epd, { eco: v.eco, nombre: v.name ?? '' }]));
  _propias = new Map(Object.entries(propias).filter(([, v]) => v?.trim()).map(([k, v]) => [k.trim().toLowerCase(), v.trim()]));
  return _libro;
}

/** La posición sin los contadores de jugadas: lo que usa el libro como clave. */
export const epdDe = (fen) => fen.split(' ').slice(0, 4).join(' ');
export const buscarApertura = (epd) => _libro?.get(epd) ?? null;

/** Pone el ECO y el nombre de la apertura según la posición alcanzada (reconoce transposiciones). Si no se reconoce, las cabeceras se quedan. */
export function clasificarApertura(partida) {
  if (partida.cab('FEN')) return { eco: partida.cab('ECO'), apertura: partida.cab('Opening') };
  const tablero = new Chess();
  let encontrada = null;
  const jugadas = jugadasDe(partida.jugadas);
  for (let i = 0; i < jugadas.length && i < 40; i++) {
    try { tablero.move(jugadas[i]); } catch { break; }
    const e = buscarApertura(epdDe(tablero.fen()));
    if (e) encontrada = e;
  }
  return encontrada
    ? { eco: encontrada.eco, apertura: encontrada.nombre || partida.cab('Opening') }
    : { eco: partida.cab('ECO'), apertura: partida.cab('Opening') };
}

// ---------- Nombres ----------

const mayus = (t) => t.toLowerCase();
const _famEs = new Map(Object.entries(FAMILIAS_ES).map(([k, v]) => [mayus(k), v]));
const _varEs = new Map(Object.entries(VARIANTES_ES).map(([k, v]) => [mayus(k), v]));

const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const traducirPalabras = (texto) => PALABRAS.reduce((t, [en, es]) => t.replace(new RegExp(`(?<![\\p{L}\\d])${escRe(en)}(?![\\p{L}\\d])`, 'gu'), es), texto);

/** Traduce un nombre de apertura o variante de Lichess: primero el diccionario y, si no está, por reglas. */
function traducirNombre(nombre, dic) {
  const original = nombre.replace('�', 'ü').trim();
  const resultado = traducirNombreEs(nombre, dic);
  registrarNombre(resultado, original);                           // para poder ponerlo en inglés
  return resultado;
}
function traducirNombreEs(nombre, dic) {
  nombre = nombre.replace('�', 'ü').trim();
  const propia = _propias?.get(nombre.toLowerCase());
  if (propia) return propia;                                      // lo fijado a mano manda sobre todo lo demás
  const trad = dic.get(nombre.toLowerCase());
  if (trad) return trad;

  const con = nombre.indexOf(', with ');
  if (con > 0) return `${traducirNombre(nombre.slice(0, con), dic)} con ${nombre.slice(con + 7)}`;

  let estado = '';
  for (const [final, texto] of [[' Accepted', ' aceptado'], [' Declined', ' rehusado'], [' Deferred', ' diferido']]) {
    if (nombre.endsWith(final)) { nombre = nombre.slice(0, -final.length); estado = texto; break; }
  }

  for (const [sufijo, palabra] of TIPOS) {
    if (!nombre.toLowerCase().endsWith(' ' + sufijo.toLowerCase())) continue;
    let nucleo = nombre.slice(0, -(sufijo.length + 1));
    for (const [prefijo, adjetivo] of [['Accelerated ', ' acelerado'], ['Delayed ', ' retrasado'], ['Reversed ', ' invertido']]) {
      if (nucleo.startsWith(prefijo)) { nucleo = nucleo.slice(prefijo.length) + adjetivo; break; }
    }
    const fem = ['Variante', 'Línea'].includes(palabra);
    const est = estado ? estado.replace('aceptado', fem ? 'aceptada' : 'aceptado').replace('rehusado', fem ? 'rehusada' : 'rehusado') : '';
    return `${palabra} ${traducirPalabras(nucleo)}${est}`;
  }
  return traducirPalabras(nombre) + estado;
}

/** Nombre de la apertura en español. Si la partida trae el nombre (se calcula por las jugadas al importarla) se usa ese;
 *  si no, la familia que corresponde al código ECO. */
export function familia(eco, apertura) {
  const conocida = (apertura ?? '').trim();
  if (conocida) {
    const dp = conocida.indexOf(': ');
    return traducirNombre(dp > 0 ? conocida.slice(0, dp) : conocida, _famEs);
  }
  const codigo = (eco ?? '').trim().toUpperCase();
  if (/^[A-E]\d\d/.test(codigo)) {
    const c = codigo.slice(0, 3);
    for (const [desde, hasta, nombre] of FAMILIAS) if (c >= desde && c <= hasta) return nombre;
  }
  const nombreApertura = (apertura ?? '').split(':')[0].trim();
  return nombreApertura || 'Sin clasificar';
}

/** «Abiertas (Italiana, Escocesa, Petrov)» → «Abiertas». */
export const nombreCorto = (fam) => { const i = fam.indexOf(' ('); return i > 0 ? fam.slice(0, i) : fam; };

const primera = (p) => p.primerMovimiento ? convertirFiguras(p.primerMovimiento) : '—';

/** Etiqueta con el formato «1.e4 · Española». */
export const etiqueta = (p) => `${primera(p)} · ${familia(p.eco, p.apertura)}`;

/** Quién juega lo que da nombre a la apertura de una etiqueta «1.e4 · Siciliana»: «B», «N» o «?». */
export function ladoQueLaJuega(etiq) {
  const pos = etiq.indexOf(' · ');
  let fam = (pos >= 0 ? etiq.slice(pos + 3) : etiq).split(':')[0].trim();
  if (fam in LADOS) return LADOS[fam];
  if (fam.startsWith('Defensa ')) return 'N';
  if (fam.startsWith('Ataque ') || fam.startsWith('Sistema ') || fam.startsWith('Apertura ')) return 'B';
  return fam.startsWith('Gambito de dama') || fam.startsWith('Gambito de rey') ? 'B' : '?';
}

/** Nombre completo en español, con todas sus variantes: «Siciliana: Najdorf, Variante inglesa». */
export function nombreCompleto(apertura) {
  const nombre = (apertura ?? '').trim();
  if (!nombre) return '';
  const propia = _propias?.get(nombre.toLowerCase());
  if (propia) return propia;
  const dp = nombre.indexOf(': ');
  if (dp < 0) return traducirNombre(nombre, _famEs);
  const trozos = [];
  for (const v of nombre.slice(dp + 2).split(', ')) {
    if (v.startsWith('with ') && trozos.length) trozos[trozos.length - 1] += ', ' + v; else trozos.push(v);
  }
  return `${traducirNombre(nombre.slice(0, dp), _famEs)}: ${trozos.map(v => traducirNombre(v, _varEs)).join(', ')}`;
}

/** Lo que elige quien responde: «1.d4 · India de rey». Si la familia no es una defensa, se distingue por la jugada con la que responde. */
export function etiquetaDefensa(p) {
  const fam = nombreCorto(familia(p.eco, p.apertura));
  if (ladoQueLaJuega(`${primera(p)} · ${fam}`) === 'N' || !p.respuesta) return `${primera(p)} · ${fam}`;
  return `${primera(p)} ${convertirFiguras(p.respuesta)} · ${fam}`;
}

// ---------- Resúmenes ----------

export class FilaApertura {
  constructor(nombre, partidas, puntos) { this.nombre = nombre; this.partidas = partidas; this.puntos = puntos; }
  get porcentaje() { return this.partidas === 0 ? 0 : Math.round(this.puntos * 100 / this.partidas); }
  get detalle() { return `${this.partidas} · ${this.porcentaje} %`; }
}

function agrupar(partidas, color, clave) {
  const grupos = new Map();
  for (const p of partidas) {
    if (p.colorJugador !== color || p.puntos === null) continue;
    const k = clave(p);
    const g = grupos.get(k) ?? [0, 0];
    g[0]++; g[1] += p.puntos;
    grupos.set(k, g);
  }
  return [...grupos].map(([k, [n, pts]]) => new FilaApertura(k, n, pts))
    .sort((a, b) => b.partidas - a.partidas || a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
}

export const resumir = (partidas, color) => agrupar(partidas, color, etiqueta);

/** Cifras de la pestaña Resumen. */
export function estadisticasJugador(partidas) {
  const porColor = (color) => {
    const lista = partidas.filter(p => p.colorJugador === color);
    const terminadas = lista.filter(p => p.puntos !== null);
    return [lista.length, terminadas.length ? Math.round(terminadas.reduce((s, p) => s + p.puntos, 0) * 100 / terminadas.length) : null];
  };
  const [blancas, pb] = porColor('B'), [negras, pn] = porColor('N');
  return { total: partidas.length, blancas, porcentajeBlancas: pb, negras, porcentajeNegras: pn };
}
