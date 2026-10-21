// Visor de una partida (VisorPartidaWindow.xaml.cs): tablero para seguirla jugada a jugada hasta el final, con Stockfish analizando en vivo la posición
// que se ve (evaluación, barra y cinco mejores variantes). Se pueden jugar variantes propias, anotar jugadas y analizar la partida entera.
import { LOCALE, decimal, t as tr } from './i18n.js';
import { Chess } from './vendor/chess.js';
import * as db from './db.js';
import { obtenerPartida, cargarEdicion, guardarEdicion } from './db-partidas.js';
import { leerPgn, jugadasDe } from './pgn.js';
import { Tablero } from './tablero.js';
import { convertirFiguras, figurasHtml } from './figuritas.js';
import { informar, preguntarTres } from './dialogos.js';
import { elegirOpcionJugada, pedirTexto, mostrarConclusiones, abrirMenu, elegirVariante } from './visor-dialogos.js';
import { MotorUci, NOMBRE_MOTOR, PARALELO, simbolo as simboloVentaja } from './motor.js';
import { calcularPrecisiones, calcularErrores, resumenErrores, construirConclusiones, corto, PROFUNDIDAD_ANALISIS, TOPE } from './visor-analisis.js';
import { puntos } from './debilidades.js';
import { FEN_INICIAL } from './arbol.js';
import { posicionesDeVariante } from './variantes-motor.js';
import { nombreConTitulo } from './nombre-jugador.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LINEAS_DE_ANALISIS = 5;

// ---------- Estado ----------

let partida = null, tituloJugador = '';
let fens = [], sans = [], casillas = [];                // la línea que se ve: posición tras 0…n jugadas, la jugada y sus casillas
let fensP = [], sansP = [], casillasP = [], ucisP = []; // la partida (con los cambios del usuario) y, por separado, sus variantes
let ucisOriginal = '';
let variantes = [];                                     // { desvio, plegada, ucis, sans, casillas, fens, fichas }
let varActual = null;
let blancasEmpiezan = true, numeroInicial = 1, avisoPartida = null;
let etiquetaBlancas = '?', etiquetaNegras = '?', nombreBlancas = '?', nombreNegras = '?';
let ply = 0, girado = false;
let tablero = null;
let seleccion = null, destinos = [];
let ocupado = false;                                    // un cuadro abierto: no se atienden más jugadas

const notas = new Map();                                // ruta → Set de símbolos
const previos = new Map(), posteriores = new Map();     // ruta → { texto, color }
const diagramas = new Set();
let errores = new Map();                                // ply → { ply, blancas, marca, perdida, mejor }

const blancasMueven = (p) => (p % 2 === 1) === blancasEmpiezan;
const numeroDe = (p) => numeroInicial + (blancasEmpiezan ? Math.trunc((p - 1) / 2) : Math.trunc(p / 2));
const uciDe = (m) => m.from + m.to + (m.promotion ?? '');
const rutaDe = (ucis, cuantas) => ucis.slice(0, cuantas).join(' ');
const ucisDeLaLinea = () => (varActual === null ? ucisP : [...ucisP.slice(0, varActual.desvio), ...varActual.ucis]);

// ---------- Partida ----------

function prepararPartida() {
  const leida = leerPgn(partida.pgn)[0];
  const blancas = leida?.cab('White') || '?', negras = leida?.cab('Black') || '?';
  const tB = partida.tituloBlancas || (partida.colorJugador === 'B' ? tituloJugador : ''), tN = partida.tituloNegras || (partida.colorJugador === 'N' ? tituloJugador : '');
  const eloB = leida?.cab('WhiteElo') ? ` (${leida.cab('WhiteElo')})` : '', eloN = leida?.cab('BlackElo') ? ` (${leida.cab('BlackElo')})` : '';
  nombreBlancas = nombreConTitulo({ name: blancas }, tB); nombreNegras = nombreConTitulo({ name: negras }, tN);
  etiquetaBlancas = `${nombreBlancas}${eloB}`; etiquetaNegras = `${nombreNegras}${eloN}`;
  document.title = `Partida · ${nombreBlancas} – ${nombreNegras}`;

  const fen = leida?.cab('FEN') || FEN_INICIAL;
  const campos = fen.split(' ');
  blancasEmpiezan = campos.length < 2 || campos[1] === 'w';
  numeroInicial = campos.length > 5 && parseInt(campos[5], 10) ? Math.max(1, parseInt(campos[5], 10)) : 1;

  let t;
  try { t = new Chess(fen); } catch { avisoPartida = 'No se pudo leer la partida.'; fens = [FEN_INICIAL]; return; }
  fensP = [t.fen()];
  if (!leida) { avisoPartida = 'No se pudo leer la partida.'; return; }
  for (const san of jugadasDe(leida.jugadas)) {
    let m;
    try { m = t.move(san); } catch { avisoPartida = `La partida se corta en la jugada ${sansP.length + 1}: no se ha podido leer «${san}».`; break; }
    sansP.push(m.san); casillasP.push([m.from, m.to]); ucisP.push(uciDe(m)); fensP.push(t.fen());
  }
}

