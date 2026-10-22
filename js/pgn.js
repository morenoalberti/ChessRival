// Lectura de PGN, ritmo de juego y reconocimiento del jugador en una partida (PgnParser.cs, RitmoPartida.cs, ImportadorPartidas.cs).

const RE_CABECERA = /^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/gm;
const RESULTADOS = new Set(['1-0', '0-1', '1/2-1/2', '½-½', '*']);

/** Una partida leída de un PGN: sus cabeceras, las jugadas y el texto original completo. */
export class PartidaPgn {
  constructor(cabeceras, jugadas, pgn) { this.cabeceras = cabeceras; this.jugadas = jugadas; this.pgn = pgn; }

  cab(clave) {
    const v = this.cabeceras[clave.toLowerCase()];
    return v !== undefined && v !== '?' ? v : '';
  }

  /** Resultado normalizado a lo que admite la base: 1-0, 0-1, 1/2-1/2 o *. */
  get resultado() {
    const t = this.cab('Result').replace('½', '1/2');
    return ['1-0', '0-1', '1/2-1/2'].includes(t) ? t : '*';
  }

  get primerMovimiento() { return primerMovimiento(this.jugadas); }
}

/** Decodifica el archivo: UTF-8 y, si no lo es, Latin-1 (como exporta ChessBase). */
export function decodificar(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}

