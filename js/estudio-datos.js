import { Chess } from './vendor/chess.js';
import { leerPgn, jugadasDe, detectarRitmo, numerar } from './pgn.js';
import { buscarApertura, epdDe, nombreCompleto } from './aperturas.js';

const cache = new WeakMap();
const nombre = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
function fechaPartida(fecha) {
  if (!/^\d{4}[.-]\d{2}[.-]\d{2}$/.test(fecha || '')) return null;
  const [a, m, d] = fecha.split(/[.-]/).map(Number), f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d ? f : null;
}

/** La reconstrucción se comparte entre calidad, repertorio, pruebas y ejercicios. */
export function inspeccionarPartida(p) {
  const anterior = cache.get(p);
  if (anterior && anterior.pgn === p.pgn) return anterior;
  const r = { pgn: p.pgn, valida: false, motivo: '', posiciones: [], movimientos: [], huella: '', ritmo: p.ritmo ?? 0 };
  try {
    const leida = leerPgn(p.pgn || '')[0];
    if (!leida) throw new Error('PGN sin cabeceras legibles');
    r.ritmo = detectarRitmo(leida);
    r.control = leida.cab('TimeControl');
    r.leida = leida;
    const tablero = new Chess(leida.cab('FEN') || undefined);
    r.posiciones.push(tablero.fen());
    const sans = jugadasDe(leida.jugadas);
    if (!sans.length) throw new Error('Sin jugadas para estudiar');
    for (const san of sans) {
      const m = tablero.move(san);
      if (!m) throw new Error('Jugada ilegal');
      r.movimientos.push({ san: m.san, uci: m.from + m.to + (m.promotion || ''), pieza: m.piece, captura: m.captured || '' });
      r.posiciones.push(tablero.fen());
    }
    const resultado = p.resultado || leida.resultado;
    if (p.resultado && leida.resultado !== '*' && p.resultado !== '*' && p.resultado !== leida.resultado) throw new Error('El resultado guardado contradice al PGN');
    if (tablero.isCheckmate() && resultado !== '*' && resultado !== (tablero.turn() === 'w' ? '0-1' : '1-0')) throw new Error('Resultado incompatible con el mate');
    if ((tablero.isStalemate() || tablero.isInsufficientMaterial()) && !['*', '1/2-1/2'].includes(resultado)) throw new Error('Resultado incompatible con la posición final');
    r.valida = true;
    // Una fecha completa evita confundir dos encuentros diferentes con las mismas jugadas.
    const fecha = fechaPartida(p.fecha || leida.cab('Date'));
    if (fecha) r.huella = JSON.stringify([fecha.toISOString().slice(0, 10),
      nombre(p.blancas || leida.cab('White')) || leida.cab('WhiteFideId'),
      nombre(p.negras || leida.cab('Black')) || leida.cab('BlackFideId'),
      r.posiciones[0], resultado, r.movimientos.map(m => m.uci)]);
  } catch (e) { r.motivo = r.movimientos.length ? 'PGN incompleto o con jugadas ilegales' : e.message; }
  cache.set(p, r);
  return r;
}

export function auditarPartidas(partidas, jugador = null) {
  const vistas = new Map(), incidencias = [], validas = [], duplicadas = [];
  // Se conserva el registro original, no una copia reciente que podría carecer de análisis o anotaciones.
  for (const p of partidas.slice().sort((a, b) => (a.id ?? 0) - (b.id ?? 0))) {
    const info = inspeccionarPartida(p);
    if (!info.valida) { incidencias.push({ partida: p, motivo: info.motivo }); continue; }
    const idEnPgn = info.leida.cab(p.colorJugador === 'B' ? 'WhiteFideId' : 'BlackFideId');
    if (jugador?.fideId && /^[1-9]\d*$/.test(idEnPgn) && String(jugador.fideId) !== idEnPgn) {
      incidencias.push({ partida: p, motivo: 'El ID FIDE de la partida no coincide con el jugador' }); continue;
    }
    if (info.huella && vistas.has(info.huella)) {
      duplicadas.push({ partida: p, original: vistas.get(info.huella) }); continue;
    }
    if (info.huella) vistas.set(info.huella, p);
    validas.push(p);
  }
  const conservadas = new Set(validas);
  return { total: partidas.length, validas: partidas.filter(p => conservadas.has(p)), incidencias, duplicadas,
    sinFecha: validas.filter(p => !fechaPartida(p.fecha)).length,
    sinRitmo: validas.filter(p => inspeccionarPartida(p).ritmo === 0).length };
}