/** Juega «ucis» desde una posición y devuelve lo que sale de ello; si alguna deja de ser legal, la lista se corta ahí. */
function derivar(fenInicial, ucis) {
  const t = new Chess(fenInicial);
  const f = [], s = [], c = [];
  for (const uci of ucis) {
    let m;
    try { m = t.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { break; }
    s.push(m.san); c.push([m.from, m.to]); f.push(t.fen());
  }
  ucis.splice(s.length);
  return { fens: f, sans: s, casillas: c };
}

/** Vuelve a calcular la partida y todas las variantes a partir de sus jugadas UCI. */
function rehacerTodo() {
  const inicial = fensP[0];
  const d = derivar(inicial, ucisP);
  fensP = [inicial, ...d.fens]; sansP = d.sans; casillasP = d.casillas;
  for (const v of [...variantes]) {
    if (v.desvio > sansP.length) { variantes = variantes.filter(x => x !== v); continue; }
    const dv = derivar(fensP[v.desvio], v.ucis);
    v.fens = dv.fens; v.sans = dv.sans; v.casillas = dv.casillas;
    if (v.sans.length === 0) variantes = variantes.filter(x => x !== v);
  }
}

/** Pone como línea visible la partida (null) o una variante. */
function usarLinea(v) {
  varActual = v;
  if (v === null) { fens = [...fensP]; sans = [...sansP]; casillas = [...casillasP]; }
  else {
    fens = [...fensP.slice(0, v.desvio + 1), ...v.fens];
    sans = [...sansP.slice(0, v.desvio), ...v.sans];
    casillas = [...casillasP.slice(0, v.desvio), ...v.casillas];
  }
}

/** Al cambiar la partida desde la jugada «p», lo que dependía de lo que venía después deja de valer. */
function quitarPosteriores(p) {
  variantes = variantes.filter(x => x.desvio <= p);
  for (const k of [...errores.keys()]) if (k > p) errores.delete(k);
}

// ---------- Planilla ----------

const SIMBOLOS_CALIDAD = ['!!', '!', '!?', '?!', '?', '??'];
const SIMBOLOS_VALORACION = ['+−', '±', '⩲', '=', '∞', '⩱', '∓', '−+'];
const SIMBOLOS_EXTRA = ['↑', '⇄'];
const AYUDA_SIMBOLOS = {
  '!!': 'Jugada brillante', '!': 'Buena jugada', '!?': 'Jugada interesante', '?!': 'Jugada dudosa', '?': 'Error', '??': 'Error grave',
  '+−': 'Ventaja decisiva de las blancas', '±': 'Ventaja clara de las blancas', '⩲': 'Ligera ventaja de las blancas', '=': 'Posición igualada',
  '∞': 'Posición poco clara', '⩱': 'Ligera ventaja de las negras', '∓': 'Ventaja clara de las negras', '−+': 'Ventaja decisiva de las negras',
  '↑': 'Iniciativa', '⇄': 'Contrajuego'
};

/** La jugada con sus símbolos: «♞f3!», «e4 ±»… Si el usuario no le ha puesto calidad se usa la marca del análisis. */
function textoFicha(san, ruta, marcaMotor) {
  const nota = notas.get(ruta);
  const calidad = nota ? SIMBOLOS_CALIDAD.find(s => nota.has(s)) : null;
  let texto = convertirFiguras(san) + (calidad ?? marcaMotor);
  if (!nota) return texto;
  for (const e of SIMBOLOS_EXTRA.filter(s => nota.has(s))) texto += ' ' + e;
  for (const v of SIMBOLOS_VALORACION.filter(s => nota.has(s))) texto += ' ' + v;
  return texto;
}

const nuevoFlujo = () => Object.assign(document.createElement('div'), { className: 'flujo' });
function nuevaLinea(raiz) { const l = { raiz, actual: nuevoFlujo(), grupo: null }; raiz.appendChild(l.actual); return l; }
/** Un bloque (diagrama, variante) corta el tramo y la planilla sigue en otro. */
function corte(linea, bloque) { linea.raiz.appendChild(bloque); linea.actual = nuevoFlujo(); linea.grupo = null; linea.raiz.appendChild(linea.actual); }

function comentario(c) {
  const e = document.createElement('span');
  e.className = `comentario ${c.color}`;
  e.innerHTML = figurasHtml(c.texto);
  return e;
}

let fichas = [];                                         // las fichas de la partida, en orden

/** Un diagrama pequeño de la posición, como el de ChessVision: pulsarlo lleva a esa jugada. */
function bloqueDiagrama(fen, activar, ruta) {
  const marco = document.createElement('div');
  marco.className = 'diagrama';
  const t = new Tablero(marco, { casilla: 18 });
  t.mostrar(fen, null, null, girado);
  marco.addEventListener('click', () => { detener(); activar(); });
  marco.addEventListener('contextmenu', (e) => { e.preventDefault(); abrirMenu(e.clientX, e.clientY, [{ texto: 'Quitar diagrama', accion: () => alternarDiagrama(ruta) }]); });
  return marco;
}

/** Pone una jugada en la planilla: su texto previo, el número, la jugada (pulsable, con su menú), el texto posterior y el diagrama.
 *  Devuelve la ficha y si lo que viene después necesita repetir el número. */
function ponerJugada(linea, p, san, ruta, fen, cas, activar, v, k, primera) {
  const previo = previos.get(ruta);
  if (previo) { linea.actual.appendChild(comentario(previo)); linea.grupo = null; }
  // Cada cápsula reúne el número, la jugada blanca y su respuesta negra.
  // Un comentario, diagrama o variante interrumpe el par y obliga a repetir el número.
  if (blancasMueven(p) || primera || !linea.grupo) {
    linea.grupo = document.createElement('span');
    linea.grupo.className = 'grupo-jugada';
    linea.actual.appendChild(linea.grupo);
    const num = document.createElement('span');
    num.className = 'num-jugada';
    num.textContent = blancasMueven(p) ? `${numeroDe(p)}.` : `${numeroDe(p)}...`;
    linea.grupo.appendChild(num);
  }

  const ficha = document.createElement('span');
  ficha.className = 'ficha-jugada';
  ficha.innerHTML = figurasHtml(textoFicha(san, ruta, ''));
  ficha.addEventListener('click', () => { detener(); activar(); });
  // Solo al entrar: al pasar de una jugada a la siguiente no se vuelve un instante a la fijada (eso hacía parpadear el tablero).
  ficha.addEventListener('mouseenter', () => mostrarPosicion(fen, cas));
  ficha.addEventListener('mouseleave', programarRestauracion);
  ficha.addEventListener('contextmenu', (e) => { e.preventDefault(); abrirMenu(e.clientX, e.clientY, construirMenu(ruta, activar, v, k, p)); });
  linea.grupo.appendChild(ficha);

  let corta = false;
  const posterior = posteriores.get(ruta);
  if (posterior) { linea.actual.appendChild(comentario(posterior)); linea.grupo = null; corta = true; }
  if (diagramas.has(ruta)) { corte(linea, bloqueDiagrama(fen, activar, ruta)); corta = true; }
  return { ficha, corta };
}

/** La lista de jugadas, como texto que fluye: «1.» e4 e5 «2.» ♞f3 … Cada jugada es pulsable. Las variantes que ha jugado el usuario van
 *  sangradas, en su propia línea, justo después de la jugada de la partida que sustituyen. */
function construirLista() {
  const lista = $('listaJugadas');
  const linea = nuevaLinea(lista);
  let tras = false;
  for (let i = 0; i < sansP.length; i++) {
    const p = i + 1;
    const { ficha, corta } = ponerJugada(linea, p, sansP[i], rutaDe(ucisP, p), fensP[p], casillasP[i],
      () => { if (varActual) usarLinea(null); ir(p); }, null, i, i === 0 || tras);
    tras = false;
    fichas.push(ficha);
    tras = tras || corta;
    for (const v of variantes.filter(x => x.desvio === i)) { anadirVariante(linea, v); tras = true; }
  }
  for (const v of variantes.filter(x => x.desvio === sansP.length && sansP.length > 0)) anadirVariante(linea, v);

  // Como en ChessBase: el resultado al final de la última jugada.
  if (sansP.length > 0 && ['1-0', '0-1', '1/2-1/2'].includes(partida.resultado))
    linea.actual.insertAdjacentHTML('beforeend', `<span class="resultado-fin">${partida.resultado === '1/2-1/2' ? '½-½' : partida.resultado}</span>`);
  if (avisoPartida) lista.insertAdjacentHTML('beforeend', `<div class="aviso-partida">${esc(avisoPartida)}</div>`);
}

/** La variante, sangrada y en su línea, con un «−» a la izquierda que la pliega: «( 19.♖xf6 ♕e7 20.… )». */
function anadirVariante(padre, v) {
  v.fichas = [];
  const fila = document.createElement('div');
  fila.className = 'variante';
  const signo = document.createElement('span');
  signo.className = 'variante-signo';
  signo.textContent = v.plegada ? '+' : '−';
  signo.title = v.plegada ? 'Desplegar la variante' : 'Plegar la variante';
  signo.addEventListener('click', (e) => { e.stopPropagation(); v.plegada = !v.plegada; reconstruirLista(); pintarSeleccion(); });
  const pila = document.createElement('div');
  fila.append(signo, pila);
  corte(padre, fila);

  const linea = nuevaLinea(pila);
  linea.actual.insertAdjacentHTML('beforeend', '<span class="variante-paren">(</span>');
  let tras = false;
  for (let k = 0; k < v.sans.length; k++) {
    if (v.plegada && k > 0) { linea.actual.insertAdjacentHTML('beforeend', '<span class="variante-paren" style="margin-left:4px">…</span>'); break; }
    const p = v.desvio + k + 1;
    const { ficha, corta } = ponerJugada(linea, p, v.sans[k], rutaDe([...ucisP.slice(0, v.desvio), ...v.ucis], p), v.fens[k], v.casillas[k],
      () => { usarLinea(v); ir(v.desvio + k + 1); }, v, k, k === 0 || tras);
    tras = corta;
    v.fichas.push(ficha);
  }
  linea.actual.insertAdjacentHTML('beforeend', '<span class="variante-paren" style="margin:3px 2px 0 0">)</span>');
}

function reconstruirLista() {
  $('listaJugadas').innerHTML = '';
  fichas = [];
  construirLista();
  if (errores.size) marcarErroresEnLista();
}

// ---------- Menú de una jugada (botón derecho) ----------

function construirMenu(ruta, activar, v, k, p) {
  const restantes = v ? v.ucis.length - (k + 1) : ucisP.length - p;
  const submenu = (simbolos) => simbolos.map(s => ({
    texto: `${s}   ${AYUDA_SIMBOLOS[s]}`, marcado: notas.get(ruta)?.has(s), accion: () => { activar(); alternarSimbolo(s); }
  }));
  return [
    { texto: 'Borrar variante', accion: () => borrarVariante(v), activo: !!v },
    { texto: 'Borrar jugadas restantes', accion: () => borrarRestantes(v, v ? k + 1 : p), activo: restantes > 0 },
    { texto: 'Promocionar variante', accion: () => promocionarVariante(v), activo: !!v },
    { texto: 'Variante principal', accion: () => promocionarVariante(v), activo: !!v },
    { separador: true },
    { texto: 'Texto previo', accion: () => editarTexto(true, ruta) },
    { texto: 'Texto posterior', accion: () => editarTexto(false, ruta) },
    { texto: '{!, ?, …}', submenu: submenu(SIMBOLOS_CALIDAD) },
    { texto: '+−, =, …', submenu: submenu([...SIMBOLOS_VALORACION, ...SIMBOLOS_EXTRA]) },
    { separador: true },
    { texto: diagramas.has(ruta) ? 'Quitar diagrama' : 'Insertar diagrama', accion: () => alternarDiagrama(ruta) }
  ];
}

async function editarTexto(previo, ruta) {
  const textos = previo ? previos : posteriores;
  const actual = textos.get(ruta);
  const nuevo = await pedirTexto(previo ? 'Texto previo' : 'Texto posterior', actual?.texto ?? '', actual?.color ?? 'negro');
  if (!nuevo) return;
  if (!nuevo.texto.trim()) textos.delete(ruta); else textos.set(ruta, { texto: nuevo.texto.trim(), color: nuevo.color });
  modificado();
  reconstruirLista();
  pintarSeleccion();
}

function alternarDiagrama(ruta) {
  if (!diagramas.delete(ruta)) diagramas.add(ruta);
  modificado();
  reconstruirLista();
  pintarSeleccion();
}

/** Quita las jugadas de una línea desde la posición «desde» (cuántas jugadas se conservan). Con «v» null es la partida; lo que dependía de lo que
 *  se quita (variantes y errores) se quita también. */
function borrarRestantes(v, desde) {
  if (!v) {
    ucisP.splice(desde);
    variantes = variantes.filter(x => x.desvio < desde);
    for (const k of [...errores.keys()]) if (k > desde) errores.delete(k);
  } else v.ucis.splice(desde);
  trasCambiarLineas();
}

/** La variante pasa a ser la línea de la partida, y la continuación que había queda como variante. */
function promocionarVariante(v) {
  const desvio = v.desvio;
  const anterior = { desvio, plegada: false, ucis: ucisP.slice(desvio), sans: [], casillas: [], fens: [], fichas: [] };
  const nueva = [...ucisP.slice(0, desvio), ...v.ucis];
  usarLinea(null);
  variantes = variantes.filter(x => x !== v);
  quitarPosteriores(desvio);
  ucisP = nueva;
  if (anterior.ucis.length) variantes.push(anterior);
  trasCambiarLineas();
}

function trasCambiarLineas() {
  modificado();
  rehacerTodo();
  usarLinea(varActual && variantes.includes(varActual) ? varActual : null);
  reconstruirLista();
  ir(Math.min(ply, sans.length));
}

function borrarVariante(v) {
  const p = varActual === v ? Math.min(ply, v.desvio) : ply;
  if (varActual === v) usarLinea(null);
  variantes = variantes.filter(x => x !== v);
  modificado();
  reconstruirLista();
  ir(p);
}

function volverALaPartida() {
  if (!varActual) return;
  const p = Math.min(ply, varActual.desvio);
  usarLinea(null);
  ir(p);
}

// ---------- Navegación ----------

function ir(nuevo) {
  cancelarPreviaMotor(false);
  clearTimeout(restaurar);
  ply = Math.min(Math.max(nuevo, 0), sans.length);
  seleccion = null; destinos = [];
  ponerNombres();
  mostrarTablero(ply, true);

  if (varActual?.plegada && ply > varActual.desvio + 1) { varActual.plegada = false; reconstruirLista(); }   // se ha llegado a una jugada que estaba oculta
  const elegida = pintarSeleccion();
  elegida?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  const texto = $('posicionText');
  if (ply === 0) texto.innerHTML = 'Posición inicial';
  else {
    const fallo = errorEn(ply);
    texto.innerHTML = figurasHtml(
      (varActual && ply > varActual.desvio ? 'Tu variante · ' : '') +
      `Jugada ${ply} de ${sans.length}:  ${numeroDe(ply)}${blancasMueven(ply) ? '.' : '...'}${convertirFiguras(sans[ply - 1])}` +
      (fallo ? `${fallo.marca}   pierde ${puntos(fallo.perdida)}` + (fallo.mejor ? `   ·   mejor era ${convertirFiguras(fallo.mejor)}` : '') : '') +
      (ply === sans.length && !varActual ? '   ·   fin de la partida' : ''));
  }

  // Al cambiar de posición no se vacía la tarjeta del motor ni se pone la barra a la mitad: se mantiene lo anterior, atenuado, hasta que el
  // motor da su primera evaluación de la nueva posición.
  if (motor && $('motorCheck').checked) $('lineasMotor').style.opacity = '.4';
  reiniciarAnalisis();
}

/** La calificación de una jugada de la partida (solo vale para la parte que comparte la línea que se ve). */
const errorEn = (p) => ((!varActual || p <= varActual.desvio) ? errores.get(p) ?? null : null);

/** Marca en la planilla la jugada elegida y devuelve su ficha. */
function pintarSeleccion() {
  let elegida = null;
  fichas.forEach((f, i) => {
    const sel = !varActual && i + 1 === ply;
    if (sel) elegida = f;
    f.classList.toggle('seleccionada', sel);
    const error = errores.get(i + 1);
    f.style.color = sel ? '' : error ? (error.marca === '??' ? 'var(--rojo)' : error.marca === '?' ? 'var(--naranja)' : 'var(--azul)') : '';
  });
  for (const v of variantes) (v.fichas ?? []).forEach((f, k) => {
    const sel = varActual === v && v.desvio + k + 1 === ply;
    if (sel) elegida = f;
    f.classList.toggle('seleccionada', sel);
    f.style.color = '';
  });
  actualizarSimbolos();
  return elegida;
}

let plyDibujado = -1, giradoDibujado = false;

/** Dibuja el tablero en la posición tras «p» jugadas, sin fijarla ni mover el motor. */
function mostrarTablero(p, forzar = false) {
  // Si ya se ve esa posición no se redibuja: al mover el ratón por la lista llegan muchos eventos seguidos.
  if (!forzar && p === plyDibujado && girado === giradoDibujado) return;
  plyDibujado = p; giradoDibujado = girado;
  const sel = p === ply ? seleccion : null, dest = p === ply ? destinos : null;
  if (p > 0) tablero.mostrar(fens[p], casillas[p - 1][0], casillas[p - 1][1], girado, sel, dest);
  else tablero.mostrar(fens[0], null, null, girado, sel, dest);
}

// Al salir de una jugada, el tablero vuelve a la jugada marcada, pero con un pequeño retraso: si el ratón pasa de una jugada a otra, la vuelta se
// cancela y el tablero no parpadea.
let restaurar = null;
function programarRestauracion() { clearTimeout(restaurar); restaurar = setTimeout(() => mostrarTablero(ply, true), 90); }
function mostrarPosicion(fen, cas) { clearTimeout(restaurar); plyDibujado = -2; tablero.mostrar(fen, cas[0], cas[1], girado); }
$('listaJugadas').addEventListener('mouseleave', () => mostrarTablero(ply));

/** El jugador del lado de abajo del tablero va debajo; el otro, arriba. */
function ponerNombres() {
  $('nombreArriba').textContent = girado ? etiquetaBlancas : etiquetaNegras;
  $('nombreAbajo').textContent = girado ? etiquetaNegras : etiquetaBlancas;
  $('fichaArriba').style.background = girado ? '#fff' : '#2B2B2B';
  $('fichaAbajo').style.background = girado ? '#2B2B2B' : '#fff';
}

let reloj = null;
function actualizarBotonReproducir(enCurso) {
  const boton = $('reproducirBtn');
  const ayuda = enCurso ? 'Pausar reproducción' : 'Reproducir partida';
  boton.setAttribute('aria-pressed', String(enCurso));
  boton.setAttribute('aria-label', ayuda);
  boton.title = `${ayuda} (Espacio)`;
}
function detener() {
  clearInterval(reloj); reloj = null;
  actualizarBotonReproducir(false);
}
// ---------- Avanzar y elegir entre varias continuaciones («Variante») ----------

/** Las jugadas posibles desde la posición actual: la de la partida y las variantes que se desvían aquí. Dentro de una variante no hay alternativas. */
function continuaciones() {
  if (varActual && ply > varActual.desvio) return [];
  const lista = [];
  if (ply < ucisP.length) lista.push({ variante: null, san: sansP[ply] });
  for (const x of variantes) if (x.desvio === ply && x.ucis.length && x.sans.length) lista.push({ variante: x, san: x.sans[0] });
  return lista;
}

const textoContinuacion = (c, p) => `${numeroDe(p + 1)}${(blancasEmpiezan ? p % 2 === 0 : p % 2 === 1) ? '.' : '...'}${convertirFiguras(c.san)}`;

/** Un paso adelante: si hay varias continuaciones, se detiene el avance y se pregunta cuál seguir. */
function avanzar() {
  const opciones = continuaciones();
  if (opciones.length < 2) { ir(ply + 1); return; }
  detener();
  const p = ply;
  elegirVariante({
    obtener: () => continuaciones().map(c => textoContinuacion(c, p)),
    elegir: (i) => {
      const c = continuaciones()[i];
      if (!c) return;
      usarLinea(c.variante);
      ir(p + 1);
    },
    reordenar: (i, direccion) => {
      const lista = continuaciones(), destino = i + direccion;
      if (destino < 0 || destino >= lista.length) return i;
      const a = lista[i], b = lista[destino];
      if (!a.variante || !b.variante) {                  // una de las dos es la de la partida: la variante pasa a ser la línea principal y la anterior queda como variante
        const v = a.variante ?? b.variante, lugar = variantes.indexOf(v);
        promocionarVariante(v);
        const anterior = variantes.pop();
        variantes.splice(Math.min(lugar, variantes.length), 0, anterior);
        reconstruirLista(); ir(p);
      } else {                                           // dos variantes: cambian de sitio entre ellas
        const ia = variantes.indexOf(a.variante), ib = variantes.indexOf(b.variante);
        [variantes[ia], variantes[ib]] = [variantes[ib], variantes[ia]];
        modificado(); reconstruirLista(); ir(p);
      }
      return destino;
    }
  });
}

function reproducir() {
  if (reloj) { detener(); return; }
  if (ply >= sans.length) ir(0);
  reloj = setInterval(() => { if (ply >= sans.length) detener(); else avanzar(); }, 1000);
  actualizarBotonReproducir(true);
}
function girar() {
  girado = !girado;
  if (diagramas.size) reconstruirLista();                // los diagramas de la planilla giran con el tablero
  ir(ply);
}

document.querySelector('.visor-controles').addEventListener('click', (e) => {
  const a = e.target.closest('[data-accion]')?.dataset.accion;
  if (a === 'inicio') { detener(); ir(0); }
  else if (a === 'anterior') { detener(); ir(ply - 1); }
  else if (a === 'siguiente') { detener(); avanzar(); }
  else if (a === 'final') { detener(); ir(sans.length); }
  else if (a === 'reproducir') reproducir();
  else if (a === 'girar') girar();
});

document.addEventListener('keydown', (e) => {
  if (document.querySelector('.velo') || e.ctrlKey || e.altKey || e.metaKey) return;
  const enControl = ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL'].includes(e.target.tagName);
  switch (e.key) {
    case 'ArrowLeft': detener(); ir(ply - 1); break;
    case 'ArrowRight': detener(); avanzar(); break;
    case 'Home': detener(); ir(0); break;
    case 'End': detener(); ir(sans.length); break;
    case ' ': if (enControl) return; reproducir(); break;
    case 'f': case 'F': if (enControl) return; girar(); break;
    default: return;
  }
  e.preventDefault();
});

// ---------- Jugar con el ratón: variantes propias ----------

function avisar(texto) {
  const el = $('posicionText');
  if (!avisando) textoAntesDelAviso = el.innerHTML;
  avisando = true;
  el.textContent = texto;
  el.classList.add('aviso');
  clearTimeout(relojAviso);
  relojAviso = setTimeout(() => { avisando = false; el.innerHTML = textoAntesDelAviso; el.classList.remove('aviso'); }, 2500);
}
let avisando = false, textoAntesDelAviso = '', relojAviso = null;

function casillaPulsada(casilla) {
  detener();
  if (ocupado) return;
  if (seleccion && destinos.includes(casilla)) { jugar(seleccion, casilla); return; }

  const t = new Chess(fens[ply]);
  const pieza = t.get(casilla);
  let aviso = null;
  if (pieza && pieza.color === t.turn()) {
    seleccion = casilla;
    destinos = [...new Set(t.moves({ square: casilla, verbose: true }).map(m => m.to))];
    if (!destinos.length) { seleccion = null; aviso = t.inCheck() ? 'El rey está en jaque. Esa pieza no puede resolverlo.' : 'Esa pieza no tiene jugadas legales.'; }
  } else {
    seleccion = null; destinos = [];
    if (pieza) aviso = `Es el turno de las ${t.turn() === 'w' ? 'blancas' : 'negras'}.`;
  }
  mostrarTablero(ply, true);
  if (aviso) avisar(aviso);
}

/** Arrastrar: la pieza pulsada se suelta en otra casilla a la que puede ir. */
function casillaSoltada(casilla) {
  if (!ocupado && seleccion && casilla && casilla !== seleccion && destinos.includes(casilla)) jugar(seleccion, casilla);
}

async function jugar(desde, hasta) {
  const t = new Chess(fens[ply]);
  const candidatas = t.moves({ verbose: true }).filter(m => m.from === desde && m.to === hasta);
  if (!candidatas.length) return;
  const jugada = candidatas.find(m => m.promotion === 'q') ?? candidatas[0];     // sin promoción: la única; con ella, siempre dama
  seleccion = null; destinos = [];

  // La misma jugada que sigue en la línea que se ve: simplemente se avanza.
  if (ply < sans.length && casillas[ply][0] === desde && casillas[ply][1] === hasta) { ir(ply + 1); return; }

  const uci = uciDe(jugada);
  const p = ply;

  // El punto donde una variante se separa de la partida pertenece también a la partida.
  if (varActual && p <= varActual.desvio) usarLinea(null);
  const v = varActual;                                  // null = la partida
  const lista = v === null ? ucisP : v.ucis;
  const q = v === null ? p : p - v.desvio;

  if (v === null) {
    if (p < sansP.length && casillasP[p][0] === desde && casillasP[p][1] === hasta) { ir(p + 1); return; }
    const existente = variantes.find(x => x.desvio === p && x.ucis.length > 0 && x.ucis[0] === uci);
    if (existente) { usarLinea(existente); ir(p + 1); return; }
  }

  let destino = v;
  if (q >= lista.length) lista.push(uci);                // al final de la línea: se continúa
  else {
    ocupado = true;
    const numero = numeroDe(p + 1) + (blancasMueven(p + 1) ? '.' : '...');
    const opcion = await elegirOpcionJugada(numero + convertirFiguras(jugada.san), v !== null);
    ocupado = false;
    switch (opcion) {
      case 'sobrescribir': lista.splice(q); lista.push(uci); if (v === null) quitarPosteriores(p); break;
      case 'insertar': lista.splice(q, 0, uci); if (v === null) quitarPosteriores(p); break;
      case 'variante': { const nueva = { desvio: p, plegada: false, ucis: [uci], sans: [], casillas: [], fens: [], fichas: [] }; variantes.push(nueva); destino = nueva; break; }
      case 'principal': {
        const anterior = { desvio: p, plegada: false, ucis: ucisP.slice(p), sans: [], casillas: [], fens: [], fichas: [] };
        ucisP.splice(p); ucisP.push(uci);
        quitarPosteriores(p);
        variantes.push(anterior);
        break;
      }
      default: mostrarTablero(ply, true); return;
    }
  }

  modificado();
  rehacerTodo();
  usarLinea(destino && variantes.includes(destino) ? destino : null);
  reconstruirLista();
  ir(p + 1);
}

// ---------- Símbolos de anotación ----------

let botonesSimbolo = new Map(), botonDiagrama = null;

function construirBarraSimbolos() {
  const panel = $('simbolosPanel');
  // Lo primero, el diagrama de la posición (como en ChessVision): pone o quita el tablero pequeño tras la jugada elegida.
  let d = '';
  for (let f = 0; f < 4; f++) for (let c = 0; c < 4; c++) if ((f + c) % 2 === 0) d += `M${c * 3.5},${f * 3.5} h3.5 v3.5 h-3.5 Z `;
  botonDiagrama = Object.assign(document.createElement('div'), { className: 'simbolo', title: 'Diagrama: pone o quita el tablero pequeño tras la jugada elegida' });
  botonDiagrama.innerHTML = `<svg viewBox="0 0 14 14" width="14" height="14"><path d="${d}" fill="#333B4A"/></svg>`;
  botonDiagrama.addEventListener('click', () => { if (ply > 0) alternarDiagrama(rutaDe(ucisDeLaLinea(), ply)); });
  panel.appendChild(botonDiagrama);

  for (const s of [SIMBOLOS_EXTRA[0], ...SIMBOLOS_CALIDAD, ...SIMBOLOS_VALORACION, SIMBOLOS_EXTRA[1]]) {
    const b = Object.assign(document.createElement('div'), { className: 'simbolo', textContent: s, title: AYUDA_SIMBOLOS[s] });
    b.style.color = ['!!', '!', '!?'].includes(s) ? '#2A8F55' : ['?!', '?', '??'].includes(s) ? 'var(--rojo)' : SIMBOLOS_VALORACION.includes(s) ? 'var(--azul)' : 'var(--texto)';
    b.addEventListener('click', () => alternarSimbolo(s));
    botonesSimbolo.set(s, b);
    panel.appendChild(b);
  }
}

/** Pone o quita un símbolo de la jugada elegida. De calidad y de valoración solo puede haber uno. */
function alternarSimbolo(s) {
  if (ply === 0) return;
  const ruta = rutaDe(ucisDeLaLinea(), ply);
  let nota = notas.get(ruta);
  if (!nota) notas.set(ruta, nota = new Set());
  if (!nota.delete(s)) {
    const grupo = SIMBOLOS_CALIDAD.includes(s) ? SIMBOLOS_CALIDAD : SIMBOLOS_VALORACION.includes(s) ? SIMBOLOS_VALORACION : null;
    if (grupo) for (const g of grupo) nota.delete(g);
    nota.add(s);
  }
  if (nota.size === 0) notas.delete(ruta);
  modificado();
  reconstruirLista();
  pintarSeleccion();
}

/** Los botones de símbolos muestran cuáles tiene la jugada elegida; sin jugada elegida están apagados. */
function actualizarSimbolos() {
  const ruta = ply > 0 ? rutaDe(ucisDeLaLinea(), ply) : null;
  const nota = ruta ? notas.get(ruta) : null;
  if (botonDiagrama) {
    botonDiagrama.classList.toggle('puesto', !!ruta && diagramas.has(ruta));
    botonDiagrama.classList.toggle('apagado', ply === 0);
  }
  for (const [s, b] of botonesSimbolo) { b.classList.toggle('puesto', !!nota?.has(s)); b.classList.toggle('apagado', ply === 0); }
}

// ---------- Guardar los cambios (al cerrar, si hay cambios, se pregunta) ----------

let sinGuardar = false;

function modificado() {
  sinGuardar = true;
  $('guardarBtn').disabled = false;
}

async function guardar() {
  if (!sinGuardar) return true;
  const principal = ucisP.join(' ');
  try {
    await guardarEdicion(partida.id, {
      principal: principal === ucisOriginal ? null : principal,
      variantes: variantes.map(v => ({ desvio: v.desvio, jugadas: v.ucis.join(' ') })),
      notas: [
        ...[...notas].map(([ruta, set]) => ({ ruta, simbolos: [...set].join(' ') })),
        ...[...previos].map(([r, t]) => ({ ruta: '@1 ' + r, simbolos: `${t.color}|${t.texto}` })),
        ...[...posteriores].map(([r, t]) => ({ ruta: '@2 ' + r, simbolos: `${t.color}|${t.texto}` })),
        ...[...diagramas].map(d => ({ ruta: '@D ' + d, simbolos: '1' }))
      ]
    });
    sinGuardar = false;
    $('guardarBtn').disabled = true;
    const g = $('guardado');
    g.textContent = 'Cambios guardados';
    g.classList.add('visible');
    setTimeout(() => g.classList.remove('visible'), 1800);
    return true;
  } catch (ex) { await informar('No se pudo guardar', ex.message); return false; }
}

/** Lo llama el panel que contiene el visor antes de cerrarse: true = se puede cerrar; false = el usuario quiere seguir en la partida. */
window.confirmarCierreVisor = async () => {
  if (!sinGuardar) return true;
  const r = await preguntarTres('Guardar cambios', 'Has modificado la partida. ¿Quieres guardar los cambios?', { textoSi: 'Guardar', textoNo: 'No guardar', textoTercero: 'Cancelar' });
  if (r === null) return false;
  if (r === true) return guardar();
  sinGuardar = false;                                    // «No guardar»: se descartan
  $('guardarBtn').disabled = true;
  return true;
};

$('guardarBtn').addEventListener('click', guardar);
addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); guardar(); } });
addEventListener('beforeunload', (e) => { if (sinGuardar) { e.preventDefault(); e.returnValue = ''; } });   // si la página se cierra o recarga con cambios sin guardar, avisa el navegador

