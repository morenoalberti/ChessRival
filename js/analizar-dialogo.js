// Cuadro «Analizar» (AnalizarDialog.xaml): Stockfish analiza las partidas más recientes del jugador. Primero se elige cuántas
// (con el tiempo estimado) y luego se ve el progreso, con opción de cancelar. Al terminar, el cuadro se cierra solo.
import { contenidoBoton } from './iconos.js';
import { leerAjuste, guardarAjuste } from './db.js';
import { claveJugador, listarPartidas, partidasAnalizadas, guardarAnalisis } from './db-partidas.js';
import { MotorUci, NOMBRE_MOTOR, PARALELO } from './motor.js';
import { analizarPartida } from './analizador.js';
import { nombreConTitulo } from './nombre-jugador.js';

const OPCIONES = [30, 50, 75, 100, 150, 200, 300, 500, 1000];
const PROFUNDIDADES = [12, 14, 16, 18, 20, 22, 24];
const RECOMENDADA = 18;       // con menos, el motor pasa por alto errores tácticos y las debilidades que salen no son fiables
const SEGUNDOS_INICIAL = 45 / PARALELO;       // por partida, si todavía no hay ninguna medida (con la última medida se afina el cálculo)

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const duracion = (s) => {
  if (s < 60) return 'menos de 1 min';
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};

