// Tamaño exterior de la ventana según la captura de referencia del visor.
export const TAMANO_VISOR = Object.freeze({ ancho: 1160, alto: 917 });

/** Centra el visor y apoya su borde inferior sobre el área disponible, sin tapar la barra de tareas. */
export function calcularVentanaVisor(pantalla) {
  const anchoDisponible = Math.max(1, pantalla.availWidth || pantalla.width || TAMANO_VISOR.ancho);
  const altoDisponible = Math.max(1, pantalla.availHeight || pantalla.height || TAMANO_VISOR.alto);
  const ancho = Math.min(TAMANO_VISOR.ancho, anchoDisponible);
  const alto = Math.min(TAMANO_VISOR.alto, altoDisponible);
  return {
    ancho,
    alto,
    izquierda: Math.round((pantalla.availLeft || 0) + (anchoDisponible - ancho) / 2),
    arriba: Math.round((pantalla.availTop || 0) + altoDisponible - alto)
  };
}

export function ajustarVentanaVisor(ventana, pantalla = ventana.screen) {
  const { ancho, alto, izquierda, arriba } = calcularVentanaVisor(pantalla);
  try {
    // window.open interpreta width/height como tamaño interior; resizeTo fija las medidas exteriores.
    ventana.resizeTo(ancho, alto);
    ventana.moveTo(izquierda, arriba);
  } catch { /* algunos navegadores limitan el movimiento de ventanas */ }
}

/** Una ventana por partida. Se puede redimensionar y mover libremente después de abrirla. */
export function abrirVentanaVisor(partidaId, navegador = window, { ply = null } = {}) {
  const { ancho, alto, izquierda, arriba } = calcularVentanaVisor(navegador.screen);
  const opciones = `popup=yes,width=${ancho},height=${alto},left=${izquierda},top=${arriba},resizable=yes,scrollbars=yes`;
  // Un nombre distinto al antiguo evita reutilizar una pestaña normal, que no se puede redimensionar.
  const posicion = Number.isInteger(ply) && ply >= 0 ? `&ply=${ply}` : '';
  const ventana = navegador.open(`visor.html?id=${partidaId}&ventana=1${posicion}`, `visor-ventana-${partidaId}`, opciones);
  if (ventana) {
    ajustarVentanaVisor(ventana, navegador.screen);
    ventana.focus();
  }
  return ventana;
}
