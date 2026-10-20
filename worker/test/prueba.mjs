import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import worker, { datosDePerfil } from '../src/index.js';
import * as db from '../../js/db.js';
import * as partidasDb from '../../js/db-partidas.js';
import { analizarPartida, VERSION_ANALISIS } from '../../js/analizador.js';
import { calcular } from '../../js/debilidades.js';
import { Chess } from '../../js/vendor/chess.js';
import { calcularVentanaVisor, abrirVentanaVisor } from '../../js/ventana-visor.js';
import { posicionesDeVariante } from '../../js/variantes-motor.js';
import * as copias from '../../js/copias.js';
import { leerDestinoCopias, nombreDestinoCopias, elegirDestinoCopias, guardarArchivoCopia } from '../../js/copias-destino.js';
import { posicionFichaFide, htmlFichaFide } from '../../js/ficha-fide-datos.js';

const almacenes = ['torneos', 'tarjetas', 'partidas', 'analisis', 'ediciones', 'ajustes'];
async function limpiar() {
  await db.tx(almacenes, 'readwrite', (...stores) => Promise.all(stores.map(s => db.prom(s.clear()))));
}
async function filas(nombre) { return db.tx(nombre, 'readonly', s => db.prom(s.getAll())); }

function motorSimulado(valor = 900) {
  const consultas = [];
  return {
    nombre: 'Motor de prueba', consultas,
    nuevaPartida: async () => {},
    analizar: async (fen) => { consultas.push(fen); return { valor, mejorJugada: 'c7b7' }; }
  };
}
function partidaDesde(fen, jugada, colorJugador = 'B') {
  return { id: 1, colorJugador, pgn: `[Event "Prueba"]\n[FEN "${fen}"]\n[Result "*"]\n\n${colorJugador === 'B' ? '1.' : '1...'} ${jugada} *` };
}

for (const [color, fen, ahogado, mate] of [
  ['B', 'k7/2Q5/2K5/8/8/8/8/8 w - - 0 1', 'Qb6', 'Qb7#'],
  ['N', '8/8/8/8/8/2k5/2q5/K7 b - - 0 1', 'Qb3', 'Qb2#']
]) {
  await test(`El ahogado vale cero y cuenta la ventaja perdida (${color})`, async () => {
    const tablero = new Chess(fen); tablero.move(ahogado);
    assert.equal(tablero.isStalemate(), true);
    const motor = motorSimulado();
    const resultado = await analizarPartida(motor, partidaDesde(fen, ahogado, color), 12);
    assert.equal(resultado.jugadas[0].evalDespues, 0);
    assert.equal(resultado.jugadas[0].perdida, 900);
    assert.equal(resultado.version, VERSION_ANALISIS);
    assert.equal(motor.consultas.length, 1);
  });
  await test(`Dar mate conserva la evaluación ganadora (${color})`, async () => {
    const resultado = await analizarPartida(motorSimulado(), partidaDesde(fen, mate, color), 12);
    assert.equal(resultado.jugadas[0].evalDespues, 1000);
    assert.equal(resultado.jugadas[0].perdida, 0);
  });
}

await test('Las tablas por material insuficiente también valen cero', async () => {
  const resultado = await analizarPartida(motorSimulado(500), partidaDesde('7k/8/8/8/8/2b5/1B6/K7 w - - 0 1', 'Bxc3'), 12);
  assert.equal(resultado.jugadas[0].evalDespues, 0);
  assert.equal(resultado.jugadas[0].perdida, 500);
});

await test('Una jugada PGN inválida no desplaza la posición final válida', async () => {
  const resultado = await analizarPartida(motorSimulado(), partidaDesde('k7/2Q5/2K5/8/8/8/8/8 w - - 0 1', 'Qb6 jugadaInvalida'), 12);
  assert.equal(resultado.jugadas.length, 1);
  assert.equal(resultado.jugadas[0].evalDespues, 0);
});

