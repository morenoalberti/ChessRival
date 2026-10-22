// Una carpeta de solo lectura por fuente. Los handles se quedan en este navegador;
// los ajustes portátiles de las copias no incluyen estas claves.
import { leerAjuste, guardarAjuste } from './db.js';
import { leerArchivo } from './importador.js';

const claveCarpeta = fuente => `importar_carpeta:${fuente}`;
const cancelarSiHaceFalta = señal => { if (señal?.aborted) throw new DOMException('Búsqueda cancelada', 'AbortError'); };

export async function leerCarpetaPgn(fuente) {
  const carpeta = await leerAjuste(claveCarpeta(fuente));
  return carpeta?.kind === 'directory' ? carpeta : null;
}

/** Debe invocarse desde el clic en «Cambiar», antes de otras esperas. */
export async function elegirCarpetaPgn(fuente, anterior = null, navegador = globalThis) {
  if (typeof navegador.showDirectoryPicker !== 'function') throw new Error('Usa Edge o Chrome para elegir una carpeta de PGN.');
  let carpeta;
  try {
    carpeta = await navegador.showDirectoryPicker({ id: `chessrival-pgn-${fuente}`, mode: 'read', ...(anterior ? { startIn: anterior } : {}) });
  } catch (e) { if (e.name === 'AbortError') return undefined; throw e; }
  await guardarAjuste(claveCarpeta(fuente), carpeta);
  return carpeta;
}

/** Al reabrir solo se consulta el permiso. Para renovarlo hace falta pulsar «Permitir». */
export async function permitirCarpetaPgn(carpeta) {
  if (await carpeta.queryPermission({ mode: 'read' }) === 'granted') return true;
  return await carpeta.requestPermission({ mode: 'read' }) === 'granted';
}

/** La procedencia y el jugador son comprobaciones distintas. Las etiquetas de fuente
 * prevalecen sobre el nombre; no se atribuyen PGN desconocidos a una web al azar. */
export function fuenteDePgn(lectura) {
  const fuentes = new Set();
  for (const partida of lectura.partidas) {
    const etiquetas = ['Source', 'SourceTitle', 'Annotator'].map(c => partida.cab(c)).join(' ');
    if (/yotta(?:base|chess)/i.test(etiquetas)) fuentes.add('yotta');
    if (/ahora\s*ajedrez/i.test(etiquetas)) fuentes.add('ahora');
  }
  if (fuentes.size) return fuentes.size === 1 ? [...fuentes][0] : null;
  // Exportación «Descargar todas», incluido el sufijo que añade el navegador al repetirla.
  if (/_todas_\d+(?:\s*\(\d+\))?\.pgn$/i.test(lectura.archivo.name)) return 'ahora';
  return null;
}

/** Una misma carpeta se lee una sola vez aunque esté elegida en varias tarjetas. */
export async function agruparCarpetasPgn(entradas) {
  const grupos = [];
  for (const entrada of entradas) {
    let grupo;
    for (const candidato of grupos) {
      let misma = candidato.carpeta === entrada.carpeta;
      try { misma ||= await candidato.carpeta.isSameEntry(entrada.carpeta); } catch { /* Un acceso caducado no impide revisar las demás carpetas. */ }
      if (misma) { grupo = candidato; break; }
    }
    if (grupo) grupo.fuentes.push(entrada.id);
    else grupos.push({ carpeta: entrada.carpeta, fuentes: [entrada.id] });
  }
  return grupos;
}

/** En carpetas compartidas, cada archivo aparece una vez en la tarjeta de su web.
 * Si no se reconoce su origen, queda indicado y se conserva como PGN genérico. */
export function repartirPgn(lecturas, fuentes) {
  return lecturas.flatMap(l => {
    const detectada = fuenteDePgn(l);
    if (detectada && !fuentes.includes(detectada) && !fuentes.includes('pgn')) return [];
    const tarjeta = fuentes.includes(detectada) ? detectada : fuentes.includes('pgn') ? 'pgn' : fuentes[0];
    const sinOrigen = !detectada && fuentes.length > 1;
    return { ...l, tarjeta, sinOrigen, fuente: detectada === 'yotta' ? 'YottaChess' : detectada === 'ahora' ? 'AhoraAjedrez'
      : sinOrigen ? 'PGN' : tarjeta === 'yotta' ? 'YottaChess' : tarjeta === 'ahora' ? 'AhoraAjedrez' : 'PGN' };
  });
}

/** Examina el contenido de todos los .pgn de la carpeta, sin fiarse del nombre del archivo. */
export async function buscarPgnEnCarpeta(carpeta, jugador, { señal, progreso = () => {} } = {}) {
  cancelarSiHaceFalta(señal);
  if (await carpeta.queryPermission({ mode: 'read' }) !== 'granted') return { pendiente: true, lecturas: [], errores: [] };
  const lecturas = [], errores = [];
  for await (const [nombre, handle] of carpeta.entries()) {
    cancelarSiHaceFalta(señal);
    if (handle.kind !== 'file' || !/\.pgn$/i.test(nombre)) continue;
    progreso(nombre);
    try {
      const lectura = await leerArchivo(await handle.getFile(), jugador);
      cancelarSiHaceFalta(señal);
      if (lectura.suyas > 0) lecturas.push(lectura);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      errores.push(nombre);
    }
    // Una carpeta grande no debe impedir cerrar el formulario.
    await new Promise(r => setTimeout(r, 0));
  }
  cancelarSiHaceFalta(señal);
  return { pendiente: false, lecturas, errores };
}
