// La MegaDatabase de ChessBase del usuario (Services/MegaDatabaseService.cs): guarda qué base eligió, la abre al arrancar y busca las partidas
// de un jugador. Hay dos formas de leerla:
//  · Con el servidor local (servidor.py, el normal con iniciar.bat): el servidor abre el cuadro «Elegir archivo .cbh» de Windows, recuerda la ruta
//    y entrega a la página los cuatro archivos de la base por trozos, sin ningún aviso del navegador (igual que la versión de escritorio).
//  · Sin él (la web publicada): el selector de archivos del navegador; los permisos (FileSystemHandle) se guardan y el navegador los pide confirmar.
import { leerAjuste, guardarAjuste } from './db.js';
import { ChessBaseDatabase, ErrorBase } from './chessbase.js';
import { claveJugador, guardarPartidas, refrescarTarjetasDe } from './db-partidas.js';
import { cargarLibroAperturas } from './aperturas.js';
import { detectarRitmo } from './pgn.js';

export const MAX_POR_JUGADOR = 300;          // las más recientes

/** El estado que enseña el aviso: base abierta, error o permiso pendiente (el navegador pide confirmar al volver a abrir los archivos). */
export const estado = { base: null, error: null, pendiente: false, nombre: '', local: false };

let handles = null;
let cola = Promise.resolve();                  // un solo recorrido de la base a la vez

export const disponible = () => estado.local || 'showOpenFilePicker' in window;

// ---------- Servidor local ----------

