import test from 'node:test';
import assert from 'node:assert/strict';
import { open, stat } from 'node:fs/promises';
import { LibroCtg, firmaDe } from '../../js/libro-ctg.js';

const INICIAL = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

test('La firma de una posición no cambia con los contadores de jugadas y distingue posiciones y enroques', () => {
  const a = firmaDe(INICIAL);
  assert.deepEqual([...firmaDe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 5 9')], [...a]);
  assert.notDeepEqual([...firmaDe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1')], [...a]);
  assert.notDeepEqual([...firmaDe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')], [...a]);
  // La posición inicial es simétrica: con las negras al turno el libro la «gira» y la firma es la misma que con las blancas.
  assert.deepEqual([...firmaDe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1')], [...a]);
  assert.equal(a[0] & 0x1f, a.length);                     // el primer byte guarda la longitud de la firma
});

test('Un libro incompleto o con un .ctb inválido se rechaza con un mensaje claro', async () => {
  await assert.rejects(LibroCtg.abrir({ ctg: {}, ctb: null, cto: {} }), /incompleto/);
  const falso = { getFile: async () => ({ arrayBuffer: async () => new ArrayBuffer(4), size: 4, slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) }) };
  await assert.rejects(LibroCtg.abrir({ ctg: falso, ctb: falso, cto: falso }), /no es válido/);
});

// Con un libro real (el Power Book de ChessBase) se comprueba que lee posiciones y estadísticas; si no está en este equipo, se omite.
const RUTA = process.env.CHESSRIVAL_LIBRO ?? 'D:/Datos/Ajedrez/5.Fritz PowerBook 2025/PowerBook2025';
const hayLibro = await stat(`${RUTA}.ctg`).then(() => true, () => false);

test('Lee un libro CTG real: la posición inicial, jugadas con estadísticas y las negras al turno', { skip: !hayLibro && 'no hay libro CTG en este equipo' }, async () => {
  const handle = (ext) => ({
    name: `libro.${ext}`,
    getFile: async () => {
      const ruta = `${RUTA}.${ext}`, tam = (await stat(ruta)).size;
      return { size: tam, slice: (a, b) => ({ arrayBuffer: async () => { const f = await open(ruta); try { const buf = Buffer.alloc(b - a); const { bytesRead } = await f.read(buf, 0, b - a, a); return buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead); } finally { await f.close(); } } }),
        arrayBuffer: function () { return this.slice(0, tam).arrayBuffer(); } };
    }
  });
  const libro = await LibroCtg.abrir({ ctg: handle('ctg'), ctb: handle('ctb'), cto: handle('cto') });
  const inicio = await libro.consultar(INICIAL, true);
  assert.ok(inicio.totalPartidas > 100000);
  assert.ok(inicio.victoriasBlancas + inicio.tablas + inicio.victoriasNegras <= inicio.totalPartidas + 1);
  const e4 = inicio.jugadas.find(j => j.san === 'e4');
  assert.equal(e4.uci, 'e2e4'); assert.ok(e4.partidas > 1000); assert.ok(e4.puntosQuienJuega > 50 && e4.puntosQuienJuega < 60);
  const tras = await libro.consultar('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
  assert.ok(tras.jugadas.some(j => j.san === 'c5') && tras.jugadas.some(j => j.san === 'e5'));       // negras al turno: las jugadas salen bien giradas
  assert.equal(await libro.consultar('8/8/8/4k3/8/8/4K3/8 w - - 0 1'), null);                         // una posición que no es de apertura no está
});
