// Cuadro «Importar partidas» (ImportarPartidasDialog.xaml): elegir o arrastrar archivos PGN y traer las partidas del jugador.
import { LOCALE } from './i18n.js';
import { contenidoBoton } from './iconos.js';
import { informar } from './dialogos.js';
import { leerArchivo, importar, mensaje } from './importador.js';
import * as mega from './mega.js';
import { nombreConTitulo } from './nombre-jugador.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tam = (b) => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
const FUENTES_PGN = [
  { id: 'pgn', nombre: 'Archivos PGN', fuente: 'PGN', ayuda: 'Elige uno o varios PGN de otras fuentes.' },
  { id: 'yotta', nombre: 'YottaChess', fuente: 'YottaChess', ayuda: 'Elige el PGN descargado de YottaChess.' },
  { id: 'ahora', nombre: 'AhoraAjedrez', fuente: 'AhoraAjedrez', ayuda: 'Elige el PGN descargado de AhoraAjedrez.' }
];

/** Devuelve el resultado de la importación, o null si se cierra sin importar. */
export function abrirImportar(jugador) {
  return new Promise((resolver) => {
    const previo = document.activeElement;
    let lecturas = [], ocupado = false, leyendo = false, resultado = null;

    const velo = document.createElement('div');
    velo.className = 'velo';
    velo.innerHTML = `
      <div class="dialogo dialogo-importar" role="dialog" aria-modal="true" aria-label="Importar partidas">
        <div class="dialogo-cab"><img src="assets/icon.png" alt=""><span>Importar partidas · ${esc(nombreConTitulo(jugador))}</span></div>
        <div class="importar-cuerpo">
          <p class="importar-intro">Se importan las partidas de este jugador de los archivos PGN que elijas (YottaChess, ChessBase, Lichess…). Las que ya estén guardadas no se repiten.</p>

          ${FUENTES_PGN.map(f => `<div class="importar-caja" data-fuente="${f.id}">
            <div class="importar-fila">
              <div class="importar-texto"><b>${f.nombre}</b><span class="suave">${f.ayuda}</span></div>
              <button type="button" class="btn btn-secundario btn-chico" data-elegir="${f.id}"></button>
            </div>
            <div class="importar-zona" data-zona="${f.id}" tabindex="0" role="button" aria-label="Elegir PGN de ${f.nombre}">
              <span data-lista="${f.id}" class="suave">Ningún archivo todavía</span>
            </div>
            <div class="importar-recuento" data-recuento="${f.id}" aria-live="polite" hidden></div>
            <input type="file" accept=".pgn,.txt,text/plain" multiple hidden data-entrada="${f.id}">
          </div>`).join('')}

          <div class="importar-caja">
            <div class="importar-fila">
              <div class="importar-texto"><b>MegaDatabase de ChessBase</b><span class="suave" data-mega-estado></span></div>
              <button type="button" class="btn btn-secundario btn-chico" data-mega-permiso hidden></button>
            </div>
          </div>

          <p class="importar-nota suave">Al importar, las partidas repetidas entre PGN y MegaDatabase se guardan una sola vez.</p>
          <p class="importar-progreso" data-progreso hidden></p>
          <div class="importar-botones">
            <button type="button" class="btn btn-primario" data-importar disabled></button>
            <button type="button" class="btn btn-secundario" data-cerrar></button>
          </div>
        </div>
      </div>`;

    const $ = (s) => velo.querySelector(s);
    for (const f of FUENTES_PGN) $(`[data-elegir="${f.id}"]`).innerHTML = contenidoBoton('carpeta', 'Elegir archivos');
    $('[data-importar]').innerHTML = contenidoBoton('descargar', 'Importar');
    $('[data-cerrar]').innerHTML = contenidoBoton('equis', 'Cerrar');

    const cerrar = () => {
      if (ocupado || leyendo) return;
      document.removeEventListener('keydown', teclas, true);
      velo.classList.add('saliendo');
      setTimeout(() => { velo.remove(); previo?.focus?.(); }, 160);
      resolver(resultado);
    };
    const teclas = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); } };

    const pintarLista = () => {
      for (const f of FUENTES_PGN) {
        const propias = lecturas.filter(l => l.fuente === f.fuente);
        const lista = $(`[data-lista="${f.id}"]`), recuento = $(`[data-recuento="${f.id}"]`);
        if (!propias.length) { lista.className = 'suave'; lista.textContent = 'Ningún archivo todavía'; }
        else {
          lista.className = '';
          lista.innerHTML = propias.map(l => `<div class="importar-archivo ${l.suyas ? '' : 'sin-suyas'}">
            <span class="recortar" title="${esc(l.archivo.name)}">${esc(l.archivo.name)}</span>
            <span class="suave">${l.suyas} suyas de ${l.total} · ${tam(l.archivo.size)}</span></div>`).join('');
        }
        const n = propias.reduce((s, l) => s + l.suyas, 0);
        recuento.hidden = !propias.length;
        recuento.textContent = n === 1 ? '1 partida del jugador cargada' : `${n} partidas del jugador cargadas`;
        $(`[data-elegir="${f.id}"]`).disabled = ocupado || leyendo;
        $(`[data-zona="${f.id}"]`).setAttribute('aria-disabled', String(ocupado || leyendo));
      }
      $('[data-cerrar]').disabled = ocupado || leyendo;
      $('[data-importar]').disabled = ocupado || leyendo || !(lecturas.some(l => l.suyas > 0) || mega.estado.base || mega.estado.pendiente);
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

    const anadir = async (archivos, fuente) => {
      if (ocupado || leyendo || !archivos.length) return;
      leyendo = true;
      pintarLista();
      const progreso = $('[data-progreso]');
      progreso.hidden = false;
      progreso.textContent = 'Leyendo archivos…';
      try {
        for (const a of archivos) {
          if (lecturas.some(l => l.fuente === fuente && l.archivo.name === a.name && l.archivo.size === a.size && l.archivo.lastModified === a.lastModified)) continue;
          lecturas.push({ ...await leerArchivo(a, jugador), fuente });
          pintarLista();
        }
        progreso.hidden = true;
        const deFuente = lecturas.filter(l => l.fuente === fuente), sin = deFuente.filter(l => !l.suyas);
        if (deFuente.length && deFuente.every(l => !l.suyas)) {
          progreso.hidden = false;
          progreso.textContent = 'Ninguno de los archivos tiene partidas de este jugador. Comprueba que su nombre aparece igual en las cabeceras White y Black.';
        } else if (sin.length) {
          progreso.hidden = false;
          progreso.textContent = `${sin.length === 1 ? 'Un archivo no tiene' : `${sin.length} archivos no tienen`} partidas suyas y se ignorará${sin.length === 1 ? '' : 'n'}.`;
        }
      } catch (ex) { progreso.hidden = false; progreso.textContent = `No se pudo leer el archivo: ${ex.message}`; }
      finally { leyendo = false; pintarLista(); }
    };

    for (const f of FUENTES_PGN) {
      const entrada = $(`[data-entrada="${f.id}"]`), zona = $(`[data-zona="${f.id}"]`);
      const elegir = () => { if (!ocupado && !leyendo) entrada.click(); };
      $(`[data-elegir="${f.id}"]`).addEventListener('click', elegir);
      entrada.addEventListener('change', e => { anadir([...e.target.files], f.fuente); e.target.value = ''; });
      zona.addEventListener('click', elegir);
      zona.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); elegir(); } });
      zona.addEventListener('dragover', e => { e.preventDefault(); if (!ocupado && !leyendo) zona.classList.add('encima'); });
      zona.addEventListener('dragleave', () => zona.classList.remove('encima'));
      zona.addEventListener('drop', e => { e.preventDefault(); zona.classList.remove('encima'); anadir([...e.dataTransfer.files].filter(a => /\.(pgn|txt)$/i.test(a.name)), f.fuente); });
    }
    $('[data-cerrar]').addEventListener('click', cerrar);
    velo.addEventListener('mousedown', (e) => { if (e.target === velo) cerrar(); });

    $('[data-importar]').addEventListener('click', async () => {
      if (ocupado || leyendo) return;
      ocupado = true;
      pintarLista();
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
