// Cuadros y menús del visor: «Introducir nueva jugada» (NuevaJugadaDialog), «Texto previo / posterior» (TextoJugadaDialog), «Conclusiones»
// (ConclusionesDialog) y el menú de cada jugada.
import { contenidoBoton } from './iconos.js';
import { figurasHtml } from './figuritas.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function abrirVelo(titulo, cuerpo, ancho = 460) {
  const previo = document.activeElement;
  const velo = document.createElement('div');
  velo.className = 'velo';
  velo.innerHTML = `<div class="dialogo" role="dialog" aria-modal="true" aria-label="${esc(titulo)}" style="width:${ancho}px">
      <div class="dialogo-cab"><img src="assets/icon.png" alt=""><span>${esc(titulo)}</span></div>${cuerpo}</div>`;
  let resolver;
  const promesa = new Promise(r => { resolver = r; });
  const cerrar = (valor) => {
    document.removeEventListener('keydown', teclas, true);
    velo.classList.add('saliendo');
    setTimeout(() => { velo.remove(); previo?.focus?.(); }, 160);
    resolver(valor);
  };
  const teclas = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(null); } };
  velo.addEventListener('mousedown', (e) => { if (e.target === velo) cerrar(null); });
  document.addEventListener('keydown', teclas, true);
  document.body.appendChild(velo);
  return { velo, cerrar, promesa };
}

/** Qué hacer con una jugada distinta de la que sigue en la partida: 'variante', 'principal', 'sobrescribir', 'insertar' o null (cancelar).
 *  «jugada» ya con figuritas, por ejemplo «19.♖xf6». Dentro de una variante no se anidan otras. */
export function elegirOpcionJugada(jugada, enVariante) {
  const { velo, cerrar, promesa } = abrirVelo('Introducir nueva jugada', `
    <div class="importar-cuerpo">
      <p class="suave" style="margin:0 0 4px;font-size:12px">Jugadas</p>
      <p class="nueva-jugada-texto">${figurasHtml(jugada)}</p>
      <div class="nueva-jugada-botones">
        <button type="button" class="btn btn-secundario" data-op="variante" ${enVariante ? 'disabled' : ''}>Nueva variante</button>
        <button type="button" class="btn btn-secundario" data-op="principal" ${enVariante ? 'disabled' : ''}>Nueva línea principal</button>
        <button type="button" class="btn btn-secundario" data-op="sobrescribir">Sobrescribir</button>
        <button type="button" class="btn btn-secundario" data-op="insertar">Insertar</button>
        <button type="button" class="btn btn-secundario" data-op="">Cancelar</button>
      </div>
    </div>`);
  velo.addEventListener('click', (e) => { const b = e.target.closest('[data-op]'); if (b) cerrar(b.dataset.op || null); });
  velo.querySelector(enVariante ? '[data-op="sobrescribir"]' : '[data-op="variante"]').focus();
  return promesa;
}

/** «Variante»: al avanzar hasta una posición con más de una continuación, lista las jugadas posibles. Flechas arriba/abajo cambian la elegida,
 *  Intro, flecha derecha o doble clic la juegan, y Esc o flecha izquierda cierran. «Jugada arriba» y «Jugada abajo» cambian su sitio en la lista.
 *  @param {{ obtener: () => string[], elegir: (i: number) => void, reordenar: (i: number, direccion: -1 | 1) => number }} f
 *  obtener: el texto de cada jugada (con figuritas); reordenar: devuelve el nuevo lugar de la jugada. */
