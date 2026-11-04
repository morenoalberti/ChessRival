import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import 'fake-indexeddb/auto';
import { periodoTwic, entregasDelArchivo, pgnDelZip, guardarEntrega, consultarTwic, sincronizarTwic, MAX_CONSULTAS_DIA, claveNombreTwic } from '../src/twic.js';
import worker from '../src/index.js';
import { leerPgn } from '../../js/pgn.js';
import { guardarPartidas, listarPartidas } from '../../js/db-partidas.js';

const hoy = new Date('2026-10-22T12:00:00Z');
const esquema = (await Promise.all(['0001_twic.sql', '0002_twic_control.sql'].map(n => readFile(new URL(`../migrations/${n}`, import.meta.url), 'utf8')))).join('\n');
function base() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(esquema);
  const db = { sqlite, consultas: [], prepare(sql) {
    db.consultas.push(sql);
    const stmt = sqlite.prepare(sql); let parametros = [];
    return { bind(...p) { parametros = p; return this; },
      async all() { return { results: stmt.all(...parametros) }; },
      async first() { return stmt.get(...parametros) ?? null; },
      async run() { const r = stmt.run(...parametros); return { meta: { changes: Number(r.changes) } }; }
    };
  }, async batch(lista) { sqlite.exec('BEGIN'); try {
    const r = [];
    for (const q of lista) { const datos = await q.all(); r.push(datos); }
    sqlite.exec('COMMIT'); return r;
  } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } };
  return db;
}
const pgn = (n = 0, cambios = '') => `[Event "Prueba ${n}"]\n[Date "2026.10.15"]\n[White "Nakamura, Hikaru"]\n[Black "Rival, Otro"]\n[WhiteFideId "2016192"]\n[BlackFideId "9999"]\n[Result "1-0"]\n${cambios}\n1. e4 e5 2. Nf3 Nc6 1-0`;
const consulta = (datos = {}) => new URLSearchParams({ name: 'Nakamura, Hikaru', fideId: '2016192', ...datos });
const htmlArchivo = () => '<table>' + Array.from({ length: 53 }, (_, i) => {
  const fecha = new Date('2026-10-19T00:00:00Z'); fecha.setUTCDate(fecha.getUTCDate() - i * 7);
  return `<tr><td>${1667 - i}</td><td>${fecha.toISOString().slice(0, 10)}</td><td><a href="/zips/twic${1667 - i}g.zip">PGN</a></td></tr>`;
}).join('') + '</table>';
// ZIP mínimo con deflate real: comprueba el mismo camino que usa workerd.
function zipDe(texto) {
  const raw = Buffer.from(texto), contenido = deflateRawSync(raw), nombre = Buffer.from('twic.pgn');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(contenido.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nombre.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(contenido.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nombre.length, 28);
  const fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50); fin.writeUInt16LE(1, 8); fin.writeUInt16LE(1, 10);
  fin.writeUInt32LE(central.length + nombre.length, 12); fin.writeUInt32LE(local.length + nombre.length + contenido.length, 16);
  return Buffer.concat([local, nombre, contenido, central, nombre, fin]);
}
async function entrega(db, numero = 1667, texto = pgn(), fecha = '2026-10-19') {
  db.sqlite.prepare('INSERT INTO twic_entregas(numero,fecha,lease) VALUES (?,?,?)').run(numero, fecha, 'prueba');
  await guardarEntrega(db, { numero, fecha }, texto, 'prueba', hoy);
}