/** Devuelve cuántas partidas se han analizado (0 si no se ha analizado ninguna). */
export function abrirAnalizar(jugador, { muestra = null } = {}) {
  return new Promise(async (resolver) => {
    const previo = document.activeElement;
    let pendientes = [], segundosPorPartida = SEGUNDOS_INICIAL, profMedida = RECOMENDADA;
    let enCurso = false, analizadas = 0;
    const ab = new AbortController();

    const velo = document.createElement('div');
    velo.className = 'velo';
    velo.innerHTML = `
      <div class="dialogo dialogo-analizar" role="dialog" aria-modal="true" aria-label="Analizando partidas de ${esc(nombreConTitulo(jugador))}">
        <div class="dialogo-cab"><img src="assets/icon.png" alt=""><span>Analizando partidas de ${esc(nombreConTitulo(jugador))}</span></div>
        <div class="importar-cuerpo">
          <p class="importar-intro" data-descripcion>Preparando…</p>
          <div class="analizar-seleccion" data-seleccion hidden>
            <div class="suave" data-pendientes></div>
            <div class="analizar-controles">
              <label>Partidas a analizar:</label><select data-cantidad></select>
              <label>Profundidad del motor:</label><select data-profundidad title="Cuántas jugadas por delante mira Stockfish. Más profundidad es más preciso, pero tarda mucho más."></select>
              <div class="analizar-tiempo" data-tiempo></div>
            </div>
            <label class="estudio-check"><input type="checkbox" data-revisar checked> Actualizar análisis anteriores para el estudio</label>
            <p class="suave"><b>Cuantas más partidas analices, más ejercicios de entrenamiento se podrán generar:</b> de cada partida pueden salir varios, uno por cada error grave confirmado.</p>
          </div>
          <div class="analizar-barra" data-barra hidden><i data-relleno></i></div>
          <p class="analizar-estado" data-estado></p>
          <div class="importar-botones">
            <button type="button" class="btn btn-primario" data-iniciar hidden></button>
            <button type="button" class="btn btn-secundario" data-principal></button>
          </div>
        </div>
      </div>`;
    const $ = (s) => velo.querySelector(s);
    $('[data-iniciar]').innerHTML = contenidoBoton('barras', 'Analizar');
    $('[data-principal]').innerHTML = contenidoBoton('equis', 'Cancelar');

    const cerrar = () => {
      document.removeEventListener('keydown', teclas, true);
      velo.classList.add('saliendo');
      setTimeout(() => { velo.remove(); previo?.focus?.(); }, 160);
      resolver(analizadas);
    };
    const pulsarPrincipal = () => {
      if (enCurso) { $('[data-principal]').disabled = true; $('[data-estado]').textContent = 'Cancelando…'; ab.abort(); } else cerrar();
    };
    const teclas = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); pulsarPrincipal(); } };
    $('[data-principal]').addEventListener('click', pulsarPrincipal);
    document.addEventListener('keydown', teclas, true);
    document.body.appendChild(velo);

    const terminar = () => { enCurso = false; $('[data-principal]').disabled = false; $('[data-principal]').innerHTML = contenidoBoton('equis', 'Cerrar'); $('[data-iniciar]').hidden = true; };
    const cantidad = () => Number($('[data-cantidad]').value) || 0;
    const profundidad = () => Number($('[data-profundidad]').value) || RECOMENDADA;
    const texto = () => `Stockfish revisa las partidas de la muestra seleccionada (profundidad ${profundidad()}) y confirma las posiciones críticas con mayor profundidad.`;
    const actualizarTiempo = () => {
      if (!cantidad()) return;
      const porPartida = segundosPorPartida * Math.pow(1.6, profundidad() - profMedida);      // cada nivel más cuesta, más o menos, un 60 % más
      $('[data-tiempo]').textContent = `≈ ${duracion(cantidad() * porPartida)}`;
    };

    // ---- 1. Elegir cuántas partidas ----
    try {
      const clave = claveJugador(jugador);
      const partidas = muestra ?? await listarPartidas(clave);
      const hechas = await partidasAnalizadas(clave, { estudio: true });
      const todasHechas = await partidasAnalizadas(clave);
      const elegibles = partidas.filter(p => p.puntos !== null && (muestra || p.ritmo === 1));
      const actualizarPendientes = () => {
        const omitir = $('[data-revisar]').checked ? hechas : todasHechas;
        pendientes = elegibles.filter(p => !omitir.has(p.id));
        $('[data-cantidad]').innerHTML = [...OPCIONES.filter(n => n < pendientes.length).map(n => `<option value="${n}">${n} partidas</option>`), `<option value="${pendientes.length}">Todas (${pendientes.length})</option>`].join('');
        $('[data-pendientes]').textContent = `Hay ${pendientes.length} ${pendientes.length === 1 ? 'partida pendiente' : 'partidas pendientes'} en la muestra seleccionada.`;
        $('[data-iniciar]').disabled = !pendientes.length;
        actualizarTiempo();
      };
      pendientes = elegibles.filter(p => !hechas.has(p.id));

      if (!pendientes.length) {
        $('[data-descripcion]').textContent = partidas.length === 0 ? 'Este jugador todavía no tiene partidas importadas.' : 'No queda nada por analizar.';
        $('[data-estado]').textContent = partidas.length === 0 ? 'Importa partidas o cambia los filtros de la muestra.' : 'Las partidas terminadas de esta muestra ya tienen el análisis del estudio actualizado.';
        terminar();
        return;
      }
      const medido = parseFloat(await leerAjuste('analisis_seg_partida', ''));
      if (medido > 0) segundosPorPartida = medido;
      const pm = parseInt(await leerAjuste('analisis_seg_prof', ''), 10);
      if (pm > 0) profMedida = pm;
      const guardada = parseInt(await leerAjuste('analisis_profundidad', ''), 10);

      $('[data-profundidad]').innerHTML = PROFUNDIDADES.map(n => `<option value="${n}" ${n === (PROFUNDIDADES.includes(guardada) ? guardada : RECOMENDADA) ? 'selected' : ''}>${n === RECOMENDADA ? `${n} (recomendada)` : n === 12 ? `${n} (rápida, menos fiable)` : n}</option>`).join('');
      $('[data-cantidad]').innerHTML = [...OPCIONES.filter(n => n < pendientes.length).map(n => `<option value="${n}">${n} partidas</option>`),
        `<option value="${pendientes.length}">Todas (${pendientes.length})</option>`].join('');
      $('[data-descripcion]').textContent = texto();
      $('[data-pendientes]').textContent = `Hay ${pendientes.length} ${pendientes.length === 1 ? 'partida pendiente' : 'partidas pendientes'} de analizar.`;
      $('[data-seleccion]').hidden = false;
      $('[data-iniciar]').hidden = false;
      actualizarTiempo();
      $('[data-revisar]').addEventListener('change', actualizarPendientes);
      $('[data-cantidad]').addEventListener('change', actualizarTiempo);
      $('[data-profundidad]').addEventListener('change', async () => {
        $('[data-descripcion]').textContent = texto();
        actualizarTiempo();
        try { await guardarAjuste('analisis_profundidad', String(profundidad())); } catch { /* se usará la recomendada */ }
      });
      $('[data-iniciar]').focus();
    } catch (ex) { $('[data-estado]').textContent = ex.message; terminar(); return; }

    // ---- 2. Analizar ----
    $('[data-iniciar]').addEventListener('click', async () => {
      const total = cantidad(), prof = profundidad();
      if (!total) return;
      $('[data-seleccion]').hidden = true;
      $('[data-iniciar]').hidden = true;
      enCurso = true;
      const lista = pendientes.slice(0, total);
      $('[data-descripcion]').textContent = `Stockfish analiza ${lista.length} ${lista.length === 1 ? 'partida' : 'partidas'} para descubrir los puntos fuertes y debilidades de su juego con profundidad ${prof}.`;
      $('[data-barra]').hidden = false;
      $('[data-estado]').textContent = `Arrancando ${NOMBRE_MOTOR}…`;

      const motores = [];
      try {
        const n = Math.min(PARALELO, lista.length);
        $('[data-estado]').textContent = `Arrancando ${NOMBRE_MOTOR}${n > 1 ? ` (${n} copias en paralelo)` : ''}…`;
        for (let k = 0; k < n; k++) { const m = await MotorUci.iniciar(); m.nombre = NOMBRE_MOTOR; motores.push(m); }
        const inicio = performance.now();
        const clave = claveJugador(jugador);
        let siguiente = 0, hechas = 0;
        // Cada copia del motor va cogiendo la siguiente partida pendiente: así se aprovechan varios núcleos.
        await Promise.all(motores.map(async (motor) => {
          while (siguiente < lista.length) {
            if (ab.signal.aborted) throw new DOMException('Cancelado', 'AbortError');
            const partida = lista[siguiente++];
            $('[data-estado]').textContent = `Partida ${Math.min(hechas + 1, lista.length)} de ${lista.length} · contra ${partida.rivalConTitulo}`;
            const analisis = await analizarPartida(motor, partida, prof, ab.signal, { confirmarCriticas: true });
            if (analisis) { await guardarAnalisis(clave, analisis); analizadas++; }
            hechas++;
            $('[data-relleno]').style.width = `${hechas / lista.length * 100}%`;
          }
        }));
        // Lo que ha tardado de verdad se recuerda para afinar el tiempo estimado la próxima vez.
        const seg = (performance.now() - inicio) / 1000;
        if (analizadas >= 3) { await guardarAjuste('analisis_seg_partida', (seg / analizadas).toFixed(1)); await guardarAjuste('analisis_seg_prof', String(prof)); }
        $('[data-estado]').textContent = `Listo: ${analizadas} partidas analizadas en ${Math.floor(seg / 60)}:${String(Math.round(seg % 60)).padStart(2, '0')}.`;
        terminar();
        setTimeout(cerrar, 900);
      } catch (ex) {
        if (ex?.name === 'AbortError') { $('[data-estado]').textContent = 'Análisis cancelado. Lo que ya estaba analizado se ha guardado.'; terminar(); setTimeout(cerrar, 1100); }
        else { $('[data-estado]').textContent = ex.message; terminar(); }
      } finally { motores.forEach(m => m.cerrar()); }
    });
  });
}