/** Recupera lo guardado: la línea principal cambiada (si la hay) y las variantes. */
function cargarEdicionGuardada(e) {
  for (const { ruta, simbolos } of e.notas) {
    // Los textos y diagramas se guardan en la misma tabla, con una marca delante de la ruta.
    if (ruta.startsWith('@1 ') || ruta.startsWith('@2 ')) {
      const [color, ...resto] = simbolos.split('|');
      (ruta[1] === '1' ? previos : posteriores).set(ruta.slice(3), { texto: resto.join('|'), color });
    } else if (ruta.startsWith('@D ')) diagramas.add(ruta.slice(3));
    else notas.set(ruta, new Set(simbolos.split(' ').filter(Boolean)));
  }
  if (e.principal?.trim()) ucisP = e.principal.split(' ').filter(Boolean);
  for (const { desvio, jugadas } of e.variantes) variantes.push({ desvio, plegada: false, ucis: jugadas.split(' ').filter(Boolean), sans: [], casillas: [], fens: [], fichas: [] });
  rehacerTodo();
  usarLinea(null);
}

// ---------- Motor en vivo ----------

let motor = null, abortAnalisis = null, version = 0, cerrando = false;
const infos = new Array(LINEAS_DE_ANALISIS).fill(null);
let infoNueva = false, fenAnalizado = '';
let previaMotor = null;  // jugada visible bajo el ratón; su fila se conserva mientras se previsualiza
const posicionesMotor = new WeakMap();

