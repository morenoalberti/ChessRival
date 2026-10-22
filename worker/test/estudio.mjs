import test from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { PartidaGuardada } from '../../js/partidas.js';
import { leerPgn, detectarRitmo, colorDelJugador } from '../../js/pgn.js';
import { inspeccionarPartida, auditarPartidas, filtrarEstudio, fiabilidad, resumirMuestra, resultadoEsperado, repertorioEstudio, aperturasEstudio, crearInformeEstudio } from '../../js/estudio-datos.js';
import { cargarLibroAperturas } from '../../js/aperturas.js';
import { calcular } from '../../js/debilidades.js';
import { analizarPartida } from '../../js/analizador.js';
import { textoInformeEstudio, enlazarReferenciasEstudio } from '../../js/estudio-ui.js';
import { registrarIntentoEjercicio } from '../../js/estudio-progreso.js';
import { textoColoresDeLinea } from '../../js/nombre-jugador.js';
import { analizarRespuestaEjercicio } from '../../js/explicacion-ejercicio.js';
import { leerArchivo, importar } from '../../js/importador.js';
import { leerCarpetaPgn, elegirCarpetaPgn, permitirCarpetaPgn, buscarPgnEnCarpeta, fuenteDePgn, agruparCarpetasPgn, repartirPgn } from '../../js/importar-carpetas.js';
import * as db from '../../js/db.js';
import { guardarPartidas, listarPartidas, guardarEdicion, cargarEdicion } from '../../js/db-partidas.js';

const fetchAnterior = globalThis.fetch;
try {
  globalThis.fetch = async ruta => ({ json: async () => JSON.parse(await readFile(new URL(`../../${ruta}`, import.meta.url), 'utf8')) });
  await cargarLibroAperturas();
} finally { globalThis.fetch = fetchAnterior; }

const hoy = new Date('2026-10-15T12:00:00Z');
const fenInicialEjercicio = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const jugadorFuentes = { name: 'Estudiado, Uno Segundo', fideId: '8812345' };
const pgnFuentes = (abreviado = false, fecha = '2026.10.01') =>
  `${abreviado ? '' : '[Event "Torneo"]\n'}[White "Estudiado, Uno ${abreviado ? 'S.' : 'Segundo'}"]\n[Black "Rival, Dos"]\n[Date "${fecha}"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0`;
const archivoFuentes = texto => ({ name: 'partidas.pgn', size: texto.length, arrayBuffer: async () => new TextEncoder().encode(texto).buffer });
const archivoCarpeta = (nombre, texto) => [nombre, { kind: 'file', getFile: async () => ({ ...archivoFuentes(texto), name: nombre }) }];
const carpetaPrueba = archivos => ({ queryPermission: async () => 'granted', async *entries() { yield* archivos; } });

test('Cada fuente recuerda su carpeta de solo lectura; cancelar Cambiar conserva la anterior', async () => {
  const yotta = { kind: 'directory', name: 'Yotta PGN' }, ahora = { kind: 'directory', name: 'Ahora PGN' };
  let opciones;
  assert.deepEqual(await elegirCarpetaPgn('yotta', null, { showDirectoryPicker: async o => { opciones = o; return yotta; } }), yotta);
  assert.deepEqual(opciones, { id: 'chessrival-pgn-yotta', mode: 'read' });
  await elegirCarpetaPgn('ahora', ahora, { showDirectoryPicker: async o => { assert.equal(o.startIn, ahora); return ahora; } });
  assert.deepEqual(await leerCarpetaPgn('yotta'), yotta);
  assert.deepEqual(await leerCarpetaPgn('ahora'), ahora);
  assert.equal(await elegirCarpetaPgn('yotta', yotta, { showDirectoryPicker: async () => { throw new DOMException('Cancelado', 'AbortError'); } }), undefined);
  assert.deepEqual(await leerCarpetaPgn('yotta'), yotta);
  assert.equal(await leerCarpetaPgn('sin-elegir'), null);
  await assert.rejects(elegirCarpetaPgn('yotta', yotta, {}), /Edge o Chrome/);
});

test('Al buscar solo se consulta el permiso; Permitir lo renueva explícitamente', async () => {
  let solicitudes = 0, permiso = 'prompt';
  const carpeta = { queryPermission: async o => { assert.equal(o.mode, 'read'); return permiso; }, requestPermission: async o => { assert.equal(o.mode, 'read'); solicitudes++; return permiso; }, entries: () => { throw new Error('No debe enumerar sin permiso'); } };
  assert.deepEqual(await buscarPgnEnCarpeta(carpeta, jugadorFuentes), { pendiente: true, lecturas: [], errores: [] });
  assert.equal(solicitudes, 0);
  assert.equal(await permitirCarpetaPgn(carpeta), false); assert.equal(solicitudes, 1);
  permiso = 'granted';
  assert.equal(await permitirCarpetaPgn(carpeta), true); assert.equal(solicitudes, 1);
  permiso = 'prompt'; carpeta.requestPermission = async () => { solicitudes++; return 'granted'; };
  assert.equal(await permitirCarpetaPgn(carpeta), true); assert.equal(solicitudes, 2);
});

test('La carpeta reconoce el contenido del PGN, ignora nombres engañosos, ID contradictorio y subcarpetas', async () => {
  const otro = pgnFuentes().replace('Estudiado, Uno Segundo', 'Distinto, Otro');
  const contradictorio = pgnFuentes().replace('[White ', '[WhiteFideId "999"]\n[White ');
  const porId = otro.replace('[White ', '[WhiteFideId "8812345"]\n[White ');
  const archivos = [archivoCarpeta('nombre-cualquiera.PGN', pgnFuentes(true)), archivoCarpeta('Estudiado.pgn', otro), archivoCarpeta('id-incorrecto.pgn', contradictorio), archivoCarpeta('mixto.pgn', `${otro}\n\n${pgnFuentes()}`), archivoCarpeta('por-id.pgn', porId), archivoCarpeta('ignorado.txt', pgnFuentes()), ['subcarpeta.pgn', { kind: 'directory' }]];
  const progreso = [];
  const r = await buscarPgnEnCarpeta(carpetaPrueba(archivos), jugadorFuentes, { progreso: n => progreso.push(n) });
  assert.equal(r.pendiente, false); assert.deepEqual(r.errores, []);
  assert.deepEqual(r.lecturas.map(l => [l.archivo.name, l.suyas, l.total]), [['nombre-cualquiera.PGN', 1, 1], ['mixto.pgn', 1, 2], ['por-id.pgn', 1, 1]]);
  assert.deepEqual(progreso, archivos.slice(0, 5).map(([n]) => n));
});