function muestra(blancas, negras) {
  const partidas = [
    { id: 1, colorJugador: 'B', puntos: 1, aperturaEtiqueta: 'e4' },
    { id: 2, colorJugador: 'N', puntos: 1, aperturaEtiqueta: 'e4' }
  ];
  const jugadas = (n, partidaId, perdida) => Array.from({ length: n }, () => ({
    partidaId, perdida, fase: 'medio juego', evalAntes: 30, evalDespues: 30 - perdida, mejor: 'e2e4'
  }));
  return calcular(partidas, [...jugadas(blancas, 1, 20), ...jugadas(negras, 2, 0)]);
}
for (const [b, n] of [[60, 0], [0, 60], [60, 1], [29, 31]]) {
  await test(`No compara colores con muestra insuficiente (${b} blancas, ${n} negras)`, () => {
    const resultado = muestra(b, n);
    assert.equal(resultado.debilidades.some(d => d.titulo.startsWith('Juega peor con')), false);
    if (!b) assert.equal(resultado.perdidaBlancas, null);
    if (!n) assert.equal(resultado.perdidaNegras, null);
  });
}
await test('Treinta jugadas de una sola partida por color no bastan para comparar', () => {
  assert.equal(muestra(30, 30).debilidades.some(d => d.titulo.startsWith('Juega peor con')), false);
});

async function sembrar() {
  await limpiar();
  const jugador = { name: 'Jugador compartido', fideId: '123', federation: 'ESP', rating: 2000 };
  const primero = await db.guardarTorneo({ nombre: 'Torneo A', url: 'a', clave: 'a', jugadores: [jugador] });
  const segundo = await db.guardarTorneo({ nombre: 'Torneo B', url: 'b', clave: 'b', jugadores: [jugador] });
  const clave = db.claveJugador(jugador);
  await db.tx(['partidas', 'analisis', 'ediciones'], 'readwrite', async (p, a, e) => {
    await db.prom(p.put({ id: 1, jugadorClave: clave, pgn: '[Event "Prueba"]\n\n1. e4 *' }));
    await db.prom(a.put({ partidaId: 1, jugadorClave: clave, version: VERSION_ANALISIS, jugadas: [], motor: 'Prueba', profundidad: 12, analizada: 1 }));
    await db.prom(e.put({ partidaId: 1, principal: null, variantes: [], notas: [{ ruta: 'e2e4', simbolos: '!' }] }));
  });
  return { primero, segundo, clave };
}
async function comprobarDatos(cantidad) {
  for (const nombre of ['partidas', 'analisis', 'ediciones']) assert.equal((await filas(nombre)).length, cantidad, nombre);
}

await test('Quitar una tarjeta conserva la otra y todos sus datos compartidos', async () => {
  const { primero, segundo } = await sembrar();
  const [tarjeta] = await db.cargarPantalla(primero);
  const [otra] = await db.cargarPantalla(segundo);
  await db.quitarTarjeta(tarjeta.id);
  assert.equal((await db.cargarPantalla(primero)).length, 0);
  assert.deepEqual(await db.obtenerTarjeta(otra.id), otra);
  await comprobarDatos(1);
  await db.quitarTarjeta(otra.id);
  await comprobarDatos(0);
});

await test('Cerrar un torneo conserva al jugador en otro; el último cierre limpia sus datos', async () => {
  const { primero, segundo } = await sembrar();
  await db.cerrarTorneo(primero);
  assert.equal((await db.cargarPantalla(segundo)).length, 1);
  assert.equal((await filas('torneos')).some(t => t.id === primero), false);
  await comprobarDatos(1);
  await db.cerrarTorneo(segundo);
  await comprobarDatos(0);
});

await test('Cerrar un torneo borra solo los datos de jugadores que se quedan sin tarjeta', async () => {
  const { primero } = await sembrar();
  await db.anadirJugador({ name: 'Jugador exclusivo', fideId: '456' }, primero);
  await db.tx(['partidas', 'analisis', 'ediciones'], 'readwrite', async (p, a, e) => {
    await db.prom(p.put({ id: 2, jugadorClave: 'f:456' }));
    await db.prom(a.put({ partidaId: 2, jugadorClave: 'f:456' }));
    await db.prom(e.put({ partidaId: 2, notas: [] }));
  });
  await db.cerrarTorneo(primero);
  await comprobarDatos(1);
  assert.equal((await filas('partidas'))[0].jugadorClave, 'f:123');
});

await test('Mover un jugador a una pestaña que ya lo contiene mantiene las partidas', async () => {
  const { primero, segundo } = await sembrar();
  const [tarjeta] = await db.cargarPantalla(primero);
  await db.moverJugador(tarjeta, segundo);
  assert.equal((await db.cargarPantalla(primero)).length, 0);
  assert.equal((await db.cargarPantalla(segundo)).length, 1);
  await comprobarDatos(1);
});

