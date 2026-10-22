import { leerAjuste, guardarAjuste } from './db.js';

/** Reutiliza fotos descargadas, pero vuelve a consultar las antiguas entradas «sin foto».
 * Una respuesta vacía de la fuente no demuestra que el jugador no tenga fotografía. */
export async function fotoJugador(id, descargar) {
  if (!id) return '';
  const clave = 'foto:' + id;
  const guardada = await leerAjuste(clave);
  if (typeof guardada === 'string' && guardada) return guardada;
  const foto = await descargar(id);
  if (foto) await guardarAjuste(clave, foto);
  return foto;
}