test('Un PGN ilegible no impide revisar los demás y una nueva búsqueda ve archivos nuevos sin guardar partidas', async () => {
  const antes = (await listarPartidas('f:8812345')).length;
  const archivos = [['roto.pgn', { kind: 'file', getFile: async () => { throw new Error('No disponible'); } }], archivoCarpeta('bien.pgn', pgnFuentes())];
  const carpeta = carpetaPrueba(archivos);
  const r = await buscarPgnEnCarpeta(carpeta, jugadorFuentes);
  assert.deepEqual(r.errores, ['roto.pgn']); assert.equal(r.lecturas.length, 1);
  archivos.push(archivoCarpeta('nuevo.pgn', pgnFuentes(false, '2026.10.02')));
  assert.equal((await buscarPgnEnCarpeta(carpeta, jugadorFuentes)).lecturas.length, 2);
  assert.equal((await listarPartidas('f:8812345')).length, antes);
  assert.deepEqual(await buscarPgnEnCarpeta(carpetaPrueba([]), jugadorFuentes), { pendiente: false, lecturas: [], errores: [] });
});

test('Cerrar cancela la búsqueda antes de continuar con otros PGN y no guarda nada', async () => {
  const control = new AbortController(); let leidos = 0;
  const archivos = [1, 2].map(n => [`${n}.pgn`, { kind: 'file', getFile: async () => { leidos++; control.abort(); return archivoFuentes(pgnFuentes()); } }]);
  const antes = (await listarPartidas('f:8812345')).length;
  await assert.rejects(buscarPgnEnCarpeta(carpetaPrueba(archivos), jugadorFuentes, { señal: control.signal }), { name: 'AbortError' });
  assert.equal(leidos, 1);
  await assert.rejects(buscarPgnEnCarpeta(carpetaPrueba(archivos), jugadorFuentes, { señal: control.signal }), { name: 'AbortError' });
  assert.equal(leidos, 1); assert.equal((await listarPartidas('f:8812345')).length, antes);
});

test('Una carpeta compartida se lee una vez y reparte los PGN entre las webs sin duplicar su listado', async () => {
  const carpeta = { name: 'Descargas', isSameEntry: async c => c.name === 'Descargas' };
  const otraReferencia = { name: 'Descargas' }, distinta = { name: 'Otros PGN' };
  const grupos = await agruparCarpetasPgn([{ id: 'yotta', carpeta }, { id: 'ahora', carpeta: otraReferencia }, { id: 'pgn', carpeta: distinta }]);
  assert.deepEqual(grupos.map(g => g.fuentes), [['yotta', 'ahora'], ['pgn']]);
  const archivos = [archivoCarpeta('estudiado, uno segundo.pgn', pgnFuentes().replace('[White ', '[Source "YottaBase"]\n[White ')), archivoCarpeta('Estudiado__Uno_Segundo_todas_1 (2).pgn', pgnFuentes(true)), archivoCarpeta('Estudiado Uno Segundo.pgn', pgnFuentes())];
  const { lecturas } = await buscarPgnEnCarpeta(carpetaPrueba(archivos), jugadorFuentes);
  assert.deepEqual(lecturas.map(fuenteDePgn), ['yotta', 'ahora', null]);
  const repartidas = repartirPgn(lecturas, grupos[0].fuentes, jugadorFuentes);
  assert.deepEqual(repartidas.map(l => [l.tarjeta, l.fuente, l.sinOrigen]), [['yotta', 'YottaChess', false], ['ahora', 'AhoraAjedrez', false], ['yotta', 'PGN', true]]);
  assert.equal(new Set(repartidas.map(l => l.archivo.name)).size, 3);
  assert.equal(repartirPgn([lecturas[2]], ['yotta', 'ahora', 'pgn'], jugadorFuentes)[0].tarjeta, 'pgn');
  assert.equal(repartirPgn([lecturas[2]], ['ahora'], jugadorFuentes)[0].fuente, 'AhoraAjedrez');
  assert.deepEqual(repartirPgn(lecturas.slice(0, 2), ['ahora'], jugadorFuentes).map(l => l.archivo.name), ['Estudiado__Uno_Segundo_todas_1 (2).pgn']);
  assert.equal(repartirPgn(lecturas, ['pgn'], jugadorFuentes).length, 3);
  // Las etiquetas prevalecen incluso si el archivo se renombra como una descarga de otra web.
  assert.equal(fuenteDePgn({ ...lecturas[0], archivo: { name: 'nombre_todas_1.pgn' } }), 'yotta');
});

test('Los formatos reales descargados de ambas webs permiten distinguir su procedencia', async () => {
  // Mismas cabeceras y nombres de exportación observados, con partidas sintéticas.
  const textos = [pgnFuentes().replace('[White ', '[Annotator "YottaBase"]\n[Source "YottaBase"]\n[White '), pgnFuentes(true).replaceAll('"]', '"\\]')];
  const lecturas = await Promise.all(textos.map(t => leerArchivo(archivoFuentes(t), jugadorFuentes)));
  lecturas[0].archivo.name = 'estudiado, uno segundo.pgn'; lecturas[1].archivo.name = 'Estudiado__Uno_Segundo_todas_1.pgn';
  assert.deepEqual(lecturas.map(fuenteDePgn), ['yotta', 'ahora']);
});

