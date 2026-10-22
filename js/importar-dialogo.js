// Cuadro «Importar partidas»: revisar las carpetas PGN recordadas y traer las partidas del jugador.
import { LOCALE } from './i18n.js';
import { contenidoBoton } from './iconos.js';
import { informar } from './dialogos.js';
import { importar, mensaje } from './importador.js';
import { leerCarpetaPgn, elegirCarpetaPgn, permitirCarpetaPgn, buscarPgnEnCarpeta, agruparCarpetasPgn, repartirPgn } from './importar-carpetas.js';
import * as mega from './mega.js';
import { nombreConTitulo } from './nombre-jugador.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tam = (b) => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
const FUENTES_PGN = [
  { id: 'pgn', nombre: 'Archivos PGN' },
  { id: 'yotta', nombre: 'YottaChess' },
  { id: 'ahora', nombre: 'AhoraAjedrez' }
];

/** Devuelve el resultado de la importación, o null si se cierra sin importar. */
export function abrirImportar(jugador) {
  return new Promise((resolver) => {
    const previo = document.activeElement;
    let lecturas = [], ocupado = false, cerrado = false, iniciando = true, resultado = null;
    const control = new AbortController();
    const carpetas = Object.fromEntries(FUENTES_PGN.map(f => [f.id, { carpeta: null, buscando: false, pendiente: false, error: '', errores: [] }]));
    const leyendo = () => iniciando || Object.values(carpetas).some(c => c.buscando);

    const velo = document.createElement('div');
    velo.className = 'velo';
    velo.innerHTML = `
      <div class="dialogo dialogo-importar" role="dialog" aria-modal="true" aria-label="Importar partidas">
        <div class="dialogo-cab"><img src="assets/icon.png" alt=""><span>Importar partidas · ${esc(nombreConTitulo(jugador))}</span></div>
        <div class="importar-cuerpo">
          <p class="importar-intro">Se buscan automáticamente los PGN de este jugador en las carpetas seleccionadas. Pulsa «Importar» para guardar las partidas encontradas.</p>

          ${FUENTES_PGN.map(f => `<div class="importar-caja" data-fuente="${f.id}">
            <div class="importar-fila">
              <div class="importar-texto"><b>${f.nombre}</b><span class="suave importar-carpeta" data-carpeta="${f.id}">Carpeta seleccionada: ninguna</span></div>
              <button type="button" class="btn btn-secundario btn-chico" data-cambiar="${f.id}" aria-label="Cambiar carpeta de ${f.nombre}"></button>
              <button type="button" class="btn btn-secundario btn-chico" data-permitir="${f.id}" aria-label="Permitir acceso a la carpeta de ${f.nombre}" hidden></button>
            </div>
            <div class="importar-zona">
              <span data-lista="${f.id}" class="suave">Ningún archivo todavía</span>
            </div>
            <div class="importar-recuento" data-recuento="${f.id}" aria-live="polite" hidden></div>
            <div class="importar-error" data-error="${f.id}" role="status" hidden></div>
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
    for (const f of FUENTES_PGN) {
      $(`[data-cambiar="${f.id}"]`).innerHTML = contenidoBoton('carpeta', 'Cambiar');
      $(`[data-permitir="${f.id}"]`).innerHTML = contenidoBoton('visto', 'Permitir');
    }
    $('[data-importar]').innerHTML = contenidoBoton('descargar', 'Importar');
    $('[data-cerrar]').innerHTML = contenidoBoton('equis', 'Cerrar');

    const cerrar = () => {
      if (ocupado || cerrado) return;
      cerrado = true;
      control.abort();
      document.removeEventListener('keydown', teclas, true);
      velo.classList.add('saliendo');
      setTimeout(() => { velo.remove(); previo?.focus?.(); }, 160);
      resolver(resultado);
    };
    const teclas = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); } };

    const pintarLista = () => {
      for (const f of FUENTES_PGN) {
        const estado = carpetas[f.id];
        const propias = lecturas.filter(l => l.tarjeta === f.id);
        const lista = $(`[data-lista="${f.id}"]`), recuento = $(`[data-recuento="${f.id}"]`);
        $(`[data-carpeta="${f.id}"]`).textContent = estado.carpeta ? `Carpeta seleccionada: ${estado.carpeta.name}` : 'Carpeta seleccionada: ninguna';
        if (!propias.length) {
          lista.className = 'suave';
          lista.textContent = estado.buscando ? 'Buscando PGN del jugador…' : estado.pendiente ? 'Pulsa «Permitir» para buscar en esta carpeta.'
            : estado.error ? 'No se pudo completar la búsqueda.' : estado.carpeta ? 'No existen PGN de este jugador' : 'Selecciona una carpeta con «Cambiar».';
        }
        else {
          lista.className = '';
          lista.innerHTML = propias.map(l => `<div class="importar-archivo ${l.suyas ? '' : 'sin-suyas'}">
            <span class="recortar" title="${esc(l.archivo.name)}">${esc(l.archivo.name)}</span>
            <span class="suave">${l.suyas} suyas de ${l.total} · ${tam(l.archivo.size)}</span></div>`).join('');
          if (propias.some(l => l.sinOrigen)) lista.insertAdjacentHTML('beforeend', '<div class="suave importar-origen">Origen sin identificar: se importará como PGN.</div>');
        }
        const n = propias.reduce((s, l) => s + l.suyas, 0);
        recuento.hidden = !propias.length;
        recuento.textContent = n === 1 ? '1 partida del jugador cargada' : `${n} partidas del jugador cargadas`;
        $(`[data-cambiar="${f.id}"]`).disabled = ocupado || leyendo();
        const permiso = $(`[data-permitir="${f.id}"]`);
        permiso.hidden = !estado.pendiente;
        permiso.disabled = ocupado || leyendo();
        const error = $(`[data-error="${f.id}"]`);
        error.hidden = !estado.error && !estado.errores.length;
        error.textContent = estado.error || (estado.errores.length ? `No se pudieron leer ${estado.errores.length} archivos. Los demás se han revisado.` : '');
      }
      $('[data-cerrar]').disabled = ocupado;
      $('[data-importar]').disabled = ocupado || leyendo() || !(lecturas.some(l => l.suyas > 0) || mega.estado.base || mega.estado.pendiente);
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

    const revisarCarpetas = async () => {
      if (cerrado) return;
      iniciando = true;
      lecturas = [];
      for (const estado of Object.values(carpetas).filter(c => c.carpeta)) {
        estado.buscando = true; estado.pendiente = false; estado.error = ''; estado.errores = [];
      }
      pintarLista();
      try {
        const grupos = await agruparCarpetasPgn(FUENTES_PGN.filter(f => carpetas[f.id].carpeta).map(f => ({ id: f.id, carpeta: carpetas[f.id].carpeta })));
        if (cerrado) return;
        await Promise.all(grupos.map(async grupo => {
          try {
            const encontrados = await buscarPgnEnCarpeta(grupo.carpeta, jugador, { señal: control.signal });
            if (cerrado) return;
            for (const id of grupo.fuentes) {
              carpetas[id].pendiente = encontrados.pendiente;
              carpetas[id].errores = encontrados.errores;
            }
            lecturas.push(...repartirPgn(encontrados.lecturas, grupo.fuentes, jugador));
          } catch (e) {
            if (e.name !== 'AbortError') for (const id of grupo.fuentes) carpetas[id].error = 'No se pudo leer la carpeta. Selecciónala de nuevo con «Cambiar».';
          }
        }));
      } catch {
        for (const estado of Object.values(carpetas).filter(c => c.carpeta)) estado.error = 'No se pudo leer la carpeta. Selecciónala de nuevo con «Cambiar».';
      } finally {
        iniciando = false;
        for (const estado of Object.values(carpetas)) estado.buscando = false;
        if (!cerrado) pintarLista();
      }
    };

    for (const f of FUENTES_PGN) {
      $(`[data-cambiar="${f.id}"]`).addEventListener('click', async () => {
        const estado = carpetas[f.id];
        if (ocupado || leyendo()) return;
        estado.buscando = true; estado.error = ''; pintarLista();
        try {
          const carpeta = await elegirCarpetaPgn(f.id, estado.carpeta);
          if (!carpeta || cerrado) return;
          estado.carpeta = carpeta;
          await revisarCarpetas();
        } catch (e) { estado.error = e.message; }
        finally { estado.buscando = false; if (!cerrado) pintarLista(); }
      });
      $(`[data-permitir="${f.id}"]`).addEventListener('click', async () => {
        const estado = carpetas[f.id];
        if (ocupado || leyendo()) return;
        estado.buscando = true; pintarLista();
        try { if (await permitirCarpetaPgn(estado.carpeta) && !cerrado) await revisarCarpetas(); }
        catch { estado.error = 'No se pudo autorizar la carpeta. Selecciónala de nuevo con «Cambiar».'; }
        finally { estado.buscando = false; if (!cerrado) pintarLista(); }
      });
    }
    $('[data-cerrar]').addEventListener('click', cerrar);
    velo.addEventListener('mousedown', (e) => { if (e.target === velo) cerrar(); });

    $('[data-importar]').addEventListener('click', async () => {
      if (ocupado || leyendo()) return;
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
        cerrado = true;
        control.abort();
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
    $('[data-cerrar]').focus();
    // Al abrir se revisan las carpetas recordadas sin mostrar selectores ni pedir permisos automáticamente.
    Promise.all(FUENTES_PGN.map(async f => {
      try { carpetas[f.id].carpeta = await leerCarpetaPgn(f.id); }
      catch { carpetas[f.id].error = 'No se pudo recuperar la carpeta guardada. Pulsa «Cambiar».'; }
    })).then(async () => {
      iniciando = false;
      if (cerrado) return;
      await revisarCarpetas();
      if (!cerrado) pintarLista();
    });
  });
}
