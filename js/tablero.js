// Tablero de ajedrez con las mismas figuras que ChessVision (TableroControl.cs): se le da una posición en FEN y, si se quiere, la última jugada para
// resaltarla (con su flecha), la casilla elegida y las casillas a las que puede ir. Las casillas se nombran como en ajedrez («e4»).
// Con «interactivo» admite clics y arrastrar piezas.
import { textoFechaPartida, textoFechasPartidas } from './fecha-partida.js';
const CLARA = '#EEEED2', OSCURA = '#769656';
const NS = 'http://www.w3.org/2000/svg';

export class Tablero {
  constructor(contenedor, { casilla = 34, etiquetas = false, interactivo = false, partida = null, partidas = null, fechaEn = contenedor } = {}) {
    this.fecha = document.createElement('div');
    this.fecha.className = 'tablero-fecha';
    this.fecha.textContent = partidas ? textoFechasPartidas(partidas) : textoFechaPartida(partida);
    fechaEn.appendChild(this.fecha);
    this.raiz = document.createElement('div');
    this.raiz.className = 'tablero';
    this.casillas = new Map();
    this.girado = false;
    this.etiquetas = etiquetas;
    this.setCasilla(casilla);
    contenedor.appendChild(this.raiz);

    // Para quien lo use de forma interactiva.
    this.alPulsar = null;            // (casilla) → se pulsa el botón sobre una casilla
    this.alSoltar = null;            // (casilla | null) → se suelta el botón (tras arrastrar, la casilla de destino o null si fuera)
    this.alBotonDerecho = null;      // () → botón derecho sobre el tablero (en ChessVision retrocede una jugada)
    this.puedeArrastrar = () => false;
    if (interactivo) this._conectarRaton();
  }

  setCasilla(px) {
    this.casillaPx = px;
    this.raiz.style.setProperty('--casilla', `${px}px`);
    this.fecha.style.setProperty('--casilla', `${px}px`);
  }

  ponerPartidas(partidas) { this.fecha.textContent = textoFechasPartidas(partidas); }

  _construir(girado) {
    this.raiz.innerHTML = '';
    this.casillas.clear();
    for (let f = 0; f < 8; f++) {
      for (let c = 0; c < 8; c++) {
        const columna = girado ? 7 - c : c, fila = girado ? f : 7 - f;      // fila 0 = primera fila
        const nombre = 'abcdefgh'[columna] + (fila + 1);
        const oscura = (columna + fila) % 2 === 0;
        const e = document.createElement('div');
        e.className = 'tablero-casilla';
        e.dataset.casilla = nombre;
        e.style.background = oscura ? OSCURA : CLARA;
        if (this.etiquetas) {
          const color = oscura ? CLARA : OSCURA;
          if (c === 0) e.insertAdjacentHTML('beforeend', `<span class="tablero-num" style="color:${color}">${fila + 1}</span>`);
          if (f === 7) e.insertAdjacentHTML('beforeend', `<span class="tablero-letra" style="color:${color}">${'abcdefgh'[columna]}</span>`);
        }
        this.raiz.appendChild(e);
        this.casillas.set(nombre, e);
      }
    }
    this.flecha = document.createElementNS(NS, 'svg');
    this.flecha.setAttribute('class', 'tablero-flecha');
    this.flecha.setAttribute('viewBox', '0 0 8 8');
    this.raiz.appendChild(this.flecha);
    this.girado = girado;
  }

  /** Centro de una casilla en unidades del tablero (0-8), según la orientación. */
  _centro(nombre) {
    const c = nombre.charCodeAt(0) - 97, r = +nombre[1] - 1;
    return [(this.girado ? 7 - c : c) + 0.5, (this.girado ? r : 7 - r) + 0.5];
  }