test('Terron Elena no toma los PGN de Cardoso o Garcia Claros aunque figure como rival en sus partidas', async () => {
  const jugador = { name: 'Terron Elena, Francisco Miguel', fideId: '2210576' };
  const pgn = pgnFuentes().replace('Estudiado, Uno Segundo', jugador.name);
  const contraTerron = nombre => pgnFuentes().replace('Estudiado, Uno Segundo', nombre)
    .replace('Rival, Dos', jugador.name).replace('[White ', '[Source "YottaBase"]\n[White ');
  const archivos = [archivoCarpeta('cardoso garcia, sergio.pgn', contraTerron('Cardoso Garcia, Sergio')),
    archivoCarpeta('garcia claros, salvador.pgn', contraTerron('Garcia Claros, Salvador')),
    archivoCarpeta('Terron_Elena__Francisco_Miguel_todas_131 (1).pgn', pgn)];
  const r = await buscarPgnEnCarpeta(carpetaPrueba(archivos), jugador);
  assert.equal(r.lecturas.length, 3); // Los tres contienen una partida suya, pero solo uno es su descarga.
  const repartidas = repartirPgn(r.lecturas, ['yotta', 'ahora'], jugador);
  assert.equal(repartidas.filter(l => l.tarjeta === 'yotta').length, 0);
  assert.deepEqual(repartidas.map(l => l.archivo.name), ['Terron_Elena__Francisco_Miguel_todas_131 (1).pgn']);
  assert.equal(repartirPgn(r.lecturas, ['yotta'], jugador).length, 0);
  // «Archivos PGN» sigue admitiendo colecciones generales y extrae sus partidas.
  assert.equal(repartirPgn(r.lecturas, ['pgn'], jugador).length, 3);
  archivos.push(archivoCarpeta('TERRÓN ELENA, FRANCISCO MIGUEL (2).PGN', pgn.replace('[White ', '[Source "YottaBase"]\n[White ')));
  const conDescarga = await buscarPgnEnCarpeta(carpetaPrueba(archivos), jugador);
  assert.equal(repartirPgn(conDescarga.lecturas, ['yotta', 'ahora'], jugador).filter(l => l.tarjeta === 'yotta').length, 1);
});

test('El nombre del archivo de la web debe identificar al jugador completo y su contenido también debe coincidir', async () => {
  const nombres = ['Estudiado__Uno_Segundo_todas_2.pgn', 'uno segundo estudiado (1).pgn', 'Estudiado, Uno.pgn', 'Estudiado, Uno S.pgn', 'Otro Estudiado Uno Segundo.pgn'];
  const { lecturas } = await buscarPgnEnCarpeta(carpetaPrueba(nombres.map(n => archivoCarpeta(n, pgnFuentes()))), jugadorFuentes);
  assert.deepEqual(repartirPgn(lecturas, ['yotta', 'ahora'], jugadorFuentes).map(l => l.archivo.name), nombres.slice(0, 2));
  const falso = await buscarPgnEnCarpeta(carpetaPrueba([archivoCarpeta(nombres[0], pgnFuentes().replace('Estudiado, Uno Segundo', 'Otro, Jugador'))]), jugadorFuentes);
  assert.equal(falso.lecturas.length, 0);
});
function partida({ id = 1, fecha = '2026.10.01', evento = 'Prueba', movimientos = '1. f3 e5 2. g4 Qh4#', resultado = '0-1', color = 'B', elo = '2000', eloRival = '2000', control = '5400+30', extra = '' } = {}) {
  const blancas = color === 'B' ? 'Estudiado, Uno' : 'Rival, Dos', negras = color === 'N' ? 'Estudiado, Uno' : 'Rival, Dos';
  return new PartidaGuardada({ id, fecha, evento, blancas, negras, resultado, colorJugador: color, ritmo: 1,
    pgn: `[Event "${evento}"]\n[Date "${fecha}"]\n[White "${blancas}"]\n[Black "${negras}"]\n[WhiteElo "${color === 'B' ? elo : eloRival}"]\n[BlackElo "${color === 'N' ? elo : eloRival}"]\n[TimeControl "${control}"]\n[Result "${resultado}"]\n${extra}\n${movimientos} ${resultado}` });
}

test('Se leen los PGN de AhoraAjedrez sin Event y con cierres escapados, sin cambiar las jugadas', async () => {
  const original = pgnFuentes(true).replaceAll('"]', '"\\]');
  const leidas = leerPgn(`${original}\n\n${original.replace('2026.10.01', '2026.10.02')}`);
  assert.equal(leidas.length, 2);
  assert.equal(leidas[0].cab('White'), 'Estudiado, Uno S.');
  assert.equal(leidas[0].jugadas, '1. e4 e5 2. Nf3 Nc6 1-0');
  assert.equal(leidas[1].cab('Date'), '2026.10.02');
  const lectura = await leerArchivo(archivoFuentes(original), jugadorFuentes);
  assert.equal(lectura.total, 1); assert.equal(lectura.suyas, 1);
});

test('Una inicial adicional requiere mismos apellidos y primer nombre completo; un ID contradictorio sigue excluido', () => {
  const p = leerPgn(pgnFuentes(true))[0];
  assert.equal(colorDelJugador(jugadorFuentes, p), 'B');
  assert.equal(colorDelJugador({ name: 'Estudiado, Otro Segundo' }, p), null);
  assert.equal(colorDelJugador({ name: 'Diferente, Uno Segundo' }, p), null);
  assert.equal(colorDelJugador(jugadorFuentes, leerPgn(pgnFuentes(true).replace('Uno S.', 'U. S.'))[0]), null);
  assert.equal(colorDelJugador(jugadorFuentes, leerPgn(pgnFuentes(true).replace('[White ', '[WhiteFideId "999"]\n[White '))[0]), null);
});

