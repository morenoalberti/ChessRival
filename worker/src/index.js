// Servidor intermedio de ChessRival (Cloudflare Worker).
// El navegador no puede leer proveedores externos de torneos ni la FIDE por CORS: este Worker los consulta.
//
//   GET /api/torneo?url=…&top=N  → { nombre, jugadores: [{ rank, name, federation, rating, points, fideId }] }
//   GET /api/jugador/verificar?name=&fideId=&federation=&rating=  → el jugador con su ID FIDE, federación, título y edad corregidos
//   GET /api/fide/buscar?q=…     → [{ fideId, nombre, titulo, federacion, elo, eloStandard, eloRapid, eloBlitz, nacimiento }]
//   GET /api/fide/ficha?id=…     → { titulo, edad }
//   GET /api/fide/estadisticas?id=…  → { titulo, edad, bloques: [{ titulo, elo, blancas, negras }] }
//   GET /api/fide/historial?id=…     → [{ fecha: 'AAAA-MM', standard, rapid, blitz }]
//   GET /api/fide/foto?id=…      → la imagen del perfil de la FIDE (404 si no tiene)
import { parse } from 'node-html-parser';
import { normalizarTitulosFide } from '../../js/titulos-fide.js';
import { consultarTwic, sincronizarTwic } from './twic.js';
import { consultarLumbra, guardarLumbraLote } from './lumbra.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ChessRival/1.0';

// ---------- Utilidades ----------

class ErrorUsuario extends Error {
  constructor(mensaje, estado = 400) { super(mensaje); this.estado = estado; }
}

function cabecerasCors(request, env) {
  const permitidos = (env.ORIGENES_PERMITIDOS ?? '*').split(',').map(s => s.trim()).filter(Boolean);
  const origen = request.headers.get('Origin') ?? '';
  const ok = permitidos.includes('*') || permitidos.includes(origen);
  return {
    'Access-Control-Allow-Origin': permitidos.includes('*') ? '*' : ok ? origen : permitidos[0] ?? '',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Clave-Ia',
    'Vary': 'Origin'
  };
}

const json = (datos, cors, { status = 200, ...cabeceras } = {}) =>
  new Response(JSON.stringify(datos), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors, ...cabeceras } });

/** Descarga una página y la decodifica con la codificación que declara. */
/** La misma dirección con un parámetro nuevo: la FIDE guarda en caché, a veces, una respuesta vacía y la sirve una y otra vez para esa dirección exacta. */
const REINTENTOS_FIDE = 1;
const pausa = (ms) => new Promise(r => setTimeout(r, ms));
const sinCache = (url) => `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`;

