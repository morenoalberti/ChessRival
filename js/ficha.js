// Ficha del jugador (equivale a FichaJugadorWindow.xaml.cs): cabecera, estadísticas de la FIDE, gráfico del ELO y pestañas.
import { pintarVacios } from './ficha-vacios.js';
import { completarConHistorial } from './fide-historial-datos.js';
import { LOCALE } from './i18n.js';
import { mostrarCargando, quitarCargando } from './cargando.js';
import * as db from './db.js';
import * as fuentes from './fuentes.js';
import { svg, svgTrazo, contenidoBoton, pintarTrazosFijos } from './iconos.js';
import { preguntar, informar, iniciales } from './dialogos.js';
import { urlBandera } from './banderas.js';
import { nombreConTitulo, textoColoresDeLinea } from './nombre-jugador.js';
import { auditarPartidas, filtrarEstudio, inspeccionarPartida } from './estudio-datos.js';
import { montarEstudioUi, textoInformeEstudio, enlazarReferenciasEstudio } from './estudio-ui.js';
import { montarGraficoElo } from './grafico-elo.js';
import { htmlTarjetasFide, htmlEsqueletoFide } from './panel-fide.js';
import { claveJugador, listarPartidas, leerJugadasAnalizadas, ultimoAnalisis, borrarPartidasDe } from './db-partidas.js';
import { cargarLibroAperturas, estadisticasJugador } from './aperturas.js';
import * as Ap from './aperturas.js';
import { figurasHtml, jugadaHtml } from './figuritas.js';
import { montarAyudaTarjetas } from './ayuda-tarjetas.js';
import { calcular as calcularDebilidades, nivel, puntos as puntosTexto } from './debilidades.js';
import { mostrarVistaPrevia, ocultarVistaPrevia } from './vista-previa.js';
import { ArbolUI } from './arbol-ui.js';
import { abrirImportar } from './importar-dialogo.js';
import * as mega from './mega.js';
import { abrirAnalizar } from './analizar-dialogo.js';
import { abrirVentanaVisor } from './ventana-visor.js';
import { abrirConfigIa } from './ia-config-dialogo.js';
import { cargarAjustes, guardarAjustes, configDe, estaLista, preguntar as preguntarIa, construirResumen, cobertura, paraMostrar } from './asistente.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const menosMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;

const PESTANAS = [
  { id: 'resumen', texto: 'Resumen', ayuda: 'Cifras generales, debilidades y aperturas principales', trazo: 'M3,3 H10 V10 H3 Z M14,3 H21 V8 H14 Z M14,12 H21 V21 H14 Z M3,14 H10 V21 H3 Z' },
  { id: 'partidas', texto: 'Partidas', ayuda: 'Lista de todas sus partidas', trazo: 'M8,6 H21 M8,12 H21 M8,18 H21 M3.5,6 H4.5 M3.5,12 H4.5 M3.5,18 H4.5' },
  { id: 'aperturas', texto: 'Aperturas', ayuda: 'Las aperturas que juega y qué tal le van', trazo: 'M12,6 C10,4.5 6.5,4 3,4.5 V19 C6.5,18.5 10,19 12,20.5 C14,19 17.5,18.5 21,19 V4.5 C17.5,4 14,4.5 12,6 Z M12,6 V20.5' },
  { id: 'arbol', texto: 'Árbol', ayuda: 'Qué juega en cada posición, jugada a jugada', trazo: 'M12,4 V10 M12,10 H6 V15 M12,10 H18 V15 M6,15 V20 M18,15 V20' },
  { borrar: true },
  { id: 'debilidades', texto: 'Debilidades', ayuda: 'Sus puntos débiles según Stockfish', trazo: 'M12,3 L22,20 H2 Z M12,9.5 V14 M12,17 H12.1' },
  { id: 'preparacion', texto: 'Preparación', ayuda: 'Qué jugarle con blancas y con negras', trazo: 'M12,3 A9,9 0 1 1 11.99,3 Z M12,8 A4,4 0 1 1 11.99,8 Z M12,12 H12.1' },
  { id: 'informe', texto: 'Informe', ayuda: 'Fiabilidad, rivales, patrones y pruebas', trazo: 'M5,3 H16 L20,7 V21 H5 Z M8,10 H17 M8,14 H17 M8,18 H14' },
  { id: 'entrenamiento', texto: 'Entrenar', ayuda: 'Resolver posiciones confirmadas de sus partidas', trazo: 'M12,3 L15,9 L22,10 L17,15 L18,22 L12,19 L6,22 L7,15 L2,10 L9,9 Z' },
  { id: 'ia', texto: 'IA', ayuda: 'Pregunta a la IA lo que quieras sobre este jugador', trazo: 'M10,5 C10,10 12,12 17,13 C12,14 10,16 10,21 C10,16 8,14 3,13 C8,12 10,10 10,5 Z M19,3 V8 M16.5,5.5 H21.5' }
];
const SUGERENCIAS_IA = [
  '¿Qué aperturas juega con blancas y cómo le va?', '¿Cómo responde a 1.e4 y a 1.d4?', '¿Qué le puedo jugar con negras?',
  '¿Qué le puedo jugar con blancas?', '¿Cuáles son sus puntos débiles?', 'Resume cómo juega en cinco frases'
];

let jugador = null;            // la tarjeta del jugador
let partidas = [];             // sus partidas importadas
let jugadasAnalizadas = [];    // las jugadas analizadas con el motor
let ultimoAnalisisInfo = null; // { motor, profundidad } del último análisis
let arbol = null;              // la pestaña «Árbol»
let megaListo = Promise.resolve();   // la MegaDatabase abriéndose
let filtroColor = '';          // '', 'B' o 'N'
let orden = { columna: null, ascendente: true };
let pestanaActual = 'resumen';
let tituloFide = '';
let auditoria = { total: 0, validas: [], incidencias: [], duplicadas: [], sinFecha: 0, sinRitmo: 0 }, estudioUi = null, informeEstudio = null;

