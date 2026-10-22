// Base de datos local en el navegador (IndexedDB). Hace de DatabaseService.cs de la versión de escritorio.
// Almacenes:  torneos · tarjetas (un jugador con tarjeta visible en la pestaña de un torneo) · ajustes.

export const URL_JUGADORES = 'chessrival:jugadores';

const NOMBRE = 'chessrival';
const VERSION = 3;
let _db = null;
let revisionVista = null;

function abrir() {
  if (_db) return Promise.resolve(_db);
  return new Promise((ok, mal) => {
    const req = indexedDB.open(NOMBRE, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const nombres = db.objectStoreNames;
      if (!nombres.contains('torneos')) db.createObjectStore('torneos', { keyPath: 'id', autoIncrement: true });
      if (!nombres.contains('tarjetas')) db.createObjectStore('tarjetas', { keyPath: 'id', autoIncrement: true }).createIndex('torneoId', 'torneoId');
      if (!nombres.contains('ajustes')) db.createObjectStore('ajustes', { keyPath: 'clave' });
      // Versión 2: las partidas de cada jugador y su análisis con el motor
      if (!nombres.contains('partidas')) db.createObjectStore('partidas', { keyPath: 'id', autoIncrement: true }).createIndex('jugador', 'jugadorClave');
      if (!nombres.contains('analisis')) db.createObjectStore('analisis', { keyPath: 'partidaId' }).createIndex('jugador', 'jugadorClave');
      // Versión 3: lo que el usuario cambia en una partida en el visor (variantes, línea principal, anotaciones)
      if (!nombres.contains('ediciones')) db.createObjectStore('ediciones', { keyPath: 'partidaId' });
    };
    // Si otra pestaña antigua tiene la base abierta, la actualización espera a que se cierre o se recargue.
    req.onblocked = () => console.warn('ChessRival: hay otra pestaña antigua abierta; ciérrala o recárgala para actualizar los datos.');
    req.onsuccess = () => {
      _db = req.result;
      _db.onversionchange = () => { _db.close(); _db = null; };       // esta pestaña no estorba a una más nueva
      ok(_db);
    };
    req.onerror = () => mal(req.error);
  });
}

export const prom = (req) => new Promise((ok, mal) => { req.onsuccess = () => ok(req.result); req.onerror = () => mal(req.error); });

export async function tx(almacenes, modo, fn) {
  const db = await abrir();
  const originales = [].concat(almacenes);
  const vigilar = typeof window !== 'undefined';
  const nombres = vigilar ? [...new Set([...originales, 'ajustes'])] : originales;
  const t = db.transaction(nombres, modo);
  const fin = new Promise((ok, mal) => { t.oncomplete = ok; t.onerror = () => mal(t.error); t.onabort = () => mal(t.error ?? new DOMException('Transacción cancelada', 'AbortError')); });
  try {
    if (vigilar) {
      const revision = (await prom(t.objectStore('ajustes').get('datos_revision')))?.valor ?? '';
      if (revisionVista !== null && revisionVista !== revision) {
        window.dispatchEvent(new Event('chessrival-restaurado'));
        throw new Error('Se ha restaurado una copia. Recarga esta ventana para continuar.');
      }
      revisionVista = revision;
    }
    const res = await fn(...originales.map(a => t.objectStore(a)));
    await fin;
    if (vigilar && modo === 'readwrite') window.dispatchEvent(new Event('chessrival-datos'));
    return res;
  } catch (error) {
    try { t.abort(); } catch { /* ya terminada */ }
    await fin.catch(() => {});
    throw error;
  }
}

// ---- Ajustes ----

export async function leerAjuste(clave, porDefecto = null) {
  const fila = await tx('ajustes', 'readonly', a => prom(a.get(clave)));
  return fila ? fila.valor : porDefecto;
}

export async function guardarAjuste(clave, valor) {
  await tx('ajustes', 'readwrite', a => prom(a.put({ clave, valor })));
}

export const leerTorneoActual = () => leerAjuste('torneo_actual', null);
export const guardarTorneoActual = (id) => guardarAjuste('torneo_actual', id ?? null);

// ---- Torneos ----

/** Garantiza que exista el torneo especial «Jugadores» y devuelve su id. */
export async function torneoJugadoresId() {
  return tx('torneos', 'readwrite', async (t) => {
    const todos = await prom(t.getAll());
    const existente = todos.find(x => x.url === URL_JUGADORES);
    if (existente) return existente.id;
    return prom(t.add({ nombre: 'Jugadores', url: URL_JUGADORES, fuente: 'chess-results', orden: -1, cargadoEn: Date.now() }));
  });
}

