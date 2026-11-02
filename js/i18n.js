// Idiomas de ChessRival: español (el original), inglés, alemán, francés e italiano.
// El texto de la aplicación está escrito en español; en inglés se traduce lo que se pone en pantalla con un diccionario
// (js/i18n-en.js): frases exactas y plantillas con huecos «{}» para las que llevan números o nombres.
// Un observador del documento traduce cada texto en cuanto aparece, también el que se crea después con JavaScript.

const CLAVE = 'chessrival_idioma';
const HAY_NAVEGADOR = typeof document !== 'undefined' && typeof window !== 'undefined';   // en las pruebas con Node no hay página

export const IDIOMAS = ['es', 'en', 'de', 'fr', 'it', 'ru'];
const LOCALES = { es: 'es-ES', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', it: 'it-IT', ru: 'ru-RU' };
export const NOMBRES_IDIOMA = { es: 'español', en: 'inglés', de: 'alemán', fr: 'francés', it: 'italiano', ru: 'ruso' };

function leerIdioma() {
  try {
    const guardado = localStorage.getItem(CLAVE);
    if (IDIOMAS.includes(guardado)) return guardado;
  } catch { /* sin almacenamiento */ }
  const idiomaNavegador = typeof navigator !== 'undefined'
    ? (navigator.languages?.[0] || navigator.language || '') : '';
  const propio = /^(es|de|fr|it|ru)(?:-|$)/i.exec(idiomaNavegador);
  return propio ? propio[1].toLowerCase() : 'en';          // cualquier otro idioma del navegador: inglés
}

export let IDIOMA = leerIdioma();
export let LOCALE = LOCALES[IDIOMA];
if (HAY_NAVEGADOR) document.documentElement.lang = IDIOMA;

// Nombres de aperturas: la aplicación parte de los nombres ingleses de Lichess y los pasa al español; aquí se anota cada pareja para poder volver al inglés.
const nombresAperturas = new Map();
export const nombresRegistrados = () => nombresAperturas;
export function registrarNombre(espanol, ingles) { if (espanol && ingles && espanol !== ingles) nombresAperturas.set(espanol, ingles); }

/** Un número con «d» decimales según el idioma («0,5» en español, «0.5» en inglés). */
export const decimal = (n, d = 1) => Number(n).toLocaleString(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d });

/** Cambia el idioma en caliente: se traduce (o se restaura) lo que hay en pantalla sin recargar la página. */
export async function cambiarIdioma(nuevo, { avisar = true } = {}) {
  if (nuevo === IDIOMA || !IDIOMAS.includes(nuevo)) return;
  try { localStorage.setItem(CLAVE, nuevo); } catch { /* sin almacenamiento */ }
  if (avisar) { try { canal?.postMessage(nuevo); } catch { /* sin canal */ } }
  if (nuevo !== 'es') await cargarDiccionario(nuevo);
  observador?.disconnect(); pendientes.clear();
  restaurarNodo(document.documentElement);                // primero vuelve todo al español: de ahí se traduce a cualquier idioma
  IDIOMA = nuevo; LOCALE = LOCALES[nuevo];
  document.documentElement.lang = IDIOMA;
  if (IDIOMA !== 'es') traducirNodo(document.documentElement);
  observar();
  window.dispatchEvent(new CustomEvent('chessrival-idioma', { detail: IDIOMA }));
}
let canal = null;
try {
  if (HAY_NAVEGADOR) canal = new BroadcastChannel('chessrival-idioma');
  canal.onmessage = (e) => cambiarIdioma(e.data, { avisar: false });
} catch { /* sin canal */ }

// ---------- Traducción ----------

let exactas = new Map(), plantillas = [], nombres = null;

const escapar = (t) => t.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
/** Una plantilla con «{}» pasa a expresión regular; los huecos admiten cualquier texto. */
function aExpresion(plantilla) {
  const partes = plantilla.split('{}');
  return new RegExp(`^${partes.map(escapar).join('(.+?)')}$`, 's');
}

/** Traduce un texto (una frase entera o una con huecos). Si no se conoce, lo devuelve igual. */
export function t(texto) {
  if (IDIOMA === 'es' || typeof texto !== 'string' || !texto.trim()) return texto;
  const lado = /^(\s*)([\s\S]*?)(\s*)$/.exec(texto);
  const [, antes, centro, despues] = lado;
  const limpio = centro.replace(/\s+/g, ' ');           // los saltos de línea y espacios repetidos del HTML no cuentan
  let r = traducirCentro(limpio);
  if (nombres) r = nombres(r);                          // los nombres de aperturas, que van dentro de otras frases
  return r === limpio ? texto : antes + r + despues;
}

function traducirCentro(centro, profundidad = 0) {
  const directa = exactas.get(centro);
  if (directa !== undefined) return directa;
  if (profundidad > 3) return centro;
  for (const p of plantillas) {
    const m = p.re.exec(centro);
    if (!m) continue;
    let i = 0;
    // Los huecos se traducen a su vez: «las {}» → «blancas» → «white».
    return p.en.replace(/\{\}/g, () => { const g = m[++i] ?? ''; return traducirCentro(g, profundidad + 1); });
  }
  return centro;
}

const ATRIBUTOS = ['title', 'aria-label', 'placeholder', 'alt', 'aria-description'];
const IGNORAR = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE']);
const textos = new WeakMap();      // nodo de texto → { es, en }: lo escrito en español y lo que se ha puesto en inglés
const atributos = new WeakMap();   // elemento → { atributo: { es, en } }

