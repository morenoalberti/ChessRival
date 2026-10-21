import { LOCALE, t as tr } from './i18n.js';
import { crearInformeEstudio, inspeccionarPartida } from './estudio-datos.js';
import { nombreConTitulo, textoColoresDeLinea } from './nombre-jugador.js';
import { abrirPanel } from './panel-utilidad.js';
import { abrirVisorEnPanel } from './ventana-visor.js';
import { Tablero } from './tablero.js';
import { Chess } from './vendor/chess.js';
import { leerAjuste, claveJugador } from './db.js';
import { informar, preguntar } from './dialogos.js';
import { registrarIntentoEjercicio, reiniciarEjercicios } from './estudio-progreso.js';
import { convertirFiguras, jugadaHtml } from './figuritas.js';
import { numerar } from './pgn.js';
import { contenidoBoton, svg } from './iconos.js';
import { analizarRespuestaEjercicio } from './explicacion-ejercicio.js';

/** Icono de trazo (18 px) para la cabecera de las tarjetas del informe. */
const ico = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const ICO = {
  cobertura: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Zm-3.5 9 2.5 2.5 4.5-5',
  resultados: 'M3 17l6-6 4 4 8-8m0 0h-5m5 0v5',
  rivales: 'M16 20v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1m12-9a3 3 0 1 0 0-6m5 15v-1a4 4 0 0 0-3-3.9M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  apertura: 'M12 6C10 4.5 6.5 4 3 4.5V19c3.5-.5 7 0 9 1.5 2-1.5 5.5-2 9-1.5V4.5C17.5 4 14 4.5 12 6Zm0 0v14.5',
  patrones: 'M4 6h16M4 12h16M4 18h10',
  repertorio: 'M4 4v6h6M20 20v-6h-6M5.6 15A8 8 0 0 0 20 14M18.4 9A8 8 0 0 0 4 10',
  entrenar: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z',
  aviso: 'M12 3 22 20H2L12 3Zm0 6.5V14m0 3h.01',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-11v6m0-9.5h.01'
};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = n => n === null || n === undefined ? '—' : `${(n * 100).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} %`;
const puntos = n => `${n > 0 ? '+' : ''}${(n / 100).toLocaleString(LOCALE, { maximumFractionDigits: 2 })}`;
const cuenta = (n, una, varias) => `${n} ${n === 1 ? una : varias}`;
const evidencia = (p, ply = 0, texto = 'Ver partida', icono = null) => `<button type="button" class="btn btn-secundario btn-chico" data-prueba="${p.id}" data-ply="${ply}">${icono ? contenidoBoton(icono, esc(texto)) : esc(texto)}</button>`;
const idEjercicio = (e) => `${e.partidaId}:${e.ply}:${e.mejor}`;
/** «Collado Barbas, Laura - IM Roa Alonso, Santiago»: blancas y negras, con el título del jugador estudiado. */
function jugadoresDeLaPartida(p, jugador) {
  const leida = inspeccionarPartida(p).leida, titulo = jugador.fideTitle || jugador.titulo || '';
  const blancas = nombreConTitulo({ name: p.blancas || leida?.cab('White') || 'Jugador con blancas' }, p.tituloBlancas || (p.colorJugador === 'B' ? titulo : ''));
  const negras = nombreConTitulo({ name: p.negras || leida?.cab('Black') || 'Jugador con negras' }, p.tituloNegras || (p.colorJugador === 'N' ? titulo : ''));
  return `${blancas} - ${negras}`;
}
const referencia = (p, ply) => `Partida #${p.id} · ${p.fechaMostrada || 'sin fecha'} · contra ${p.rivalConTitulo || p.rival || 'rival desconocido'} · Jugador estudiado: ${p.colorJugador === 'B' ? 'blancas' : 'negras'} · Rival: ${p.colorJugador === 'B' ? 'negras' : 'blancas'} · jugada ${Math.ceil(ply / 2)}${ply % 2 ? '.' : '…'}`;
const muestra = (m, conCantidad = true) => `<span class="estudio-fiabilidad" title="Nivel descriptivo según el número de partidas independientes; no es una probabilidad">Fiabilidad ${m.nivel.toLowerCase()}${conCantidad ? ` · ${cuenta(m.partidas, 'partida', 'partidas')}` : ''}</span>`;
const nombreLinea = g => `${g.apertura}${g.eco ? ` · ${g.eco}` : ''}`;
const posicionTexto = g => `${nombreLinea(g)}. Línea: ${convertirFiguras(g.lineaLlegada)}`;
const posicionHtml = (g, jugador) => `<span class="estudio-apertura"><b>${esc(g.apertura)}</b>${g.eco ? `<span class="suave"> · ECO ${esc(g.eco)}</span>` : ''}</span><span class="estudio-jugadores">${esc(textoColoresDeLinea(jugador, g.color))}</span><span class="estudio-posicion">Línea: ${jugadaHtml(g.lineaLlegada)}${g.transposiciones > 1 ? `<span class="suave"> · Ejemplo entre ${g.transposiciones} órdenes de llegada</span>` : ''}</span>`;
const resultadosTexto = m => `Jugador estudiado: gana ${m.victorias} de ${m.terminadas} partidas (${pct(m.porcentajeVictorias)}). Tablas: ${m.tablas} · Derrotas: ${m.derrotas}`;
const resultadosHtml = m => `<span class="estudio-resultados"><b>Jugador estudiado: gana ${m.victorias} de ${m.terminadas} partidas (${pct(m.porcentajeVictorias)})</b><span>Tablas: ${m.tablas} · Derrotas: ${m.derrotas}</span></span>`;
const frecuenciaHtml = g => `<span class="estudio-frecuencia"><b>Frecuencia de uso: ${pct(g.frecuencia)} (${g.partidas.length} de ${g.totalPosicion} partidas con ${g.color === 'B' ? 'blancas' : 'negras'})</b></span>`;