// ---------- Arranque ----------

async function iniciar() {
  const id = Number(new URLSearchParams(location.search).get('id'));
  jugador = id ? await db.obtenerTarjeta(id).catch(() => null) : null;
  if (!jugador) {
    document.body.innerHTML = '<div class="estado-vacio" style="min-height:100vh"><b>No se encuentra este jugador</b><p>Puede que se haya quitado de la lista.</p><a class="btn btn-primario" href="index.html">Volver a ChessRival</a></div>';
    return;
  }

  await cargarLibroAperturas();
  megaListo = mega.restaurar().catch(() => {});     // la ficha es otra página: la base elegida se vuelve a abrir aquí
  pintarTrazosFijos();
  montarCabecera();
  montarPestanas();
  montarAcciones();
  montarAyudaTarjetas();
  estudioUi = montarEstudioUi({ obtenerJugador: () => jugador });
  montarIa();
  conectarArrastre();
  arbol = new ArbolUI($('arbolContenedor'), { nombreJugador: () => nombreConTitulo(jugador, tituloFide), alAbrirPartida: abrirVisor });

  await recargar();
  const inicial = location.hash.slice(1);
  mostrarPestana(PESTANAS.some(p => p.id === inicial) ? inicial : 'resumen', false);

  cargarFoto();
  cargarDatosFide();
}

// ---------- Cabecera ----------

const bandera = () => urlBandera(jugador.federation) ? `<img src="${urlBandera(jugador.federation)}" alt="" onerror="this.remove()">` : '';

function pintarNombre() {
  $('nombre').textContent = nombreConTitulo(jugador, tituloFide);
  $('nombre').title = $('nombre').textContent;
  document.title = `${nombreConTitulo(jugador, tituloFide)} · ChessRival`;
}

function pintarDatos(ficha = null) {
  const partes = [];
  if (ficha?.titulo) partes.push(esc(ficha.titulo));
  if (ficha?.edad) partes.push(esc(ficha.edad));
  partes.push(`${bandera()}${esc(jugador.federation)}`.trim());
  if (jugador.rating > 0) partes.push(`ELO ${jugador.rating}`);
  if (jugador.fideId) partes.push(`FIDE ${esc(jugador.fideId)}`);
  $('datos').innerHTML = partes.filter(Boolean).join('<span aria-hidden="true">·</span>');
}

function montarCabecera() {
  $('iniciales').textContent = iniciales(jugador.name);
  tituloFide = (jugador.fideTitle ?? '');
  pintarNombre();
  pintarDatos(jugador.age && jugador.age !== '—' ? { edad: jugador.age } : null);
  $('volver').addEventListener('click', (e) => {
    if (window.opener && !window.opener.closed) { e.preventDefault(); window.close(); }   // se abrió desde la lista: se cierra y se vuelve a ella
  });
}

async function cargarFoto() {
  if (!jugador.fideId) return;
  try {
    let foto = await db.leerAjuste('foto:' + jugador.fideId);
    if (foto === null) { foto = await fuentes.descargarFoto(jugador.fideId); await db.guardarAjuste('foto:' + jugador.fideId, foto); }
    if (foto) $('avatar').insertAdjacentHTML('beforeend', `<img src="${esc(foto)}" alt="">`);
  } catch { /* la foto es opcional: sin servidor o sin conexión se quedan las iniciales */ }
}

// ---------- Datos de la FIDE: título, edad, resultados y ELO ----------

/** Pide a la FIDE las estadísticas y el historial; su web a veces devuelve la respuesta vacía, así que se reintenta un par de veces. */
async function pedirDatosFide(id) {
  let est = null, his = null;
  for (let intento = 0; intento < 2; intento++) {
    if (!est?.bloques?.length) est = await fuentes.estadisticasFide(id).catch(() => est);
    if (!(his?.length >= 2)) his = await fuentes.historialElo(id).catch(() => null);
    if (est?.bloques?.length && his?.length >= 2) break;
    if (intento < 1) await new Promise(r => setTimeout(r, 3000));
  }
  return { estadisticas: est?.bloques?.length ? est : null, historial: his?.length >= 2 ? his : null };
}

async function cargarDatosFide() {
  if (!jugador.fideId) return;
  const panel = $('fidePanel');
  panel.innerHTML = htmlEsqueletoFide();
  panel.hidden = false;

  // Lo último que se pudo leer de la FIDE queda guardado: si su web falla, las estadísticas salen igualmente.
  const clave = `fide_datos_${jugador.fideId}`;
  const nuevos = await pedirDatosFide(jugador.fideId);
  const guardados = await db.leerAjuste(clave, null).catch(() => null);
  // Los resultados completos de la FIDE ganan a los datos parciales (solo Elo) de Lichess.
  const completoGuardado = guardados?.estadisticas && !guardados.estadisticas.parcial;
  const estadisticas = nuevos.estadisticas && !(nuevos.estadisticas.parcial && completoGuardado) ? nuevos.estadisticas : guardados?.estadisticas ?? nuevos.estadisticas ?? null;
  const historial = nuevos.historial ?? guardados?.historial ?? null;
  if (nuevos.estadisticas || nuevos.historial) db.guardarAjuste(clave, { estadisticas, historial, fecha: Date.now() }).catch(() => {});

  if (estadisticas) {
    tituloFide = estadisticas.titulo ? estadisticas.titulo.replace(/ · /g, '/') : tituloFide;
    jugador.fideTitle = tituloFide;
    pintarNombre();
    pintarDatos(estadisticas);
    pintarAperturas(visibles());
    panel.innerHTML = htmlTarjetasFide(completarConHistorial(estadisticas.bloques, historial), await db.leerAjuste('ficha_orden_fide', ''));
  } else {
    // Sin datos de la FIDE ahora ni guardados: el panel y el ojo se quedan, con el aviso y un botón para volver a intentarlo.
    panel.innerHTML = `<div class="fide-sin-datos"><span>Ahora mismo no se pueden cargar las estadísticas de la FIDE.</span><button type="button" class="btn btn-secundario btn-chico" data-reintentar-fide>${contenidoBoton('cambiar', 'Reintentar')}</button></div>`;
    panel.querySelector('[data-reintentar-fide]').addEventListener('click', cargarDatosFide);
  }
  $('ojoBtn').hidden = false;

  if (historial) {
    $('eloTarjeta').hidden = false;
    montarGraficoElo($('eloGrafico'), historial);
  }
  if (await db.leerAjuste('ficha_elo_arriba', false)) $('estadisticasCuerpo').classList.add('elo-arriba');
}

