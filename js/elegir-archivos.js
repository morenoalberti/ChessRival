// Elegir un archivo y encontrar sus «hermanos» (los que tienen el mismo nombre y otra extensión), como hace el cuadro de Windows del programa de escritorio.
// El navegador solo deja leer lo que el usuario elige expresamente: por eso primero se elige el archivo principal (el único que se ve en el cuadro) y
// después se da permiso para su carpeta (el cuadro se abre ya dentro de ella; basta pulsar «Seleccionar carpeta»), de donde salen los demás.
import { informar } from './dialogos.js';

/** @param {{ id, principal, hermanos, descripcion, paso2 }} o
 *  principal: extensión del archivo que se elige («cbh»); hermanos: las otras extensiones obligatorias; paso2: texto que explica el segundo cuadro.
 *  Devuelve { archivos: { cbh: handle, … }, base } o { error } o undefined si el usuario cancela. */
export async function elegirConHermanos({ id, principal, hermanos, descripcion, paso2 }) {
  if (!('showOpenFilePicker' in window) || !('showDirectoryPicker' in window)) return { error: 'Tu navegador no permite leer archivos del disco. Usa Chrome o Edge.' };

  // 1) El archivo principal: el cuadro solo enseña los de esa extensión.
  let archivo;
  try {
    [archivo] = await showOpenFilePicker({ id, multiple: false, excludeAcceptAllOption: true, types: [{ description: descripcion, accept: { 'application/octet-stream': [`.${principal}`] } }] });
  } catch (ex) {
    if (ex?.name === 'AbortError') return undefined;
    return { error: `El navegador no ha podido abrir el cuadro de archivos: ${ex.message}` };
  }
  const base = archivo.name.replace(new RegExp(`\\.${principal}$`, 'i'), '');

  // 2) Permiso para su carpeta: un clic en un aviso (el navegador exige un gesto del usuario para abrir cada cuadro).
  await informar('Un paso más', paso2.replace('{}', base), 'Dar permiso');
  let carpeta;
  try { carpeta = await showDirectoryPicker({ id: `${id}-carpeta`, mode: 'read', startIn: archivo }); }
  catch (ex) {
    if (ex?.name === 'AbortError') return undefined;
    return { error: 'El navegador no permite elegir esa carpeta (por ejemplo, Documentos, Descargas o el escritorio). Mueve la base a otra carpeta e inténtalo de nuevo.' };
  }
  // La carpeta tiene que ser la del archivo elegido.
  let dentro = null;
  try { dentro = await carpeta.resolve(archivo); } catch { /* sin resolver */ }
  if (!dentro) return { error: `Esa no es la carpeta de «${archivo.name}». Elige la carpeta que contiene el archivo.` };

  // 3) Los demás archivos de la base, que están al lado.
  const todos = new Map();
  for await (const [nombre, h] of carpeta.entries()) if (h.kind === 'file') todos.set(nombre.toLowerCase(), h);
  const archivos = { [principal]: archivo };
  const faltan = [];
  for (const ext of hermanos) {
    const h = todos.get(`${base}.${ext}`.toLowerCase());
    if (h) archivos[ext] = h; else faltan.push(`${base}.${ext}`);
  }
  if (faltan.length) return { error: `Faltan archivos al lado de «${archivo.name}»: ${faltan.join(', ')}.` };
  return { archivos, base };
}
