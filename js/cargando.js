// Indicador de carga: nueve cuadros, del azul claro al intenso, que se encienden en diagonal (como el de RondaSwiss).
// Se usa en cualquier punto donde se espera a que lleguen o se calculen datos.
const TONOS = ['#D4E0FA', '#B2C8F4', '#8FAEF0', '#5F8DEB', '#2F6FEA'];
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** El HTML del indicador con su texto debajo. «mini»: versión pequeña, en línea con el texto. */
export function htmlCargando(texto = '', { mini = false } = {}) {
  const cuadros = Array.from({ length: 9 }, (_, i) => { const d = (i % 3) + Math.trunc(i / 3); return `<i style="--d:${d};background:${TONOS[d]}"></i>`; }).join('');
  return `<span class="cargando-bloque${mini ? ' mini' : ''}" role="status"><span class="cargando-rejilla">${cuadros}</span>${texto ? `<span class="cargando-texto">${esc(texto)}</span>` : ''}</span>`;
}

/** Sustituye el contenido de un elemento por el indicador. */
export function ponerCargando(elemento, texto, opciones) { elemento.innerHTML = htmlCargando(texto, opciones); }

/** Lo pone encima de un panel (con un velo claro) y lo actualiza si ya estaba. */
export function mostrarCargando(panel, texto) {
  let el = panel.querySelector(':scope > .cargando');
  if (!el) {
    el = document.createElement('div');
    el.className = 'cargando';
    el.innerHTML = htmlCargando('');
    panel.appendChild(el);
  }
  let t = el.querySelector('.cargando-texto');
  if (!t) { t = document.createElement('span'); t.className = 'cargando-texto'; el.querySelector('.cargando-bloque').appendChild(t); }
  t.textContent = texto;
}
export const quitarCargando = (panel) => panel.querySelector(':scope > .cargando')?.remove();