async function descargarHtml(url, cabeceras = {}, intento = 0) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es,en;q=0.8', ...cabeceras }, redirect: 'follow',
    signal: new URL(url).hostname === 'ratings.fide.com' ? AbortSignal.timeout(8000) : undefined });
  if (!r.ok) throw new ErrorUsuario(`${new URL(url).hostname} respondió con el error ${r.status}.`, 502);
  const bytes = await r.arrayBuffer();
  if (bytes.byteLength <= 8 && intento < REINTENTOS_FIDE) { await pausa(700 * (intento + 1)); return descargarHtml(sinCache(url), cabeceras, intento + 1); }   // vacía (solo el BOM): se vuelve a pedir
  const tipo = r.headers.get('content-type') ?? '';
  const charset = /charset=([\w-]+)/i.exec(tipo)?.[1]
    ?? /charset=["']?([\w-]+)/i.exec(new TextDecoder('latin1').decode(bytes.slice(0, 2048)))?.[1] ?? 'utf-8';
  try { return new TextDecoder(charset).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

const texto = (nodo) => (nodo?.text ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const celdasDe = (fila) => fila.querySelectorAll('td');
const cabecerasDe = (tabla) => (tabla.querySelector('tr th') ? tabla.querySelectorAll('tr').find(f => f.querySelector('th')).querySelectorAll('th').map(texto) : []);
const columna = (cabeceras, ...nombres) => cabeceras.findIndex(h => nombres.some(n => n.toLowerCase() === h.toLowerCase()));
const sinTildes = (t) => t.normalize('NFD').replace(/\p{M}/gu, '').replace(/,/g, ' ').toLowerCase();
const celda = (celdas, i) => (i >= 0 && i < celdas.length ? celdas[i] : '');
const entero = (t) => { const n = parseInt(t, 10); return Number.isFinite(n) ? n : 0; };

// ---------- Torneos ----------

function esChessResults(u) { return u.hostname.toLowerCase().endsWith('chess-results.com'); }
function esInfo64(u) { return u.hostname.toLowerCase().includes('info64'); }
function esChessRoster(u) { return u.hostname.toLowerCase() === 'chessroster.com' || u.hostname.toLowerCase().endsWith('.chessroster.com'); }
function esVegaResults(u) { return u.hostname.toLowerCase() === 'vegaresults.com' || u.hostname.toLowerCase() === 'www.vegaresults.com'; }
function esChessRegister(u) { return u.hostname.toLowerCase() === 'chessregister.com' || u.hostname.toLowerCase() === 'www.chessregister.com'; }

const MAX_JUGADORES = 400;

async function cargarTorneo(texto_, top = 5) {
  let u;
  try { u = new URL((texto_ ?? '').trim()); } catch { throw new ErrorUsuario('La URL no es válida.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new ErrorUsuario('La URL debe empezar por http:// o https://.');
  if (esChessResults(u)) return cargarChessResults(u, top);
  if (esInfo64(u)) return cargarInfo64(u, top);
  if (esChessRoster(u)) return cargarChessRoster(u, top);
  if (esChessRegister(u)) return cargarChessRegister(u, top);
  if (esVegaResults(u)) return cargarVegaResults(u, top);
  throw new ErrorUsuario('No reconozco este proveedor. Prueba con Chess-Results, Info64, ChessRoster, ChessRegister o VegaResults.');
}

function mejoresPorRating(jugadores, top) {
  const ordenados = jugadores
    .filter(j => j.name)
    .sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0) || (Number(a.rank) || 0) - (Number(b.rank) || 0));
  const mejores = top > 0 ? ordenados.slice(0, top) : ordenados;
  return mejores.map((j, i) => ({ ...j, rank: i + 1 }));
}

async function cargarChessResults(u, top = 5) {
  const tnr = /tnr(\d+)/i.exec(u.search + u.pathname)?.[1];
  if (!tnr) throw new ErrorUsuario('No se encontró el número de torneo (tnr…) en la URL.');
  const clasificacion = `https://chess-results.com/tnr${tnr}.aspx?lan=2&art=1&zeilen=0`;

  const doc = parse(await descargarHtml(clasificacion));
  const nombre = texto(doc.querySelector('h2')) || 'Torneo';

  const tabla = doc.querySelectorAll('table.CRs1').find(t => cabecerasDe(t).some(h => h === 'Name' || h === 'Nombre'));
  if (!tabla) throw new ErrorUsuario('No se encontró la clasificación. Usa un enlace de Chess-Results que muestre la clasificación final o actual.', 422);

  const cab = cabecerasDe(tabla);
  const c = {
    rank: columna(cab, 'Rk.', 'Clas.', 'Rank'), nombre: columna(cab, 'Name', 'Nombre'), fed: columna(cab, 'FED', 'Fed'),
    elo: columna(cab, 'RtgI', 'Rtg', 'Elo', 'EloI'), pts: columna(cab, 'Pts.', 'Pts', 'Puntos'),
    fide: columna(cab, 'FideID', 'FIDE-ID', 'ID'), sno: columna(cab, 'No.Ini.', 'SNo', 'No.')
  };

  const jugadores = [];
  for (const fila of tabla.querySelectorAll('tr').filter(f => f.querySelector('td')).slice(0, MAX_JUGADORES)) {
    const tds = celdasDe(fila);
    const cs = tds.map(texto);
    if (c.nombre < 0 || c.nombre >= cs.length || !cs[c.nombre]) continue;
    jugadores.push({
      rank: c.rank >= 0 && entero(cs[c.rank]) ? entero(cs[c.rank]) : jugadores.length + 1,
      name: cs[c.nombre], federation: celda(cs, c.fed), rating: entero(celda(cs, c.elo)),
      points: celda(cs, c.pts), fideId: celda(cs, c.fide),
      _sno: entero(celda(cs, c.sno)), _profileHref: tds[c.nombre].querySelector('a[href]')?.getAttribute('href') ?? null
    });
  }
  if (jugadores.length === 0) throw new ErrorUsuario('La clasificación está vacía.', 422);

  const seleccionados = mejoresPorRating(jugadores, top);

  // La clasificación suele no traer el ID FIDE: primero se busca en el listado por ranking inicial y,
  // si aun así falta, en la ficha individual del jugador.
  if (seleccionados.some(j => !j.fideId)) {
    try {
      const { porNumero, porNombre } = await idsFideDeLaLista(clasificacion);
      seleccionados.forEach(j => {
        if (j.fideId) return;
        j.fideId = (j._sno > 0 && porNumero.get(j._sno)) || porNombre.get(normalizarNombre(j.name)) || '';
      });
    } catch { /* se sigue con las fichas individuales */ }
  }

  let consultas = 0;   // un Worker tiene un máximo de subpeticiones por llamada: solo las fichas de los primeros
  await Promise.all(seleccionados.map(async j => {
    if (j.fideId || !j._profileHref || ++consultas > 12) return;
    try {
      const ficha = await descargarHtml(new URL(j._profileHref.replace(/&amp;/g, '&'), clasificacion).href);
      j.fideId = idFideDeFicha(ficha);
    } catch { /* sin ID FIDE no hay foto, pero la tarjeta se muestra igual */ }
  }));

  return { nombre, jugadores: seleccionados.map(({ _sno, _profileHref, ...j }) => j) };
}

const normalizarNombre = (n) => n.toLowerCase().replace(/\s+/g, ' ').trim();

async function idsFideDeLaLista(clasificacion) {
  const porNumero = new Map(), porNombre = new Map();
  const doc = parse(await descargarHtml(clasificacion.replace(/art=\d+/, 'art=0')));
  const reFide = /FIDE[\s-]*ID/i;
  const tabla = doc.querySelectorAll('table.CRs1').find(t => cabecerasDe(t).some(h => reFide.test(h)));
  if (!tabla) return { porNumero, porNombre };

  const cab = cabecerasDe(tabla);
  const cFide = cab.findIndex(h => reFide.test(h)), cNombre = columna(cab, 'Name', 'Nombre'), cNo = columna(cab, 'No.', 'SNo', 'No.Ini.');
  for (const fila of tabla.querySelectorAll('tr').filter(f => f.querySelector('td')).slice(0, MAX_JUGADORES)) {
    const cs = celdasDe(fila).map(texto);
    const id = /\d{3,}/.exec(celda(cs, cFide))?.[0];
    if (!id) continue;
    const no = entero(celda(cs, cNo));
    if (no) porNumero.set(no, id);
    const nombre = celda(cs, cNombre);
    if (nombre) porNombre.set(normalizarNombre(nombre), id);
  }
  return { porNumero, porNombre };
}

function idFideDeFicha(html) {
  const doc = parse(html);
  for (const fila of doc.querySelectorAll('tr')) {
    const tds = celdasDe(fila);
    if (tds.length !== 2) continue;
    if (!/FIDE[\s-]*(ID|Code)|C[oó]digo\s+FIDE|FIDE[\s-]*Nr/i.test(texto(tds[0]))) continue;
    const digitos = /\d{3,}/.exec(texto(tds[1]))?.[0];
    if (digitos) return digitos;
  }
  return '';
}

async function cargarInfo64(u, top = 5) {
  const doc = parse(await descargarHtml(u.href));
  const nombre = texto(doc.querySelector('h1')) || 'Torneo';

  // La tabla habitual es la de orden de salida; por si cambia, se acepta cualquier tabla con columna «Name».
  const tabla = doc.querySelector('table#initial-ranking-table')
    ?? doc.querySelectorAll('table').find(t => t.querySelector('th') && cabecerasInfo64(t).some(h => h === 'Name' || h === 'Nombre'));
  if (!tabla) throw new ErrorUsuario('No se encontró la lista de jugadores en la página de Info64.', 422);

  const cab = cabecerasInfo64(tabla);
  const c = {
    rank: columna(cab, 'Ran.', 'Rank', 'Pos', 'Nº'), nombre: columna(cab, 'Name', 'Nombre'), fed: columna(cab, 'Fed.', 'FED', 'Fed'),
    elo: columna(cab, 'FIDE', 'Elo', 'Rtg'), pts: columna(cab, 'Pts.', 'Pts', 'Points'), fide: columna(cab, 'FIDE ID', 'FIDE-ID', 'FideID')
  };

  const jugadores = [];
  for (const fila of tabla.querySelectorAll('tr').filter(f => f.querySelector('td'))) {
    const cs = celdasDe(fila).map(texto);
    if (c.nombre < 0 || c.nombre >= cs.length || !cs[c.nombre]) continue;
    jugadores.push({
      rank: c.rank >= 0 && entero(celda(cs, c.rank)) ? entero(celda(cs, c.rank)) : jugadores.length + 1,
      name: cs[c.nombre], federation: celda(cs, c.fed), rating: entero(celda(cs, c.elo)),
      points: celda(cs, c.pts), fideId: celda(cs, c.fide)
    });
  }
  if (jugadores.length === 0) throw new ErrorUsuario('La lista de jugadores de Info64 está vacía.', 422);
  return { nombre, jugadores: mejoresPorRating(jugadores, top) };
}

async function cargarChessRoster(u, top = 5) {
  const html = await descargarHtml(u.href);
  const doc = parse(html);
  const nombre = texto(doc.querySelector('h1')) || 'Torneo ChessRoster';
  let rosterUrl = u;
  if (!/\/roster\/?(?:\?|$)/i.test(u.pathname)) {
    const enlace = doc.querySelectorAll('a[href]').find(a => /\/roster\/?(?:\?|$)/i.test(a.getAttribute('href') || ''));
    if (!enlace) throw new ErrorUsuario('Esta página de ChessRoster no publica una lista de inscritos.', 422);
    rosterUrl = new URL(enlace.getAttribute('href').replace(/&amp;/g, '&'), u);
    if (!esChessRoster(rosterUrl)) throw new ErrorUsuario('El enlace de inscritos de ChessRoster no es válido.');
  }
  const rosterHtml = rosterUrl.href === u.href ? html : await descargarHtml(rosterUrl.href);
  // ChessRoster genera la lista en el estado RSC de Next.js. Se extrae solo la estructura
  // pública incrustada en la propia página, sin llamar a endpoints privados de su aplicación.
  const inicio = rosterHtml.indexOf('tournamentRegistrations');
  if (inicio < 0) throw new ErrorUsuario('ChessRoster no ha publicado inscritos para este torneo.', 422);
  const fragmento = rosterHtml.slice(inicio);
  const patron = /\\"name\\":\\"((?:\\\\.|[^\\"\\])*)\\",\\"uscfId\\":(?:\\"([^\\"]*)\\"|null),\\"fideId\\":(?:\\"([^\\"]*)\\"|null),\\"cfcId\\":(?:\\"([^\\"]*)\\"|null),\\"pairingRating\\":(\d+),\\"withdrew\\":(true|false),\\"registrationTeamId\\":(null|\\"[^\\"]*\\"),\\"isTeamEntry\\":(true|false)/g;
  const jugadores = [];
  for (const m of fragmento.matchAll(patron)) {
    if (m[6] === 'true' || m[8] === 'true') continue;
    const nombreJugador = m[1].replace(/\\\\"/g, '"').replace(/\\\\\\/g, '\\').trim();
    if (!nombreJugador) continue;
    jugadores.push({ rank: jugadores.length + 1, name: nombreJugador, federation: 'USA', rating: entero(m[5]), points: '', fideId: m[3] || '' });
    if (jugadores.length >= MAX_JUGADORES) break;
  }
  if (!jugadores.length) throw new ErrorUsuario('La lista pública de ChessRoster no contiene jugadores.', 422);
  return { nombre, jugadores: mejoresPorRating(jugadores, top) };
}

async function cargarChessRegister(u, top = 5) {
  const eventKey = u.searchParams.get('event_key');
  if (!eventKey) throw new ErrorUsuario('Pega el enlace del evento de ChessRegister, que debe incluir event_key.');
  const rosterUrl = new URL('/registrants', u.origin);
  rosterUrl.searchParams.set('event_key', eventKey);
  const doc = parse(await descargarHtml(rosterUrl.href));
  const tabla = doc.querySelector('table.registrant-table');
  if (!tabla) throw new ErrorUsuario('ChessRegister no publica la lista de inscritos de este evento.', 422);
  const jugadores = [];
  for (const fila of tabla.querySelectorAll('tr').filter(f => f.querySelector('td')).slice(0, MAX_JUGADORES)) {
    const cs = celdasDe(fila).map(texto);
    const name = celda(cs, 0);
    if (!name) continue;
    jugadores.push({ rank: jugadores.length + 1, name, federation: 'USA', rating: entero(celda(cs, 1)), points: '', fideId: '' });
  }
  if (!jugadores.length) throw new ErrorUsuario('La lista pública de ChessRegister no contiene inscritos.', 422);
  const nombre = texto(doc.querySelector('h1')) || texto(doc.querySelector('h2')) || 'Torneo ChessRegister';
  return { nombre: nombre.replace(/^Event Registrants\s*[—-]?\s*/i, '').trim() || 'Torneo ChessRegister', jugadores: mejoresPorRating(jugadores, top) };
}

async function cargarVegaResults(u, top = 5) {
  let ids = [];
  const page = u.pathname.toLowerCase();
  if (page.startsWith('/vega/index.php')) {
    const id = u.searchParams.get('id');
    if (!id) throw new ErrorUsuario('No se encontró el identificador del torneo de VegaResults.');
    ids = [id];
  } else if (/^\/vr\/\d+\/?$/.test(u.pathname)) {
    const doc = parse(await descargarHtml(u.href));
    ids = [...new Set(doc.querySelectorAll('a[href]')
      .filter(a => /\/vega\/index\.php\?id=\d+/i.test(a.getAttribute('href') || ''))
      .map(a => /[?&]id=(\d+)/i.exec(a.getAttribute('href'))?.[1]).filter(Boolean))].slice(0, 8);
    if (!ids.length) throw new ErrorUsuario('La página de VegaResults no tiene una clasificación publicada todavía.', 422);
  } else {
    throw new ErrorUsuario('Pega la página del evento de VegaResults o el enlace «Results» de una sección.');
  }
  const listas = await Promise.all(ids.map(async id => {
    const url = new URL(`/vega/index.php?page=players&id=${encodeURIComponent(id)}`, u.origin);
    const html = await descargarHtml(url.href);
    const doc = parse(html);
    const tabla = doc.querySelector('table#players-table')
      ?? doc.querySelectorAll('table').find(t => /NAME/i.test(texto(t.querySelector('thead')) || '') && /RtgF/i.test(texto(t.querySelector('thead')) || ''));
    if (!tabla) return { nombre: '', jugadores: [] };
    const cab = tabla.querySelectorAll('thead th').map(texto);
    const cNombre = cab.findIndex(h => /\bNAME\b|NOMBRE/i.test(h));
    const cFed = cab.findIndex(h => /^Fed$/i.test(h));
    const cFide = cab.findIndex(h => /FIDE\s*ID/i.test(h));
    const cFideRtg = cab.findIndex(h => /RtgF/i.test(h));
    const cNatRtg = cab.findIndex(h => /RtgN/i.test(h));
    const filas = tabla.querySelectorAll('tbody tr').slice(0, MAX_JUGADORES);
    const jugadores = filas.map((fila, i) => {
      const tds = celdasDe(fila), cs = tds.map(texto);
      const fideRating = entero(celda(cs, cFideRtg));
      return { rank: i + 1, name: celda(cs, cNombre), federation: celda(cs, cFed), rating: fideRating || entero(celda(cs, cNatRtg)), points: '', fideId: /\d{3,}/.exec(celda(cs, cFide))?.[0] || '' };
    }).filter(j => j.name);
    return { nombre: texto(doc.querySelector('title')).replace(/\s*[|–-].*$/, ''), jugadores };
  }));
  const porNombre = new Map();
  for (const { jugadores } of listas) for (const j of jugadores) {
    const clave = j.fideId ? `f:${j.fideId}` : `n:${normalizarNombre(j.name)}`;
    if (!porNombre.has(clave) || porNombre.get(clave).rating < j.rating) porNombre.set(clave, j);
  }
  const jugadores = mejoresPorRating([...porNombre.values()], top);
  if (!jugadores.length) throw new ErrorUsuario('VegaResults no muestra una lista pública de jugadores para esta sección.', 422);
  const titulo = listas.map(x => x.nombre).find(Boolean) || 'Torneo';
  return { nombre: `${titulo} · VegaResults`, jugadores };
}

const cabecerasInfo64 = (tabla) => tabla.querySelectorAll('tr').flatMap(f => f.querySelectorAll('th')).map(texto);

// ---------- FIDE ----------

const CAB_FIDE = { 'Referer': 'https://ratings.fide.com/', 'X-Requested-With': 'XMLHttpRequest' };

async function consultarFide(palabras) {
  // La FIDE solo entiende los espacios como «+»: con «%20» no devuelve nada.
  const consulta = palabras.map(encodeURIComponent).join('+');
  const doc = parse(await descargarHtml(`https://ratings.fide.com/incl_search_l.php?search=${consulta}&simple=1`, CAB_FIDE));
  const candidatos = [];
  for (const fila of doc.querySelectorAll('table#table_results tbody tr')) {
    const tds = celdasDe(fila);
    const enlace = fila.querySelector('a.found_name');
    if (tds.length < 9 || !enlace) continue;
    const t = tds.map(texto);
    candidatos.push({
      fideId: t[0], nombre: texto(enlace), titulo: t[2], federacion: t[4],
      eloStandard: entero(t[5]), eloRapid: entero(t[6]), eloBlitz: entero(t[7]), nacimiento: t[8]
    });
  }
  return candidatos.map(c => ({ ...c, elo: c.eloStandard || c.eloRapid || c.eloBlitz }));
}

/** Los jugadores que encajan con lo escrito, de más a menos Elo. Con solo números se busca por ID FIDE.
 *  Si hay palabras, todas deben aparecer en el nombre (sin importar el orden, las tildes ni las mayúsculas). */
async function buscarFide(q) {
  q = (q ?? '').trim();
  if (!q) return [];
  const partes = q.split(/\s+/).filter(Boolean);
  // La FIDE no encuentra nada con tres o más palabras que no coinciden con su orden: se prueba con todas y,
  // si no sale nada, con las dos primeras y con las dos últimas; luego se filtra con todas.
  const intentos = [partes];
  if (partes.length > 2) intentos.push(partes.slice(0, 2), partes.slice(-2));

  let candidatos = [];
  let fallo = null;
  for (const intento of intentos) {
    try { candidatos = await consultarFide(intento); }
    catch (ex) { fallo = ex; break; }
    if (!/^\d+$/.test(q)) {
      const palabras = sinTildes(q).split(/\s+/).filter(Boolean);
      candidatos = candidatos.filter(c => { const n = sinTildes(c.nombre); return palabras.every(p => n.includes(p)); });
    }
    if (candidatos.length > 0) break;
  }
  if (!candidatos.length) {
    const respaldo = await buscarLichess(q);
    if (respaldo.length) candidatos = respaldo;
    else if (fallo) throw fallo;
  }
  return candidatos.sort((a, b) => b.elo - a.elo || a.nombre.localeCompare(b.nombre)).slice(0, 60);
}

// ---------- Comprobar los jugadores de un torneo contra la FIDE ----------
// Muchos torneos (sobre todo los de federaciones autonómicas) traen en «FIDE-ID» un número propio que no es un ID FIDE,
// y en «FED» un código regional («CA»). Si el ID no corresponde a ese nombre en la FIDE, se busca al jugador por nombre
// (y por Elo si hay varios). Así salen bien la foto, el título, la edad y la bandera.

const RE_TITULO_FINAL = /(\s+(?:GM|IM|FM|CM|WGM|WIM|WFM|WCM|AGM|AIM|AFM|ACM))+$/i;
const limpiarNombreJugador = (n) => n.replace(RE_TITULO_FINAL, '').trim();

function coincideNombre(a, b) {
  const pa = sinTildes(a).split(/\s+/).filter(Boolean), pb = sinTildes(b).split(/\s+/).filter(Boolean);
  const na = pa.join(' '), nb = pb.join(' ');
  return pa.every(p => nb.includes(p)) || pb.every(p => na.includes(p));
}

/** Comprueba a un jugador contra la FIDE y devuelve sus datos corregidos (ID, federación, títulos, edad). */
async function verificarJugador(j) {
  const nombre = limpiarNombreJugador(j.name);
  let c = null;

  if (/^\d+$/.test(j.fideId)) {
    const porId = (await buscarFide(j.fideId)).find(x => x.fideId === j.fideId);
    if (porId && coincideNombre(nombre, porId.nombre)) c = porId;
  }
  if (!c) {
    const porNombre = await buscarFide(nombre);
    if (porNombre.length === 1) c = porNombre[0];
    else if (porNombre.length > 1 && j.rating > 0) {
      const cerca = porNombre.filter(x => x.elo > 0).map(x => ({ x, d: Math.abs(x.elo - j.rating) })).sort((a, b) => a.d - b.d);
      if (cerca.length && cerca[0].d <= 150 && (cerca.length === 1 || cerca[1].d - cerca[0].d >= 25)) c = cerca[0].x;
    }
  }

  j.name = nombre;
  if (!c) { if (!/^\d{6,}$/.test(j.fideId)) j.fideId = ''; return j; }   // un ID corto que no es de la FIDE no sirve para nada
  j.fideId = c.fideId;
  if (!/^[A-Z]{3}$/.test(j.federation) || j.federation !== c.federacion) j.federation = c.federacion || j.federation;
  if (!j.rating) j.rating = c.elo;
  // Todos los títulos del perfil (FIDE y Arena: GM, FM, AIM, AFM, AGM…) y la edad; si el perfil no responde, los de la búsqueda.
  try {
    const ficha = await fichaFide(c.fideId);
    if (ficha.titulo) j.fideTitle = ficha.titulo.replace(/ · /g, '/');
    if (ficha.edad) j.age = ficha.edad;
    if (ficha.titulo || ficha.edad) j.titulosOk = true;
  } catch { /* se usan los datos de la búsqueda */ }
  if (!j.fideTitle && abreviarTitulo(c.titulo ?? '')) j.fideTitle = abreviarTitulo(c.titulo);
  const nac = entero(c.nacimiento), actual = new Date().getFullYear();
  if (!j.age && nac > 1900 && nac <= actual) j.age = `${actual - nac} años`;
  return j;
}

function abreviarTitulo(t) {
  return normalizarTitulosFide(t);
}

/** Título(s) y edad del jugador, de su perfil público. */
async function fichaFide(id) {
  if (!/^\d+$/.test(id ?? '')) throw new ErrorUsuario('ID FIDE no válido.');
  const html = await descargarHtml(sinCache(`https://ratings.fide.com/profile/${id}/statistics`), {}, REINTENTOS_FIDE).catch(() => '');
  const perfil = datosDePerfil(html);
  if (perfilValido(perfil)) return { titulo: perfil.titulo, edad: perfil.edad, fuente: 'FIDE', titulosCompletos: true };
  const l = await jugadorLichess(id);
  return l ? { titulo: normalizarTitulosFide(l.title), edad: perfilDeLichess(l).edad, fuente: 'Lichess', titulosCompletos: false } : { titulo: '', edad: '' };
}



// ---------- Respaldo: Lichess ----------
// La FIDE rechaza (o deja en blanco) las peticiones que vienen de servidores como los de Cloudflare. Lichess publica sin límite estos mismos datos
// (título, año de nacimiento, Elo por ritmo, foto e historial del Elo), así que se usa cuando la FIDE no responde.
// Lo que Lichess no tiene son los resultados con blancas y negras: esas tarjetas salen solo con el Elo.

async function jugadorLichess(id) {
  try {
    const r = await fetch(`https://lichess.org/api/fide/player/${id}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    const l = r.ok ? await r.json() : null;
    return l && String(l.id) === String(id) && typeof l.name === 'string' && l.name.trim() ? l : null;
  } catch { return null; }
}

async function buscarLichess(q) {
  try {
    const lista = /^\d+$/.test(q) ? [await jugadorLichess(q)] : await (async () => {
      const r = await fetch(`https://lichess.org/api/fide/player/search?q=${encodeURIComponent(q)}`, {
        headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
      });
      return r.ok ? await r.json() : [];
    })();
    const palabras = sinTildes(q).split(/\s+/).filter(Boolean);
    return (Array.isArray(lista) ? lista : []).filter(l => l && /^\d+$/.test(String(l.id)) && typeof l.name === 'string'
      && (/^\d+$/.test(q) ? String(l.id) === q : palabras.every(p => sinTildes(l.name).includes(p)))).map(l => ({
      fideId: String(l.id), nombre: l.name, titulo: l.title ?? '', federacion: l.federation ?? '',
      eloStandard: entero(l.standard), eloRapid: entero(l.rapid), eloBlitz: entero(l.blitz),
      elo: entero(l.standard) || entero(l.rapid) || entero(l.blitz), nacimiento: l.year ? String(l.year) : ''
    }));
  } catch { return []; }
}