test('YottaChess y AhoraAjedrez se importan juntos sin duplicar; MegaDatabase une su fuente y conserva análisis y anotaciones', async () => {
  const clave = 'f:8812345';
  const yotta = { ...await leerArchivo(archivoFuentes(pgnFuentes()), jugadorFuentes), fuente: 'YottaChess' };
  const ahora = { ...await leerArchivo(archivoFuentes(pgnFuentes(true)), jugadorFuentes), fuente: 'AhoraAjedrez' };
  const resultado = await importar(jugadorFuentes, [yotta, ahora]);
  assert.equal(resultado.nuevas, 1); assert.equal(resultado.enLote, 1);
  const [p] = await listarPartidas(clave);
  assert.equal((await listarPartidas(clave)).length, 1);
  assert.equal(p.origen, 'YottaChess;AhoraAjedrez');
  await guardarEdicion(p.id, { notas: [{ ruta: 'e2e4', texto: 'Conservar nota' }], variantes: [] });
  await db.tx('analisis', 'readwrite', a => db.prom(a.put({ partidaId: p.id, jugadorClave: clave, prueba: 'Conservar análisis' })));
  const mega = await guardarPartidas(clave, [{ partida: leerPgn(pgnFuentes())[0], color: 'B', ritmo: 1 }], 'MegaDatabase');
  assert.equal(mega.nuevas, 0); assert.equal(mega.repetidas, 1);
  const [conservada] = await listarPartidas(clave);
  assert.equal(conservada.id, p.id); assert.equal(conservada.pgn, p.pgn);
  assert.equal(conservada.origen, 'YottaChess;AhoraAjedrez;MegaDatabase');
  assert.equal((await cargarEdicion(p.id)).notas[0].texto, 'Conservar nota');
  assert.equal((await db.tx('analisis', 'readonly', a => db.prom(a.get(p.id)))).prueba, 'Conservar análisis');
});

test('Los dos PGN tampoco duplican una partida que ya estaba en MegaDatabase', async () => {
  const j = { ...jugadorFuentes, fideId: '8812346' }, clave = 'f:8812346';
  await guardarPartidas(clave, [{ partida: leerPgn(pgnFuentes())[0], color: 'B', ritmo: 1 }], 'MegaDatabase');
  const lecturas = await Promise.all([['YottaChess', false], ['AhoraAjedrez', true]].map(async ([fuente, abreviado]) => ({ ...await leerArchivo(archivoFuentes(pgnFuentes(abreviado)), j), fuente })));
  const r = await importar(j, lecturas);
  assert.equal(r.nuevas, 0); assert.equal(r.repetidas, 2);
  const lista = await listarPartidas(clave);
  assert.equal(lista.length, 1); assert.equal(lista[0].origen, 'MegaDatabase;YottaChess;AhoraAjedrez');
});

test('La deduplicación entre fuentes conserva encuentros de fechas distintas y no presume duplicados sin fecha completa', async () => {
  const j = { ...jugadorFuentes, fideId: '8812347' }, clave = 'f:8812347';
  const textos = [pgnFuentes(), pgnFuentes(true, '2026.10.02'), pgnFuentes(true, '2026.10.??'), pgnFuentes(false, '2026.10.??')];
  const lecturas = await Promise.all(textos.map(async (texto, i) => ({ ...await leerArchivo(archivoFuentes(texto), j), fuente: i % 2 ? 'AhoraAjedrez' : 'YottaChess' })));
  await importar(j, lecturas);
  assert.equal((await listarPartidas(clave)).length, 4);
});

test('La calidad detecta PGN ilegales y resultados incompatibles sin modificar originales', () => {
  assert.equal(inspeccionarPartida({ id: 99 }).valida, false);
  const valida = partida(), ilegal = partida({ id: 2, movimientos: '1. e4 e5 2. jugadaImposible' }), malResultado = partida({ id: 3, resultado: '1-0' });
  const antes = JSON.stringify([valida, ilegal, malResultado]);
  const r = auditarPartidas([valida, ilegal, malResultado]);
  assert.equal(r.validas.length, 1); assert.equal(r.incidencias.length, 2);
  assert.equal(JSON.stringify([valida, ilegal, malResultado]), antes);
});
test('Se reconoce un duplicado con distinto evento, pero no dos fechas distintas', () => {
  const r = auditarPartidas([partida(), partida({ id: 2, evento: 'Otro nombre' }), partida({ id: 3, fecha: '2026.10.02' })]);
  assert.equal(r.validas.length, 2); assert.equal(r.duplicadas[0].original.id, 1);
  const invertida = auditarPartidas([partida({ id: 2, evento: 'Otro nombre' }), partida()]);
  assert.equal(invertida.validas[0].id, 1);
});
test('Un ID FIDE incompatible se excluye; la ausencia de ID no se inventa', () => {
  const p = partida({ extra: '[WhiteFideId "999"]' });
  assert.equal(auditarPartidas([p], { fideId: '123' }).incidencias.length, 1);
  assert.equal(auditarPartidas([partida()], { fideId: '123' }).validas.length, 1);
  const cero = partida({ extra: '[WhiteFideId "0"]' });
  assert.equal(auditarPartidas([cero], { fideId: '123' }).validas.length, 1);
  assert.equal(colorDelJugador({ fideId: '123', name: 'Estudiado, Uno' }, leerPgn(cero.pgn)[0]), 'B');
});
test('El filtro separa ritmos, fechas desconocidas y fechas futuras', () => {
  const lista = [partida(), partida({ id: 2, control: '300+0' }), partida({ id: 3, control: '?' }), partida({ id: 4, fecha: '2026.??.??' }), partida({ id: 5, fecha: '2027.01.01' }), partida({ id: 6, fecha: '2024.01.01' })];
  assert.deepEqual(filtrarEstudio(lista, { ritmo: '1', meses: '12' }, hoy).map(p => p.id), [1]);
  assert.deepEqual(filtrarEstudio(lista, { ritmo: '0', meses: '0' }, hoy).map(p => p.id), [3]);
  assert.deepEqual(filtrarEstudio(lista, { ritmo: '3', meses: '0' }, hoy).map(p => p.id), [2]);
});
test('TimeControl utiliza segundos y 60 incrementos, sin mezclar desconocidos', () => {
  const ritmo = control => detectarRitmo(leerPgn(partida({ control }).pgn)[0]);
  assert.equal(ritmo('120'), 3); assert.equal(ritmo('600'), 3);
  assert.equal(ritmo('300+5'), 3); assert.equal(ritmo('900+10'), 2);
  assert.equal(ritmo('3600'), 1); assert.equal(ritmo('40/7200:3600'), 1);
  assert.equal(ritmo('40/300'), 0); assert.equal(ritmo('?'), 0);
});

