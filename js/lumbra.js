import { PROXY_URL } from './config.js';
import { leerPgn, colorDelJugador } from './pgn.js';

/** Consulta solo el índice de Lumbra ya preparado; la importación se confirma aparte. */
export async function buscarLumbra(jugador, progreso = () => {}, signal) {
  const partidas = [], vistas = new Set();
  let cursor = '', estado;
  for (let pagina = 0; pagina < 20; pagina++) {
    signal?.throwIfAborted();
    const url = new URL('/api/lumbra/jugador', PROXY_URL);
    url.searchParams.set('name', jugador.name ?? '');
    url.searchParams.set('fideId', jugador.fideId ?? '');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo consultar Lumbra’s Gigabase.');
    if (!Array.isArray(data.partidas) || !['sin_configurar', 'preparando', 'listo'].includes(data.estado)) throw new Error('La respuesta de Lumbra’s Gigabase no es válida.');
    estado = data;
    for (const row of data.partidas) for (const game of leerPgn(row.pgn ?? '')) {
      if (colorDelJugador(jugador, game) === null || vistas.has(game.pgn)) continue;
      vistas.add(game.pgn); partidas.push(game);
    }
    progreso(partidas.length);
    if (!data.siguiente) return { ...estado, partidas, limitada: false };
    if (data.siguiente === cursor) throw new Error('Lumbra’s Gigabase ha repetido una página de resultados.');
    cursor = data.siguiente;
  }
  return { ...estado, partidas, limitada: true };
}
