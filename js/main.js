// Ventana principal de ChessRival (equivale a MainWindow.xaml / MainWindow.xaml.cs).
import { LOCALE } from './i18n.js';
import { ponerCargando } from './cargando.js';
import * as db from './db.js';
import { svg, contenidoBoton, pintarIconosFijos } from './iconos.js';
import { preguntar, informar, elegirJugador, iniciales } from './dialogos.js';
import { urlBandera } from './banderas.js';
import * as fuentes from './fuentes.js';
import * as mega from './mega.js';
import { instalarFichaFide } from './ficha-fide-emergente.js';
import { nombreConTitulo } from './nombre-jugador.js';

const LIMITE_TORNEOS = 6;
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const menosMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;

const el = {
  subtitulo: $('subtitulo'), urlBox: $('urlBox'), cargarBtn: $('cargarBtn'),
  megaText: $('megaText'), megaBtn: $('megaBtn'), libroText: $('libroText'), libroBtn: $('libroBtn'),
  rango: $('cantidadRango'), cantidad: $('cantidadValor'),
  pestanas: $('filaPestanas'), estado: $('estadoText'), tarjetas: $('tarjetas'),
  redPunto: $('redPunto'), redText: $('redText'), pie: $('pieText')
};

/** Torneo cuya pestaña está abierta; null = «Todos». */
let torneoActual = null;
let pestanas = [];          // [{ id, titulo, contador, esJugadores, activa }]
let jugadores = [];         // tarjetas en pantalla, en su orden
let arrastre = null;        // { tipo: 'tarjeta' | 'pestana', ... }
let urlDelPortapapeles = null;
instalarFichaFide(el.tarjetas, elemento => jugadores.find(j => j.id === Number(elemento.dataset.id)));

// ---------- Animación de reordenación (FLIP): los elementos se deslizan a su nuevo sitio ----------

function animarMovimiento(elementos, mutar) {
  const antes = new Map(elementos.map(e => [e, e.getBoundingClientRect()]));
  mutar();
  if (menosMovimiento) return;
  for (const [e, r] of antes) {
    if (!e.isConnected) continue;
    const d = e.getBoundingClientRect();
    const dx = r.left - d.left, dy = r.top - d.top;
    if (!dx && !dy) continue;
    e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
}

// ---------- Pestañas de torneo ----------

const elementosPestana = new Map();   // clave → div

const clavePestana = (p) => p.id ?? 'todos';

function crearPestana(p) {
  const d = document.createElement('div');
  d.className = 'pestana';
  d.setAttribute('role', 'tab');
  d.tabIndex = 0;
  d.dataset.clave = clavePestana(p);
  return d;
}

function pintarPestana(d, p) {
  d.classList.toggle('activa', p.activa);
  d.classList.toggle('todos', p.id === null);
  d.classList.toggle('pestana-fija', p.id === null || p.esJugadores);
  d.setAttribute('aria-selected', p.activa);
  d.draggable = p.id !== null && !p.esJugadores;
  d.title = p.titulo;
  const cerrable = p.id !== null && !p.esJugadores;
  d.innerHTML = `<span class="pestana-nombre">${esc(p.titulo)}</span><span class="pestana-contador">${p.contador}</span>`
    + (cerrable ? `<button class="pestana-cerrar" type="button" title="Ocultar las tarjetas de este torneo" aria-label="Cerrar">✕</button>` : '');
}

/** Conserva el orden y deja que las pestañas continúen en la fila siguiente si no caben. */
function colocarPestanas() {
  const deseado = pestanas.map(p => elementosPestana.get(clavePestana(p)));
  [...el.pestanas.children].forEach(h => { if (!deseado.includes(h)) h.remove(); });
  deseado.forEach((h, i) => { if (el.pestanas.children[i] !== h) el.pestanas.insertBefore(h, el.pestanas.children[i] ?? null); });
  ajustarAnchoPestanas();
}

/** Las dos pestañas generales son compactas; los torneos comparten ancho en todas las filas. */
function ajustarAnchoPestanas() {
  const fijas = [...el.pestanas.querySelectorAll('.pestana-fija')];
  const cantidad = el.pestanas.children.length - fijas.length;
  const ancho = el.pestanas.clientWidth;
  if (!cantidad || !ancho) return;
  const hueco = 8, minimo = 200;
  const disponible = ancho - fijas.reduce((s, t) => s + t.getBoundingClientRect().width, 0) - hueco * fijas.length;
  const primera = Math.min(cantidad, Math.max(0, Math.floor((disponible + hueco) / (minimo + hueco))));
  const columnas = Math.min(cantidad, Math.max(1, Math.floor((ancho + hueco) / (minimo + hueco))));
  const anchoPrimera = primera ? (disponible - hueco * (primera - 1)) / primera : ancho;
  const anchoFila = (ancho - hueco * (columnas - 1)) / columnas;
  el.pestanas.style.setProperty('--ancho-torneo', `${Math.floor(Math.min(anchoPrimera, anchoFila) * 100) / 100}px`);
}
new ResizeObserver(ajustarAnchoPestanas).observe(el.pestanas);

function pintarPestanas() {
  const claves = new Set(pestanas.map(clavePestana));
  for (const [k, d] of elementosPestana) if (!claves.has(k)) { d.remove(); elementosPestana.delete(k); }
  animarMovimiento([...elementosPestana.values()], () => {
    for (const p of pestanas) {
      let d = elementosPestana.get(clavePestana(p));
      if (!d) { d = crearPestana(p); elementosPestana.set(clavePestana(p), d); }
      pintarPestana(d, p);
    }
    colocarPestanas();
  });
}

async function refrescarPestanas(seleccionar = null) {
  const torneos = await db.listarTorneos();

  if (seleccionar !== null && torneos.some(t => t.id === seleccionar)) torneoActual = seleccionar;
  else if (torneoActual !== null && torneos.every(t => t.id !== torneoActual)) {
    // su torneo ya no está: se abre el más reciente
    torneoActual = torneos.find(t => t.url !== db.URL_JUGADORES)?.id ?? null;
  }

  pestanas = [
    { id: null, titulo: 'Todos', contador: torneos.reduce((s, t) => s + t.visibles, 0), activa: torneoActual === null, esJugadores: false },
    ...torneos.map(t => ({ id: t.id, titulo: t.nombre, contador: t.visibles, esJugadores: t.url === db.URL_JUGADORES, activa: torneoActual === t.id }))
  ];
  pintarPestanas();
}

async function abrirPestana(id) {
  if (id === torneoActual) return;
  torneoActual = id;
  try {
    await refrescarPestanas(id);
    await cargarVista();
    await db.guardarTorneoActual(id);
  } catch (ex) { mostrarEstado(ex.message); }
}

async function cerrarPestana(id) {
  const p = pestanas.find(x => x.id === id);
  if (!p) return;
  const ok = await preguntar('Quitar torneo',
    `¿Quitar las ${p.contador} tarjetas de «${p.titulo}»? Los jugadores que sigan en otras pestañas conservarán sus partidas, análisis y anotaciones. Solo se borrarán los datos de quienes se queden sin tarjeta.`,
    { textoSi: 'Quitar', peligro: true });
  if (!ok) return;
  try {
    await db.cerrarTorneo(id);
    if (torneoActual === id) torneoActual = null;   // al cerrarla se queda «Todos»
    await refrescarPestanas();
    await cargarVista();
    await db.guardarTorneoActual(torneoActual);
  } catch (ex) { mostrarEstado(ex.message); }
}

el.pestanas.addEventListener('click', (e) => {
  const d = e.target.closest('.pestana');
  if (!d) return;
  const id = d.dataset.clave === 'todos' ? null : Number(d.dataset.clave);
  if (e.target.closest('.pestana-cerrar')) { e.stopPropagation(); cerrarPestana(id); return; }
  abrirPestana(id);
});
el.pestanas.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('pestana')) { e.preventDefault(); e.target.click(); }
});