/** Solo enlaza referencias presentes en la muestra; el HTML de entrada ya debe estar escapado. */
export function enlazarReferenciasEstudio(html, partidas, evidencias) {
  let verificadas = 0, fuera = 0;
  const enlazado = html.replace(/\[Partida #(\d+), jugada (\d+)[.…]*\]/g, (ref, id, numero) => {
    const p = partidas.find(p => p.id === Number(id));
    if (!p || Number(numero) < 1) { fuera++; return ref; }
    const e = evidencias.find(e => e.partidaId === p.id && Math.ceil(e.ply / 2) === Number(numero));
    const ply = e ? e.ply - 1 : Math.max(0, Number(numero) * 2 - 2);
    if (ply >= inspeccionarPartida(p).posiciones.length) { fuera++; return ref; }
    verificadas++;
    return `<button type="button" class="btn btn-secundario btn-chico" data-prueba="${p.id}" data-ply="${ply}">${ref}</button>`;
  });
  return { html: enlazado, verificadas, fuera };
}

export function textoInformeEstudio(jugador, informe, auditoria, alcance) {
  const m = informe.muestra;
  const lineas = [`ESTUDIO DE ${nombreConTitulo(jugador)}`, `Generado: ${new Date().toLocaleString(LOCALE)}`, `Muestra: ${alcance}`,
    `${auditoria.total} partidas guardadas; ${auditoria.duplicadas.length} duplicadas excluidas; ${auditoria.incidencias.length} dudosas excluidas.`,
    `Fiabilidad ${m.nivel.toLowerCase()}: ${m.terminadas} partidas terminadas. Blancas ${m.blancas.partidas}; negras ${m.negras.partidas}.`,
    `Puntuación: ${pct(m.puntuacion)}. Con peso temporal: ${pct(m.reciente)} (${m.fechadas} partidas fechadas; el peso se reduce a la mitad cada año).`,
    `Comparación ELO (${m.conElo} partidas con ambos ELO históricos): obtenido ${pct(m.realComparable)}, esperado ${pct(m.esperada)}. Modelo logístico orientativo, no cálculo oficial FIDE.`, '', 'PLAN DE PREPARACIÓN'];
  for (const plan of informe.planes) {
    lineas.push(plan.colorJugador === 'N' ? 'TÚ CON BLANCAS; EL JUGADOR CON NEGRAS' : 'TÚ CON NEGRAS; EL JUGADOR CON BLANCAS');
    for (const g of plan.habituales) lineas.push(`${posicionTexto(g)}. ${textoColoresDeLinea(jugador, g.color)}. ${resultadosTexto(g.muestra)}. Frecuencia ${pct(g.frecuencia)} (${g.partidas.length} de ${g.totalPosicion} partidas del jugador con ${g.color === 'B' ? 'blancas' : 'negras'}). ${referencia(g.partidas[0], g.ply)}.`);
    if (!plan.revisar.length) lineas.push('Sin una línea a revisar respaldada por al menos cinco partidas en esta muestra.');
    for (const g of plan.revisar) lineas.push(`${posicionTexto(g)}. ${textoColoresDeLinea(jugador, g.color)}. Línea para revisar. ${resultadosTexto(g.muestra)}. Puntuación: ${pct(g.muestra.puntuacion)}. ${referencia(g.partidas[0], g.ply)}.`);
    for (const g of plan.evitar) lineas.push(`${posicionTexto(g)}. ${textoColoresDeLinea(jugador, g.color)}. Evitar entrar sin preparación. ${resultadosTexto(g.muestra)}. Puntuación: ${pct(g.muestra.puntuacion)} en ${g.partidas.length} partidas. No es una valoración del motor. ${referencia(g.partidas[0], g.ply)}.`);
  }
  lineas.push('', 'PATRONES Y EVIDENCIAS');
  for (const g of informe.patrones.slice(0, 8)) {
    lineas.push(`${g.nombre}: ${g.ejemplos.length} errores en ${g.partidas} partidas; ${g.recurrente ? 'repetido en varias partidas' : 'observación con poca muestra'}.`);
    for (const e of g.ejemplos.slice(0, 3)) lineas.push(`  ${referencia(e.partida, e.ply)}: jugó ${convertirFiguras(e.san)}, propuesta ${convertirFiguras(e.sanMejor)}, pérdida ${puntos(e.perdida)}; ${e.confirmada ? 'confirmada' : 'pendiente de confirmación'}.`);
  }
  lineas.push('', 'APERTURA Y RESULTADO');
  for (const a of informe.salidas.slice(0, 10)) lineas.push(`${referencia(a.partida, a.ply)}: evaluación tras 12 jugadas ${puntos(a.valor)} desde el jugador; resultado ${a.partida.resultado}.`);
  return lineas.join('\n');
}