  /** «fen»: la posición; «desde» y «hasta»: la última jugada, p. ej. 'e2' y 'e4'; «girado»: mira desde las negras;
   *  «seleccion»: la casilla elegida; «destinos»: a dónde puede ir la pieza elegida. */
  mostrar(fen, desde = null, hasta = null, girado = false, seleccion = null, destinos = null, animacion = null) {
    if (this.casillas.size === 0 || girado !== this.girado) this._construir(girado);
    const piezas = new Map();
    fen.split(' ')[0].split('/').forEach((fila, i) => {
      let c = 0;
      for (const ch of fila) {
        if (/\d/.test(ch)) { c += +ch; continue; }
        piezas.set('abcdefgh'[c] + (8 - i), (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase());
        c++;
      }
    });
    const marcas = new Set(destinos ?? []);
    for (const [nombre, e] of this.casillas) {
      const clave = piezas.get(nombre) ?? '';
      if (e.dataset.pieza !== clave) {
        e.dataset.pieza = clave;
        e.querySelector('img')?.remove();
        if (clave) e.insertAdjacentHTML('afterbegin', `<img src="assets/Piezas/${clave}.png" alt="" draggable="false">`);
      }
      e.classList.toggle('resaltada', nombre === desde || nombre === hasta);
      e.classList.toggle('elegida', nombre === seleccion);
      e.querySelector('.tablero-destino')?.remove();
      if (marcas.has(nombre)) e.insertAdjacentHTML('beforeend', `<i class="tablero-destino ${clave ? 'captura' : ''}"></i>`);
    }

    // La pieza que se ha movido se desliza desde su casilla anterior (solo si el usuario no tiene activado «reducir movimiento»).
    if (animacion && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const origen = this.casillas.get(animacion.de), destino = this.casillas.get(animacion.a);
      const img = destino?.querySelector('img');
      if (origen && img && img.animate) {
        const o = origen.getBoundingClientRect(), d = destino.getBoundingClientRect();
        img.style.position = 'relative'; img.style.zIndex = '3';
        img.animate([{ transform: `translate(${o.left - d.left}px, ${o.top - d.top}px)` }, { transform: 'translate(0, 0)' }], { duration: 190, easing: 'cubic-bezier(.22, 1, .36, 1)' });
      }
    }

    // Flecha de la última jugada, como en ChessBase.
    this.flecha.innerHTML = '';
    if (this.etiquetas && desde && hasta && desde !== hasta) {
      const [x0, y0] = this._centro(desde), [x1, y1] = this._centro(hasta);
      const dx = x1 - x0, dy = y1 - y0, largo = Math.hypot(dx, dy), ux = dx / largo, uy = dy / largo, nx = -uy, ny = ux;
      const grosor = 0.14, cabeza = Math.min(0.38, largo * 0.6), ancho = 0.42;
      const ix = x0 + ux * 0.18, iy = y0 + uy * 0.18, bx = x1 - ux * cabeza, by = y1 - uy * cabeza;
      const pts = [[ix + nx * grosor / 2, iy + ny * grosor / 2], [bx + nx * grosor / 2, by + ny * grosor / 2], [bx + nx * ancho / 2, by + ny * ancho / 2],
        [x1, y1], [bx - nx * ancho / 2, by - ny * ancho / 2], [bx - nx * grosor / 2, by - ny * grosor / 2], [ix - nx * grosor / 2, iy - ny * grosor / 2]];
      const poli = document.createElementNS(NS, 'polygon');
      poli.setAttribute('points', pts.map(p => p.join(',')).join(' '));
      poli.setAttribute('fill', 'rgba(232, 122, 0, .8)');
      this.flecha.appendChild(poli);
    }
  }

  // ---------- Ratón: pulsar, arrastrar y soltar ----------

  _casillaEn(x, y) {
    const r = this.raiz.getBoundingClientRect();
    const px = this.casillaPx * (r.width / (this.casillaPx * 8 || 1));
    const c = Math.floor((x - r.left) / (r.width / 8)), f = Math.floor((y - r.top) / (r.height / 8));
    if (c < 0 || c > 7 || f < 0 || f > 7 || !px) return null;
    const columna = this.girado ? 7 - c : c, fila = this.girado ? f : 7 - f;
    return 'abcdefgh'[columna] + (fila + 1);
  }

  _conectarRaton() {
    let origen = null, inicio = null, fantasma = null, imagen = null;
    const cancelar = () => {
      fantasma?.remove(); fantasma = null;
      if (imagen) imagen.style.opacity = ''; imagen = null;
      origen = null; inicio = null;
    };

    this.raiz.addEventListener('contextmenu', (e) => { e.preventDefault(); cancelar(); this.alBotonDerecho?.(); });
    this.raiz.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      inicio = { x: e.clientX, y: e.clientY };
      origen = this._casillaEn(e.clientX, e.clientY);
      this.raiz.setPointerCapture(e.pointerId);
      if (origen) this.alPulsar?.(origen);
    });
    this.raiz.addEventListener('pointermove', (e) => {
      if (!origen || !inicio || !(e.buttons & 1)) return;
      if (!fantasma) {
        // Hasta que el ratón se mueve unos píxeles es un clic; solo se arrastra una pieza que pueda moverse.
        if (Math.abs(e.clientX - inicio.x) < 4 && Math.abs(e.clientY - inicio.y) < 4) return;
        const img = this.casillas.get(origen)?.querySelector('img');
        if (!this.puedeArrastrar(origen) || !img) { origen = null; return; }
        imagen = img; img.style.opacity = '.35';
        fantasma = img.cloneNode();
        fantasma.className = 'tablero-fantasma';
        fantasma.style.width = fantasma.style.height = `${this.raiz.getBoundingClientRect().width / 8}px`;
        document.body.appendChild(fantasma);
        this.raiz.style.cursor = 'grabbing';
      }
      const t = this.raiz.getBoundingClientRect().width / 8;
      fantasma.style.left = `${e.clientX - t / 2}px`;
      fantasma.style.top = `${e.clientY - t / 2}px`;
    });
    this.raiz.addEventListener('pointerup', (e) => {
      if (e.button !== 0) return;
      const arrastrando = !!fantasma;
      const casilla = this._casillaEn(e.clientX, e.clientY);
      this.raiz.style.cursor = '';
      cancelar();
      // Tras un arrastre la casilla de destino puede ser cualquiera (o ninguna); sin arrastre es la misma que se pulsó.
      if (arrastrando) this.alSoltar?.(casilla);
      else if (casilla) this.alSoltar?.(casilla);
    });
    this.raiz.addEventListener('pointercancel', () => { cancelar(); this.raiz.style.cursor = ''; });
  }
}
