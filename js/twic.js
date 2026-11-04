import { PROXY_URL } from './config.js';
import { leerPgn, colorDelJugador } from './pgn.js';

/** Solo consulta el índice preparado. No descarga entregas ni guarda partidas del usuario. */
export async function buscarTwic(jugador, progreso = () => {}, señal) {
  const partidas = [], vistas = new Set();
  let cursor = '', estado;
  // Máximo 20 páginas/2.000 partidas por apertura. El servidor acota también cada página.
  for (let pagina = 0; pagina < 20; pagina++) {
    señal?.throwIfAborted();
    const url = new URL('/api/twic/jugador', PROXY_URL);
    url.searchParams.set('name', jugador.name ?? '');
    url.searchParams.set('fideId', jugador.fideId ?? '');
    if (cursor) url.searchParams.set('cursor', cursor);
    const r = await fetch(url, { signal: señal ? AbortSignal.any([señal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.estado === 'limite' ? 'Se ha alcanzado el límite diario de consultas TWIC. Inténtalo mañana.' : d.error || 'No se pudo consultar TWIC.');
    if (!Array.isArray(d.partidas) || !['sin_configurar', 'preparando', 'parcial', 'listo'].includes(d.estado)) throw new Error('La respuesta de TWIC no es válida.');
    estado = d;
    for (const fila of d.partidas) {
      for (const p of leerPgn(fila.pgn ?? '')) {
        if (colorDelJugador(jugador, p) === null || vistas.has(p.pgn)) continue;
        vistas.add(p.pgn); partidas.push(p);
      }
    }
    progreso(partidas.length);
    if (!d.siguiente) return { ...estado, partidas, limitada: false };
    if (d.siguiente === cursor) throw new Error('TWIC ha repetido una página de resultados.');
    cursor = d.siguiente;
  }
  return { ...estado, partidas, limitada: true };
}