test('TWIC descubre el año natural sin confundir 12 entregas con 12 meses', () => {
  assert.deepEqual(periodoTwic(hoy), { desde: '2025-10-22', hasta: '2026-10-22' });
  assert.equal(periodoTwic(new Date('2024-02-29')).desde, '2023-02-28');
  const filas = entregasDelArchivo(htmlArchivo(), hoy);
  assert.equal(filas.length, 52); assert.equal(filas[0].numero, 1667); assert.equal(filas.at(-1).numero, 1616);
  assert.throws(() => entregasDelArchivo(htmlArchivo().replace('/zips/twic1660g.zip', 'https://malicioso.test/zips/twic1660g.zip'), hoy), /comprobar/);
  assert.equal(claveNombreTwic('García, José'), claveNombreTwic('Jose Garcia'));
});
test('TWIC descomprime PGN y rechaza ZIP truncado o tamaños manipulados', async () => {
  const zip = zipDe(pgn());
  assert.equal(await pgnDelZip(zip), pgn());
  await assert.rejects(pgnDelZip(zip.subarray(0, zip.length - 30)), /ZIP/);
  const alterado = Buffer.from(zip), c = alterado.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  alterado.writeUInt32LE(100 * 1024 * 1024, c + 24);
  await assert.rejects(pgnDelZip(alterado), /no admitido/);
});
test('La consulta usa el ID y ambos colores, excluye homónimos y permite nombres sin ID', async () => {
  const db = base();
  await entrega(db, 1667, [pgn(), pgn(1).replace('[WhiteFideId "2016192"]', '[WhiteFideId "555"]'),
    pgn(2).replace('[WhiteFideId "2016192"]\n', ''),
    pgn(3).replaceAll('Nakamura, Hikaru', 'Desconocido').replaceAll('2016192', '888').replace('[BlackFideId "9999"]', '[BlackFideId "2016192"]')].join('\n\n'));
  const r = await consultarTwic({ TWIC_DB: db }, consulta(), hoy);
  assert.equal(r.partidas.length, 3);
  assert.ok(!r.partidas.some(p => p.pgn.includes('[WhiteFideId "555"]')));
  assert.equal((await consultarTwic({ TWIC_DB: db }, consulta({ name: '', fideId: '2016192' }), hoy)).partidas.length, 2);
  assert.equal((await consultarTwic({ TWIC_DB: db }, consulta({ name: 'Otro, Nombre', fideId: '' }), hoy)).partidas.length, 0);
  assert.ok(db.consultas.some(s => s.includes('UNION')));
});
test('Una entrega a medias no se publica; reintentar no añade copias', async () => {
  const db = base(); await entrega(db);
  db.sqlite.prepare("UPDATE twic_entregas SET estado = 'pendiente', lease = 'otra'").run();
  assert.equal((await consultarTwic({ TWIC_DB: db }, consulta(), hoy)).partidas.length, 0);
  await guardarEntrega(db, { numero: 1667 }, pgn(), 'otra', hoy);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM twic_partidas').get().n, 1);
  assert.equal((await consultarTwic({ TWIC_DB: db }, consulta(), hoy)).partidas.length, 1);
});
test('La paginación no pierde partidas ni devuelve entregas anteriores al año', async () => {
  const db = base(); await entrega(db, 1667, Array.from({ length: 105 }, (_, n) => pgn(n)).join('\n\n'));
  await entrega(db, 1600, pgn(999), '2025-01-01');
  const primero = await consultarTwic({ TWIC_DB: db }, consulta(), hoy);
  assert.equal(primero.partidas.length, 100); assert.ok(primero.siguiente);
  const segundo = await consultarTwic({ TWIC_DB: db }, consulta({ cursor: primero.siguiente }), hoy);
  assert.equal(segundo.partidas.length, 5); assert.equal(segundo.siguiente, null);
  assert.equal(new Set([...primero.partidas, ...segundo.partidas].map(p => p.pgn)).size, 105);
});
test('Al agotar la cuota se corta antes de buscar partidas; sin configurar no bloquea otras fuentes', async () => {
  const db = base();
  db.sqlite.prepare('INSERT INTO twic_cuota VALUES (?,?)').run('2026-10-22', MAX_CONSULTAS_DIA);
  assert.equal((await consultarTwic({ TWIC_DB: db }, consulta(), hoy)).estado, 'limite');
  assert.ok(!db.consultas.some(s => s.includes('FROM twic_partidas')));
  assert.equal((await consultarTwic({}, consulta(), hoy)).estado, 'sin_configurar');
  assert.equal((await consultarTwic({ TWIC_DB: db }, consulta({ cursor: '1;DROP TABLE' }), hoy)).estado, 'error');
});
test('La actualización prepara una entrega por turno, reutiliza las listas y borra solo el índice antiguo', async () => {
  const db = base(), original = globalThis.fetch, urls = [];
  await entrega(db, 1500, pgn(), '2024-01-01');
  globalThis.fetch = async url => { urls.push(String(url)); return new Response(String(url).endsWith('/twic') ? htmlArchivo() : zipDe(pgn())); };
  try {
    assert.equal((await sincronizarTwic({ TWIC_DB: db }, hoy)).entrega, 1667);
    assert.equal((await sincronizarTwic({ TWIC_DB: db }, hoy)).entrega, 1666);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM twic_entregas WHERE estado = 'lista'").get().n, 2);
    assert.equal(db.sqlite.prepare('SELECT count(*) n FROM twic_partidas WHERE entrega=1500').get().n, 0);
    const r = await consultarTwic({ TWIC_DB: db }, consulta(), hoy);
    assert.equal(r.estado, 'parcial'); assert.equal(r.revisadas, 2); assert.equal(r.entregas, 52);
    assert.equal(urls.filter(u => u.endsWith('.zip')).length, 2);
  } finally { globalThis.fetch = original; }
});
test('Un fallo de TWIC no se convierte en una entrega vacía ni borra la anterior', async () => {
  const db = base(), original = globalThis.fetch;
  await entrega(db);
  globalThis.fetch = async url => new Response(String(url).endsWith('/twic') ? htmlArchivo() : 'Fallo', { status: String(url).endsWith('/twic') ? 200 : 503 });
  try {
    await assert.rejects(sincronizarTwic({ TWIC_DB: db }, hoy), /503/);
    const r = await consultarTwic({ TWIC_DB: db }, consulta(), hoy);
    assert.equal(r.partidas.length, 1); assert.equal(r.errores, 1); assert.equal(r.estado, 'parcial');
  } finally { globalThis.fetch = original; }
});
test('La ruta pública nunca actualiza ni descarga entregas; el actualizador de prueba no se expone', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('No debe descargar'); };
  try {
    const r = await worker.fetch(new Request('https://chessrival.test/api/twic/jugador?fideId=2016192'), {});
    assert.equal((await r.json()).estado, 'sin_configurar');
    const intento = await worker.fetch(new Request('https://chessrival.test/__twic/actualizar', { method: 'POST' }), { TWIC_LOCAL: '1' });
    assert.equal(intento.status, 404);
  } finally { globalThis.fetch = original; }
});
test('Al importar la misma partida desde PGN y TWIC se unen las fuentes sin duplicarla', async () => {
  const jugador = 'fide:2016192', partida = leerPgn(pgn())[0];
  const item = { partida, color: 'B', eco: 'C20', apertura: 'Prueba', ritmo: 0 };
  assert.equal((await guardarPartidas(jugador, [item], 'PGN')).nuevas, 1);
  assert.equal((await guardarPartidas(jugador, [item], 'TWIC')).repetidas, 1);
  const guardadas = await listarPartidas(jugador);
  assert.equal(guardadas.length, 1); assert.equal(guardadas[0].origen, 'PGN;TWIC');
});