const perfilValido = p => !!(p.nombre || p.nacimiento || p.titulo || Object.values(p.elos).some(Boolean));

function perfilDeLichess(l) {
  const actual = new Date().getFullYear();
  const ok = l.year > 1900 && l.year <= actual;
  return {
    titulo: normalizarTitulosFide(l.title), edad: ok ? `${actual - l.year} años` : '', nombre: l.name ?? '', nacimiento: ok ? l.year : null,
    fuente: 'Lichess', titulosCompletos: false,
    genero: l.gender === 'F' ? 'Mujer' : l.gender === 'M' ? 'Hombre' : '',
    federacionNombre: l.federation ?? '', paisCodigo: '',
    elos: { standard: l.standard ? String(l.standard) : '', rapid: l.rapid ? String(l.rapid) : '', blitz: l.blitz ? String(l.blitz) : '' },
    clasificaciones: []
  };
}

/** Tarjetas solo con el Elo (sin resultados): lo que se puede ofrecer cuando solo hay datos de Lichess. */
function bloquesSoloElo(elos) {
  return [['Standard', elos.standard], ['Rapid', elos.rapid], ['Blitz', elos.blitz]].filter(([, e]) => e).map(([titulo, elo]) => ({ titulo, elo, blancas: null, negras: null }));
}

