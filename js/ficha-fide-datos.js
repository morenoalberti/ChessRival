import { htmlCargando } from './cargando.js';
import { codigoPais, urlBandera } from './banderas.js';
import { htmlTarjetasFide } from './panel-fide.js';
import { iniciales } from './dialogos.js';
import { nombreConTitulo } from './nombre-jugador.js';

const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const vacio = valor => valor === undefined || valor === null || valor === '' ? '—' : valor;

/** Sitúa la ficha junto a la tarjeta y siempre dentro de la pantalla. */
export function posicionFichaFide(tarjeta, ancho, alto, ventana) {
  const margen = 10, hueco = 8;
  let x = tarjeta.right + hueco;
  if (x + ancho > ventana.ancho - margen) x = tarjeta.left - ancho - hueco;
  x = Math.max(margen, Math.min(x, ventana.ancho - ancho - margen));
  const y = Math.max(margen, Math.min(tarjeta.top, ventana.alto - alto - margen));
  return { x, y };
}

function nombreFederacion(jugador, perfil) {
  const codigo = codigoPais(perfil?.paisCodigo || jugador.federation);
  try { if (codigo && !codigo.includes('-')) return new Intl.DisplayNames(['es'], { type: 'region' }).of(codigo.toUpperCase()); } catch {}
  return perfil?.federacionNombre || jugador.federation || '—';
}
function nombreRanking(nombre) {
  return nombre.replace(/^World Rank/i, 'Mundial').replace(/^National Rank/i, 'Nacional').replace(/^Continent Rank/i, 'Continental')
    .replace(/Europe/g, 'Europa').replace(/Americas/g, 'América').replace(/Africa/g, 'África');
}

export function htmlFichaFide(j, perfil = null, { foto = '', error = '', cargando = false } = {}) {
  const bandera = urlBandera(perfil?.paisCodigo || j.federation);
  const tituloJugador = perfil?.titulo || j.fideTitle || '';
  const nombreJugador = nombreConTitulo({ name: perfil?.nombre || j.name }, tituloJugador);
  const campos = [
    ['Federación', `${bandera ? `<img src="${esc(bandera)}" alt="" width="23" height="16">` : ''}${esc(nombreFederacion(j, perfil))}`],
    ['Año', esc(vacio(perfil?.nacimiento))], ['Género', esc(vacio(perfil?.genero))],
    ['Edad', esc(vacio(perfil ? perfil.edad : j.age))], ['Título', esc(vacio(tituloJugador))],
    ['Standard', esc(vacio(perfil ? perfil.elos?.standard : j.rating))],
    ['Rapid', esc(vacio(perfil?.elos?.rapid))], ['Blitz', esc(vacio(perfil?.elos?.blitz))]
  ];
  const bloques = perfil?.bloques ?? [];
  const rankings = perfil?.clasificaciones ?? [];
  return `<div class="fide-emergente-identidad"><h2 id="fide-emergente-nombre">${esc(nombreJugador)}</h2><p>FIDE ID: ${esc(j.fideId || '—')}</p>
    <div class="fide-emergente-perfil"><div class="fide-emergente-foto"><span>${esc(iniciales(j.name || ''))}</span>${foto ? `<img src="${esc(foto)}" alt="Foto de ${esc(nombreJugador)}" draggable="false">` : ''}</div>
    <dl>${campos.map(([titulo, valor]) => `<dt>${titulo}</dt><dd>${valor}</dd>`).join('')}</dl></div></div>
    <div class="fide-emergente-detalle" tabindex="0" aria-label="Evolución del ELO, estadísticas y rankings FIDE">
      <section class="fide-emergente-evolucion" aria-label="Evolución del ELO">
        <div class="fide-emergente-elo-cab"><h3>Evolución del ELO</h3><span class="fide-emergente-elo-leyenda"><span><i class="standard"></i>Standard</span><span><i class="rapid"></i>Rapid</span><span><i class="blitz"></i>Blitz</span></span></div>
        <div class="fide-emergente-elo" data-evolucion-elo><p class="suave" role="status">Cargando evolución del ELO…</p></div>
      </section>
      <h3>Estadísticas</h3>
      ${cargando ? `<p class="suave">${htmlCargando('Cargando datos de la FIDE…', { mini: true })}</p>` : error ? `<p class="fide-emergente-error">${esc(error)}</p>` : bloques.length ? htmlTarjetasFide(bloques, '', { arrastrable: false }) : '<p class="suave">No hay estadísticas FIDE disponibles.</p>'}
      ${bloques.length ? '<div class="fide-emergente-leyenda"><span><i class="victorias"></i>Victorias</span><span><i class="tablas"></i>Tablas</span><span><i class="derrotas"></i>Derrotas</span></div>' : ''}
      ${rankings.length ? `<h3>Rankings</h3><table class="fide-emergente-rankings"><thead><tr><th>Clasificación</th><th>Activos</th><th>Todos</th></tr></thead><tbody>${rankings.map(r => `<tr><th scope="row">${esc(nombreRanking(r.nombre))}</th><td>${esc(vacio(r.activos))}</td><td>${esc(vacio(r.todos))}</td></tr>`).join('')}</tbody></table>` : ''}
    </div><div class="fide-emergente-estado" role="status">${cargando ? 'Consultando FIDE…' : error ? 'No se ha podido cargar la ficha completa.' : perfil ? 'Ficha cargada' : 'Sin ficha FIDE'}</div>`;
}
