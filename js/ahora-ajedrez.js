// Acceso al buscador público de AhoraAjedrez, sin construir slugs a partir del nombre.
import { contenidoBoton } from './iconos.js';

const ORIGEN = 'https://ahoraajedrez.com';
const normalizar = texto => String(texto ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');

export function busquedaAhoraAjedrez(jugador) {
  const url = new URL('/', ORIGEN);
  if (jugador.name?.trim()) url.searchParams.set('s', jugador.name.trim());
  return url.href;
}

/** Solo abre una ficha si hay una única coincidencia exacta de nombre y federación. */
export async function buscarFichaAhoraAjedrez(jugador) {
  const alternativa = busquedaAhoraAjedrez(jugador);
  if (!jugador.name?.trim()) return alternativa;
  try {
    const url = new URL('/wp-json/ahora/v1/autocomplete', ORIGEN);
    url.searchParams.set('query', jugador.name.trim());
    url.searchParams.set('limit', '10');
    const respuesta = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(5000) });
    if (!respuesta.ok) return alternativa;
    const datos = await respuesta.json();
    const lista = Array.isArray(datos) ? datos : datos?.results;
    if (!Array.isArray(lista)) return alternativa;
    const coincidencias = lista.filter(p => normalizar(p.name) === normalizar(jugador.name)
      && (!jugador.federation || String(p.country ?? '').toUpperCase() === jugador.federation.toUpperCase()));
    if (coincidencias.length !== 1) return alternativa;
    const destino = new URL(coincidencias[0].url);
    return destino.origin === ORIGEN && destino.pathname.startsWith('/jugador/') && !destino.username && !destino.password
      ? destino.href : alternativa;
  } catch { return alternativa; }
}

/** Enlace normal: abre otra pestaña aunque el portapapeles o la consulta no respondan. */
export function montarAccesoAhoraAjedrez(enlace, jugador) {
  enlace.href = busquedaAhoraAjedrez(jugador);
  enlace.target = '_blank';
  enlace.rel = 'noopener noreferrer';
  enlace.innerHTML = contenidoBoton('enlace', '<span data-ahora-texto>AhoraAjedrez</span>');
  let temporizador;
  enlace.addEventListener('click', async () => {
    const id = String(jugador.fideId ?? '').trim();
    const dato = id || jugador.name || '';
    if (!dato) return;
    let copiado = false;
    try { await navigator.clipboard.writeText(dato); copiado = true; } catch { /* el enlace sigue funcionando */ }
    const texto = enlace.querySelector('[data-ahora-texto]');
    if (!texto) return;
    clearTimeout(temporizador);
    texto.textContent = copiado ? (id ? `ID ${id} copiado` : 'Nombre copiado') : (id ? `ID FIDE: ${id}` : 'AhoraAjedrez');
    temporizador = setTimeout(() => { texto.textContent = 'AhoraAjedrez'; }, 3500);
  });
  // Se resuelve mientras se carga la ficha, antes del clic, para conservar la apertura nativa del enlace.
  return buscarFichaAhoraAjedrez(jugador).then(url => { enlace.href = url; });
}