// El ojo oculta o muestra las estadísticas y el gráfico para tener más sitio abajo.
const OJO = 'M2,12 C5,6.5 8.5,4.5 12,4.5 C15.5,4.5 19,6.5 22,12 C19,17.5 15.5,19.5 12,19.5 C8.5,19.5 5,17.5 2,12 Z M12,9 A3,3 0 1 1 11.99,9 Z';
function aplicarOjo(ocultas) {
  const cuerpo = $('estadisticasCuerpo');
  cuerpo.style.maxHeight = cuerpo.scrollHeight + 'px';
  cuerpo.getBoundingClientRect();
  cuerpo.classList.toggle('oculto', ocultas);
  cuerpo.style.maxHeight = ocultas ? '0px' : cuerpo.scrollHeight + 'px';
  if (!ocultas) setTimeout(() => { if (!cuerpo.classList.contains('oculto')) cuerpo.style.maxHeight = ''; }, 400);
  $('ojoBtn').innerHTML = svgTrazo(ocultas ? OJO + ' M4,20 L20,4' : OJO, 18);
  $('ojoBtn').title = ocultas ? 'Mostrar las estadísticas' : 'Ocultar las estadísticas';
}
$('ojoBtn').innerHTML = svgTrazo(OJO, 18);
$('ojoBtn').addEventListener('click', () => aplicarOjo(!$('estadisticasCuerpo').classList.contains('oculto')));

// ---------- Cambiar de sitio las tarjetas de la FIDE y el gráfico (arrastrando) ----------

function animarMovimiento(elementos, mutar) {
  const antes = new Map(elementos.map(e => [e, e.getBoundingClientRect()]));
  mutar();
  if (menosMovimiento) return;
  for (const [e, r] of antes) {
    const d = e.getBoundingClientRect(), dx = r.left - d.left, dy = r.top - d.top;
    if (dx || dy) e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
}

function conectarArrastre() {
  let origen = null, ultimo = 0;
  const cuerpo = $('estadisticasCuerpo');

  document.addEventListener('dragstart', (e) => {
    const t = e.target.closest?.('.fide-tarjeta:not(.esqueleto), #eloTarjeta');
    if (!t) return;
    origen = t;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', t.dataset.titulo ?? '');
    requestAnimationFrame(() => t.classList.add('arrastrando'));
  });
  document.addEventListener('dragover', (e) => {
    if (!origen) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const destino = e.target.closest?.('.fide-tarjeta:not(.esqueleto), #eloTarjeta');
    if (!destino || destino === origen || performance.now() - ultimo < 250) return;
    ultimo = performance.now();

    if (origen.classList.contains('fide-tarjeta') && destino.classList.contains('fide-tarjeta')) {
      const panel = $('fidePanel'), hijos = [...panel.children];
      animarMovimiento(hijos, () => {
        const i = hijos.indexOf(origen), j = hijos.indexOf(destino);
        panel.insertBefore(origen, i < j ? destino.nextSibling : destino);
      });
    } else {
      // Una tarjeta sobre el gráfico (o al revés): la franja y el gráfico intercambian el sitio.
      animarMovimiento([$('fidePanel'), $('eloTarjeta')], () => cuerpo.classList.toggle('elo-arriba'));
    }
  });
  document.addEventListener('dragend', async () => {
    if (!origen) return;
    origen.classList.remove('arrastrando');
    origen = null;
    try {
      await db.guardarAjuste('ficha_orden_fide', [...$('fidePanel').children].map(t => t.dataset.titulo).join(','));
      await db.guardarAjuste('ficha_elo_arriba', cuerpo.classList.contains('elo-arriba'));
    } catch { /* la disposición es una comodidad */ }
  });
  document.addEventListener('drop', (e) => { if (origen) e.preventDefault(); });
}

// ---------- Pestañas ----------

function montarPestanas() {
  $('pestanasFicha').innerHTML = PESTANAS.map(p => p.borrar
    ? `<button id="borrarBtn" class="btn btn-borrar" type="button" disabled title="Borra todas sus partidas importadas">${svg('papelera', 16)}<span>Borrar partidas</span></button>`
    : `<button class="pestana-ficha" type="button" role="tab" data-pestana="${p.id}" title="${esc(p.ayuda)}" aria-selected="false">${svgTrazo(p.trazo, 16)}<span class="pestana-texto">${p.texto}</span></button>`).join('');
  $('pestanasFicha').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pestana]');
    if (b) mostrarPestana(b.dataset.pestana);
  });
  $('pestanasFicha').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const botones = [...document.querySelectorAll('[data-pestana]')];
    const i = botones.findIndex(b => b.dataset.pestana === pestanaActual) + (e.key === 'ArrowRight' ? 1 : -1);
    const siguiente = botones[(i + botones.length) % botones.length];
    mostrarPestana(siguiente.dataset.pestana);
    siguiente.focus();
  });
  $('borrarBtn').addEventListener('click', borrarPartidas);
}