test('El navegador pagina, vuelve a comprobar el jugador y respeta la cancelación', async () => {
  const anterior = globalThis.location, original = globalThis.fetch;
  globalThis.location = { hostname: 'localhost' };
  const { buscarTwic } = await import('../../js/twic.js');
  let llamadas = 0;
  globalThis.fetch = async url => {
    llamadas++;
    const u = new URL(url); assert.equal(u.pathname, '/api/twic/jugador');
    assert.equal(u.searchParams.get('fideId'), '2016192');
    assert.equal(u.searchParams.get('cursor'), llamadas === 1 ? null : '1667:99');
    return Response.json({ estado: 'listo', revisadas: 52, entregas: 52,
      partidas: [{ entrega: 1667, pgn: llamadas === 1 ? pgn() : pgn(2) },
        { entrega: 1667, pgn: pgn(3).replaceAll('2016192', '555') }],
      siguiente: llamadas === 1 ? '1667:99' : null });
  };
  try {
    const r = await buscarTwic({ name: 'Nakamura, Hikaru', fideId: '2016192' });
    assert.equal(r.partidas.length, 2); assert.equal(r.limitada, false); assert.equal(llamadas, 2);
    const control = new AbortController(); control.abort();
    await assert.rejects(buscarTwic({ name: 'Nakamura, Hikaru' }, () => {}, control.signal), { name: 'AbortError' });
    assert.equal(llamadas, 2);
    globalThis.fetch = async () => Response.json({ estado: 'limite' }, { status: 429 });
    await assert.rejects(buscarTwic({ name: 'Nakamura, Hikaru' }), /límite diario/);
    globalThis.fetch = async () => Response.json({ estado: 'sin_configurar', partidas: [] });
    assert.equal((await buscarTwic({ name: 'Nakamura, Hikaru' })).estado, 'sin_configurar');
  } finally {
    globalThis.fetch = original;
    if (anterior === undefined) delete globalThis.location; else globalThis.location = anterior;
  }
});

