// Iconos de trazo (los mismos trazos que IconosBoton.cs de la versión de escritorio).
export const Iconos = {
  reiniciar: 'M20,12 A8,8 0 1 1 17.7,6.3 M20,3.5 V8 H15.5',
  reloj: 'M12,3 A9,9 0 1 0 12,21 A9,9 0 1 0 12,3 M12,7 V12 L15.5,14',
  copias: 'M3,5 C3,2 17,2 17,5 C17,8 3,8 3,5 Z M3,5 V13 C3,16 12,16 14,14 M3,9 C3,12 14,12 17,9 M17,5 V11 M18,13 V21 M14,17 L18,21 L22,17',
  video: 'M3,9 H21 V21 H3 Z M3,9 L2,4 L20,1 L21,6 Z M7,3 L6,8 M13,2 L12,7 M19,1 L18,6 M10,13 L16,16 L10,19 Z',
  ayuda: 'M12,2 A10,10 0 1 0 12,22 A10,10 0 1 0 12,2 M9,9 A3,3 0 0 1 15,9 C15,11 12,11 12,14 M12,18 V18.1',
  descargar: 'M12,4 V15 M7,10 L12,15 L17,10 M5,19 H19',
  subir: 'M12,16 V5 M7,10 L12,5 L17,10 M5,20 H19',
  mas: 'M12,5 V19 M5,12 H19',
  carpeta: 'M3,6 H9 L11,8 H21 V19 H3 Z',
  cambiar: 'M4,8 H19 M15,4 L19,8 L15,12 M20,16 H5 M9,12 L5,16 L9,20',
  equis: 'M6,6 L18,18 M18,6 L6,18',
  visto: 'M5,12.5 L10,17.5 L19,7',
  ojo: 'M2,12 C5,6 8,4 12,4 C16,4 19,6 22,12 C19,18 16,20 12,20 C8,20 5,18 2,12 Z M12,9 A3,3 0 1 0 12,15 A3,3 0 1 0 12,9',
  papelera: 'M4,7 H20 M9,7 V4 H15 V7 M6,7 L7,20 H17 L18,7 M10,11 V16 M14,11 V16',
  salir: 'M9,4 H5 V20 H9 M13,8 L18,12 L13,16 M18,12 H9',
  guardar: 'M5,4 H16 L20,8 V20 H5 Z M8,4 V9 H15 V4 M8,20 V14 H17 V20',
  enlace: 'M14,4 H20 V10 M20,4 L11,13 M18,14 V19 H5 V6 H10',
  barras: 'M5,20 V13 M12,20 V5 M19,20 V9',
  atras: 'M19,12 H5 M11,6 L5,12 L11,18',
  lista: 'M8,6 H21 M8,12 H21 M8,18 H21 M3.5,6 H4.5 M3.5,12 H4.5 M3.5,18 H4.5',
  flecha: 'M5,12 H19 M13,6 L19,12 L13,18',
  libro: 'M12,6 C10,4.5 6.5,4 3,4.5 V19 C6.5,18.5 10,19 12,20.5 C14,19 17.5,18.5 21,19 V4.5 C17.5,4 14,4.5 12,6 Z M12,6 V20.5',
  jugadores: 'M9,11 A3.5,3.5 0 1 0 9,4 A3.5,3.5 0 1 0 9,11 M2.5,20 C2.5,15.5 5.5,13.5 9,13.5 C12.5,13.5 15.5,15.5 15.5,20 M16,4.5 A3.5,3.5 0 0 1 16,11 M18,13.7 C20.2,14.5 21.5,16.5 21.5,20',
  motor: 'M7,7 H17 V17 H7 Z M10,10 H14 V14 H10 Z M9,3 V7 M15,3 V7 M9,17 V21 M15,17 V21 M3,9 H7 M3,15 H7 M17,9 H21 M17,15 H21'
};

/** Un <svg> de trazo del color del texto que lo rodea. */
export function svg(nombre, tam = 15) {
  return `<svg class="icono" viewBox="0 0 24 24" width="${tam}" height="${tam}" aria-hidden="true"><path d="${Iconos[nombre]}"/></svg>`;
}

/** Contenido de un botón: icono delante del texto. */
export function contenidoBoton(nombre, texto) {
  return `${svg(nombre)}<span>${texto}</span>`;
}

/** Rellena los marcadores [data-icono] del HTML. */
export function pintarIconosFijos() {
  for (const el of document.querySelectorAll('[data-icono]')) {
    el.innerHTML = svg(el.dataset.icono, 24);
  }
}

/** Un <svg> de trazo con cualquier trazado. */
export function svgTrazo(d, tam = 15) {
  return `<svg class="icono" viewBox="0 0 24 24" width="${tam}" height="${tam}" aria-hidden="true"><path d="${d}"/></svg>`;
}

/** Rellena los marcadores [data-trazo] del HTML. */
export function pintarTrazosFijos(raiz = document) {
  for (const e of raiz.querySelectorAll('[data-trazo]')) e.innerHTML = svgTrazo(e.dataset.trazo, 24);
}
