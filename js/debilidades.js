// Convierte las jugadas analizadas en puntos débiles (Services/Stockfish/Debilidades.cs). No compara con otros jugadores:
// todo es relativo a la propia media del jugador y a umbrales fijos, y así se dice en cada frase.
import { LOCALE } from './i18n.js';
import { FASES } from './analizador.js';
import { fiabilidad, aperturasEstudio } from './estudio-datos.js';
import { t as tr } from './i18n.js';

const ERROR_GRAVE = 300, VENTAJA_CLARA = 200;

const num = (v) => (Math.round(v * 100) / 100).toLocaleString(LOCALE, { maximumFractionDigits: 2 });
/** Solo el número, con hasta dos decimales: «2», «0,35». */
export const numero = (cp) => num(Math.abs(cp / 100));
/** El número con su unidad: «1 punto», «2 puntos», «0,35 puntos». */
export const puntos = (cp) => { const v = Math.round(Math.abs(cp) / 100 * 100) / 100; return `${num(v)} ${tr(v === 1 ? 'punto' : 'puntos')}`; };

export const nivel = (gravedad) => (gravedad >= 66 ? 'Alta' : gravedad >= 33 ? 'Media' : 'Baja');
const limitar = (v, min, max) => Math.min(max, Math.max(min, v));