/** Foto del jugador en Wikimedia Commons, buscada por su ID FIDE en Wikidata (propiedad P1440): es una coincidencia exacta, no por nombre. */
async function fotoWikidata(id) {
  try {
    const api = 'https://www.wikidata.org/w/api.php';
    const b = await (await fetch(`${api}?action=query&list=search&srsearch=${encodeURIComponent(`haswbstatement:P1440=${id}`)}&format=json&srlimit=1`, { headers: { 'User-Agent': UA } })).json();
    const q = b?.query?.search?.[0]?.title;
    if (!/^Q\d+$/.test(q ?? '')) return null;
    const c = await (await fetch(`${api}?action=wbgetclaims&entity=${q}&property=P18&format=json`, { headers: { 'User-Agent': UA } })).json();
    const fichero = c?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (!fichero) return null;
    const r = await fetch(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fichero)}?width=400`, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    return r.ok ? r : null;
  } catch { return null; }
}

async function historialLichess(id) {
  try {
    const r = await fetch(`https://lichess.org/fide/${id}/x`, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const m = /fideRatingChart',\{init:(\{.*?\])\}/s.exec(await r.text());
    if (!m) return [];
    const d = JSON.parse(m[1] + '}');
    const porFecha = new Map();
    for (const [ritmo, lista] of Object.entries(d)) {
      for (const n of lista) {
        const fecha = `${String(n).slice(0, 4)}-${String(n).slice(4, 6)}`, rating = n % 10000;
        if (!porFecha.has(fecha)) porFecha.set(fecha, { fecha, standard: null, rapid: null, blitz: null });
        porFecha.get(fecha)[ritmo] = rating;
      }
    }
    const puntos = [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
    for (const ritmo of ['standard', 'rapid', 'blitz']) {       // cada lista tiene sus propias fechas: se arrastra el último Elo para que las líneas no se corten
      let ultimo = null;
      for (const p of puntos) { if (p[ritmo] !== null) ultimo = p[ritmo]; else p[ritmo] = ultimo; }
    }
    return puntos;
  } catch { return []; }
}

