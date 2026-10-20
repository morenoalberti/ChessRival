// Conectar una base o un libro de ChessBase eligiendo UNA carpeta. Es lo más sencillo que permite el navegador: no deja leer lo que el usuario no ha
// elegido expresamente ni encontrar los archivos «hermanos» de uno elegido (el .cbg, .cbp y .cbt de un .cbh), pero con una carpeta elegida sí se
// pueden leer todos sus archivos. El usuario solo tiene que llegar a la carpeta y pulsar «Seleccionar carpeta»: aquí se encuentra el archivo que
// importa, aunque esté en una subcarpeta, y se cogen los demás por su nombre.

const PROFUNDIDAD = 2;     // cuántos niveles de subcarpetas se miran por si el usuario elige una carpeta más arriba

async function buscar(carpeta, principal, nivel, hallados) {
  const subcarpetas = [];
  for await (const [nombre, h] of carpeta.entries()) {
    if (h.kind === 'file' && nombre.toLowerCase().endsWith(`.${principal}`)) hallados.push({ carpeta, archivo: h });
    else if (h.kind === 'directory' && nivel < PROFUNDIDAD) subcarpetas.push(h);
  }
  if (hallados.length) return;                 // en cuanto una carpeta tiene el archivo, no se baja más
  for (const sub of subcarpetas) { await buscar(sub, principal, nivel + 1, hallados); if (hallados.length) return; }
}

/** @param {{ id, principal, extensiones, nombre }} o  principal: extensión del archivo que da el nombre («cbh»); extensiones: todas las necesarias;
 *  nombre: cómo se llama lo que se busca («la base», «el libro»). Devuelve { archivos: { cbh: handle, … }, base } o { error } o undefined si se cancela. */
export async function elegirCarpetaDe({ id, principal, extensiones, nombre }) {
  if (!('showDirectoryPicker' in window)) return { error: 'Tu navegador no permite leer archivos del disco. Usa Chrome o Edge.' };
  let carpeta;
  try { carpeta = await showDirectoryPicker({ id, mode: 'read' }); }
  catch (ex) {
    if (ex?.name === 'AbortError') return undefined;
    return { error: `El navegador no permite elegir esa carpeta (por ejemplo, Documentos, Descargas o el escritorio). Elige la carpeta donde guardas ${nombre}.` };
  }

  const hallados = [];
  await buscar(carpeta, principal, 0, hallados);
  if (!hallados.length) return { error: `En la carpeta «${carpeta.name}» no hay ningún archivo .${principal}. Elige la carpeta donde guardas ${nombre}.` };

  // Si hay varios (varias bases en la misma carpeta), el más grande: la MegaDatabase.
  let elegido = hallados[0];
  if (hallados.length > 1) {
    const tamaños = await Promise.all(hallados.map(async h => (await h.archivo.getFile()).size));
    elegido = hallados[tamaños.indexOf(Math.max(...tamaños))];
  }
  const base = elegido.archivo.name.slice(0, -(principal.length + 1));
  const vecinos = new Map();
  for await (const [n, h] of elegido.carpeta.entries()) if (h.kind === 'file') vecinos.set(n.toLowerCase(), h);
  const archivos = {};
  const faltan = [];
  for (const ext of extensiones) {
    const h = vecinos.get(`${base}.${ext}`.toLowerCase());
    if (h) archivos[ext] = h; else faltan.push(`${base}.${ext}`);
  }
  if (faltan.length) return { error: `Falta algún archivo al lado de «${base}.${principal}»: ${faltan.join(', ')}.` };
  return { archivos, base };
}