function mostrarPestana(id, guardarHash = true) {
  pestanaActual = id;
  for (const b of document.querySelectorAll('[data-pestana]')) {
    const activa = b.dataset.pestana === id;
    b.classList.toggle('activa', activa);
    b.setAttribute('aria-selected', activa);
    b.tabIndex = activa ? 0 : -1;
  }
  for (const s of document.querySelectorAll('.seccion')) s.hidden = s.dataset.panel !== id;
  $('borrarBtn').disabled = id !== 'partidas';          // solo tiene sentido viendo la lista
  if (id === 'arbol') arbol?.alMostrar();
  if (guardarHash) history.replaceState(null, '', `#${id}`);
}

// ---------- Datos: partidas, análisis y todo lo que se calcula con ellas ----------

const clave = () => claveJugador(jugador);
const ALCANCE_ESTUDIO = 'Todas las partidas';   // se estudian siempre todas las partidas del jugador
const visibles = () => filtrarEstudio(auditoria.validas);
const apellido = () => nombreConTitulo({ name: jugador.name.split(',')[0].trim() || 'el jugador' }, tituloFide);

async function recargar() {
  partidas = await listarPartidas(clave());
  try {
    for (let i = 0; i < partidas.length; i += 25) {
      const texto = `Revisando partidas: ${Math.min(i + 25, partidas.length)} de ${partidas.length}…`;
      mostrarCargando(document.querySelector('.panel-ficha'), texto);
      for (const p of partidas.slice(i, i + 25)) inspeccionarPartida(p);
      await new Promise(r => setTimeout(r, 0));
    }
  } finally { quitarCargando(document.querySelector('.panel-ficha')); }
  auditoria = auditarPartidas(partidas, jugador);
  jugadasAnalizadas = await leerJugadasAnalizadas(clave());
  ultimoAnalisisInfo = await ultimoAnalisis(clave());
  pintar();
}

const ROJO = 'var(--rojo)', NARANJA = 'var(--naranja)', AZUL = 'var(--azul)';
const colorGravedad = (g) => (g >= 66 ? ROJO : g >= 33 ? NARANJA : AZUL);
const colorPuntuacion = (p) => (p === null ? 'var(--texto)' : p >= 60 ? '#1E8E4F' : p >= 45 ? 'var(--azul)' : 'var(--coral)');

function pintar() {
  const vis = visibles();
  const est = estadisticasJugador(vis);

  informeEstudio = estudioUi.pintar(vis, jugadasAnalizadas, auditoria, ALCANCE_ESTUDIO);
  $('totalText').textContent = est.total;
  $('blancasText').textContent = est.porcentajeBlancas !== null ? `${est.porcentajeBlancas} %` : '—';
  $('negrasText').textContent = est.porcentajeNegras !== null ? `${est.porcentajeNegras} %` : '—';
  $('blancasText').style.color = colorPuntuacion(est.porcentajeBlancas);
  $('negrasText').style.color = colorPuntuacion(est.porcentajeNegras);
  document.querySelector('[data-pestana="partidas"] .pestana-texto').textContent = `Partidas ${est.total}`;
  $('borrarBtn').title = partidas.length ? `Borra sus ${partidas.length} partidas importadas` : 'Borra todas sus partidas importadas';

  pintarTabla(vis);
  pintarAperturas(vis);
  arbol.cargar(vis);
  pintarAnalisis(vis);
  pintarPreparacion(vis);
  pintarVacios({ partidas: partidas.length, analizadas: jugadasAnalizadas.length, importar: () => $('importarBtn').click(), analizar: () => $('analizarBtn').click() });
}

// ---------- Partidas: tabla ----------

function pintarTabla(vis) {
  const enTabla = filtroColor ? vis.filter(p => p.colorJugador === filtroColor) : vis;
  const sufijo = filtroColor === 'B' ? ' con blancas' : filtroColor === 'N' ? ' con negras' : '';
  $('partidasTitulo').textContent = (enTabla.length === 1 ? '1 partida' : `${enTabla.length} partidas`) + sufijo;
  $('partidasVacio').textContent = partidas.length === 0
    ? 'Todavía no hay partidas de este jugador. Pulsa «Importar partidas» y elige un archivo PGN, por ejemplo uno exportado desde ChessBase o YottaChess.'
    : vis.length === 0 ? 'No hay partidas válidas con estos filtros. Cambia el ritmo o el periodo, o revisa las incidencias en Resumen.'
    : enTabla.length === 0 ? 'No hay partidas con ese color.' : '';

  // Resultado: de más a menos puntos del jugador; las sin terminar, al final.
  const clavesOrden = {
    fecha: p => p.fecha.replace(/\?/g, '0'), blancas: p => p.blancas, negras: p => p.negras, apertura: p => p.aperturaNombre, resultado: p => p.puntos ?? -1
  };
  const porColumna = clavesOrden[orden.columna];
  const filas = porColumna ? [...enTabla].sort((a, b) => {
    const x = porColumna(a), y = porColumna(b);
    return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { sensitivity: 'base' })) * (orden.ascendente ? 1 : -1);
  }) : enTabla;

  $('partidasCuerpo').innerHTML = filas.map(p => `<tr data-id="${p.id}" title="${esc(p.eventoDetalle)}">
    <td>${esc(p.fechaMostrada)}</td><td>${esc(nombreConTitulo({ name: p.blancas }, p.tituloBlancas || (p.colorJugador === 'B' ? tituloFide : '')))}</td><td>${p.eloBlancas}</td><td>${esc(nombreConTitulo({ name: p.negras }, p.tituloNegras || (p.colorJugador === 'N' ? tituloFide : '')))}</td><td>${p.eloNegras}</td>
    <td class="centro res-${p.resultadoJugador === 'Victoria' ? 'victoria' : p.resultadoJugador === 'Derrota' ? 'derrota' : 'tablas'}">${esc(p.resultado === '1/2-1/2' ? '½-½' : p.resultado)}</td>
    <td title="${esc(p.aperturaDetalle)}">${esc(p.aperturaNombre)}</td>
    <td class="celda-partida">${figurasHtml(p.comienzo)}</td></tr>`).join('');
  $('partidasVacio').hidden = filas.length > 0;
  document.querySelector('.tabla-caja').style.minHeight = filas.length ? '' : '200px';
  for (const th of document.querySelectorAll('th[data-orden]')) th.dataset.dir = th.dataset.orden === orden.columna ? (orden.ascendente ? '▲' : '▼') : '';
}