// ---------- Ficha completa de la FIDE: Elo por ritmo, resultados por color e historial ----------

const CAB_AJAX = (id, pagina) => ({ 'Referer': `https://ratings.fide.com/profile/${id}/${pagina}`, 'X-Requested-With': 'XMLHttpRequest' });

async function jsonFide(url, cabeceras, intento = 0) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...cabeceras }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new ErrorUsuario(`La FIDE respondió con el error ${r.status}.`, 502);
  const t = (await r.text()).replace(/^\uFEFF/, '').trim();
  if (!t && intento < REINTENTOS_FIDE) { await pausa(700 * (intento + 1)); return jsonFide(sinCache(url), cabeceras, intento + 1); }   // vacía: se vuelve a pedir
  return t ? JSON.parse(t) : null;
}

function ratingDePerfil(html, clase) {
  const m = new RegExp(clase + String.raw`[^"]*"[^>]*>[\s\S]*?<p>([^<]+)</p>`, 'i').exec(html);
  const t = m ? m[1].trim() : '';
  return /^\d+$/.test(t) ? t : '';
}

/** Título(s), edad, Elo por ritmo y resultados con blancas y negras: lo que enseña la franja de la ficha. */
async function estadisticasFide(id) {
  if (!/^\d+$/.test(id ?? '')) throw new ErrorUsuario('ID FIDE no válido.');
  // FIDE primero; Lichess solo si no se consigue un perfil válido de la fuente oficial.
  const [html, datos] = await Promise.all([
    descargarHtml(sinCache(`https://ratings.fide.com/profile/${id}/statistics`), {}, REINTENTOS_FIDE).catch(() => ''),
    jsonFide(sinCache(`https://ratings.fide.com/a_data_stats.php?id1=${id}&id2=0`), CAB_AJAX(id, 'statistics'), REINTENTOS_FIDE).catch(() => null)
  ]);
  const perfil = datosDePerfil(html);
  if (!perfilValido(perfil)) {
    const l = await jugadorLichess(id);
    if (l) { const respaldo = perfilDeLichess(l); return { bloques: bloquesSoloElo(respaldo.elos), parcial: true, ...respaldo }; }
    return { bloques: [] };
  }
  const fila = Array.isArray(datos) && datos[0] && typeof datos[0] === 'object' && ('white_total' in datos[0] || 'black_total' in datos[0]) ? datos[0] : null;
  if (!fila) return { bloques: bloquesSoloElo(perfil.elos), parcial: true, ...perfil };

  const v = (campo) => entero(String(fila[campo] ?? '0'));
  const elos = { Standard: ratingDePerfil(html, 'profile-standart'), Rapid: ratingDePerfil(html, 'profile-rapid'), Blitz: ratingDePerfil(html, 'profile-blitz') };
  const bloque = (titulo, suf) => {
    const tb = v(`white_total${suf}`), vb = v(`white_win_num${suf}`), db = v(`white_draw_num${suf}`);
    const tn = v(`black_total${suf}`), vn = v(`black_win_num${suf}`), dn = v(`black_draw_num${suf}`);
    return {
      titulo, elo: elos[titulo] ?? '',
      blancas: { total: tb, victorias: vb, tablas: db, derrotas: Math.max(0, tb - vb - db) },
      negras: { total: tn, victorias: vn, tablas: dn, derrotas: Math.max(0, tn - vn - dn) }
    };
  };
  return {
    bloques: [bloque('Total', ''), bloque('Standard', '_std'), bloque('Rapid', '_rpd'), bloque('Blitz', '_blz')],
    ...perfil
  };
}