function cancelarPreviaMotor(restaurarPosicion = true) {
  if (!previaMotor) return;
  previaMotor.jugada.classList.remove('previsualizando');
  previaMotor = null;
  infoNueva = true;
  if (restaurarPosicion) programarRestauracion();
}

function previsualizarMotor(evento) {
  const jugada = evento.target.closest('.motor-jugada');
  const posicion = jugada && posicionesMotor.get(jugada);
  if (!posicion || posicion.origen !== fens[ply]) return;
  if (previaMotor?.jugada === jugada) return;
  cancelarPreviaMotor(false);
  previaMotor = { jugada, fila: jugada.closest('.motor-linea') };
  jugada.classList.add('previsualizando');
  mostrarPosicion(posicion.fen, [posicion.desde, posicion.hasta]);
}

$('lineasMotor').addEventListener('mouseover', previsualizarMotor);
$('lineasMotor').addEventListener('mouseout', (evento) => {
  if (!previaMotor || previaMotor.jugada.contains(evento.relatedTarget)) return;
  const siguiente = evento.relatedTarget?.closest?.('.motor-jugada');
  if (siguiente && $('lineasMotor').contains(siguiente)) return;
  cancelarPreviaMotor();
});
$('lineasMotor').addEventListener('mouseleave', () => {
  cancelarPreviaMotor(false);
  clearTimeout(restaurar);
  mostrarTablero(ply, true);
});

