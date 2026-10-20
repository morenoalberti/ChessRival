// Comprueba una jugada de un ejercicio de entrenamiento: ¿mantiene la valoración de la propuesta de Stockfish?
import { Chess } from './vendor/chess.js';

const invertir = e => ({ ...e, centipeones: e.centipeones == null ? null : -e.centipeones, mate: e.mate == null ? null : -e.mate });

/** Evalúa la posición antes («base», si ya se tiene) y después de la jugada y decide si es una alternativa válida.
 *  Una alternativa con mate forzado también vale; nunca se confunde un mate con centipeones ni unas tablas con un mate.
 *  Devuelve { acierto, base }: la referencia sirve para comprobar otras jugadas sin volver a analizar la posición. */
export async function analizarRespuestaEjercicio(motor, { fen, jugada, profundidad = 16, base }, señal) {
  const tablero = new Chess(fen);
  tablero.move({ from: jugada.slice(0, 2), to: jugada.slice(2, 4), promotion: jugada[4] });
  const prof = Math.max(16, Math.min(28, profundidad));
  const antes = base || await motor.analizar(fen, prof, señal);
  let despues;
  if (tablero.isCheckmate()) despues = { centipeones: null, mate: -1, profundidad: prof, variante: [] };
  else if (tablero.isDraw()) despues = { centipeones: 0, mate: null, profundidad: prof, variante: [] };
  else despues = await motor.analizar(tablero.fen(), prof, señal);
  if (señal?.aborted) throw new DOMException('Cancelado', 'AbortError');
  if ((antes.mate == null && !Number.isFinite(antes.centipeones)) || (despues.mate == null && !Number.isFinite(despues.centipeones))) throw new Error('Sin valoración del motor.');
  const tras = invertir(despues);
  const acierto = antes.mate > 0 ? tras.mate > 0
    : tras.mate > 0 ? true
    : tras.mate < 0 ? antes.mate < 0 && Math.abs(tras.mate) >= Math.abs(antes.mate)
    : antes.mate < 0 || tras.centipeones >= antes.centipeones - 30;
  return { acierto, base: antes };
}