export function datosDePerfil(html) {
  const doc = parse(html);
  const titulos = [];
  for (const h of doc.querySelectorAll('h5')) {
    if (!/^(?:FIDE|FOA|Arena)\s+title$/i.test(texto(h))) continue;
    const hermanos = h.parentNode.childNodes;
    const siguiente = hermanos.slice(hermanos.indexOf(h) + 1).find(n => n.nodeType === 1);
    if (!siguiente?.getAttribute('class')?.split(/\s+/).includes('profile-info-title')) continue;
    titulos.push(texto(siguiente.querySelector('p') ?? siguiente));
  }
  const anio = entero(/class="profile-info-byear\s*"[^>]*>([^<]*)</i.exec(html)?.[1] ?? '');
  const actual = new Date().getFullYear();
  const genero = texto(doc.querySelector('.profile-info-sex'));
  const pais = doc.querySelector('.profile-info-country');
  const clasificaciones = doc.querySelectorAll('.profile-rank-block').map(b => {
    const filas = b.querySelectorAll('.profile-rank-row');
    const valor = patron => texto(filas.find(f => patron.test(texto(f.querySelector('h6'))))?.querySelector('p'));
    return { nombre: texto(b.querySelector('h5')), activos: valor(/active players/i), todos: valor(/all players/i) };
  }).filter(r => r.nombre);
  return {
    titulo: normalizarTitulosFide(titulos).replace(/\//g, ' · '), edad: anio > 1900 && anio <= actual ? `${actual - anio} años` : '',
    fuente: 'FIDE', titulosCompletos: true,
    nombre: texto(doc.querySelector('.player-title')), nacimiento: anio > 1900 && anio <= actual ? anio : null,
    genero: /^male$/i.test(genero) ? 'Hombre' : /^female$/i.test(genero) ? 'Mujer' : genero,
    federacionNombre: texto(pais), paisCodigo: /\/flags\/([a-z]{2})\./i.exec(pais?.querySelector('img')?.getAttribute('src') ?? '')?.[1]?.toUpperCase() ?? '',
    elos: { standard: ratingDePerfil(html, 'profile-standart'), rapid: ratingDePerfil(html, 'profile-rapid'), blitz: ratingDePerfil(html, 'profile-blitz') },
    clasificaciones
  };
}

const MESES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** La evolución del Elo mes a mes (Standard, Rapid y Blitz; null si ese mes no tenía). */
async function historialElo(id) {
  if (!/^\d+$/.test(id ?? '')) throw new ErrorUsuario('ID FIDE no válido.');
  const datos = await jsonFide(sinCache(`https://ratings.fide.com/a_chart_data.phtml?event=${id}&period=0`), CAB_AJAX(id, 'chart'), REINTENTOS_FIDE).catch(() => null);
  const num = (fila, campo) => { const n = entero(String(fila[campo] ?? '')); return n > 0 ? n : null; };
  const puntos = [];
  for (const fila of Array.isArray(datos) ? datos : []) {
    if (!fila || typeof fila !== 'object') continue;
    const [anio, mes] = String(fila.date_2 ?? '').split('-');
    const m = MESES.indexOf((mes ?? '').toLowerCase());
    if (!entero(anio) || m < 0) continue;
    const punto = { fecha: `${anio}-${String(m + 1).padStart(2, '0')}`, standard: num(fila, 'rating'), rapid: num(fila, 'rapid_rtng'), blitz: num(fila, 'blitz_rtng') };
    if ([punto.standard, punto.rapid, punto.blitz].some(v => v !== null)) puntos.push(punto);
  }
  return puntos.length ? puntos.sort((a, b) => a.fecha.localeCompare(b.fecha)) : historialLichess(id);
}

async function fotoFide(id, cors) {
  if (!/^\d+$/.test(id ?? '')) throw new ErrorUsuario('ID FIDE no válido.');
  const cabeceras = { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400', ...cors };
  // FIDE primero. Una página vacía o una descarga fallida permiten probar las fuentes de respaldo.
  let falloOficial = false;
  try {
    const html = await descargarHtml(sinCache(`https://ratings.fide.com/profile/${id}`), {}, REINTENTOS_FIDE);
    if (html.trim().length < 100) throw new Error('Perfil vacío');
    const src = parse(html).querySelector('img.profile-top__photo')?.getAttribute('src');
    if (src?.startsWith('data:')) {
      const coma = src.indexOf(',');
      const tipo = /data:(image\/[^;,]+)/.exec(src)?.[1];
      if (!tipo || !src.slice(0, coma).includes(';base64')) throw new Error('Foto no válida');
      const bytes = Uint8Array.from(atob(src.slice(coma + 1)), c => c.charCodeAt(0));
      if (!bytes.length) throw new Error('Foto vacía');
      return new Response(bytes, { headers: { ...cabeceras, 'Content-Type': tipo } });
    }
    if (src) {
      const rf = await fetch(new URL(src.replace(/&amp;/g, '&'), 'https://ratings.fide.com/'), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      if (!rf.ok || !rf.headers.get('content-type')?.startsWith('image/')) throw new Error('Foto no disponible');
      return new Response(rf.body, { headers: { ...cabeceras, 'Content-Type': rf.headers.get('content-type') } });
    }
    if (!perfilValido(datosDePerfil(html))) throw new Error('Perfil no válido');
  } catch { falloOficial = true; }

  // Lichess después de FIDE; Wikimedia Commons queda como última alternativa por ID exacto.
  const l = await jugadorLichess(id);
  const url = l?.photo?.medium;
  let r = url ? await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) }).catch(() => null) : null;
  if (!r?.ok || !r.headers.get('content-type')?.startsWith('image/')) r = await fotoWikidata(id);
  if (r?.ok && r.headers.get('content-type')?.startsWith('image/')) return new Response(r.body, { headers: { ...cabeceras, 'Content-Type': r.headers.get('content-type') } });
  if (falloOficial) throw new ErrorUsuario('La FIDE no ha devuelto el perfil ni se ha encontrado una foto de respaldo. Inténtalo de nuevo en un momento.', 503);
  return new Response('Sin foto', { status: 404, headers: { ...cors, 'Cache-Control': 'no-store' } });
}


