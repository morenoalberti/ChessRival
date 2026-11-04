import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { fechaLumbra, periodoLumbra, partidasLumbra, guardarLumbraLote, consultarLumbra } from '../src/lumbra.js';
import worker from '../src/index.js';

const now = new Date('2026-10-22T12:00:00Z');
const schema = await readFile(new URL('../migrations-lumbra/0001_lumbra.sql', import.meta.url), 'utf8');
const pgn = (id, whiteId = '2016192', date = '2026.10.15', black = 'Rival, Otro') =>
  `[Event "Lumbra test ${id}"]\n[Site "Test"]\n[Date "${date}"]\n[White "Nakamura, Hikaru"]\n[Black "${black}"]\n[WhiteFideId "${whiteId}"]\n[BlackFideId "9999"]\n[Result "1-0"]\n[DeduplicatorId "${id}"]\n[Source "TestSource"]\n[SourceQuality "3"]\n[IdentityEvidenceWhite "Confirmed"]\n1. e4 e5 1-0`;

function base() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(schema);
  const db = { sqlite, prepare(sql) {
    const statement = sqlite.prepare(sql); let values = [];
    return { bind(...args) { values = args; return this; },
      async all() { return { results: statement.all(...values) }; },
      async first() { return statement.get(...values) ?? null; },
      async run() { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; } };
  }, async batch(statements) {
    sqlite.exec('BEGIN'); try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  return db;
}
const params = extra => new URLSearchParams({ name: 'Nakamura, Hikaru', fideId: '2016192', ...extra });

test('Lumbra respeta el intervalo móvil de doce meses y fechas PGN reales', () => {
  assert.deepEqual(periodoLumbra(now), { desde: '2025-10-22', hasta: '2026-10-22' });
  assert.deepEqual(periodoLumbra(new Date('2024-02-29T00:00:00Z')), { desde: '2023-02-28', hasta: '2024-02-29' });
  assert.equal(fechaLumbra('2026.10.21'), '2026-10-21');
  assert.equal(fechaLumbra('2026.02.30'), '');
  assert.equal(fechaLumbra('2026.??.??'), '');
});

test('Lumbra conserva IDs, calidad e identidad y omite partidas fuera del año', () => {
  const rows = partidasLumbra(`${pgn('a')}\n\n${pgn('b', '2016192', '2025.10.21')}\n\n${pgn('c', '2016192', '2025.10.22')}`, '2025-10-22', '2026-10-22');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'a');
  assert.equal(rows[0].whiteId, '2016192');
  assert.equal(rows[0].source, 'TestSource');
  assert.equal(rows[0].quality, '3');
  assert.equal(rows[0].identityWhite, 'Confirmed');
});

test('La carga local usa DeduplicatorId y una consulta solo devuelve el jugador exacto en ambos colores', async () => {
  const db = base();
  const games = partidasLumbra(`${pgn('a')}\n\n${pgn('b', '', '2026.10.14')}\n\n${pgn('c', '2016192', '2025.10.21')}`, '2025-10-22', '2026-10-22');
  await guardarLumbraLote(db, games);
  await guardarLumbraLote(db, games);
  await db.prepare("INSERT INTO lumbra_meta(key,value) VALUES ('version','2026-10-11'),('completa','1')").run();
  const result = await consultarLumbra({ LUMBRA_DB: db }, params(), now);
  assert.equal(result.estado, 'listo');
  assert.equal(result.version, '2026-10-11');
  assert.equal(result.completa, true);
  assert.equal(result.juegosIndexados, 2);
  assert.equal(result.ultimaPartida, '2026-10-15');
  assert.deepEqual(result.partidas.map(g => g.pgn.match(/\[DeduplicatorId "(.*?)"\]/)?.[1]).sort(), ['a', 'b']);
});

test('La consulta por nombre permite PGN sin ID, pero no acepta un ID contradictorio', async () => {
  const db = base();
  await guardarLumbraLote(db, partidasLumbra(`${pgn('a', '')}\n\n${pgn('b', '5555')}`, '2025-10-22', '2026-10-22'));
  await db.prepare("INSERT INTO lumbra_meta(key,value) VALUES ('version','2026-10-11'),('completa','1')").run();
  const result = await consultarLumbra({ LUMBRA_DB: db }, params(), now);
  assert.deepEqual(result.partidas.map(g => g.pgn.match(/\[DeduplicatorId "(.*?)"\]/)?.[1]), ['a']);
});

test('El endpoint de carga privada no se expone en la configuración pública', async () => {
  const response = await worker.fetch(new Request('http://127.0.0.1/__lumbra/lote', { method: 'POST', body: '{}' }), {}, {});
  assert.equal(response.status, 405);
});

test('La preparación y finalización privadas marcan el índice completo y permiten reemplazarlo', async () => {
  const db = base();
  await guardarLumbraLote(db, partidasLumbra(pgn('a'), '2025-10-22', '2026-10-22'));
  const env = { TWIC_LOCAL: '1', LUMBRA_DB: db };
  let response = await worker.fetch(new Request('http://127.0.0.1/__lumbra/finalizar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: '2026-10-11' })
  }), env, {});
  assert.equal(response.status, 200);
  response = await worker.fetch(new Request('http://127.0.0.1/__lumbra/estado'), env, {});
  assert.equal((await response.json()).completa, true);
  response = await worker.fetch(new Request('http://127.0.0.1/__lumbra/iniciar', { method: 'POST' }), env, {});
  assert.equal(response.status, 200);
  response = await worker.fetch(new Request('http://127.0.0.1/__lumbra/estado'), env, {});
  assert.deepEqual(await response.json(), { partidas: 0, desde: null, hasta: null, version: '', completa: false });
});
