// La curva de la evaluación de una partida: de un vistazo se ve quién estuvo mejor en cada momento, dónde estuvieron los errores y en qué jugada se está.
// Sirve cualquier punto: pulsar o arrastrar por el gráfico lleva a esa jugada.
const NS = 'http://www.w3.org/2000/svg';
const ancho = 480, alto = 54, margen = 6;
const COLOR_MARCA = { '??': '#D8493B', '?': '#E38B1D', '?!': '#2F6FE0' };

/** De centipeones (desde las blancas) a una altura entre -1 y 1: la misma curva que usa la barra de evaluación. */
const altura = (cp) => 2 / (1 + Math.exp(-cp / 350)) - 1;

/** @param {HTMLElement} contenedor
 *  @param {number[]} evaluaciones  centipeones desde las blancas, una por posición (0 = la inicial)
 *  @param {Array<{ ply: number, marca: string }>} errores
 *  @param {{ alIr: (ply: number) => void, texto: (ply: number) => string }} opciones
 *  @returns {{ marcar: (ply: number) => void }} */
export function montarCurva(contenedor, evaluaciones, errores, { alIr, texto }) {
  contenedor.replaceChildren();
  const n = evaluaciones.length - 1;
  if (n < 2) return { marcar() {} };
  const x = (p) => margen + (p / n) * (ancho - 2 * margen), cero = alto / 2;
  const y = (cp) => cero - altura(cp) * (alto / 2 - margen);
  const puntos = evaluaciones.map((cp, p) => `${x(p).toFixed(1)},${y(cp).toFixed(1)}`);
  const linea = puntos.join(' L ');
  const area = `M ${x(0)},${cero} L ${linea} L ${x(n)},${cero} Z`;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${ancho} ${alto}`); svg.setAttribute('class', 'curva-svg'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Evaluación a lo largo de la partida');
  svg.innerHTML = `
    <defs>
      <clipPath id="curvaArriba"><rect x="0" y="0" width="${ancho}" height="${cero}"/></clipPath>
      <clipPath id="curvaAbajo"><rect x="0" y="${cero}" width="${ancho}" height="${alto - cero}"/></clipPath>
    </defs>
    <rect class="curva-fondo" x="0" y="0" width="${ancho}" height="${alto}" rx="8"/>
    <path class="curva-area-blancas" d="${area}" clip-path="url(#curvaArriba)"/>
    <path class="curva-area-negras" d="${area}" clip-path="url(#curvaAbajo)"/>
    <line class="curva-cero" x1="0" x2="${ancho}" y1="${cero}" y2="${cero}"/>
    <path class="curva-linea" d="M ${linea}"/>
    ${errores.filter(e => e.ply >= 1 && e.ply <= n).map(e => `<circle class="curva-error" cx="${x(e.ply).toFixed(1)}" cy="${y(evaluaciones[e.ply]).toFixed(1)}" r="3.4" fill="${COLOR_MARCA[e.marca] ?? '#2F6FE0'}"/>`).join('')}
    <line class="curva-actual" x1="0" x2="0" y1="2" y2="${alto - 2}"/>
    <line class="curva-guia" x1="0" x2="0" y1="2" y2="${alto - 2}"/>`;
  contenedor.append(svg);
  const info = document.createElement('div');
  info.className = 'curva-info suave';
  contenedor.append(info);

  const actual = svg.querySelector('.curva-actual'), guia = svg.querySelector('.curva-guia');
  const plyEn = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * ancho;
    return Math.max(0, Math.min(n, Math.round(((px - margen) / (ancho - 2 * margen)) * n)));
  };
  let arrastrando = false;
  svg.addEventListener('pointerdown', (e) => { arrastrando = true; svg.setPointerCapture(e.pointerId); alIr(plyEn(e)); });
  svg.addEventListener('pointermove', (e) => {
    const p = plyEn(e);
    guia.setAttribute('x1', x(p)); guia.setAttribute('x2', x(p)); guia.style.opacity = 1;
    info.textContent = texto(p);
    if (arrastrando) alIr(p);
  });
  svg.addEventListener('pointerup', () => { arrastrando = false; });
  svg.addEventListener('pointerleave', () => { guia.style.opacity = 0; info.textContent = ''; });
  return { marcar(p) { actual.setAttribute('x1', x(p)); actual.setAttribute('x2', x(p)); } };
}
