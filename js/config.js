// Dirección del servidor intermedio (Cloudflare Worker, carpeta worker/) que consulta FIDE, Chess-Results
// e Info64 por la web, porque el navegador no puede hacerlo directamente (CORS).
// En local usa `npm run dev` dentro de worker/; al publicar (npm run deploy dentro de worker/), la web usa el Worker desplegado.
const EN_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
export const PROXY_URL = EN_LOCAL ? 'http://127.0.0.1:8787' : 'https://chessrival-api.chessrival-worker.workers.dev';
