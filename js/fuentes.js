// Fuentes externas (Chess-Results, Info64, FIDE). Todas pasan por el servidor intermedio (ver config.js).
// Contrato del servidor:
//   GET {PROXY}/api/torneo?url=…&top=N → { nombre, jugadores: [{ rank, name, federation, rating, points, fideId }] }
//   GET {PROXY}/api/fide/buscar?q= → [{ nombre, fideId, federacion, elo }]
import { PROXY_URL } from './config.js';

function uri(texto) {
  try { return new URL((texto ?? '').trim()); } catch { return null; }
}

/** Es la dirección de un torneo de Chess-Results o Info64. */
export function esSoportada(texto) {
  const u = uri(texto);
  if (!u || !/^https?:$/.test(u.protocol)) return false;
  const host = u.hostname.toLowerCase();
  return host.endsWith('chess-results.com') || host.includes('info64');
}

/** Lo escrito es la dirección de un torneo (y no el nombre de un jugador). */
export const esUrl = (texto) => esSoportada(texto) || /^http/i.test(texto);

/** Identifica un torneo aunque la URL cambie de parámetros: el número tnr en Chess-Results, o dominio + ruta. */
export function claveTorneo(texto) {
  const u = uri(texto);
  if (!u) return texto;
  if (u.hostname.toLowerCase().includes('chess-results')) {
    const m = /tnr(\d+)/i.exec(u.href);
    if (m) return 'cr:' + m[1];
  }
  return u.hostname.toLowerCase() + '|' + u.pathname.replace(/\/+$/, '');
}

export class SinServidor extends Error {}

async function pedir(ruta, parametros) {
  if (!PROXY_URL) {
    throw new SinServidor('Esta función necesita el servidor intermedio de Cloudflare, que aún no está configurado (js/config.js).');
  }
  const url = new URL(ruta, PROXY_URL);
  for (const [k, v] of Object.entries(parametros)) url.searchParams.set(k, v);
  let r;
  try { r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(45000) }); }
  catch (ex) {
    throw new Error(ex.name === 'TimeoutError'
      ? 'La fuente tarda demasiado en responder. Inténtalo de nuevo en un momento.'
      : 'No se pudo conectar con el servidor intermedio. Comprueba que está en marcha (iniciar.bat) y tu conexión a internet.');
  }
  if (!r.ok) throw new Error((await r.text().catch(() => '')) || `Error ${r.status} del servidor`);
  return r.json();
}

/** Los primeros `top` jugadores de la clasificación (top = 0: todos). */
export const cargarTorneo = (url, top = 5) => pedir('/api/torneo', { url: url.trim(), top });

/** Comprueba a un jugador del torneo contra la FIDE: su ID FIDE real, federación, título y edad. */
export const verificarJugador = (j) =>
  pedir('/api/jugador/verificar', { name: j.name, fideId: j.fideId, federation: j.federation, rating: j.rating });
export const buscarFide = (texto) => pedir('/api/fide/buscar', { q: texto });

/** Título(s) y edad del jugador según su perfil de la FIDE: { titulo: 'FM · AIM', edad: '58 años' }. */
export const fichaFide = (id) => pedir('/api/fide/ficha', { id });

/** La foto de su perfil de la FIDE, reducida a 160×160 y en forma de data URL. '' si no tiene foto. */
export async function descargarFoto(id) {
  if (!PROXY_URL) throw new SinServidor('Sin servidor intermedio.');
  const r = await fetch(`${PROXY_URL}/api/fide/foto?id=${encodeURIComponent(id)}`, { cache: 'no-cache', signal: AbortSignal.timeout(45000) });
  if (r.status === 404) return '';
  if (!r.ok) throw new Error(`Error ${r.status} al descargar la foto`);
  const imagen = await createImageBitmap(await r.blob());

  const tam = 160;
  const lienzo = Object.assign(document.createElement('canvas'), { width: tam, height: tam });
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });
  const lado = Math.min(imagen.width, imagen.height);   // recorte cuadrado centrado
  const origen = [(imagen.width - lado) / 2, (imagen.height - lado) / 2, lado, lado];

  // Sin foto, la FIDE devuelve una imagen transparente o blanca: más del 90 % de los píxeles lo son.
  ctx.drawImage(imagen, ...origen, 0, 0, tam, tam);
  const px = ctx.getImageData(0, 0, tam, tam).data;
  let vacios = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] < 30 || (px[i] >= 235 && px[i + 1] >= 235 && px[i + 2] >= 235)) vacios++;
  if (vacios >= (px.length / 4) * 0.9) return '';

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, tam, tam);
  ctx.drawImage(imagen, ...origen, 0, 0, tam, tam);
  return lienzo.toDataURL('image/jpeg', 0.85);
}

/** Título, edad, ELO por ritmo y resultados con blancas y negras: { titulo, edad, bloques: [{ titulo, elo, blancas, negras }] }. */
export const estadisticasFide = (id) => pedir('/api/fide/estadisticas', { id });

/** La evolución del ELO mes a mes: [{ fecha: 'AAAA-MM', standard, rapid, blitz }]. */
export const historialElo = (id) => pedir('/api/fide/historial', { id });