function construirLineasMotor() {
  $('lineasMotor').innerHTML = Array.from({ length: LINEAS_DE_ANALISIS }, (_, i) =>
    `<div class="motor-linea"><span class="n">${i + 1}.</span><span class="s"></span><span class="e"></span><span class="v"></span></div>`).join('');
}

function limpiarLineasMotor(mensaje = '') {
  const estabaPrevisualizando = !!previaMotor;
  cancelarPreviaMotor(false);
  if (estabaPrevisualizando) mostrarTablero(ply, true);
  $('lineasMotor').style.opacity = '1';
  [...$('lineasMotor').children].forEach((fila, i) => {
    fila.querySelector('.e').textContent = ''; fila.querySelector('.s').textContent = '';
    fila.querySelector('.v').innerHTML = i === 0 ? figurasHtml(mensaje) : '';
  });
}

async function iniciarMotor() {
  $('motorNombre').textContent = NOMBRE_MOTOR;
  $('motorAviso').textContent = 'Arrancando el motor…';
  try { motor = await MotorUci.iniciar(); motor.nombre = NOMBRE_MOTOR; await motor.nuevaPartida(); $('motorAviso').textContent = ''; }
  catch (ex) { $('motorAviso').textContent = ex.message; $('motorCheck').disabled = true; return; }
  if (cerrando) { motor.cerrar(); motor = null; return; }
  setInterval(pintarMotor, 200);
  reiniciarAnalisis();
}

/** Empieza a analizar la posición que se ve. Si se navega rápido, solo la última llega a analizarse. */
function reiniciarAnalisis() {
  const mi = ++version;
  abortAnalisis?.abort();
  if (!motor || cerrando) return;
  infos.fill(null); infoNueva = false;
  const fen = fens[ply];
  fenAnalizado = fen;

  if (!$('motorCheck').checked) { limpiarLineasMotor('Motor desactivado.'); return; }

  const t = new Chess(fen);
  if (t.moves().length === 0) {
    limpiarLineasMotor(t.inCheck() ? 'Jaque mate: la partida ha terminado.' : 'Rey ahogado: tablas.');
    actualizarBarra(t.inCheck() ? (t.turn() === 'w' ? 0 : 1) : 0.5);
    return;
  }
  const ab = abortAnalisis = new AbortController();
  motor.analizarEnVivo(fen, (info) => { if (mi === version && info.linea >= 1 && info.linea <= LINEAS_DE_ANALISIS) { infos[info.linea - 1] = info; infoNueva = true; } },
    ab.signal, LINEAS_DE_ANALISIS).catch((ex) => { if (!cerrando && mi === version) $('motorAviso').textContent = ex.message; });
}
$('motorCheck').addEventListener('change', reiniciarAnalisis);