test('Una colección de 299 partidas sin clásicas se muestra completa por defecto', () => {
  const lista = Array.from({ length: 299 }, (_, i) => partida({ id: i + 1, control: i < 293 ? '?' : '900+10' }));
  assert.equal(filtrarEstudio(lista, undefined, hoy).length, 299);
  assert.equal(filtrarEstudio(lista, { ritmo: '1' }, hoy).length, 0);
  assert.equal(filtrarEstudio(lista, { ritmo: '0' }, hoy).length, 293);
  assert.equal(filtrarEstudio(lista, { ritmo: 'todos', meses: '0' }, hoy).length, 299);
});
test('La fiabilidad cuenta partidas, con umbrales explícitos', () => {
  assert.equal(fiabilidad(4).suficiente, false); assert.equal(fiabilidad(5).suficiente, true);
  assert.equal(fiabilidad(15).nivel, 'Media'); assert.equal(fiabilidad(30).nivel, 'Alta');
});
test('El ajuste Elo compara la misma muestra y no rellena Elos históricos ausentes', () => {
  const igual = partida({ resultado: '1/2-1/2', movimientos: '1. e4 e5' });
  const sinElo = partida({ id: 2, elo: '?', movimientos: '1. d4 d5', resultado: '1-0' });
  assert.equal(resultadoEsperado(igual), .5); assert.equal(resultadoEsperado(sinElo), null);
  const r = resumirMuestra([igual, sinElo], hoy);
  assert.equal(r.puntuacion, .75); assert.equal(r.realComparable, .5); assert.equal(r.esperada, .5); assert.equal(r.conElo, 1);
});
test('El peso temporal da más influencia a partidas recientes y omite las sin fecha', () => {
  const r = resumirMuestra([
    partida({ movimientos: '1. e4 e5', resultado: '1-0', fecha: '2026.10.01' }),
    partida({ id: 2, fecha: '2020.01.01' }), partida({ id: 3, fecha: '????.??.??' })], hoy);
  assert.equal(r.fechadas, 2); assert.ok(r.reciente > .9); assert.equal(r.terminadas, 3);
});
test('El periodo reciente respeta el último día de un mes corto', () => {
  const lista = [partida({ fecha: '2026.04.30' }), partida({ id: 2, fecha: '2026.04.29' })];
  assert.deepEqual(filtrarEstudio(lista, { ritmo: '1', meses: '6' }, new Date('2026-10-31T12:00:00Z')).map(p => p.id), [1]);
});
test('Muchas jugadas de una sola partida no producen una comparación entre colores', () => {
  const partidas = Array.from({ length: 10 }, (_, i) => ({ id: i, colorJugador: i < 5 ? 'B' : 'N', puntos: 1, aperturaEtiqueta: 'e4' }));
  const jugadas = partidas.flatMap(p => Array.from({ length: 8 }, (_, i) => ({ partidaId: p.id, ply: i * 2 + 1, perdida: p.colorJugador === 'B' ? 50 : 0, fase: 'medio juego', evalAntes: 50, evalDespues: 0, mejor: 'e2e4' })));
  assert.ok(calcular(partidas, jugadas).debilidades.some(d => d.titulo.startsWith('Juega peor con blancas')));
});
test('Las transposiciones reúnen órdenes distintos en la misma posición', () => {
  const a = partida({ resultado: '1/2-1/2', movimientos: '1. Nf3 d5 2. d4 Nf6 3. c4 e6' });
  const b = partida({ id: 2, resultado: '1/2-1/2', movimientos: '1. d4 Nf6 2. Nf3 d5 3. c4 e6' });
  const g = repertorioEstudio([a, b], hoy).find(g => g.ply === 5 && g.jugada === 'c4');
  assert.equal(g.partidas.length, 2); assert.equal(g.transposiciones, 2);
  assert.equal(g.lineaLlegada, '1.Nf3 d5 2.d4 Nf6');
  assert.equal(inspeccionarPartida(g.partidas[0]).posiciones[g.ply - 1], g.fen);
  assert.equal(g.plyPosicion, g.ply - 1);
});