test('Las abreviaturas de ambos jugadores no duplican una partida identificada por FIDE', async () => {
  const jugador = 'fide:2016193', original = leerPgn(pgn(20))[0];
  const abreviada = leerPgn(pgn(20).replace('Nakamura, Hikaru', 'Nakamura,Hi').replace('Rival, Otro', 'Rival,O').replace('Prueba 20', 'Otro evento'))[0];
  const item = partida => ({ partida, color: 'B', eco: 'C20', apertura: '', ritmo: 0 });
  await guardarPartidas(jugador, [item(original)], 'PGN');
  assert.equal((await guardarPartidas(jugador, [item(abreviada)], 'TWIC')).repetidas, 1);
  assert.equal((await listarPartidas(jugador)).length, 1);
});
test('Mismo nombre y jugadas con IDs rivales contradictorios no son el mismo encuentro', async () => {
  const jugador = 'fide:2016194', original = leerPgn(pgn(21))[0];
  const otra = leerPgn(pgn(21).replace('[BlackFideId "9999"]', '[BlackFideId "9998"]'))[0];
  const item = partida => ({ partida, color: 'B', eco: 'C20', apertura: '', ritmo: 0 });
  await guardarPartidas(jugador, [item(original)], 'PGN');
  assert.equal((await guardarPartidas(jugador, [item(otra)], 'TWIC')).nuevas, 1);
  assert.equal((await listarPartidas(jugador)).length, 2);
});

test('Una reserva activa impide repetir la descarga y no se anuncia un histórico completo', async () => {
  const db = base(), original = globalThis.fetch;
  db.sqlite.prepare("INSERT INTO twic_entregas(numero,fecha,lease,lease_hasta) VALUES (1667,'2026-10-19','otro',?)").run(hoy.getTime() + 60000);
  let descargas = 0;
  globalThis.fetch = async url => { descargas++; assert.ok(String(url).endsWith('/twic')); return new Response(htmlArchivo()); };
  try {
    const r = await sincronizarTwic({ TWIC_DB: db }, hoy);
    assert.equal(r.estado, 'esperando'); assert.equal(r.pendientes, 52); assert.equal(descargas, 1);
  } finally { globalThis.fetch = original; }
});
