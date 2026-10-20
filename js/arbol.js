// El árbol de aperturas de un jugador con un color (Services/ArbolAperturas.cs) y la línea que más conviene jugarle (LineaRecomendada.cs).
// Cada partida suya reparte sus primeras jugadas por las ramas del árbol: en cada posición se ve qué se ha jugado, cuántas veces y cómo le fue.
import { Chess } from './vendor/chess.js';
import { leerPgn, jugadasDe } from './pgn.js';
import { buscarApertura, epdDe, nombreCompleto } from './aperturas.js';
import { convertirFiguras } from './figuritas.js';

/** Cuántas medias jugadas (de ambos bandos) de cada partida entran en el árbol: 20 son hasta la jugada 10. */
export const PLIES_MAX = 20;
export const FEN_INICIAL = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export class NodoArbol {
  constructor({ san = '', ply = 0, fen = FEN_INICIAL, desde = null, hasta = null, padre = null } = {}) {
    Object.assign(this, { san, ply, fen, desde, hasta, padre });
    this.partidas = 0; this.victorias = 0; this.tablas = 0; this.derrotas = 0;
    this.hijos = new Map();
    this.listaPartidas = [];
  }
  get puntos() { return this.victorias + this.tablas / 2; }
  get porcentaje() { return this.partidas === 0 ? 0 : 100 * this.puntos / this.partidas; }
}

function anotar(nodo, partida) {
  nodo.partidas++;
  const p = partida.puntos;
  if (p >= 1) nodo.victorias++; else if (p <= 0) nodo.derrotas++; else nodo.tablas++;
  nodo.listaPartidas.push(partida);
}

/** Construye el árbol con las partidas terminadas que jugó con «color» («B» o «N»). Cede el control cada cierto número de partidas. */
export async function construir(partidas, color, señal) {
  const raiz = new NodoArbol();
  let n = 0;
  for (const partida of partidas.filter(p => p.colorJugador === color && p.puntos !== null)) {
    if (señal?.cancelado) return null;
    if (++n % 40 === 0) await new Promise(r => setTimeout(r));          // la página sigue respondiendo
    const leida = leerPgn(partida.pgn)[0];
    if (!leida || leida.cab('FEN')) continue;                           // las que no parten de la posición inicial no sirven

    const tablero = new Chess();
    let nodo = raiz;
    anotar(nodo, partida);
    for (const san of jugadasDe(leida.jugadas).slice(0, PLIES_MAX)) {
      let mov;
      try { mov = tablero.move(san); } catch { break; }
      let hijo = nodo.hijos.get(mov.san);
      if (!hijo) {
        hijo = new NodoArbol({ san: mov.san, ply: nodo.ply + 1, fen: tablero.fen(), padre: nodo, desde: mov.from, hasta: mov.to });
        nodo.hijos.set(mov.san, hijo);
      }
      anotar(hijo, partida);
      nodo = hijo;
    }
  }
  return raiz;
}

/** El nombre de la apertura en esa posición («Siciliana: Najdorf»). Si la posición no tiene nombre propio, el de la última que lo tuvo. */
export function nombreApertura(nodo) {
  for (let n = nodo; n; n = n.padre) {
    if (n.ply === 0) break;
    const e = buscarApertura(epdDe(n.fen));
    if (e?.nombre) return nombreCompleto(e.nombre);
  }
  return '';
}

// ---------- La línea que te conviene jugarle ----------

export const Fuente = { Partidas: 'partidas', Libro: 'libro', Motor: 'motor' };

const MINIMO_PARTIDAS = 2;        // partidas mínimas de una jugada para fiarse de ella
const CANDIDATAS = 3;             // cuántas (las de peor resultado para él) se miran con el motor en cada jugada tuya
const ACEPTABLE = -30;            // una evaluación por debajo de este valor (desde tu punto de vista) se considera mala para ti
const PLIES_TOTALES = 24;         // hasta dónde se alarga la línea con teoría y motor (medias jugadas desde el principio)

/** En las jugadas de él se sigue la que más repite y, en las tuyas, entre las que han jugado sus rivales se elige donde él puntúa peor,
 *  siempre que Stockfish no la considere mala para ti. «motor»: un EvaluadorArbol o null. Devuelve [{ nodo, esMia, evalBlancas, fuente }]. */
export async function calcularLinea(raiz, suColor, motor, progreso, señal) {
  const linea = [];
  const yoBlancas = suColor === 'N';
  let nodo = raiz;

  while (nodo.ply < PLIES_MAX && nodo.hijos.size > 0) {
    if (señal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    const mueveEl = (nodo.ply % 2 === 0) === (suColor === 'B');
    let elegido, evaluacion = null;

    if (mueveEl) {
      // Lo que él suele jugar aquí.
      elegido = [...nodo.hijos.values()].sort((a, b) => b.partidas - a.partidas)[0];
      if (elegido.partidas < MINIMO_PARTIDAS) break;
      if (motor) evaluacion = await motor.evaluar(elegido.fen, señal);
    } else {
      // Lo mío: de las jugadas que han hecho sus rivales, donde él puntúa peor y el motor no se queja.
      const candidatas = [...nodo.hijos.values()].filter(h => h.partidas >= MINIMO_PARTIDAS)
        .sort((a, b) => a.porcentaje - b.porcentaje || b.partidas - a.partidas).slice(0, CANDIDATAS);
      if (!candidatas.length) break;

      elegido = null;
      let mejorEval = -Infinity, mejorPorMotor = null;
      for (const c of candidatas) {
        progreso?.(`Evaluando ${convertirFiguras(c.san)} (${c.partidas} partidas)…`);
        const valor = motor ? await motor.evaluar(c.fen, señal) : null;
        const paraMi = valor === null ? null : (yoBlancas ? valor : -valor);
        if (paraMi === null) { elegido = c; evaluacion = null; break; }          // sin motor: la de peor resultado para él
        if (paraMi > mejorEval) { mejorEval = paraMi; mejorPorMotor = c; evaluacion = valor; }
        if (paraMi >= ACEPTABLE) { elegido = c; evaluacion = valor; break; }
      }
      elegido ??= mejorPorMotor ?? candidatas[0];                               // ninguna es buena: la que menos mala sea
    }

    linea.push({ nodo: elegido, esMia: !mueveEl, evalBlancas: evaluacion, fuente: Fuente.Partidas });
    nodo = elegido;
  }

  if (motor) await completarConMotor(linea, nodo, suColor, motor, progreso, señal);
  return linea;
}

/** Cuando sus partidas se acaban, la línea sigue con lo que ve Stockfish. */
async function completarConMotor(linea, ultimo, suColor, motor, progreso, señal) {
  const tablero = new Chess(ultimo.fen);
  let nodo = ultimo;
  while (nodo.ply < PLIES_TOTALES) {
    if (señal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    const mueveEl = (nodo.ply % 2 === 0) === (suColor === 'B');
    progreso?.(mueveEl ? 'Buscando su respuesta con Stockfish…' : 'Buscando tu jugada con Stockfish…');

    const uci = await motor.mejorJugada(nodo.fen, señal);
    if (!uci) break;
    let mov;
    try { mov = tablero.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { break; }

    const hijo = new NodoArbol({ san: mov.san, ply: nodo.ply + 1, fen: tablero.fen(), padre: nodo, desde: mov.from, hasta: mov.to });
    const evaluacion = await motor.evaluar(hijo.fen, señal);
    linea.push({ nodo: hijo, esMia: !mueveEl, evalBlancas: evaluacion, fuente: Fuente.Motor });
    nodo = hijo;
  }
}