export function elegirVariante({ obtener, elegir, reordenar }) {
  const previo = document.activeElement;
  const velo = document.createElement('div');
  velo.className = 'velo';
  velo.innerHTML = `<div class="dialogo dialogo-variante" role="dialog" aria-modal="true" aria-label="Variante">
      <div class="dialogo-cab"><img src="assets/icon.png" alt=""><span>Variante</span><button type="button" class="variante-cerrar" data-cerrar title="Cerrar" aria-label="Cerrar">✕</button></div>
      <div class="variante-cuerpo">
        <div class="variante-opciones" role="listbox" tabindex="0"></div>
        <div class="variante-acciones">
          <button type="button" class="btn btn-secundario" data-mover="-1">Jugada arriba</button>
          <button type="button" class="btn btn-secundario" data-mover="1">Jugada abajo</button>
        </div>
      </div>
    </div>`;
  const lista = velo.querySelector('.variante-opciones');
  let seleccion = 0, textos = obtener();
  function pintar() {
    textos = obtener();
    seleccion = Math.max(0, Math.min(seleccion, textos.length - 1));
    lista.innerHTML = textos.map((t, i) => `<button type="button" role="option" class="variante-opcion${i === seleccion ? ' seleccionada' : ''}" aria-selected="${i === seleccion}" data-i="${i}">${figurasHtml(t)}</button>`).join('');
    velo.querySelector('[data-mover="-1"]').disabled = seleccion === 0;
    velo.querySelector('[data-mover="1"]').disabled = seleccion === textos.length - 1;
  }
  const cerrar = () => { document.removeEventListener('keydown', teclas, true); velo.remove(); previo?.focus?.(); };
  const jugar = (i) => { cerrar(); elegir(i); };
  function mover(direccion) { seleccion = reordenar(seleccion, direccion); pintar(); }
  function teclas(e) {
    const tecla = e.key;
    if (!['Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(tecla)) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if (tecla === 'Escape' || tecla === 'ArrowLeft') cerrar();
    else if (tecla === 'ArrowUp') { seleccion = seleccion <= 0 ? textos.length - 1 : seleccion - 1; pintar(); }
    else if (tecla === 'ArrowDown') { seleccion = seleccion >= textos.length - 1 ? 0 : seleccion + 1; pintar(); }
    else jugar(seleccion);                                // Intro o flecha derecha
  }
  lista.addEventListener('click', (e) => { const o = e.target.closest('[data-i]'); if (o) { seleccion = Number(o.dataset.i); pintar(); } });
  lista.addEventListener('dblclick', (e) => { const o = e.target.closest('[data-i]'); if (o) jugar(Number(o.dataset.i)); });
  velo.querySelector('[data-cerrar]').addEventListener('click', cerrar);
  velo.querySelectorAll('[data-mover]').forEach(b => b.addEventListener('click', () => mover(Number(b.dataset.mover))));
  velo.addEventListener('mousedown', (e) => { if (e.target === velo) cerrar(); });
  document.addEventListener('keydown', teclas, true);
  document.body.appendChild(velo);
  pintar();
  lista.focus();
}

/** Pide el texto previo o posterior de una jugada y su color. Devuelve { texto, color } o null; con el texto vacío el comentario se quita. */
export function pedirTexto(titulo, texto, color) {
  const piezas = [['♔', 'rey'], ['♕', 'dama'], ['♖', 'torre'], ['♗', 'alfil'], ['♘', 'caballo'], ['♙', 'peón']];
  const colores = [['negro', 'Negro', '#1C2E42'], ['azul', 'Azul', '#2563B8'], ['rojo', 'Rojo', '#B3322A']];
  if (!colores.some(([valor]) => valor === color)) color = 'negro';
  const { velo, cerrar, promesa } = abrirVelo(titulo, `
    <div class="importar-cuerpo">
      <div class="texto-figuras" role="group" aria-label="Insertar piezas en el comentario">
        <span class="suave">Insertar pieza</span>
        ${piezas.map(([figura, nombre]) => `<button type="button" class="btn btn-secundario" data-figura="${figura}" title="Insertar ${nombre}" aria-label="Insertar ${nombre}"><span aria-hidden="true">${figura}</span></button>`).join('')}
      </div>
      <textarea class="texto-jugada" rows="5" data-texto spellcheck="true" aria-label="Comentario de la jugada">${esc(texto)}</textarea>
      <div class="texto-colores"><span class="suave">Color</span>
        ${colores.map(([v, t, c]) =>
          `<label style="color:${c}"><input type="radio" name="colorTexto" value="${v}" ${v === color ? 'checked' : ''}><span>${t}</span></label>`).join('')}
      </div>
      <div class="importar-botones">
        <button type="button" class="btn btn-primario" data-aceptar></button>
        <button type="button" class="btn btn-secundario" data-cancelar></button>
      </div>
    </div>`);
  velo.querySelector('[data-aceptar]').innerHTML = contenidoBoton('visto', 'Aceptar');
  velo.querySelector('[data-cancelar]').innerHTML = contenidoBoton('equis', 'Cancelar');
  velo.querySelector('[data-aceptar]').addEventListener('click', () =>
    cerrar({ texto: velo.querySelector('[data-texto]').value, color: velo.querySelector('input[name="colorTexto"]:checked').value }));
  velo.querySelector('[data-cancelar]').addEventListener('click', () => cerrar(null));
  const caja = velo.querySelector('[data-texto]');
  const actualizarColor = () => {
    const seleccionado = velo.querySelector('input[name="colorTexto"]:checked').value;
    const tono = colores.find(([valor]) => valor === seleccionado)[2];
    velo.querySelector('.importar-cuerpo').style.setProperty('--color-comentario', tono);
  };
  for (const opcion of velo.querySelectorAll('input[name="colorTexto"]')) opcion.addEventListener('change', actualizarColor);
  actualizarColor();
  for (const boton of velo.querySelectorAll('[data-figura]')) {
    // Conserva el cursor o la selección al pulsar la barra con el ratón.
    boton.addEventListener('mousedown', e => e.preventDefault());
    boton.addEventListener('click', () => {
      caja.setRangeText(boton.dataset.figura, caja.selectionStart, caja.selectionEnd, 'end');
      caja.focus({ preventScroll: true });
      caja.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  caja.focus(); caja.setSelectionRange(caja.value.length, caja.value.length);
  return promesa;
}

/** Cuadro con lo más importante que se deduce del análisis de una partida. «apartados»: [{ titulo, texto }]. */
export function mostrarConclusiones(titulo, apartados) {
  const { velo, cerrar, promesa } = abrirVelo(titulo, `
    <div class="importar-cuerpo conclusiones-marco">
      <div class="conclusiones">
      ${apartados.map(a => `${a.titulo ? `<div class="concl-titulo">${esc(a.titulo)}</div>` : ''}<p class="concl-texto">${figurasHtml(a.texto)}</p>`).join('')}
      </div>
      <div class="importar-botones"><button type="button" class="btn btn-primario" data-cerrar></button></div>
    </div>`, 640);
  velo.querySelector('[data-cerrar]').innerHTML = contenidoBoton('visto', 'Cerrar');
  velo.querySelector('[data-cerrar]').addEventListener('click', () => cerrar(null));
  velo.querySelector('[data-cerrar]').focus();
  return promesa;
}

// ---------- Menú contextual (botón derecho) ----------

let menuAbierto = null;
export function cerrarMenu() { menuAbierto?.remove(); menuAbierto = null; }

/** «items»: [{ texto, accion, activo, marcado, submenu: [...] } | { separador: true }] */
export function abrirMenu(x, y, items) {
  cerrarMenu();
  const crear = (lista) => {
    const menu = document.createElement('div');
    menu.className = 'menu-contextual';
    for (const it of lista) {
      if (it.separador) { menu.insertAdjacentHTML('beforeend', '<hr>'); continue; }
      const fila = document.createElement('div');
      fila.className = 'menu-item' + (it.activo === false ? ' desactivado' : '') + (it.submenu ? ' con-submenu' : '');
      fila.innerHTML = `<span class="menu-marca">${it.marcado ? '✓' : ''}</span><span>${figurasHtml(it.texto)}</span>${it.submenu ? '<span class="menu-flecha">›</span>' : ''}`;
      if (it.submenu) {
        const sub = crear(it.submenu);
        sub.classList.add('submenu');
        fila.appendChild(sub);
      } else if (it.activo !== false) {
        fila.addEventListener('click', (e) => { e.stopPropagation(); cerrarMenu(); it.accion?.(); });
      }
      menu.appendChild(fila);
    }
    return menu;
  };
  const menu = crear(items);
  menu.style.left = `${x}px`; menu.style.top = `${y}px`;
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  if (r.right > innerWidth - 8) menu.style.left = `${Math.max(8, innerWidth - r.width - 8)}px`;
  if (r.bottom > innerHeight - 8) menu.style.top = `${Math.max(8, innerHeight - r.height - 8)}px`;
  menuAbierto = menu;
}
document.addEventListener('mousedown', (e) => { if (menuAbierto && !menuAbierto.contains(e.target)) cerrarMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarMenu(); });
window.addEventListener('blur', cerrarMenu);