/** La evaluación como la ve el ajedrecista: siempre desde las blancas («+0,35», «M3», «-M2»). */
function textoEvaluacion(info, mueveBlancas) {
  if (info.mate !== null) {
    const paraBlancas = mueveBlancas ? info.mate : -info.mate;
    return { texto: paraBlancas > 0 ? `M${paraBlancas}` : `-M${-paraBlancas}`, fraccion: paraBlancas > 0 ? 1 : 0 };
  }
  const cp = (info.centipeones ?? 0) * (mueveBlancas ? 1 : -1);
  const t = (Math.abs(cp) / 100).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return { texto: cp > 0 ? `+${t}` : cp < 0 ? `-${t}` : t, fraccion: 1 / (1 + Math.exp(-cp / 350)) };
}

/** Cada jugada del motor conserva la posición que corresponde al texto mostrado. */
function pintarVarianteMotor(contenedor, fen, uci) {
  contenedor.replaceChildren();
  for (const posicion of posicionesDeVariante(fen, uci)) {
    if (contenedor.childNodes.length) contenedor.append(' ');
    const jugada = document.createElement('span');
    jugada.className = 'motor-jugada';
    jugada.innerHTML = figurasHtml(convertirFiguras(posicion.texto));
    posicionesMotor.set(jugada, { ...posicion, origen: fen });
    contenedor.appendChild(jugada);
  }
}

/** Cada 200 ms pone en pantalla lo último que ha dicho el motor (así no se redibuja con cada línea). */
function pintarMotor() {
  if (!infoNueva || fenAnalizado !== fens[ply] || !infos[0]) return;
  infoNueva = false;
  $('lineasMotor').style.opacity = '1';
  const fen = fens[ply], mueveBlancas = fen.split(' ')[1] === 'w';
  const filas = [...$('lineasMotor').children];
  infos.forEach((linea, i) => {
    const fila = filas[i];
    // El motor puede cambiar de variante cada 200 ms: no se sustituye la fila que se está mirando.
    if (previaMotor?.fila === fila) return;
    if (!linea) { fila.querySelector('.e').textContent = ''; fila.querySelector('.s').textContent = ''; fila.querySelector('.v').innerHTML = ''; return; }
    const { texto } = textoEvaluacion(linea, mueveBlancas);
    const cp = linea.mate !== null ? (linea.mate > 0 ? 10000 : -10000) : (linea.centipeones ?? 0);
    fila.querySelector('.e').textContent = `(${texto})`;
    fila.querySelector('.s').textContent = simboloVentaja(mueveBlancas ? cp : -cp);
    pintarVarianteMotor(fila.querySelector('.v'), fen, linea.variante);
  });
  // La profundidad y la barra son las de la mejor línea.
  const principal = infos[0];
  const { fraccion } = textoEvaluacion(principal, mueveBlancas);
  $('profundidadText').textContent = `profundidad ${principal.profundidad}` + (principal.nps > 0 ? ` · ${decimal(principal.nps / 1e6)} Mn/s` : '');
  actualizarBarra(fraccion);
  valorarFinalDeVariante();
}

/** La barra de evaluación: la parte blanca ocupa «fraccion» de la altura (las blancas siempre abajo, aunque se gire el tablero). */
function actualizarBarra(fraccion) { $('barraBlanca').style.transform = `scaleY(${Math.min(1, Math.max(0, fraccion))})`; }

// ---------- Análisis de la partida ----------

let analizando = false, abortarPartida = null;
let analisisDatos = null;            // { valores, mejores, fens, sans, precisiones… } del último análisis completo
let erroresOcultos = null;           // los errores del análisis, guardados aparte mientras la tarjeta está cerrada (la planilla se ve sin ellos)
let analisisUcis = null;             // las jugadas de la partida cuando se analizó: si cambian, el análisis ya no vale
let conclusionesPendientes = false;

async function analizarPartida() {
  if (analizando) { abortarPartida?.abort(); return; }
  // Ya analizada y la partida sigue igual: solo se vuelve a enseñar el resultado (por ejemplo, tras cerrar la tarjeta con la ✕), sin analizar otra vez.
  if (analisisDatos && analisisUcis === ucisP.join(' ')) {
    if (erroresOcultos) {                                // la tarjeta estaba cerrada: vuelven los errores, las marcas y las variantes
      errores = erroresOcultos; erroresOcultos = null;
      aplicarAnalisisALaPartida();
    }
    $('analisisCard').hidden = false;
    mostrarResultadoAnalisis();
    const abrir = conclusionesPendientes;
    conclusionesPendientes = false;
    if (abrir) abrirConclusiones();
    return;
  }
  volverALaPartida();                                    // el análisis es de la partida, no de la variante que se esté probando
  if (!sans.length) { conclusionesPendientes = false; return; }

  // Un análisis nuevo sustituye al anterior: se quitan sus variantes, valoraciones y marcas de error para que no queden restos en la planilla.
  if (analisisDatos) {
    quitarAnalisisDeLaPartida(false);
    errores.clear();
    analisisDatos = null; analisisUcis = null; erroresOcultos = null;
    reconstruirLista();
  }
  analizando = true;
  $('aplicarAnalisis').hidden = true;
  const ab = abortarPartida = new AbortController();
  const motores = [];
  $('analizarBtn').textContent = 'Cancelar análisis';
  $('analizarBtn').title = 'Cancelar análisis';
  $('analisisCard').hidden = false;
  $('analisisResumen').hidden = true; $('erroresTitulo').hidden = true; $('erroresLista').hidden = true;
  $('analisisBarra').hidden = false; $('analisisProgreso').hidden = false;
  $('analisisRelleno').style.width = '0%';
  $('analisisProgreso').textContent = 'Analizando la partida con Stockfish…';

  try {
    // Evaluación de cada posición desde el punto de vista del bando que mueve; varias copias del motor se reparten las posiciones.
    const total = fens.length, valores = new Array(total), mejores = new Array(total);
    let hechas = 0, siguiente = 0;
    const n = Math.min(PARALELO, total);
    for (let i = 0; i < n; i++) { const m = await MotorUci.iniciar(); m.nombre = NOMBRE_MOTOR; motores.push(m); await m.nuevaPartida(); }
    await Promise.all(motores.map(async (m) => {
      while (siguiente < total) {
        if (ab.signal.aborted) throw new DOMException('Cancelado', 'AbortError');
        const i = siguiente++;
        const t = new Chess(fens[i]);
        if (t.moves().length === 0) { valores[i] = t.inCheck() ? -TOPE : 0; mejores[i] = ''; }
        else {
          const e = await m.analizar(fens[i], PROFUNDIDAD_ANALISIS, ab.signal);
          valores[i] = Math.min(TOPE, Math.max(-TOPE, e.valor)); mejores[i] = e.mejorJugada;
        }
        hechas++;
        $('analisisRelleno').style.width = `${hechas / total * 100}%`;
        $('analisisProgreso').textContent = `Analizando la partida con Stockfish… posición ${hechas} de ${total}`;
      }
    }));

    const mejorEnSan = (i) => {
      const u = mejores[i];
      if (!u || u.length < 4) return '';
      try { return new Chess(fens[i]).move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san; } catch { return ''; }
    };
    errores = calcularErrores(valores, sans.length, mejorEnSan, blancasEmpiezan);
    const pr = calcularPrecisiones(valores, fens, blancasEmpiezan);
    analisisDatos = { valores, mejores, fens: [...fens], sans: [...sans], precisionBlancas: pr.blancas, precisionNegras: pr.negras, detalle: pr.detalle };
    analisisUcis = ucisP.join(' ');
    aplicarAnalisisALaPartida();
    mostrarResultadoAnalisis();
  } catch (ex) {
    if (ex?.name === 'AbortError') {
      $('analisisCard').hidden = errores.size === 0;
      if (errores.size === 0) $('analisisProgreso').textContent = '';
    } else { $('analisisProgreso').textContent = ex.message; $('analisisBarra').hidden = true; }
  } finally {
    motores.forEach(m => m.cerrar());
    analizando = false;
    actualizarBotonAnalisis();
    $('analizarBtn').textContent = 'Analizar partida';
    $('analizarBtn').title = 'Analizar partida';
    const abrir = conclusionesPendientes && analisisDatos;
    conclusionesPendientes = false;
    if (abrir) abrirConclusiones();
  }
}

