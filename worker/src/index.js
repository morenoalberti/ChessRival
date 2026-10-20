// Servidor intermedio de ChessRival (Cloudflare Worker).
// El navegador no puede leer Chess-Results, Info64 ni la FIDE por CORS: este Worker las pide por él y devuelve JSON.
//
//   GET /api/torneo?url=…&top=N  → { nombre, jugadores: [{ rank, name, federation, rating, points, fideId }] }
//   GET /api/jugador/verificar?name=&fideId=&federation=&rating=  → el jugador con su ID FIDE, federación, título y edad corregidos
//   GET /api/fide/buscar?q=…     → [{ fideId, nombre, titulo, federacion, elo, eloStandard, eloRapid, eloBlitz, nacimiento }]
//   GET /api/fide/ficha?id=…     → { titulo, edad }
//   GET /api/fide/estadisticas?id=…  → { titulo, edad, bloques: [{ titulo, elo, blancas, negras }] }
//   GET /api/fide/historial?id=…     → [{ fecha: 'AAAA-MM', standard, rapid, blitz }]
//   GET /api/fide/foto?id=…      → la imagen del perfil de la FIDE (404 si no tiene)
import { parse } from 'node-html-parser';

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
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es,en;q=0.8', ...cabeceras }, redirect: 'follow' });
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

const MAX_JUGADORES = 400;

