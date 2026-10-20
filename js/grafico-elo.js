import { LOCALE } from './i18n.js';
// Gráfico de la evolución del ELO (Standard, Rapid y Blitz), como EloGraficoControl.cs. Al pasar el ratón por encima
// marca el mes más cercano y enseña el ELO de cada ritmo. Las líneas se dibujan con una animación al aparecer.
const COLORES = { standard: '#2F6FD9', rapid: '#F26A5B', blitz: '#D98A1E' };
const COLOR_EJE = '#6B7A90', COLOR_REJILLA = '#E3EAF6';
const M = { izq: 40, der: 8, sup: 6, inf: 18 };
const NS = 'http://www.w3.org/2000/svg';
const MES = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' });

const tiempo = (fecha) => { const [a, m] = fecha.split('-').map(Number); return Date.UTC(a, m - 1, 1); };
const el = (tag, atributos = {}, padre) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(atributos)) e.setAttribute(k, v);
  padre?.appendChild(e);
  return e;
};

export function montarGraficoElo(contenedor, puntos) {
  contenedor.innerHTML = '';
  contenedor.classList.add('elo-grafico');
  const tooltip = Object.assign(document.createElement('div'), { className: 'elo-tooltip' });
  contenedor.appendChild(tooltip);
  let svgEl = null, geom = null, animar = true;

  function dibujar() {
    const ancho = contenedor.clientWidth, alto = contenedor.clientHeight;
    if (puntos.length < 2 || ancho < 120 || alto < 50) return;
    svgEl?.remove();
    svgEl = el('svg', { width: ancho, height: alto, viewBox: `0 0 ${ancho} ${alto}` });
    contenedor.insertBefore(svgEl, tooltip);

    const valores = puntos.flatMap(p => [p.standard, p.rapid, p.blitz]).filter(v => v > 0);
    if (!valores.length) return;
    let min = Math.floor((Math.min(...valores) - 20) / 100) * 100;
    let max = Math.ceil((Math.max(...valores) + 20) / 100) * 100;
    if (max - min < 200) max = min + 200;
    const desde = tiempo(puntos[0].fecha), hasta = tiempo(puntos.at(-1).fecha);
    const zona = { izq: M.izq, sup: M.sup, der: ancho - M.der, inf: alto - M.inf };
    const X = (f) => zona.izq + (tiempo(f) - desde) / (hasta - desde) * (zona.der - zona.izq);
    const Y = (v) => zona.inf - (v - min) / (max - min) * (zona.inf - zona.sup);
    geom = { zona, X, Y, desde, hasta };

    // Degradado bajo la línea de Standard
    const defs = el('defs', {}, svgEl);
    const grad = el('linearGradient', { id: 'eloArea', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0%', 'stop-color': COLORES.standard, 'stop-opacity': .22 }, grad);
    el('stop', { offset: '100%', 'stop-color': COLORES.standard, 'stop-opacity': 0 }, grad);

    // Cuadrícula y escala de ELO (menos líneas si no caben)
    const salto = (max - min) / 100 > 4 ? 2 : 1;
    for (let v = min; v <= max + .1; v += 100 * salto) {
      const y = Math.round(Y(v)) + .5;
      el('line', { x1: zona.izq, x2: zona.der, y1: y, y2: y, stroke: COLOR_REJILLA }, svgEl);
      el('text', { x: zona.izq - 6, y: y + 4, 'text-anchor': 'end', fill: COLOR_EJE, 'font-size': 11 }, svgEl).textContent = v;
    }

    // Años en el eje horizontal
    const a0 = +puntos[0].fecha.slice(0, 4), a1 = +puntos.at(-1).fecha.slice(0, 4);
    const cada = Math.max(1, Math.ceil((a1 - a0 + 1) / Math.max(2, (zona.der - zona.izq) / 70)));
    for (let a = a0; a <= a1; a++) {
      if ((a - a0) % cada) continue;
      const x = X(`${a}-01`);
      if (x < zona.izq || x > zona.der) continue;
      el('line', { x1: Math.round(x) + .5, x2: Math.round(x) + .5, y1: zona.inf, y2: zona.inf + 3, stroke: COLOR_REJILLA }, svgEl);
      el('text', { x, y: zona.inf + 14, 'text-anchor': 'middle', fill: COLOR_EJE, 'font-size': 11 }, svgEl).textContent = a;
    }

    // Las tres líneas: cada tramo continuo es una polilínea; los meses sin dato cortan la línea
    const serie = (clave) => {
      const tramos = []; let tramo = [];
      for (const p of puntos) {
        if (p[clave] > 0) tramo.push([X(p.fecha), Y(p[clave])]);
        else if (tramo.length) { tramos.push(tramo); tramo = []; }
      }
      if (tramo.length) tramos.push(tramo);
      return tramos;
    };
    for (const clave of ['blitz', 'rapid', 'standard']) {
      for (const tramo of serie(clave)) {
        if (tramo.length === 1) { el('circle', { cx: tramo[0][0], cy: tramo[0][1], r: 2.5, fill: COLORES[clave] }, svgEl); continue; }
        const d = 'M' + tramo.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L');
        if (clave === 'standard') el('path', { d: `${d} L${tramo.at(-1)[0]},${zona.inf} L${tramo[0][0]},${zona.inf} Z`, fill: 'url(#eloArea)' }, svgEl);
        const linea = el('path', { d, fill: 'none', stroke: COLORES[clave], 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svgEl);
        if (animar && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
          const largo = linea.getTotalLength();
          linea.style.strokeDasharray = largo;
          linea.style.strokeDashoffset = largo;
          linea.getBoundingClientRect();
          linea.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.3,.7,.2,1)';
          linea.style.strokeDashoffset = 0;
        }
      }
    }
    animar = false;

    // Capa para el cursor
    geom.cursor = el('g', { 'pointer-events': 'none', display: 'none' }, svgEl);
    el('rect', { x: 0, y: 0, width: ancho, height: alto, fill: 'transparent' }, svgEl).setAttribute('class', 'elo-capa');
  }

  function cursor(e) {
    if (!geom) return;
    const caja = contenedor.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - caja.left, geom.zona.izq), geom.zona.der);
    const fecha = geom.desde + (x - geom.zona.izq) / (geom.zona.der - geom.zona.izq) * (geom.hasta - geom.desde);
    let mejor = 0;
    for (let i = 1; i < puntos.length; i++) if (Math.abs(tiempo(puntos[i].fecha) - fecha) < Math.abs(tiempo(puntos[mejor].fecha) - fecha)) mejor = i;
    const p = puntos[mejor], xc = Math.round(geom.X(p.fecha)) + .5;

    geom.cursor.innerHTML = '';
    geom.cursor.removeAttribute('display');
    el('line', { x1: xc, x2: xc, y1: geom.zona.sup, y2: geom.zona.inf, stroke: '#9AA8BD' }, geom.cursor);
    const filas = [];
    for (const [clave, nombre] of [['standard', 'Standard'], ['rapid', 'Rapid'], ['blitz', 'Blitz']]) {
      if (!(p[clave] > 0)) continue;
      el('circle', { cx: xc, cy: geom.Y(p[clave]), r: 3.5, fill: '#fff', stroke: COLORES[clave], 'stroke-width': 2 }, geom.cursor);
      filas.push(`<div style="color:${COLORES[clave]}"><b>${nombre} ${p[clave]}</b></div>`);
    }
    tooltip.innerHTML = `<div class="elo-tooltip-fecha">${MES.format(tiempo(p.fecha))}</div>${filas.join('')}`;
    tooltip.classList.add('visible');
    const ancho = tooltip.offsetWidth;
    tooltip.style.left = `${xc + 10 + ancho > contenedor.clientWidth ? xc - 10 - ancho : xc + 10}px`;
  }
  const fuera = () => { geom?.cursor?.setAttribute('display', 'none'); tooltip.classList.remove('visible'); };

  contenedor.addEventListener('mousemove', cursor);
  contenedor.addEventListener('mouseleave', fuera);
  const observador = new ResizeObserver(() => dibujar());
  observador.observe(contenedor);
  dibujar();
  return { destruir: () => {
    observador.disconnect();
    contenedor.removeEventListener('mousemove', cursor);
    contenedor.removeEventListener('mouseleave', fuera);
  } };
}