// ---------- Tarjetas ----------

const elementosTarjeta = new Map();   // id → div

function plantillaTarjeta(j) {
  const bandera = urlBandera(j.federation);
  const estado = j.status === 'Listo' ? ['listo', 'Listo'] : j.status === 'Importando' ? ['importando', 'Importando'] : ['', 'Sin partidas'];
  const titulo = nombreConTitulo(j);
  const tituloCompleto = j.rank > 0 ? `${j.rank} · ${titulo}` : titulo;
  return `
    <div class="tarjeta-cab">
      <div class="avatar">${j.photo ? `<img src="${esc(j.photo)}" alt="" draggable="false">` : esc(iniciales(j.name))}</div>
      <div class="tarjeta-titulo recortar" title="${esc(tituloCompleto)}">${esc(tituloCompleto)}</div>
      <div class="estado-pildora ${estado[0]}"><i></i><span>${estado[1]}</span></div>
    </div>
    <div class="tarjeta-cuerpo">
      <div><div class="etiqueta">ELO</div><div class="valor elo">${j.rating || ''}</div></div>
      <div><div class="etiqueta">Edad</div><div class="valor">${esc(j.age)}</div></div>
      <div><div class="etiqueta">Partidas</div><div class="valor">${j.gamesCount}</div></div>
      <div><div class="etiqueta">ID FIDE</div><div class="valor">${esc(j.fideId || '—')}</div></div>
      <div><div class="etiqueta">Federación</div><div class="federacion">${bandera ? `<img src="${bandera}" alt="" draggable="false" onerror="this.remove()">` : ''}<span class="valor">${esc(j.federation)}</span></div></div>
      <div class="fuentes"><div class="etiqueta">Fuentes</div><div class="valor recortar" title="Porcentaje de las partidas de este jugador que hay en cada fuente (una partida en dos fuentes cuenta en las dos).">${esc(j.sources)}</div></div>
      ${/^[1-9]\d*$/.test(j.fideId || '') ? `<button class="btn-icono ver-fide" type="button" data-ver-fide title="Ver la ficha FIDE" aria-label="Ver la ficha FIDE">${svg('ojo', 18)}</button>` : ''}
      <button class="btn-icono borrar" type="button" title="Quitar jugador" aria-label="Quitar jugador">${svg('papelera', 17)}</button>
    </div>`;
}