export function montarEstudioUi({ obtenerJugador }) {
  let actual = null, ejercicios = [];
  /** Abre el ejercicio i; su botón «Siguiente ejercicio» abre el i+1 (el último vuelve al primero). */
  /** Los botones de la lista dicen «Resuelto» en los ejercicios ya resueltos. */
  async function marcarResueltos() {
    let progreso = {};
    try { progreso = await leerAjuste(`estudio-ejercicios:${claveJugador(obtenerJugador())}`, {}); } catch { /* sin progreso */ }
    for (const b of document.querySelectorAll('#estudioEntrenamiento [data-id-ejercicio]')) {
      const hecho = !!progreso[b.dataset.idEjercicio]?.resuelto;
      b.textContent = hecho ? 'Resuelto' : 'Resolver';
      b.classList.toggle('resuelto', hecho);
    }
  }
  document.addEventListener('ejercicio-progreso', marcarResueltos);
  document.addEventListener('click', async (ev) => {
    if (!ev.target.closest('[data-reiniciar-ejercicios]')) return;
    if (!await preguntar('Reiniciar ejercicios', 'Todos los ejercicios volverán a «Resolver» y se borrarán los intentos. ¿Continuar?', { textoSi: 'Reiniciar' })) return;
    try { await reiniciarEjercicios(`estudio-ejercicios:${claveJugador(obtenerJugador())}`); } catch (ex) { await informar('No se pudo reiniciar', ex.message); return; }
    marcarResueltos();
  });
  function abrirEjercicioNumero(i) {
    if (!ejercicios[i]) return;
    abrirEjercicio(ejercicios[i], obtenerJugador(), ejercicios.length > 1 ? () => abrirEjercicioNumero((i + 1) % ejercicios.length) : null);
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-prueba]');
    if (b) abrirVisorEnPanel(Number(b.dataset.prueba), { ply: Number(b.dataset.ply) });
    const entrenamiento = e.target.closest('[data-ejercicio]');
    if (entrenamiento && ejercicios[Number(entrenamiento.dataset.ejercicio)]) abrirEjercicioNumero(Number(entrenamiento.dataset.ejercicio));
    if (e.target.closest('[data-incidencias-estudio]') && actual) {
      const { auditoria } = actual;
      const panel = abrirPanel('Revisión de partidas', `<p class="suave">Los originales y sus anotaciones se conservan. Estas partidas no intervienen en las conclusiones del estudio.</p>
        ${[...auditoria.incidencias.map(i => ({ ...i, razon: i.motivo })), ...auditoria.duplicadas.map(i => ({ ...i, razon: `Repetida de la partida #${i.original.id}` }))].map(i => `<div class="estudio-evidencia"><span>#${i.partida.id} · ${esc(i.partida.fechaMostrada || 'sin fecha')} · ${esc(i.razon)}</span>${evidencia(i.partida)}</div>`).join('') || '<p>No se detectaron incidencias.</p>'}`, 'panel-estudio');
      panel?.velo.querySelector('.utilidad-cuerpo')?.focus();
    }
    if (e.target.closest('[data-exportar-estudio]') && actual) {
      const contenido = textoInformeEstudio(obtenerJugador(), actual.informe, actual.auditoria, actual.alcance);
      const url = URL.createObjectURL(new Blob([contenido], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = `Estudio-${obtenerJugador().fideId || 'jugador'}.txt`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });
  return {
    pintar(partidas, jugadas, auditoria, alcance) {
      const informe = crearInformeEstudio(partidas, jugadas);
      actual = { informe, auditoria, alcance }; ejercicios = informe.ejercicios;
      const m = informe.muestra;
      document.querySelector('#estudioCalidad').innerHTML = `<div class="estudio-cab"><b>Calidad de la muestra</b>${muestra(m)}<button type="button" class="btn btn-secundario btn-chico" data-incidencias-estudio>Revisar partidas</button></div>
        <p class="suave">${auditoria.total} guardadas · ${auditoria.validas.length} válidas y únicas · ${cuenta(auditoria.duplicadas.length, 'duplicada', 'duplicadas')} · ${cuenta(auditoria.incidencias.length, 'dudosa', 'dudosas')}. En el filtro actual: ${cuenta(partidas.length, 'partida', 'partidas')}, ${cuenta(m.terminadas, 'terminada', 'terminadas')}.</p>
        <p class="suave">${auditoria.sinRitmo} con ritmo desconocido · ${auditoria.sinFecha} sin fecha completa. Los desconocidos tienen su propio filtro y las fechas incompletas no entran en periodos recientes.</p>`;
      document.querySelector('#estudioInforme').innerHTML = `<div class="estudio-cab"><h2>Informe de ${esc(nombreConTitulo(obtenerJugador()))}</h2><button type="button" class="btn btn-secundario btn-chico" data-exportar-estudio>Guardar informe</button></div>
        <p class="suave">${esc(tr(alcance))}.</p>
        <div class="estudio-columnas"><section class="tarjeta-ficha estudio-tarjeta" style="--c:#2F6FE0"><h3>${ico(ICO.cobertura)}Cobertura y fiabilidad</h3><p>${muestra(m)}</p><p>Blancas: ${m.blancas.partidas} partidas (${m.blancas.nivel.toLowerCase()}). Negras: ${m.negras.partidas} (${m.negras.nivel.toLowerCase()}).</p><p class="suave">El nivel depende de partidas independientes: menos de 5, muy baja; 5–14, baja; 15–29, media; desde 30, alta. No garantiza que una conclusión sea cierta.</p></section>
        <section class="tarjeta-ficha estudio-tarjeta" style="--c:#1E8E4F"><h3>${ico(ICO.resultados)}Resultados y actualidad</h3><p>Puntuación: <b>${pct(m.puntuacion)}</b>. Con mayor peso a lo reciente: <b>${pct(m.reciente)}</b>.</p><p class="suave">${m.fechadas} partidas con fecha completa. El peso se reduce a la mitad por cada año de antigüedad; las fechas desconocidas no se ponderan.</p></section>
        <section class="tarjeta-ficha estudio-tarjeta" style="--c:#F26A5B"><h3>${ico(ICO.rivales)}Fuerza de los rivales</h3><p>En ${m.conElo} partidas con ambos ELO históricos: <b>${pct(m.realComparable)}</b> obtenido frente a <b>${pct(m.esperada)}</b> esperado.</p><p class="suave">Se comparan exactamente las mismas partidas. Modelo logístico orientativo (escala 400); no calcula el ELO oficial ni utiliza el ELO actual para rellenar ausencias.</p></section>
        <section class="tarjeta-ficha estudio-tarjeta" style="--c:#D9A21B"><h3>${ico(ICO.apertura)}Apertura y resultado final</h3><p>${informe.salidas.length} ${informe.salidas.length === 1 ? 'partida' : 'partidas'} con evaluación tras 12 jugadas completas.</p><p class="suave">Un mal resultado no demuestra una mala apertura. Estas posiciones permiten comprobar dónde empezó el problema.</p>${informe.salidas.slice(0, 4).map(a => `<div class="estudio-evidencia"><span>${puntos(a.valor)} al salir de la apertura · resultado ${esc(a.partida.resultado)}</span>${evidencia(a.partida, a.ply, 'Ver posición')}</div>`).join('') || '<p class="suave">Actualiza el análisis de la muestra para obtener esta comparación.</p>'}</section></div>
        <section class="tarjeta-ficha estudio-tarjeta" style="--c:#34507F"><h3>${ico(ICO.patrones)}Patrones con ejemplos</h3>${informe.patrones.slice(0, 8).map(g => `<div class="estudio-patron"><b>${esc(g.nombre)}</b> · ${g.ejemplos.length} errores en ${g.partidas} partidas · ${g.recurrente ? 'repetido' : 'muestra insuficiente para generalizar'}
          ${g.ejemplos.filter((e, i, l) => l.findIndex(x => x.partidaId === e.partidaId) === i).slice(0, 3).map(e => `<div class="estudio-evidencia"><span>${esc(referencia(e.partida, e.ply))}<br>Jugó ${jugadaHtml(e.san)}; propuesta ${jugadaHtml(e.sanMejor)} · pérdida ${puntos(e.perdida)} · ${e.confirmada ? 'confirmada a profundidad ' + e.profundidad : 'pendiente de confirmación'}</span>${evidencia(e.partida, e.ply - 1, 'Comprobar')}</div>`).join('')}</div>`).join('') || '<p class="suave">Todavía no hay errores con posición y alternativa legales suficientes para mostrar ejemplos.</p>'}</section>
        <section class="tarjeta-ficha estudio-tarjeta" style="--c:#7A5AC8"><h3>${ico(ICO.repertorio)}Cambios de repertorio</h3><p class="suave">Últimos 12 meses frente a los 24 anteriores, dentro de la muestra filtrada. Exige 5 partidas en cada periodo para la misma posición.</p>
        ${informe.repertorio.filter(g => g.cambio !== null && Math.abs(g.cambio) >= .2).slice(0, 8).map(g => `<div class="estudio-evidencia"><span>${g.color === 'B' ? 'Blancas' : 'Negras'} · ${jugadaHtml(g.jugada)}: ${pct(g.anteriores.length / g.totalAnterior)} antes → ${pct(g.recientes.length / g.totalReciente)} reciente. ${g.transposiciones} órdenes de jugadas.</span>${evidencia(g.partidas[0], g.plyPosicion, 'Ver posición')}</div>`).join('') || '<p class="suave">Sin cambios respaldados por muestras suficientes en ambos periodos.</p>'}</section>`;
      queueMicrotask(() => setTimeout(marcarResueltos));
      document.querySelector('#estudioEntrenamiento').innerHTML = `<h2>${ico(ICO.entrenar)}Entrenamiento con sus partidas - ${ejercicios.length} ${ejercicios.length === 1 ? 'ejercicio' : 'ejercicios'}</h2><div class="estudio-intro-ejercicios"><p class="suave">Solo posiciones cuyo error se ha confirmado con mayor profundidad. Stockfish comprueba las jugadas alternativas y muestra su continuación y valoración.</p>${ejercicios.length ? `<button type="button" class="btn-reiniciar" data-reiniciar-ejercicios title="Reiniciar: poner todos los ejercicios en «Resolver»" aria-label="Reiniciar todos los ejercicios">${svg('reiniciar', 18)}</button>` : ''}</div>
        ${ejercicios.map((e, i) => `<div class="estudio-evidencia estudio-fila-ejercicio"><span><b>Partida ${e.partida.id}</b><span class="ej-jugadores">${esc(jugadoresDeLaPartida(e.partida, obtenerJugador()))}</span></span><button type="button" class="btn btn-secundario btn-chico" data-ejercicio="${i}" data-id-ejercicio="${esc(idEjercicio(e))}">Resolver</button></div>`).join('') || '<p class="vacio-texto">No hay ejercicios confirmados en esta muestra. Pulsa «Analizar» y activa «Actualizar análisis anteriores para el estudio».</p>'}
        ${ejercicios.length && ejercicios.length < 50 ? `<p class="suave" style="margin-top:12px">Hay ${ejercicios.length} ejercicios porque solo salen de las partidas ya analizadas, y solo de los errores graves (más de 1,5 puntos) que Stockfish confirma. Para tener más, pulsa «Analizar» y elige más partidas (idealmente todas).</p>` : ''}`;
      return informe;
    },
    plan(informe) {
      for (const [i, id] of ['prepBlancas', 'prepNegras'].entries()) {
        const plan = informe.planes[i], propio = i ? 'negras' : 'blancas', suyo = i ? 'blancas' : 'negras';
        document.getElementById(id).innerHTML = `<h3 class="prep-titulo"><i class="punto-color ${i ? 'negro' : 'blanco'}"></i>Si juegas con ${propio}</h3><p class="prep-texto">El jugador estudiado lleva ${suyo}. Prepara respuestas a sus elecciones habituales.</p>
          <h4>Aperturas que juega</h4><p class="suave estudio-nota">Frecuencia sobre sus partidas con este color. Una variante puede estar incluida en otra línea más general.</p>${plan.habituales.map(g => `<div class="estudio-evidencia"><span>${posicionHtml(g, obtenerJugador())}${resultadosHtml(g.muestra)}${frecuenciaHtml(g)}${muestra(g.muestra, false)}</span>${evidencia(g.partidas[0], g.plyPosicion, 'Ver línea')}</div>`).join('') || '<p class="suave">No hay partidas terminadas para mostrar aperturas.</p>'}
          <h4>Posiciones para revisar</h4>${plan.revisar.map(g => `<div class="estudio-evidencia"><span>${posicionHtml(g, obtenerJugador())}${resultadosHtml(g.muestra)}${frecuenciaHtml(g)}Puntuación: ${pct(g.muestra.puntuacion)} en ${g.partidas.length} partidas.${g.muestra.conElo >= 5 ? ` Diferencia frente a lo esperado: ${(g.muestra.diferencia * 100).toFixed(1)} puntos porcentuales (${g.muestra.conElo} partidas).` : ' Sin ajuste ELO suficiente.'}<br>${muestra(g.muestra)} · ${cuenta(g.transposiciones, 'orden de llegada', 'órdenes de llegada')}</span>${evidencia(g.partidas[0], g.plyPosicion, 'Preparar')}</div>`).join('') || '<p class="suave">No hay una apertura identificada con resultados débiles suficientemente respaldados. No se propone una línea por una derrota aislada.</p>'}
          <h4>Evitar entrar sin preparación</h4>${plan.evitar.map(g => `<div class="estudio-evidencia"><span>${posicionHtml(g, obtenerJugador())}${resultadosHtml(g.muestra)}${frecuenciaHtml(g)}Puntúa ${pct(g.muestra.puntuacion)} en ${g.partidas.length} partidas. Lleva una respuesta preparada; estos resultados no equivalen a una ventaja del motor.<br>${muestra(g.muestra)}</span>${evidencia(g.partidas[0], g.plyPosicion, 'Estudiar')}</div>`).join('') || '<p class="suave">No hay una línea especialmente favorable para él con muestra suficiente.</p>'}`;
      }
      document.querySelector('#prepConclBlancas').innerHTML = `<h3 class="prep-titulo">${ico(ICO.info)}A tener en cuenta</h3><p class="prep-texto">${tr('Las posiciones sugeridas requieren comprobar las alternativas en el visor. Los resultados históricos no garantizan una ventaja.')}</p>`;
      document.querySelector('#prepConclNegras').innerHTML = `<h3 class="prep-titulo">${ico(ICO.info)}Cómo leer el plan</h3><p class="prep-texto">${tr('El plan distingue las jugadas que elige el jugador de las respuestas que debes preparar tú.')}</p>`;
    }
  };
}

async function abrirEjercicio(e, jugador, siguiente = null) {
  const girado = e.fen.split(' ')[1] === 'b', p = e.partida, leida = inspeccionarPartida(p).leida;
  const titulo = jugador.fideTitle || jugador.titulo || '';
  const eloDe = (partida, leida, lado) => { const v = (lado === 'White' ? partida.eloBlancas : partida.eloNegras) || leida?.cab(lado + 'Elo'); return v && v !== '0' ? ` (${v})` : ''; };
  const blancas = { color: 'blancas', nombre: nombreConTitulo({ name: p.blancas || leida?.cab('White') || 'Jugador con blancas' }, p.tituloBlancas || (p.colorJugador === 'B' ? titulo : '')) + eloDe(p, leida, 'White') };
  const negras = { color: 'negras', nombre: nombreConTitulo({ name: p.negras || leida?.cab('Black') || 'Jugador con negras' }, p.tituloNegras || (p.colorJugador === 'N' ? titulo : '')) + eloDe(p, leida, 'Black') };
  const jugadorHtml = lado => `<div class="estudio-jugador"><i class="estudio-color ${lado.color}" aria-hidden="true"></i><span>${lado.color === 'blancas' ? 'Blancas' : 'Negras'}: ${esc(lado.nombre)}</span></div>`;
  const panel = abrirPanel(`Entrenamiento · ${nombreConTitulo(jugador)}`, `<div class="estudio-reloj" data-reloj role="timer" aria-label="Tiempo del ejercicio">${svg('reloj', 15)}<span data-reloj-tiempo>0:00</span></div><div class="estudio-entrenamiento"><div class="estudio-tablero-columna" data-tablero-columna>${jugadorHtml(girado ? blancas : negras)}<div data-tablero-ejercicio></div>${jugadorHtml(girado ? negras : blancas)}</div><div><p class="estudio-turno">${e.fen.split(' ')[1] === 'w' ? 'Blancas' : 'Negras'} juegan y ganan</p><p data-progreso-ejercicio class="suave"></p><p data-jugadas-ejercicio class="estudio-jugadas" hidden></p>
      <p data-variante-correcta class="estudio-variante-correcta" role="status" hidden></p><p data-respuesta-estado role="status"></p><div class="estudio-ejercicio-acciones"><button class="btn btn-secundario" type="button" data-solucion>${contenidoBoton('ojo', 'Pista')}</button>${siguiente ? `<button class="btn btn-primario" type="button" data-siguiente>Siguiente ejercicio &nbsp;›</button>` : ''}</div></div></div>`, 'panel-estudio panel-ejercicio');
  if (!panel) return;
  const $ = s => panel.velo.querySelector(s);
  let t = new Chess(e.fen), fenActual = e.fen, pasos = 0, maxPasos = 0, hechas = [], valoracionFinal = '';   // «pasos»: jugadas correctas del jugador; «maxPasos»: las que dura la variante
  $('[data-siguiente]')?.addEventListener('click', () => { panel.cerrar(); siguiente(); });
  const tablero = new Tablero($('[data-tablero-ejercicio]'), { casilla: Math.max(22, Math.min(42, Math.floor((innerWidth - 85) / 8))), etiquetas: true, interactivo: true });
  let seleccion = null, destinos = [], ocupado = false, resuelto = false;
  let motor = null, iniciandoMotor = null, generacionMotor = 0, base = null;
  const cancelacion = new AbortController();
  const observarCierre = new MutationObserver(() => {
    if (!panel.velo.isConnected) { cancelacion.abort(); motor?.cerrar(); observarCierre.disconnect(); }
  });
  observarCierre.observe(document.body, { childList: true });
  tablero.mostrar(e.fen, null, null, girado);
  $('[data-tablero-columna]').style.setProperty('--ancho-ejercicio', `${tablero.raiz.offsetWidth}px`);
  {
    // La columna derecha empieza en la primera fila del tablero y termina en la última.
    const columna = $('[data-tablero-columna]'), derecha = columna.nextElementSibling;
    const arriba = tablero.raiz.getBoundingClientRect().top - columna.getBoundingClientRect().top;
    const abajo = columna.getBoundingClientRect().bottom - tablero.raiz.getBoundingClientRect().bottom;
    derecha.style.paddingTop = `${Math.max(0, arriba)}px`; derecha.style.paddingBottom = `${Math.max(0, abajo)}px`;
  }
  const clave = `estudio-ejercicios:${claveJugador(jugador)}`;
  let progreso = await leerAjuste(clave, {});
  if (!panel.velo.isConnected) return;
  const id = idEjercicio(e);
  const mostrarProgreso = () => { $('[data-progreso-ejercicio]').textContent = progreso[id] ? `Intentos: ${progreso[id].intentos}. ${progreso[id].resuelto ? 'Resuelto.' : 'Pendiente.'}` : 'Todavía no has intentado este ejercicio.'; };
  mostrarProgreso();
  function limpiarSeleccion() {
    seleccion = null; destinos = [];
    if (!resuelto) tablero.mostrar(fenActual, null, null, girado);
  }
  const profundidadEjercicio = Math.max(16, Math.min(28, e.profundidad || 16));
  /** Ejecuta algo con el motor, con un límite de tiempo y cancelándose si se cierra el panel. */
  async function conMotor(trabajo) {
    let tiempo, alCancelar;
    const limite = new Promise((_, rechazar) => {
      alCancelar = () => rechazar(new DOMException('Cancelado', 'AbortError'));
      cancelacion.signal.addEventListener('abort', alCancelar, { once: true });
      tiempo = setTimeout(() => {
        generacionMotor++; motor?.cerrar(); motor = null; iniciandoMotor = null;
        rechazar(new Error('El análisis está tardando demasiado. Inténtalo de nuevo.'));
      }, 60000);
    });
    try {
      return await Promise.race([limite, (async () => {
        if (!iniciandoMotor) {
          const generacion = generacionMotor;
          iniciandoMotor = import('./motor.js').then(({ MotorUci }) => MotorUci.iniciar()).then(m => {
            if (cancelacion.signal.aborted || generacion !== generacionMotor) { m.cerrar(); throw new DOMException('Cancelado', 'AbortError'); }
            motor = m; return m;
          });
        }
        return trabajo(await iniciandoMotor);
      })()]);
    } finally { clearTimeout(tiempo); cancelacion.signal.removeEventListener('abort', alCancelar); }
  }
  const analizarIntento = (jugada) => conMotor(m => analizarRespuestaEjercicio(m, { fen: fenActual, jugada, profundidad: e.profundidad, base }, cancelacion.signal));
  const analizarPosicion = (fen) => conMotor(m => m.analizar(fen, profundidadEjercicio, cancelacion.signal));
  const reiniciarMotor = () => { generacionMotor++; motor?.cerrar(); motor = null; iniciandoMotor = null; };

  /** Las jugadas correctas hechas hasta ahora (las del jugador y las respuestas de Stockfish), debajo de «Intentos». */
  function pintarJugadas() {
    const campos = e.fen.split(' '), lista = $('[data-jugadas-ejercicio]');
    lista.hidden = hechas.length === 0;
    lista.innerHTML = jugadaHtml(numerar(hechas, campos[1] === 'w', Number(campos[5]) || 1)) + (valoracionFinal ? ` <span class="estudio-valoracion-jugada">${valoracionFinal}</span>` : '');
  }
  // Reloj del ejercicio: cuenta los segundos desde que se abre y se para al resolverlo.
  const inicioReloj = Date.now();
  const relojEjercicio = setInterval(() => {
    if (!panel.velo.isConnected || resuelto) { clearInterval(relojEjercicio); return; }
    const seg = Math.floor((Date.now() - inicioReloj) / 1000);
    $('[data-reloj-tiempo]').textContent = `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;
  }, 1000);
  const pausa = (ms) => new Promise(r => setTimeout(r, ms));
  const uci = (m) => m.from + m.to + (m.promotion || '');

  /** Termina el ejercicio: «Variante correcta» y se guarda como resuelto. */
  async function terminarBien() {
    resuelto = true;
    const anterior = progreso[id] || { intentos: 0, resuelto: false };
    progreso[id] = { intentos: anterior.intentos + 1, resuelto: true, fecha: Date.now() };
    try { progreso = await registrarIntentoEjercicio(clave, id, true); } catch { /* el ejercicio sigue funcionando sin guardar progreso */ }
    document.dispatchEvent(new CustomEvent('ejercicio-progreso'));
    if (!panel.velo.isConnected) return;
    $('[data-respuesta-estado]').textContent = '';
    $('[data-variante-correcta]').hidden = false;
    $('[data-variante-correcta]').textContent = 'Variante correcta';
    $('[data-solucion]').disabled = true;
    mostrarProgreso();
    await mostrarValoracionFinal();
  }

  /** La valoración de Stockfish de la posición a la que llega la variante, siempre desde las blancas («+9,03», «M3»), al final de las jugadas. */
  async function mostrarValoracionFinal() {
    const fin = new Chess(fenActual);
    if (fin.isCheckmate()) { valoracionFinal = 'Jaque mate'; pintarJugadas(); return; }
    if (fin.isDraw() || fin.isStalemate()) { valoracionFinal = 'Tablas'; pintarJugadas(); return; }
    try {
      const v = await analizarPosicion(fenActual);
      if (!panel.velo.isConnected) return;
      const lado = fin.turn() === 'w' ? 1 : -1;
      if (v.mate != null) { const m = v.mate * lado; valoracionFinal = m > 0 ? `M${m}` : `-M${-m}`; }
      else {
        const cp = (v.centipeones ?? 0) * lado;
        const n = (Math.abs(cp) / 100).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        valoracionFinal = cp > 0 ? `+${n}` : cp < 0 ? `−${n}` : n;
      }
      pintarJugadas();
    } catch { /* sin valoración */ }
  }

  /** El jugador mueve de «desde» a «hasta». Si es un peón que corona, se elige la dama (o la pieza de la solución, si es la misma jugada). */
  async function comprobar(desde, hasta) {
    if (ocupado || resuelto) return;
    const esperada = pasos === 0 ? e.mejor : base?.mejorJugada;
    const candidatas = t.moves({ verbose: true }).filter(m => m.from === desde && m.to === hasta);
    if (!candidatas.length) return;
    const jugada = candidatas.find(m => uci(m) === esperada) ?? candidatas.find(m => m.promotion === 'q') ?? candidatas[0];
    const intento = new Chess(fenActual), m = intento.move({ from: jugada.from, to: jugada.to, promotion: jugada.promotion });
    const fenTras = intento.fen(), estado = $('[data-respuesta-estado]');
    limpiarSeleccion();
    ocupado = true;
    estado.style.color = ''; estado.style.fontWeight = '';
    let acierto = uci(m) === esperada;
    try {
      if (!acierto) {
        estado.textContent = 'Stockfish está comprobando tu jugada…';
        const analisis = await analizarIntento(uci(m));
        if (!panel.velo.isConnected) return;
        base = analisis.base; acierto = analisis.acierto;
      }
    } catch (error) {
      reiniciarMotor();
      if (!panel.velo.isConnected) return;
      estado.textContent = `No se ha podido comprobar la variante con Stockfish. ${error.name === 'AbortError' ? '' : error.message} Puedes volver a intentarlo. Este intento no se ha contado.`;
      ocupado = false;
      return;
    }
    estado.textContent = '';

    if (!acierto) {
      // Se enseña la jugada hecha, el aviso en rojo durante un segundo y la jugada se deshace.
      const anterior = progreso[id] || { intentos: 0, resuelto: false };
      progreso[id] = { intentos: anterior.intentos + 1, resuelto: anterior.resuelto, fecha: Date.now() };
      try { progreso = await registrarIntentoEjercicio(clave, id, false); } catch { /* sin guardar progreso */ }
      if (!panel.velo.isConnected) return;
      tablero.mostrar(fenTras, m.from, m.to, girado);
      estado.textContent = 'No es la solución'; estado.style.color = 'var(--rojo)'; estado.style.fontWeight = '600';
      mostrarProgreso();
      await pausa(1000);
      if (!panel.velo.isConnected) return;
      estado.textContent = ''; estado.style.fontWeight = '';
      tablero.mostrar(fenActual, null, null, girado);
      ocupado = false;
      return;
    }

    // Jugada correcta: se queda en el tablero y el rival responde solo, según Stockfish, hasta acabar la variante.
    pasos++; hechas.push(m.san); pintarJugadas();
    fenActual = fenTras; t = new Chess(fenActual);
    tablero.mostrar(fenActual, m.from, m.to, girado);
    if (t.isGameOver()) { await terminarBien(); return; }
    try {
      const rival = await analizarPosicion(fenActual);
      if (!panel.velo.isConnected) return;
      if (maxPasos === 0) maxPasos = 1 + Math.floor(Math.min(rival.variante?.length || 0, 8) / 2);
      if (pasos >= maxPasos || !rival.mejorJugada) { await terminarBien(); return; }
      await pausa(600);
      if (!panel.velo.isConnected) return;
      const r = t.move({ from: rival.mejorJugada.slice(0, 2), to: rival.mejorJugada.slice(2, 4), promotion: rival.mejorJugada[4] });
      fenActual = t.fen(); hechas.push(r.san); pintarJugadas();
      tablero.mostrar(fenActual, r.from, r.to, girado);
      if (t.isGameOver()) { await terminarBien(); return; }
      base = await analizarPosicion(fenActual);       // la mejor jugada que se espera ahora del jugador
      if (!panel.velo.isConnected) return;
      ocupado = false;
    } catch (error) {
      reiniciarMotor();
      if (!panel.velo.isConnected) return;
      estado.textContent = `No se ha podido continuar la variante con Stockfish. ${error.name === 'AbortError' ? '' : error.message}`;
      ocupado = false;
    }
  }
  tablero.alPulsar = c => {
    if (ocupado || resuelto) return;
    if (seleccion && destinos.includes(c)) { const desde = seleccion; limpiarSeleccion(); comprobar(desde, c); return; }
    if (t.get(c)?.color === t.turn()) {
      seleccion = c; destinos = [...new Set(t.moves({ square: c, verbose: true }).map(m => m.to))];
      tablero.mostrar(fenActual, null, null, girado, c, destinos);
    } else limpiarSeleccion();
  };
  tablero.puedeArrastrar = c => !ocupado && !resuelto && seleccion === c && destinos.length > 0;
  tablero.alSoltar = c => {
    if (ocupado || resuelto || !seleccion || c === seleccion) return;
    const desde = seleccion, legal = c && destinos.includes(c);
    limpiarSeleccion();
    if (legal) comprobar(desde, c);
  };
  tablero.alBotonDerecho = () => limpiarSeleccion();
  $('[data-solucion]').addEventListener('click', () => {
    // La pista marca en el tablero la pieza que hay que mover, sin hacer la jugada.
    if (ocupado || resuelto) return;
    const jugada = pasos === 0 ? e.mejor : base?.mejorJugada;
    if (!jugada) { $('[data-respuesta-estado]').textContent = 'Stockfish aún está calculando la siguiente jugada.'; return; }
    seleccion = null; destinos = [];
    $('[data-respuesta-estado]').textContent = '';
    tablero.mostrar(fenActual, null, null, girado, jugada.slice(0, 2), []);
  });
}
