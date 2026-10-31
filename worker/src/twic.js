// Índice anual compartido. Una sola entrega por ejecución; las consultas nunca descargan TWIC.
import { parse } from 'node-html-parser';
import { leerPgn, decodificar, palabras } from '../../js/pgn.js';

export const MAX_CONSULTAS_DIA = 5000;
export const TAM_PAGINA = 100;
const MAX_ZIP = 16 * 1024 * 1024, MAX_PGN = 48 * 1024 * 1024;
const ORIGEN = 'https://theweekinchess.com';
const idFide = n => /^\d{1,12}$/.test(String(n)) && Number(n) > 0 ? String(Number(n)) : '';
export const claveNombreTwic = nombre => [...palabras(String(nombre ?? ''))].sort().join(' ');
export function periodoTwic(ahora = new Date()) {
  const fin = ahora.toISOString().slice(0, 10), d = new Date(`${fin}T00:00:00Z`);
  // El 29 de febrero pasa al último día de febrero, no a marzo.
  const mes = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  if (d.getUTCMonth() !== mes) d.setUTCDate(0);
  return { desde: d.toISOString().slice(0, 10), hasta: fin };
}

/** Solo fechas y números de la tabla oficial. Nunca se aceptan URLs del cliente. */
export function entregasDelArchivo(html, ahora = new Date()) {
  const periodo = periodoTwic(ahora), porNumero = new Map();
  for (const fila of parse(html).querySelectorAll('tr')) {
    const c = fila.querySelectorAll('td').map(n => n.text.trim());
    if (!/^\d{3,5}$/.test(c[0] ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(c[1] ?? '')) continue;
    if (c[1] < periodo.desde || c[1] > periodo.hasta) continue;
    const numero = Number(c[0]);
    if (!fila.querySelectorAll('a').some(a => {
      try { const u = new URL(a.getAttribute('href'), ORIGEN); return u.origin === ORIGEN && u.pathname === `/zips/twic${numero}g.zip`; }
      catch { return false; }
    })) continue;
    porNumero.set(numero, { numero, fecha: c[1] });
  }
  const entregas = [...porNumero.values()].sort((a, b) => b.numero - a.numero);
  // No presentar como completo un archivo semanal que haya cambiado de formato.
  if (entregas.length < 50 || entregas.length > 54 || entregas.some((e, i) => i && entregas[i - 1].numero !== e.numero + 1))
    throw new Error('El archivo TWIC no permite comprobar todas las entregas del último año.');
  return entregas;
}

async function descargar(url, maximo) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'manual', headers: { 'User-Agent': 'ChessRival/1.0', Accept: '*/*' } });
  if (!r.ok) throw new Error(`TWIC respondió con el error ${r.status}.`);
  return bytesLimitados(r.body, maximo);
}
async function bytesLimitados(stream, maximo) {
  const lector = stream.getReader(), partes = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximo) throw new Error('La entrega supera el tamaño de descarga permitido.');
      partes.push(value);
    }
  } catch (e) { await lector.cancel().catch(() => {}); throw e; }
  const bytes = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) { bytes.set(p, pos); pos += p.byteLength; }
  return bytes;
}

/** ZIP estándar de TWIC, un único PGN; límites tanto antes como después de descomprimir. */
export async function pgnDelZip(bytes) {
  if (bytes.byteLength > MAX_ZIP || bytes.byteLength < 22) throw new Error('ZIP de TWIC no válido.');
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fin = bytes.length - 22;
  const minimo = Math.max(0, bytes.length - 65557);
  while (fin >= minimo && vista.getUint32(fin, true) !== 0x06054b50) fin--;
  if (fin < minimo || vista.getUint32(fin, true) !== 0x06054b50 || vista.getUint16(fin + 10, true) > 20) throw new Error('ZIP de TWIC no válido.');
  let pos = vista.getUint32(fin + 16, true), contenido = null;
  for (let i = 0; i < vista.getUint16(fin + 10, true); i++) {
    if (pos + 46 > fin || vista.getUint32(pos, true) !== 0x02014b50) throw new Error('ZIP de TWIC incompleto.');
    const flags = vista.getUint16(pos + 8, true), metodo = vista.getUint16(pos + 10, true);
    const comprimido = vista.getUint32(pos + 20, true), tam = vista.getUint32(pos + 24, true);
    const n = vista.getUint16(pos + 28, true), extra = vista.getUint16(pos + 30, true), comentario = vista.getUint16(pos + 32, true);
    const nombre = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + n));
    if (/\.pgn$/i.test(nombre)) {
      if (contenido || flags & 1 || tam > MAX_PGN || ![0, 8].includes(metodo)) throw new Error('Contenido del ZIP de TWIC no admitido.');
      const local = vista.getUint32(pos + 42, true);
      if (local + 30 > pos || vista.getUint32(local, true) !== 0x04034b50) throw new Error('ZIP de TWIC incompleto.');
      const inicio = local + 30 + vista.getUint16(local + 26, true) + vista.getUint16(local + 28, true);
      if (inicio + comprimido > pos) throw new Error('ZIP de TWIC incompleto.');
      const datos = bytes.subarray(inicio, inicio + comprimido);
      contenido = metodo === 0 ? datos : await bytesLimitados(new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw')), MAX_PGN);
      if (contenido.length !== tam) throw new Error('El tamaño del PGN de TWIC no coincide.');
    }
    pos += 46 + n + extra + comentario;
  }
  if (!contenido) throw new Error('La entrega no contiene un PGN.');
  return decodificar(contenido);
}