const cuerpoTabla = $('partidasCuerpo');
cuerpoTabla.addEventListener('mouseover', (e) => {
  const celda = e.target.closest('.celda-partida');
  if (!celda || celda.contains(e.relatedTarget)) return;
  const p = partidas.find(x => x.id === Number(celda.parentElement.dataset.id));
  if (p) mostrarVistaPrevia(p, tituloFide, e);
});
cuerpoTabla.addEventListener('mouseout', (e) => { const c = e.target.closest('.celda-partida'); if (c && !c.contains(e.relatedTarget)) ocultarVistaPrevia(); });
cuerpoTabla.addEventListener('dblclick', (e) => { const f = e.target.closest('tr'); if (f) abrirVisor(partidas.find(x => x.id === Number(f.dataset.id))); });
window.addEventListener('scroll', ocultarVistaPrevia, true);

function abrirVisor(partida) {
  ocultarVistaPrevia();
  if (!partida) return;
  const ventana = abrirVentanaVisor(partida.id);
  if (!ventana) informar('Ventana bloqueada', 'El navegador ha bloqueado el visor. Permite las ventanas emergentes para este sitio y vuelve a intentarlo.');
}

document.addEventListener('click', (e) => {
  const seg = e.target.closest('.segmento');
  if (seg) {
    filtroColor = seg.dataset.color;
    for (const s of document.querySelectorAll('.segmento')) s.classList.toggle('activa', s === seg);
    pintarTabla(visibles());
    return;
  }
  const th = e.target.closest('th[data-orden]');
  if (th) {
    orden = { columna: th.dataset.orden, ascendente: orden.columna !== th.dataset.orden || !orden.ascendente };
    pintarTabla(visibles());
    return;
  }
  const mini = e.target.closest('[data-aperturas] .mini');
  if (mini) {
    const tarjeta = mini.closest('[data-aperturas]');
    aperturaColor[tarjeta.dataset.aperturas] = mini.dataset.color;
    for (const m of mini.parentElement.children) m.classList.toggle('activa', m === mini);
    pintarAperturas(visibles());
  }
});

// ---------- Aperturas (AperturasControl) ----------

const aperturaColor = { resumen: 'B', completa: 'B' };

/** Las aperturas más jugadas con su resultado; en el resumen, las 3 primeras y «Otras». */
function pintarAperturas(vis) {
  for (const tarjeta of document.querySelectorAll('[data-aperturas]')) {
    const tipo = tarjeta.dataset.aperturas, color = aperturaColor[tipo];
    const nombre = nombreConTitulo(jugador, tituloFide), blancas = color === 'B';
    tarjeta.querySelector('[data-jugadores-apertura]').textContent = `${apellido()} juega con ${blancas ? 'blancas' : 'negras'}`;
    for (const boton of tarjeta.querySelectorAll('.mini')) {
      const etiqueta = `${nombre} con ${boton.dataset.color === 'B' ? 'blancas' : 'negras'}`;
      boton.title = etiqueta;
      boton.setAttribute('aria-label', etiqueta);
    }
    let filas = Ap.resumir(vis, color);
    const max = tipo === 'resumen' ? 4 : null;
    if (max && filas.length > max) {
      const resto = filas.slice(max - 1);
      filas = [...filas.slice(0, max - 1), new Ap.FilaApertura('Otras', resto.reduce((s, f) => s + f.partidas, 0), resto.reduce((s, f) => s + f.puntos, 0))];
    }
    tarjeta.querySelector('[data-vacio]').textContent = filas.length ? '' : `Sin partidas terminadas con ${color === 'B' ? 'blancas' : 'negras'}.`;
    // Cada apertura: su nombre, una barra con lo que la juega respecto a la más frecuente, cuántas partidas y su puntuación (color según le va).
    const masFrecuente = Math.max(1, ...filas.map(f => f.partidas));
    const nivel = (p) => p >= 65 ? 'alta' : p >= 45 ? 'media' : 'baja';
    const cabecera = tipo === 'completa' && filas.length ? `<div class="aper-fila aper-cab"><span>Apertura</span><span title="Cuántas partidas ha jugado con cada apertura">Frecuencia</span><span class="aper-n">Partidas</span><span class="aper-punt" title="Porcentaje de los puntos posibles: victoria 1, tablas ½, derrota 0">Puntuación</span></div>` : '';
    tarjeta.querySelector('[data-filas]').innerHTML = cabecera + filas.map(f =>
      `<div class="aper-fila"><span class="aper-nombre recortar" title="${esc(f.nombre)}">${figurasHtml(f.nombre)}</span><span class="aper-barra"><i style="width:${Math.max(3, Math.round(f.partidas * 100 / masFrecuente))}%"></i></span><span class="aper-n">${f.partidas}</span><span class="aper-punt ${nivel(f.porcentaje)}">${f.porcentaje} %</span></div>`).join('');
    tarjeta.classList.toggle('con-datos', filas.length > 0);
    tarjeta.querySelector('[data-ayuda]').innerHTML = filas.length ? ayudaAperturas(color, filas) : '';
  }
}