async function cargarTorneo(texto_, top = 5) {
  let u;
  try { u = new URL((texto_ ?? '').trim()); } catch { throw new ErrorUsuario('La URL no es válida.'); }
  if (esChessResults(u)) return cargarChessResults(u, top);
  if (esInfo64(u)) return cargarInfo64(u, top);
  throw new ErrorUsuario('Solo se admiten URLs de Chess-Results e Info64.');
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

  const jugadores = [], numeros = [], enlaces = [];
  for (const fila of tabla.querySelectorAll('tr').filter(f => f.querySelector('td'))) {
    const tds = celdasDe(fila);
    const cs = tds.map(texto);
    if (c.nombre < 0 || c.nombre >= cs.length || !cs[c.nombre]) continue;
    numeros.push(entero(celda(cs, c.sno)));
    enlaces.push(tds[c.nombre].querySelector('a[href]')?.getAttribute('href') ?? null);
    jugadores.push({
      rank: c.rank >= 0 && entero(cs[c.rank]) ? entero(cs[c.rank]) : jugadores.length + 1,
      name: cs[c.nombre], federation: celda(cs, c.fed), rating: entero(celda(cs, c.elo)),
      points: celda(cs, c.pts), fideId: celda(cs, c.fide)
    });
    if (jugadores.length === top) break;
  }
  if (jugadores.length === 0) throw new ErrorUsuario('La clasificación está vacía.', 422);

  // La clasificación suele no traer el ID FIDE: primero se busca en el listado por ranking inicial y,
  // si aun así falta, en la ficha individual del jugador.
  if (jugadores.some(j => !j.fideId)) {
    try {
      const { porNumero, porNombre } = await idsFideDeLaLista(clasificacion);
      jugadores.forEach((j, i) => {
        if (j.fideId) return;
        j.fideId = (numeros[i] > 0 && porNumero.get(numeros[i])) || porNombre.get(normalizarNombre(j.name)) || '';
      });
    } catch { /* se sigue con las fichas individuales */ }
  }

  let consultas = 0;   // un Worker tiene un máximo de subpeticiones por llamada: solo las fichas de los primeros
  await Promise.all(jugadores.map(async (j, i) => {
    if (j.fideId || !enlaces[i] || ++consultas > 12) return;
    try {
      const ficha = await descargarHtml(new URL(enlaces[i].replace(/&amp;/g, '&'), clasificacion).href);
      j.fideId = idFideDeFicha(ficha);
    } catch { /* sin ID FIDE no hay foto, pero la tarjeta se muestra igual */ }
  }));

  return { nombre, jugadores };
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
  for (const fila of tabla.querySelectorAll('tr').filter(f => f.querySelector('td'))) {
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
    if (jugadores.length === top) break;
  }
  if (jugadores.length === 0) throw new ErrorUsuario('La lista de jugadores de Info64 está vacía.', 422);
  return { nombre, jugadores };
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
  for (const intento of intentos) {
    candidatos = await consultarFide(intento);
    if (!/^\d+$/.test(q)) {
      const palabras = sinTildes(q).split(/\s+/).filter(Boolean);
      candidatos = candidatos.filter(c => { const n = sinTildes(c.nombre); return palabras.every(p => n.includes(p)); });
    }
    if (candidatos.length > 0) break;
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
    const porId = (await consultarFide([j.fideId])).find(x => x.fideId === j.fideId);
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

const TITULOS = {
  'Grandmaster': 'GM', 'International Master': 'IM', 'FIDE Master': 'FM', 'Candidate Master': 'CM',
  'Woman Grandmaster': 'WGM', 'Woman International Master': 'WIM', 'Woman FIDE Master': 'WFM', 'Woman Candidate Master': 'WCM'
};
function abreviarTitulo(t) {
  if (t === 'None' || t === '-' || !t) return '';
  if (/^Arena /i.test(t)) return 'A' + abreviarTitulo(t.slice(6).trim());
  return TITULOS[t] ?? t;
}

/** Título(s) y edad del jugador, de su perfil público. */
async function fichaFide(id) {
  if (!/^\d+$/.test(id ?? '')) throw new ErrorUsuario('ID FIDE no válido.');
  const html = await descargarHtml(`https://ratings.fide.com/profile/${id}/statistics`).catch(() => '');
  if (html.length < 100) {                          // la FIDE no responde: Lichess
    const l = await jugadorLichess(id);
    return l ? { titulo: l.title ?? '', edad: perfilDeLichess(l).edad } : { titulo: '', edad: '' };
  }
  const titulos = [];
  for (const m of html.matchAll(/<h5>([^<]*title[^<]*)<\/h5>\s*<div class="profile-info-title\s*">.*?<p>([^<]*)<\/p>/gis)) {
    const abreviado = abreviarTitulo(m[2].trim());
    if (abreviado && !titulos.includes(abreviado)) titulos.push(abreviado);
  }
  const anio = entero(/class="profile-info-byear\s*"[^>]*>([^<]*)</i.exec(html)?.[1] ?? '');
  const actual = new Date().getFullYear();
  return { titulo: titulos.join(' · '), edad: anio > 1900 && anio <= actual ? `${actual - anio} años` : '' };
}



// ---------- Respaldo: Lichess ----------
// La FIDE rechaza (o deja en blanco) las peticiones que vienen de servidores como los de Cloudflare. Lichess publica sin límite estos mismos datos
// (título, año de nacimiento, Elo por ritmo, foto e historial del Elo), así que se usa cuando la FIDE no responde.
// Lo que Lichess no tiene son los resultados con blancas y negras: esas tarjetas salen solo con el Elo.

async function jugadorLichess(id) {
  try {
    const r = await fetch(`https://lichess.org/api/fide/player/${id}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

function perfilDeLichess(l) {
  const actual = new Date().getFullYear();
  const ok = l.year > 1900 && l.year <= actual;
  return {
    titulo: l.title ?? '', edad: ok ? `${actual - l.year} años` : '', nombre: l.name ?? '', nacimiento: ok ? l.year : null,
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

async function historialLichess(id) {
  try {
    const r = await fetch(`https://lichess.org/fide/${id}/x`, { headers: { 'User-Agent': UA }, redirect: 'follow' });
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
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...cabeceras } });
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
  const [html, datos] = await Promise.all([
    descargarHtml(`https://ratings.fide.com/profile/${id}/statistics`).catch(() => ''),
    jsonFide(`https://ratings.fide.com/a_data_stats.php?id1=${id}&id2=0`, CAB_AJAX(id, 'statistics')).catch(() => null)
  ]);
  const fila = Array.isArray(datos) ? datos[0] : null;
  if (!fila || html.length < 100) {                 // la FIDE no responde: lo que dé Lichess (sin los resultados con blancas y negras)
    const l = await jugadorLichess(id);
    if (l) { const perfil = perfilDeLichess(l); return { bloques: bloquesSoloElo(perfil.elos), parcial: true, ...perfil }; }
    return { bloques: [], ...(html.length >= 100 ? datosDePerfil(html) : {}) };
  }

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
    ...datosDePerfil(html)
  };
}