// ---------- Asistente de IA: reenvía la pregunta a OpenAI o Anthropic con la clave del usuario (que no se guarda ni se registra) ----------

const ERRORES_IA = {
  401: 'La clave de API no es válida. Revísala en «Configurar».', 403: 'La clave no tiene permiso para usar este modelo.',
  404: 'No existe ese modelo. Cambia el nombre en «Configurar».', 429: 'Se ha superado el límite de uso o no queda saldo en la cuenta de la API.'
};

async function respuestaIa(r) {
  const texto = await r.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch { /* respuesta que no es JSON */ }
  if (r.ok && datos) return datos;
  const e = datos?.error;
  const detalle = typeof e === 'string' ? e : (e?.message ?? '');
  const motivo = ERRORES_IA[r.status] ?? `El servicio respondió con un error (${r.status}).`;
  throw new ErrorUsuario(detalle ? `${motivo}\n${detalle}` : motivo, r.status === 401 || r.status === 403 || r.status === 404 || r.status === 429 ? r.status : 502);
}

const cabecerasIa = (proveedor, clave) => proveedor === 'openai'
  ? { Authorization: `Bearer ${clave}` }
  : { 'x-api-key': clave, 'anthropic-version': '2023-06-01' };

async function preguntarIa(request) {
  const clave = (request.headers.get('X-Clave-Ia') ?? '').trim();
  if (!clave) throw new ErrorUsuario('Falta la clave de API. Configúrala en «Configurar».', 401);
  const { proveedor, modelo, sistema, mensajes } = await request.json();
  if (!['openai', 'anthropic'].includes(proveedor) || !modelo || !Array.isArray(mensajes) || !mensajes.length) throw new ErrorUsuario('Petición no válida.');
  const turnos = mensajes.map(m => ({ role: m.rol === 'assistant' ? 'assistant' : 'user', content: String(m.texto ?? '') }));

  if (proveedor === 'openai') {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...cabecerasIa(proveedor, clave) },
      body: JSON.stringify({ model: modelo, messages: [{ role: 'system', content: sistema }, ...turnos] })
    });
    const d = await respuestaIa(r);
    return { texto: d.choices?.[0]?.message?.content ?? '' };
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...cabecerasIa(proveedor, clave) },
    body: JSON.stringify({ model: modelo, max_tokens: 2000, system: sistema, messages: turnos })
  });
  const d = await respuestaIa(r);
  return { texto: (d.content ?? []).map(b => b.text ?? '').join('') };
}

async function modelosIa(proveedor, request) {
  const clave = (request.headers.get('X-Clave-Ia') ?? '').trim();
  if (!clave) throw new ErrorUsuario('Falta la clave de API.', 401);
  if (!['openai', 'anthropic'].includes(proveedor)) throw new ErrorUsuario('Proveedor no válido.');
  const r = await fetch(proveedor === 'openai' ? 'https://api.openai.com/v1/models' : 'https://api.anthropic.com/v1/models?limit=100', { headers: cabecerasIa(proveedor, clave) });
  const d = await respuestaIa(r);
  let ids = (d.data ?? []).map(m => m.id).filter(Boolean);
  if (proveedor === 'openai') {
    const fuera = ['embedding', 'whisper', 'tts', 'audio', 'realtime', 'transcribe', 'image', 'dall', 'moderation', 'sora', 'search', 'instruct', 'codex'];
    ids = ids.filter(id => (id.startsWith('gpt-') || id.startsWith('chatgpt') || /^o\d/.test(id)) && !fuera.some(f => id.toLowerCase().includes(f)));
  }
  return { modelos: [...new Set(ids)].sort((a, b) => a.localeCompare(b)) };
}

// ---------- Enrutado ----------