/** La ayuda emergente: cómo leer cada línea, con un ejemplo real del jugador. */
function ayudaAperturas(color, filas) {
  const real = filas.find(f => f.nombre !== 'Otras');
  const etiqueta = real?.nombre ?? '1.e4 · Siciliana';
  const partidasN = real?.partidas ?? 10, puntos = real?.puntos ?? 6, porcentaje = real?.porcentaje ?? 60;
  const sep = etiqueta.indexOf(' · ');
  const jug = sep > 0 ? etiqueta.slice(0, sep) : etiqueta, apertura = sep > 0 ? etiqueta.slice(sep + 3) : etiqueta;
  const sinNumero = jug.includes('.') ? jug.slice(jug.lastIndexOf('.') + 1) : jug;
  const conBlancas = color === 'B', yo = apellido();
  const pts = puntos.toLocaleString(LOCALE, { maximumFractionDigits: 1 });
  const lado = Ap.ladoQueLaJuega(etiqueta);
  const nombreTexto = lado === 'N' && conBlancas ? `«${apertura}» es una defensa de las negras: la juega el rival, en respuesta a ${sinNumero}. ${yo} no la elige.`
    : lado === 'N' ? `«${apertura}» es una defensa de las negras: la juega ${yo}, en respuesta a ${sinNumero}.`
    : lado === 'B' && conBlancas ? `«${apertura}» es un sistema de las blancas: lo juega ${yo} a partir de ${sinNumero}.`
    : lado === 'B' ? `«${apertura}» es un sistema de las blancas: lo juega el rival a partir de ${sinNumero}; ${yo} responde.`
    : `«${apertura}» es el nombre de la apertura que resultó. En él participan las jugadas de los dos.`;
  return `
    <div class="ayuda-titulo">Cómo leer cada línea</div>
    <div class="suave ayuda-p">${figurasHtml(real ? `Partidas de ${yo} con ${conBlancas ? 'blancas' : 'negras'}. Cada línea agrupa las que empezaron igual.` : `Todavía no hay partidas de ${yo} con ${conBlancas ? 'blancas' : 'negras'}; esto es un ejemplo inventado.`)}</div>
    <div class="ayuda-ejemplo"><div><small class="azul">IZQUIERDA · la apertura</small><div class="sub-azul">${figurasHtml(etiqueta)}</div></div>
      <div class="der"><small class="coral">DERECHA · los resultados</small><div class="sub-coral">${partidasN} partidas · ${porcentaje} %</div></div></div>
    <div class="ayuda-bloque azul"><b>Izquierda: qué se jugó y quién lo jugó</b>
      <p>${figurasHtml(conBlancas ? `«${jug}» es la primera jugada de la partida. La juega ${yo}, que lleva las blancas.` : `«${jug}» es la primera jugada de la partida. La juega su rival, que lleva las blancas.`)}</p><p>${figurasHtml(nombreTexto)}</p></div>
    <div class="ayuda-bloque coral"><b>Derecha: los resultados</b>
      <p>${figurasHtml(`«${partidasN}» → partidas que ${yo} ha jugado con esa apertura.`)}</p>
      <p>${figurasHtml(`«${porcentaje} %» → su puntuación en esas partidas: ${pts} puntos de ${partidasN} posibles. Victoria = 1 punto, tablas = ½, derrota = 0. No es el porcentaje de victorias.`)}</p></div>
    ${filas.some(f => f.nombre === 'Otras') ? '<div class="suave ayuda-p">«Otras» suma las aperturas que menos ha jugado.</div>' : ''}
    <div class="suave ayuda-p">Solo cuentan partidas terminadas, válidas y únicas. Se respetan los filtros de ritmo y periodo. Los resultados no prueban por sí solos una debilidad de apertura.</div>`;
}

// ---------- Análisis: pérdida media y debilidades ----------

function filaDebilidad(d, conDetalle) {
  const c = colorGravedad(d.gravedad);
  return `<div class="deb-fila ${conDetalle ? 'completa' : ''}">
    <div class="deb-cab"><span class="deb-titulo recortar" title="${esc(d.titulo)}">${figurasHtml(d.titulo)}</span><b style="color:${c}">${nivel(d.gravedad)}</b></div>
    <div class="deb-jugadores">${esc(textoColoresDeLinea({ ...jugador, fideTitle: tituloFide || jugador.fideTitle }, d.colorJugador))}</div>
    ${d.linea ? `<div class="deb-linea">${d.eco ? `<span class="suave">ECO ${esc(d.eco)} · </span>` : ''}Línea: ${jugadaHtml(d.linea)}</div>` : ''}
    <div class="deb-barra"><i style="width:${Math.max(d.gravedad, 4)}%;background:${c}"></i></div>
    ${d.muestra ? `<div class="suave estudio-nota">${d.muestra.partidas} partidas · fiabilidad ${d.muestra.nivel.toLowerCase()}</div>` : ''}
    ${conDetalle ? `<p class="deb-detalle">${figurasHtml(d.detalle)}</p>` : ''}</div>`;
}