export function filtrarEstudio(partidas, { ritmo = 'todos', meses = '0' } = {}, hoy = new Date()) {
  const limite = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()));
  const desde = new Date(limite), dia = desde.getUTCDate();
  desde.setUTCDate(1); desde.setUTCMonth(desde.getUTCMonth() - Number(meses));
  desde.setUTCDate(Math.min(dia, new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth() + 1, 0)).getUTCDate()));
  return partidas.filter(p => {
    if (ritmo !== 'todos' && inspeccionarPartida(p).ritmo !== Number(ritmo)) return false;
    const fecha = fechaPartida(p.fecha);
    if (fecha && fecha > limite) return false;
    return !Number(meses) || (fecha && fecha >= desde);
  });
}

/** Nivel descriptivo de muestra; no es una probabilidad de que una conclusión sea cierta. */
export function fiabilidad(n) {
  return { partidas: n, nivel: n < 5 ? 'Muy baja' : n < 15 ? 'Baja' : n < 30 ? 'Media' : 'Alta', suficiente: n >= 5 };
}
const eloValido = e => Number.isFinite(Number(e)) && Number(e) >= 100 && Number(e) <= 4000;
export function resultadoEsperado(p) {
  const propio = p.colorJugador === 'B' ? p.eloBlancas : p.eloNegras;
  const rival = p.colorJugador === 'B' ? p.eloNegras : p.eloBlancas;
  return eloValido(propio) && eloValido(rival) ? 1 / (1 + 10 ** ((Number(rival) - Number(propio)) / 400)) : null;
}

export function resumirMuestra(partidas, hoy = new Date()) {
  const terminadas = partidas.filter(p => p.puntos !== null), conElo = terminadas.filter(p => resultadoEsperado(p) !== null);
  const victorias = terminadas.filter(p => p.puntos === 1).length;
  const tablas = terminadas.filter(p => p.puntos === .5).length;
  const derrotas = terminadas.filter(p => p.puntos === 0).length;
  const media = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  let sumaPesos = 0, sumaPuntos = 0, fechadas = 0;
  for (const p of terminadas) {
    const fecha = fechaPartida(p.fecha);
    if (!fecha || fecha > hoy) continue;
    const peso = .5 ** ((hoy - fecha) / (365.25 * 86400000));
    sumaPesos += peso; sumaPuntos += peso * p.puntos; fechadas++;
  }
  return { ...fiabilidad(terminadas.length), total: partidas.length, terminadas: terminadas.length,
    victorias, tablas, derrotas, porcentajeVictorias: terminadas.length ? victorias / terminadas.length : null,
    puntuacion: media(terminadas.map(p => p.puntos)), conElo: conElo.length,
    esperada: media(conElo.map(resultadoEsperado)), realComparable: media(conElo.map(p => p.puntos)),
    diferencia: conElo.length ? media(conElo.map(p => p.puntos - resultadoEsperado(p))) : null,
    reciente: sumaPesos ? sumaPuntos / sumaPesos : null, fechadas,
    blancas: fiabilidad(terminadas.filter(p => p.colorJugador === 'B').length),
    negras: fiabilidad(terminadas.filter(p => p.colorJugador === 'N').length) };
}

/** Evidencias reconstruidas desde el PGN, incluidas las de análisis anteriores. */
function evidenciasEstudio(partidas, jugadas) {
  const porId = new Map(partidas.map(p => [p.id, p]));
  return jugadas.flatMap(j => {
    if (j.perdida < 150) return [];
    const p = porId.get(j.partidaId);
    if (!p) return [];
    const info = inspeccionarPartida(p), fen = info.posiciones[j.ply - 1];
    if (!info.valida || !fen || !j.mejor) return [];
    let mejor;
    try { mejor = new Chess(fen).move({ from: j.mejor.slice(0, 2), to: j.mejor.slice(2, 4), promotion: j.mejor[4] }); } catch { return []; }
    if (!mejor || mejor.san === info.movimientos[j.ply - 1]?.san) return [];
    return [{ ...j, partida: p, fen, sanMejor: mejor.san, san: info.movimientos[j.ply - 1].san }];
  }).sort((a, b) => b.perdida - a.perdida);
}

