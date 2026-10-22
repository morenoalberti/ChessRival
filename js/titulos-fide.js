export const VERSION_TITULOS_FIDE = 2;

const nombres = {
  grandmaster: 'GM', 'international master': 'IM', 'fide master': 'FM', 'candidate master': 'CM',
  'woman grandmaster': 'WGM', 'woman international master': 'WIM', 'woman fide master': 'WFM', 'woman candidate master': 'WCM',
  'arena grandmaster': 'AGM', 'arena international master': 'AIM', 'arena fide master': 'AFM', 'arena candidate master': 'ACM'
};
const codigos = new Set(Object.values(nombres));

/** Títulos de jugador FIDE y FOA, sin duplicados ni valores «None». */
export function normalizarTitulosFide(...valores) {
  const titulos = [];
  for (const valor of valores.flat()) {
    for (const parte of String(valor ?? '').split(/\s*[/·,;]\s*/)) {
      const limpio = parte.trim().replace(/\s+/g, ' ');
      const titulo = nombres[limpio.toLowerCase()];
      const lista = titulo ? [titulo] : limpio.toUpperCase().split(/\s+/).filter(t => codigos.has(t));
      for (const t of lista) if (!titulos.includes(t)) titulos.push(t);
    }
  }
  return titulos.join('/');
}

/** Un respaldo parcial no puede borrar un título Arena ya obtenido de la FIDE. */
export function cambiosIdentidadFide(jugador, ficha) {
  const cambios = {};
  if (!ficha) return cambios;
  const completos = ficha.titulosCompletos === true;
  const titulo = normalizarTitulosFide(...(completos ? [ficha.titulo] : [jugador.fideTitle, ficha.titulo]));
  if (titulo !== (jugador.fideTitle || '')) cambios.fideTitle = titulo;
  if (ficha.edad && ficha.edad !== jugador.age) cambios.age = ficha.edad;
  if (completos || ficha.titulo || ficha.edad) cambios.titulosOk = true;
  if (completos) cambios.versionTitulosFide = VERSION_TITULOS_FIDE;
  return cambios;
}

/** Los títulos FOA verificados completan el respaldo que Lichess no publica. */
export function completarTitulosVerificados(id, ficha, entradas) {
  if (ficha?.fuente === 'FIDE' && ficha.titulosCompletos) return ficha;
  const entrada = entradas.find(e => e.idFide === String(id) && Array.isArray(e.titulos));
  if (!entrada) return ficha;
  return { ...ficha, titulo: normalizarTitulosFide(ficha?.titulo, entrada.titulos).replace(/\//g, ' · '),
    fuente: 'FIDE (copia verificada)', titulosCompletos: true, fechaTitulos: entrada.consultado };
}
