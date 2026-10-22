// Importa a un jugador las partidas de uno o varios PGN (ChessBase, YottaChess, Lichess…): ImportadorPartidas.cs.
import { leerPgn, decodificar, colorDelJugador, detectarRitmo } from './pgn.js';
import { cargarLibroAperturas, clasificarApertura } from './aperturas.js';
import { guardarPartidas, claveJugador, refrescarTarjetasDe } from './db-partidas.js';

/** Lee un archivo PGN: sus partidas y cuántas son del jugador. Reutiliza los bytes si ya se han leído. */
export async function leerArchivo(archivo, jugador, bytes = null) {
  const partidas = leerPgn(decodificar(bytes ?? await archivo.arrayBuffer()));
  const suyas = partidas.filter(p => colorDelJugador(jugador, p) !== null).length;
  return { archivo, partidas, suyas, total: partidas.length };
}

/** «lecturas»: resultado de leerArchivo para cada archivo. «fuente» es el nombre con el que se anota de dónde vienen (p. ej. «YottaChess»). */
export async function importar(jugador, lecturas, fuente = 'PGN', progreso = () => {}) {
  await cargarLibroAperturas();
  let leidas = 0, ajenas = 0;
  const aGuardar = [];
  for (const { partidas, fuente: fuenteArchivo = fuente } of lecturas) {
    for (const partida of partidas) {
      leidas++;
      const color = colorDelJugador(jugador, partida);
      if (!color) { ajenas++; continue; }
      const { eco, apertura } = clasificarApertura(partida);
      aGuardar.push({ partida, color, eco, apertura, ritmo: detectarRitmo(partida), fuente: fuenteArchivo });
      if (aGuardar.length % 200 === 0) { progreso(`Leyendo partidas… ${aGuardar.length}`); await new Promise(r => setTimeout(r)); }
    }
  }
  const clave = claveJugador(jugador);
  const r = await guardarPartidas(clave, aGuardar, fuente);
  await refrescarTarjetasDe(clave);
  return { archivos: lecturas.length, leidas, ajenas, ...r };
}

export function mensaje(nombre, r) {
  if (!r.archivos) return '';
  if (!r.leidas) return 'No se encontró ninguna partida en los archivos. Comprueba que son PGN.';
  if (r.leidas === r.ajenas)
    return `Los archivos tienen ${r.leidas} partidas, pero ninguna de ${nombre}. Comprueba que su nombre aparece igual en las cabeceras White y Black.`;
  let m = r.nuevas === 0 ? 'No hay partidas nuevas.' : r.nuevas === 1 ? 'Se ha importado 1 partida nueva.' : `Se han importado ${r.nuevas} partidas nuevas.`;
  if (r.repetidas > 0) m += ` ${r.repetidas} ya estaban guardadas.`;
  if (r.enLote > 0) m += ` ${r.enLote} ${r.enLote === 1 ? 'estaba repetida' : 'estaban repetidas'} entre los archivos seleccionados.`;
  if (r.ajenas > 0) m += ` ${r.ajenas} eran de otros jugadores y se han ignorado.`;
  return m;
}
