// Vista previa de una partida al pasar el ratón (VistaPreviaPartida.xaml): jugadores y resultado arriba, el tablero en una posición temprana
// a la izquierda y las jugadas a la derecha, como una planilla.
import { Chess } from './vendor/chess.js';
import { Tablero } from './tablero.js';
import { leerPgn, jugadasDe } from './pgn.js';
import { convertirFiguras, figurasHtml } from './figuritas.js';

const JUGADA_VISTA = 10;        // jugada (contando las de blancas y negras) hasta la que se juega la posición que se dibuja
const FILAS_OBJETIVO = 12;      // filas que se intentan no superar al repartir la partida en columnas
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let tarjeta = null, temporizador = null;

/** Escribe todas las jugadas, de dos en dos («12.♘f3 ♘c6»), repartidas en columnas de unas FILAS_OBJETIVO filas y leídas de arriba abajo. */
function planilla(jugadas, fen, resultado) {
  let blancas = true, numero = 1;
  if (fen) { const c = fen.split(' '); blancas = !c[1] || c[1] === 'w'; numero = Math.max(1, parseInt(c[5], 10) || 1); }
  const pares = []; let actual = '';
  for (const san of jugadas) {
    if (blancas) actual = `${numero}.${san}`;
    else { actual = actual ? `${actual} ${san}` : `${numero}...${san}`; pares.push(actual); actual = ''; numero++; }
    blancas = !blancas;
  }
  if (actual) pares.push(actual);                                   // la última jugada de las blancas, sin respuesta
  if (resultado && pares.length) pares[pares.length - 1] += '  ' + resultado;
  if (!pares.length) return '';
  const columnas = Math.min(6, Math.max(2, Math.ceil(pares.length / FILAS_OBJETIVO)));
  const filas = Math.ceil(pares.length / columnas);
  return `<div class="vp-jugadas" style="grid-template-rows:repeat(${filas}, auto);grid-auto-flow:column">${pares.map(p => `<span>${figurasHtml(convertirFiguras(p))}</span>`).join('')}</div>`;
}

function construir(partida, tituloJugador) {
  const leida = leerPgn(partida.pgn)[0];
  if (!leida) return null;
  const conTitulo = (nombre, titulo) => (titulo && titulo !== '-' && titulo !== '?' ? `${titulo} ${nombre}` : nombre);
  const tit = (delPgn, esElJugador) => (delPgn && delPgn !== '-' ? delPgn : esElJugador ? tituloJugador : '');
  const blancas = conTitulo(leida.cab('White') || '?', tit(leida.cab('WhiteTitle'), partida.colorJugador === 'B'));
  const negras = conTitulo(leida.cab('Black') || '?', tit(leida.cab('BlackTitle'), partida.colorJugador === 'N'));
  const eloB = leida.cab('WhiteElo') ? ` (${leida.cab('WhiteElo')})` : '', eloN = leida.cab('BlackElo') ? ` (${leida.cab('BlackElo')})` : '';
  const resultado = partida.resultado === '1/2-1/2' ? '½-½' : partida.resultado;

  const jugadas = jugadasDe(leida.jugadas);
  const desdeInicio = !leida.cab('FEN');
  const tablero = desdeInicio ? new Chess() : new Chess(leida.cab('FEN'));
  let hechas = 0;
  for (const san of jugadas.slice(0, JUGADA_VISTA)) { try { tablero.move(san); hechas++; } catch { break; } }
  const posicion = hechas > 0 && desdeInicio ? `Posición tras ${Math.ceil(hechas / 2)}${hechas % 2 === 1 ? '.' : '...'}${convertirFiguras(jugadas[hechas - 1])}` : '';

  const div = document.createElement('div');
  div.className = 'vista-previa';
  div.innerHTML = `
    <div class="vp-titulo recortar">${esc(blancas)}${esc(eloB)} – ${esc(negras)}${esc(eloN)} &nbsp; ${esc(resultado)}</div>
    <div class="vp-subtitulo suave recortar">${esc([partida.fechaMostrada, partida.evento].filter(Boolean).join(' · '))}</div>
    <div class="vp-cuerpo">
      <div class="vp-izq"><div class="vp-tablero"></div><div class="suave vp-pos">${figurasHtml(posicion)}</div></div>
      ${planilla(jugadas, desdeInicio ? null : leida.cab('FEN'), ['1-0', '0-1', '1/2-1/2'].includes(partida.resultado) ? resultado : null)}
    </div>
    <div class="vp-pie">Doble clic para seguir la partida hasta el final con el motor.</div>`;
  new Tablero(div.querySelector('.vp-tablero'), { casilla: 30 }).mostrar(tablero.fen());
  return div;
}

export function mostrarVistaPrevia(partida, tituloJugador, evento) {
  ocultarVistaPrevia();
  const { clientX } = evento;
  const anclaje = evento.target.closest('tr') ?? evento.target;
  temporizador = setTimeout(() => {
    const contenido = construir(partida, tituloJugador);
    if (!contenido) return;
    tarjeta = document.createElement('div');
    tarjeta.className = 'vp-tarjeta';
    tarjeta.appendChild(contenido);
    document.body.appendChild(tarjeta);
    const w = tarjeta.offsetWidth, h = tarjeta.offsetHeight;
    // Nunca sobre la fila que se está mirando (así se puede hacer doble clic en ella): debajo de la fila o, si no cabe, encima.
    const fila = anclaje.getBoundingClientRect();
    const hueco = 6;
    let arriba = fila.bottom + hueco;
    if (arriba + h > innerHeight - 8 && fila.top - hueco - h >= 8) arriba = fila.top - hueco - h;
    const anchoUtil = document.documentElement.clientWidth;      // sin la barra de desplazamiento
    const izquierda = Math.max(8, Math.min(clientX - w * 0.35, anchoUtil - w - 8));
    tarjeta.style.left = `${izquierda + scrollX}px`;
    tarjeta.style.top = `${Math.max(8, arriba) + scrollY}px`;
    requestAnimationFrame(() => tarjeta?.classList.add('visible'));
  }, 250);
}

export function ocultarVistaPrevia() {
  clearTimeout(temporizador);
  tarjeta?.remove();
  tarjeta = null;
}
