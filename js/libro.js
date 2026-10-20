// El libro de aperturas del usuario (Services/LibroService.cs): el Power Book de ChessBase o cualquier libro CTG. El programa no lo trae: lo elige el
// usuario, igual que la MegaDatabase, y hay dos formas de leerlo:
//  · Con el servidor local (servidor.py): abre el cuadro «Elegir archivo .ctg» de Windows y entrega los tres archivos del libro por trozos.
//  · Sin él (la web publicada): el selector de archivos del navegador; los permisos se guardan y el navegador los pide confirmar.
import { leerAjuste, guardarAjuste } from './db.js';
import { LibroCtg, ErrorLibro } from './libro-ctg.js';
import { elegirConHermanos } from './elegir-archivos.js';

const FEN_INICIAL = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** El estado que enseña el aviso: libro abierto, error o permiso pendiente. */
export const estado = { libro: null, error: null, pendiente: false, nombre: '', local: false };

let handles = null;
export const conectado = () => !!estado.libro;

// ---------- Servidor local ----------

async function llamarLocal(ruta, cuerpo) {
  const r = await fetch(ruta, cuerpo === undefined ? {} : { method: 'POST', headers: { 'X-ChessRival': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  if (!r.ok) throw new Error(`El servidor local respondió con el error ${r.status}.`);
  return r.json();
}

/** Los archivos del libro servidos por el servidor local, con la forma que espera LibroCtg (nombre + getFile()). */
function handlesLocales(info) {
  const una = (ext) => ({
    name: `${info.nombre}.${ext}`,
    getFile: async () => {
      const url = `/local/libro/archivo/${ext}`;
      const leer = async (init) => { const r = await fetch(url, init); if (!r.ok && r.status !== 206) throw new Error(`No se pudo leer ${info.nombre}.${ext} (error ${r.status}).`); return r.arrayBuffer(); };
      return {
        size: info.tamanos[ext],
        slice: (a, b) => ({ arrayBuffer: () => (b > a ? leer({ headers: { Range: `bytes=${a}-${b - 1}` } }) : Promise.resolve(new ArrayBuffer(0))) }),
        arrayBuffer: () => leer()
      };
    }
  });
  return { ctg: una('ctg'), ctb: una('ctb'), cto: una('cto') };
}

async function infoLocal() {
  try { const i = await llamarLocal('/local/libro'); return i?.disponible ? i : null; } catch { return null; }
}

// ---------- Abrir ----------

async function abrir(archivos, nombre) {
  try {
    const libro = await LibroCtg.abrir(archivos);
    // Una prueba rápida: la posición inicial debe estar en cualquier libro.
    if (!await libro.consultar(FEN_INICIAL)) throw new ErrorLibro('Este libro no tiene la posición inicial: no parece un libro de aperturas.');
    estado.libro = libro; estado.error = null; estado.pendiente = false; estado.nombre = nombre;
    await guardarAjuste('libro_nombre', nombre);
  } catch (ex) {
    estado.libro = null; estado.pendiente = false;
    estado.error = ex instanceof ErrorLibro ? ex.message : `No se pudo abrir el libro: ${ex.message}`;
  }
}

async function abrirLocal(info) {
  if (!info.configurado) { estado.libro = null; estado.error = null; estado.pendiente = false; return; }
  if (info.error) { estado.libro = null; estado.error = info.error; estado.pendiente = false; return; }
  await abrir(handlesLocales(info), info.nombre);
}

async function permiso(h, pedir) {
  const opciones = { mode: 'read' };
  if ((await h.queryPermission(opciones)) === 'granted') return true;
  return pedir && (await h.requestPermission(opciones)) === 'granted';
}
const comoArchivos = (h) => ({ ctg: h.ctg, ctb: h.ctb, cto: h.cto });

/** Al arrancar: vuelve a abrir el libro que se eligió la vez anterior (si el navegador ya da permiso; si no, queda «pendiente»). */
export async function restaurar() {
  const local = await infoLocal();
  estado.local = !!local;
  if (local) { await abrirLocal(local); return; }
  try { handles = await leerAjuste('libro_handles', null); } catch { handles = null; }
  estado.nombre = (await leerAjuste('libro_nombre', '')) ?? '';
  if (!handles?.ctg) { estado.libro = null; estado.error = null; estado.pendiente = false; return; }
  const todos = (await Promise.all(Object.values(handles).map(h => permiso(h, false).catch(() => false)))).every(Boolean);
  if (todos) await abrir(comoArchivos(handles), estado.nombre);
  else { estado.libro = null; estado.error = null; estado.pendiente = true; }
}

/** Debe llamarse desde un clic: el navegador solo deja pedir el permiso así. */
export async function pedirPermiso() {
  if (!handles?.ctg) return false;
  const ok = (await Promise.all(Object.values(handles).map(h => permiso(h, true).catch(() => false)))).every(Boolean);
  if (ok) await abrir(comoArchivos(handles), estado.nombre);
  return ok;
}

/** Elige el libro. Devuelve un error para el usuario, undefined si se cancela, o null si se abrió bien. */
export async function elegir() {
  if (estado.local) {
    let r;
    try { r = await llamarLocal('/local/libro/elegir', {}); } catch (ex) { return ex.message; }
    if (r.cancelado) return undefined;
    if (!r.sinInterfaz) {
      if (r.error) return r.error;
      await abrirLocal(r);
      return estado.libro ? null : estado.error;
    }
  }
  const r = await elegirConHermanos({
    id: 'libro-aperturas', principal: 'ctg', hermanos: ['ctb', 'cto'], descripcion: 'Libro de aperturas de ChessBase (.ctg)',
    paso2: 'ChessRival también necesita leer los otros archivos del libro, que están en la misma carpeta que «{}.ctg». Se abrirá el cuadro ya dentro de ella: solo tienes que pulsar «Seleccionar carpeta».'
  });
  if (!r) return undefined;
  if (r.error) return r.error;
  await abrir(r.archivos, r.base);
  if (!estado.libro) return estado.error;
  handles = r.archivos;
  await guardarAjuste('libro_handles', r.archivos);
  return null;
}

/** Lo que dice el libro de una posición (o null si no hay libro o no la tiene). */
export async function consultar(fen, conEstadisticas = false) {
  if (!estado.libro) return null;
  try { return await estado.libro.consultar(fen, conEstadisticas); } catch { return null; }
}
