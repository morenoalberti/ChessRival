// Cuadro «Importar partidas»: revisar las carpetas PGN recordadas y traer las partidas del jugador.
import { LOCALE } from './i18n.js';
import { contenidoBoton } from './iconos.js';
import { informar } from './dialogos.js';
import { mostrarCargando, quitarCargando } from './cargando.js';
import { leerArchivo, importar, mensaje } from './importador.js';
import { leerCarpetaPgn, elegirCarpetaPgn, permitirCarpetaPgn, buscarPgnEnCarpeta, agruparCarpetasPgn, repartirPgn } from './importar-carpetas.js';
import * as mega from './mega.js';
import { nombreConTitulo } from './nombre-jugador.js';
import { buscarTwic } from './twic.js';
import { buscarLumbra } from './lumbra.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tam = (b) => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
const FUENTES_PGN = [
  { id: 'yotta', nombre: 'YottaChess' },
  { id: 'ahora', nombre: 'AhoraAjedrez' }
];

/** Devuelve el resultado de la importación, o null si se cierra sin importar. */
export function abrirImportar(jugador) {
  return new Promise((resolver) => {
    const previo = document.activeElement;
    let lecturas = [], ocupado = false, cerrado = false, iniciando = true, leyendoPgn = false, resultado = null;
    let megaBuscando = false, megaResultado = null, megaError = '', megaProgreso = '';
    let twicBuscando = false, twicResultado = null, twicError = '';
    let lumbraBuscando = false, lumbraResultado = null, lumbraError = '';
    const control = new AbortController();
    const carpetas = Object.fromEntries(FUENTES_PGN.map(f => [f.id, { carpeta: null, buscando: false, pendiente: false, error: '', errores: [] }]));
    const leyendo = () => iniciando || leyendoPgn || Object.values(carpetas).some(c => c.buscando);

    const velo = document.createElement('div');
    velo.className = 'velo';
    velo.innerHTML = `
      <div class="dialogo dialogo-importar" role="dialog" aria-modal="true" aria-label="Importar partidas">
        <div class="dialogo-cab"><img src="assets/icon.png" alt=""><span>Importar partidas · ${esc(nombreConTitulo(jugador))}</span></div>
        <div class="importar-cuerpo">
          <p class="importar-intro">Se buscan sus partidas en las carpetas elegidas, la MegaDatabase conectada y TWIC. También puedes elegir archivos PGN. Pulsa «Importar» para guardarlas.</p>

          <div class="importar-caja">
            <div class="importar-fila">
              <div class="importar-texto"><b>Archivos PGN</b><span class="suave">Elige uno o varios archivos PGN de tu ordenador.</span></div>
              <button type="button" class="btn btn-secundario btn-chico" data-elegir-pgn></button>
            </div>
            <div class="importar-zona"><span data-lista="pgn" class="suave">Ningún archivo todavía</span></div>
            <div class="importar-recuento" data-recuento="pgn" aria-live="polite" hidden></div>
            <div class="importar-error" data-error-pgn role="status" hidden></div>
            <input type="file" accept=".pgn" multiple hidden data-entrada-pgn>
          </div>

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
              <button type="button" class="btn btn-secundario btn-chico" data-mega-reintentar hidden></button>
            </div>
            <div class="importar-recuento" data-mega-recuento aria-live="polite" hidden></div>
          </div>

          <div class="importar-caja" data-fuente="lumbra">
            <div class="importar-fila">
              <div class="importar-texto"><b>Lumbra’s Gigabase · último año</b><span class="suave">Partidas OTB recientes · prueba privada</span></div>
              <button type="button" class="btn btn-secundario btn-chico" data-lumbra-reintentar hidden></button>
            </div>
            <div class="importar-zona suave" data-lumbra-estado role="status">Buscando partidas en Lumbra’s Gigabase…</div>
            <div class="importar-recuento" data-lumbra-recuento aria-live="polite" hidden></div>
            <div class="importar-nota suave" data-lumbra-version hidden></div>
          </div>

          <div class="importar-caja" data-fuente="twic">
            <div class="importar-fila">
              <div class="importar-texto"><b>TWIC · Último año</b><span class="suave">Entregas semanales de los últimos 12 meses.</span></div>
              <button type="button" class="btn btn-secundario btn-chico" data-twic-reintentar hidden></button>
            </div>
            <div class="importar-zona suave" data-twic-estado role="status">Buscando partidas en TWIC…</div>
            <div class="importar-recuento" data-twic-recuento aria-live="polite" hidden></div>
            <div class="importar-nota suave" data-twic-fecha hidden></div>
          </div>

          <p class="importar-nota suave">Al importar, las partidas repetidas entre PGN, MegaDatabase, TWIC y Lumbra se guardan una sola vez.</p>
          <p class="importar-progreso" data-progreso hidden></p>
          <div class="importar-botones">
            <button type="button" class="btn btn-primario" data-importar disabled></button>
            <button type="button" class="btn btn-secundario" data-cerrar></button>
          </div>
        </div>
      </div>`;

    const $ = (s) => velo.querySelector(s);
    const pintarCargando = () => {
      const panel = $('.dialogo-importar');
      const activo = !cerrado && (ocupado || leyendo() || megaBuscando || twicBuscando || lumbraBuscando);
      panel.setAttribute('aria-busy', String(activo));
      if (!activo) { quitarCargando(panel); return; }
      const texto = ocupado ? ($('[data-progreso]').textContent || 'Importando…')
        : megaBuscando ? (megaProgreso || 'Buscando partidas en la MegaDatabase…')
        : twicBuscando ? 'Buscando partidas en TWIC…'
        : lumbraBuscando ? 'Buscando partidas en Lumbra’s Gigabase…'
        : leyendoPgn || iniciando ? 'Leyendo archivos…' : 'Buscando PGN del jugador…';
      mostrarCargando(panel, texto);
    };
    const ponerProgreso = texto => { $('[data-progreso]').textContent = texto; pintarCargando(); };
    $('[data-elegir-pgn]').innerHTML = contenidoBoton('carpeta', 'Elegir archivos');
    $('[data-mega-reintentar]').innerHTML = contenidoBoton('reiniciar', 'Reintentar');
    $('[data-twic-reintentar]').innerHTML = contenidoBoton('reiniciar', 'Reintentar');
    $('[data-lumbra-reintentar]').innerHTML = contenidoBoton('reiniciar', 'Reintentar');
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

    const pintarArchivos = (id, vacio) => {
      const propias = lecturas.filter(l => l.tarjeta === id);
      const lista = $(`[data-lista="${id}"]`), recuento = $(`[data-recuento="${id}"]`);
      if (!propias.length) { lista.className = 'suave'; lista.textContent = vacio; }
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
    };

    const pintarLista = () => {
      pintarArchivos('pgn', leyendoPgn ? 'Leyendo archivos…' : 'Ningún archivo todavía');
      $('[data-elegir-pgn]').disabled = ocupado || leyendo();
      for (const f of FUENTES_PGN) {
        const estado = carpetas[f.id];
        $(`[data-carpeta="${f.id}"]`).textContent = estado.carpeta ? `Carpeta seleccionada: ${estado.carpeta.name}` : 'Carpeta seleccionada: ninguna';
        pintarArchivos(f.id, estado.buscando ? 'Buscando PGN del jugador…' : estado.pendiente ? 'Pulsa «Permitir» para buscar en esta carpeta.'
          : estado.error ? 'No se pudo completar la búsqueda.' : estado.carpeta ? 'No existen PGN de este jugador' : 'Selecciona una carpeta con «Cambiar».');
        $(`[data-cambiar="${f.id}"]`).disabled = ocupado || leyendo();
        const permiso = $(`[data-permitir="${f.id}"]`);
        permiso.hidden = !estado.pendiente;
        permiso.disabled = ocupado || leyendo();
        const error = $(`[data-error="${f.id}"]`);
        error.hidden = !estado.error && !estado.errores.length;
        error.textContent = estado.error || (estado.errores.length ? `No se pudieron leer ${estado.errores.length} archivos. Los demás se han revisado.` : '');
      }
      $('[data-cerrar]').disabled = ocupado;
      $('[data-mega-permiso]').disabled = ocupado || megaBuscando;
      $('[data-mega-reintentar]').disabled = ocupado || megaBuscando;
      $('[data-twic-reintentar]').disabled = ocupado || twicBuscando;
      $('[data-lumbra-reintentar]').disabled = ocupado || lumbraBuscando;
      $('[data-importar]').disabled = ocupado || leyendo() || megaBuscando || twicBuscando || lumbraBuscando || !(lecturas.some(l => l.suyas > 0) || megaResultado?.partidas.length);
      pintarCargando();
    };

    const pintarTwic = () => {
      const t = $('[data-twic-estado]'), r = twicResultado;
      t.classList.toggle('importar-error', Boolean(twicError));
      t.textContent = twicBuscando ? 'Buscando partidas en TWIC…' : twicError ? `No se pudo consultar TWIC: ${twicError}`
        : !r || r.estado === 'sin_configurar' ? 'TWIC está pendiente de activar en el servidor.'
        : r.estado === 'preparando' ? 'Se está preparando el histórico de TWIC. Puedes importar de las otras fuentes.'
        : r.partidas.length ? 'Partidas del jugador preparadas para importar.'
        : r.estado === 'parcial' ? 'Sin partidas del jugador en las entregas revisadas. El histórico aún está incompleto.'
        : 'No se encontraron partidas de este jugador en TWIC durante este periodo.';
      const recuento = $('[data-twic-recuento]');
      recuento.hidden = !r?.revisadas || twicBuscando;
      recuento.textContent = r ? `${r.partidas.length.toLocaleString(LOCALE)} partidas del jugador · ${r.revisadas} de ${r.entregas} entregas revisadas`
        + (r.limitada ? ' · Se muestran las primeras 2.000 partidas.' : '') : '';
      const fecha = $('[data-twic-fecha]');
      fecha.hidden = !r?.ultimaEntrega || twicBuscando;
      const formato = d => new Date(`${d}T12:00:00Z`).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
      fecha.textContent = r?.ultimaEntrega ? `Última entrega: ${formato(r.ultimaEntrega)} · Desde ${formato(r.desde)}`
        + (r.estado === 'parcial' ? ' · Histórico en preparación.' : '') + (r.errores ? ' · Hay entregas pendientes de reintentar.' : '') : '';
      if (r?.desactualizada && !twicBuscando) {
        fecha.hidden = false;
        fecha.textContent += (fecha.textContent ? ' · ' : '') + 'La actualización de TWIC está pendiente de comprobar.';
      }
      $('[data-twic-reintentar]').hidden = twicBuscando || (!twicError && r?.estado !== 'parcial' && r?.estado !== 'preparando');
      pintarLista();
    };

    const buscarEnTwic = async () => {
      if (cerrado || ocupado || twicBuscando) return;
      twicBuscando = true; twicError = ''; pintarTwic();
      try {
        const r = await buscarTwic(jugador, () => {}, control.signal);
        if (cerrado) return;
        twicResultado = r;
        lecturas = lecturas.filter(l => l.tarjeta !== 'twic');
        if (r.partidas.length) lecturas.push({ tarjeta: 'twic', fuente: 'TWIC', archivo: { name: 'TWIC.pgn' }, partidas: r.partidas, suyas: r.partidas.length, total: r.partidas.length });
      } catch (e) { if (e.name !== 'AbortError') twicError = e.message; }
      finally { twicBuscando = false; if (!cerrado) pintarTwic(); }
    };

    const pintarLumbra = () => {
      const estado = $('[data-lumbra-estado]'), r = lumbraResultado;
      estado.classList.toggle('importar-error', Boolean(lumbraError));
      estado.textContent = lumbraBuscando ? 'Buscando partidas en Lumbra’s Gigabase…' : lumbraError ? `No se pudo consultar Lumbra’s Gigabase: ${lumbraError}`
        : !r || r.estado === 'sin_configurar' ? 'Lumbra’s Gigabase está pendiente de preparar en este equipo.'
        : r.estado === 'preparando' ? 'Se está preparando el índice local de Lumbra. Puedes importar de las otras fuentes.'
        : r.partidas.length ? 'Partidas del jugador preparadas para importar.'
        : 'No se encontraron partidas de este jugador en Lumbra’s Gigabase durante este periodo.';
      const recuento = $('[data-lumbra-recuento]');
      recuento.hidden = !r?.juegosIndexados || lumbraBuscando;
      recuento.textContent = r ? `${r.partidas.length.toLocaleString(LOCALE)} partidas del jugador · ${r.juegosIndexados.toLocaleString(LOCALE)} partidas indexadas`
        + (r.limitada ? ' · Se muestran las primeras 2.000 partidas.' : '') : '';
      const version = $('[data-lumbra-version]');
      version.hidden = !r?.version || lumbraBuscando;
      const fecha = value => value ? new Date(`${value}T12:00:00Z`).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
      version.textContent = r?.version ? `Última partida: ${fecha(r.ultimaPartida)} · Versión de Lumbra: ${r.version} · Desde ${fecha(r.desde)}` : '';
      $('[data-lumbra-reintentar]').hidden = lumbraBuscando || (!lumbraError && r?.estado !== 'preparando');
      pintarLista();
    };

    const buscarEnLumbra = async () => {
      if (cerrado || ocupado || lumbraBuscando) return;
      lumbraBuscando = true; lumbraError = ''; pintarLumbra();
      try {
        const r = await buscarLumbra(jugador, () => {}, control.signal);
        if (cerrado) return;
        lumbraResultado = r;
        lecturas = lecturas.filter(l => l.tarjeta !== 'lumbra');
        if (r.partidas.length) lecturas.push({ tarjeta: 'lumbra', fuente: 'Lumbra’s Gigabase', archivo: { name: 'Lumbra-Gigabase.pgn' }, partidas: r.partidas, suyas: r.partidas.length, total: r.partidas.length });
      } catch (e) { if (e.name !== 'AbortError') lumbraError = e.message; }
      finally { lumbraBuscando = false; if (!cerrado) pintarLumbra(); }
    };

    // Estado de la MegaDatabase: conectada, a la espera del permiso del navegador o sin elegir.
    const pintarMega = () => {
      const e = mega.estado, t = $('[data-mega-estado]'), b = $('[data-mega-permiso]');
      b.hidden = !e.pendiente;
      b.disabled = ocupado || megaBuscando;
      $('[data-mega-reintentar]').hidden = !megaError || !e.base;
      $('[data-mega-reintentar]').disabled = ocupado || megaBuscando;
      if (e.base) t.textContent = `${e.base.nombre} · ${e.base.totalPartidas.toLocaleString(LOCALE)} partidas. Se buscan por nombre y ELO (ChessBase no guarda el ID FIDE); tarda unos segundos.`;
      else if (e.pendiente) t.textContent = `${e.nombre || 'La MegaDatabase'} está elegida, pero el navegador pide confirmar el acceso a sus archivos.`;
      else if (e.error) t.textContent = `No disponible: ${e.error}`;
      else t.textContent = 'Todavía no has elegido tu MegaDatabase. Hazlo con el botón «Elegir» del aviso de MegaDatabase de la pantalla principal.';
      const recuento = $('[data-mega-recuento]');
      recuento.hidden = !megaBuscando && !megaResultado && !megaError;
      const encontradas = megaResultado?.candidatas === 1 ? '1 partida encontrada' : `${megaResultado?.candidatas.toLocaleString(LOCALE)} partidas encontradas`;
      const preparadas = megaResultado?.partidas.length === 1 ? '1 preparada para importar' : `${megaResultado?.partidas.length.toLocaleString(LOCALE)} preparadas para importar`;
      recuento.textContent = megaError ? `No se pudo buscar en la MegaDatabase: ${megaError}` : megaBuscando ? (megaProgreso || 'Buscando partidas en la MegaDatabase…')
        : megaResultado?.candidatas ? `${encontradas} · ${preparadas}`
        : 'No se encontraron partidas de este jugador en la MegaDatabase.';
      pintarLista();
    };

    const buscarMega = async () => {
      if (cerrado || ocupado || megaBuscando || !mega.estado.base) return;
      megaBuscando = true; megaResultado = null; megaError = ''; megaProgreso = '';
      pintarMega();
      try {
        const r = await mega.buscar(jugador, texto => { if (!cerrado) { megaProgreso = texto; pintarMega(); } }, control.signal);
        if (!cerrado) megaResultado = r;
      } catch (e) { if (e.name !== 'AbortError') megaError = e.message; }
      finally { megaBuscando = false; if (!cerrado) pintarMega(); }
    };

    $('[data-elegir-pgn]').addEventListener('click', () => { if (!ocupado && !leyendo()) $('[data-entrada-pgn]').click(); });
    $('[data-entrada-pgn]').addEventListener('change', async e => {
      const archivos = [...e.target.files];
      e.target.value = '';
      if (cerrado || ocupado || leyendo() || !archivos.length) return;
      leyendoPgn = true;
      lecturas = lecturas.filter(l => l.tarjeta !== 'pgn');
      const error = $('[data-error-pgn]'), errores = [];
      error.hidden = true;
      pintarLista();
      try {
        for (const archivo of archivos) {
          try {
            const lectura = await leerArchivo(archivo, jugador);
            if (cerrado) return;
            lecturas.push({ ...lectura, tarjeta: 'pgn', fuente: 'PGN' });
          } catch { errores.push(archivo.name); }
          if (cerrado) return;
        }
        error.textContent = errores.length ? `No se pudo leer el archivo: ${errores.join(', ')}`
          : !lecturas.some(l => l.tarjeta === 'pgn' && l.suyas > 0) ? 'Ninguno de los archivos tiene partidas de este jugador. Comprueba que su nombre aparece igual en las cabeceras White y Black.' : '';
        error.hidden = !error.textContent;
      } finally { leyendoPgn = false; if (!cerrado) pintarLista(); }
    });

    const revisarCarpetas = async () => {
      if (cerrado) return;
      iniciando = true;
      lecturas = lecturas.filter(l => ['pgn', 'twic', 'lumbra'].includes(l.tarjeta));
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
      if (ocupado || leyendo() || megaBuscando || twicBuscando || lumbraBuscando) return;
      ocupado = true;
      pintarLista();
      const progreso = $('[data-progreso]');
      progreso.hidden = false;
      ponerProgreso('Importando…');
      const pulseDone=window.pulseOperation?.('importar_partidas')||(()=>{});
      let pulseFailed=false;
      try {
        pintarMega();

        let textoMega = null, textoPgn = null, textoTwic = null, textoLumbra = null;
        const aImportar = lecturas.filter(l => l.suyas > 0 && !['twic', 'lumbra'].includes(l.tarjeta));
        if (aImportar.length) {
          ponerProgreso('Importando de los archivos PGN…');
          const r = await importar(jugador, aImportar, 'PGN', ponerProgreso);
          textoPgn = mensaje(nombreConTitulo(jugador), r);
          resultado = { ...(resultado ?? {}), pgn: r };
        }
        const deTwic = lecturas.filter(l => l.tarjeta === 'twic' && l.suyas > 0);
        if (deTwic.length) {
          ponerProgreso('Importando de TWIC…');
          const r = await importar(jugador, deTwic, 'TWIC', ponerProgreso);
          textoTwic = mensaje(nombreConTitulo(jugador), r);
          resultado = { ...(resultado ?? {}), twic: r };
        }
        const deLumbra = lecturas.filter(l => l.tarjeta === 'lumbra' && l.suyas > 0);
        if (deLumbra.length) {
          ponerProgreso('Importando de Lumbra’s Gigabase…');
          const r = await importar(jugador, deLumbra, 'Lumbra’s Gigabase', ponerProgreso);
          textoLumbra = mensaje(nombreConTitulo(jugador), r);
          resultado = { ...(resultado ?? {}), lumbra: r };
        }
        if (megaResultado) {
          try {
            ponerProgreso('Importando de la MegaDatabase…');
            const m = await mega.importarEncontradas(jugador, megaResultado);
            const ya = m.yaEstaban > 0 ? ` y ${m.yaEstaban} que ${m.yaEstaban === 1 ? 'ya estaba guardada' : 'ya estaban guardadas'}` : '';
            textoMega = m.candidatas === 0 ? 'no hay partidas suyas en la base.'
              : m.candidatas > mega.MAX_POR_JUGADOR
                ? `se cogen las ${mega.MAX_POR_JUGADOR} más recientes de las ${m.candidatas.toLocaleString(LOCALE)} que coinciden con su nombre y ELO: ${m.nuevas} nuevas${ya}.`
                : `${m.nuevas} nuevas de las ${m.candidatas} partidas que coinciden con su nombre y ELO${m.yaEstaban ? ` (${m.yaEstaban} ya ${m.yaEstaban === 1 ? 'estaba guardada' : 'estaban guardadas'})` : ''}.`;
            if (m.noLegibles) textoMega += ` ${m.noLegibles} no se han podido leer.`;
            resultado = { ...(resultado ?? {}), mega: m };
          } catch (ex) { pulseFailed=true; textoMega = `no se pudo leer (${ex.message}).`; }
        }
        ocupado = false;
        cerrado = true;
        control.abort();
        document.removeEventListener('keydown', teclas, true);
        velo.remove();
        const partes = [];
        if (textoMega !== null) partes.push(`•  MegaDatabase: ${textoMega}`);
        if (textoPgn !== null) partes.push(`•  Archivos PGN: ${textoPgn}`);
        if (textoTwic !== null) partes.push(`•  TWIC: ${textoTwic}`);
        if (textoLumbra !== null) partes.push(`•  Lumbra’s Gigabase: ${textoLumbra}`);
        const processed=Object.values(resultado||{}).reduce((total,result)=>total+(result.nuevas||0)+(result.repetidas||0)+(result.yaEstaban||0),0);
        pulseDone(processed>0?'ok':pulseFailed?'error':'sin_resultados');
        await informar('Importación terminada', `Partidas importadas de ${nombreConTitulo(jugador)}:\n\n${partes.join('\n\n') || 'No había nada que importar.'}`);
        resolver(resultado);
      } catch (ex) {
        ocupado = false;
        pulseDone('error');
        ponerProgreso(`No se pudo importar: ${ex.message}`);
        pintarLista();
      }
    });

    $('[data-mega-permiso]').innerHTML = contenidoBoton('visto', 'Permitir');
    $('[data-mega-permiso]').addEventListener('click', async () => {
      if (cerrado || ocupado || megaBuscando) return;
      megaBuscando = true; megaError = '';
      pintarMega();
      try {
        if (!await mega.pedirPermiso()) megaError = 'No se ha dado permiso para leer la MegaDatabase.';
      } catch (e) { megaError = e.message; }
      finally { megaBuscando = false; }
      if (!cerrado) { pintarMega(); await buscarMega(); }
    });
    $('[data-mega-reintentar]').addEventListener('click', buscarMega);
    $('[data-twic-reintentar]').addEventListener('click', buscarEnTwic);
    $('[data-lumbra-reintentar]').addEventListener('click', buscarEnLumbra);
    document.addEventListener('keydown', teclas, true);
    document.body.appendChild(velo);
    pintarMega();
    buscarMega();
    buscarEnTwic();
    buscarEnLumbra();
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