await test('Un error durante una transacción revierte también sus escrituras previas', async () => {
  await limpiar();
  await assert.rejects(db.tx('ajustes', 'readwrite', async a => {
    await db.prom(a.put({ clave: 'prueba', valor: 'no debe guardarse' }));
    throw new Error('Fallo simulado');
  }), /Fallo simulado/);
  assert.equal(await db.leerAjuste('prueba'), null);
});

await test('Los análisis antiguos quedan pendientes de recalcular sin borrar las partidas', async () => {
  const { clave } = await sembrar();
  await db.tx('analisis', 'readwrite', a => db.prom(a.put({ partidaId: 1, jugadorClave: clave, jugadas: [], analizada: 1 })));
  assert.deepEqual(await partidasDb.leerJugadasAnalizadas(clave), []);
  assert.equal(await partidasDb.ultimoAnalisis(clave), null);
  assert.equal((await partidasDb.partidasAnalizadas(clave)).size, 0);
  assert.equal((await filas('partidas')).length, 1);
  await partidasDb.guardarAnalisis(clave, { partidaId: 1, version: VERSION_ANALISIS, jugadas: [], motor: 'Prueba', profundidad: 18 });
  assert.equal((await partidasDb.partidasAnalizadas(clave)).has(1), true);
  assert.deepEqual(await partidasDb.ultimoAnalisis(clave), { motor: 'Prueba', profundidad: 18 });
});

for (const [metodo, ruta, estado] of [['GET', '/', 200], ['GET', '/inexistente', 404], ['DELETE', '/', 405]]) {
  await test(`La API devuelve HTTP ${estado} para ${metodo} ${ruta}`, async () => {
    const respuesta = await worker.fetch(new Request(`https://chessrival.test${ruta}`, { method: metodo }), { ORIGENES_PERMITIDOS: '*' });
    assert.equal(respuesta.status, estado);
    assert.equal(respuesta.headers.has('status'), false);
    assert.match(respuesta.headers.get('content-type'), /application\/json/);
  });
}
await test('La API conserva el estado de error para una URL inválida', async () => {
  const respuesta = await worker.fetch(new Request('https://chessrival.test/api/torneo?url=invalida'), { ORIGENES_PERMITIDOS: '*' });
  assert.equal(respuesta.status, 400);
  assert.equal((await respuesta.json()).error, 'La URL no es válida.');
});

await test('El visor abre a 1160 × 917, centrado y alineado abajo sobre la barra de tareas', () => {
  assert.deepEqual(calcularVentanaVisor({ availWidth: 1920, availHeight: 1040, availLeft: 0, availTop: 0 }), {
    ancho: 1160, alto: 917, izquierda: 380, arriba: 123
  });
});

await test('El visor cabe completamente en una pantalla más pequeña', () => {
  assert.deepEqual(calcularVentanaVisor({ availWidth: 1024, availHeight: 728, availLeft: 0, availTop: 0 }), {
    ancho: 1024, alto: 728, izquierda: 0, arriba: 0
  });
});

await test('El visor respeta la posición de un monitor secundario', () => {
  assert.deepEqual(calcularVentanaVisor({ availWidth: 1920, availHeight: 1040, availLeft: -1920, availTop: 100 }), {
    ancho: 1160, alto: 917, izquierda: -1540, arriba: 223
  });
});

await test('La apertura reutiliza la partida y fija tamaño exterior y posición', () => {
  const llamadas = [];
  const ventana = {
    resizeTo: (...args) => llamadas.push(['tamano', ...args]),
    moveTo: (...args) => llamadas.push(['posicion', ...args]),
    focus: () => llamadas.push(['foco'])
  };
  const navegador = {
    screen: { availWidth: 1920, availHeight: 1040 },
    open: (...args) => { llamadas.push(['abrir', ...args]); return ventana; }
  };
  assert.equal(abrirVentanaVisor(720, navegador), ventana);
  assert.equal(llamadas[0][1], 'visor.html?id=720&ventana=1');
  assert.equal(llamadas[0][2], 'visor-ventana-720');
  assert.match(llamadas[0][3], /popup=yes,width=1160,height=917,left=380,top=123/);
  assert.deepEqual(llamadas.slice(1), [['tamano', 1160, 917], ['posicion', 380, 123], ['foco']]);
});

