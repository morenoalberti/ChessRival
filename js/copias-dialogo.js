import { LOCALE, decimal } from './i18n.js';
import * as copias from './copias.js';
import { abrirPanel } from './panel-utilidad.js';
import { preguntar } from './dialogos.js';
import { contenidoBoton, svg } from './iconos.js';
import { leerDestinoCopias, nombreDestinoCopias, elegirDestinoCopias, autorizarDestinoCopias, guardarArchivoCopia } from './copias-destino.js';

const fecha = f => new Date(f).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'short' });
const tamano = b => b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${decimal(b / 1048576)} MB`;
const tipo = t => ({ manual: 'Manual', automatica: 'Automática', 'antes-restaurar': 'Antes de restaurar' }[t]);
function cifras(r) {
  return `${r.jugadores} jugadores · ${r.partidas} partidas · ${r.analisis} análisis · ${r.ediciones} partidas editadas`;
}

export async function abrirCopias() {
  const panel = abrirPanel('Copias de seguridad', `
    <p class="utilidad-intro suave">Protege tus jugadores, torneos, partidas, análisis y anotaciones.</p>
    <div class="copias-resumen" data-resumen aria-label="Datos actuales">Consultando tus datos…</div>
    <div class="copias-acciones">
      <section class="utilidad-tarjeta"><h2>Crear una copia</h2>
        <button type="button" class="btn btn-primario" data-crear title="Guardar copia en un archivo">${contenidoBoton('guardar', 'Crear y descargar')}</button>
        <p class="suave copias-nota" data-destino-crear>Destino: Descargas del navegador.</p></section>
      <section class="utilidad-tarjeta"><h2>Restaurar una copia</h2>
        <label class="copias-archivo-etiqueta" for="archivoCopia">Archivo de copia</label>
        <div class="copias-archivo-caja"><input id="archivoCopia" type="text" data-nombre-archivo readonly placeholder="Pulsa para elegir una copia" title="Elegir copia guardada">
          <button type="button" class="btn btn-secundario btn-chico" data-destino title="Carpeta de destino" aria-label="Elegir carpeta de destino">${svg('carpeta', 17)}</button></div>
        <p class="suave copias-destino" data-destino role="status">Carpeta: Descargas del navegador</p>
        <button type="button" class="btn btn-secundario" data-restaurar title="Restaurar copia seleccionada" disabled>${contenidoBoton('cambiar', 'Restaurar copia')}</button>
        <p class="suave copias-nota">Se guarda una copia de los datos actuales antes de sustituirlos.</p>
        <input type="file" accept=".json,application/json" data-archivo hidden></section>
    </div>
    <section class="utilidad-tarjeta copias-previa" data-previa hidden><h2>Revisar la copia</h2><p data-detalle></p><p class="suave" data-cifras></p>
      <span class="copias-verificada" title="Archivo válido">${svg('visto')} Archivo comprobado</span></section>
    <section class="utilidad-tarjeta copias-auto"><div><h2>Copias automáticas</h2><p class="suave">Cada 5 minutos si hay cambios. Se conservan las 15 últimas.</p></div>
      <label class="copias-switch" title="Guardar copias cada 5 minutos"><input type="checkbox" role="switch" data-automaticas aria-label="Copias automáticas"><span class="copias-pista" aria-hidden="true"></span><span data-auto-estado>Desactivadas</span></label></section>
    <p class="copias-estado" data-estado role="status" aria-live="polite"></p>
    <section class="utilidad-tarjeta"><div class="copias-fila"><h2>Copias recientes</h2><button class="btn btn-secundario btn-chico" data-actualizar type="button" title="Actualizar lista">${contenidoBoton('cambiar', 'Actualizar')}</button></div>
      <div class="copias-lista" data-lista></div></section>`, 'panel-copias');
  if (!panel) return;
  const $ = s => panel.velo.querySelector(s);
  let elegido = null, idElegida = null, ocupado = false, enfocarArchivo = false, carpetaDestino = null;
  const estado = (texto, error = false) => { $('[data-estado]').textContent = texto; $('[data-estado]').classList.toggle('error', error); };
  function pintarDestino() {
    const nombre = nombreDestinoCopias(carpetaDestino);
    $('p[data-destino]').textContent = `Carpeta: ${nombre}`;
    $('p[data-destino]').title = nombre;
    $('[data-destino-crear]').textContent = `Carpeta: ${nombre}`;
    $('[data-crear]').innerHTML = contenidoBoton('guardar', carpetaDestino ? 'Crear y guardar' : 'Crear y descargar');
  }
  async function cargar() {
    const [datos, lista, auto, error, destino] = await Promise.all([copias.datosActuales(), copias.listarCopias(), copias.opcionCopias('automaticas', false), copias.opcionCopias('error_automatica', ''), leerDestinoCopias()]);
    carpetaDestino = destino; pintarDestino();
    const r = copias.resumenCopia(datos);
    $('[data-resumen]').replaceChildren();
    for (const [clave, titulo] of [['jugadores', 'Jugadores'], ['torneos', 'Torneos'], ['partidas', 'Partidas'], ['analisis', 'Análisis']]) {
      const item = document.createElement('div'), numero = document.createElement('b'), etiqueta = document.createElement('span');
      item.title = { jugadores: 'Jugadores únicos', torneos: 'Torneos guardados', partidas: 'Partidas guardadas', analisis: 'Análisis guardados' }[clave];
      numero.textContent = r[clave].toLocaleString(LOCALE); etiqueta.textContent = titulo; item.append(numero, etiqueta); $('[data-resumen]').append(item);
    }
    $('[data-automaticas]').checked = auto;
    $('[data-auto-estado]').textContent = auto ? 'Activadas' : 'Desactivadas';
    if (error) estado(`No se pudo guardar la última copia automática: ${error}`, true);
    $('[data-lista]').replaceChildren();
    if (!lista.length) $('[data-lista]').textContent = 'Todavía no hay copias. Crea la primera para proteger tus datos.';
    for (const c of lista) {
      const fila = document.createElement('div'); fila.className = 'copias-item';
      fila.innerHTML = `<div class="copias-item-datos"><div data-nombre></div><small class="suave" data-meta></small></div>
        <span class="copias-verificada" title="Copia verificada">${svg('visto')} Comprobada</span>
        <button class="btn btn-secundario btn-chico" type="button" data-ver title="Seleccionar para restaurar" aria-label="Seleccionar copia">${svg('subir', 17)}</button>
        <button class="btn btn-secundario btn-chico btn-copia-borrar" type="button" data-borrar title="Borrar copia" aria-label="Borrar copia">${svg('papelera', 17)}</button>`;
      fila.querySelector('[data-nombre]').textContent = `${fecha(c.fecha)} · ${tipo(c.tipo)}`;
      fila.querySelector('[data-meta]').textContent = `${tamano(c.bytes)} · ${c.resumen.partidas} partidas · ${c.resumen.jugadores} jugadores`;
      fila.querySelector('[data-ver]').addEventListener('click', () => ejecutar(() => revisar(c.paquete, copias.nombreCopia(c), c.id)));
      fila.querySelector('[data-borrar]').addEventListener('click', () => ejecutar(async () => {
        if (!await preguntar('Borrar copia', `¿Borrar del historial la copia del ${fecha(c.fecha)} (${tipo(c.tipo)})? No se puede deshacer.`, { textoSi: 'Borrar', peligro: true })) return;
        await copias.borrarCopia(c.id);
        if (idElegida === c.id) limpiarSeleccion();
        await cargar();
        estado('Copia borrada del historial.');
      }));
      $('[data-lista]').append(fila);
    }
  }
  async function ejecutar(fn) {
    if (ocupado) return;
    const foco = document.activeElement;
    ocupado = true; panel.ocupado(true);
    const botones = [...panel.velo.querySelectorAll('button, input')]; botones.forEach(b => { b.disabled = true; });
    try { await fn(); } catch (e) { estado(e.message, true); }
    finally {
      ocupado = false; panel.ocupado(false); botones.forEach(b => { b.disabled = false; });
      $('[data-restaurar]').disabled = !elegido;
      if (panel.velo.isConnected) {
        const destino = enfocarArchivo ? $('[data-nombre-archivo]') : foco?.isConnected && panel.velo.contains(foco) ? foco : $('[data-cerrar-panel]');
        destino?.focus();
        if (enfocarArchivo) destino?.setSelectionRange(0, 0);
      }
      enfocarArchivo = false;
    }
  }
  function limpiarSeleccion() {
    elegido = null; idElegida = null; $('[data-previa]').hidden = true;
    $('[data-nombre-archivo]').value = '';
    $('[data-nombre-archivo]').title = 'Elegir copia guardada';
    $('[data-restaurar]').disabled = true;
  }
  async function revisar(paquete, nombre, id = null) {
    limpiarSeleccion();
    const c = await copias.validarCopia(paquete);
    elegido = paquete;
    idElegida = id;
    $('[data-nombre-archivo]').value = nombre;
    $('[data-nombre-archivo]').title = nombre;
    $('[data-detalle]').textContent = `${fecha(c.fecha)} · ${tipo(c.tipo)}`;
    $('[data-cifras]').textContent = cifras(c.resumen);
    $('[data-previa]').hidden = false;
    enfocarArchivo = true;
    $('[data-nombre-archivo]').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    estado('Copia seleccionada. Pulsa «Restaurar copia» para continuar.');
  }
  $('[data-crear]').addEventListener('click', () => ejecutar(async () => {
    await autorizarDestinoCopias(carpetaDestino);
    estado('Creando la copia…');
    const fila = await copias.crearCopia();
    try { await guardarArchivoCopia(fila, carpetaDestino); }
    catch (e) { await cargar(); throw new Error(`La copia está en el historial, pero no se pudo guardar el archivo: ${e.message}`); }
    await cargar(); estado(carpetaDestino ? `Copia creada y guardada en «${nombreDestinoCopias(carpetaDestino)}».` : 'Copia creada y enviada a las descargas del navegador.');
  }));
  $('[data-actualizar]').addEventListener('click', () => ejecutar(cargar));
  $('button[data-destino]').addEventListener('click', () => ejecutar(async () => {
    const carpeta = await elegirDestinoCopias(globalThis, carpetaDestino);
    if (!carpeta) return;
    carpetaDestino = carpeta; pintarDestino();
    estado('Carpeta de destino guardada.');
  }));
  const elegirArchivo = () => { if (ocupado) return; $('[data-archivo]').value = ''; $('[data-archivo]').click(); };
  $('[data-nombre-archivo]').addEventListener('click', elegirArchivo);
  $('[data-nombre-archivo]').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); elegirArchivo(); } });
  $('[data-archivo]').addEventListener('change', () => ejecutar(async () => {
    const f = $('[data-archivo]').files[0]; if (!f) return;
    limpiarSeleccion();
    if (f.size > 512 * 1024 * 1024) throw new Error('El archivo supera los 512 MB.');
    let paquete; try { paquete = JSON.parse(await f.text()); } catch { throw new Error('El archivo no es una copia JSON válida.'); }
    await revisar(paquete, f.name);
  }));
  $('[data-restaurar]').addEventListener('click', () => ejecutar(async () => {
    if (!elegido) return;
    const c = await copias.validarCopia(elegido);
    if (!await preguntar('Restaurar copia', `Se sustituirán los datos actuales por los del ${fecha(c.fecha)}: ${cifras(c.resumen)}. Se guardará una copia de lo que tienes ahora en «Copias recientes». Las ventanas abiertas se recargarán. ¿Continuar?`, { textoSi: 'Restaurar', peligro: true })) return;
    estado('Guardando los datos actuales y restaurando…');
    await copias.restaurarCopia(elegido);
    try { const canal = new BroadcastChannel('chessrival-restauracion'); canal.postMessage('restaurada'); canal.close(); } catch {}
    location.replace('index.html');
  }));
  $('[data-automaticas]').addEventListener('change', () => {
    const activadas = $('[data-automaticas]').checked;
    ejecutar(async () => {
      await copias.guardarOpcionCopias('automaticas', activadas);
      $('[data-auto-estado]').textContent = activadas ? 'Activadas' : 'Desactivadas';
      // Al activarlas no se hace ninguna copia en ese momento: la primera llega pasados cinco minutos, si hay cambios.
      if (activadas) await copias.guardarOpcionCopias('ultima_automatica', { hash: null, momento: Date.now() });
    });
  });
  await ejecutar(cargar);
}
