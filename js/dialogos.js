// Cuadros de confirmación con el estilo de la aplicación (ConfirmDialog.xaml): sustituyen a alert/confirm.
import { contenidoBoton, Iconos } from './iconos.js';

const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function iniciales(nombre) {
  const partes = nombre.replace(/,/g, ' ').split(' ').filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0][0].toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/** El icono que acompaña al botón de aceptar, según lo que hace. */
function iconoDe(texto, peligro) {
  if (/^(Quitar|Borrar|Eliminar)/.test(texto)) return 'papelera';
  if (texto.startsWith('Salir')) return 'salir';
  if (texto.startsWith('Guardar')) return 'guardar';
  return peligro ? 'papelera' : 'visto';
}

function abrir({ titulo, mensaje, textoSi, textoNo, textoTercero = null, peligro = false, foto = null, nombre = null }) {
  return new Promise((resolver) => {
    const previo = document.activeElement;
    const velo = document.createElement('div');
    velo.className = 'velo';
    velo.innerHTML = `
      <div class="dialogo" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
        <div class="dialogo-cab"><img src="assets/icon.png" alt=""><span>${esc(titulo)}</span></div>
        ${foto || nombre ? `<div class="dialogo-foto">${foto ? `<img src="${esc(foto)}" alt="">` : esc(iniciales(nombre))}</div>` : ''}
        <div class="dialogo-msg ${foto || nombre ? 'centrado' : ''}">${esc(mensaje)}</div>
        <div class="dialogo-botones">
          <button class="btn ${peligro ? 'btn-peligro' : 'btn-primario'}" data-si>${contenidoBoton(iconoDe(textoSi, peligro), esc(textoSi))}</button>
          ${textoNo ? `<button class="btn btn-secundario" data-no>${contenidoBoton('equis', esc(textoNo))}</button>` : ''}
          ${textoTercero ? `<button class="btn btn-secundario" data-tercero>${contenidoBoton('atras', esc(textoTercero))}</button>` : ''}
        </div>
      </div>`;

    const cerrar = (valor) => {
      document.removeEventListener('keydown', teclas, true);
      velo.classList.add('saliendo');
      setTimeout(() => { velo.remove(); previo?.focus?.(); }, 160);
      resolver(valor);
    };
    const teclas = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(textoTercero ? null : false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); cerrar(true); }
    };
    velo.addEventListener('mousedown', (e) => { if (e.target === velo) cerrar(textoTercero ? null : false); });
    velo.querySelector('[data-si]').addEventListener('click', () => cerrar(true));
    velo.querySelector('[data-no]')?.addEventListener('click', () => cerrar(false));
    velo.querySelector('[data-tercero]')?.addEventListener('click', () => cerrar(null));
    document.addEventListener('keydown', teclas, true);
    document.body.appendChild(velo);
    velo.querySelector('[data-si]').focus();
  });
}

/** Devuelve true si el usuario confirma. */
export const preguntar = (titulo, mensaje, opciones = {}) =>
  abrir({ titulo, mensaje, textoSi: opciones.textoSi ?? 'Aceptar', textoNo: opciones.textoNo ?? 'Cancelar', ...opciones });

/** Tres opciones: devuelve true (la primera), false (la segunda) o null (la tercera, también con Escape o al pulsar fuera). */
export const preguntarTres = (titulo, mensaje, { textoSi, textoNo, textoTercero }) =>
  abrir({ titulo, mensaje, textoSi, textoNo, textoTercero });

/** Aviso con un único botón. */
export const informar = (titulo, mensaje, textoBoton = 'Entendido') =>
  abrir({ titulo, mensaje, textoSi: textoBoton, textoNo: null });

export { Iconos };

/** Lista de jugadores de la FIDE que encajan con lo escrito: devuelve el elegido o null si se cancela. */
export function elegirJugador(texto, candidatos, urlBandera = () => '') {
  return new Promise((resolver) => {
    const previo = document.activeElement;
    const velo = document.createElement('div');
    velo.className = 'velo';
    const filas = candidatos.map((c, i) => `
      <button class="candidato" type="button" data-i="${i}">
        <span class="candidato-bandera">${urlBandera(c.federacion) ? `<img src="${esc(urlBandera(c.federacion))}" alt="" onerror="this.remove()">` : ''}</span>
        <span class="candidato-nombre recortar">${c.titulo && c.titulo !== '-' ? `<b>${esc(c.titulo)}</b> ` : ''}${esc(c.nombre)}</span>
        <span class="candidato-dato">${esc(c.federacion)}</span>
        <span class="candidato-dato">${c.nacimiento && c.nacimiento !== '0' ? esc(c.nacimiento) : '—'}</span>
        <span class="candidato-elo">${c.elo || '—'}</span>
        <span class="candidato-dato">${esc(c.fideId)}</span>
      </button>`).join('');
    velo.innerHTML = `
      <div class="dialogo dialogo-ancho" role="dialog" aria-modal="true" aria-label="Elegir jugador">
        <div class="dialogo-cab"><img src="assets/icon.png" alt=""><span>Elegir jugador</span></div>
        <div class="dialogo-msg">Hay ${candidatos.length} jugadores en la FIDE que encajan con «${esc(texto)}». Elige el que buscas:</div>
        <div class="candidatos">
          <div class="candidato candidato-cab"><span></span><span>Nombre</span><span>Fed.</span><span>Nac.</span><span>ELO</span><span>ID FIDE</span></div>
          ${filas}
        </div>
        <div class="dialogo-botones"><button class="btn btn-secundario" data-no>${contenidoBoton('equis', 'Cancelar')}</button></div>
      </div>`;

    const cerrar = (valor) => {
      document.removeEventListener('keydown', teclas, true);
      velo.classList.add('saliendo');
      setTimeout(() => { velo.remove(); previo?.focus?.(); }, 160);
      resolver(valor);
    };
    const teclas = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(null); } };
    velo.addEventListener('mousedown', (e) => { if (e.target === velo) cerrar(null); });
    velo.addEventListener('click', (e) => {
      const b = e.target.closest('.candidato[data-i]');
      if (b) cerrar(candidatos[Number(b.dataset.i)]);
    });
    velo.querySelector('[data-no]').addEventListener('click', () => cerrar(null));
    document.addEventListener('keydown', teclas, true);
    document.body.appendChild(velo);
    velo.querySelector('.candidato[data-i]')?.focus();
  });
}
