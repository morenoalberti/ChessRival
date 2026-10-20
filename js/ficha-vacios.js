// Estados vacíos de las pestañas de la ficha: en vez de una línea suelta, una tarjeta con icono, qué falta y un botón que lo resuelve
// («Importar partidas» cuando el jugador no tiene ninguna; «Analizar» cuando las tiene pero Stockfish aún no las ha revisado).
import { svg, contenidoBoton } from './iconos.js';

const TEXTOS = {
  partidas: {
    icono: 'lista', sin: ['Todavía no hay partidas', 'Importa sus partidas para verlas aquí, con su fecha, sus rivales y el resultado de cada una.']
  },
  aperturas: {
    icono: 'libro', sin: ['Sin aperturas todavía', 'Cuando importes sus partidas verás qué abre con blancas y con negras, y cómo le va con cada apertura.']
  },
  arbol: {
    icono: 'flecha', sin: ['El árbol está vacío', 'Con sus partidas importadas verás qué juega en cada posición, jugada a jugada.']
  },
  informe: {
    icono: 'lista', sin: ['Sin informe todavía', 'Importa sus partidas para ver cuántas son fiables, contra qué rivales juega y qué patrones se repiten.']
  },
  preparacion: {
    icono: 'jugadores', sin: ['Sin recomendaciones todavía', 'Importa sus partidas para saber qué abre y qué conviene prepararle.']
  },
  debilidades: {
    icono: 'barras', sin: ['Aún no hay nada que analizar', 'Importa sus partidas y Stockfish te dirá dónde falla.'],
    analizar: ['Falta el análisis', 'Ya tienes sus partidas. Stockfish las revisa jugada a jugada para descubrir dónde falla.']
  },
  entrenamiento: {
    icono: 'motor', sin: ['Sin ejercicios todavía', 'Importa y analiza sus partidas: de sus errores graves saldrán ejercicios para entrenar.'],
    analizar: ['Falta el análisis', 'Stockfish convierte sus errores graves en ejercicios. Analiza sus partidas para generarlos.']
  }
};

/** @param {{ partidas: number, analizadas: number, importar: Function, analizar: Function }} e  partidas: las importadas; analizadas: jugadas con análisis. */
export function pintarVacios({ partidas, analizadas, importar, analizar }) {
  for (const [panel, t] of Object.entries(TEXTOS)) {
    const seccion = document.querySelector(`.seccion[data-panel="${panel}"]`);
    if (!seccion) continue;
    const caso = partidas === 0 ? 'sin' : (t.analizar && analizadas === 0) ? 'analizar' : null;
    let tarjeta = seccion.querySelector(':scope > [data-vacio-ficha]');
    seccion.classList.toggle('sin-datos', !!caso);
    if (!caso) { tarjeta?.remove(); continue; }
    if (tarjeta?.dataset.caso === caso) continue;       // ya está pintada
    tarjeta?.remove();
    const [titulo, texto] = t[caso];
    tarjeta = document.createElement('div');
    tarjeta.className = 'vacio-ficha'; tarjeta.dataset.vacioFicha = ''; tarjeta.dataset.caso = caso;
    tarjeta.innerHTML = `<div class="vacio-ficha-icono">${svg(t.icono, 30)}</div><h3></h3><p></p>
      <button type="button" class="btn ${caso === 'sin' ? 'btn-primario' : 'btn-coral'}">${caso === 'sin' ? contenidoBoton('descargar', 'Importar partidas') : contenidoBoton('barras', 'Analizar')}</button>`;
    tarjeta.querySelector('h3').textContent = titulo;
    tarjeta.querySelector('p').textContent = texto;
    tarjeta.querySelector('button').addEventListener('click', caso === 'sin' ? importar : analizar);
    seccion.prepend(tarjeta);
  }
}
