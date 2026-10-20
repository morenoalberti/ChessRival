// Copias portátiles de IndexedDB. El historial vive en otra base y nunca se incluye en sí mismo.
import { tx, prom } from './db.js';

export const ALMACENES_COPIA = ['torneos', 'tarjetas', 'partidas', 'analisis', 'ediciones', 'ajustes'];
const preferencias = new Set(['torneo_actual', 'jugadores_a_cargar', 'ficha_solo_lento', 'ficha_orden_fide', 'ficha_elo_arriba', 'visor_motor_arriba', 'analisis_profundidad', 'analisis_seg_partida', 'analisis_seg_prof', 'ia_modelo', 'ia_proveedor']);
const portable = a => preferencias.has(a.clave) || a.clave.startsWith('foto:');
let archivoDb;

async function archivo() {
  if (!archivoDb) archivoDb = new Promise((ok, mal) => {
    const r = indexedDB.open('chessrival-copias', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('copias', { keyPath: 'id' });
      r.result.createObjectStore('opciones', { keyPath: 'clave' });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
  return archivoDb;
}
async function enArchivo(nombre, modo, fn) {
  const d = await archivo(), t = d.transaction(nombre, modo);
  const fin = new Promise((ok, mal) => { t.oncomplete = ok; t.onabort = t.onerror = () => mal(t.error ?? new Error('No se pudo guardar la copia.')); });
  try { const r = await fn(t.objectStore(nombre)); await fin; return r; }
  catch (e) { try { t.abort(); } catch {} await fin.catch(() => {}); throw e; }
}
export const opcionCopias = async (clave, defecto = null) => (await enArchivo('opciones', 'readonly', s => prom(s.get(clave))))?.valor ?? defecto;
export const guardarOpcionCopias = (clave, valor) => enArchivo('opciones', 'readwrite', s => prom(s.put({ clave, valor })));
export const listarCopias = async () => (await enArchivo('copias', 'readonly', s => prom(s.getAll()))).sort((a, b) => b.fecha.localeCompare(a.fecha));
export const borrarCopia = id => enArchivo('copias', 'readwrite', s => prom(s.delete(id)));

export async function datosActuales() {
  return tx(ALMACENES_COPIA, 'readonly', async (...stores) => {
    const filas = await Promise.all(stores.map(s => prom(s.getAll())));
    const datos = Object.fromEntries(ALMACENES_COPIA.map((n, i) => [n, filas[i]]));
    datos.ajustes = datos.ajustes.filter(portable);
    return datos;
  });
}
export function resumenCopia(datos) {
  return { torneos: datos.torneos.filter(t => t.url !== 'chessrival:jugadores').length,
    jugadores: new Set(datos.tarjetas.map(t => t.fideId ? `f:${t.fideId}` : `n:${t.name.trim().toLowerCase()}`)).size,
    tarjetas: datos.tarjetas.length, partidas: datos.partidas.length, analisis: datos.analisis.length, ediciones: datos.ediciones.length };
}
async function huella(texto) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
}
export async function empaquetarCopia(datos, tipo = 'manual') {
  validarDatos(datos);
  const contenido = JSON.stringify({ fecha: new Date().toISOString(), tipo, datos });
  return { formato: 'ChessRival-web', version: 1, sha256: await huella(contenido), contenido };
}
function validarDatos(datos) {
  const error = () => { throw new Error('La copia contiene datos incompletos o referencias incorrectas.'); };
  if (!datos || ALMACENES_COPIA.some(n => !Array.isArray(datos[n]))) error();
  for (const nombre of ALMACENES_COPIA) {
    const campo = nombre === 'ajustes' ? 'clave' : ['analisis', 'ediciones'].includes(nombre) ? 'partidaId' : 'id';
    const claves = new Set();
    for (const fila of datos[nombre]) {
      if (!fila || typeof fila !== 'object' || Array.isArray(fila)) error();
      const clave = fila[campo];
      if (campo === 'clave' ? typeof clave !== 'string' : !Number.isSafeInteger(clave) || clave < 1) error();
      if (claves.has(clave)) error();
      claves.add(clave);
    }
  }
  const torneos = new Set(datos.torneos.map(t => t.id));
  const partidas = new Map(datos.partidas.map(p => [p.id, p]));
  if (datos.torneos.some(t => typeof t.nombre !== 'string' || typeof t.url !== 'string')) error();
  if (datos.tarjetas.some(t => !torneos.has(t.torneoId) || typeof t.name !== 'string')) error();
  for (const fila of [...datos.torneos, ...datos.tarjetas]) {
    for (const clave of ['orden', 'rank', 'rating', 'gamesCount', 'cargadoEn']) {
      if (fila[clave] !== undefined && (typeof fila[clave] !== 'number' || !Number.isFinite(fila[clave]))) error();
    }
  }
  if (datos.partidas.some(p => typeof p.pgn !== 'string' || typeof p.jugadorClave !== 'string')) error();
  if (datos.analisis.some(a => !partidas.has(a.partidaId) || a.jugadorClave !== partidas.get(a.partidaId).jugadorClave)) error();
  if (datos.ediciones.some(e => !partidas.has(e.partidaId))) error();
  if (datos.ajustes.some(a => !portable(a))) error();
}
export async function validarCopia(paquete) {
  if (paquete?.formato !== 'ChessRival-web' || paquete.version !== 1 || typeof paquete.contenido !== 'string') {
    throw new Error('Elige una copia .json de ChessRival web. Los archivos ZIP del escritorio utilizan otro formato.');
  }
  if (await huella(paquete.contenido) !== paquete.sha256) throw new Error('El archivo está dañado o se ha modificado. No se restaurará.');
  let contenido;
  try { contenido = JSON.parse(paquete.contenido); } catch { throw new Error('El contenido de la copia no se puede leer.'); }
  if (!Number.isFinite(Date.parse(contenido.fecha)) || !['manual', 'automatica', 'antes-restaurar'].includes(contenido.tipo)) throw new Error('La cabecera de la copia no es válida.');
  validarDatos(contenido.datos);
  return { ...contenido, resumen: resumenCopia(contenido.datos) };
}
export async function guardarEnHistorial(paquete) {
  const c = await validarCopia(paquete);
  const fila = { id: crypto.randomUUID(), fecha: c.fecha, tipo: c.tipo, resumen: c.resumen, bytes: new Blob([JSON.stringify(paquete)]).size, paquete };
  await enArchivo('copias', 'readwrite', s => prom(s.put(fila)));
  if (c.tipo === 'automatica') {
    const sobrantes = (await listarCopias()).filter(x => x.tipo === 'automatica').slice(15);
    await enArchivo('copias', 'readwrite', s => Promise.all(sobrantes.map(x => prom(s.delete(x.id)))));
  }
  return fila;
}
export function nombreCopia(c) {
  return `ChessRival-${c.tipo}-${c.fecha.replace(/[:.]/g, '-')}.json`;
}
export function descargarCopia(fila) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(fila.paquete)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = nombreCopia(fila); a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function crearCopia(tipo = 'manual') {
  const paquete = await empaquetarCopia(await datosActuales(), tipo);
  return guardarEnHistorial(paquete);
}
export async function restaurarCopia(paquete) {
  const { datos } = await validarCopia(paquete);
  // Se debe poder guardar la copia preventiva completa antes de sustituir un solo registro.
  const preventiva = await crearCopia('antes-restaurar');
  const anteriores = (await validarCopia(preventiva.paquete)).datos;
  await tx(ALMACENES_COPIA, 'readwrite', async (...stores) => {
    const filas = await Promise.all(stores.map(s => prom(s.getAll())));
    const actuales = Object.fromEntries(ALMACENES_COPIA.map((n, i) => [n, filas[i]]));
    actuales.ajustes = actuales.ajustes.filter(portable);
    if (JSON.stringify(actuales) !== JSON.stringify(anteriores)) {
      throw new Error('Los datos han cambiado en otra ventana mientras se preparaba la copia. Cierra las otras fichas y visores y vuelve a restaurar.');
    }
    for (let i = 0; i < stores.length; i++) {
      const s = stores[i], nombre = ALMACENES_COPIA[i];
      if (nombre === 'ajustes') {
        for (const a of await prom(s.getAll())) if (portable(a)) await prom(s.delete(a.clave));
      } else await prom(s.clear());
      for (const fila of datos[nombre]) await prom(s.put(fila));
    }
    await prom(stores.at(-1).put({ clave: 'datos_revision', valor: crypto.randomUUID() }));
  });
  return preventiva;
}

/** Copias periódicas mientras la web está abierta; no se confía en el cierre de una pestaña. */
export function iniciarCopiasAutomaticas() {
  let ocupado = false, ultimaHuella = '', anterior = 0;
  const comprobar = async (forzar = false) => {
    if (ocupado || document.visibilityState === 'hidden' || (!forzar && Date.now() - anterior < 300000)) return;
    ocupado = true;
    try {
      if (!await opcionCopias('automaticas', false)) return;
      const ejecutar = async () => {
        const datos = await datosActuales(), hash = await huella(JSON.stringify(datos));
        const ultima = await opcionCopias('ultima_automatica', null);
        if (hash === ultimaHuella || hash === ultima?.hash || (!forzar && Date.now() - (ultima?.momento ?? 0) < 300000)) return;
        await guardarEnHistorial(await empaquetarCopia(datos, 'automatica'));
        await guardarOpcionCopias('ultima_automatica', { hash, momento: Date.now() });
        ultimaHuella = hash;
      };
      if (navigator.locks) await navigator.locks.request('chessrival-copia-automatica', ejecutar); else await ejecutar();
      await guardarOpcionCopias('error_automatica', '');
    } catch (e) { await guardarOpcionCopias('error_automatica', e.message).catch(() => {}); }
    finally { ocupado = false; anterior = Date.now(); }
  };
  setInterval(() => comprobar(), 30000);
  window.addEventListener('chessrival-datos', () => comprobar());
  window.addEventListener('chessrival-activar-copias', () => comprobar(true));
  comprobar();
}
