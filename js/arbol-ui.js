// Pestaña «Árbol» (ArbolAperturasControl.xaml/.cs): en cada posición, las jugadas que se han hecho, cuántas veces y cómo le fue.
// Se avanza pulsando una jugada y se vuelve con «Atrás» o con las migas de arriba.
import { ponerCargando } from './cargando.js';
import { construir, nombreApertura, calcularLinea, PLIES_MAX, Fuente } from './arbol.js';
import * as libro from './libro.js';
import { Tablero } from './tablero.js';
import { EvaluadorArbol, simbolo, textoEval } from './motor.js';
import { svgTrazo, contenidoBoton } from './iconos.js';
import { convertirFiguras, figurasHtml } from './figuritas.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const colorPuntos = (p) => (p >= 60 ? '#1E8E4F' : p >= 45 ? 'var(--azul)' : 'var(--coral)');
const redondeo = (n) => Math.round(n);

/** «1.e4» o «1…e5», con figuritas. */
const jugada = (nodo) => convertirFiguras(nodo.ply % 2 === 1 ? `${(nodo.ply + 1) / 2 | 0}.${nodo.san}` : `${nodo.ply / 2}…${nodo.san}`);

export class ArbolUI {
  constructor(contenedor, { nombreJugador = () => '', alAbrirPartida = () => {} } = {}) {
    Object.assign(this, { contenedor, nombreJugador, alAbrirPartida });
    this.partidas = []; this.raiz = null; this.actual = null; this.color = 'B';
    this.obsoleto = true; this.construyendo = false;
    this.evaluador = null; this.abortFilas = null; this.abortLinea = null;
    this.linea = null; this.nodosLinea = new Set(); this.busqueda = 0;
    this._montar();
  }

