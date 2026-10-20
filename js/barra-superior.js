import { IDIOMA, cambiarIdioma } from './i18n.js';
import { svg } from './iconos.js';
import { abrirCopias } from './copias-dialogo.js';
import { abrirAyuda, abrirVideo } from './ayuda.js';
import { iniciarCopiasAutomaticas } from './copias.js';

const barra = document.createElement('header');
barra.className = 'barra-superior';
barra.innerHTML = `<span class="barra-marca"><img src="assets/icon.png" alt="" width="21" height="21">ChessRival 1.0</span>
  <nav aria-label="Opciones de la aplicación">
    <button type="button" class="bandera${IDIOMA === 'es' ? ' activa' : ''}" data-idioma="es" title="Español" aria-label="Español" aria-pressed="${IDIOMA === 'es'}"><img src="https://flagcdn.com/w40/es.png" alt="" width="24" height="16" draggable="false"></button>
    <button type="button" class="bandera${IDIOMA === 'en' ? ' activa' : ''}" data-idioma="en" title="English" aria-label="English" aria-pressed="${IDIOMA === 'en'}"><img src="https://flagcdn.com/w40/gb.png" alt="" width="24" height="16" draggable="false"></button>
    <button type="button" data-copias title="Copias de seguridad" aria-label="Copias de seguridad">${svg('copias', 22)}</button>
    <button type="button" data-video title="Vídeo tutorial" aria-label="Vídeo tutorial">${svg('video', 22)}</button>
    <button type="button" data-ayuda title="Ayuda (F1)" aria-label="Ayuda">${svg('ayuda', 23)}</button>
  </nav>`;
document.getElementById('raiz')?.prepend(barra);
const ayudaActual = () => document.querySelector('.panel-copias') ? 'copias' : document.body.classList.contains('pagina-visor') ? 'visor' : document.body.classList.contains('pagina-ficha') ? 'ficha' : 'inicio';
barra.querySelectorAll('[data-idioma]').forEach(b => b.addEventListener('click', () => cambiarIdioma(b.dataset.idioma)));
const marcarBandera = (idioma) => barra.querySelectorAll('[data-idioma]').forEach(b => { const activa = b.dataset.idioma === idioma; b.classList.toggle('activa', activa); b.setAttribute('aria-pressed', String(activa)); });
window.addEventListener('chessrival-idioma', e => marcarBandera(e.detail));
barra.querySelector('[data-copias]').addEventListener('click', abrirCopias);
barra.querySelector('[data-video]').addEventListener('click', abrirVideo);
document.addEventListener('click', e => { if (e.target.closest('[data-licencias]')) { e.preventDefault(); abrirAyuda('licencias'); } });
barra.querySelector('[data-ayuda]').addEventListener('click', () => abrirAyuda(ayudaActual()));
document.addEventListener('keydown', e => { if (e.key === 'F1') { e.preventDefault(); abrirAyuda(ayudaActual()); } });
window.addEventListener('chessrival-restaurado', () => location.replace('index.html'));
try { const canal = new BroadcastChannel('chessrival-restauracion'); canal.onmessage = () => location.replace('index.html'); } catch {}
iniciarCopiasAutomaticas();
