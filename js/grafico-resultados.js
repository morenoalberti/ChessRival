// El gráfico de resultados del Resumen: un anillo con victorias, tablas y derrotas, y una barra por color. Solo cuenta partidas terminadas.
const COLORES = { g: '#0B60B0', t: '#A8ADBA', p: '#3F4650' };

/** Cuántas ganó, empató y perdió, en total y por color. @param {Array<{colorJugador: 'B'|'N', puntos: number|null}>} partidas */
export function contarResultados(partidas) {
  const vacio = () => ({ g: 0, t: 0, p: 0 });
  const r = { total: vacio(), B: vacio(), N: vacio() };
  for (const p of partidas) {
    if (p.puntos === null || p.puntos === undefined || (p.colorJugador !== 'B' && p.colorJugador !== 'N')) continue;
    const k = p.puntos >= 1 ? 'g' : p.puntos > 0 ? 't' : 'p';
    r.total[k]++; r[p.colorJugador][k]++;
  }
  return r;
}

const suma = (o) => o.g + o.t + o.p;
const pct = (n, total) => (total ? Math.round(n * 100 / total) : 0);

/** El anillo (SVG). Cada tramo entra dibujándose. */
function anillo(o) {
  const total = suma(o), radio = 40, largo = 2 * Math.PI * radio;
  let acumulado = 0;
  const tramos = total === 0 ? '' : ['g', 't', 'p'].filter(k => o[k] > 0).map((k, i) => {
    const parte = (o[k] / total) * largo, desfase = -acumulado;
    acumulado += parte;
    return `<circle class="anillo-tramo" cx="50" cy="50" r="${radio}" fill="none" stroke="${COLORES[k]}" stroke-width="14" stroke-dasharray="${Math.max(0, parte - 1.5).toFixed(2)} ${largo.toFixed(2)}" stroke-dashoffset="${desfase.toFixed(2)}" transform="rotate(-90 50 50)" style="--largo:${largo.toFixed(2)};animation-delay:${i * 120}ms"/>`;
  }).join('');
  const puntos = total ? Math.round((o.g + o.t / 2) * 100 / total) : null;
  return `<svg class="anillo" viewBox="0 0 100 100" width="132" height="132" role="img" aria-label="Resultados">
      <circle cx="50" cy="50" r="${radio}" fill="none" stroke="#E3EAF6" stroke-width="14"/>${tramos}
      <text x="50" y="49" text-anchor="middle" class="anillo-num">${puntos === null ? '—' : puntos + ' %'}</text>
      <text x="50" y="62" text-anchor="middle" class="anillo-sub">puntuación</text></svg>`;
}

const barra = (o) => {
  const total = suma(o);
  if (!total) return '<div class="res-barra vacia"></div>';
  return `<div class="res-barra">${['g', 't', 'p'].filter(k => o[k] > 0).map(k => `<span class="res-trozo ${k}" style="flex-grow:${o[k]}" title="${o[k]} (${pct(o[k], total)} %)">${o[k] / total >= .12 ? o[k] : ''}</span>`).join('')}</div>`;
};

/** El HTML del cuerpo de la tarjeta. */
export function htmlResultados(r) {
  const total = suma(r.total);
  if (!total) return '<p class="vacio-texto">Todavía no hay partidas terminadas para mostrar sus resultados.</p>';
  const fila = (k, nombre) => `<li><i class="res-punto ${k}"></i><span>${nombre}</span><b>${r.total[k]}</b><span class="suave">${pct(r.total[k], total)} %</span></li>`;
  return `<div class="res-cuerpo">
    ${anillo(r.total)}
    <ul class="res-leyenda">${fila('g', 'Victorias')}${fila('t', 'Tablas')}${fila('p', 'Derrotas')}</ul>
    <div class="res-colores">
      <div><span class="res-etiqueta"><i class="punto-color blanco"></i>Con blancas · ${suma(r.B)}</span>${barra(r.B)}</div>
      <div><span class="res-etiqueta"><i class="punto-color negro"></i>Con negras · ${suma(r.N)}</span>${barra(r.N)}</div>
    </div></div>`;
}
