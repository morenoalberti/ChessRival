export function normalizarTitulo(titulo) {
  titulo = String(titulo ?? '').trim().replace(/\s*·\s*/g, '/');
  return ['-', '—', '?'].includes(titulo) ? '' : titulo;
}

/** Nombre de presentación; el nombre original se conserva para búsquedas y partidas. */
export function nombreConTitulo(jugador, titulo = jugador?.fideTitle || jugador?.titulo || '') {
  const nombre = String(jugador?.name ?? jugador?.nombre ?? '').trim();
  titulo = normalizarTitulo(titulo);
  if (!titulo) return nombre;
  if (nombre.toLocaleUpperCase().startsWith(`${titulo.toLocaleUpperCase()} `)) return nombre;
  return `${titulo} ${nombre}`.trim();
}

/** Siempre distingue al jugador estudiado de los rivales de sus partidas. */
export function textoColoresDeLinea(jugador, color) {
  const nombre = nombreConTitulo(jugador);
  if (color === 'B') return `Blancas: ${nombre} · Negras: sus rivales`;
  if (color === 'N') return `Blancas: sus rivales · Negras: ${nombre}`;
  return `Jugador estudiado: ${nombre}`;
}