function pintarAnalisis(vis) {
  const r = calcularDebilidades(vis, jugadasAnalizadas);
  const motor = ultimoAnalisisInfo ? `${ultimoAnalisisInfo.motor}, profundidad ${ultimoAnalisisInfo.profundidad}` : 'Stockfish';
  $('tarjetaDebilidades').classList.toggle('con-datos', !!r);

  if (!r) {
    $('perdidaText').textContent = '—';
    $('perdidaText').title = '';
    $('debResumenVacio').hidden = false;
    $('debResumen').innerHTML = '';
    $('debCabecera').textContent = 'Todavía no hay análisis. Pulsa «Analizar» para que Stockfish revise sus partidas.';
    $('debLista').innerHTML = '';
    $('ayudaDebilidades').innerHTML = '';
    return;
  }
  $('perdidaText').textContent = puntosTexto(r.perdidaMedia);
  $('perdidaText').title = 'Puntos que pierde de media por jugada respecto a la mejor opción del motor, como los mide Stockfish (1 punto equivale a un peón).';
  $('debResumenVacio').hidden = true;
  $('debCabecera').textContent = `Basado en ${r.partidasAnalizadas} partidas analizadas (${r.jugadas} jugadas, ${motor}). Las comparaciones son con su propia media, no con otros jugadores.`;
  $('debResumen').innerHTML = r.debilidades.length ? r.debilidades.slice(0, 3).map(d => filaDebilidad(d, false)).join('')
    : '<p class="vacio-texto">No se ha detectado ningún punto débil claro con las partidas analizadas.</p>';
  $('debLista').innerHTML = r.debilidades.map(d => filaDebilidad(d, true)).join('');
  $('ayudaDebilidades').innerHTML = `
    <div class="ayuda-titulo">Cómo leer cada debilidad</div>
    <div class="suave ayuda-p">Stockfish ha revisado ${r.partidasAnalizadas} partidas suyas (${r.jugadas} jugadas, ${esc(motor)}) y compara cada jugada con la mejor que veía el motor.</div>
    <div class="ayuda-ejemplo"><div><small class="azul">IZQUIERDA · qué debilidad</small><div class="sub-azul">Pierde más en el medio juego</div></div>
      <div class="der"><small class="coral">DERECHA · gravedad</small><div class="sub-coral" style="color:var(--naranja)">Media</div></div></div>
    <div class="ayuda-bloque azul"><b>Izquierda: qué debilidad es</b>
      <p>«Pierde más en…»: la fase de la partida (apertura, medio juego o final) donde pierde más por jugada.</p><p>«Errores graves»: jugadas que le cuestan 3 puntos o más.</p>
      <p>«No convierte las ventajas»: ventaja de al menos 2 puntos sostenida en dos decisiones próximas, sin ganar la partida.</p><p>«Juega peor con blancas/negras»: requiere al menos 5 partidas independientes y 30 jugadas analizadas con cada color.</p>
      <p>«Resultados a revisar»: al menos 5 partidas; se contrasta con los ELO históricos cuando hay datos suficientes.</p></div>
    <div class="ayuda-bloque coral"><b>Derecha y barra: la gravedad</b>
      <p>La barra va de 0 a 100: cuanto más larga, peor. «Alta» (rojo), «Media» (naranja) o «Baja» (azul) es lo mismo dicho con palabras.</p>
      <p>Compara al jugador con su propia media, no con otros jugadores. No es un porcentaje de partidas.</p></div>
    <div class="suave ayuda-p">Los puntos son los de Stockfish: 1 punto equivale a un peón.</div>
    <div class="suave ayuda-p">Aquí salen las tres más graves; en la pestaña Debilidades está la lista completa con el detalle de cada una.</div>`;
}

// ---------- Preparación: qué jugarle ----------

function pintarPreparacion(vis) {
  $('prepIntro').textContent = vis.length === 0
    ? 'Todavía no hay partidas de este jugador: importa sus partidas para obtener recomendaciones.'
    : `Preparación contra ${apellido()} con ${vis.length} partidas válidas y únicas. Se agrupan posiciones iguales aunque procedan de órdenes distintos y se exige un mínimo de 5 partidas para sugerir una revisión.`;

  // Con blancas eliges la primera jugada y él defiende (juega con negras); con negras es al revés.
  estudioUi.plan(informeEstudio);

  const r = calcularDebilidades(vis, jugadasAnalizadas);
  $('prepDebilidades').innerHTML = '<h3 class="prep-titulo"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 22 20H2L12 3Zm0 6.5V14m0 3h.01"/></svg>Puntos débiles para aprovechar</h3>' + (!r || !r.debilidades.length
    ? `<p class="prep-texto">${!r ? 'Pulsa «Analizar» para que Stockfish revise sus partidas y aquí aparezcan sus puntos débiles.' : 'No se ha detectado ningún punto débil claro con las partidas analizadas.'}</p>`
    : r.debilidades.slice(0, 3).map(d => filaDebilidad(d, true)).join(''));
}

// ---------- Acciones de la cabecera ----------

async function yottaChess() {
  if (!jugador.fideId) { await informar('Sin ID FIDE', 'Este jugador no tiene ID FIDE, así que no hay nada que copiar.'); return; }
  try { await navigator.clipboard.writeText(jugador.fideId); } catch { /* sin permiso para el portapapeles: se abre igualmente */ }
  window.open('https://www.yottachess.com/', '_blank', 'noopener');
  const t = $('yottaTexto');
  if (t) { t.textContent = `ID ${jugador.fideId} copiado`; setTimeout(() => { t.textContent = 'YottaChess o PGN'; }, 3500); }
}

function montarAcciones() {
  $('yottaBtn').innerHTML = contenidoBoton('enlace', '<span id="yottaTexto">YottaChess o PGN</span>');
  $('importarBtn').innerHTML = contenidoBoton('descargar', 'Importar partidas');
  $('analizarBtn').innerHTML = contenidoBoton('barras', 'Analizar');
  $('yottaBtn').addEventListener('click', yottaChess);
  $('importarBtn').addEventListener('click', async () => { await megaListo; if (await abrirImportar(jugador, { alAbrirYotta: yottaChess })) await recargar(); });
  $('analizarBtn').addEventListener('click', async () => { if (await abrirAnalizar(jugador, { muestra: visibles() })) await recargar(); });
}

async function borrarPartidas() {
  if (!partidas.length) { await informar('Borrar partidas', 'Este jugador no tiene partidas importadas.'); return; }
  const ok = await preguntar('Borrar partidas', `¿Borrar las ${partidas.length} partidas de ${nombreConTitulo(jugador)}? Se perderán también sus análisis.`, { textoSi: 'Borrar', peligro: true });
  if (!ok) return;
  await borrarPartidasDe(clave());
  await recargar();
}