test('La frecuencia usa todas las partidas que llegan a la misma posición y color', () => {
  const lista = Array.from({ length: 10 }, (_, i) => partida({ id: i + 1, color: 'N', fecha: i < 5 ? `2020.01.0${i + 1}` : `2026.09.${String(i + 1).padStart(2, '0')}`, resultado: '1/2-1/2', movimientos: `1. Nf3 ${i < 5 ? 'Nf6' : i < 8 ? 'd5' : 'e5'}` }));
  lista.push(partida({ id: 11, color: 'N', movimientos: '1. e4 e5', resultado: '1/2-1/2' }));
  lista.push(partida({ id: 12, color: 'B', movimientos: '1. Nf3 Nf6', resultado: '1/2-1/2' }));
  const g = repertorioEstudio(lista, hoy).find(g => g.color === 'N' && g.jugada === 'Nf6');
  assert.equal(g.partidas.length, 5); assert.equal(g.totalPosicion, 10); assert.equal(g.frecuencia, .5);
  assert.equal(g.totalReciente, 5); // Las partidas antiguas sí cuentan en la frecuencia global.
  const informe = crearInformeEstudio(lista, [], hoy);
  const texto = textoInformeEstudio({ name: 'Prueba' }, informe, auditarPartidas(lista), 'Todos · Todo el historial');
  assert.match(texto, /♘f6.*Frecuencia 45,5 % \(5 de 11 partidas del jugador con negras/);
});

test('Preparación distingue aperturas que comparten d4 Cf6 y cuenta sus propios resultados', () => {
  const secuencias = ['1. d4 Nf6 2. c4 e6 3. Nc3 Bb4', '1. d4 Nf6 2. c4 g6 3. Nc3 d5', '1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6'];
  const lista = secuencias.flatMap((movimientos, n) => Array.from({ length: 5 }, (_, i) => partida({ id: n * 5 + i + 1, fecha: `2026.09.${String(n * 5 + i + 1).padStart(2, '0')}`, color: 'N', movimientos, resultado: i < 3 ? '0-1' : i === 3 ? '1/2-1/2' : '1-0' })));
  const lineas = aperturasEstudio(lista, hoy);
  assert.equal(lineas.length, 3);
  for (const g of lineas) {
    assert.ok(g.identificada); assert.ok(g.ply >= 6); assert.equal(g.partidas.length, 5);
    assert.equal(g.muestra.victorias, 3); assert.equal(g.frecuencia, 1 / 3); assert.equal(g.totalPosicion, 15);
    assert.equal(inspeccionarPartida(g.partidas[0]).posiciones[g.plyPosicion], g.fen);
  }
  assert.ok(lineas.some(g => g.eco === 'E20' && /nimzo/i.test(g.apertura)));
  assert.ok(lineas.some(g => g.eco === 'D80' && /grünfeld/i.test(g.apertura)));
  assert.ok(lineas.some(g => /india.*rey/i.test(g.apertura)));
  const informe = crearInformeEstudio(lista, [], hoy);
  assert.equal(informe.planes[0].habituales.length, 3);
  assert.match(textoInformeEstudio({ name: 'Prueba' }, informe, auditarPartidas(lista), 'Todos'), /E20.*Línea: 1.d4 ♘f6 2.c4 e6 3.♘c3 ♗b4/);
});

test('La identificación continúa hasta Najdorf y reúne transposiciones sin inventar una apertura', () => {
  const najdorf = aperturasEstudio([partida({ movimientos: '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Bg5 e6' })], hoy)[0];
  assert.match(najdorf.apertura, /najdorf/i); assert.ok(najdorf.ply >= 10); assert.match(najdorf.lineaLlegada, /a6/);
  const a = partida({ movimientos: '1. d4 Nf6 2. c4 e6 3. Nc3 Bb4' });
  const b = partida({ id: 2, movimientos: '1. c4 Nf6 2. Nc3 e6 3. d4 Bb4' });
  const unidas = aperturasEstudio([a, b], hoy);
  assert.equal(unidas.length, 1); assert.equal(unidas[0].transposiciones, 2);
  const corta = partida({ movimientos: '1. d4 Nf6' });
  corta.apertura = 'Nimzo-Indian Defense';
  assert.equal(aperturasEstudio([corta], hoy)[0].identificada, false);
});

test('Una línea cuenta también partidas que continúan hacia una variante más concreta', () => {
  const base = partida({ color: 'N', movimientos: '1. d4 Nf6 2. c4 e6 3. Nc3 Bb4', resultado: '0-1' });
  const variante = partida({ id: 2, color: 'N', movimientos: '1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 4. Qc2 O-O', resultado: '1-0' });
  const grupos = aperturasEstudio([base, variante], hoy), nimzo = grupos.find(g => g.eco === 'E20');
  assert.equal(grupos.length, 2); assert.equal(nimzo.partidas.length, 2);
  assert.equal(nimzo.muestra.victorias, 1); assert.equal(nimzo.frecuencia, 1);
  assert.equal(nimzo.partidas[0].id, base.id);
  assert.equal(inspeccionarPartida(nimzo.partidas[0]).posiciones[nimzo.plyPosicion], nimzo.fen);
});

test('Cada debilidad de apertura identifica el color del jugador y la línea completa', () => {
  const lista = Array.from({ length: 10 }, (_, i) => partida({ id: i + 1, color: i < 5 ? 'N' : 'B', movimientos: '1. d4 Nf6 2. c4 e6 3. Nc3 Bb4', resultado: i < 5 ? '1-0' : '0-1' }));
  const r = calcular(lista, [{ partidaId: 1, ply: 2, perdida: 0, fase: 'apertura', mejor: 'd7d5', evalAntes: 20, evalDespues: 20 }]);
  const aperturas = r.debilidades.filter(d => d.linea);
  assert.deepEqual(aperturas.map(d => d.colorJugador).sort(), ['B', 'N']);
  for (const d of aperturas) { assert.match(d.titulo, /nimzo/i); assert.equal(d.eco, 'E20'); assert.equal(d.linea, '1.d4 Nf6 2.c4 e6 3.Nc3 Bb4'); }
  const jugador = { name: 'Apellido, Nombre', fideTitle: 'IM' };
  assert.equal(textoColoresDeLinea(jugador, 'N'), 'Blancas: sus rivales · Negras: IM Apellido, Nombre');
  assert.equal(textoColoresDeLinea(jugador, 'B'), 'Blancas: IM Apellido, Nombre · Negras: sus rivales');
  assert.equal(textoColoresDeLinea(jugador), 'Jugador estudiado: IM Apellido, Nombre');
  const texto = textoInformeEstudio(jugador, crearInformeEstudio(lista, [], hoy), auditarPartidas(lista), 'Todos');
  assert.match(texto, /Blancas: sus rivales · Negras: IM Apellido, Nombre/);
  assert.match(texto, /Blancas: IM Apellido, Nombre · Negras: sus rivales/);
});

test('Las victorias de una línea son del jugador estudiado y no incluyen medias tablas ni partidas abiertas', () => {
  const lista = Array.from({ length: 10 }, (_, i) => {
    const color = i < 5 ? 'B' : 'N', gana = i % 5 < 3, tablas = i % 5 === 3;
    return partida({ id: i + 1, color, resultado: tablas ? '1/2-1/2' : gana === (color === 'B') ? '1-0' : '0-1', movimientos: '1. Nf3 Nf6 2. g3 e6' });
  });
  lista.push(partida({ id: 11, color: 'N', resultado: '*', movimientos: '1. Nf3 Nf6' }));
  const m = resumirMuestra(lista, hoy);
  assert.equal(m.total, 11); assert.equal(m.terminadas, 10);
  assert.equal(m.victorias, 6); assert.equal(m.tablas, 2); assert.equal(m.derrotas, 2);
  assert.equal(m.porcentajeVictorias, .6); assert.equal(m.puntuacion, .7);
  const r = crearInformeEstudio(lista, [], hoy);
  const texto = textoInformeEstudio({ name: 'Prueba' }, r, auditarPartidas(lista), 'Todos · Todo el historial');
  assert.match(texto, /Jugador estudiado: gana 3 de 5 partidas \(60 %\)\. Tablas: 1 · Derrotas: 1/);
});
test('Una repetición dentro de una partida no infla la muestra del repertorio', () => {
  const p = partida({ movimientos: '1. Nf3 Nf6 2. Ng1 Ng8 3. e4 e5', resultado: '1/2-1/2' });
  const inicial = inspeccionarPartida(p).posiciones[0].split(' ').slice(0, 4).join(' ');
  const elecciones = repertorioEstudio([p], hoy).filter(g => g.fen.split(' ').slice(0, 4).join(' ') === inicial);
  assert.equal(elecciones.length, 1); assert.equal(elecciones[0].jugada, 'Nf3');
  assert.equal(elecciones[0].lineaLlegada, '');
});
test('El plan no interpreta perder contra rivales superiores como una debilidad demostrada', () => {
  const lista = Array.from({ length: 5 }, (_, i) => partida({ id: i + 1, fecha: `2026.10.0${i + 1}`, elo: '1600', eloRival: '2400', resultado: i ? '0-1' : '1-0', movimientos: '1. e4 e5 2. Nf3 Nc6' }));
  const r = crearInformeEstudio(lista, [], hoy);
  assert.equal(r.planes[1].revisar.length, 0); assert.ok(r.planes[1].habituales.length > 0);
});
test('El repertorio requiere muestras temporales comparables para anunciar cambios', () => {
  const lista = [];
  for (let i = 0; i < 5; i++) {
    lista.push(partida({ id: i + 1, fecha: `2026.09.0${i + 1}`, movimientos: '1. d4 d5', resultado: '1/2-1/2' }));
    lista.push(partida({ id: i + 6, fecha: `2024.09.0${i + 1}`, movimientos: '1. e4 e5', resultado: '1/2-1/2' }));
  }
  const g = repertorioEstudio(lista, hoy).find(g => g.ply === 1 && g.jugada === 'd4');
  assert.equal(g.cambio, 1); assert.equal(g.totalReciente, 5); assert.equal(g.totalAnterior, 5);
});
test('Los ejercicios exigen confirmación y una alternativa legal, y entrenan la respuesta rival', () => {
  const p = partida(), j = { partidaId: 1, ply: 3, san: 'g4', mejor: 'g2g3', respuestaRival: 'd8h4', perdida: 400, evalAntes: 0, fase: 'apertura', confirmada: true, profundidad: 22 };
  const r = crearInformeEstudio([p], [j], hoy);
  assert.equal(r.ejercicios[0].sanMejor, 'Qh4#'); assert.equal(r.ejercicios[0].fen.split(' ')[1], 'b');
  assert.equal(r.ejercicios[0].ply, 4);
  assert.equal(crearInformeEstudio([p], [{ ...j, confirmada: false }], hoy).ejercicios.length, 0);
  assert.equal(crearInformeEstudio([p], [{ ...j, mejor: 'a1a8' }], hoy).ejercicios.length, 0);
});
test('El refuerzo confirma de nuevo el error y puede reducir su gravedad', async () => {
  const llamadas = [];
  const motor = { nombre: 'Prueba', nuevaPartida: async () => {}, analizar: async (fen, prof) => {
    llamadas.push(prof); return { valor: prof > 12 ? 20 : 500, mejorJugada: fen.split(' ')[1] === 'w' ? 'g2g3' : 'd8h4' };
  } };
  const r = await analizarPartida(motor, partida(), 12, undefined, { confirmarCriticas: true });
  assert.ok(llamadas.includes(16)); assert.equal(r.estudioVersion, 1);
  assert.ok(r.jugadas.some(j => j.confirmada && j.profundidad === 16));
  assert.ok(r.jugadas.find(j => j.confirmada).perdida < 150);
});
test('La salida de apertura se evalúa tras 12 jugadas y desde el color del jugador', async () => {
  const movimientos = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. c4 c6 12. Nc3 Qc7 13. a3 Bb7 14. Ba2 Rfe8';
  const motor = { nuevaPartida: async () => {}, analizar: async fen => ({ valor: fen.split(' ')[1] === 'w' ? 70 : -70, mejorJugada: 'g1f3' }) };
  for (const color of ['B', 'N']) {
    const r = await analizarPartida(motor, partida({ movimientos, color, resultado: '1/2-1/2' }), 12, undefined, { confirmarCriticas: true });
    assert.equal(r.apertura.ply, 24); assert.equal(r.apertura.valor, color === 'B' ? 70 : -70);
  }
});
test('El informe exportado conserva figuritas, referencias y límites del estudio', () => {
  const p = partida({ movimientos: '1. e4 e5 2. Nf3 Nc6' }), r = crearInformeEstudio([p], [{ partidaId: 1, ply: 3, mejor: 'f1c4', perdida: 400, fase: 'apertura', evalAntes: 0 }], hoy);
  const texto = textoInformeEstudio({ name: 'Uno', fideTitle: 'IM' }, r, auditarPartidas([p]), 'Clásicas · Todo el historial');
  assert.match(texto, /IM Uno/); assert.match(texto, /Partida #1/); assert.match(texto, /no cálculo oficial FIDE/);
  assert.match(texto, /jugó ♘f3, propuesta ♗c4/);
});
test('La IA solo enlaza partidas y posiciones de la muestra y marca referencias ajenas', () => {
  const p = partida();
  const r = enlazarReferenciasEstudio('[Partida #1, jugada 2] [Partida #999, jugada 2] [Partida #1, jugada 70]', [p], [{ partidaId: 1, ply: 3 }]);
  assert.equal(r.verificadas, 1); assert.equal(r.fuera, 2);
  assert.match(r.html, /data-prueba="1" data-ply="2"/); assert.doesNotMatch(r.html, /data-prueba="999"/);
});
test('Importar una copia con metadatos distintos conserva fuentes y anotaciones', async () => {
  await db.tx(['partidas', 'ediciones'], 'readwrite', (p, e) => Promise.all([db.prom(p.clear()), db.prom(e.clear())]));
  const original = partida(), otra = partida({ evento: 'Evento renombrado' });
  const item = p => ({ partida: leerPgn(p.pgn)[0], color: 'B', eco: '', apertura: '', ritmo: 1 });
  await guardarPartidas('f:123', [item(original)], 'A');
  const [p] = await listarPartidas('f:123');
  const edicion = { principal: null, variantes: [], notas: [{ ruta: 'f2f3', texto: 'Conservar' }] };
  await guardarEdicion(p.id, edicion);
  const resultado = await guardarPartidas('f:123', [item(otra)], 'B');
  assert.equal(resultado.nuevas, 0); assert.equal(resultado.repetidas, 1);
  assert.equal((await listarPartidas('f:123')).length, 1); assert.equal((await listarPartidas('f:123'))[0].origen, 'A;B');
  assert.equal((await cargarEdicion(p.id)).notas[0].texto, 'Conservar');
});
test('Dos fichas conservan sus intentos de entrenamiento sin sobrescribirse', async () => {
  const clave = 'estudio-ejercicios:f:prueba';
  await Promise.all([registrarIntentoEjercicio(clave, '1:3:a1a2', true), registrarIntentoEjercicio(clave, '2:5:b1c3', false)]);
  await Promise.all([registrarIntentoEjercicio(clave, '1:3:a1a2', false), registrarIntentoEjercicio(clave, '1:3:a1a2', false)]);
  const resultado = await db.leerAjuste(clave);
  assert.equal(resultado['1:3:a1a2'].intentos, 3); assert.equal(resultado['1:3:a1a2'].resuelto, true);
  assert.equal(resultado['2:5:b1c3'].intentos, 1);
});

test('Una jugada peor que la propuesta de Stockfish no es la solución, y se compara desde el bando que mueve', async () => {
  const llamadas = [];
  const motor = { analizar: async (fen, prof) => {
    llamadas.push({ fen, prof });
    return llamadas.length === 1
      ? { centipeones: 90, mate: null, profundidad: 18, variante: ['d2d4', 'd7d5'], mejorJugada: 'd2d4' }
      : { centipeones: 120, mate: null, profundidad: 18, variante: ['e7e5', 'g1f3', 'b8c6'], mejorJugada: 'e7e5' };
  } };
  const r = await analizarRespuestaEjercicio(motor, { fen: fenInicialEjercicio, jugada: 'e2e4', profundidad: 18 });
  assert.equal(r.acierto, false); assert.equal(r.base.centipeones, 90);
  assert.deepEqual(llamadas.map(l => l.prof), [18, 18]);
});

test('Una alternativa equivalente se acepta y reutiliza la referencia', async () => {
  let llamadas = 0;
  const base = { centipeones: 40, mate: null, profundidad: 16, variante: ['d2d4'] };
  const motor = { analizar: async () => { llamadas++; return { centipeones: -20, mate: null, profundidad: 16, variante: ['e7e5'] }; } };
  const r = await analizarRespuestaEjercicio(motor, { fen: fenInicialEjercicio, jugada: 'e2e4', base });
  assert.equal(r.acierto, true); assert.equal(llamadas, 1); assert.equal(r.base, base);
});

test('El signo de Stockfish también se invierte correctamente cuando resuelven negras', async () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const base = { centipeones: 50, mate: null, profundidad: 16, variante: ['e7e5'] };
  const motor = { analizar: async () => ({ centipeones: 100, mate: null, profundidad: 16, variante: ['d2d4'] }) };
  const r = await analizarRespuestaEjercicio(motor, { fen, jugada: 'c7c5', base });
  assert.equal(r.acierto, false);
});

test('Perder un mate forzado no se acepta aunque la alternativa conserve ventaja', async () => {
  const base = { centipeones: null, mate: 3, profundidad: 16, variante: ['d2d4'] };
  const motor = { analizar: async () => ({ centipeones: -800, mate: null, profundidad: 16, variante: ['e7e5'] }) };
  const r = await analizarRespuestaEjercicio(motor, { fen: fenInicialEjercicio, jugada: 'e2e4', base });
  assert.equal(r.acierto, false);
});

test('Permitir un mate rival no es la solución y un mate a favor alternativo sí lo es', async () => {
  const fen = 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2';
  const base = { centipeones: -50, mate: null, profundidad: 16, variante: ['g2g3'] };
  const permite = await analizarRespuestaEjercicio({ analizar: async () => ({ centipeones: null, mate: 1, profundidad: 16, variante: ['d8h4'] }) }, { fen, jugada: 'g2g4', base });
  assert.equal(permite.acierto, false);
  const baseMate = { centipeones: null, mate: 3, profundidad: 16, variante: ['d2d4'] };
  const alternativo = await analizarRespuestaEjercicio({ analizar: async () => ({ centipeones: null, mate: -5, profundidad: 16, variante: ['e7e5'] }) }, { fen: fenInicialEjercicio, jugada: 'e2e4', base: baseMate });
  assert.equal(alternativo.acierto, true);
});

test('No se acepta una valoración inventada y se respeta la cancelación', async () => {
  const base = { centipeones: 50, mate: null, profundidad: 16, variante: ['d2d4'] };
  await assert.rejects(analizarRespuestaEjercicio({ analizar: async () => ({ profundidad: 16 }) }, { fen: fenInicialEjercicio, jugada: 'e2e4', base }), /Sin valoración/);
  const señal = AbortSignal.abort();
  await assert.rejects(analizarRespuestaEjercicio({ analizar: async () => ({ centipeones: 90, mate: null, variante: ['e7e5'] }) }, { fen: fenInicialEjercicio, jugada: 'e2e4', base }, señal), { name: 'AbortError' });
});

test('El motor conserva la variante principal de la última evaluación exacta', async () => {
  const { MotorUci } = await import('../../js/motor.js');
  const motor = new MotorUci();
  motor.worker = { postMessage: texto => {
    if (!texto.startsWith('go ')) return;
    queueMicrotask(() => {
      for (const texto of ['info depth 16 score cp 40 pv e2e4 e7e5 g1f3', 'info depth 17 score cp 80 lowerbound pv d2d4', 'bestmove e2e4']) {
        for (const l of motor.lineas.slice()) l(texto);
      }
    });
  } };
  const r = await motor.analizar(fenInicialEjercicio, 16);
  assert.deepEqual(r.variante, ['e2e4', 'e7e5', 'g1f3']);
  assert.equal(r.centipeones, 40); assert.equal(r.profundidad, 16);
});
