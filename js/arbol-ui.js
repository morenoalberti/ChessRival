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
              <button type="button" class="btn btn-secundario btn-chico" data-buscar-linea title="Busca la línea a partir de la posición que se ve en el árbol"></button>
            </span>
          </div>
          <div class="arbol-linea-colores" data-linea-colores></div>
          <div class="arbol-linea-texto" data-linea-texto hidden></div>
          <div class="arbol-linea-ctrl" data-linea-ctrl hidden>
            <button type="button" class="btn btn-secundario btn-chico" data-paso-ant>‹ Anterior</button>
            <button type="button" class="btn btn-secundario btn-chico" data-paso-sig>Siguiente ›</button>
            <button type="button" class="btn btn-primario btn-chico" data-paso-rep>▶ Reproducir</button>
            <span class="arbol-linea-pos suave" data-linea-pos></span>
          </div>
          <div class="arbol-linea-leyenda suave" data-linea-leyenda hidden></div>
          <div class="arbol-linea-tabla" data-linea-tabla hidden></div>
          <div class="arbol-linea-resultado" data-linea-resultado hidden></div>
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
      lineaTitulo: $('[data-linea-titulo]'), lineaColores: $('[data-linea-colores]'), buscarLinea: $('[data-buscar-linea]'),
      lineaTexto: $('[data-linea-texto]'), lineaCtrl: $('[data-linea-ctrl]'), lineaPos: $('[data-linea-pos]'), lineaLeyenda: $('[data-linea-leyenda]'),
      lineaTabla: $('[data-linea-tabla]'), lineaResultado: $('[data-linea-resultado]'), lineaDetalle: $('[data-linea-detalle]'),
      pasoAnt: $('[data-paso-ant]'), pasoSig: $('[data-paso-sig]'), pasoRep: $('[data-paso-rep]'),
      nombre: $('[data-nombre]'), datos: $('[data-datos]'), vacio: $('[data-vacio]'), filas: $('[data-filas]'), soloRepetidas: $('[data-solo-repetidas]')
    };
    this.el.atras.innerHTML = contenidoBoton('atras', 'Atrás');
    this.el.partidasBtn.innerHTML = contenidoBoton('lista', 'Ver partidas');
    this.el.buscarLinea.innerHTML = contenidoBoton('barras', 'Calcular mi plan');
    this.pasoLinea = -1; this.reloj = null;
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
    // La línea se recorre: pulsando una ficha, con Anterior y Siguiente, o reproduciéndola entera.
    this.el.lineaTexto.addEventListener('click', (e) => { const s = e.target.closest('[data-paso]'); if (s) { this._pararReproduccion(); this._irAPaso(Number(s.dataset.paso)); } });
    this.el.lineaTabla.addEventListener('click', (e) => { const f = e.target.closest('[data-paso]'); if (f) { this._pararReproduccion(); this._irAPaso(Number(f.dataset.paso)); } });
    this.el.pasoAnt.addEventListener('click', () => { this._pararReproduccion(); this._irAPaso(this.pasoLinea - 1); });
    this.el.pasoSig.addEventListener('click', () => { this._pararReproduccion(); this._irAPaso(this.pasoLinea + 1); });
    this.el.pasoRep.addEventListener('click', () => (this.reloj ? this._pararReproduccion() : this._reproducirLinea()));
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
    this._pararReproduccion(); this.pasoLinea = -1; this._marcarPaso();     // al moverse por el árbol, la línea vuelve a su primer paso
    const nodo = this.actual;
    this.el.resumen.textContent = this.raiz.partidas === 0 ? '' : `${this.raiz.partidas} partidas con ${this.color === 'B' ? 'blancas' : 'negras'}`;
    this.el.atras.disabled = !nodo.padre;
    this.el.partidasBtn.disabled = nodo.partidas === 0;
    this.el.lineaTitulo.textContent = this.color === 'B' ? 'Tu plan con las negras' : 'Tu plan con las blancas';
    // Quién lleva cada color: el jugador estudiado el suyo y tú el otro.
    const el = esc(this.nombreJugador() || 'El jugador');
    this.el.lineaColores.innerHTML = this.color === 'B' ? `Blancas: <b>${el}</b> · Negras: <b>la que juegas tú</b>` : `Blancas: <b>la que juegas tú</b> · Negras: <b>${el}</b>`;
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
    this._pararReproduccion(); this.pasoLinea = -1;
    for (const e of [this.el.lineaTexto, this.el.lineaCtrl, this.el.lineaLeyenda, this.el.lineaTabla, this.el.lineaResultado, this.el.lineaDetalle]) e.hidden = true;
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
    const ocultos = [this.el.lineaCtrl, this.el.lineaLeyenda, this.el.lineaTabla, this.el.lineaResultado, this.el.lineaDetalle];
    if (!linea.length) {
      this.el.lineaTexto.textContent = 'No hay jugadas con al menos 2 partidas desde esta posición, así que no se puede recomendar ninguna.';
      ocultos.forEach(e => { e.hidden = true; });
      return;
    }
    const iconoFuente = { [Fuente.Partidas]: 'M12 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM9.5 10h5l1 5h-7l1-5ZM6 20h12M8 15v5m8-5v5',
                          [Fuente.Libro]: 'M12 6C10 4.5 6.5 4 3 4.5V19c3.5-.5 7 0 9 1.5 2-1.5 5.5-2 9-1.5V4.5C17.5 4 14 4.5 12 6Zm0 0v14.5',
                          [Fuente.Motor]: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z' };
    const nombreFuente = { [Fuente.Partidas]: 'Sus partidas', [Fuente.Libro]: 'Libro', [Fuente.Motor]: 'Stockfish' };
    const numero = (n, i) => (n.ply % 2 === 1 ? `${(n.ply + 1) / 2 | 0}.` : (i === 0 ? `${n.ply / 2}…` : ''));

    // La línea, como fichas que se pulsan: azul, tus jugadas; gris, las suyas; y un icono dice de dónde sale cada una.
    this.el.lineaTexto.innerHTML = linea.map((paso, i) => {
      const n = paso.nodo;
      return `<button type="button" class="paso ${paso.esMia ? 'mia' : 'suya'}" data-paso="${i}" title="${paso.esMia ? 'Tu jugada' : 'Su jugada'} · ${nombreFuente[paso.fuente]}">`
        + `<span class="paso-num">${numero(n, i)}</span>${figurasHtml(convertirFiguras(n.san))}<i class="paso-fuente">${svgTrazo(iconoFuente[paso.fuente], 10)}</i></button>`;
    }).join('');
    this.el.lineaTexto.hidden = false;
    this.el.lineaCtrl.hidden = false;
    this.el.pasoRep.textContent = '▶ Reproducir';
    this.el.lineaLeyenda.innerHTML = `<span class="ley mia">Tus jugadas</span><span class="ley suya">Sus jugadas</span>`
      + Object.keys(nombreFuente).filter(f => linea.some(p => p.fuente === f)).map(f => `<span class="ley fuente">${svgTrazo(iconoFuente[f], 11)}${nombreFuente[f]}</span>`).join('');
    this.el.lineaLeyenda.hidden = false;

    // Por qué cada jugada: quién la elige, cuántas partidas hay y cómo le va a él.
    const fila = (paso, i) => {
      const n = paso.nodo, deSusPartidas = paso.fuente === Fuente.Partidas && n.partidas > 0;
      return `<button type="button" class="tabla-fila" data-paso="${i}"><span class="tf-jugada">${figurasHtml(convertirFiguras(`${numero(n, i)}${n.san}`))}</span>`
        + `<span class="tf-quien ${paso.esMia ? 'mia' : 'suya'}">${paso.esMia ? 'Tú' : 'Él'}</span>`
        + `<span class="tf-n">${deSusPartidas ? n.partidas : '—'}</span>`
        + `<span class="tf-pts" style="${deSusPartidas ? `color:${colorPuntos(100 - n.porcentaje)}` : ''}">${deSusPartidas ? `${redondeo(n.porcentaje)} %` : '—'}</span>`
        + `<span class="tf-fuente">${svgTrazo(iconoFuente[paso.fuente], 11)}${nombreFuente[paso.fuente]}</span></button>`;
    };
    this.el.lineaTabla.innerHTML = `<div class="tabla-cab"><span>Jugada</span><span>La elige</span><span>Partidas</span><span>Puntos de él</span><span>Fuente</span></div>`
      + `<div class="tabla-cuerpo">${linea.map(fila).join('')}</div>`;
    this.el.lineaTabla.hidden = false;

    // El resultado: cómo acaba la línea (según Stockfish) y cuánto se puede fiar uno.
    const final = linea.at(-1), deLasPartidas = linea.filter(p => p.fuente === Fuente.Partidas && p.nodo.partidas > 0);
    const menosVista = deLasPartidas.length ? Math.min(...deLasPartidas.map(p => p.nodo.partidas)) : 0;
    const nivel = menosVista >= 30 ? 'alta' : menosVista >= 15 ? 'media' : menosVista >= 5 ? 'baja' : 'muy baja';
    let resultado = '';
    if (final.evalBlancas !== null) {
      const paraMi = this.color === 'B' ? -final.evalBlancas : final.evalBlancas;       // yo llevo el color contrario al suyo
      const fuerza = Math.abs(paraMi) < 25 ? '' : Math.abs(paraMi) < 75 ? 'Ligera ventaja' : Math.abs(paraMi) < 175 ? 'Ventaja clara' : 'Ventaja decisiva';
      const frase = !fuerza ? 'Posición igualada' : `${fuerza} ${paraMi > 0 ? 'para ti' : 'para él'}`;
      resultado = `<b class="simbolo">${simbolo(final.evalBlancas)}</b><span><b>${frase}</b> al final de la línea <span class="suave">(Stockfish: ${textoEval(final.evalBlancas)})</span></span>`;
    } else resultado = '<span class="suave">Sin Stockfish: la línea se ha elegido solo por los resultados de él.</span>';
    this.el.lineaResultado.innerHTML = `<span class="res-cab">Resultado de la línea</span><div class="res-cuerpo-linea">${resultado}</div>`
      + `<span class="res-fiab">Fiabilidad: <b>${nivel}</b> · la jugada menos vista se ha dado en ${menosVista} ${menosVista === 1 ? 'partida' : 'partidas'}</span>`;
    this.el.lineaResultado.hidden = false;

    const notas = [];
    if (!libro.conectado()) notas.push('Elige un libro de aperturas (Power Book) en la ventana principal para completar la línea con teoría.');
    this.el.lineaDetalle.innerHTML = notas.map(esc).join('<br>');
    this.el.lineaDetalle.hidden = notas.length === 0;
    this.pasoLinea = -1; this._marcarPaso();
  }

  // ---- Recorrer la línea en el tablero ----

  /** Pone el tablero en la posición tras el paso «i» (−1: la posición de partida, antes de la línea). */
  _irAPaso(i) {
    const linea = this.linea;
    if (!linea?.length) return;
    const anterior = this.pasoLinea;
    this.pasoLinea = Math.max(-1, Math.min(linea.length - 1, i));
    const n = this.pasoLinea < 0 ? linea[0].nodo.padre : linea[this.pasoLinea].nodo;
    if (!n) return;
    // Un paso adelante o atrás: la pieza se desliza
    const animacion = this.pasoLinea === anterior + 1 && this.pasoLinea >= 0 ? { de: n.desde, a: n.hasta }
      : this.pasoLinea === anterior - 1 && anterior >= 0 ? { de: linea[anterior].nodo.hasta, a: linea[anterior].nodo.desde } : null;
    this.tablero.mostrar(n.fen, n.desde, n.hasta, this.color === 'N', null, null, animacion);
    // El rótulo de la izquierda dice de qué posición se trata: la del árbol, o la de la línea mientras se recorre
    if (this.pasoLinea >= 0) { this.el.nombre.textContent = 'Posición de tu plan'; this.el.datos.textContent = ''; }
    else if (this.actual) { const nombre = nombreApertura(this.actual); this.el.nombre.textContent = nombre || (this.actual.ply === 0 ? 'Posición inicial' : 'Sin nombre de apertura'); this.el.datos.textContent = this.actual.partidas === 0 ? '' : `En esta posición: ${this.actual.partidas} partidas · él saca el ${redondeo(this.actual.porcentaje)} % de los puntos`; }
    this._marcarPaso();
    this.tablero.raiz.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  _marcarPaso() {
    const linea = this.linea, i = this.pasoLinea;
    this.el.lineaTexto.querySelectorAll('[data-paso]').forEach(f => f.classList.toggle('actual', Number(f.dataset.paso) === i));
    this.el.lineaTabla.querySelectorAll('[data-paso]').forEach(f => f.classList.toggle('actual', Number(f.dataset.paso) === i));
    this.el.pasoAnt.disabled = !linea?.length || i < 0;
    this.el.pasoSig.disabled = !linea?.length || i >= linea.length - 1;
    if (!linea?.length) { this.el.lineaPos.textContent = ''; return; }
    if (i < 0) { this.el.lineaPos.textContent = 'Posición de partida, antes de la línea'; return; }
    const p = linea[i], n = p.nodo;
    this.el.lineaPos.innerHTML = `<span>Tras</span> ${figurasHtml(convertirFiguras(`${n.ply % 2 === 1 ? `${(n.ply + 1) / 2 | 0}.` : `${n.ply / 2}…`}${n.san}`))} <span>·</span> <span>${p.esMia ? 'tu jugada' : 'su jugada'}</span>`;
  }

  _reproducirLinea() {
    if (!this.linea?.length) return;
    if (this.pasoLinea >= this.linea.length - 1) this._irAPaso(-1);              // si ya estaba al final, empieza de nuevo
    this.el.pasoRep.textContent = '⏸ Pausa';
    this.reloj = setInterval(() => {
      if (this.pasoLinea >= this.linea.length - 1) { this._pararReproduccion(); return; }
      this._irAPaso(this.pasoLinea + 1);
    }, 900);
  }

  _pararReproduccion() {
    clearInterval(this.reloj); this.reloj = null;
    if (this.el?.pasoRep) this.el.pasoRep.textContent = '▶ Reproducir';
  }
}