  _montar() {
    this.contenedor.innerHTML = `
      <div class="arbol">
        <div class="arbol-cab">
          <span class="insignia" style="--c:#CFE0FF;color:#2F6FD6">${svgTrazo('M12,4 V10 M12,10 H6 V15 M12,10 H18 V15 M6,15 V20 M18,15 V20', 13)}</span>
          <b>Árbol de aperturas</b><span class="suave arbol-resumen" data-resumen></span>
          <span class="mini-pestanas" style="margin-left:auto">
            <button type="button" class="mini activa" data-color="B" title="Su árbol cuando juega con blancas">Blancas</button><button type="button" class="mini" data-color="N" title="Su árbol cuando juega con negras">Negras</button>
          </span>
        </div>
        <div class="arbol-fila-migas">
          <div class="migas" data-migas></div>
          <div class="arbol-botones">
            <button type="button" class="btn btn-secundario btn-chico" data-atras></button>
            <button type="button" class="btn btn-secundario btn-chico" data-partidas title="Las partidas que pasan por esta posición"></button>
          </div>
        </div>
        <div class="arbol-linea">
          <div class="arbol-linea-cab">
            <span class="insignia" style="--c:#FBE2A6;color:#B97A0B">${svgTrazo('M12,3 L14.6,9 L21,9.6 L16.2,13.9 L17.6,20.2 L12,17 L6.4,20.2 L7.8,13.9 L3,9.6 L9.4,9 Z', 12)}</span>
            <b class="recortar" data-linea-titulo></b>
            <span class="arbol-linea-botones">
              <button type="button" class="btn btn-secundario btn-chico" data-ir-linea hidden title="Colocar el árbol al final de la línea recomendada"></button>
              <button type="button" class="btn btn-secundario btn-chico" data-buscar-linea title="Busca la línea a partir de la posición que se ve en el árbol"></button>
            </span>
          </div>
          <div class="arbol-linea-texto" data-linea-texto hidden></div>
          <div class="arbol-linea-detalle suave" data-linea-detalle hidden></div>
        </div>
        <div class="arbol-nombre"><b data-nombre></b><span class="suave" data-datos></span></div>
        <div class="arbol-cuerpo">
          <div class="arbol-lista">
            <div class="arbol-cabecera-filas">
              <span></span><span>Jugada</span><span>Partidas</span>
              <span class="arbol-leyenda"><i style="background:#0F5FAF"></i>Victorias <i style="background:#A9AFBC"></i>Tablas <i style="background:#3F4651"></i>Derrotas</span>
              <span class="der" title="Evaluación de Stockfish de la posición tras esa jugada (+ mejor para las blancas). En verde si te favorece a ti, en coral si no.">Motor</span><span class="der">Puntos</span>
            </div>
            <div class="suave arbol-vacio" data-vacio></div>
            <div data-filas></div>
            <div class="arbol-pie">
              <i class="cuadro" style="background:var(--azul)"></i><span class="suave">la elige él</span>
              <i class="cuadro" style="background:var(--coral)"></i><span class="suave">la elige su rival</span>
              <label class="arbol-check"><input type="checkbox" data-solo-repetidas checked> Ocultar las de una sola partida</label>
            </div>
          </div>
          <div class="arbol-tablero" data-tablero></div>
        </div>
      </div>`;
    const $ = (s) => this.contenedor.querySelector(s);
    this.el = {
      resumen: $('[data-resumen]'), migas: $('[data-migas]'), atras: $('[data-atras]'), partidasBtn: $('[data-partidas]'),
      lineaTitulo: $('[data-linea-titulo]'), irLinea: $('[data-ir-linea]'), buscarLinea: $('[data-buscar-linea]'),
      lineaTexto: $('[data-linea-texto]'), lineaDetalle: $('[data-linea-detalle]'),
      nombre: $('[data-nombre]'), datos: $('[data-datos]'), vacio: $('[data-vacio]'), filas: $('[data-filas]'), soloRepetidas: $('[data-solo-repetidas]')
    };
    this.el.atras.innerHTML = contenidoBoton('atras', 'Atrás');
    this.el.partidasBtn.innerHTML = contenidoBoton('lista', 'Ver partidas');
    this.el.buscarLinea.innerHTML = contenidoBoton('barras', 'Buscar la línea');
    this.el.irLinea.innerHTML = contenidoBoton('flecha', 'Ir a la línea');
    this.tablero = new Tablero($('[data-tablero]'), { casilla: 34 });

    this.contenedor.querySelector('.arbol-cab .mini-pestanas').addEventListener('click', (e) => {
      const b = e.target.closest('.mini');
      if (!b || b.dataset.color === this.color) return;
      for (const m of b.parentElement.children) m.classList.toggle('activa', m === b);
      this.color = b.dataset.color;
      this.obsoleto = true; this.raiz = null;
      this._borrarLinea();
      this._reconstruir();
    });
    this.el.atras.addEventListener('click', () => { if (this.actual?.padre) { this._borrarLinea(); this.actual = this.actual.padre; this._refrescar(); } });
    this.el.partidasBtn.addEventListener('click', () => this._menuPartidas());
    this.el.soloRepetidas.addEventListener('change', () => { if (this.actual) this._pintarFilas(this.actual); });
    this.el.buscarLinea.addEventListener('click', () => this._buscarLinea());
    this.el.irLinea.addEventListener('click', () => {
      if (!this.linea?.length) return;
      // Los pasos de teoría y de Stockfish no están en su árbol: se va hasta la última posición que sí lo está.
      const destino = [...this.linea].reverse().find(p => p.fuente === Fuente.Partidas)?.nodo ?? this.linea[0].nodo.padre;
      if (destino) this._ir(destino, true);
    });
    this.el.filas.addEventListener('click', (e) => {
      const f = e.target.closest('[data-san]');
      if (f) { const h = this.actual.hijos.get(f.dataset.san); if (h) this._ir(h); }
    });
    this.el.migas.addEventListener('click', (e) => {
      const m = e.target.closest('[data-miga]');
      if (!m) return;
      let n = this.actual; for (let i = Number(m.dataset.miga); i > 0 && n; i--) n = n.padre;
      if (n) this._ir(n);
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.menu-partidas, [data-partidas]')) document.querySelector('.menu-partidas')?.remove(); });
  }

  /** Las partidas con las que se hace el árbol (las que se ven en la ficha). El árbol se rehace al mostrarse. */
  cargar(partidas) {
    this.partidas = partidas;
    this.obsoleto = true; this.raiz = null;
    this._borrarLinea();
    if (!this.contenedor.closest('[hidden]')) this._reconstruir();
  }

  alMostrar() { this._reconstruir(); }

  async _reconstruir() {
    if (!this.obsoleto || this.construyendo) return;
    this.construyendo = true;
    const partidas = this.partidas, color = this.color;
    ponerCargando(this.el.vacio, 'Calculando el árbol…');
    this.el.filas.innerHTML = '';
    const raiz = await construir(partidas, color);
    this.construyendo = false;
    if (partidas !== this.partidas || color !== this.color) { this._reconstruir(); return; }
    this.raiz = this.actual = raiz;
    this.obsoleto = false;
    this._refrescar();
  }

  _ir(nodo, conservarLinea = false) {
    if (!conservarLinea) this._borrarLinea();
    this.actual = nodo;
    this._refrescar();
  }

  _refrescar() {
    if (!this.actual || !this.raiz) return;
    const nodo = this.actual;
    this.el.resumen.textContent = this.raiz.partidas === 0 ? '' : `${this.raiz.partidas} partidas con ${this.color === 'B' ? 'blancas' : 'negras'}`;
    this.el.atras.disabled = !nodo.padre;
    this.el.partidasBtn.disabled = nodo.partidas === 0;
    this.el.lineaTitulo.textContent = `La línea que te conviene jugarle, con las ${this.color === 'B' ? 'negras' : 'blancas'}`;
    if (!this.linea) this.el.buscarLinea.disabled = false;
    this._pintarMigas(nodo);
    this._pintarPosicion(nodo);
    this._pintarFilas(nodo);
  }

  _pintarMigas(nodo) {
    const camino = []; for (let n = nodo; n; n = n.padre) camino.unshift(n);
    this.el.migas.innerHTML = camino.map((p, i) => {
      const esActual = p === nodo;
      const texto = p.ply === 0 ? 'Inicio' : figurasHtml(jugada(p));
      return esActual ? `<span class="miga actual">${texto}</span>` : `<span class="miga" data-miga="${camino.length - 1 - i}">${texto}</span>`;
    }).join('');
  }

  _pintarPosicion(nodo) {
    this.tablero.mostrar(nodo.fen, nodo.desde, nodo.hasta, this.color === 'N');
    const nombre = nombreApertura(nodo);
    this.el.nombre.textContent = nombre || (nodo.ply === 0 ? 'Posición inicial' : 'Sin nombre de apertura');
    this.el.datos.textContent = nodo.partidas === 0 ? '' : `En esta posición: ${nodo.partidas} partidas · él saca el ${redondeo(nodo.porcentaje)} % de los puntos`;
  }

  _pintarFilas(nodo) {
    const hijos = [...nodo.hijos.values()].sort((a, b) => b.partidas - a.partidas || a.san.localeCompare(b.san));
    let visibles = this.el.soloRepetidas.checked ? hijos.filter(h => h.partidas >= 2) : hijos;
    if (!visibles.length) visibles = hijos;                                   // si al ocultar no queda nada, se ve todo

    this.el.vacio.textContent = hijos.length ? '' :
      nodo.ply >= PLIES_MAX ? `El árbol llega hasta la jugada ${PLIES_MAX / 2}.` : !this.partidas.length ? 'Todavía no hay partidas de este jugador.' : 'No hay más jugadas en las partidas.';

    const total = Math.max(1, nodo.partidas);
    this.el.filas.innerHTML = visibles.map(h => {
      const eligeEl = (h.ply % 2 === 1) === (this.color === 'B');
      const tramo = (n, color) => n > 0 ? `<span class="tramo" style="flex-grow:${n};background:${color}">${n}</span>` : '';
      const enLinea = this.nodosLinea.has(h);
      return `<div class="arbol-fila ${enLinea ? 'en-linea' : ''}" data-san="${esc(h.san)}" title="${enLinea ? 'Esta jugada está en la línea recomendada' : `${h.victorias} victorias, ${h.tablas} tablas, ${h.derrotas} derrotas`}">
        <span class="quien" style="background:${eligeEl ? 'var(--azul)' : 'var(--coral)'}" title="${eligeEl ? 'Esta jugada la elige él' : 'Esta jugada la elige su rival'}"></span>
        <span class="jug">${figurasHtml(jugada(h))}</span>
        <span class="suave">${h.partidas} &nbsp;·&nbsp; ${redondeo(100 * h.partidas / total)} %</span>
        <span class="barra">${tramo(h.victorias, '#0F5FAF')}${tramo(h.tablas, '#A9AFBC')}${tramo(h.derrotas, '#3F4651')}</span>
        <span class="der suave eval" data-eval>…</span>
        <span class="der pts" style="color:${colorPuntos(h.porcentaje)}">${redondeo(h.porcentaje)} %</span></div>`;
    }).join('');
    this._evaluarFilas(visibles.slice(0, 8));
  }

  /** Evalúa con Stockfish la posición de cada fila visible (las de arriba primero) y escribe el resultado en su columna «Motor». */
  async _evaluarFilas(nodos) {
    this.abortFilas?.abort();
    const ab = this.abortFilas = new AbortController();
    this.evaluador ??= new EvaluadorArbol();
    const yoBlancas = this.color === 'N';
    const filas = [...this.el.filas.querySelectorAll('.arbol-fila')];
    for (let i = 0; i < nodos.length; i++) {
      const valor = await this.evaluador.evaluar(nodos[i].fen, ab.signal);
      if (ab.signal.aborted) return;
      const celda = filas[i]?.querySelector('[data-eval]');
      if (!celda) continue;
      if (valor === null) { celda.textContent = '—'; continue; }
      const paraMi = yoBlancas ? valor : -valor;
      celda.textContent = textoEval(valor);
      celda.style.color = paraMi >= 30 ? '#1E8E4F' : paraMi <= -30 ? 'var(--coral)' : '';
      celda.title = paraMi >= 30 ? 'Stockfish: esta jugada te favorece a ti' : paraMi <= -30 ? 'Stockfish: esta jugada favorece a tu rival' : 'Stockfish: posición igualada';
    }
  }

  // ---- Las partidas de esta posición ----

  _menuPartidas() {
    document.querySelector('.menu-partidas')?.remove();
    if (!this.actual) return;
    const menu = document.createElement('div');
    menu.className = 'menu-partidas';
    const lista = [...this.actual.listaPartidas].sort((a, b) => b.fecha.localeCompare(a.fecha));
    menu.innerHTML = `<div class="menu-cab"><b>${esc(this.nombreJugador() || 'El jugador')} juega con ${this.color === 'B' ? 'blancas' : 'negras'}</b><span class="suave">Partidas en esta posición</span></div>`
      + lista.slice(0, 20).map((p, i) => {
        const pts = p.puntos ?? 0.5;
        const clase = pts >= 1 ? 'gana' : pts <= 0 ? 'pierde' : 'tablas';
        return `<button type="button" class="menu-fila ${i % 2 === 0 ? 'cebra' : ''}" data-i="${i}" title="Abrir esta partida en el visor">
          <span class="suave">${esc(p.fechaMostrada)}</span><span class="recortar"><b>${esc(p.rivalConTitulo)}</b></span><span class="res ${clase}">${p.resultado === '1/2-1/2' ? '½-½' : p.resultado}</span></button>`;
      }).join('')
      + (lista.length > 20 ? `<div class="suave menu-mas">…y ${lista.length - 20} más</div>` : '');
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) { menu.remove(); this.alAbrirPartida(lista[Number(b.dataset.i)]); }
    });
    const caja = this.el.partidasBtn.getBoundingClientRect();
    document.body.appendChild(menu);
    menu.style.top = `${caja.bottom + window.scrollY + 6}px`;
    menu.style.left = `${Math.max(8, caja.right + window.scrollX - menu.offsetWidth)}px`;
  }

  // ---- La línea que te conviene jugarle ----

  _borrarLinea() {
    this.abortLinea?.abort();
    this.busqueda++;
    this.linea = null;
    if (this.nodosLinea.size) { this.nodosLinea.clear(); if (this.actual) this._pintarFilas(this.actual); }
    this.el.lineaTexto.hidden = this.el.lineaDetalle.hidden = this.el.irLinea.hidden = true;
    this.el.buscarLinea.disabled = false;
  }

  async _buscarLinea() {
    if (!this.raiz || !this.actual) return;
    this._borrarLinea();
    const esta = ++this.busqueda, origen = this.actual;
    this.el.buscarLinea.disabled = true;
    this.el.lineaTexto.hidden = false;
    ponerCargando(this.el.lineaTexto, 'Buscando… (Stockfish evalúa las jugadas candidatas)', { mini: true });

    const ab = this.abortLinea = new AbortController();
    this.evaluador ??= new EvaluadorArbol();
    let linea;
    try {
      linea = await calcularLinea(origen, this.color, this.evaluador, (t) => { if (esta === this.busqueda && !ab.signal.aborted) this.el.lineaTexto.textContent = t; }, ab.signal);
    } catch { return; }                                                       // se cambió de posición, de color o de partidas: esa línea ya no vale
    if (esta !== this.busqueda || ab.signal.aborted) return;
    this.el.buscarLinea.disabled = false;
    this.linea = linea;
    this._mostrarLinea();
    if (this.actual) this._pintarFilas(this.actual);                          // las filas de la línea se marcan en dorado
  }

  _mostrarLinea() {
    const linea = this.linea;
    this.nodosLinea = new Set(linea.map(p => p.nodo));
    if (!linea.length) {
      this.el.lineaTexto.textContent = 'No hay jugadas con al menos 2 partidas desde esta posición, así que no se puede recomendar ninguna.';
      this.el.lineaDetalle.hidden = this.el.irLinea.hidden = true;
      return;
    }

    // La línea con sus números; tus jugadas en azul, las que se esperan de él en gris.
    this.el.lineaTexto.innerHTML = linea.map((paso, i) => {
      const n = paso.nodo;
      let t = n.ply % 2 === 1 ? `${(n.ply + 1) / 2 | 0}.${n.san}` : (i === 0 ? `${n.ply / 2}…${n.san}` : n.san);
      return `<span class="paso ${paso.esMia ? 'mia' : 'suya'} ${paso.fuente === Fuente.Motor ? 'motor' : paso.fuente === Fuente.Libro ? 'libro' : ''}" data-paso="${i}">${figurasHtml(convertirFiguras(t))}</span>`;
    }).join(' ');
    const final = linea.at(-1);
    if (final.evalBlancas !== null) this.el.lineaTexto.insertAdjacentHTML('beforeend', ` <b class="simbolo" title="Stockfish: ${textoEval(final.evalBlancas)}">${simbolo(final.evalBlancas)}</b>`);
    this.el.lineaTexto.hidden = false;
    // Al pasar el ratón por una jugada de la línea, el tablero enseña la posición tras esa jugada.
    this.el.lineaTexto.onmouseover = (e) => { const s = e.target.closest('[data-paso]'); if (s) { const n = linea[Number(s.dataset.paso)].nodo; this.tablero.mostrar(n.fen, n.desde, n.hasta, this.color === 'N'); } };
    this.el.lineaTexto.onmouseleave = () => { if (this.actual) this.tablero.mostrar(this.actual.fen, this.actual.desde, this.actual.hasta, this.color === 'N'); };

    const mias = linea.filter(p => p.esMia && p.fuente === Fuente.Partidas);
    const ultimoDePartidas = [...linea].reverse().find(p => p.fuente === Fuente.Partidas)?.nodo ?? linea[0].nodo.padre;
    const detalle = ['Tus jugadas, en azul; las de él, en gris (son las que más repite).'];
    if (ultimoDePartidas?.partidas > 0) {
      const n = ultimoDePartidas;
      detalle.push(convertirFiguras(`• Con ${n.ply % 2 === 1 ? `${(n.ply + 1) / 2 | 0}.` : `${n.ply / 2}…`}${n.san} tiene ${n.partidas} partidas y saca el ${redondeo(n.porcentaje)}% de los puntos`));
    }
    if (mias.length) {
      const d = [...mias].sort((a, b) => a.nodo.partidas - b.nodo.partidas)[0].nodo;
      const num = d.ply % 2 === 1 ? `${(d.ply + 1) / 2 | 0}.` : `${d.ply / 2}…`;
      detalle.push(convertirFiguras(`• Fiabilidad: de tus jugadas, la menos vista es ${num}${d.san}: solo se ha jugado contra él en ${d.partidas} partidas, en las que él ha sacado el ${redondeo(d.porcentaje)} % de los puntos (él ganó ${d.victorias}, empató ${d.tablas} y perdió ${d.derrotas}). Es la parte menos fiable de la línea; con tan pocas partidas, ese resultado puede ser casualidad.`));
    }
    if (!libro.conectado()) detalle.push('• Elige un libro de aperturas (Power Book) en la ventana principal para completar la línea con teoría.');
    if (linea.some(p => p.fuente === Fuente.Motor)) detalle.push('• Subrayadas, jugadas de Stockfish: el libro no tiene esa posición.');
    if (linea.some(p => p.fuente === Fuente.Libro)) detalle.push(`• En cursiva, jugadas de teoría del libro «${libro.estado.nombre}».`);
    if (linea.every(p => p.evalBlancas === null)) detalle.push('• Sin Stockfish: la línea se ha elegido solo por los resultados de él.');
    this.el.lineaDetalle.innerHTML = detalle.map(esc).join('<br>');
    this.el.lineaDetalle.hidden = false;
    this.el.irLinea.hidden = false;
  }
}