export function datosDePerfil(html) {
  const titulos = [];
  for (const m of html.matchAll(/<h5>([^<]*title[^<]*)<\/h5>\s*<div class="profile-info-title\s*">.*?<p>([^<]*)<\/p>/gis)) {
    const a = abreviarTitulo(m[2].trim());
    if (a && !titulos.includes(a)) titulos.push(a);
  }
  const anio = entero(/class="profile-info-byear\s*"[^>]*>([^<]*)</i.exec(html)?.[1] ?? '');
  const actual = new Date().getFullYear();
  const doc = parse(html);
  const genero = texto(doc.querySelector('.profile-info-sex'));
  const pais = doc.querySelector('.profile-info-country');
  const clasificaciones = doc.querySelectorAll('.profile-rank-block').map(b => {
    const filas = b.querySelectorAll('.profile-rank-row');
    const valor = patron => texto(filas.find(f => patron.test(texto(f.querySelector('h6'))))?.querySelector('p'));
    return { nombre: texto(b.querySelector('h5')), activos: valor(/active players/i), todos: valor(/all players/i) };
  }).filter(r => r.nombre);
  return {
    titulo: titulos.join(' · '), edad: anio > 1900 && anio <= actual ? `${actual - anio} años` : '',
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
  const datos = await jsonFide(`https://ratings.fide.com/a_chart_data.phtml?event=${id}&period=0`, CAB_AJAX(id, 'chart')).catch(() => null);
  if (!Array.isArray(datos) || !datos.length) return historialLichess(id);
  const num = (fila, campo) => { const n = entero(String(fila[campo] ?? '')); return n > 0 ? n : null; };
  const puntos = [];
  for (const fila of datos) {
    const [anio, mes] = String(fila.date_2 ?? '').split('-');
    const m = MESES.indexOf((mes ?? '').toLowerCase());
    if (!entero(anio) || m < 0) continue;
    puntos.push({ fecha: `${anio}-${String(m + 1).padStart(2, '0')}`, standard: num(fila, 'rating'), rapid: num(fila, 'rapid_rtng'), blitz: num(fila, 'blitz_rtng') });
  }
  return puntos.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

async function fotoFide(id, cors) {
  if (!/^\d+$/.test(id ?? '')) throw new ErrorUsuario('ID FIDE no válido.');
  const htmlPerfil = await descargarHtml(`https://ratings.fide.com/profile/${id}`).catch(() => '');
  const src = htmlPerfil.length < 100 ? null : parse(htmlPerfil).querySelector('img.profile-top__photo')?.getAttribute('src');
  if (!src) {                                       // sin la FIDE: la foto de Lichess (si la tiene)
    const l = await jugadorLichess(id);
    const url = l?.photo?.medium;
    const r = url ? await fetch(url, { headers: { 'User-Agent': UA } }).catch(() => null) : null;
    if (!r?.ok) return new Response('Sin foto', { status: 404, headers: cors });
    return new Response(r.body, { headers: { 'Content-Type': r.headers.get('content-type') ?? 'image/webp', 'Cache-Control': 'public, max-age=86400', ...cors } });
  }

  if (src.startsWith('data:')) {
    const coma = src.indexOf(',');
    const tipo = /data:([^;,]+)/.exec(src)?.[1] ?? 'image/jpeg';
    const bytes = Uint8Array.from(atob(src.slice(coma + 1)), c => c.charCodeAt(0));
    return new Response(bytes, { headers: { 'Content-Type': tipo, 'Cache-Control': 'public, max-age=86400', ...cors } });
  }
  const r = await fetch(new URL(src.replace(/&amp;/g, '&'), 'https://ratings.fide.com/'), { headers: { 'User-Agent': UA } });
  if (!r.ok) return new Response('Sin foto', { status: 404, headers: cors });
  return new Response(r.body, { headers: { 'Content-Type': r.headers.get('content-type') ?? 'image/jpeg', 'Cache-Control': 'public, max-age=86400', ...cors } });
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
  async fetch(request, env) {
    const cors = cabecerasCors(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const esPost = request.method === 'POST' && new URL(request.url).pathname === '/api/ia/preguntar';
    if (request.method !== 'GET' && !esPost) return json({ error: 'Método no permitido' }, cors, { status: 405 });

    const url = new URL(request.url);
    const p = url.searchParams;
    try {
      switch (url.pathname) {
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