function patronesEstudio(evidencias) {
  const grupos = new Map();
  for (const e of evidencias.filter(e => e.perdida >= 150)) {
    const t = new Chess(e.fen), material = e.fen.split(' ')[0].replace(/[1-8/]/g, '').toLowerCase();
    const etiquetas = [e.fase];
    if (t.isCheck()) etiquetas.push('Decisiones estando en jaque');
    if (/x/.test(e.san)) etiquetas.push('Errores al capturar');
    if (/^[a-h]/.test(e.san)) etiquetas.push('Movimientos de peón');
    if (!/[qbn]/.test(material) && /r/.test(material)) etiquetas.push('Finales de torres');
    if (e.evalAntes >= 200) etiquetas.push('Ventajas desaprovechadas');
    for (const etiqueta of etiquetas.filter(Boolean)) {
      const g = grupos.get(etiqueta) || { nombre: etiqueta, ejemplos: [], partidas: new Set() };
      g.ejemplos.push(e); g.partidas.add(e.partidaId); grupos.set(etiqueta, g);
    }
  }
  return [...grupos.values()].map(g => ({ ...g, partidas: g.partidas.size, recurrente: g.partidas.size >= 3 }))
    .sort((a, b) => b.partidas - a.partidas || b.ejemplos.length - a.ejemplos.length);
}

export function repertorioEstudio(partidas, hoy = new Date()) {
  const grupos = new Map(), limite = new Date(hoy); limite.setFullYear(limite.getFullYear() - 1);
  const anterior = new Date(hoy); anterior.setFullYear(anterior.getFullYear() - 3);
  for (const p of partidas.filter(p => p.puntos !== null)) {
    const info = inspeccionarPartida(p);
    if (!info.valida) continue;
    const vistas = new Set();
    for (let i = 0; i < Math.min(24, info.movimientos.length); i++) {
      const fen = info.posiciones[i], turno = fen.split(' ')[1];
      if ((turno === 'w') !== (p.colorJugador === 'B')) continue;
      const posicion = fen.split(' ').slice(0, 4).join(' '), movimiento = info.movimientos[i].san;
      const k = `${p.colorJugador}|${posicion}|${movimiento}`;
      if (vistas.has(posicion)) continue;
      vistas.add(posicion);
      const inicio = info.posiciones[0].split(' ');
      const g = grupos.get(k) || { color: p.colorJugador, fen, jugada: movimiento, ply: i + 1, plyPosicion: i,
        lineaLlegada: numerar(info.movimientos.slice(0, i).map(m => m.san), inicio[1] === 'w', Number(inicio[5])),
        partidas: [], ordenes: new Set(), recientes: [], anteriores: [] };
      g.partidas.push(p); g.ordenes.add(info.movimientos.slice(0, i).map(m => m.san).join(' '));
      const f = fechaPartida(p.fecha);
      if (f && f <= hoy && f >= anterior) (f >= limite ? g.recientes : g.anteriores).push(p);
      grupos.set(k, g);
    }
  }
  const lista = [...grupos.values()].map(g => ({ ...g, muestra: resumirMuestra(g.partidas, hoy), transposiciones: g.ordenes.size,
    frecuenciaReciente: g.recientes.length, frecuenciaAnterior: g.anteriores.length }));
  // Frecuencia por elección en la misma posición. El total incluye todo el
  // historial filtrado; los dos primeros contadores son las ventanas temporales.
  const totales = new Map();
  const contexto = g => `${g.color}|${g.fen.split(' ').slice(0, 4).join(' ')}`;
  for (const g of lista) { const t = totales.get(contexto(g)) || [0, 0, 0]; t[0] += g.recientes.length; t[1] += g.anteriores.length; t[2] += g.partidas.length; totales.set(contexto(g), t); }
  for (const g of lista) {
    [g.totalReciente, g.totalAnterior, g.totalPosicion] = totales.get(contexto(g));
    g.frecuencia = g.partidas.length / g.totalPosicion;
    g.cambio = g.totalReciente >= 5 && g.totalAnterior >= 5 ? g.recientes.length / g.totalReciente - g.anteriores.length / g.totalAnterior : null;
  }
  return lista.sort((a, b) => b.partidas.length - a.partidas.length || a.ply - b.ply);
}

/** Sigue las jugadas hasta las posiciones reconocidas en el libro. Cuenta todas
 * las partidas que alcanzan cada línea, incluso si después concretan otra variante. */
