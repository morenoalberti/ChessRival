// Posiciones de una línea UCI del motor, calculadas siempre desde su FEN de origen.
import { Chess } from './vendor/chess.js';

export function posicionesDeVariante(fen, jugadas, limite = 12) {
  const tablero = new Chess(fen);
  const posiciones = [];
  let numero = Number(fen.split(' ')[5]) || 1;
  for (const uci of jugadas.slice(0, limite)) {
    const blancas = tablero.turn() === 'w';
    let jugada;
    try { jugada = tablero.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); }
    catch { break; }
    const prefijo = blancas ? `${numero}. ` : posiciones.length === 0 ? `${numero}... ` : '';
    posiciones.push({ texto: prefijo + jugada.san, fen: tablero.fen(), desde: jugada.from, hasta: jugada.to });
    if (!blancas) numero++;
  }
  return posiciones;
}
