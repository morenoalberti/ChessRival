// La ayuda sale fuera de las secciones con scroll para que no se recorte.
export function montarAyudaTarjetas() {
  const flotante = document.createElement('div');
  flotante.className = 'popover-ayuda ayuda-tarjeta-flotante';
  flotante.id = 'ayudaTarjetaFlotante';
  flotante.role = 'tooltip';
  flotante.hidden = true;
  document.body.append(flotante);
  let activa = null, temporizador = null;

  function colocar() {
    if (!activa || flotante.hidden) return;
    const caja = activa.getBoundingClientRect(), margen = 12, separacion = 8;
    const alto = flotante.offsetHeight, ancho = flotante.offsetWidth;
    const debajo = caja.bottom + separacion;
    const arriba = caja.top - alto - separacion;
    const top = debajo + alto <= innerHeight - margen ? debajo
      : arriba >= margen ? arriba : Math.max(margen, Math.min(arriba, innerHeight - alto - margen));
    flotante.style.left = `${Math.max(margen, Math.min(caja.left, innerWidth - ancho - margen))}px`;
    flotante.style.top = `${top}px`;
  }

  function ocultar() {
    clearTimeout(temporizador);
    if (activa) {
      const ids = (activa.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== flotante.id);
      if (ids.length) activa.setAttribute('aria-describedby', ids.join(' '));
      else activa.removeAttribute('aria-describedby');
    }
    activa = null;
    flotante.hidden = true;
  }

  for (const tarjeta of document.querySelectorAll('.tarjeta-degradado')) {
    const fuente = tarjeta.querySelector('.popover-ayuda');
    if (!fuente) continue;
    function mostrar() {
      ocultar();
      if (!tarjeta.classList.contains('con-datos') || !fuente.textContent.trim()) return;
      temporizador = setTimeout(() => {
        activa = tarjeta;
        flotante.innerHTML = fuente.innerHTML;
        flotante.hidden = false;
        const ids = (tarjeta.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
        tarjeta.setAttribute('aria-describedby', [...new Set([...ids, flotante.id])].join(' '));
        colocar();
      }, 250);
    }
    tarjeta.addEventListener('pointerenter', mostrar);
    tarjeta.addEventListener('pointerleave', () => { clearTimeout(temporizador); temporizador = setTimeout(ocultar, 120); });
    tarjeta.addEventListener('focusin', mostrar);
    tarjeta.addEventListener('focusout', e => { if (!tarjeta.contains(e.relatedTarget)) ocultar(); });
    new MutationObserver(() => {
      if (activa !== tarjeta) return;
      if (!fuente.textContent.trim()) { ocultar(); return; }
      flotante.innerHTML = fuente.innerHTML;
      colocar();
    }).observe(fuente, { childList: true, subtree: true, characterData: true });
  }
  flotante.addEventListener('pointerenter', () => clearTimeout(temporizador));
  flotante.addEventListener('pointerleave', ocultar);
  window.addEventListener('resize', ocultar);
  document.addEventListener('scroll', ocultar, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') ocultar(); });
  document.addEventListener('click', e => { if (activa && !activa.contains(e.target)) ocultar(); });
}