function crearTarjeta(j) {
  const d = document.createElement('article');
  d.className = 'tarjeta';
  d.draggable = true;
  d.dataset.id = j.id;
  return d;
}

function pintarTarjetas(lista) {
  for (const j of lista) { if (!j.photo && fotos.get(j.fideId)) j.photo = fotos.get(j.fideId); }
  jugadores = lista;
  const ids = new Set(lista.map(j => j.id));
  for (const [id, d] of elementosTarjeta) if (!ids.has(id)) { d.remove(); elementosTarjeta.delete(id); }

  let nuevas = 0;
  animarMovimiento([...elementosTarjeta.values()], () => {
    for (const j of lista) {
      let d = elementosTarjeta.get(j.id);
      if (!d) {
        d = crearTarjeta(j);
        d.classList.add('entra');
        d.style.setProperty('--i', Math.min(nuevas++, 12));
        d.addEventListener('animationend', () => d.classList.remove('entra'), { once: true });
        elementosTarjeta.set(j.id, d);
      }
      d.innerHTML = plantillaTarjeta(j);
    }
    lista.forEach((j, i) => {
      const d = elementosTarjeta.get(j.id);
      if (el.tarjetas.children[i] !== d) el.tarjetas.insertBefore(d, el.tarjetas.children[i] ?? null);
    });
  });
}

function mostrarEstado(texto, cargando = false) {
  if (cargando) ponerCargando(el.estado, texto); else el.estado.textContent = texto;
  el.estado.classList.remove('oculto');
}
const ocultarEstado = () => el.estado.classList.add('oculto');

/** Pone en pantalla las tarjetas de la pestaña abierta. Sin ningún torneo ni jugador: la pantalla de bienvenida. */
async function cargarVista() {
  const lista = torneoActual !== null ? await db.cargarPantalla(torneoActual) : await db.cargarTodos();
  pintarTarjetas(lista);

  if (pestanas.every(p => p.contador === 0)) {
    el.subtitulo.textContent = 'Pega una URL de Chess-Results o Info64';
    mostrarEstado('Aquí aparecerán las tarjetas de los primeros de cada torneo y los jugadores que añadas.');
    el.pie.textContent = '';
    return;
  }

  const activa = pestanas.find(p => p.activa);
  if (activa?.esJugadores) el.subtitulo.textContent = 'Jugadores sueltos';
  else if (torneoActual !== null) el.subtitulo.textContent = activa?.titulo ?? '';
  else el.subtitulo.textContent = lista.length > 0 ? `Todos los torneos · ${lista.length} jugadores` : 'Todos los torneos';

  if (lista.length === 0) {
    mostrarEstado(activa?.esJugadores
      ? 'Todavía no hay jugadores sueltos. Escribe un nombre en la caja de arriba y pulsa Enter para añadir uno.'
      : torneoActual === null
        ? 'No hay tarjetas. Pega la URL de un torneo o escribe el nombre o el ID FIDE de un jugador.'
        : 'Este torneo no tiene tarjetas en pantalla. Carga de nuevo su URL para traerlas.');
  } else ocultarEstado();
  el.pie.textContent = '';
  completarTarjetas(lista);
}

// ---------- Fotos, títulos y edades (de la FIDE, por el servidor intermedio) ----------

const fotos = new Map();   // ID FIDE → data URL de la foto ('' = la FIDE no tiene foto)

/** Ejecuta fn sobre cada elemento con, como mucho, `n` a la vez (no se satura el servidor con torneos grandes). */
async function enParalelo(items, n, fn) {
  const cola = [...items];
  await Promise.all(Array.from({ length: Math.min(n, cola.length) }, async () => {
    while (cola.length) await fn(cola.shift());
  }));
}

/** Aplica unos cambios a la tarjeta (en pantalla y en la base de datos) y la repinta. */
async function aplicarCambios(id, cambios) {
  for (const t of jugadores) if (t.id === id) { Object.assign(t, cambios); repintar(t); }
  try { await db.actualizarTarjeta(id, cambios); } catch { /* se reintentará en la próxima carga */ }
}

/** De cada jugador que viene de un torneo: se comprueba contra la FIDE (ID real, federación, título y edad), luego su foto.
 *  Las tarjetas se van completando una a una, de arriba abajo. */
async function completarTarjetas(lista) {
  await enParalelo(lista, 4, async (j) => {
    if (!j.verificado) {
      try {
        const v = await fuentes.verificarJugador(j);
        const cambios = { name: v.name, fideId: v.fideId, federation: v.federation, verificado: true };
        if (v.rating) cambios.rating = v.rating;
        if (v.fideTitle) cambios.fideTitle = v.fideTitle;
        if (v.age) cambios.age = v.age;
        if (v.titulosOk) cambios.titulosOk = true;
        await aplicarCambios(j.id, cambios);
        Object.assign(j, cambios);
      } catch { /* sin servidor o sin FIDE: la tarjeta se queda como venía y se reintenta al volver a abrirla */ }
    }
    await cargarFotos([j]);
    await cargarTitulos([j]);
  });
}

function repintar(j) {
  const d = elementosTarjeta.get(j.id);
  if (d) d.innerHTML = plantillaTarjeta(j);
}