// ---------- Llevar el análisis a la anotación de la partida (y quitarlo) ----------

/** El símbolo de valoración como en ChessBase, el mismo que ve el panel del motor (desde el punto de vista de las blancas). */
const simboloDeValoracion = (cp) => simboloVentaja(cp);

// ---------- La valoración del módulo al final de las variantes que se crean con el ratón ----------

const valoracionAuto = new Map();                       // ruta → símbolo que ha puesto el motor (los que pone el usuario nunca se tocan)

/** La valoración (desde las blancas) de la posición que está viendo el motor, en centipeones; null si aún no es fiable. */
function valoracionDelMotor() {
  const info = infos[0];
  if (!info || (info.profundidad ?? 0) < 12 || fenAnalizado !== fens[ply]) return null;
  const mueveBlancas = fens[ply].split(' ')[1] === 'w';
  if (info.mate !== null) return (mueveBlancas ? info.mate : -info.mate) > 0 ? 10000 : -10000;
  return (info.centipeones ?? 0) * (mueveBlancas ? 1 : -1);
}

/** Si se está en la última jugada de una variante propia, el motor pone su valoración en ella (y la quita de la jugada anterior). */
function valorarFinalDeVariante() {
  if (!varActual || ply !== varActual.desvio + varActual.sans.length) return;
  if (varActual.delAnalisis) return;                      // las del análisis ya llevan la suya
  const cp = valoracionDelMotor();
  if (cp === null) return;
  const simbolo = simboloVentaja(cp), ruta = rutaDe(ucisDeLaLinea(), ply);
  let cambio = false;
  for (const [r, s] of [...valoracionAuto]) {             // la que puso en una jugada anterior de esta misma variante
    if (r === ruta || !ruta.startsWith(r + ' ') || r.split(' ').length <= varActual.desvio) continue;
    const n = notas.get(r);
    if (n?.delete(s) && n.size === 0) notas.delete(r);
    valoracionAuto.delete(r); cambio = true;
  }
  const nota = notas.get(ruta) ?? new Set();
  const propia = SIMBOLOS_VALORACION.find(s => nota.has(s));
  if (propia && valoracionAuto.get(ruta) !== propia) { if (cambio) refrescarPlanilla(); return; }   // ya lleva una que puso el usuario
  if (propia === simbolo) { if (cambio) refrescarPlanilla(); return; }
  if (propia) nota.delete(propia);
  nota.add(simbolo); notas.set(ruta, nota); valoracionAuto.set(ruta, simbolo);
  modificado();
  refrescarPlanilla();
}

/** Redibuja la planilla sin perder el lugar en el que se estaba mirando. */
function refrescarPlanilla() {
  const lista = $('listaJugadas'), arriba = lista.scrollTop;
  reconstruirLista();
  pintarSeleccion();
  lista.scrollTop = arriba;
}

/** Por cada error: dónde se desvía la variante y la jugada que Stockfish proponía en su lugar. */
const mejoresDelAnalisis = () => !analisisDatos ? [] : [...errores.values()]
  .map(e => ({ desvio: e.ply - 1, mejor: analisisDatos.mejores[e.ply - 1] }))
  .filter(x => x.mejor && x.mejor !== ucisP[x.desvio]);
const esVarianteDelAnalisis = (v, x) => v.desvio === x.desvio && v.ucis.length === 1 && v.ucis[0] === x.mejor;
const rutaDeLaVariante = (x) => rutaDe([...ucisP.slice(0, x.desvio), x.mejor], x.desvio + 1);
const analisisAplicado = () => { const m = mejoresDelAnalisis(); return m.length > 0 && m.every(x => variantes.some(v => esVarianteDelAnalisis(v, x))); };

const ICONO_QUITAR = 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6';
const ICONO_PONER = 'M12 5v14M5 12h14';

function actualizarBotonAnalisis() {
  const aplicado = analisisAplicado();
  const boton = $('aplicarAnalisis');
  boton.hidden = analizando || mejoresDelAnalisis().length === 0;
  boton.classList.toggle('activo', aplicado);
  boton.setAttribute('aria-pressed', String(aplicado));
  boton.querySelector('[data-icono]').setAttribute('d', aplicado ? ICONO_QUITAR : ICONO_PONER);
  boton.querySelector('[data-texto]').textContent = tr(aplicado ? 'Quitar variantes' : 'Poner variantes');
  boton.title = tr(aplicado ? 'Quitar de la partida las variantes del análisis' : 'Volver a añadir a la partida la mejor jugada de cada error, con la valoración del módulo');
  boton.setAttribute('aria-label', boton.title);
}

function refrescarAnotacion() {
  rehacerTodo();
  usarLinea(null);
  reconstruirLista();
  marcarErroresEnLista();
  modificado();
  actualizarBotonAnalisis();
  ir(Math.min(ply, sansP.length));
}

/** En cada error, la jugada que Stockfish proponía se añade a la anotación como variante, con la valoración del módulo tras ella. */
function aplicarAnalisisALaPartida() {
  for (const x of mejoresDelAnalisis()) {
    if (variantes.some(v => esVarianteDelAnalisis(v, x))) continue;               // ya hay una igual (hecha a mano o ya puesta): se respeta tal cual
    variantes.push({ desvio: x.desvio, plegada: false, ucis: [x.mejor], sans: [], casillas: [], fens: [], fichas: [], delAnalisis: true });
    const blancasMueven = analisisDatos.fens[x.desvio].split(' ')[1] === 'w';
    const cp = analisisDatos.valores[x.desvio] * (blancasMueven ? 1 : -1);        // la mejor jugada conserva el valor de la posición
    const ruta = rutaDeLaVariante(x), set = notas.get(ruta) ?? new Set();
    for (const s of SIMBOLOS_VALORACION) set.delete(s);
    set.add(simboloDeValoracion(cp));
    notas.set(ruta, set);
  }
  refrescarAnotacion();
}

function quitarAnalisisDeLaPartida(refrescar = true) {
  for (const x of mejoresDelAnalisis()) {
    const variante = variantes.find(v => v.delAnalisis && esVarianteDelAnalisis(v, x));       // las hechas a mano con el ratón no se tocan
    if (!variante) continue;
    variantes = variantes.filter(v => v !== variante);
    const set = notas.get(rutaDeLaVariante(x));
    if (set) { for (const s of SIMBOLOS_VALORACION) set.delete(s); if (!set.size) notas.delete(rutaDeLaVariante(x)); }
  }
  if (refrescar) refrescarAnotacion();
  else { rehacerTodo(); usarLinea(null); modificado(); }
}

$('aplicarAnalisis').addEventListener('click', () => (analisisAplicado() ? quitarAnalisisDeLaPartida() : aplicarAnalisisALaPartida()));

const textoPrecision = (p) => (p !== null && p !== undefined ? `Precisión ${decimal(p)} %\n` : '');

function mostrarResultadoAnalisis() {
  $('analisisBarra').hidden = true;
  $('analisisProgreso').hidden = true;
  $('analisisResumen').hidden = false; $('erroresTitulo').hidden = false; $('erroresLista').hidden = false;
  $('resumenBlancasTitulo').textContent = `♔ ${corto(nombreBlancas)}`;
  $('resumenNegrasTitulo').textContent = `♚ ${corto(nombreNegras)}`;
  $('resumenBlancasTexto').textContent = textoPrecision(analisisDatos.precisionBlancas) + resumenErrores(errores, true);
  $('resumenNegrasTexto').textContent = textoPrecision(analisisDatos.precisionNegras) + resumenErrores(errores, false);

  const lista = $('erroresLista');
  lista.innerHTML = [...errores.values()].sort((a, b) => a.ply - b.ply).map(e => {
    const color = e.marca === '??' ? 'var(--rojo)' : e.marca === '?' ? 'var(--naranja)' : 'var(--azul)';
    return `<div class="error-fila" data-ply="${e.ply}" style="border-left-color:${color}">${figurasHtml(
      `${numeroDe(e.ply)}${e.blancas ? '.' : '...'}${convertirFiguras(sans[e.ply - 1])}${e.marca}   −${puntos(e.perdida)}` + (e.mejor ? `   ${tr('mejor:')} ${convertirFiguras(e.mejor)}` : ''))}</div>`;
  }).join('') || '<div class="suave" style="font-size:13px">No hay errores: los dos jugaron una partida muy limpia.</div>';

  marcarErroresEnLista();
  actualizarBotonAnalisis();
  ir(ply);                                               // refresca el texto de la jugada con su calificación
}

