// El visor de partidas se abre dentro de la propia página, en un panel como el de la ayuda, y no en una ventana aparte del navegador.
import { abrirPanel } from './panel-utilidad.js';
import { t as tr } from './i18n.js';

/** @param {number} partidaId  @param {{ ply?: number, titulo?: string }} opciones  ply: la jugada en la que se abre; titulo: lo que se escribe tras «Partida ·». */
export function abrirVisorEnPanel(partidaId, { ply = null, titulo = '' } = {}) {
  let marco = null;
  const posicion = Number.isInteger(ply) && ply >= 0 ? `&ply=${ply}` : '';
  const panel = abrirPanel(`${tr('Partida')}${titulo ? ` · ${titulo}` : ` ${partidaId}`}`,
    `<iframe class="visor-marco" src="visor.html?id=${partidaId}&incrustado=1${posicion}" title="${tr('Partida')}"></iframe>`, 'panel-visor',
    { antesDeCerrar: async () => (await marco?.contentWindow?.confirmarCierreVisor?.()) !== false });
  if (!panel) return null;
  // El visor pide cerrarse (tecla Escape dentro del marco) con un mensaje a la página que lo contiene.
  const escuchar = (e) => {
    if (!panel.velo.isConnected) return removeEventListener('message', escuchar);
    if (e.origin === location.origin && e.data?.tipo === 'cerrar-visor') { removeEventListener('message', escuchar); panel.cerrar(); }
  };
  addEventListener('message', escuchar);
  marco = panel.velo.querySelector('iframe');
  marco?.focus();
  return panel;
}