async function cargarFotos(lista) {
  await Promise.all(lista.filter(j => j.fideId).map(async (j) => {
    try {
      let foto = fotos.get(j.fideId);
      if (foto === undefined) {
        foto = await db.leerAjuste('foto:' + j.fideId);                    // caché en este navegador
        if (foto === null) {
          foto = await fuentes.descargarFoto(j.fideId);
          await db.guardarAjuste('foto:' + j.fideId, foto);
        }
        fotos.set(j.fideId, foto);
      }
      if (!foto) return;
      // la lista en pantalla puede haber cambiado mientras se descargaba: se aplica a las tarjetas actuales
      for (const t of jugadores) if (t.fideId === j.fideId && t.photo !== foto) { t.photo = foto; repintarFoto(t); }
    } catch { /* la foto es opcional: sin servidor o sin conexión, la tarjeta se queda con las iniciales */ }
  }));
}

/** Cambia solo el avatar: el resto de la tarjeta no se toca (así no parpadea ni se pierde un arrastre). */
function repintarFoto(j) {
  const avatar = elementosTarjeta.get(j.id)?.querySelector('.avatar');
  if (!avatar) return;
  avatar.innerHTML = `<img src="${esc(j.photo)}" alt="" draggable="false">`;
  avatar.classList.add('con-foto');
}

async function cargarTitulos(lista) {
  // Una sola vez por tarjeta: trae todos los títulos del perfil (FIDE y Arena: GM, FM, AIM, AFM, AGM…) y la edad.
  await Promise.all(lista.filter(j => j.fideId && !j.titulosOk).map(async (j) => {
    try {
      const ficha = await fuentes.fichaFide(j.fideId);
      const cambios = { titulosOk: true };
      if (ficha.titulo) cambios.fideTitle = ficha.titulo.replace(/ · /g, '/');
      if (ficha.edad) cambios.age = ficha.edad;
      for (const t of jugadores) if (t.id === j.id) { Object.assign(t, cambios); repintar(t); if (t.photo) repintarFoto(t); }
      await db.actualizarTarjeta(j.id, cambios);
    } catch { /* el título es un complemento: si la FIDE no responde, la tarjeta se queda sin él */ }
  }));
}

// ---------- Borrar y abrir ficha ----------