await test('Una ventana bloqueada se devuelve sin intentar moverla', () => {
  assert.equal(abrirVentanaVisor(720, { screen: {}, open: () => null }), null);
});

await test('La variante del motor conserva la posición acumulada de cada jugada', () => {
  const posiciones = posicionesDeVariante(new Chess().fen(), ['e2e4', 'e7e5', 'g1f3']);
  assert.deepEqual(posiciones.map(p => p.texto), ['1. e4', 'e5', '2. Nf3']);
  assert.equal(posiciones[2].fen, 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2');
  assert.deepEqual([posiciones[2].desde, posiciones[2].hasta], ['g1', 'f3']);
});

await test('La variante del motor respeta el color y número inicial del FEN', () => {
  const posiciones = posicionesDeVariante('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 17', ['e7e5', 'g1f3']);
  assert.deepEqual(posiciones.map(p => p.texto), ['17... e5', '18. Nf3']);
});

await test('La vista previa de enroques coloca también las torres', () => {
  const posiciones = posicionesDeVariante('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['e1g1', 'e8c8']);
  const tablero = new Chess(posiciones[1].fen);
  assert.equal(tablero.get('f1').type, 'r');
  assert.equal(tablero.get('d8').type, 'r');
  assert.equal(tablero.get('c8').type, 'k');
});

await test('La vista previa del motor aplica las promociones', () => {
  const [posicion] = posicionesDeVariante('7k/P7/8/8/8/8/8/7K w - - 0 1', ['a7a8q']);
  assert.match(posicion.texto, /a8=Q/);
  assert.equal(new Chess(posicion.fen).get('a8').type, 'q');
});

await test('Una variante ilegal se corta sin generar posiciones incorrectas', () => {
  const posiciones = posicionesDeVariante(new Chess().fen(), ['e2e4', 'e2e5', 'g1f3']);
  assert.equal(posiciones.length, 1);
  assert.equal(posiciones[0].hasta, 'e4');
});

await test('La vista previa se limita a las jugadas que se muestran', () => {
  assert.equal(posicionesDeVariante(new Chess().fen(), ['e2e4', 'e7e5', 'g1f3'], 2).length, 2);
  assert.deepEqual(posicionesDeVariante(new Chess().fen(), []), []);
});

await test('La copia conserva partidas, análisis y variantes sin claves ni permisos locales', async () => {
  await sembrar();
  await db.guardarAjuste('ia_clave_openai', 'secreto-de-prueba');
  await db.guardarAjuste('mega_handles', { permiso: 'solo-local' });
  await db.guardarAjuste('ficha_solo_lento', true);
  const datos = await copias.datosActuales();
  const paquete = await copias.empaquetarCopia(datos);
  assert.equal(JSON.stringify(paquete).includes('secreto-de-prueba'), false);
  assert.equal(JSON.stringify(paquete).includes('solo-local'), false);
  const c = await copias.validarCopia(JSON.parse(JSON.stringify(paquete)));
  assert.deepEqual(c.datos, datos);
  assert.deepEqual(c.resumen, { torneos: 2, jugadores: 1, tarjetas: 2, partidas: 1, analisis: 1, ediciones: 1 });
});

await test('Un archivo alterado se rechaza antes de tocar los datos', async () => {
  await sembrar();
  const paquete = await copias.empaquetarCopia(await copias.datosActuales());
  paquete.contenido = paquete.contenido.replace('Jugador compartido', 'Jugador alterado');
  const antes = await copias.datosActuales();
  await assert.rejects(copias.restaurarCopia(paquete), /dañado/);
  assert.deepEqual(await copias.datosActuales(), antes);
});

await test('La copia rechaza almacenes ausentes, claves duplicadas y referencias rotas', async () => {
  await sembrar();
  const datos = await copias.datosActuales();
  for (const modificar of [
    d => delete d.ediciones,
    d => d.tarjetas.push({ ...d.tarjetas[0] }),
    d => { d.tarjetas[0].torneoId = 999999; },
    d => { d.analisis[0].partidaId = 999999; },
    d => { d.ediciones[0].partidaId = 999999; },
    d => d.ajustes.push({ clave: 'ia_clave_openai', valor: 'no-importar' })
  ]) {
    const roto = structuredClone(datos); modificar(roto);
    await assert.rejects(copias.empaquetarCopia(roto), /incompletos/);
  }
  await assert.rejects(copias.validarCopia({ formato: 'RondaRival', version: 1 }), /ZIP/);
});

await test('Restaurar recupera las relaciones y guarda antes una copia del estado anterior', async () => {
  await sembrar();
  await db.guardarAjuste('ficha_solo_lento', true);
  const originales = await copias.datosActuales();
  const paquete = await copias.empaquetarCopia(originales);
  await db.guardarAjuste('ficha_solo_lento', false);
  await db.guardarAjuste('ia_clave_openai', 'clave-actual');
  await db.tx('ediciones', 'readwrite', s => db.prom(s.clear()));
  const anterior = await copias.datosActuales();
  const preventiva = await copias.restaurarCopia(paquete);
  assert.deepEqual(await copias.datosActuales(), originales);
  assert.deepEqual((await copias.validarCopia(preventiva.paquete)).datos, anterior);
  assert.equal(preventiva.tipo, 'antes-restaurar');
  assert.equal(await db.leerAjuste('ia_clave_openai'), 'clave-actual');
  const nueva = await db.tx('partidas', 'readwrite', s => db.prom(s.add({ jugadorClave: 'f:123', pgn: '1. d4 *' })));
  assert.ok(nueva > 1, 'Los identificadores futuros no pisan las partidas restauradas');
});

await test('Un fallo al restaurar revierte los borrados y escrituras de toda la base', async () => {
  await sembrar();
  const paquete = await copias.empaquetarCopia(await copias.datosActuales());
  await db.guardarAjuste('ficha_solo_lento', false);
  const antes = await copias.datosActuales();
  const putOriginal = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    if (this.name === 'analisis') throw new Error('Fallo de escritura simulado');
    return putOriginal.apply(this, args);
  };
  try { await assert.rejects(copias.restaurarCopia(paquete), /Fallo de escritura/); }
  finally { IDBObjectStore.prototype.put = putOriginal; }
  assert.deepEqual(await copias.datosActuales(), antes);
});

await test('El historial retiene 15 automáticas y conserva las manuales y preventivas', async () => {
  await sembrar();
  const datos = await copias.datosActuales();
  const manual = await copias.guardarEnHistorial(await copias.empaquetarCopia(datos));
  for (let i = 0; i < 17; i++) await copias.guardarEnHistorial(await copias.empaquetarCopia(datos, 'automatica'));
  const lista = await copias.listarCopias();
  assert.equal(lista.filter(c => c.tipo === 'automatica').length, 15);
  assert.ok(lista.some(c => c.id === manual.id));
  assert.ok(lista.some(c => c.tipo === 'antes-restaurar'));
});

await test('Borrar una copia conserva las demás y no modifica los datos actuales', async () => {
  await sembrar();
  const antes = await copias.datosActuales();
  const borrada = await copias.guardarEnHistorial(await copias.empaquetarCopia(antes));
  const conservada = await copias.guardarEnHistorial(await copias.empaquetarCopia(antes, 'antes-restaurar'));
  const idsAntes = (await copias.listarCopias()).map(c => c.id);
  await copias.borrarCopia(borrada.id);
  const idsDespues = (await copias.listarCopias()).map(c => c.id);
  assert.deepEqual(idsDespues, idsAntes.filter(id => id !== borrada.id));
  assert.ok(idsDespues.includes(conservada.id));
  assert.deepEqual(await copias.datosActuales(), antes);
});

await test('Elegir carpeta la recuerda y cancelar conserva el destino anterior', async () => {
  const anterior = await leerDestinoCopias();
  const carpeta = { kind: 'directory', name: 'Mis copias' };
  try {
    let opciones;
    await elegirDestinoCopias({ showDirectoryPicker: async o => { opciones = o; return carpeta; } });
    assert.deepEqual(await leerDestinoCopias(), carpeta);
    assert.equal(opciones.mode, 'readwrite');
    assert.equal(nombreDestinoCopias(carpeta), 'Mis copias');
    assert.equal(nombreDestinoCopias(null), 'Descargas del navegador');
    assert.equal(await elegirDestinoCopias({ showDirectoryPicker: async () => { throw new DOMException('Cancelado', 'AbortError'); } }), undefined);
    assert.deepEqual(await leerDestinoCopias(), carpeta);
  } finally { await copias.guardarOpcionCopias('carpeta_destino', anterior); }
});

await test('La copia se escribe completa en la carpeta elegida sin sobrescribir archivos', async () => {
  const paquete = await copias.empaquetarCopia(await copias.datosActuales());
  const fila = { paquete, fecha: new Date().toISOString(), tipo: 'manual' };
  const existentes = new Set([copias.nombreCopia(fila)]);
  let contenido, cerrada = false, creada;
  const carpeta = {
    queryPermission: async () => 'granted',
    getFileHandle: async (nombre, opciones) => {
      if (!opciones?.create) {
        if (existentes.has(nombre)) return {};
        throw new DOMException('No existe', 'NotFoundError');
      }
      creada = nombre;
      return { createWritable: async () => ({ write: async blob => { contenido = await blob.text(); }, close: async () => { cerrada = true; }, abort: async () => {} }) };
    }
  };
  const guardada = await guardarArchivoCopia(fila, carpeta);
  assert.equal(guardada.descarga, false);
  assert.match(creada, / \(2\)\.json$/);
  assert.deepEqual(JSON.parse(contenido), paquete);
  assert.equal(cerrada, true);
});

await test('El destino local conserva la ruta completa y guarda mediante el servidor', async () => {
  const anterior = await leerDestinoCopias();
  const destino = { local: true, ruta: 'C:\\Mis copias\\Ajedrez', name: 'Ajedrez' };
  const peticiones = [];
  const navegador = { location: { hostname: 'localhost' }, fetch: async (url, opciones = {}) => {
    peticiones.push({ url, opciones });
    return { ok: true, status: 200, json: async () => url.endsWith('/guardar') ? { nombre: 'copia.json', descarga: false } : destino };
  } };
  try {
    assert.deepEqual(await elegirDestinoCopias(navegador), destino);
    assert.equal(nombreDestinoCopias(await leerDestinoCopias(navegador)), destino.ruta);
    const fila = { paquete: { formato: 'ChessRival-web' }, fecha: new Date().toISOString(), tipo: 'manual' };
    assert.equal((await guardarArchivoCopia(fila, destino, navegador)).descarga, false);
    const guardado = peticiones.find(p => p.url.endsWith('/guardar'));
    assert.equal(guardado.opciones.headers['X-ChessRival'], '1');
    assert.equal(JSON.parse(guardado.opciones.body).ruta, destino.ruta);
    navegador.fetch = async () => ({ ok: true, json: async () => ({ cancelado: true }) });
    assert.equal(await elegirDestinoCopias(navegador), undefined);
    assert.deepEqual(await leerDestinoCopias(), destino);
    navegador.fetch = async () => ({ ok: false, status: 404 });
    await assert.rejects(elegirDestinoCopias(navegador), /Reinicia ChessRival/);
  } finally { await copias.guardarOpcionCopias('carpeta_destino', anterior); }
});

await test('Si se deniega el permiso no se crea ningún archivo ni se inicia una descarga', async () => {
  let escrituras = 0;
  const carpeta = { queryPermission: async () => 'prompt', requestPermission: async () => 'denied', getFileHandle: async () => { escrituras++; } };
  await assert.rejects(guardarArchivoCopia({}, carpeta), /Autoriza el acceso/);
  assert.equal(escrituras, 0);
});

await test('Un fallo al escribir cancela el archivo sin confirmar una copia incompleta', async () => {
  let cancelada = false, cerrada = false;
  const carpeta = {
    queryPermission: async () => 'granted',
    getFileHandle: async (_, o) => {
      if (!o?.create) throw new DOMException('No existe', 'NotFoundError');
      return { createWritable: async () => ({ write: async () => { throw new Error('Disco lleno'); }, close: async () => { cerrada = true; }, abort: async () => { cancelada = true; } }) };
    }
  };
  await assert.rejects(guardarArchivoCopia({ fecha: new Date().toISOString(), tipo: 'manual', paquete: {} }, carpeta), /Disco lleno/);
  assert.equal(cancelada, true);
  assert.equal(cerrada, false);
});

const perfilFidePrueba = `<h1 class="player-title">Jugador de prueba</h1>
  <h5>FIDE title</h5><div class="profile-info-title "><p>International Master</p></div>
  <div class="profile-info-country "><img src="/images/flags/es.svg">Spain</div>
  <p class="profile-info-byear ">1990</p><p class="profile-info-sex ">Male</p>
  <div class="profile-standart profile-game"><p>2400</p></div><div class="profile-rapid profile-game"><p>2300</p></div><div class="profile-blitz profile-game"><p>2200</p></div>
  <div class="profile-rank-block"><h5>World Rank</h5><div class="profile-rank-row"><h6>All players</h6><p>100</p></div><div class="profile-rank-row"><h6>Active players</h6><p>80</p></div></div>`;
await test('La ficha FIDE extrae perfil, ratings y rankings por sus etiquetas', () => {
  const p = datosDePerfil(perfilFidePrueba);
  assert.equal(p.nombre, 'Jugador de prueba');
  assert.equal(p.nacimiento, 1990);
  assert.equal(p.genero, 'Hombre');
  assert.equal(p.titulo, 'IM');
  assert.equal(p.paisCodigo, 'ES');
  assert.deepEqual(p.elos, { standard: '2400', rapid: '2300', blitz: '2200' });
  assert.deepEqual(p.clasificaciones, [{ nombre: 'World Rank', activos: '80', todos: '100' }]);
});
await test('Una ficha FIDE incompleta no inventa datos personales ni rankings', () => {
  const p = datosDePerfil('<h1 class="player-title">Sin estadísticas</h1>');
  assert.equal(p.nacimiento, null);
  assert.equal(p.genero, '');
  assert.deepEqual(p.elos, { standard: '', rapid: '', blitz: '' });
  assert.deepEqual(p.clasificaciones, []);
});
await test('El endpoint de estadísticas incluye los datos de perfil junto a las barras', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => String(url).includes('a_data_stats.php')
    ? new Response(JSON.stringify([{ white_total: 10, white_win_num: 4, white_draw_num: 3, black_total: 8, black_win_num: 2, black_draw_num: 4 }]))
    : new Response(perfilFidePrueba, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  try {
    const r = await worker.fetch(new Request('https://chessrival.test/api/fide/estadisticas?id=123'), { ORIGENES_PERMITIDOS: '*' });
    assert.equal(r.status, 200);
    const p = await r.json();
    assert.equal(p.nombre, 'Jugador de prueba');
    assert.equal(p.bloques[0].blancas.derrotas, 3);
    assert.equal(p.bloques[0].negras.derrotas, 2);
    assert.equal(p.clasificaciones[0].activos, '80');
  } finally { globalThis.fetch = original; }
});
await test('La ficha emergente se coloca junto a la tarjeta sin salirse de la pantalla', () => {
  assert.deepEqual(posicionFichaFide({ left: 20, right: 400, top: 100 }, 430, 660, { ancho: 1280, alto: 900 }), { x: 408, y: 100 });
  assert.deepEqual(posicionFichaFide({ left: 900, right: 1230, top: 300 }, 430, 660, { ancho: 1280, alto: 900 }), { x: 462, y: 230 });
  assert.deepEqual(posicionFichaFide({ left: 0, right: 300, top: 480 }, 300, 480, { ancho: 320, alto: 500 }), { x: 10, y: 10 });
});
await test('La ficha emergente muestra datos como texto y no permite arrastrar estadísticas', () => {
  const p = datosDePerfil(perfilFidePrueba);
  p.nombre = '<img src=x onerror=alert(1)>';
  p.bloques = [{ titulo: 'Total', elo: '', blancas: { total: 1, victorias: 1, tablas: 0, derrotas: 0 }, negras: { total: 0 } }];
  const html = htmlFichaFide({ name: 'Jugador', fideId: '123', federation: 'ESP' }, p);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('España'));
  assert.ok(html.includes('Mundial'));
  assert.equal(html.includes('draggable="true"'), false);
});

await test('Una ventana con datos anteriores a una restauración no puede volver a escribir', async () => {
  await sembrar();
  globalThis.window = new EventTarget();
  let avisos = 0;
  window.addEventListener('chessrival-restaurado', () => avisos++);
  try {
    await copias.datosActuales();
    await db.guardarAjuste('datos_revision', 'restaurada-en-otra-ventana');
    await assert.rejects(db.guardarAjuste('ficha_solo_lento', true), /Recarga esta ventana/);
    assert.equal(avisos, 1);
  } finally { delete globalThis.window; }
  assert.equal(await db.leerAjuste('ficha_solo_lento'), null);
});

await limpiar();