export function leerPgn(texto) {
  // Algunas exportaciones de AhoraAjedrez escapan el corchete final y omiten Event.
  // Solo se repara el cierre de etiquetas; las jugadas y los datos se conservan.
  texto = texto.replace(/^([ \t]*\[\w+[ \t]+"(?:[^"\\]|\\.)*")[ \t]*\\\]([ \t]*\r?)$/gm, '$1]$2');
  const bloques = [];
  for (const m of texto.matchAll(RE_CABECERA)) {
    let bloque = bloques.at(-1);
    const clave = m[1].toLowerCase();
    if (!bloque || texto.slice(bloque.fin, m.index).trim() || (clave === 'event' && bloque.cabeceras.event !== undefined)) {
      bloque = { inicio: m.index, fin: 0, cabeceras: {} };
      bloques.push(bloque);
    }
    bloque.cabeceras[clave] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    bloque.fin = m.index + m[0].length;
  }
  return bloques.map((b, i) => {
    const fin = bloques[i + 1]?.inicio ?? texto.length;
    return new PartidaPgn(b.cabeceras, texto.slice(b.fin, fin).trim(), texto.slice(b.inicio, fin).trim());
  });
}

/** Jugadas en notación algebraica, sin números, comentarios, variantes ni resultado. */
export function jugadasDe(textoJugadas) {
  let t = textoJugadas.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
  let anterior;
  do { anterior = t; t = t.replace(/\([^()]*\)/g, ' '); } while (t !== anterior);   // variantes, de dentro hacia fuera
  t = t.replace(/\$\d+/g, ' ').replace(/\d+\s*\.(\s*\.\.)?/g, ' ');
  return t.split(/\s+/).filter(x => x && !RESULTADOS.has(x));
}

/** Jugadas numeradas: «1.e4 e5 2.Nf3 Nc6». */
export function numerar(jugadas, empiezanBlancas = true, numeroInicial = 1) {
  const texto = [];
  let blancas = empiezanBlancas, numero = numeroInicial, primera = true;
  for (const j of jugadas) {
    texto.push((blancas ? `${numero}.` : primera ? `${numero}...` : '') + j);
    if (!blancas) numero++;
    blancas = !blancas;
    primera = false;
  }
  return texto.join(' ');
}

export function primerMovimiento(textoJugadas) {
  const primera = jugadasDe(textoJugadas)[0];
  return primera ? '1.' + primera : '';
}

// ---------- Ritmo de juego ----------

export const Ritmo = { Desconocido: 0, Lento: 1, Rapido: 2, Blitz: 3 };

function desdeControl(control) {
  control = control.trim();
  if (!control || control === '-' || control === '?') return null;
  // PGN expresa segundos. Se usan 60 incrementos, como en los apéndices A y B de las Leyes FIDE.
  const periodos = control.split(':');
  const primero = /^(?:(\d+)\/)?(\d+)(?:\+(\d+))?$/.exec(periodos[0]);
  if (!primero) return null;
  const [, movimientos, base, inc] = primero;
  if (movimientos) {
    // Los controles por periodos cortos no permiten deducir con seguridad la duración total.
    if (Number(base) >= 3600) return Ritmo.Lento;
    return null;
  }
  const estimado = Number(base) + 60 * Number(inc || 0);
  return estimado <= 600 ? Ritmo.Blitz : estimado < 3600 ? Ritmo.Rapido : Ritmo.Lento;
}

/** Primero la cabecera TimeControl; si no sirve, el nombre del evento. Si no hay forma de saberlo, «Desconocido». */
export function detectarRitmo(p) {
  const porControl = desdeControl(p.cab('TimeControl'));
  if (porControl !== null) return porControl;
  const texto = (p.cab('Event') + ' ' + p.cab('Site')).toLowerCase();
  const tiene = (...ps) => ps.some(x => texto.includes(x));
  if (tiene('blitz', 'relámpago', 'relampago', 'bullet')) return Ritmo.Blitz;
  if (tiene('rapid', 'rápid', 'semirr', 'semirap')) return Ritmo.Rapido;
  if (tiene('clásic', 'clasic', 'classical', 'standard', 'ritmo lento')) return Ritmo.Lento;
  return Ritmo.Desconocido;
}

export const textoRitmo = (r) => ['—', 'Lento', 'Rápido', 'Blitz'][r] ?? '—';

// ---------- ¿Es esta partida del jugador? ----------

/** Las mismas palabras escritas de otra manera al pasarlas a letras latinas deben salir iguales («Yurii», «Yuri», «Yuriy»). */
const translit = (p) => { for (const par of ['ij', 'iy', 'ii', 'yi', 'yj', 'yy']) p = p.replaceAll(par, 'i'); return p.replaceAll('y', 'i'); };

export function palabras(texto) {
  // Camino rápido: casi todos los nombres son ASCII y no necesitan normalizarse (se llama millones de veces al leer la MegaDatabase).
  const sinTildes = /[^\x00-\x7F]/.test(texto) ? texto.normalize('NFD').replace(/\p{M}/gu, '') : texto;
  return new Set(sinTildes.toLowerCase().replace(/[^\p{L}]/gu, ' ').split(' ').filter(Boolean).map(translit));
}

/** «Moreno Ruiz, Javier», «Moreno Ruiz Javier» y «Javier Moreno Ruiz» son la misma persona; «Moreno, Javier» también. */
function nombreCoincide(nombre, enPgn) {
  const a = palabras(nombre), b = palabras(enPgn);
  if (!a.size || !b.size) return false;
  if (a.size === b.size && [...a].every(x => b.has(x))) return true;
  const [menor, mayor] = a.size <= b.size ? [a, b] : [b, a];
  if (menor.size >= 2 && [...menor].every(x => mayor.has(x))) return true;
  // «Terron Elena, Francisco M.»: mismos apellidos y primer nombre completo;
  // una inicial solo puede abreviar un nombre adicional, nunca decidir por sí sola la identidad.
  const partesA = nombre.split(','), partesB = enPgn.split(',');
  if (partesA.length !== 2 || partesB.length !== 2) return false;
  const apA = palabras(partesA[0]), apB = palabras(partesB[0]);
  if (apA.size !== apB.size || ![...apA].every(x => apB.has(x))) return false;
  const na = [...palabras(partesA[1])], nb = [...palabras(partesB[1])];
  return na.length > 1 && na.length === nb.length && na[0].length > 1 && na[0] === nb[0]
    && na.every((x, i) => x === nb[i] || (x.length === 1 && nb[i].startsWith(x)) || (nb[i].length === 1 && x.startsWith(nb[i])));
}

/** «B» o «N» según el color con el que juega el jugador; null si la partida no es suya. Si el PGN trae el ID FIDE, manda sobre el nombre. */
export function colorDelJugador(jugador, partida) {
  const id = valor => { const n = Number((/\d+/.exec(valor ?? '') ?? [''])[0]); return n > 0 ? String(n) : ''; };
  const fide = id(jugador.fideId), fideB = id(partida.cab('WhiteFideId')), fideN = id(partida.cab('BlackFideId'));
  if (fide) {
    if (fideB === fide) return 'B';
    if (fideN === fide) return 'N';
  }
  const casa = (nombreEnPgn, fideEnPgn) => nombreCoincide(jugador.name, nombreEnPgn) && !(fide && fideEnPgn && fideEnPgn !== fide);
  if (casa(partida.cab('White'), fideB)) return 'B';
  if (casa(partida.cab('Black'), fideN)) return 'N';
  return null;
}
