// Las jugadas con figuritas (♘f3) en lugar de letras (Nf3), como en ChessBase.
const PIEZAS = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
const RE_LETRA = /(?<=^|\.|\s|…)([KQRBN])(?=[a-h1-8x])|(?<==)([QRBN])/g;

export const convertirFiguras = (jugada) => jugada.replace(RE_LETRA, (_, a, b) => PIEZAS[a ?? b]);

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** HTML de un texto con las figuritas un poco más grandes y con fuente de símbolos (con la normal salen pequeñas). */
export const figurasHtml = (texto) => esc(texto).replace(/[♔-♟]/g, c => `<span class="fig">${c}</span>`);

/** Para jugadas SAN o secuencias de jugadas: convierte las letras antes de crear el HTML. */
export const jugadaHtml = (texto) => figurasHtml(convertirFiguras(texto));