/** Torneos con tarjetas visibles (los vacíos no muestran pestaña), con «Jugadores» siempre primero y el resto
 *  en el orden de sus pestañas; el más reciente como criterio de desempate. */
export async function listarTorneos() {
  await torneoJugadoresId();
  return tx(['torneos', 'tarjetas'], 'readonly', async (t, c) => {
    const [torneos, tarjetas] = await Promise.all([prom(t.getAll()), prom(c.getAll())]);
    const cuenta = new Map();
    for (const x of tarjetas) cuenta.set(x.torneoId, (cuenta.get(x.torneoId) ?? 0) + 1);

    return torneos
      .map(x => ({ id: x.id, nombre: x.nombre, url: x.url, orden: x.orden ?? 0, cargadoEn: x.cargadoEn ?? 0, visibles: cuenta.get(x.id) ?? 0 }))
      .filter(x => x.visibles > 0 || x.url === URL_JUGADORES)
      .sort((a, b) =>
        (a.url === URL_JUGADORES ? 0 : 1) - (b.url === URL_JUGADORES ? 0 : 1)
        || a.orden - b.orden || b.cargadoEn - a.cargadoEn || b.id - a.id);
  });
}

export async function guardarOrdenTorneos(ids) {
  await tx('torneos', 'readwrite', async (t) => {
    for (let i = 0; i < ids.length; i++) {
      const fila = await prom(t.get(ids[i]));
      if (fila) { fila.orden = i; await prom(t.put(fila)); }
    }
  });
}

/** Borra los datos de los jugadores que ya no conservan ninguna tarjeta. Dentro de la misma transacción. */
async function borrarDatosSinTarjetas(eliminadas, tarjetas, partidas, analisis, ediciones) {
  const conservados = new Set((await prom(tarjetas.getAll())).map(claveJugador));
  for (const clave of new Set(eliminadas.map(claveJugador))) {
    if (conservados.has(clave)) continue;
    for (const id of await prom(partidas.index('jugador').getAllKeys(clave))) {
      await prom(partidas.delete(id));
      await prom(ediciones.delete(id));
    }
    for (const id of await prom(analisis.index('jugador').getAllKeys(clave))) await prom(analisis.delete(id));
  }
}

/** Quita un torneo; conserva los datos de los jugadores que siguen en otras pestañas. */
export async function cerrarTorneo(id) {
  await tx(['torneos', 'tarjetas', 'partidas', 'analisis', 'ediciones'], 'readwrite', async (t, c, p, a, e) => {
    const tarjetas = await prom(c.index('torneoId').getAll(id));
    for (const tarjeta of tarjetas) await prom(c.delete(tarjeta.id));
    await prom(t.delete(id));
    await borrarDatosSinTarjetas(tarjetas, c, p, a, e);
  });
}

/** Guarda un torneo cargado desde una URL con sus jugadores (los primeros) y devuelve su id.
 *  Si ya estaba (misma clave), se sustituyen sus tarjetas. */
export async function guardarTorneo({ nombre, url, clave, jugadores }) {
  return tx(['torneos', 'tarjetas'], 'readwrite', async (t, c) => {
    const todos = await prom(t.getAll());
    let torneo = todos.find(x => x.clave === clave);
    if (torneo) {
      torneo.nombre = nombre; torneo.url = url; torneo.cargadoEn = Date.now();
      await prom(t.put(torneo));
      for (const k of await prom(c.index('torneoId').getAllKeys(torneo.id))) await prom(c.delete(k));
    } else {
      const orden = Math.max(0, ...todos.filter(x => x.url !== URL_JUGADORES).map(x => x.orden ?? 0)) + 1;
      const id = await prom(t.add({ nombre, url, clave, fuente: 'chess-results', orden, cargadoEn: Date.now() }));
      torneo = { id };
    }
    let orden = 0;
    for (const j of jugadores) await prom(c.add(nuevaTarjeta({ ...j, torneoId: torneo.id, orden: orden++ })));
    return torneo.id;
  });
}

// ---- Tarjetas ----

