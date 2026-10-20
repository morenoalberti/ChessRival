import { opcionCopias, guardarOpcionCopias, nombreCopia, descargarCopia } from './copias.js';

const CLAVE_DESTINO = 'carpeta_destino';
const esLocal = navegador => ['localhost', '127.0.0.1', '[::1]'].includes(navegador.location?.hostname);
async function llamarLocal(navegador, ruta, datos) {
  let respuesta;
  try {
    respuesta = await navegador.fetch(`/local/copias/${ruta}`, datos === undefined ? {} : {
      method: 'POST', headers: { 'X-ChessRival': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(datos)
    });
  } catch { throw new Error('Reinicia ChessRival para acceder a la carpeta de copias.'); }
  if (respuesta.status === 404) throw new Error('Reinicia ChessRival para actualizar la carpeta de copias.');
  const info = await respuesta.json();
  if (!respuesta.ok || info.error) throw new Error(info.error || 'No se pudo acceder a la carpeta de copias.');
  return info;
}
export async function leerDestinoCopias(navegador = globalThis) {
  if (esLocal(navegador)) {
    try { const destino = await llamarLocal(navegador, 'destino'); if (destino.ruta) return destino; } catch {}
  }
  return opcionCopias(CLAVE_DESTINO);
}
export const nombreDestinoCopias = carpeta => carpeta?.ruta || carpeta?.name || 'Descargas del navegador';

export async function elegirDestinoCopias(navegador = globalThis, anterior = null) {
  if (esLocal(navegador)) {
    const carpeta = await llamarLocal(navegador, 'elegir', {});
    if (carpeta.cancelado) return undefined;
    if (!carpeta.local || !carpeta.ruta) throw new Error('No se pudo obtener la ruta de la carpeta.');
    await guardarOpcionCopias(CLAVE_DESTINO, carpeta);
    return carpeta;
  }
  if (typeof navegador.showDirectoryPicker !== 'function') throw new Error('Usa Edge o Chrome para elegir una carpeta de destino.');
  let carpeta;
  try {
    carpeta = await navegador.showDirectoryPicker({ id: 'chessrival-copias', mode: 'readwrite', startIn: anterior?.local ? 'documents' : anterior ?? 'documents' });
  } catch (e) { if (e.name === 'AbortError') return undefined; throw e; }
  await guardarOpcionCopias(CLAVE_DESTINO, carpeta);
  return carpeta;
}

export async function autorizarDestinoCopias(carpeta) {
  if (!carpeta || carpeta.local) return;
  let permiso = await carpeta.queryPermission({ mode: 'readwrite' });
  if (permiso !== 'granted') permiso = await carpeta.requestPermission({ mode: 'readwrite' });
  if (permiso !== 'granted') throw new Error('Autoriza el acceso a la carpeta de destino o elige otra con el botón de carpeta.');
}

/** Guarda en la carpeta elegida. Sin carpeta configurada, utiliza las descargas habituales. */
export async function guardarArchivoCopia(fila, carpeta, navegador = globalThis) {
  if (!carpeta) {
    descargarCopia(fila);
    return { descarga: true, nombre: nombreCopia(fila) };
  }
  if (carpeta.local) return llamarLocal(navegador, 'guardar', { ruta: carpeta.ruta, nombre: nombreCopia(fila), paquete: fila.paquete });
  await autorizarDestinoCopias(carpeta);
  const base = nombreCopia(fila).replace(/\.json$/, '');
  // Una segunda exportación conserva el archivo que ya existía.
  for (let intento = 0; intento < 1000; intento++) {
    const nombre = `${base}${intento ? ` (${intento + 1})` : ''}.json`;
    try { await carpeta.getFileHandle(nombre); continue; }
    catch (e) { if (e.name !== 'NotFoundError') throw e; }
    const archivo = await carpeta.getFileHandle(nombre, { create: true });
    const salida = await archivo.createWritable();
    try {
      await salida.write(new Blob([JSON.stringify(fila.paquete)], { type: 'application/json' }));
      await salida.close();
    } catch (e) { await salida.abort().catch(() => {}); throw e; }
    return { descarga: false, nombre };
  }
  throw new Error('Hay demasiados archivos con ese nombre. Elige otra carpeta de destino.');
}