function traducirNodo(nodo) {
  if (nodo.nodeType === Node.TEXT_NODE) {
    const v = nodo.nodeValue;
    if (!v || !v.trim()) return;
    const previo = textos.get(nodo);
    if (previo && previo.en === v) return;                 // ya traducido
    const n = t(v);
    if (n !== v) { textos.set(nodo, { es: v, en: n }); nodo.nodeValue = n; }
    return;
  }
  if (nodo.nodeType !== Node.ELEMENT_NODE || IGNORAR.has(nodo.tagName) || nodo.closest?.('[data-sin-traducir]')) return;
  for (const a of ATRIBUTOS) {
    const v = nodo.getAttribute(a);
    if (!v) continue;
    const previo = atributos.get(nodo)?.[a];
    if (previo && previo.en === v) continue;
    const n = t(v);
    if (n !== v) {
      let m = atributos.get(nodo); if (!m) atributos.set(nodo, m = {});
      m[a] = { es: v, en: n }; nodo.setAttribute(a, n);
    }
  }
  for (const hijo of nodo.childNodes) traducirNodo(hijo);
}

/** Devuelve a su texto español lo que se había traducido (si el texto no ha cambiado desde entonces). */
function restaurarNodo(nodo) {
  if (nodo.nodeType === Node.TEXT_NODE) {
    const previo = textos.get(nodo);
    if (previo && previo.en === nodo.nodeValue) nodo.nodeValue = previo.es;
    textos.delete(nodo);
    return;
  }
  if (nodo.nodeType !== Node.ELEMENT_NODE) return;
  const m = atributos.get(nodo);
  if (m) { for (const [a, v] of Object.entries(m)) if (nodo.getAttribute(a) === v.en) nodo.setAttribute(a, v.es); atributos.delete(nodo); }
  for (const hijo of nodo.childNodes) restaurarNodo(hijo);
}

let observador = null, pendientes = new Set(), programado = false;
function vaciar() {
  programado = false;
  // Al desconectar, el navegador descarta los cambios que aún no ha entregado: se recogen antes, para no dejar sin traducir lo que se escribió justo ahora.
  if (observador) anotar(observador.takeRecords());
  observador?.disconnect();
  try {
    for (const n of pendientes) {
      try { if (n.isConnected !== false) traducirNodo(n); } catch (e) { console.warn('ChessRival: no se pudo traducir un nodo', e); }
    }
  } finally { pendientes.clear(); observar(); }
}
function observar() {
  observador?.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATRIBUTOS });
}

/** Identificador corto de un texto español: así los idiomas nuevos solo guardan «identificador → traducción». */
export function claveDe(texto) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

let diccionarioCargado = null;     // el idioma cuyo diccionario está en uso
async function cargarDiccionario(idioma) {
  if (diccionarioCargado === idioma) return;
  const datos = (await import('./i18n-en.js')).default;       // el inglés trae todos los textos españoles; lo que falte en otro idioma se queda en inglés
  let valores = null;
  if (idioma !== 'en') valores = (await import(`./i18n-${idioma}.js`)).default;
  const trad = (es, en) => (valores && valores[claveDe(es)]) || en;
  exactas = new Map(Object.entries(datos.exactas).map(([es, en]) => [es, trad(es, en)]));
  plantillas = Object.entries(datos.plantillas).map(([es, en]) => { const d = trad(es, en); return { es, en: d, re: aExpresion(es) }; }).sort((a, b) => b.es.length - a.es.length);
  nombres ??= (await import('./i18n-en-aperturas.js')).crearTraductorNombres();     // los nombres de aperturas van en inglés en todos los idiomas
  diccionarioCargado = idioma;
}

/** Apunta los nodos que han cambiado, para traducirlos en cuanto toque. */
function anotar(cambios) {
  for (const c of cambios) {
    if (c.type === 'childList') c.addedNodes.forEach(n => pendientes.add(n));
    else pendientes.add(c.target);
  }
}

function crearObservador() {
  observador = new MutationObserver((cambios) => {
    if (IDIOMA === 'es') return;
    anotar(cambios);
    if (!programado) { programado = true; queueMicrotask(vaciar); }
  });
  observar();
}

// Arranque: si el idioma guardado es el inglés, se carga el diccionario y se traduce lo que haya.
if (HAY_NAVEGADOR) crearObservador();
if (HAY_NAVEGADOR && IDIOMA !== 'es') {
  cargarDiccionario(IDIOMA).then(() => traducirNodo(document.documentElement))
    .catch(e => console.warn('ChessRival: no se pudo cargar el idioma', e));
}

// Para comprobar qué falta por traducir: en la consola, «textosSinTraducir()».
if (HAY_NAVEGADOR) window.textosSinTraducir = () => {
  const salida = new Set();
  const parece = /[áéíóúñ¿¡«»]|\b(el|la|los|las|de|del|con|para|por|una?|que|en|se|y|partidas?|jugadas?|jugador|su|sus|ritmo|lento)\b/i;
  const esNombre = (v) => /^[\p{Lu}][\p{L}'’. -]+, [\p{Lu}][\p{L}'’. -]+$/u.test(v) || /^Torneo |^I Open|^[IVX]+ /.test(v);
  const mira = (v, pre = '') => { v = v.trim(); if (v && v.length > 1 && parece.test(v) && !esNombre(v)) salida.add(pre + v.replace(/\s+/g, ' ')); };
  const recorre = (n) => {
    if (n.nodeType === Node.TEXT_NODE) mira(n.nodeValue);
    else if (n.nodeType === Node.ELEMENT_NODE && !IGNORAR.has(n.tagName)) { for (const a of ATRIBUTOS) { const v = n.getAttribute(a); if (v) mira(v, `[${a}] `); } n.childNodes.forEach(recorre); }
  };
  recorre(document.body);
  return [...salida];
};