async function llamarLocal(ruta, cuerpo) {
  const r = await fetch(ruta, cuerpo === undefined ? {} : { method: 'POST', headers: { 'X-ChessRival': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  if (!r.ok) throw new Error(`El servidor local respondió con el error ${r.status}.`);
  return r.json();
}

/** Los archivos de la base servidos por el servidor local, con la forma que espera ChessBaseDatabase (nombre + getFile()). */
function handlesLocales(info) {
  return ['cbh', 'cbg', 'cbp', 'cbt'].map(ext => ({
    name: `${info.nombre}.${ext}`,
    getFile: async () => {
      const url = `/local/mega/archivo/${ext}`;
      const leer = async (init) => { const r = await fetch(url, init); if (!r.ok && r.status !== 206) throw new Error(`No se pudo leer ${info.nombre}.${ext} (error ${r.status}).`); return r.arrayBuffer(); };
      return {
        size: info.tamanos[ext],
        slice: (a, b) => ({ arrayBuffer: () => (b > a ? leer({ headers: { Range: `bytes=${a}-${b - 1}` } }) : Promise.resolve(new ArrayBuffer(0))) }),
        arrayBuffer: () => leer()
      };
    }
  }));
}

/** ¿Hay servidor local con soporte para la MegaDatabase? Devuelve su estado, o null (web publicada). */
async function infoLocal() {
  try { const i = await llamarLocal('/local/mega'); return i?.disponible ? i : null; } catch { return null; }
}

async function abrirLocal(info) {
  if (!info.configurada) { estado.base = null; estado.error = null; estado.pendiente = false; return; }
  if (info.error) { estado.base = null; estado.error = info.error; estado.pendiente = false; return; }
  await abrir(handlesLocales(info));
}


async function permiso(h, pedir) {
  const opciones = { mode: 'read' };
  if ((await h.queryPermission(opciones)) === 'granted') return true;
  return pedir && (await h.requestPermission(opciones)) === 'granted';
}

async function abrir(h) {
  try {
    estado.base = await ChessBaseDatabase.abrir(h);
    estado.error = null; estado.pendiente = false; estado.nombre = estado.base.nombre;
    await guardarAjuste('mega_nombre', estado.nombre);
  } catch (ex) {
    estado.base = null; estado.pendiente = false;
    estado.error = ex instanceof ErrorBase ? ex.message : `No se pudo abrir la base: ${ex.message}`;
  }
}

/** Al arrancar: vuelve a abrir la base que se eligió la vez anterior (si el navegador ya da permiso; si no, queda «pendiente»). */
export async function restaurar() {
  const local = await infoLocal();
  estado.local = !!local;
  if (local) { await abrirLocal(local); return; }
  try { handles = await leerAjuste('mega_handles', null); } catch { handles = null; }
  estado.nombre = (await leerAjuste('mega_nombre', '')) ?? '';
  if (!handles?.length) { estado.base = null; estado.error = null; estado.pendiente = false; return; }
  const todos = (await Promise.all(handles.map(h => permiso(h, false).catch(() => false)))).every(Boolean);
  if (todos) await abrir(handles);
  else { estado.base = null; estado.error = null; estado.pendiente = true; }
}

/** Debe llamarse desde un clic: el navegador solo deja pedir el permiso así. */
export async function pedirPermiso() {
  if (!handles?.length) return false;
  const ok = (await Promise.all(handles.map(h => permiso(h, true).catch(() => false)))).every(Boolean);
  if (ok) await abrir(handles);
  return ok;
}

/** Elige la base con el selector de archivos del navegador (hay que elegir a la vez .cbh, .cbg, .cbp y .cbt). Devuelve un error para el usuario, undefined si se cancela, o null. */
export async function elegir() {
  if (estado.local) {
    let r;
    try { r = await llamarLocal('/local/mega/elegir', {}); } catch (ex) { return ex.message; }
    if (r.cancelado) return undefined;
    if (!r.sinInterfaz) {
      if (r.error) return r.error;
      await abrirLocal(r);
      return estado.base ? null : estado.error;
    }
    // el servidor no tiene interfaz gráfica: se usa el selector del navegador
  }
  if (!('showOpenFilePicker' in window)) return 'Tu navegador no permite leer archivos del disco. Usa Chrome o Edge para conectar la MegaDatabase.';
  // El navegador no puede encontrar los archivos «hermanos» de un .cbh como hace el programa de escritorio: se eligen a la vez los cuatro
  // (el cuadro solo enseña los de la base, y con Ctrl+E se marcan todos).
  let elegidos;
  try {
    elegidos = await showOpenFilePicker({
      id: 'megadatabase', multiple: true, excludeAcceptAllOption: true,
      types: [{ description: 'Base de ChessBase (.cbh .cbg .cbp .cbt)', accept: { 'application/octet-stream': ['.cbh', '.cbg', '.cbp', '.cbt'] } }]
    });
  } catch (ex) {
    if (ex?.name === 'AbortError') return undefined;
    return `El navegador no ha podido abrir el cuadro de archivos: ${ex.message}`;
  }

  const porNombre = new Map(elegidos.map(h => [h.name.toLowerCase(), h]));
  const cabeceras = elegidos.filter(h => /\.cbh$/i.test(h.name));
  if (!cabeceras.length) return 'No has elegido el archivo .cbh de la base. En el cuadro, marca el .cbh y los otros tres archivos con su mismo nombre (pulsa Ctrl+E para marcarlos todos).';
  // Si hay varias bases, la más grande (la MegaDatabase).
  let cabecera = cabeceras[0];
  if (cabeceras.length > 1) {
    const tamaños = await Promise.all(cabeceras.map(async h => (await h.getFile()).size));
    cabecera = cabeceras[tamaños.indexOf(Math.max(...tamaños))];
  }
  const nombreBase = cabecera.name.replace(/\.cbh$/i, '');
  const faltan = ['cbg', 'cbp', 'cbt'].filter(e => !porNombre.has(`${nombreBase}.${e}`.toLowerCase())).map(e => `${nombreBase}.${e}`);
  if (faltan.length) return `La base está incompleta. En el cuadro, marca también: ${faltan.join(', ')} (pulsa Ctrl+E para marcar todos los archivos de la base).`;
  const completos = [cabecera, ...['cbg', 'cbp', 'cbt'].map(e => porNombre.get(`${nombreBase}.${e}`.toLowerCase()))];

  await abrir(completos);
  if (!estado.base) return estado.error;
  handles = completos;
  await guardarAjuste('mega_handles', completos);
  return null;
}

const enCola = (tarea) => { const t = cola.then(tarea); cola = t.catch(() => {}); return t; };

/** Cuántas partidas de este jugador hay en la base (por nombre y ELO), sin importar nada. Lee el índice completo: tarda unos segundos. */
export function contar(jugador, progreso, señal) {
  if (!estado.base) return Promise.resolve(null);
  return enCola(async () => (await estado.base.buscar([{ nombre: jugador.name, elo: jugador.rating }], 0, progreso, señal))[0].candidatas);
}

/** Busca en la base las partidas de este jugador y las guarda. Devuelve { candidatas, nuevas, yaEstaban, noLegibles }. */
export function importar(jugador, progreso, señal) {
  if (!estado.base) return Promise.resolve({ candidatas: 0, nuevas: 0, yaEstaban: 0, noLegibles: 0 });
  return enCola(async () => {
    await cargarLibroAperturas();
    const [r] = await estado.base.buscar([{ nombre: jugador.name, elo: jugador.rating }], MAX_POR_JUGADOR, progreso, señal);
    const items = r.partidas.map(({ partida, color }) => ({ partida, color, eco: partida.cab('ECO'), apertura: partida.cab('Opening'), ritmo: detectarRitmo(partida) }));
    const clave = claveJugador(jugador);
    const g = await guardarPartidas(clave, items, 'MegaDatabase');
    await guardarAjuste(`mega_buscado:${clave}`, new Date().toISOString());
    await refrescarTarjetasDe(clave);
    return { candidatas: r.candidatas, nuevas: g.nuevas, yaEstaban: g.repetidas + g.enLote, noLegibles: r.noLegibles };
  });
}
