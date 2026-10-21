import { svg } from './iconos.js';

export function abrirPanel(titulo, contenido, clase = '', { antesDeCerrar = null } = {}) {
  const existente = [...document.querySelectorAll('.utilidad-panel')].find(p => p.getAttribute('aria-label') === titulo);
  if (existente) { existente.querySelector('[data-cerrar-panel]')?.focus(); return null; }
  const previo = document.activeElement, velo = document.createElement('div');
  velo.className = 'velo utilidad-velo';
  velo.innerHTML = `<div class="dialogo utilidad-panel ${clase}" role="dialog" aria-modal="true">
    <div class="dialogo-cab"><img src="assets/icon.png" alt=""><span data-titulo-panel></span><button type="button" class="utilidad-cerrar" data-cerrar-panel title="Cerrar" aria-label="Cerrar">${svg('equis', 20)}</button></div>
    <div class="utilidad-cuerpo">${contenido}</div></div>`;
  const dialogo = velo.querySelector('[role="dialog"]');
  dialogo.setAttribute('aria-label', titulo);
  velo.querySelector('[data-titulo-panel]').textContent = titulo;
  let ocupado = false;
  async function cerrar() {
    if (ocupado) return;
    if (antesDeCerrar) {                            // p. ej. «¿guardar los cambios?»: si no se confirma, el panel sigue abierto
      ocupado = true;
      let seguir = true;
      try { seguir = await antesDeCerrar(); } finally { ocupado = false; }
      if (!seguir) return;
    }
    document.removeEventListener('keydown', teclas, true);
    velo.querySelector('video')?.pause();
    velo.remove(); previo?.focus?.();
  }
  function teclas(e) {
    if ([...document.querySelectorAll('.velo')].at(-1) !== velo) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); }
    if (e.key === 'Tab') {
      const campos = [...dialogo.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href], video[controls], [tabindex="0"]')].filter(x => x.getClientRects().length);
      const primero = campos[0], ultimo = campos.at(-1);
      if (!dialogo.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? ultimo : primero)?.focus(); }
      else if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo?.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero?.focus(); }
    }
  }
  velo.querySelector('[data-cerrar-panel]').addEventListener('click', cerrar);
  velo.addEventListener('mousedown', e => { if (e.target === velo) cerrar(); });
  document.addEventListener('keydown', teclas, true);
  document.body.append(velo);
  velo.querySelector('[data-cerrar-panel]').focus();
  return { velo, cerrar, ocupado(valor) { ocupado = valor; dialogo.setAttribute('aria-busy', String(valor)); velo.querySelector('[data-cerrar-panel]').disabled = valor; } };
}