export function aperturasEstudio(partidas, hoy = new Date()) {
  const grupos = new Map(), alcanzadas = new Map(), totales = { B: 0, N: 0 };
  for (const p of partidas.filter(p => p.puntos !== null)) {
    const info = inspeccionarPartida(p);
    if (!info.valida) continue;
    totales[p.colorJugador]++;
    let encontrada = null;
    const vistas = new Set();
    for (let ply = 1; ply < info.posiciones.length; ply++) {
      const epd = epdDe(info.posiciones[ply]);
      if (vistas.has(epd)) continue;
      vistas.add(epd);
      const clavePosicion = `${p.colorJugador}|${epd}`;
      const llegadas = alcanzadas.get(clavePosicion) || [];
      llegadas.push({ partida: p, ply }); alcanzadas.set(clavePosicion, llegadas);
      const apertura = buscarApertura(epd);
      if (apertura?.nombre && ply >= 5) encontrada = { ...apertura, ply };
    }
    const ply = encontrada?.ply ?? Math.min(16, info.movimientos.length);
    const fen = info.posiciones[ply], inicio = info.posiciones[0].split(' ');
    const k = `${p.colorJugador}|${epdDe(fen)}`;
    const linea = numerar(info.movimientos.slice(0, ply).map(m => m.san), inicio[1] === 'w', Number(inicio[5]));
    const g = grupos.get(k) || { color: p.colorJugador, fen, ply, plyPosicion: ply,
      apertura: encontrada ? nombreCompleto(encontrada.nombre) : 'Apertura aún sin identificar',
      eco: encontrada?.eco || '', identificada: !!encontrada, lineaLlegada: linea,
      partidas: [], ordenes: new Set(), baseFrecuencia: 'color' };
    g.partidas.push(p); g.ordenes.add(linea); grupos.set(k, g);
  }
  return [...grupos.values()].map(g => {
    const llegadas = alcanzadas.get(`${g.color}|${epdDe(g.fen)}`);
    // La primera conserva la secuencia y la posición usadas por el botón del visor.
    const fuente = g.partidas[0], ordenadas = [...llegadas.filter(e => e.partida === fuente), ...llegadas.filter(e => e.partida !== fuente)];
    const partidas = ordenadas.map(e => e.partida), ordenes = new Set(ordenadas.map(e => {
      const info = inspeccionarPartida(e.partida), inicio = info.posiciones[0].split(' ');
      return numerar(info.movimientos.slice(0, e.ply).map(m => m.san), inicio[1] === 'w', Number(inicio[5]));
    }));
    return { ...g, partidas, ordenes, muestra: resumirMuestra(partidas, hoy),
      transposiciones: ordenes.size, totalPosicion: totales[g.color], frecuencia: partidas.length / totales[g.color] };
  })
    .sort((a, b) => b.partidas.length - a.partidas.length || a.apertura.localeCompare(b.apertura, 'es'));
}

export function crearInformeEstudio(partidas, jugadas, hoy = new Date()) {
  const muestra = resumirMuestra(partidas, hoy), evidencias = evidenciasEstudio(partidas, jugadas);
  const repertorio = repertorioEstudio(partidas, hoy), patrones = patronesEstudio(evidencias);
  const lineasApertura = aperturasEstudio(partidas, hoy);
  const planes = ['N', 'B'].map(color => {
    const delColor = lineasApertura.filter(g => g.color === color);
    const opciones = delColor.filter(g => g.identificada && g.muestra.suficiente);
    const revisables = opciones.filter(g => g.muestra.conElo >= 5 ? g.muestra.diferencia < -.05 : g.muestra.puntuacion < .4);
    const ordenadas = revisables.sort((a, b) => ((a.muestra.conElo >= 5 ? a.muestra.diferencia : a.muestra.puntuacion - .5) - (b.muestra.conElo >= 5 ? b.muestra.diferencia : b.muestra.puntuacion - .5)) || b.partidas.length - a.partidas.length);
    const distintas = [];
    for (const g of ordenadas) { if (!distintas.some(x => x.partidas[0].id === g.partidas[0].id)) distintas.push(g); if (distintas.length === 3) break; }
    const evitar = opciones.filter(g => g.muestra.conElo >= 5 ? g.muestra.diferencia > .1 : g.muestra.puntuacion > .6)
      .sort((a, b) => b.partidas.length - a.partidas.length).slice(0, 2);
    return { colorJugador: color, habituales: delColor.slice(0, 4), revisar: distintas, evitar };
  });
  const aperturas = new Map();
  for (const j of jugadas) if (j.apertura && partidas.some(p => p.id === j.partidaId)) aperturas.set(j.partidaId, j.apertura);
  const salidas = [...aperturas].map(([id, a]) => ({ ...a, partida: partidas.find(p => p.id === id) }));
  return { muestra, evidencias, repertorio, lineasApertura, patrones, planes, salidas,
    ejercicios: evidencias.filter(e => e.confirmada && e.perdida >= 150).map(e => {
      if (!e.respuestaRival) return e;
      const fen = inspeccionarPartida(e.partida).posiciones[e.ply];
      try {
        const m = new Chess(fen).move({ from: e.respuestaRival.slice(0, 2), to: e.respuestaRival.slice(2, 4), promotion: e.respuestaRival[4] });
        return { ...e, fen, mejor: e.respuestaRival, sanMejor: m.san, ply: e.ply + 1, modo: 'Aprovecha el error del jugador estudiado.' };
      } catch { return e; }
    }) };
}
