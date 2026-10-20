// Franja con lo más importante de la ficha FIDE (FideEstadisticasPanel.cs): cuatro tarjetas (Total, Standard, Rapid, Blitz)
// con el ELO y, para blancas y negras, una barra de victorias, tablas y derrotas.
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function barra({ total, victorias, tablas, derrotas }) {
  if (total <= 0) return '<div class="fide-barra"></div>';
  const trozo = (valor, clase, nombre) => valor <= 0 ? '' :
    `<span class="fide-trozo ${clase}" style="flex-grow:${valor}" title="${nombre}: ${valor} (${Math.round(valor / total * 100)} %)">${valor / total >= .09 ? valor : ''}</span>`;
  return `<div class="fide-barra">${trozo(victorias, 'victorias', 'Victorias')}${trozo(tablas, 'tablas', 'Tablas')}${trozo(derrotas, 'derrotas', 'Derrotas')}</div>`;
}

const ICONOS = {
  Standard: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  Rapid: '<path d="M12 2c3 2 5 6 5 10l-2 3H9l-2-3c0-4 2-8 5-10Zm-3 13-3 4 4-1m6-3 3 4-4-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="12" cy="9.5" r="1.4" fill="currentColor"/>',
  Blitz: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" fill="currentColor"/>',
  Trayectoria: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  Total: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  copa: '<path d="M7 4h10v5a5 5 0 0 1-10 0V4Zm0 2H4v1a3 3 0 0 0 3 3m10-4h3v1a3 3 0 0 1-3 3M12 14v4m-4 2h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  tendencia: '<path d="M3 17l6-6 4 4 8-8m0 0h-5m5 0v5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  calendario: '<rect x="3.5" y="5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 10h17M8 3v4m8-4v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  grafico: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'
};
const icono = (nombre, tam) => `<svg viewBox="0 0 24 24" width="${tam}" height="${tam}" aria-hidden="true">${ICONOS[nombre] ?? ICONOS.Total}</svg>`;

/** Sin los resultados de la FIDE: el máximo, la variación del último año y demás datos del historial del Elo; si tampoco hay historial, un aviso. */
function extrasHtml(b) {
  if (!b.extras?.length) return '<p class="fide-sin-resultados suave">Resultados no disponibles ahora</p>';
  return `<div class="fide-extras">${b.extras.map(e => `<div class="fide-extra">${icono(e.icono, 16)}<span class="suave">${esc(e.etiqueta)}</span><b class="${e.tendencia > 0 ? 'sube' : e.tendencia < 0 ? 'baja' : ''}">${esc(e.valor)}</b></div>`).join('')}</div>`;
}

/** El HTML de las tarjetas, en el orden preferido (los títulos separados por comas; los que no estén, al final). */
export function htmlTarjetasFide(bloques, orden = '', { arrastrable = true } = {}) {
  const preferido = orden.split(',').map(s => s.trim()).filter(Boolean);
  const pos = (b) => { const i = preferido.indexOf(b.titulo); return i >= 0 ? i : 99; };
  return [...bloques].sort((a, b) => pos(a) - pos(b)).map((b, i) => `
    <div class="tarjeta-ficha fide-tarjeta" ${arrastrable ? 'draggable="true"' : ''} data-titulo="${esc(b.titulo)}" style="--i:${i}"
         title="${arrastrable ? 'Resultados en partidas con rating FIDE: victorias (azul), tablas (gris) y derrotas (oscuro). Arrástrala para cambiarla de sitio.' : 'Resultados con blancas y negras'}">
      <div class="fide-cab"><span class="fide-cab-nom">${icono(b.titulo, 17)}<span>${esc(b.titulo)}</span></span>${b.elo ? `<span class="fide-elo" title="ELO">${esc(b.elo)}</span>` : ''}</div>
      <div class="fide-cuerpo">${b.blancas && b.negras ? `<div class="fide-etiqueta">Blancas ${b.blancas.total}</div>${barra(b.blancas)}
      <div class="fide-etiqueta">Negras ${b.negras.total}</div>${barra(b.negras)}` : extrasHtml(b)}</div>
    </div>`).join('');
}

/** Marcadores de carga mientras llegan los datos de la FIDE. */
export const htmlEsqueletoFide = () => Array.from({ length: 4 }, () =>
  '<div class="tarjeta-ficha fide-tarjeta esqueleto"><div class="esq-linea corta"></div><div class="esq-linea"></div><div class="esq-barra"></div><div class="esq-linea"></div><div class="esq-barra"></div></div>').join('');
