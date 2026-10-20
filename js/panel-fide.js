// Franja con lo más importante de la ficha FIDE (FideEstadisticasPanel.cs): cuatro tarjetas (Total, Standard, Rapid, Blitz)
// con el ELO y, para blancas y negras, una barra de victorias, tablas y derrotas.
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function barra({ total, victorias, tablas, derrotas }) {
  if (total <= 0) return '<div class="fide-barra"></div>';
  const trozo = (valor, clase, nombre) => valor <= 0 ? '' :
    `<span class="fide-trozo ${clase}" style="flex-grow:${valor}" title="${nombre}: ${valor} (${Math.round(valor / total * 100)} %)">${valor / total >= .09 ? valor : ''}</span>`;
  return `<div class="fide-barra">${trozo(victorias, 'victorias', 'Victorias')}${trozo(tablas, 'tablas', 'Tablas')}${trozo(derrotas, 'derrotas', 'Derrotas')}</div>`;
}

/** Sin los resultados de la FIDE: el máximo y la variación del último año (del historial del Elo); si tampoco hay historial, un aviso. */
function extrasHtml(b) {
  if (!b.extras?.length) return '<p class="fide-sin-resultados suave">Resultados no disponibles ahora</p>';
  return `<div class="fide-extras">${b.extras.map(e => `<div class="fide-extra"><span class="suave">${esc(e.etiqueta)}</span><b class="${e.tendencia > 0 ? 'sube' : e.tendencia < 0 ? 'baja' : ''}">${esc(e.valor)}</b></div>`).join('')}</div>
    <p class="fide-sin-resultados suave">Resultados con blancas y negras: no disponibles ahora</p>`;
}

/** El HTML de las tarjetas, en el orden preferido (los títulos separados por comas; los que no estén, al final). */
export function htmlTarjetasFide(bloques, orden = '', { arrastrable = true } = {}) {
  const preferido = orden.split(',').map(s => s.trim()).filter(Boolean);
  const pos = (b) => { const i = preferido.indexOf(b.titulo); return i >= 0 ? i : 99; };
  return [...bloques].sort((a, b) => pos(a) - pos(b)).map((b, i) => `
    <div class="tarjeta-ficha fide-tarjeta" ${arrastrable ? 'draggable="true"' : ''} data-titulo="${esc(b.titulo)}" style="--i:${i}"
         title="${arrastrable ? 'Resultados en partidas con rating FIDE: victorias (azul), tablas (gris) y derrotas (oscuro). Arrástrala para cambiarla de sitio.' : 'Resultados con blancas y negras'}">
      <div class="fide-cab"><span class="suave">${esc(b.titulo)}</span>${b.elo ? `<span class="fide-elo">ELO ${esc(b.elo)}</span>` : ''}</div>
      ${b.blancas && b.negras ? `<div class="fide-etiqueta">Blancas ${b.blancas.total}</div>${barra(b.blancas)}
      <div class="fide-etiqueta">Negras ${b.negras.total}</div>${barra(b.negras)}` : extrasHtml(b)}
    </div>`).join('');
}

/** Marcadores de carga mientras llegan los datos de la FIDE. */
export const htmlEsqueletoFide = () => Array.from({ length: 4 }, () =>
  '<div class="tarjeta-ficha fide-tarjeta esqueleto"><div class="esq-linea corta"></div><div class="esq-linea"></div><div class="esq-barra"></div><div class="esq-linea"></div><div class="esq-barra"></div></div>').join('');
