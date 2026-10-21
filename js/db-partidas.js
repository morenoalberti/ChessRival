// Partidas de cada jugador y su análisis, en IndexedDB (la parte de partidas de DatabaseService.cs).
// Las partidas son del jugador, no de una tarjeta: se identifican con la clave del jugador (su ID FIDE o, si no tiene, su nombre).
import { tx, prom, claveJugador, leerAjuste } from './db.js';
import { PartidaGuardada } from './partidas.js';
import { VERSION_ANALISIS } from './analizador.js';
import { inspeccionarPartida } from './estudio-datos.js';

export { claveJugador };

const claveDePartida = (p) => [p.fecha, p.ronda, p.evento, p.blancas, p.negras, p.resultado].join('\u0001');

function unirFuentes(anterior, nueva) {
  const lista = (anterior ?? '').split(';').filter(Boolean);
  if (nueva && !lista.includes(nueva)) lista.push(nueva);
  return lista.join(';');
}

/** Guarda las partidas del jugador. Una partida que ya estaba (misma fecha, ronda, evento, jugadores y resultado) no se duplica.
 *  «items»: [{ partida (PartidaPgn), color, eco, apertura, ritmo }]. Devuelve cuántas eran nuevas, repetidas o repetidas en el propio lote. */
export async function guardarPartidas(jugadorClave, items, fuente = 'PGN') {
  return tx('partidas', 'readwrite', async (store) => {
    const existentes = await prom(store.index('jugador').getAll(jugadorClave));
    const porClave = new Map(existentes.map(p => [claveDePartida(p), p]));
    const porHuella = new Map(existentes.map(p => [inspeccionarPartida(p).huella, p]).filter(([h]) => h));
    const delLote = new Set();
    let nuevas = 0, repetidas = 0, enLote = 0;

    for (const { partida, color, eco, apertura, ritmo } of items) {
      const dato = {
        jugadorClave, evento: partida.cab('Event'), sitio: partida.cab('Site'), fecha: partida.cab('Date'), ronda: partida.cab('Round'),
        blancas: partida.cab('White'), negras: partida.cab('Black'), resultado: partida.resultado, eco, apertura, colorJugador: color,
        pgn: partida.pgn, primerMovimiento: partida.primerMovimiento, ritmo, origen: fuente
      };
      const k = claveDePartida(dato);
      const huella = inspeccionarPartida(dato).huella;
      const cabeceraIgual = porClave.get(k);
      const ya = (huella && porHuella.get(huella)) || (cabeceraIgual?.pgn === dato.pgn ? cabeceraIgual : null);
      if (ya) {
        // La partida ya estaba: si ahora llega de otra fuente, se anota también esa.
        const unidas = unirFuentes(ya.origen, fuente);
        if (unidas !== ya.origen) { ya.origen = unidas; await prom(store.put(ya)); }
        if (delLote.has(ya.id)) enLote++; else repetidas++;
        continue;
      }
      dato.id = await prom(store.add(dato));
      porClave.set(k, dato);
      if (huella) porHuella.set(huella, dato);
      delLote.add(dato.id);
      nuevas++;
    }
    return { nuevas, repetidas, enLote };
  });
}

/** Las partidas del jugador, de la más reciente a la más antigua. */
export async function listarPartidas(jugadorClave) {
  const lista = await tx('partidas', 'readonly', s => prom(s.index('jugador').getAll(jugadorClave)));
  const fechaDe = (p) => (p.fecha ?? '').replace(/\?/g, '0');
  const sinFecha = (p) => (!p.fecha || p.fecha.startsWith('????') ? 1 : 0);
  return lista.sort((a, b) => (sinFecha(a) - sinFecha(b)) || fechaDe(b).localeCompare(fechaDe(a)) || b.id - a.id)
    .map(p => new PartidaGuardada({ ...p, colorJugador: p.colorJugador === 'N' ? 'N' : 'B', resultado: p.resultado || '*' }));
}

export async function borrarPartidasDe(jugadorClave) {
  await tx(['partidas', 'analisis', 'ediciones'], 'readwrite', async (p, a, e) => {
    for (const k of await prom(p.index('jugador').getAllKeys(jugadorClave))) { await prom(p.delete(k)); await prom(e.delete(k)); }
    for (const k of await prom(a.index('jugador').getAllKeys(jugadorClave))) await prom(a.delete(k));
  });
  await refrescarTarjetasDe(jugadorClave);
}

