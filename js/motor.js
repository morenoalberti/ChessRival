import { LOCALE } from './i18n.js';
// Stockfish dentro de la página (stockfish.js 19, versión «lite» de un solo hilo, ≈1,7 MB): UciEngine.cs, MotorService.cs y EvaluadorArbol.cs.
// El motor habla UCI por postMessage dentro de un Web Worker: no bloquea la página.
const RUTA_MOTOR = 'assets/motor/stockfish-19-lite-single.js';
export const NOMBRE_MOTOR = 'Stockfish 19 lite';
/** Copias del motor que analizan partidas a la vez: los núcleos del equipo menos dos, para que la página siga fluida. */
export const PARALELO = Math.max(1, Math.min(6, (navigator.hardwareConcurrency ?? 4) - 2));

/** Un centipeón por cada centésima de peón; el mate se convierte en ±(10000 − n). */
const valorDe = (cp, mate) => (mate !== null ? (mate > 0 ? 10000 - mate : -10000 - mate) : (cp ?? 0));

export class MotorUci {
  constructor() {
    this.worker = null;
    this.lineas = [];          // escuchas pendientes
    this.cola = Promise.resolve();
  }

  static async iniciar() {
    const m = new MotorUci();
    m.worker = new Worker(RUTA_MOTOR);
    m.worker.onmessage = (e) => { const t = typeof e.data === 'string' ? e.data : String(e.data); for (const l of m.lineas.slice()) l(t); };
    m.worker.onerror = (e) => { for (const l of m.lineas.slice()) l('error ' + (e.message ?? '')); };
    await m.esperar('uci', (t) => t === 'uciok');
    m.enviar('setoption name Hash value 32');
    await m.esperar('isready', (t) => t === 'readyok');
    return m;
  }

  enviar(texto) { this.worker.postMessage(texto); }

  /** Envía una orden y espera la primera línea que cumpla la condición. */
  esperar(orden, cumple, onLinea) {
    return new Promise((ok, mal) => {
      const l = (t) => {
        if (t.startsWith('error ')) { this.lineas = this.lineas.filter(x => x !== l); mal(new Error('El motor ha dejado de responder.')); return; }
        onLinea?.(t);
        if (cumple(t)) { this.lineas = this.lineas.filter(x => x !== l); ok(t); }
      };
      this.lineas.push(l);
      if (orden) this.enviar(orden);
    });
  }

  nuevaPartida() { this.enviar('ucinewgame'); return this.esperar('isready', t => t === 'readyok'); }