// ---------- Asistente de IA ----------

let iaHistorial = [], iaPreguntando = false;

async function actualizarModeloIa() {
  try {
    const c = configDe(await cargarAjustes());
    $('iaModelo').textContent = estaLista(c) ? `Modelo: ${c.modelo}` : 'Sin configurar';
  } catch { $('iaModelo').textContent = ''; }
}

async function configurarIa() {
  const nuevos = await abrirConfigIa(await cargarAjustes());
  if (!nuevos) return false;
  await guardarAjustes(nuevos);
  await actualizarModeloIa();
  return estaLista(configDe(nuevos));
}

function montarIa() {
  $('iaNueva').innerHTML = contenidoBoton('mas', 'Nueva conversación');
  $('iaConfig').innerHTML = svgTrazo('M12,15 A3,3 0 1 0 12,9 A3,3 0 1 0 12,15 M19.4,15 A1.7,1.7 0 0 0 19.7,16.8 L19.8,16.9 A2,2 0 1 1 17,19.7 L16.9,19.6 A1.7,1.7 0 0 0 15,19.4 A1.7,1.7 0 0 0 14,21 V21 A2,2 0 1 1 10,21 V20.9 A1.7,1.7 0 0 0 9,19.4 A1.7,1.7 0 0 0 7.2,19.7 L7.1,19.8 A2,2 0 1 1 4.3,17 L4.4,16.9 A1.7,1.7 0 0 0 4.6,15 A1.7,1.7 0 0 0 3,14 H3 A2,2 0 1 1 3,10 H3.1 A1.7,1.7 0 0 0 4.6,9 A1.7,1.7 0 0 0 4.3,7.2 L4.2,7.1 A2,2 0 1 1 7,4.3 L7.1,4.4 A1.7,1.7 0 0 0 9,4.6 H9 A1.7,1.7 0 0 0 10,3 V3 A2,2 0 1 1 14,3 V3.1 A1.7,1.7 0 0 0 15,4.6 A1.7,1.7 0 0 0 16.8,4.3 L16.9,4.2 A2,2 0 1 1 19.7,7 L19.6,7.1 A1.7,1.7 0 0 0 19.4,9 V9 A1.7,1.7 0 0 0 21,10 H21 A2,2 0 1 1 21,14 H20.9 A1.7,1.7 0 0 0 19.4,15 Z', 17);
  $('iaSugerencias').innerHTML = SUGERENCIAS_IA.map(s => `<button type="button" class="btn btn-secundario">${esc(s)}</button>`).join('');
  actualizarModeloIa();

  const conversacion = $('iaConversacion');
  const inicio = conversacion.innerHTML;
  const anadir = (html, clase) => {
    const m = document.createElement('div');
    m.className = `ia-mensaje ${clase}`;
    m.innerHTML = html;
    conversacion.appendChild(m);
    conversacion.scrollTo({ top: conversacion.scrollHeight, behavior: menosMovimiento ? 'auto' : 'smooth' });
    return m;
  };

  async function enviar(pregunta) {
    pregunta = pregunta.trim();
    if (!pregunta || iaPreguntando) return;
    let config = configDe(await cargarAjustes());
    if (!estaLista(config)) {
      if (!await configurarIa()) return;
      config = configDe(await cargarAjustes());
    }
    $('iaPregunta').value = '';
    anadir(esc(pregunta), 'usuario');
    const respuesta = anadir('Pensando…', 'asistente pensando');
    iaPreguntando = true;
    $('iaEnviar').disabled = true;
    iaHistorial.push(['user', pregunta]);
    try {
      const vis = visibles();
      const informeConPruebas = textoInformeEstudio(jugador, informeEstudio, auditoria, ALCANCE_ESTUDIO);
      const texto = (await preguntarIa(config, construirResumen(jugador, vis, jugadasAnalizadas) + '\n\nINFORME COMPLETO CON EVIDENCIAS Y LIMITACIONES:\n' + informeConPruebas, iaHistorial)) || 'El servicio no devolvió ninguna respuesta.';
      iaHistorial.push(['assistant', texto]);
      respuesta.classList.remove('pensando');
      const conPruebas = enlazarReferenciasEstudio(figurasHtml(paraMostrar(texto)), vis, informeEstudio.evidencias);
      respuesta.innerHTML = `${conPruebas.html}<div class="ia-cobertura">${esc(cobertura(vis))} Referencias comprobadas: ${conPruebas.verificadas}.${conPruebas.fuera ? ` ${conPruebas.fuera} referencias no corresponden a esta muestra o posición.` : ''} Modelo: ${esc(config.modelo)}.</div>`;
    } catch (ex) {
      iaHistorial.pop();                                // la pregunta no se contestó: no se arrastra en la conversación
      respuesta.classList.remove('pensando');
      respuesta.classList.add('error');
      respuesta.textContent = ex.message;
    } finally {
      iaPreguntando = false;
      $('iaEnviar').disabled = false;
      conversacion.scrollTo({ top: conversacion.scrollHeight });
      $('iaPregunta').focus();
    }
  }
  $('iaForm').addEventListener('submit', (e) => { e.preventDefault(); enviar($('iaPregunta').value); });
  $('iaSugerencias').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) enviar(b.textContent); });
  $('iaNueva').addEventListener('click', () => { if (!iaPreguntando) { iaHistorial = []; conversacion.innerHTML = inicio; } });
  $('iaConfig').addEventListener('click', configurarIa);
}

iniciar();

window.addEventListener('chessrival-idioma', () => { try { if (jugador) { pintar(); } } catch { /* aún no cargada */ } });