export default {
  scheduled(_evento, env, ctx) {
    ctx.waitUntil(sincronizarTwic(env));
  },
  async fetch(request, env, ctx) {
    const cors = cabecerasCors(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const ruta = new URL(request.url);
    // Herramienta de demostración: solo existe con la configuración LOCAL y una petición de loopback.
    if (ruta.pathname === '/__twic/actualizar' && request.method === 'POST') {
      if (env.TWIC_LOCAL !== '1' || !['127.0.0.1', 'localhost'].includes(ruta.hostname)) return json({ error: 'No encontrado' }, cors, { status: 404 });
      if (request.headers.get('Origin') && request.headers.get('Origin') !== ruta.origin) return json({ error: 'Origen no permitido' }, cors, { status: 403 });
      try { return json(await sincronizarTwic(env), cors); }
      catch (e) { return json({ error: e.message }, cors, { status: 502 }); }
    }
    if (ruta.pathname.startsWith('/__lumbra/') && env.TWIC_LOCAL === '1' && ['127.0.0.1', 'localhost'].includes(ruta.hostname)) {
      if (request.headers.get('Origin') && request.headers.get('Origin') !== ruta.origin) return json({ error: 'Origen no permitido' }, cors, { status: 403 });
      if (!env.LUMBRA_DB) return json({ error: 'No hay una base Lumbra local configurada.' }, cors, { status: 503 });
      if (ruta.pathname === '/__lumbra/lote' && request.method === 'POST') {
        try {
          const cuerpo = await request.text();
          if (cuerpo.length > 1900000) return json({ error: 'El lote supera el tamaño permitido.' }, cors, { status: 413 });
          const datos = JSON.parse(cuerpo);
          if (!Array.isArray(datos.partidas) || datos.partidas.length > 250 || datos.partidas.some(g =>
            !g || typeof g.id !== 'string' || g.id.length > 80 || !/^\d{4}-\d{2}-\d{2}$/.test(g.date) ||
            typeof g.pgn !== 'string' || g.pgn.length > 50000 || typeof g.white !== 'string' || typeof g.black !== 'string'))
            return json({ error: 'El lote de partidas Lumbra no es válido.' }, cors, { status: 400 });
          const guardadas = await guardarLumbraLote(env.LUMBRA_DB, datos.partidas);
          return json({ guardadas }, cors);
        } catch (e) { return json({ error: e.message || 'No se pudo guardar el lote de Lumbra.' }, cors, { status: 400 }); }
      }
      if (ruta.pathname === '/__lumbra/iniciar' && request.method === 'POST') {
        await env.LUMBRA_DB.batch([
          env.LUMBRA_DB.prepare('DELETE FROM lumbra_games'),
          env.LUMBRA_DB.prepare('DELETE FROM lumbra_meta')
        ]);
        return json({ iniciado: true }, cors);
      }
      if (ruta.pathname === '/__lumbra/finalizar' && request.method === 'POST') {
        const datos = await request.json().catch(() => ({}));
        const version = String(datos.version ?? '').slice(0, 30);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(version)) return json({ error: 'Versión Lumbra no válida.' }, cors, { status: 400 });
        await env.LUMBRA_DB.batch([
          env.LUMBRA_DB.prepare("INSERT INTO lumbra_meta(key,value) VALUES ('version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(version),
          env.LUMBRA_DB.prepare("INSERT INTO lumbra_meta(key,value) VALUES ('completa','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        ]);
        return json({ completa: true, version }, cors);
      }
      if (ruta.pathname === '/__lumbra/estado' && request.method === 'GET') {
        const [cuenta, fechas, version, completa] = await Promise.all([
          env.LUMBRA_DB.prepare('SELECT count(*) n FROM lumbra_games').first(),
          env.LUMBRA_DB.prepare('SELECT min(game_date) desde, max(game_date) hasta FROM lumbra_games').first(),
          env.LUMBRA_DB.prepare("SELECT value FROM lumbra_meta WHERE key='version'").first(),
          env.LUMBRA_DB.prepare("SELECT value FROM lumbra_meta WHERE key='completa'").first()
        ]);
        return json({ partidas: cuenta.n, ...fechas, version: version?.value ?? '', completa: completa?.value === '1' }, cors);
      }
      return json({ error: 'No encontrado' }, cors, { status: 404 });
    }
    const esPost = request.method === 'POST' && ruta.pathname === '/api/ia/preguntar';
    if (request.method !== 'GET' && !esPost) return json({ error: 'Método no permitido' }, cors, { status: 405 });

    const url = new URL(request.url);
    const p = url.searchParams;
    try {
      switch (url.pathname) {
        case '/api/twic/jugador': {
          // Clave canónica y sin Origin: la caché comparte resultados públicos, nunca datos personales.
          const cacheUrl = new URL('/api/twic/jugador', url.origin);
          for (const k of ['name', 'fideId', 'cursor']) cacheUrl.searchParams.set(k, (p.get(k) ?? '').trim().slice(0, 200));
          const cache = env.TWIC_LOCAL === '1' ? null : globalThis.caches?.default;
          let respuesta = await cache?.match(cacheUrl.href);
          if (!respuesta) {
            const datos = await consultarTwic(env, cacheUrl.searchParams);
            const status = datos.estado === 'limite' ? 429 : datos.estado === 'error' ? 400 : 200;
            respuesta = json(datos, {}, { status, 'Cache-Control': cache && status === 200 && datos.estado !== 'sin_configurar' ? 'public, max-age=300' : 'no-store' });
            if (cache && status === 200 && datos.estado !== 'sin_configurar') ctx?.waitUntil(cache.put(cacheUrl.href, respuesta.clone()));
          }
          return new Response(respuesta.body, { status: respuesta.status, headers: { ...Object.fromEntries(respuesta.headers), ...cors } });
        }
        case '/api/lumbra/jugador': {
          const datos = await consultarLumbra(env, p);
          const status = datos.estado === 'error' ? 400 : 200;
          return json(datos, cors, { status, 'Cache-Control': 'no-store' });
        }
        case '/api/torneo': {
          const top = Math.max(1, Math.min(MAX_JUGADORES, parseInt(p.get('top') ?? '5', 10) || MAX_JUGADORES));
          return json(await cargarTorneo(p.get('url'), top), cors, { 'Cache-Control': 'public, max-age=60' });
        }
        case '/api/jugador/verificar':
          return json(await verificarJugador({
            name: p.get('name') ?? '', fideId: (p.get('fideId') ?? '').trim(), federation: (p.get('federation') ?? '').trim(),
            rating: entero(p.get('rating') ?? '0'), fideTitle: '', age: ''
          }), cors, { 'Cache-Control': 'public, max-age=3600' });
        case '/api/fide/buscar': return json(await buscarFide(p.get('q')), cors, { 'Cache-Control': 'public, max-age=300' });
        case '/api/fide/ficha': return json(await fichaFide(p.get('id')), cors, { 'Cache-Control': 'public, max-age=3600' });
        case '/api/fide/estadisticas': return json(await estadisticasFide(p.get('id')), cors, { 'Cache-Control': 'public, max-age=3600' });
        case '/api/fide/historial': return json(await historialElo(p.get('id')), cors, { 'Cache-Control': 'public, max-age=3600' });
        case '/api/ia/preguntar': return json(await preguntarIa(request), cors);
        case '/api/ia/modelos': return json(await modelosIa(p.get('proveedor'), request), cors);
        case '/api/fide/foto': return await fotoFide(p.get('id'), cors);
        case '/': return json({ ok: true, servicio: 'chessrival-worker' }, cors);
        default: return json({ error: 'No encontrado' }, cors, { status: 404 });
      }
    } catch (ex) {
      const estado = ex instanceof ErrorUsuario ? ex.estado : 502;
      const mensaje = ex instanceof ErrorUsuario ? ex.message : 'No se pudo consultar la fuente externa. Inténtalo de nuevo en un momento.';
      return new Response(JSON.stringify({ error: mensaje }), {
        status: estado, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors }
      });
    }
  }
};