  /** Analiza una posición hasta la profundidad dada. Una a la vez: el motor solo hace un análisis simultáneo.
   *  Devuelve { centipeones, mate, valor, mejorJugada, profundidad, variante } desde el punto de vista de quien mueve. */
  analizar(fen, profundidad, señal) {
    const tarea = this.cola.then(async () => {
      if (señal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      let cp = null, mate = null, prof = 0, variante = [];
      this.enviar('setoption name MultiPV value 1');
      this.enviar(`position fen ${fen}`);
      const abortar = () => { this.enviar('stop'); };
      señal?.addEventListener('abort', abortar, { once: true });
      let mejor = '';
      try {
        const final = await this.esperar(`go depth ${profundidad}`, t => t.startsWith('bestmove'), (t) => {
          if (!t.startsWith('info ') || t.includes('upperbound') || t.includes('lowerbound')) return;
          const p = t.split(' ');
          const i = p.indexOf('score');
          if (i < 0 || p.indexOf('pv') < 0) return;
          const v = parseInt(p[i + 2], 10);
          if (p[i + 1] === 'cp') { cp = v; mate = null; } else if (p[i + 1] === 'mate') { mate = v; cp = null; }
          const d = p.indexOf('depth');
          if (d >= 0) prof = parseInt(p[d + 1], 10);
          variante = p.slice(p.indexOf('pv') + 1);
        });
        mejor = final.split(' ')[1] ?? '';
      } finally { señal?.removeEventListener('abort', abortar); }
      if (señal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      return { centipeones: cp, mate, valor: valorDe(cp, mate), mejorJugada: mejor === '(none)' ? '' : mejor, profundidad: prof, variante };
    });
    this.cola = tarea.catch(() => {});
    return tarea;
  }

  /** Analiza una posición de forma continua («go infinite») y avisa a «alRecibir» cada vez que el motor mejora su evaluación, con varias
   *  líneas (MultiPV). Termina al cancelar la señal: se detiene el motor y se vacía su respuesta, así que el mismo motor puede analizar enseguida
   *  otra posición. «alRecibir» recibe { linea, profundidad, centipeones, mate, nps, variante: ['e2e4', …] } (desde quien mueve). */
  analizarEnVivo(fen, alRecibir, señal, lineas = 1) {
    const tarea = this.cola.then(async () => {
      if (señal.aborted) return;
      this.enviar(`setoption name MultiPV value ${Math.max(1, lineas)}`);
      this.enviar(`position fen ${fen}`);
      const parar = () => this.enviar('stop');
      señal.addEventListener('abort', parar, { once: true });
      try {
        await this.esperar('go infinite', t => t.startsWith('bestmove'), (t) => {
          if (!t.startsWith('info ') || t.includes('upperbound') || t.includes('lowerbound')) return;
          const p = t.split(' ');
          const iScore = p.indexOf('score'), iPv = p.indexOf('pv');
          if (iScore < 0 || iPv < 0 || iScore + 2 >= p.length) return;
          const valor = parseInt(p[iScore + 2], 10);
          if (!Number.isFinite(valor)) return;
          const num = (clave) => { const i = p.indexOf(clave); return i >= 0 ? parseInt(p[i + 1], 10) || 0 : 0; };
          alRecibir({
            linea: Math.max(1, num('multipv')), profundidad: num('depth'), nps: num('nps'), variante: p.slice(iPv + 1),
            centipeones: p[iScore + 1] === 'cp' ? valor : null, mate: p[iScore + 1] === 'mate' ? valor : null
          });
        });
        if (señal.aborted) return;
        // Terminó solo (por ejemplo, posición sin jugadas): nada más que hacer.
      } finally { señal.removeEventListener('abort', parar); }
    });
    this.cola = tarea.catch(() => {});
    return tarea;
  }

  cerrar() { try { this.worker?.terminate(); } catch { /* ya cerrado */ } this.worker = null; }
}

// ---------- Evaluador del árbol de aperturas ----------
// Guarda lo ya evaluado (una posición no se calcula dos veces). Las evaluaciones son siempre desde el punto de vista de las blancas.

export const PROFUNDIDAD_ARBOL = 12;

export class EvaluadorArbol {
  constructor() { this.cache = new Map(); this.mejores = new Map(); this.motor = null; this.liberado = false; }

  /** Centipeones desde el punto de vista de las blancas (con tope de ±15 peones), o null si se canceló o no hay motor. */
  async evaluar(fen, señal) {
    if (this.liberado) return null;
    if (this.cache.has(fen)) return this.cache.get(fen);
    try {
      this.motor ??= await MotorUci.iniciar();
      const e = await this.motor.analizar(fen, PROFUNDIDAD_ARBOL, señal);
      let valor = Math.max(-1500, Math.min(1500, e.valor));
      if (fen.split(' ')[1] === 'b') valor = -valor;       // el motor la da para quien mueve
      this.cache.set(fen, valor);
      this.mejores.set(fen, e.mejorJugada);
      return valor;
    } catch { return null; }
  }

  async mejorJugada(fen, señal) {
    if (await this.evaluar(fen, señal) === null) return null;
    return this.mejores.get(fen) || null;
  }

  liberar() { this.liberado = true; this.motor?.cerrar(); this.motor = null; }
}

/** El símbolo de ventaja de ChessBase para una evaluación desde las blancas: «=», «⩲», «±», «+−» y sus contrarios. */
export function simbolo(cp) {
  const a = Math.abs(cp);
  if (a < 25) return '=';
  if (a < 75) return cp > 0 ? '⩲' : '⩱';
  if (a < 175) return cp > 0 ? '±' : '∓';
  return cp > 0 ? '+−' : '−+';
}

/** «+0,35», «−1,20», «0,00»: la evaluación en peones, con la coma decimal y el signo. */
export function textoEval(cp) {
  if (Math.abs(cp) >= 1500) return cp > 0 ? '+M' : '−M';
  const t = (Math.abs(cp) / 100).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cp > 0 ? `+${t}` : cp < 0 ? `−${t}` : t;
}