$('erroresLista').addEventListener('click', (e) => {
  const f = e.target.closest('.error-fila');
  if (f) { detener(); if (varActual) usarLinea(null); ir(Number(f.dataset.ply)); }
});
$('erroresLista').addEventListener('mouseover', (e) => {
  const f = e.target.closest('.error-fila');
  if (f) mostrarPosicion(fensP[Number(f.dataset.ply)], casillasP[Number(f.dataset.ply) - 1]);
});
$('erroresLista').addEventListener('mouseleave', () => mostrarTablero(ply, true));

/** En la lista de jugadas, las que son errores llevan su signo y su color. */
function marcarErroresEnLista() {
  for (const [p, e] of errores) {
    if (p > fichas.length) continue;
    fichas[p - 1].innerHTML = figurasHtml(textoFicha(sansP[p - 1], rutaDe(ucisP, p), e.marca));
  }
  pintarSeleccion();
}

$('quitarAnalisis').addEventListener('click', () => {
  if (analizando) { abortarPartida?.abort(); return; }    // si aún se está analizando, la X cancela el análisis
  ocultarAnalisis();
});

/** Cierra la tarjeta del análisis y deja la planilla como estaba antes de analizar: sin variantes, valoraciones ni marcas de error. El análisis sigue en memoria. */
function ocultarAnalisis() {
  if (analisisDatos && !erroresOcultos) {
    quitarAnalisisDeLaPartida(false);                      // fuera las variantes y valoraciones incrustadas
    erroresOcultos = errores; errores = new Map();         // fuera las marcas de error
    reconstruirLista();
    ir(Math.min(ply, sans.length));
  }
  $('analisisCard').hidden = true;
}

function abrirConclusiones() {
  mostrarConclusiones(`Conclusiones · ${corto(nombreBlancas)} – ${corto(nombreNegras)}`, construirConclusiones({
    partida, nombreBlancas, nombreNegras, valores: analisisDatos.valores, fens: analisisDatos.fens, sans: analisisDatos.sans, errores: erroresOcultos ?? errores, detalle: analisisDatos.detalle,
    precisionBlancas: analisisDatos.precisionBlancas, precisionNegras: analisisDatos.precisionNegras, mejores: analisisDatos.mejores, casillasP, blancasEmpiezan, numeroInicial
  }));
}

$('conclusionesBtn').addEventListener('click', () => {
  // Sin análisis todavía: se analiza la partida y, al terminar, se abre el cuadro solo.
  if (!analisisDatos) { conclusionesPendientes = true; if (!analizando) analizarPartida(); return; }
  abrirConclusiones();
});
$('analizarBtn').addEventListener('click', analizarPartida);

// ---------- Cambiar de sitio la evaluación y las jugadas arrastrando una tarjeta sobre la otra ----------

function conectarTarjetas() {
  const contenedor = $('tarjetas');
  let origen = null, puede = true;
  const aplicar = (motorArriba) => contenedor.classList.toggle('motor-arriba', motorArriba);
  db.leerAjuste('visor_motor_arriba', false).then(v => aplicar(!!v)).catch(() => {});

  contenedor.addEventListener('dragstart', (e) => {
    const tarjeta = e.target.closest?.('[data-tarjeta]');
    // Pulsar sobre un botón, una jugada o la barra de desplazamiento no inicia el arrastre.
    if (!tarjeta || e.target !== tarjeta) { if (!tarjeta || e.target.closest('.ficha-jugada, button, label, input, .comentario, .diagrama, .variante-signo')) { e.preventDefault(); return; } }
    origen = tarjeta.dataset.tarjeta;
    puede = true;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', origen);
    requestAnimationFrame(() => tarjeta.classList.add('arrastrando'));
  });
  // Al pasar sobre la otra tarjeta, las dos se cambian de sitio. Solo una vez, hasta que el ratón vuelva a pasar por la tarjeta que se arrastra:
  // si no, las tarjetas, que no miden lo mismo, se cambiarían sin parar.
  contenedor.addEventListener('dragover', (e) => {
    if (!origen) return;
    e.preventDefault();
    const destino = e.target.closest('[data-tarjeta]')?.dataset.tarjeta;
    if (!destino) return;
    if (destino === origen) { puede = true; return; }
    if (!puede) return;
    puede = false;
    aplicar(!contenedor.classList.contains('motor-arriba'));
  });
  contenedor.addEventListener('drop', (e) => { if (origen) e.preventDefault(); });
  contenedor.addEventListener('dragend', () => {
    contenedor.querySelectorAll('.arrastrando').forEach(t => t.classList.remove('arrastrando'));
    if (origen) db.guardarAjuste('visor_motor_arriba', contenedor.classList.contains('motor-arriba')).catch(() => {});   // se recuerda para la próxima vez
    origen = null;
  });
}

// ---------- Tamaño del tablero ----------

function ajustarTablero() {
  const col = $('columnaIzq'), fila = document.querySelector('.visor-fila-tablero');
  if (!col || !fila) return;
  const ancho = col.clientWidth - 36 - 10 - 6;                                       // sin la barra de evaluación ni los bordes
  // Nombres, texto de la posición y botones: lo que ocupa la columna sin el tablero (no scrollHeight: la columna se estira a toda la altura).
  let fijo = 0;
  for (const h of col.children) if (h !== fila) { const s = getComputedStyle(h); fijo += h.offsetHeight + parseFloat(s.marginTop) + parseFloat(s.marginBottom); }
  const alto = innerHeight - col.getBoundingClientRect().top - 30 - fijo;
  const px = Math.max(30, Math.min(90, Math.floor(Math.min(ancho, alto) / 8)));
  if (px !== tablero.casillaPx) tablero.setCasilla(px);
  // Alinea la fila completa con el tablero real, excluyendo la barra de evaluación.
  const rect = tablero.raiz.getBoundingClientRect();
  col.style.setProperty('--ancho-tablero', `${rect.width}px`);
  col.style.setProperty('--inicio-tablero', `${rect.left - col.getBoundingClientRect().left}px`);
}
addEventListener('resize', ajustarTablero);

// ---------- Arranque ----------

async function iniciar() {
  const parametros = new URLSearchParams(location.search);
  // Dentro del panel de la ficha: sin barra superior (la lleva el panel) y Escape lo cierra.
  if (parametros.get('incrustado') === '1') {
    document.body.classList.add('visor-incrustado');
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('.velo')) parent.postMessage({ tipo: 'cerrar-visor' }, location.origin); });
  }
  const id = Number(parametros.get('id'));
  partida = id ? await obtenerPartida(id).catch(() => null) : null;
  if (!partida) {
    document.body.innerHTML = '<div class="estado-vacio" style="min-height:100vh"><b>No se encuentra esta partida</b><p>Puede que se haya borrado.</p><a class="btn btn-primario" href="index.html">Volver a ChessRival</a></div>';
    return;
  }
  try {   // el título FIDE (GM, IM…) del jugador de la ficha
    const t = (await db.cargarTodos()).find(x => db.claveJugador(x) === partida.jugadorClave);
    tituloJugador = t?.fideTitle ?? '';
  } catch { /* sin título */ }
  girado = partida.colorJugador === 'N';                                             // se mira desde el lado del jugador de la ficha

  tablero = new Tablero($('tablero'), { casilla: 65, etiquetas: true, interactivo: true });
  tablero.puedeArrastrar = (c) => seleccion === c && destinos.length > 0;
  tablero.alPulsar = casillaPulsada;
  tablero.alSoltar = casillaSoltada;
  tablero.alBotonDerecho = () => { detener(); ir(ply - 1); };

  prepararPartida();
  $('planillaBlancas').textContent = etiquetaBlancas;
  $('planillaNegras').textContent = etiquetaNegras;
  ucisOriginal = ucisP.join(' ');
  usarLinea(null);
  construirLineasMotor();
  construirBarraSimbolos();
  conectarTarjetas();

  try {
    const e = await cargarEdicion(partida.id);
    if (e.principal || e.variantes.length || e.notas.length) cargarEdicionGuardada(e);
  } catch { /* sin cambios guardados o base no disponible: se ve la partida sola */ }
  reconstruirLista();
  ajustarTablero();
  const plySolicitado = Number(parametros.get('ply'));
  ir(Number.isInteger(plySolicitado) && plySolicitado >= 0 ? Math.min(plySolicitado, sans.length) : 0);
  ajustarTablero();
  iniciarMotor();
}

addEventListener('beforeunload', () => { cerrando = true; abortAnalisis?.abort(); motor?.cerrar(); });
iniciar();

window.addEventListener('chessrival-idioma', () => { try { if (partida) { reconstruirLista(); ir(ply); if (analisisDatos && !erroresOcultos) mostrarResultadoAnalisis(); } } catch { /* aún no cargado */ } });
