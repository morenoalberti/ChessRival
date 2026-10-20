// Mide la calidad de las jugadas del jugador (Services/Stockfish/AnalizadorPartidas.cs): en cada jugada propia se compara la evaluación
// de la posición antes de jugar con la de después (siempre desde su punto de vista); la diferencia es lo que pierde.
import { Chess } from './vendor/chess.js';
import { leerPgn, jugadasDe } from './pgn.js';
import { buscarApertura, epdDe } from './aperturas.js';

export const FASES = { apertura: 'apertura', medioJuego: 'medio juego', final: 'final' };
export const VERSION_ANALISIS = 2;

// Las evaluaciones se recortan a ±10 peones: perder una dama estando ya ganado no es «perder 20 peones».
const TOPE = 1000;
// Cuando el resultado ya está claro (más de 15 peones durante tres posiciones seguidas) no se sigue.
const DECIDIDA = 1500;

const VALOR = { n: 3, b: 3, r: 5, q: 9 };
export const materialSinPeones = (fen) => [...fen.split(' ')[0].toLowerCase()].reduce((s, c) => s + (VALOR[c] ?? 0), 0);

/** Apertura: las 12 primeras jugadas con el material casi completo. Final: poco material. */
function fase(ply, material) {
  if (material <= 14) return FASES.final;
  if (ply < 24 && material >= 24) return FASES.apertura;
  return FASES.medioJuego;
}

/** Devuelve { partidaId, motor, profundidad, jugadas: [{ ply, san, perdida, fase, evalAntes, evalDespues, mejor }] } o null. */
export async function analizarPartida(motor, partida, profundidad, señal, { confirmarCriticas = false } = {}) {
  const leida = leerPgn(partida.pgn)[0];
  if (!leida) return null;
  const jugadas = jugadasDe(leida.jugadas);
  if (!jugadas.length) return null;

  const fenInicial = leida.cab('FEN');
  const tablero = fenInicial ? new Chess(fenInicial) : new Chess();
  const soyBlancas = partida.colorJugador === 'B';

  // Posiciones antes de cada jugada (y la final).
  const posiciones = [];
  const info = (t) => ({ fen: t.fen(), enLibro: !!buscarApertura(epdDe(t.fen())), material: materialSinPeones(t.fen()), blancas: t.turn() === 'w' });
  let hechas = 0;
  for (let i = 0; i < jugadas.length; i++) {
    const antes = info(tablero);
    try { tablero.move(jugadas[i]); } catch { break; }     // el PGN tiene una jugada que no se puede leer: se analiza lo anterior
    posiciones.push(antes);
    hechas++;
  }
  const mateFinal = tablero.isCheckmate();
  const tablasFinal = tablero.isDraw();
  posiciones.push(info(tablero));

  const evaluaciones = new Map();
  const evaluar = async (i) => {
    if (!evaluaciones.has(i)) evaluaciones.set(i, await motor.analizar(posiciones[i].fen, profundidad, señal));
    return evaluaciones.get(i);
  };

  await motor.nuevaPartida();
  const resultado = [];
  let decididas = 0;

  for (let i = 0; i < hechas; i++) {
    if (señal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    if (posiciones[i].blancas !== soyBlancas) continue;          // jugada del rival

    // Jugadas de libro: la posición de antes y la de después son teoría, no hay nada que medir.
    const tras = i + 1;
    if (!confirmarCriticas && posiciones[i].enLibro && posiciones[tras].enLibro) {
      resultado.push({ ply: i + 1, san: jugadas[i], perdida: 0, fase: fase(i, posiciones[i].material), evalAntes: 0, evalDespues: 0, mejor: '' });
      continue;
    }

    let antes = await evaluar(i);
    let valorAntes = Math.max(-TOPE, Math.min(TOPE, antes.valor));
    let valorDespues;
    if (tras === hechas && mateFinal) valorDespues = TOPE;
    else if (tras === hechas && tablasFinal) valorDespues = 0;
    else valorDespues = Math.max(-TOPE, Math.min(TOPE, -(await evaluar(tras)).valor));   // el rival mueve: se invierte el signo

    let confirmada = false, respuestaRival = '';
    const profCritica = Math.min(28, profundidad + 4);
    if (confirmarCriticas && (valorAntes - valorDespues >= 150 || (valorAntes >= 200 && valorDespues < 100))) {
      antes = await motor.analizar(posiciones[i].fen, profCritica, señal);
      valorAntes = Math.max(-TOPE, Math.min(TOPE, antes.valor));
      if (tras === hechas && mateFinal) valorDespues = TOPE;
      else if (tras === hechas && tablasFinal) valorDespues = 0;
      else {
        const despues = await motor.analizar(posiciones[tras].fen, profCritica, señal);
        valorDespues = Math.max(-TOPE, Math.min(TOPE, -despues.valor));
        respuestaRival = despues.mejorJugada;
      }
      confirmada = true;
    }
    decididas = Math.abs(antes.valor) >= DECIDIDA ? decididas + 1 : 0;
    resultado.push({
      ply: i + 1, san: jugadas[i], perdida: Math.max(0, valorAntes - valorDespues), fase: fase(i, posiciones[i].material),
      evalAntes: valorAntes, evalDespues: valorDespues, mejor: antes.mejorJugada,
      confirmada, respuestaRival, profundidad: confirmada ? profCritica : profundidad
    });
    if (decididas >= 3) break;
  }
  let apertura = null;
  if (confirmarCriticas && hechas >= 24) {
    const e = await evaluar(24);
    apertura = { ply: 24, valor: Math.max(-TOPE, Math.min(TOPE, e.valor * (posiciones[24].blancas === soyBlancas ? 1 : -1))), profundidad };
  }
  return { partidaId: partida.id, motor: motor.nombre ?? 'Stockfish 19 lite', profundidad, version: VERSION_ANALISIS,
    estudioVersion: confirmarCriticas ? 1 : 0, apertura, jugadas: resultado };
}