const columnas = ['entrega', 'orden', 'blancas_id', 'negras_id', 'blancas_nombre', 'negras_nombre', 'pgn'];
/** Se publica una entrega solo tras terminar todos los lotes. Reintentar no duplica filas. */
export async function guardarEntrega(db, entrega, texto, lease, ahora = new Date()) {
  // TWIC siempre separa sus partidas con Event. Analiza solo el lote actual, sin
  // retener cientos de miles de cabeceras a la vez en los 128 MB del Worker.
  const inicios = [];
  for (const m of texto.matchAll(/^\[Event[ \t]+"/gm)) inicios.push(m.index);
  if (!inicios.length || inicios.length > 30000)
    throw new Error('El PGN de la entrega está vacío, incompleto o supera el límite.');
  await db.prepare('DELETE FROM twic_partidas WHERE entrega = ?').bind(entrega.numero).run();
  let pendientes = [];
  for (let i = 0; i < inicios.length; i += 25) {
    const lote = inicios.slice(i, i + 25).map((inicio, j) => {
      const bloque = texto.slice(inicio, inicios[i + j + 1] ?? texto.length);
      if (bloque.length > 50000) throw new Error('Una partida de TWIC supera el tamaño permitido.');
      const [p] = leerPgn(bloque);
      if (!p?.cab('White') || !p.cab('Black')) throw new Error('Una partida de TWIC no identifica a ambos jugadores.');
      return [entrega.numero, i + j, idFide(p.cab('WhiteFideId')), idFide(p.cab('BlackFideId')),
        claveNombreTwic(p.cab('White')), claveNombreTwic(p.cab('Black')), p.pgn];
    });
    // json_each evita miles de consultas y respeta el límite de parámetros de D1.
    const datos = JSON.stringify(lote);
    if (new TextEncoder().encode(datos).length > 1900000) throw new Error('Un lote de TWIC supera el tamaño permitido.');
    pendientes.push(db.prepare(`INSERT INTO twic_partidas (${columnas.join(',')}) SELECT ${columnas.map((_, n) => `json_extract(value, '$[${n}]')`).join(',')} FROM json_each(?)`)
      .bind(datos));
    if (pendientes.length === 8 || i + 25 >= inicios.length) { await db.batch(pendientes); pendientes = []; }
  }
  const r = await db.prepare("UPDATE twic_entregas SET estado = 'lista', total = ?, actualizada = ?, error = NULL, lease = NULL, lease_hasta = 0 WHERE numero = ? AND lease = ?")
    .bind(inicios.length, ahora.toISOString(), entrega.numero, lease).run();
  if (!r.meta.changes) throw new Error('La actualización de TWIC ha perdido su reserva.');
}

/** El cron completa una entrega por turno, con reserva y duración acotada. Nunca desde una visita. */
export async function sincronizarTwic(env, ahora = new Date()) {
  const db = env.TWIC_DB;
  if (!db) return { estado: 'sin_configurar' };
  const periodo = periodoTwic(ahora);
  const html = decodificar(await descargar(`${ORIGEN}/twic`, 2 * 1024 * 1024));
  const entregas = entregasDelArchivo(html, ahora);
  await db.batch(entregas.map(e => db.prepare('INSERT INTO twic_entregas(numero, fecha) VALUES (?, ?) ON CONFLICT(numero) DO NOTHING').bind(e.numero, e.fecha)));
  await db.prepare("INSERT INTO twic_control(clave,valor) VALUES ('archivo_comprobado',?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor")
    .bind(ahora.toISOString()).run();
  const reserva = crypto.randomUUID(), vence = ahora.getTime() + 20 * 60000;
  // Solo un sincronizador a la vez: una invocación solapada sale sin duplicar trabajo.
  const pendiente = await db.prepare("UPDATE twic_entregas SET lease = ?, lease_hasta = ? WHERE numero = (SELECT numero FROM twic_entregas WHERE estado != 'lista' AND fecha >= ? AND lease_hasta < ? ORDER BY numero DESC LIMIT 1) AND NOT EXISTS (SELECT 1 FROM twic_entregas WHERE lease IS NOT NULL AND lease_hasta >= ?) RETURNING numero, fecha")
    .bind(reserva, vence, periodo.desde, ahora.getTime(), ahora.getTime()).first();
  if (pendiente) {
    try {
      const zip = await descargar(`${ORIGEN}/zips/twic${pendiente.numero}g.zip`, MAX_ZIP);
      await guardarEntrega(db, pendiente, await pgnDelZip(zip), reserva, ahora);
    } catch (e) {
      await db.prepare("UPDATE twic_entregas SET error = ?, lease = NULL, lease_hasta = ? WHERE numero = ? AND lease = ?")
        .bind(String(e.message).slice(0, 250), ahora.getTime() + 3600000, pendiente.numero, reserva).run();
      throw e;
    }
  }
  await db.batch([
    db.prepare('DELETE FROM twic_partidas WHERE entrega IN (SELECT numero FROM twic_entregas WHERE fecha < ?)').bind(periodo.desde),
    db.prepare('DELETE FROM twic_entregas WHERE fecha < ?').bind(periodo.desde),
    db.prepare('DELETE FROM twic_cuota WHERE dia < ?').bind(periodo.hasta)
  ]);
  const faltan = await db.prepare("SELECT count(*) n FROM twic_entregas WHERE fecha >= ? AND estado != 'lista'").bind(periodo.desde).first();
  return { estado: pendiente ? 'actualizado' : faltan.n ? 'esperando' : 'completo', entrega: pendiente?.numero ?? null, pendientes: faltan.n };
}

export async function consultarTwic(env, parametros, ahora = new Date()) {
  if (!env.TWIC_DB) return { estado: 'sin_configurar', partidas: [] };
  const db = env.TWIC_DB, periodo = periodoTwic(ahora);
  const nombre = String(parametros.get('name') ?? '').trim(), fideId = idFide(parametros.get('fideId'));
  const clave = claveNombreTwic(nombre), cursor = parametros.get('cursor') ?? '';
  if (nombre.length > 150 || (!fideId && clave.split(' ').length < 2) || (cursor && !/^\d{3,5}:\d{1,5}$/.test(cursor)))
    return { estado: 'error', error: 'Indica el nombre completo o el ID FIDE del jugador.', partidas: [] };
  // Cuota global de consultas sin caché: fail closed, sin escanear ni servir PGN al agotarla.
  const presupuesto = await db.batch([
    db.prepare('INSERT INTO twic_cuota(dia) VALUES (?) ON CONFLICT(dia) DO NOTHING').bind(periodo.hasta),
    db.prepare('UPDATE twic_cuota SET usadas = usadas + 1 WHERE dia = ? AND usadas < ? RETURNING usadas').bind(periodo.hasta, MAX_CONSULTAS_DIA)
  ]);
  if (!presupuesto[1].results.length) return { estado: 'limite', partidas: [] };
  const entregas = (await db.prepare('SELECT numero, fecha, estado, total, actualizada, error FROM twic_entregas WHERE fecha BETWEEN ? AND ? ORDER BY numero DESC')
    .bind(periodo.desde, periodo.hasta).all()).results;
  const listas = entregas.filter(e => e.estado === 'lista');
  const comprobada = (await db.prepare("SELECT valor FROM twic_control WHERE clave='archivo_comprobado'").first())?.valor ?? null;
  const ramas = [], args = [];
  for (const lado of ['blancas', 'negras']) {
    if (fideId) { ramas.push(`SELECT entrega, orden FROM twic_partidas WHERE ${lado}_id = ?`); args.push(fideId); }
    if (clave.split(' ').length >= 2) {
      ramas.push(`SELECT entrega, orden FROM twic_partidas WHERE ${lado}_nombre = ?${fideId ? ` AND (${lado}_id = '' OR ${lado}_id = ?)` : ''}`);
      args.push(clave); if (fideId) args.push(fideId);
    }
  }
  const [numero, orden] = cursor ? cursor.split(':').map(Number) : [99999, -1];
  // Primero pagina IDs pequeños; solo lee el PGN de las 101 filas de la respuesta.
  const filas = (await db.prepare(`WITH candidatas AS (${ramas.join(' UNION ')}), pagina AS (SELECT g.entrega, g.orden FROM candidatas g JOIN twic_entregas e ON e.numero = g.entrega WHERE e.estado = 'lista' AND e.fecha BETWEEN ? AND ? AND (g.entrega < ? OR (g.entrega = ? AND g.orden > ?)) ORDER BY g.entrega DESC, g.orden LIMIT ?) SELECT p.* FROM pagina g JOIN twic_partidas p ON p.entrega = g.entrega AND p.orden = g.orden ORDER BY p.entrega DESC, p.orden`)
    .bind(...args, periodo.desde, periodo.hasta, numero, numero, orden, TAM_PAGINA + 1).all()).results;
  const pagina = filas.slice(0, TAM_PAGINA), ultima = pagina.at(-1);
  return {
    estado: !entregas.length ? 'preparando' : listas.length === entregas.length ? 'listo' : 'parcial',
    desde: periodo.desde, hasta: periodo.hasta, entregas: entregas.length, revisadas: listas.length,
    ultimaEntrega: entregas[0]?.fecha ?? null, actualizada: listas.map(e => e.actualizada).sort().at(-1) ?? null,
    comprobada, desactualizada: !comprobada || ahora.getTime() - Date.parse(comprobada) > 48 * 3600000,
    errores: entregas.filter(e => e.error).length,
    partidas: pagina.map(g => ({ entrega: g.entrega, pgn: g.pgn })),
    siguiente: filas.length > TAM_PAGINA ? `${ultima.entrega}:${ultima.orden}` : null
  };
}
