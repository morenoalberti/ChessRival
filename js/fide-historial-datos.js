// Cuando la FIDE no da los resultados con blancas y negras, las tarjetas de Elo se completan con lo que sí dice el historial del Elo:
// el máximo que ha alcanzado en ese ritmo y cuánto ha subido o bajado en el último año.

const RITMOS = { Standard: 'standard', Rapid: 'rapid', Blitz: 'blitz' };
const mesesDe = (fecha) => { const [a, m] = String(fecha).split('-').map(Number); return a * 12 + (m - 1); };

/** @param {string} titulo «Standard», «Rapid» o «Blitz»; @param {Array<{fecha, standard, rapid, blitz}>} historial  Devuelve [{ etiqueta, valor }] (vacío si no hay datos). */
export function datosDelHistorial(titulo, historial) {
  const ritmo = RITMOS[titulo];
  const serie = (historial ?? []).filter(p => p && p[ritmo] > 0 && /^\d{4}-\d{2}$/.test(p.fecha));
  if (!ritmo || serie.length < 2) return [];
  const extras = [];
  const maximo = serie.reduce((m, p) => (p[ritmo] > m[ritmo] ? p : m), serie[0]);
  extras.push({ etiqueta: 'Máximo', valor: `${maximo[ritmo]} · ${maximo.fecha.slice(0, 4)}` });

  const ultimo = serie[serie.length - 1];
  const limite = mesesDe(ultimo.fecha) - 12;
  const antes = [...serie].reverse().find(p => mesesDe(p.fecha) <= limite);
  if (antes) {
    const cambio = ultimo[ritmo] - antes[ritmo];
    extras.push({ etiqueta: 'Último año', valor: cambio > 0 ? `+${cambio}` : cambio < 0 ? `−${Math.abs(cambio)}` : '0', tendencia: Math.sign(cambio) });
  }
  return extras;
}

/** Añade a cada bloque sin resultados («blancas» o «negras» nulos) los datos del historial. */
export function completarConHistorial(bloques, historial) {
  return bloques.map(b => (b.blancas && b.negras) ? b : { ...b, extras: datosDelHistorial(b.titulo, historial) });
}
