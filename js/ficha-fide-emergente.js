import { estadisticasFide, historialElo } from './fuentes.js';
import { PROXY_URL } from './config.js';
import { svg } from './iconos.js';
import { htmlFichaFide, posicionFichaFide } from './ficha-fide-datos.js';
import { montarGraficoElo } from './grafico-elo.js';
import { completarConHistorial } from './fide-historial-datos.js';

/** Una ficha flotante compartida por todas las tarjetas. Las respuestas tardías nunca vuelven a abrirla. */
export function instalarFichaFide(contenedor, obtenerJugador, { cargar = estadisticasFide, cargarHistorial = historialElo, foto = j => j.fideId && PROXY_URL ? `${PROXY_URL}/api/fide/foto?id=${encodeURIComponent(j.fideId)}` : j.photo || '' } = {}) {
  const ficha = document.createElement('section');
  ficha.className = 'fide-emergente'; ficha.id = 'ficha-fide-emergente'; ficha.hidden = true;
  ficha.setAttribute('role', 'region'); ficha.setAttribute('aria-label', 'Ficha FIDE del jugador');
  document.body.append(ficha);
  let tarjeta = null, abrir = null, cerrar = null, version = 0;
  let grafico = null, evolucion = null;
  const cache = new Map();
  function ocultar() {
    clearTimeout(abrir); clearTimeout(cerrar); version++;
    tarjeta?.removeAttribute('aria-details');
    grafico?.destruir(); grafico = null;
    tarjeta = null; ficha.hidden = true;
  }
  function situar() {
    if (!tarjeta?.isConnected) return ocultar();
    const r = tarjeta.getBoundingClientRect();
    const pos = posicionFichaFide(r, ficha.offsetWidth, ficha.offsetHeight, { ancho: innerWidth, alto: innerHeight });
    ficha.style.left = `${pos.x}px`; ficha.style.top = `${pos.y}px`;
  }
  function pintar(j, perfil, opciones) {
    grafico?.destruir(); grafico = null;
    ficha.innerHTML = `<header class="fide-emergente-cab"><span>Ficha FIDE</span><button type="button" data-cerrar-fide title="Cerrar" aria-label="Cerrar ficha FIDE">${svg('equis', 16)}</button></header>${htmlFichaFide(j, perfil, { foto: foto(j), ...opciones })}`;
    ficha.style.height = `${Math.min(j.fideId ? 660 : 440, innerHeight - 20)}px`;
    situar();
    pintarEvolucion();
  }
  function pintarEvolucion() {
    const lienzo = ficha.querySelector('[data-evolucion-elo]');
    if (!lienzo || !evolucion) return;
    grafico?.destruir(); grafico = null;
    if (evolucion.puntos?.length >= 2) {
      lienzo.classList.remove('sin-datos');
      grafico = montarGraficoElo(lienzo, evolucion.puntos);
    } else {
      lienzo.classList.add('sin-datos');
      const mensaje = document.createElement('p'); mensaje.className = 'suave'; mensaje.setAttribute('role', 'status');
      mensaje.textContent = evolucion.error ? 'No se pudo cargar la evolución del ELO.' : 'No hay historial de ELO disponible.';
      lienzo.replaceChildren(mensaje);
    }
  }
  async function mostrar(elemento) {
    if (!elemento.isConnected || elemento.closest('.arrastrando') || document.querySelector('.velo')) return;
    const j = obtenerJugador(elemento);
    if (!j || !/^[1-9]\d*$/.test(j.fideId || '')) return ocultar();
    tarjeta?.removeAttribute('aria-details'); tarjeta = elemento;
    tarjeta.setAttribute('aria-details', ficha.id);
    const mi = ++version;
    evolucion = null;
    ficha.hidden = false;
    pintar(j, null, { cargando: true });
    let entrada = cache.get(j.fideId);
    if (!entrada || Date.now() - entrada.fecha > 900000) {
      entrada = { fecha: Date.now(), promesa: Promise.resolve().then(() => cargar(j.fideId)),
        historial: Promise.resolve().then(() => cargarHistorial(j.fideId))
          .then(puntos => ({ puntos: puntos.filter(p => [p.standard, p.rapid, p.blitz].some(v => v > 0)) })).catch(() => ({ error: true })) };
      cache.set(j.fideId, entrada);
    }
    const consultada = entrada;
    entrada.historial.then(datos => {
      if (datos.error && cache.get(j.fideId) === consultada) cache.delete(j.fideId);
      if (mi !== version || ficha.hidden || !tarjeta?.isConnected) return;
      evolucion = datos; pintarEvolucion();
    });
    try {
      const datos = await entrada.promesa;
      const hist = await entrada.historial;        // el historial completa las tarjetas cuando la FIDE no da los resultados
      const perfil = datos?.bloques ? { ...datos, bloques: completarConHistorial(datos.bloques, hist?.puntos) } : datos;
      if (mi === version && !ficha.hidden && tarjeta?.isConnected) pintar(j, perfil);
    } catch {
      if (cache.get(j.fideId) === entrada) cache.delete(j.fideId);
      if (mi === version && !ficha.hidden) pintar(j, null, { error: 'No se pudieron obtener las estadísticas. Comprueba la conexión y el servidor local.' });
    }
  }
  // La ficha se abre con el ojo de la tarjeta (pulsarlo de nuevo la cierra) y se cierra al pulsar fuera de ella.
  contenedor.addEventListener('click', e => {
    const ojo = e.target.closest('[data-ver-fide]');
    if (!ojo) return;
    e.stopPropagation();
    const t = ojo.closest('.tarjeta');
    if (t === tarjeta && !ficha.hidden) { ocultar(); return; }
    ocultar();
    mostrar(t);
  });
  ficha.addEventListener('click', e => { if (e.target.closest('[data-cerrar-fide]')) ocultar(); });
  ficha.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.hidden = true; }, true);
  document.addEventListener('pointerdown', e => { if (!ficha.contains(e.target) && !e.target.closest('[data-ver-fide]')) ocultar(); });
  document.addEventListener('dragstart', ocultar);
  contenedor.addEventListener('dblclick', ocultar);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') ocultar(); });
  document.addEventListener('scroll', e => { if (!ficha.contains(e.target)) ocultar(); }, true);
  window.addEventListener('resize', ocultar);
  window.addEventListener('blur', ocultar);
  document.addEventListener('visibilitychange', () => { if (document.hidden) ocultar(); });
  new MutationObserver(() => { if (tarjeta && !tarjeta.isConnected) ocultar(); }).observe(contenedor, { childList: true });
  return { ocultar };
}