async function borrarTarjeta(j) {
  const ok = await preguntar('Quitar jugador',
    `¿Quitar esta tarjeta de ${nombreConTitulo(j)}? Si sigue en otra pestaña, conservará sus partidas, análisis y anotaciones. Si es su última tarjeta, se borrarán también esos datos.`,
    { textoSi: 'Quitar', peligro: true, foto: j.photo, nombre: j.name });
  if (!ok) return;

  const d = elementosTarjeta.get(j.id);
  if (d && !menosMovimiento) await d.animate(
    [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.92)' }], { duration: 170, easing: 'ease-in' }).finished;
  try {
    await db.quitarTarjeta(j.id);
    await db.guardarOrden(jugadores.filter(x => x.id !== j.id));
    await refrescarPestanas();
  } catch (ex) { el.pie.textContent = `No se pudo guardar el cambio: ${ex.message}`; return; }

  // Si era la última tarjeta del torneo, su pestaña desaparece y se abre la siguiente.
  if (pestanas.every(p => p.id !== j.torneoId)) {
    await cargarVista();
    await db.guardarTorneoActual(torneoActual);
    return;
  }
  await cargarVista();
}

/** Abre la ficha en su propia pestaña (como la ventana de escritorio); si ya estaba abierta, se trae al frente. */
function abrirFicha(j) {
  const ventana = window.open(`ficha.html?id=${j.id}`, `ficha-${j.id}`);
  ventana?.focus();
  if (!ventana) informar('Ventana bloqueada', 'El navegador ha bloqueado la ficha. Permite las ventanas emergentes para este sitio y vuelve a intentarlo.');
}

el.tarjetas.addEventListener('click', (e) => {
  const d = e.target.closest('.tarjeta');
  if (!d || !e.target.closest('.borrar')) return;
  const j = jugadores.find(x => x.id === Number(d.dataset.id));
  if (j) borrarTarjeta(j);
});
el.tarjetas.addEventListener('dblclick', (e) => {
  const d = e.target.closest('.tarjeta');
  if (!d || e.target.closest('.borrar')) return;
  const j = jugadores.find(x => x.id === Number(d.dataset.id));
  if (j) abrirFicha(j);
});

// ---------- Arrastrar y soltar: reordenar tarjetas, pasarlas de pestaña y reordenar pestañas ----------

let ultimoReorden = { x: 0, y: 0, t: 0 };

/** Evita el baile de ida y vuelta: tras un intercambio se pide un margen de movimiento o un instante de pausa. */
function puedeReordenar(e) {
  const ahora = performance.now();
  if (ahora - ultimoReorden.t < 160 &&
      Math.abs(e.clientX - ultimoReorden.x) < 40 && Math.abs(e.clientY - ultimoReorden.y) < 40) return false;
  ultimoReorden = { x: e.clientX, y: e.clientY, t: ahora };
  return true;
}

document.addEventListener('dragstart', (e) => {
  const t = e.target.closest?.('.tarjeta');
  const p = e.target.closest?.('.pestana');
  if (t) {
    const j = jugadores.find(x => x.id === Number(t.dataset.id));
    if (!j || e.target.closest('.borrar')) { e.preventDefault(); return; }
    arrastre = { tipo: 'tarjeta', j, indiceOriginal: jugadores.indexOf(j), destinoPestana: null, el: t };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', nombreConTitulo(j));
    requestAnimationFrame(() => t.classList.add('arrastrando'));   // la copia que sigue al ratón se fotografía antes
  } else if (p?.draggable) {
    const id = Number(p.dataset.clave);
    arrastre = { tipo: 'pestana', id, indiceOriginal: pestanas.findIndex(x => x.id === id), el: p };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', p.textContent);
    requestAnimationFrame(() => p.classList.add('arrastrando'));
  }
});

// Mientras se arrastra, cualquier zona acepta el «soltar»: solo Esc cancela y devuelve el elemento a su sitio.
document.addEventListener('dragover', (e) => {
  if (!arrastre) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  if (arrastre.tipo === 'tarjeta') {
    const pestana = e.target.closest?.('.pestana');
    document.querySelectorAll('.pestana.destino').forEach(x => x !== pestana && x.classList.remove('destino'));
    if (pestana) {
      const id = pestana.dataset.clave === 'todos' ? null : Number(pestana.dataset.clave);
      const valida = id !== null && id !== arrastre.j.torneoId;
      pestana.classList.toggle('destino', valida);
      arrastre.destinoPestana = valida ? id : null;
      return;
    }
    arrastre.destinoPestana = null;

    const otra = e.target.closest?.('.tarjeta');
    if (!otra || otra === arrastre.el || !puedeReordenar(e)) return;
    const destino = jugadores.find(x => x.id === Number(otra.dataset.id));
    if (!destino) return;
    animarMovimiento([...elementosTarjeta.values()], () => {
      const de = jugadores.indexOf(arrastre.j), a = jugadores.indexOf(destino);
      jugadores.splice(a, 0, jugadores.splice(de, 1)[0]);
      jugadores.forEach((j, i) => {
        const d = elementosTarjeta.get(j.id);
        if (el.tarjetas.children[i] !== d) el.tarjetas.insertBefore(d, el.tarjetas.children[i] ?? null);
      });
    });
  } else if (arrastre.tipo === 'pestana') {
    const otra = e.target.closest?.('.pestana');
    if (!otra || otra === arrastre.el || !otra.draggable || !puedeReordenar(e)) return;
    const idDestino = Number(otra.dataset.clave);
    const de = pestanas.findIndex(x => x.id === arrastre.id), a = pestanas.findIndex(x => x.id === idDestino);
    if (de < 0 || a < 0) return;
    pestanas.splice(a, 0, pestanas.splice(de, 1)[0]);
    animarMovimiento([...elementosPestana.values()], colocarPestanas);
  }
});

document.addEventListener('drop', (e) => { if (arrastre) e.preventDefault(); });

document.addEventListener('dragend', async (e) => {
  if (!arrastre) return;
  const a = arrastre;
  arrastre = null;
  a.el.classList.remove('arrastrando');
  document.querySelectorAll('.pestana.destino').forEach(x => x.classList.remove('destino'));
  const cancelado = e.dataTransfer.dropEffect === 'none';

  if (a.tipo === 'tarjeta') {
    // Soltada sobre otra etiqueta: la tarjeta cambia de pestaña.
    if (a.destinoPestana !== null && !cancelado) { await moverAPestana(a.j, a.destinoPestana); return; }
    if (cancelado) {
      animarMovimiento([...elementosTarjeta.values()], () => {
        jugadores.splice(jugadores.indexOf(a.j), 1);
        jugadores.splice(a.indiceOriginal, 0, a.j);
        jugadores.forEach((j, i) => {
          const d = elementosTarjeta.get(j.id);
          if (el.tarjetas.children[i] !== d) el.tarjetas.insertBefore(d, el.tarjetas.children[i] ?? null);
        });
      });
    }
    try { await db.guardarOrden(jugadores); } catch (ex) { el.pie.textContent = `No se pudo guardar el orden: ${ex.message}`; }
  } else {
    if (cancelado) {
      const de = pestanas.findIndex(x => x.id === a.id);
      pestanas.splice(a.indiceOriginal, 0, pestanas.splice(de, 1)[0]);
      animarMovimiento([...elementosPestana.values()], colocarPestanas);
    }
    try { await db.guardarOrdenTorneos(pestanas.filter(p => p.id !== null && !p.esJugadores).map(p => p.id)); }
    catch (ex) { el.pie.textContent = `No se pudo guardar el orden de los torneos: ${ex.message}`; }
  }
});

async function moverAPestana(j, destino) {
  try {
    await db.moverJugador(j, destino);
    const nombre = pestanas.find(p => p.id === destino)?.titulo ?? 'esa pestaña';
    await refrescarPestanas(torneoActual);
    await cargarVista();
    el.pie.textContent = `${nombreConTitulo(j)} pasa a «${nombre}».`;
  } catch (ex) { el.pie.textContent = `No se pudo mover la tarjeta: ${ex.message}`; }
}

// ---------- Cargar un torneo o añadir un jugador ----------

let cargandoURL = false;   // mientras se descarga un torneo o se busca un jugador, el botón sigue desactivado

/** «Cargar» (o «Añadir» si es un nombre) solo está activo cuando hay algo escrito; la cruz de la caja se ve al pasar el ratón. */
function actualizarBotonCargar() {
  const texto = el.urlBox.value.trim();
  el.cargarBtn.innerHTML = texto && !fuentes.esUrl(texto)
    ? contenidoBoton('mas', 'Añadir') : contenidoBoton('descargar', 'Cargar');
  el.cargarBtn.disabled = cargandoURL || texto.length === 0;
  el.urlBox.parentElement.classList.toggle('con-texto', el.urlBox.value.length > 0);
}

/** La lista de la FIDE guarda los nombres sin tildes ni eñes: si el usuario las escribió, se conservan en la tarjeta. */
function restaurarAcentos(nombreFide, escrito) {
  const sin = (t) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const palabras = escrito.split(/[ ,]+/).filter(w => w && sin(w) !== w.toLowerCase());
  if (palabras.length === 0) return nombreFide;
  return nombreFide.split(' ').map(parte => {
    const coma = parte.endsWith(',') ? ',' : '';
    const palabra = parte.replace(/,$/, '');
    const escrita = palabras.find(w => sin(w) === sin(palabra) && w.length === palabra.length);
    if (!escrita) return parte;
    return [...palabra].map((c, k) => c === c.toUpperCase() && c !== c.toLowerCase() ? escrita[k].toUpperCase() : escrita[k].toLowerCase()).join('') + coma;
  }).join(' ');
}

async function cargar() {
  const texto = el.urlBox.value.trim();
  if (!texto) return;
  if (!fuentes.esUrl(texto)) { await anadirJugador(texto); return; }

  cargandoURL = true; actualizarBotonCargar();
  mostrarEstado('Cargando torneo…', true);
  el.pie.textContent = 'Descargando clasificación…';
  try {
    const torneo = await fuentes.cargarTorneo(texto, jugadoresACargar);

    // Máximo 6 torneos abiertos; recargar uno que ya tiene pestaña siempre se permite.
    const abiertos = (await db.listarTorneos()).filter(t => t.url !== db.URL_JUGADORES);
    const clave = fuentes.claveTorneo(texto);
    if (abiertos.length >= LIMITE_TORNEOS && abiertos.every(t => fuentes.claveTorneo(t.url) !== clave)) {
      mostrarEstado(`Ya hay ${LIMITE_TORNEOS} torneos abiertos: quita alguna pestaña con ✕ antes de abrir otro.`);
      el.pie.textContent = 'Límite de torneos alcanzado';
      return;
    }

    const id = await db.guardarTorneo({ nombre: torneo.nombre, url: texto, clave, jugadores: torneo.jugadores });
    await refrescarPestanas(id);
    await cargarVista();
    await db.guardarTorneoActual(id);
  } catch (ex) {
    mostrarEstado(ex.message);
    el.pie.textContent = ex instanceof fuentes.SinServidor ? 'Servidor intermedio sin configurar' : 'Error al cargar';
  } finally {
    cargandoURL = false; actualizarBotonCargar();
  }
}

async function anadirJugador(texto) {
  cargandoURL = true; actualizarBotonCargar();
  mostrarEstado(`Buscando «${texto}» en la FIDE…`, true);
  el.pie.textContent = 'Buscando jugador…';
  try {
    const candidatos = await fuentes.buscarFide(texto);
    if (candidatos.length === 0) {
      await informar('Jugador no encontrado',
        `No hay ningún jugador en la FIDE que encaje con «${texto}». Prueba con el apellido y el nombre, o con su ID FIDE.`);
      el.pie.textContent = 'Jugador no encontrado';
      return;
    }
    // Si solo encaja uno se añade directamente; si hay duda, se deja elegir con sus datos de la FIDE.
    const elegido = candidatos.length === 1 ? candidatos[0] : await elegirJugador(texto, candidatos, urlBandera);
    if (!elegido) { el.pie.textContent = ''; return; }

    // Va a la pestaña abierta; desde «Todos» va a «Jugadores».
    const torneoId = torneoActual ?? await db.torneoJugadoresId();
    const ok = await db.anadirJugador({
      name: restaurarAcentos(elegido.nombre, texto), fideId: elegido.fideId, federation: elegido.federacion, rating: elegido.elo,
      fideTitle: elegido.titulo && elegido.titulo !== '-' ? elegido.titulo : '',
      verificado: true
    }, torneoId);
    if (!ok) { await informar('Ya está', `${nombreConTitulo(elegido)} ya tiene su tarjeta en esta pestaña.`); el.pie.textContent = ''; return; }

    el.urlBox.value = '';
    actualizarBotonCargar();
    await refrescarPestanas(torneoId);
    await cargarVista();
    await db.guardarTorneoActual(torneoActual);
    el.pie.textContent = `${nombreConTitulo(elegido)} añadido.`;
  } catch (ex) {
    mostrarEstado(ex.message);
    el.pie.textContent = ex instanceof fuentes.SinServidor ? 'Servidor intermedio sin configurar' : 'Error al añadir el jugador';
  } finally {
    cargandoURL = false; actualizarBotonCargar();
    if (jugadores.length > 0) ocultarEstado();
  }
}

el.cargarBtn.addEventListener('click', cargar);
el.urlBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') cargar(); });
el.urlBox.addEventListener('input', actualizarBotonCargar);
$('urlLimpiar').addEventListener('click', () => { el.urlBox.value = ''; actualizarBotonCargar(); el.urlBox.focus(); });

// Al volver a la pestaña del navegador se mira el portapapeles: si hay una URL de Chess-Results o Info64 se pone en la caja,
// salvo que el usuario ya haya escrito otra cosa.
async function mirarPortapapeles() {
  let texto;
  try { texto = (await navigator.clipboard.readText()).trim(); } catch { return; }
  if (!fuentes.esSoportada(texto) || el.urlBox.value === texto) return;
  if (el.urlBox.value.trim() && el.urlBox.value !== urlDelPortapapeles) return;
  urlDelPortapapeles = texto;
  el.urlBox.value = texto;
  actualizarBotonCargar();
}
window.addEventListener('focus', mirarPortapapeles);

// ---------- MegaDatabase, libro de aperturas y motor ----------

const elegidos = { libro: null };   // el libro de aperturas: de momento solo se recuerda su nombre

function pintarBanner(clave, textoEl, boton, { vacio, nombre }) {
  const e = elegidos[clave];
  textoEl.className = 'banner-texto recortar ' + (e ? '' : 'suave');
  textoEl.textContent = e ? (nombre ?? e.nombre) : vacio;
  textoEl.title = e ? (nombre ?? e.nombre) : '';
  boton.innerHTML = e ? contenidoBoton('cambiar', 'Cambiar') : contenidoBoton('carpeta', 'Elegir');
}

/** MegaDatabase: sin elegir, conectada, con error o a la espera de que el navegador deje volver a abrir sus archivos. */
function pintarMega() {
  const t = el.megaText, e = mega.estado;
  if (e.base) {
    t.className = 'banner-texto recortar'; t.textContent = `${e.base.nombre} · ${e.base.totalPartidas.toLocaleString(LOCALE)} partidas`; t.title = e.base.nombre;
    el.megaBtn.innerHTML = contenidoBoton('cambiar', 'Cambiar');
  } else if (e.pendiente) {
    t.className = 'banner-texto recortar azul'; t.textContent = `${e.nombre || 'MegaDatabase'} · pulsa «Permitir» para abrirla`; t.title = 'El navegador pide confirmar el acceso a los archivos de la base cada vez que abres la página.';
    el.megaBtn.innerHTML = contenidoBoton('visto', 'Permitir');
  } else if (e.error) {
    t.className = 'banner-texto recortar error'; t.textContent = 'MegaDatabase no disponible'; t.title = e.error;
    el.megaBtn.innerHTML = contenidoBoton('carpeta', 'Elegir');
  } else {
    t.className = 'banner-texto recortar suave'; t.textContent = 'MegaDatabase sin elegir'; t.title = '';
    el.megaBtn.innerHTML = contenidoBoton('carpeta', 'Elegir');
  }
}
const pintarLibro = () => pintarBanner('libro', el.libroText, el.libroBtn, { vacio: 'Libro de aperturas sin elegir', nombre: 'PowerBook 2025' });

el.megaBtn.addEventListener('click', async () => {
  el.megaBtn.disabled = true;
  try {
    if (mega.estado.pendiente) { if (!await mega.pedirPermiso()) await informar('MegaDatabase', 'No se ha dado permiso para leer los archivos de la base.'); }
    else {
      if (!mega.estado.base) {
        await informar('Elegir la MegaDatabase', 'Elige la carpeta donde está la base, la que contiene el archivo «Mega Database 2025.cbh» (por ejemplo «1.Mega Database 2025 (CBV)»). '
          + 'Entra en ella y pulsa «Seleccionar carpeta»; el navegador pedirá confirmar el acceso de lectura.', 'Elegir carpeta');
      }
      el.megaText.textContent = 'Comprobando la base…';
      const error = await mega.elegir();
      if (error) await informar('MegaDatabase', error);
    }
  } finally { el.megaBtn.disabled = false; pintarMega(); }
});

/** Elige el libro de aperturas (Power Book): de momento solo se guarda su nombre. */
async function elegirLibro() {
  try {
    if ('showOpenFilePicker' in window) {
      const [handle] = await showOpenFilePicker({ types: [{ description: 'Libro de aperturas de ChessBase (*.ctg)', accept: { 'application/octet-stream': ['.ctg'] } }] });
      elegidos.libro = { nombre: handle.name };
    } else {
      const archivo = await new Promise((ok) => {
        const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.ctg' });
        input.onchange = () => ok(input.files[0] ?? null); input.oncancel = () => ok(null); input.click();
      });
      if (!archivo) return;
      elegidos.libro = { nombre: archivo.name };
    }
    await db.guardarAjuste('archivo_libro', elegidos.libro);
  } catch (ex) { if (ex?.name !== 'AbortError') await informar('Libro de aperturas', ex.message); }
}
el.libroBtn.addEventListener('click', async () => { await elegirLibro(); pintarLibro(); });

// ---------- Jugadores a cargar (de 1 a 10; por defecto 5) ----------

const MIN_RANGO = Number(el.rango.min), MAX_RANGO = Number(el.rango.max);
let jugadoresACargar = 5;

function pintarCantidad(animar = false) {
  const v = Math.min(MAX_RANGO, Math.max(MIN_RANGO, Number(el.rango.value) || 5));
  jugadoresACargar = v;
  el.rango.value = String(v);
  el.cantidad.textContent = String(v);
  el.rango.style.setProperty('--p', `${((v - MIN_RANGO) / (MAX_RANGO - MIN_RANGO)) * 100}%`);
  el.rango.setAttribute('aria-valuetext', v === 1 ? '1 jugador' : `${v} jugadores`);
  if (animar) { el.cantidad.classList.remove('pop'); void el.cantidad.offsetWidth; el.cantidad.classList.add('pop'); }
}
el.rango.addEventListener('input', async () => {
  pintarCantidad(true);
  try { await db.guardarAjuste('jugadores_a_cargar', jugadoresACargar); } catch { /* es una comodidad */ }
});

// ---------- Estado de la conexión (barra inferior) ----------

function actualizarRed() {
  const c = navigator.connection;
  let texto, hay = navigator.onLine;
  if (!hay) texto = 'Sin conexión a internet';
  else if (c?.effectiveType) texto = `Red: ${c.effectiveType.toUpperCase()}${c.downlink ? ` | ${c.downlink} Mbps` : ''}`;
  else texto = 'Internet disponible';
  el.redText.textContent = texto;
  el.redText.style.color = hay ? '#2E6ED6' : '#BE382C';
  el.redPunto.style.background = hay ? '#28AA50' : '#D23C32';
}
addEventListener('online', actualizarRed);
addEventListener('offline', actualizarRed);
navigator.connection?.addEventListener?.('change', actualizarRed);
setInterval(actualizarRed, 15000);

// ---------- Datos de demostración (solo con ?demo) ----------

async function sembrarDemo() {
  await db.guardarTorneo({
    nombre: 'Torneo de demostración', url: 'https://chess-results.com/tnr000000.aspx', clave: 'cr:000000',
    jugadores: [
      { rank: 1, name: 'Carlsen, Magnus', federation: 'NOR', rating: 2830, fideId: '1503014', age: '35 años', fideTitle: 'GM', gamesCount: 1240, sources: 'ChessBase 62% · Lichess 38%', status: 'Listo', verificado: true },
      { rank: 2, name: 'Caruana, Fabiano', federation: 'USA', rating: 2795, fideId: '2020009', age: '33 años', fideTitle: 'GM', gamesCount: 860, sources: 'ChessBase 100%', status: 'Importando', verificado: true },
      { rank: 3, name: 'Gukesh, D', federation: 'IND', rating: 2783, fideId: '46616543', age: '20 años', fideTitle: 'GM', gamesCount: 0, sources: '—', status: 'SinPartidas', verificado: true },
      { rank: 4, name: 'Firouzja, Alireza', federation: 'FRA', rating: 2770, fideId: '12573981', age: '23 años', fideTitle: 'GM', gamesCount: 410, sources: 'Lichess 100%', status: 'Listo', verificado: true },
      { rank: 5, name: 'Nakamura, Hikaru', federation: 'USA', rating: 2768, fideId: '2016192', age: '38 años', fideTitle: 'GM', gamesCount: 0, sources: '—', status: 'SinPartidas', verificado: true }
    ]
  });
}

// La ficha avisa cuando cambian las partidas de un jugador (importar, borrar…): las tarjetas se actualizan solas.
try { new BroadcastChannel('chessrival').onmessage = () => { if (!arrastre) cargarVista().catch(() => {}); }; } catch { /* sin BroadcastChannel */ }

// ---------- Arranque ----------

async function iniciar() {
  pintarIconosFijos();
  actualizarBotonCargar();
  actualizarRed();
  try {
    elegidos.libro = await db.leerAjuste('archivo_libro');
    await mega.restaurar().catch(() => {});
    pintarMega(); pintarLibro();
    el.rango.value = String(await db.leerAjuste('jugadores_a_cargar', 5)); pintarCantidad();

    if (new URLSearchParams(location.search).has('demo') && (await db.listarTorneos()).every(t => t.visibles === 0)) await sembrarDemo();

    await refrescarPestanas(await db.leerTorneoActual());
    await cargarVista();
  } catch (ex) {
    mostrarEstado(`No se pudo abrir la base de datos: ${ex.message}`);
  }
}
iniciar();

// Al cambiar de idioma se vuelve a pintar lo que lleva números o textos construidos con el idioma.
window.addEventListener('chessrival-idioma', () => { try { pintarMega(); actualizarRed(); } catch { /* aún no iniciada */ } });