function nuevaTarjeta(d) {
  return {
    torneoId: 0, orden: 0, rank: 0, name: '', federation: '', rating: 0, points: '', fideId: '',
    gamesCount: 0, sources: '—', status: 'SinPartidas', age: '—', fideTitle: '', photo: null,
    ...d
  };
}

export async function cargarPantalla(torneoId) {
  return tx('tarjetas', 'readonly', async (c) => {
    const lista = await prom(c.index('torneoId').getAll(torneoId));
    return lista.sort((a, b) => a.orden - b.orden);
  });
}

/** Todas las tarjetas (pestaña «Todos»), agrupadas por torneo (el más reciente primero) y en el orden de cada uno. */
export async function cargarTodos() {
  return tx(['torneos', 'tarjetas'], 'readonly', async (t, c) => {
    const [torneos, tarjetas] = await Promise.all([prom(t.getAll()), prom(c.getAll())]);
    const info = new Map(torneos.map(x => [x.id, x]));
    return tarjetas.sort((a, b) => {
      const ta = info.get(a.torneoId), tb = info.get(b.torneoId);
      return ((tb?.cargadoEn ?? 0) - (ta?.cargadoEn ?? 0)) || (b.torneoId - a.torneoId) || (a.orden - b.orden);
    });
  });
}

export const claveJugador = (j) => j.fideId ? `f:${j.fideId}` : `n:${j.name.trim().toLowerCase()}`;

/** Foto y títulos se comparten entre todas las tarjetas del mismo ID FIDE. */
export async function actualizarTarjetasJugador(fideId, cambios) {
  if (!fideId) return;
  await tx('tarjetas', 'readwrite', async c => {
    const tarjetas = await prom(c.getAll());
    await Promise.all(tarjetas.filter(j => String(j.fideId) === String(fideId)).map(j => prom(c.put({ ...j, ...cambios }))));
  });
}

/** Añade un jugador a la pestaña de un torneo (o a «Jugadores»). Devuelve false si ya tenía tarjeta ahí. */
export async function anadirJugador(jugador, torneoId) {
  return tx('tarjetas', 'readwrite', async (c) => {
    const lista = await prom(c.index('torneoId').getAll(torneoId));
    if (lista.some(x => claveJugador(x) === claveJugador(jugador))) return false;
    const orden = Math.max(-1, ...lista.map(x => x.orden)) + 1;
    await prom(c.add(nuevaTarjeta({ ...jugador, torneoId, orden })));
    return true;
  });
}

/** Quita solo esta tarjeta. Borra los datos del jugador al quitar su última tarjeta. */
export async function quitarTarjeta(id) {
  await tx(['tarjetas', 'partidas', 'analisis', 'ediciones'], 'readwrite', async (c, p, a, e) => {
    const tarjeta = await prom(c.get(id));
    if (!tarjeta) return;
    await prom(c.delete(id));
    await borrarDatosSinTarjetas([tarjeta], c, p, a, e);
  });
}

/** Guarda el orden de las tarjetas: dentro de cada torneo, el de su posición en la lista. */
export async function guardarOrden(lista) {
  await tx('tarjetas', 'readwrite', async (c) => {
    const contador = new Map();
    for (const j of lista) {
      const n = contador.get(j.torneoId) ?? 0;
      contador.set(j.torneoId, n + 1);
      const fila = await prom(c.get(j.id));
      if (fila && fila.orden !== n) { fila.orden = n; await prom(c.put(fila)); }
    }
  });
}

/** Pasa una tarjeta a otra pestaña. Si el jugador ya está allí, la tarjeta de origen se descarta. */
export async function moverJugador(jugador, torneoDestino) {
  await tx('tarjetas', 'readwrite', async (c) => {
    const fila = await prom(c.get(jugador.id));
    if (!fila) return;
    const destino = await prom(c.index('torneoId').getAll(torneoDestino));
    if (destino.some(x => claveJugador(x) === claveJugador(fila))) { await prom(c.delete(fila.id)); return; }
    fila.torneoId = torneoDestino;
    fila.orden = Math.max(-1, ...destino.map(x => x.orden)) + 1;
    await prom(c.put(fila));
  });
}

export async function actualizarTarjeta(id, cambios) {
  await tx('tarjetas', 'readwrite', async (c) => {
    const fila = await prom(c.get(id));
    if (fila) await prom(c.put({ ...fila, ...cambios }));
  });
}

export async function obtenerTarjeta(id) {
  return tx('tarjetas', 'readonly', c => prom(c.get(id)));
}