/** Texto para la tarjeta: cada fuente con el porcentaje de las partidas del jugador que están en ella, una por línea. */
function textoFuentes(partidas, nombreMega = '') {
  if (!partidas.length) return '—';
  const porFuente = new Map();
  for (const p of partidas) for (const f of (p.origen ?? '').split(';').filter(Boolean)) porFuente.set(f, (porFuente.get(f) ?? 0) + 1);
  if (!porFuente.size) return '—';
  const pct = (n) => { const v = n * 100 / partidas.length; return v < 1 ? '<1 %' : `${Math.round(v)} %`; };
  const rango = (f) => (f === 'MegaDatabase' ? 0 : f === 'YottaChess' ? 1 : 2);
  return [...porFuente].sort((a, b) => rango(a[0]) - rango(b[0]) || b[1] - a[1]).map(([f, n]) => `${f === 'MegaDatabase' && nombreMega ? nombreMega : f} · ${pct(n)}`).join('\n');
}

/** Pone en todas las tarjetas del jugador lo que muestran de sus partidas: cuántas, de dónde vienen y si están listas. */
export async function refrescarTarjetasDe(jugadorClave) {
  const partidas = await listarPartidas(jugadorClave);
  const visibles = partidas.length;
  const fuentes = textoFuentes(partidas, (await leerAjuste('mega_nombre', '')) ?? '');
  await tx('tarjetas', 'readwrite', async (c) => {
    for (const t of await prom(c.getAll())) {
      if (claveJugador(t) !== jugadorClave) continue;
      t.gamesCount = visibles; t.sources = fuentes; t.status = partidas.length > 0 ? 'Listo' : 'SinPartidas';
      await prom(c.put(t));
    }
  });
  try { const canal = new BroadcastChannel('chessrival'); canal.postMessage({ tipo: 'tarjetas' }); canal.close(); } catch { /* sin BroadcastChannel */ }
}

// ---------- Análisis con el motor ----------

export async function guardarAnalisis(jugadorClave, analisis) {
  await tx('analisis', 'readwrite', a => prom(a.put({ ...analisis, jugadorClave, analizada: Date.now() })));
}

/** Las jugadas analizadas de todas las partidas del jugador: [{ partidaId, ...jugada }]. */
export async function leerJugadasAnalizadas(jugadorClave) {
  const lista = await tx('analisis', 'readonly', a => prom(a.index('jugador').getAll(jugadorClave)));
  return lista.filter(an => an.version === VERSION_ANALISIS).flatMap(an => an.jugadas.map(j => ({ partidaId: an.partidaId, apertura: an.apertura, profundidadBase: an.profundidad, ...j })));
}

export async function ultimoAnalisis(jugadorClave) {
  const lista = await tx('analisis', 'readonly', a => prom(a.index('jugador').getAll(jugadorClave)));
  const u = lista.filter(an => an.version === VERSION_ANALISIS).sort((a, b) => b.analizada - a.analizada)[0];
  return u ? { motor: u.motor, profundidad: u.profundidad } : null;
}

/** Los ids de las partidas que ya tienen análisis. */
export async function partidasAnalizadas(jugadorClave, { estudio = false } = {}) {
  const lista = await tx('analisis', 'readonly', a => prom(a.index('jugador').getAll(jugadorClave)));
  return new Set(lista.filter(an => an.version === VERSION_ANALISIS && (!estudio || an.estudioVersion === 1)).map(an => an.partidaId));
}

// ---------- El visor: una partida y lo que el usuario le cambia ----------

export async function obtenerPartida(id) {
  const p = await tx('partidas', 'readonly', s => prom(s.get(id)));
  return p ? new PartidaGuardada({ ...p, colorJugador: p.colorJugador === 'N' ? 'N' : 'B', resultado: p.resultado || '*' }) : null;
}

/** { principal: 'e2e4 e7e5 …' | null, variantes: [{ desvio, jugadas }], notas: [{ ruta, simbolos }] }. */
export async function cargarEdicion(partidaId) {
  return (await tx('ediciones', 'readonly', s => prom(s.get(partidaId)))) ?? { principal: null, variantes: [], notas: [] };
}

/** Sustituye lo guardado de la partida. Si no queda nada que guardar, se borra. */
export async function guardarEdicion(partidaId, edicion) {
  const vacia = !edicion.principal && !edicion.variantes.length && !edicion.notas.length;
  await tx('ediciones', 'readwrite', s => vacia ? prom(s.delete(partidaId)) : prom(s.put({ ...edicion, partidaId })));
}
