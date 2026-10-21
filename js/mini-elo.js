// La mini-curva del ELO de las tarjetas de jugador: los últimos años de su ELO clásico, en verde si sube y en rojo si baja.
const MAX_PUNTOS = 60;                                   // unos cinco años de lista mensual o trimestral

/** De la lista [{ fecha, standard }] a los últimos valores del ELO clásico. */
export function valoresDeHistorial(historial) {
  return (historial ?? []).filter(p => p && p.standard > 0).slice(-MAX_PUNTOS).map(p => p.standard);
}

/** El dibujo (SVG) o '' si no hay datos suficientes. */
export function svgMiniElo(valores, ancho = 46, alto = 18) {
  if (!Array.isArray(valores)) return '';                // aún no ha llegado: no se pone nada
  // Sin curva: una etiqueta pequeña explica por qué (jugador recién entrado en la lista, o sin historial).
  if (valores.length === 0) return '<span class="mini-elo-etiqueta" title="No hay historial de ELO de este jugador">Sin historial</span>';
  if (valores.length < 3) return '<span class="mini-elo-etiqueta nuevo" title="Jugador recién entrado en la lista de la FIDE: aún hay muy poco historial para dibujar su evolución">Nuevo</span>';
  const min = Math.min(...valores), max = Math.max(...valores), rango = Math.max(max - min, 12);
  const x = (i) => 1.5 + (i / (valores.length - 1)) * (ancho - 3);
  const y = (v) => alto - 2 - ((v - min) / rango) * (alto - 4);
  const puntos = valores.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const cambio = valores.at(-1) - valores[0];
  const clase = cambio > 4 ? 'sube' : cambio < -4 ? 'baja' : 'igual';
  const signo = cambio > 0 ? '+' : cambio < 0 ? '−' : '';
  return `<svg class="mini-elo ${clase}" viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}" role="img" aria-label="Evolución del ELO: ${signo}${Math.abs(cambio)}">
    <title>Evolución del ELO (últimos años): ${signo}${Math.abs(cambio)}</title>
    <polyline points="${puntos}" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${x(valores.length - 1).toFixed(1)}" cy="${y(valores.at(-1)).toFixed(1)}" r="2.2"/></svg>`;
}
