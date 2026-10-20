import { tx, prom } from './db.js';

/** Incremento atómico: dos fichas abiertas no se pisan los intentos ni los ejercicios resueltos. */
export function registrarIntentoEjercicio(clave, id, acierto) {
  return tx('ajustes', 'readwrite', async store => {
    const progreso = (await prom(store.get(clave)))?.valor || {};
    const anterior = progreso[id] || { intentos: 0, resuelto: false };
    progreso[id] = { intentos: anterior.intentos + 1, resuelto: anterior.resuelto || acierto, fecha: Date.now() };
    await prom(store.put({ clave, valor: progreso }));
    return progreso;
  });
}

/** Pone todos los ejercicios del jugador como pendientes (se borran los intentos y los resueltos). */
export function reiniciarEjercicios(clave) {
  return tx('ajustes', 'readwrite', store => prom(store.put({ clave, valor: {} })));
}
