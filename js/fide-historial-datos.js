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
  extras.push({ etiqueta: 'Máximo', icono: 'copa', valor: `${maximo[ritmo]} en ${maximo.fecha.slice(0, 4)}` });

  const ultimo = serie[serie.length - 1];
  const limite = mesesDe(ultimo.fecha) - 12;
  const antes = [...serie].reverse().find(p => mesesDe(p.fecha) <= limite);
  if (antes) {
    const cambio = ultimo[ritmo] - antes[ritmo];
    extras.push({ etiqueta: 'Último año', icono: 'tendencia', valor: cambio > 0 ? `+${cambio}` : cambio < 0 ? `−${Math.abs(cambio)}` : '0', tendencia: Math.sign(cambio) });
  }
  return extras;
}

/** Una tarjeta más, «Trayectoria», con lo que se sabe de toda su carrera: desde cuándo tiene Elo, su mejor Elo y su ritmo más fuerte. */
export function tarjetaTrayectoria(bloques, historial) {
  const puntos = (historial ?? []).filter(p => p && /^\d{4}-\d{2}$/.test(p.fecha));
  if (puntos.length < 2) return null;
  const extras = [{ etiqueta: 'En la lista desde', icono: 'calendario', valor: puntos[0].fecha.slice(0, 4) }];
  let mejor = null;
  for (const [titulo, ritmo] of Object.entries(RITMOS)) {
    for (const p of puntos) if (p[ritmo] > (mejor?.elo ?? 0)) mejor = { elo: p[ritmo], titulo, anio: p.fecha.slice(0, 4) };
  }
  if (mejor) extras.push({ etiqueta: 'Mejor ELO', icono: 'copa', valor: `${mejor.elo} ${mejor.titulo} en ${mejor.anio}` });
  const fuerte = bloques.filter(b => RITMOS[b.titulo] && Number(b.elo) > 0).sort((x, y) => Number(y.elo) - Number(x.elo))[0];
  if (fuerte) extras.push({ etiqueta: 'Ritmo más fuerte', icono: 'grafico', valor: `${fuerte.titulo} ${fuerte.elo}` });
  return { titulo: 'Trayectoria', elo: '', blancas: null, negras: null, extras };
}

/** Añade a cada bloque sin resultados («blancas» o «negras» nulos) los datos del historial, y la tarjeta de la trayectoria al principio. */
export function completarConHistorial(bloques, historial) {
  const completados = bloques.map(b => (b.blancas && b.negras) ? b : { ...b, extras: datosDelHistorial(b.titulo, historial) });
  if (!bloques.some(b => !(b.blancas && b.negras))) return completados;
  const trayectoria = tarjetaTrayectoria(bloques, historial);
  return trayectoria ? [trayectoria, ...completados] : completados;
}
