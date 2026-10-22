export const rutaFotoFide = id => `/api/fide/foto?id=${encodeURIComponent(id)}`;

/** Render (o servidor local) primero; Cloudflare conserva las fuentes alternativas. */
export async function descargarImagenJugador(id, proxy) {
  const ruta = rutaFotoFide(id);
  const rutas = [ruta, ...(proxy ? [proxy + ruta] : [])];
  let fallo = null;
  for (const url of rutas) {
    try {
      const r = await fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(15000) });
      if (r.status === 404) continue;
      if (!r.ok) throw new Error(`Error ${r.status} al descargar la foto`);
      if (!r.headers.get('content-type')?.startsWith('image/')) throw new Error('La fuente no ha devuelto una imagen.');
      return await r.blob();
    } catch (ex) { fallo = ex; }
  }
  if (fallo) throw fallo;
  return null;
}