/** «partidas»: las que se están viendo; «jugadas»: [{ partidaId, perdida, fase, evalAntes, evalDespues, mejor }]. null si no hay análisis. */
export function calcular(partidas, jugadas) {
  const visibles = new Set(partidas.map(p => p.id));
  jugadas = jugadas.filter(j => visibles.has(j.partidaId));
  if (!jugadas.length) return null;

  const porPartida = new Map(partidas.map(p => [p.id, p]));
  // Jugadas de libro (pérdida 0 sin evaluar) cuentan como jugadas, pero no se mezclan en las medias de fase.
  const medibles = jugadas.filter(j => j.evalAntes !== 0 || j.evalDespues !== 0 || j.mejor.length > 0);
  if (!medibles.length) return null;

  const media = (lista) => lista.length ? lista.reduce((s, j) => s + j.perdida, 0) / lista.length : 0;
  const mediaTotal = media(medibles);
  const jugadasBlancas = medibles.filter(j => porPartida.get(j.partidaId)?.colorJugador === 'B');
  const jugadasNegras = medibles.filter(j => porPartida.get(j.partidaId)?.colorJugador === 'N');
  const blancas = jugadasBlancas.length ? media(jugadasBlancas) : null;
  const negras = jugadasNegras.length ? media(jugadasNegras) : null;

  const fases = {};
  for (const fase of [FASES.apertura, FASES.medioJuego, FASES.final]) {
    const deFase = medibles.filter(j => j.fase === fase);
    fases[fase] = { media: media(deFase), jugadas: deFase.length, partidas: new Set(deFase.map(j => j.partidaId)).size };
  }

  const graves = medibles.filter(j => j.perdida >= ERROR_GRAVE).length;
  const partidasAnalizadas = new Set(jugadas.map(j => j.partidaId)).size;
  const debilidades = [];

  // 1) Fase en la que más pierde.
  const peor = Object.entries(fases).filter(([, f]) => f.jugadas >= 30 && f.partidas >= 5).sort((a, b) => b[1].media - a[1].media)[0];
  if (peor && mediaTotal > 0) {
    const [fase, f] = peor;
    const detalle = Object.entries(fases).filter(([, x]) => x.jugadas >= 10).map(([k, x]) => `${k} ${numero(x.media)}`).join(', ');
    debilidades.push({
      titulo: `Pierde más en el ${fase}`,
      detalle: `Pierde ${puntos(f.media)} por jugada, frente a ${puntos(mediaTotal)} de media (${detalle}).`,
      gravedad: limitar(Math.trunc((f.media / mediaTotal - 0.9) * 150), 0, 100), muestra: fiabilidad(f.partidas)
    });
  }

  // 2) Errores graves.
  const por100 = 100 * graves / medibles.length;
  debilidades.push({
    titulo: 'Errores graves',
    detalle: `${graves} jugadas que pierden ${puntos(ERROR_GRAVE)} o más, en ${partidasAnalizadas} partidas (${por100.toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} cada 100 jugadas).`,
    gravedad: limitar(Math.trunc(por100 * 25), 0, 100)
  });

  // 3) Ventajas que no convierte.
  const grupos = new Map();
  for (const j of jugadas) { const g = grupos.get(j.partidaId) ?? []; g.push(j); grupos.set(j.partidaId, g); }
  const conVentaja = [];
  for (const [id, g] of grupos) {
    const p = porPartida.get(id);
    if (!p || p.puntos === null) continue;
    const ordenadas = g.slice().sort((a, b) => a.ply - b.ply);
    if (ordenadas.some((j, i) => j.evalAntes >= VENTAJA_CLARA && j.mejor.length > 0 && i > 0 && ordenadas[i - 1].evalAntes >= VENTAJA_CLARA && j.ply - ordenadas[i - 1].ply <= 4)) conVentaja.push({ p, gano: p.puntos === 1 });
  }
  if (conVentaja.length >= 5) {
    const noGanadas = conVentaja.filter(c => !c.gano).length;
    const porcentaje = 100 * noGanadas / conVentaja.length;
    debilidades.push({
      titulo: 'No convierte las ventajas',
      detalle: `De ${conVentaja.length} partidas con ventaja clara (más de ${puntos(VENTAJA_CLARA)}) no ganó ${noGanadas} (${Math.round(porcentaje)} %).`,
      gravedad: limitar(Math.trunc(porcentaje * 2.2), 0, 100), muestra: fiabilidad(conVentaja.length)
    });
  }

  // 4) Un color claramente peor: hacen falta al menos 30 jugadas medidas con cada color.
  if (jugadasBlancas.length >= 30 && jugadasNegras.length >= 30 && new Set(jugadasBlancas.map(j => j.partidaId)).size >= 5 && new Set(jugadasNegras.map(j => j.partidaId)).size >= 5 && Math.abs(blancas - negras) >= 8) {
    const peorColor = blancas > negras ? 'blancas' : 'negras';
    debilidades.push({
      titulo: `Juega peor con ${peorColor}`,
      colorJugador: peorColor === 'blancas' ? 'B' : 'N',
      detalle: `Pierde ${puntos(Math.max(blancas, negras))} por jugada con ${peorColor} y ${puntos(Math.min(blancas, negras))} con el otro color.`,
      gravedad: limitar(Math.trunc(Math.abs(blancas - negras) * 4), 0, 100)
    });
  }

  // 5) Aperturas con mal resultado (no depende del motor, sale de las partidas).
  for (const g of aperturasEstudio(partidas)) {
    if (!g.identificada || g.partidas.length < 5) continue;
    const ajustada = g.muestra, porcentaje = 100 * ajustada.puntuacion;
    if (ajustada.conElo >= 5 ? ajustada.diferencia >= -.1 : porcentaje >= 40) continue;
    // Con pocas partidas el resultado es casi azar: la gravedad crece con el tamaño de la muestra (tope: 20).
    const titulo = `Resultados a revisar del jugador con ${g.color === 'B' ? 'blancas' : 'negras'}: ${g.apertura}`;
    const n = g.partidas.length, puntosObtenidos = g.partidas.reduce((s, p) => s + p.puntos, 0);
    const pts = (Math.round(puntosObtenidos * 10) / 10).toLocaleString(LOCALE);
    debilidades.push({
      titulo, colorJugador: g.color, linea: g.lineaLlegada, eco: g.eco,
      detalle: `${pts} ${Math.abs(puntosObtenidos - 1) < 0.001 ? 'punto' : 'puntos'} de ${n} partidas (${Math.round(porcentaje)} %).` + (ajustada.conElo >= 5 ? ` En ${ajustada.conElo} partidas con ambos ELO históricos: ${Math.round(ajustada.realComparable * 100)} % obtenido frente a ${Math.round(ajustada.esperada * 100)} % esperado por un modelo ELO aproximado.` : ' Sin muestra suficiente con ambos ELO para ajustar por la fuerza de los rivales.'),
      gravedad: limitar(Math.trunc((ajustada.conElo >= 5 ? -ajustada.diferencia * 100 : 50 - porcentaje) * Math.min(n, 20) / 4), 0, 100), muestra: fiabilidad(n)
    });
  }

  debilidades.sort((a, b) => b.gravedad - a.gravedad);
  for (const d of debilidades) d.muestra ??= fiabilidad(partidasAnalizadas);
  return { partidasAnalizadas, jugadas: medibles.length, perdidaMedia: mediaTotal, perdidaBlancas: blancas, perdidaNegras: negras, fases, erroresGraves: graves, debilidades };
}
