// Cuadro «Importar partidas» (ImportarPartidasDialog.xaml): elegir o arrastrar archivos PGN y traer las partidas del jugador.
import { LOCALE } from './i18n.js';
import { contenidoBoton } from './iconos.js';
import { informar } from './dialogos.js';
import { leerArchivo, importar, mensaje } from './importador.js';
import * as mega from './mega.js';
import { nombreConTitulo } from './nombre-jugador.js';
import { montarAccesoAhoraAjedrez } from './ahora-ajedrez.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tam = (b) => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

/** Devuelve el resultado de la importación, o null si se cierra sin importar. */
export function abrirImportar(jugador, { alAbrirYotta } = {}) {
  return new Promise((resolver) => {
    const previo = document.activeElement;
    let lecturas = [], ocupado = false, resultado = null;

    const velo = document.createElement('div');
    velo.className = 'velo';
    velo.innerHTML = `
      <div class="dialogo dialogo-importar" role="dialog" aria-modal="true" aria-label="Importar partidas">
        <div class="dialogo-cab"><img src="assets/icon.png" alt=""><span>Importar partidas · ${esc(nombreConTitulo(jugador))}</span></div>
        <div class="importar-cuerpo">
          <p class="importar-intro">Se importan las partidas de este jugador de los archivos PGN que elijas (YottaChess, ChessBase, Lichess…). Las que ya estén guardadas no se repiten.</p>

          <div class="importar-caja">
            <div class="importar-fila">
              <div class="importar-texto"><b>Archivos PGN</b><span class="suave">Elige uno o varios, o suéltalos aquí.</span></div>
              <button type="button" class="btn btn-secundario btn-chico" data-elegir></button>
            </div>
            <div class="importar-zona" data-zona tabindex="0">
              <span data-lista class="suave">Ningún archivo todavía</span>
            </div>
          </div>

          <div class="importar-caja">
            <div class="importar-fila">
              <div class="importar-texto"><b>YottaChess</b><span class="suave">Copia su ID FIDE y abre YottaChess: descarga allí el PGN y elígelo arriba.</span></div>
              <button type="button" class="btn btn-secundario btn-chico" data-yotta></button>
            </div>
          </div>

          <div class="importar-caja">
            <div class="importar-fila">
              <div class="importar-texto"><b>AhoraAjedrez</b><span class="suave">Baja el PGN de sus partidas</span></div>
              <a class="btn btn-secundario btn-chico" data-ahora href="https://ahoraajedrez.com/" target="_blank" rel="noopener noreferrer"></a>
            </div>
          </div>

          <div class="importar-caja">
            <div class="importar-fila">
              <div class="importar-texto"><b>MegaDatabase de ChessBase</b><span class="suave" data-mega-estado></span></div>
              <button type="button" class="btn btn-secundario btn-chico" data-mega-permiso hidden></button>
            </div>
          </div>

          <p class="importar-progreso" data-progreso hidden></p>
          <div class="importar-botones">
            <button type="button" class="btn btn-primario" data-importar disabled></button>
            <button type="button" class="btn btn-secundario" data-cerrar></button>
          </div>
        </div>
      </div>
      <input type="file" accept=".pgn,.txt,text/plain" multiple hidden data-entrada>`;

    const $ = (s) => velo.querySelector(s);
    $('[data-elegir]').innerHTML = contenidoBoton('carpeta', 'Elegir archivos');
    $('[data-yotta]').innerHTML = contenidoBoton('enlace', 'Abrir YottaChess');
    montarAccesoAhoraAjedrez($('[data-ahora]'), jugador);
    $('[data-importar]').innerHTML = contenidoBoton('descargar', 'Importar');
    $('[data-cerrar]').innerHTML = contenidoBoton('equis', 'Cerrar');

    const cerrar = () => {
      if (ocupado) return;
      document.removeEventListener('keydown', teclas, true);
      velo.classList.add('saliendo');
      setTimeout(() => { velo.remove(); previo?.focus?.(); }, 160);
      resolver(resultado);
    };
    const teclas = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); } };

    const pintarLista = () => {
      const lista = $('[data-lista]');
      if (!lecturas.length) { lista.className = 'suave'; lista.textContent = 'Ningún archivo todavía'; }
      else {
        lista.className = '';
        lista.innerHTML = lecturas.map(l => `<div class="importar-archivo ${l.suyas ? '' : 'sin-suyas'}">
          <span class="recortar" title="${esc(l.archivo.name)}">${esc(l.archivo.name)}</span>
          <span class="suave">${l.suyas} suyas de ${l.total} · ${tam(l.archivo.size)}</span></div>`).join('');
      }
      $('[data-importar]').disabled = ocupado || !(lecturas.some(l => l.suyas > 0) || mega.estado.base || mega.estado.pendiente);
    };

    // Estado de la MegaDatabase: conectada, a la espera del permiso del navegador o sin elegir.
    const pintarMega = () => {
      const e = mega.estado, t = $('[data-mega-estado]'), b = $('[data-mega-permiso]');
      b.hidden = !e.pendiente;
      if (e.base) t.textContent = `${e.base.nombre} · ${e.base.totalPartidas.toLocaleString(LOCALE)} partidas. Se buscan por nombre y ELO (ChessBase no guarda el ID FIDE); tarda unos segundos.`;
      else if (e.pendiente) t.textContent = `${e.nombre || 'La MegaDatabase'} está elegida, pero el navegador pide confirmar el acceso a sus archivos.`;
      else if (e.error) t.textContent = `No disponible: ${e.error}`;
      else t.textContent = 'Todavía no has elegido tu MegaDatabase. Hazlo con el botón «Elegir» del aviso de MegaDatabase de la pantalla principal.';
      pintarLista();
    };

    const anadir = async (archivos) => {
      const progreso = $('[data-progreso]');
      progreso.hidden = false;
      progreso.textContent = 'Leyendo archivos…';
      try {
        for (const a of archivos) {
          if (lecturas.some(l => l.archivo.name === a.name && l.archivo.size === a.size)) continue;
          lecturas.push(await leerArchivo(a, jugador));
          pintarLista();
        }
        progreso.hidden = true;
        const sin = lecturas.filter(l => !l.suyas);
        if (lecturas.length && lecturas.every(l => !l.suyas)) {
          progreso.hidden = false;
          progreso.textContent = 'Ninguno de los archivos tiene partidas de este jugador. Comprueba que su nombre aparece igual en las cabeceras White y Black.';
        } else if (sin.length) {
          progreso.hidden = false;
          progreso.textContent = `${sin.length === 1 ? 'Un archivo no tiene' : `${sin.length} archivos no tienen`} partidas suyas y se ignorará${sin.length === 1 ? '' : 'n'}.`;
        }
      } catch (ex) { progreso.textContent = `No se pudo leer el archivo: ${ex.message}`; }
    };

    $('[data-elegir]').addEventListener('click', () => $('[data-entrada]').click());
    $('[data-entrada]').addEventListener('change', (e) => { anadir([...e.target.files]); e.target.value = ''; });
    const zona = $('[data-zona]');
    zona.addEventListener('click', () => { if (!lecturas.length) $('[data-entrada]').click(); });
    zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('encima'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('encima'));
    zona.addEventListener('drop', (e) => { e.preventDefault(); zona.classList.remove('encima'); anadir([...e.dataTransfer.files].filter(f => /\.(pgn|txt)$/i.test(f.name))); });

    $('[data-yotta]').addEventListener('click', () => alAbrirYotta?.());
    $('[data-cerrar]').addEventListener('click', cerrar);
    velo.addEventListener('mousedown', (e) => { if (e.target === velo) cerrar(); });

    $('[data-importar]').addEventListener('click', async () => {
      ocupado = true;
      $('[data-importar]').disabled = true;
      const progreso = $('[data-progreso]');
      progreso.hidden = false;
      progreso.textContent = 'Importando…';
      try {
        // MegaDatabase: si el navegador pide permiso para sus archivos, se pide ahora (hace falta un clic del usuario).
        if (mega.estado.pendiente && !await mega.pedirPermiso()) { progreso.textContent = 'No se ha dado permiso para leer la MegaDatabase.'; }
        pintarMega();

        let textoMega = null, textoPgn = null;
        const aImportar = lecturas.filter(l => l.suyas > 0);
        if (aImportar.length) {
          progreso.textContent = 'Importando de los archivos PGN…';
          const r = await importar(jugador, aImportar, 'PGN', (t) => { progreso.textContent = t; });
          textoPgn = mensaje(nombreConTitulo(jugador), r);
          resultado = { ...(resultado ?? {}), pgn: r };
        }
        if (mega.estado.base) {
          try {
            const m = await mega.importar(jugador, (t) => { progreso.textContent = `MegaDatabase · ${t}`; });
            const ya = m.yaEstaban > 0 ? ` y ${m.yaEstaban} que ${m.yaEstaban === 1 ? 'ya estaba guardada' : 'ya estaban guardadas'}` : '';
            textoMega = m.candidatas === 0 ? 'no hay partidas suyas en la base.'
              : m.candidatas > mega.MAX_POR_JUGADOR
                ? `se cogen las ${mega.MAX_POR_JUGADOR} más recientes de las ${m.candidatas.toLocaleString(LOCALE)} que coinciden con su nombre y ELO: ${m.nuevas} nuevas${ya}.`
                : `${m.nuevas} nuevas de las ${m.candidatas} partidas que coinciden con su nombre y ELO${m.yaEstaban ? ` (${m.yaEstaban} ya ${m.yaEstaban === 1 ? 'estaba guardada' : 'estaban guardadas'})` : ''}.`;
            if (m.noLegibles) textoMega += ` ${m.noLegibles} no se han podido leer.`;
            resultado = { ...(resultado ?? {}), mega: m };
          } catch (ex) { textoMega = `no se pudo leer (${ex.message}).`; }
        }
        ocupado = false;
        document.removeEventListener('keydown', teclas, true);
        velo.remove();
        const partes = [];
        if (textoMega !== null) partes.push(`•  MegaDatabase: ${textoMega}`);
        if (textoPgn !== null) partes.push(`•  Archivos PGN: ${textoPgn}`);
        await informar('Importación terminada', `Partidas importadas de ${nombreConTitulo(jugador)}:\n\n${partes.join('\n\n') || 'No había nada que importar.'}`);
        resolver(resultado);
      } catch (ex) {
        ocupado = false;
        progreso.textContent = `No se pudo importar: ${ex.message}`;
        pintarLista();
      }
    });

    $('[data-mega-permiso]').innerHTML = contenidoBoton('visto', 'Permitir');
    $('[data-mega-permiso]').addEventListener('click', async () => { await mega.pedirPermiso(); pintarMega(); });
    document.addEventListener('keydown', teclas, true);
    document.body.appendChild(velo);
    pintarMega();
    $('[data-elegir]').focus();
  });
}
