// «¿Qué debemos jugar?»: la recomendación concreta contra el jugador estudiado (2 opciones con blancas y 2 con negras).
// Pantalla 1: la respuesta · Pantalla 2: por qué y cómo jugarla · Pantalla 3: la hoja de preparación.
import { Chess } from './vendor/chess.js';
import { leerPgn, jugadasDe } from './pgn.js';
import * as Ap from './aperturas.js';
import { jugadaHtml, convertirFiguras } from './figuritas.js';
import { Tablero } from './tablero.js';
import { EvaluadorArbol, simbolo } from './motor.js';
import { abrirPanel } from './panel-utilidad.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => Math.round(x * 100);

const PESO_MEDIA = 4;        // «partidas virtuales» con su media: pocas partidas no pueden dar un resultado extremo
const MINIMO = 3;            // partidas mínimas para recomendar una línea como principal
const PLIES_MAX = 14;
const EN_ESTUDIO = 6;        // cuántas candidatas por color se revisan con Stockfish antes de quedarse con las dos mejores
const PEOR_PARA_TI = -60;    // una línea donde Stockfish te ve peor que esto se descarta

/** Fiabilidad por número de partidas: <5 muy baja, 5–14 baja, 15–29 media, ≥30 alta. */
export function fiabilidad(n) {
  return n < 5 ? { texto: 'muy baja', puntos: 1 } : n < 15 ? { texto: 'baja', puntos: 2 } : n < 30 ? { texto: 'media', puntos: 3 } : { texto: 'alta', puntos: 4 };
}

const cacheSan = new WeakMap();
function jugadasSan(partida) {
  if (cacheSan.has(partida)) return cacheSan.get(partida);
  let san = [];
  try {
    const leida = leerPgn(partida.pgn)[0];
    if (leida && !leida.cab('FEN')) {
      const t = new Chess();
      for (const s of jugadasDe(leida.jugadas).slice(0, PLIES_MAX)) { try { san.push(t.move(s).san); } catch { break; } }
    }
  } catch { san = []; }
  cacheSan.set(partida, san);
  return san;
}

/** La línea más habitual de un grupo de partidas: [{ san, ply, share, n, tasa }]. */
function lineaComun(lista) {
  let activos = lista.map(p => ({ san: jugadasSan(p), p })).filter(x => x.san.length);
  const total = activos.length, minimo = total <= 2 ? total : Math.max(2, Math.ceil(total * 0.4));
  const pasos = [];
  for (let ply = 0; ply < PLIES_MAX; ply++) {
    const cuenta = new Map();
    for (const a of activos) if (a.san[ply]) cuenta.set(a.san[ply], (cuenta.get(a.san[ply]) ?? 0) + 1);
    const [san, veces] = [...cuenta].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!san || veces < minimo) break;
    const siguen = activos.filter(a => a.san[ply] === san);
    pasos.push({ san, ply, share: veces / activos.length, n: activos.length, tasa: siguen.reduce((s, a) => s + a.p.puntos, 0) / siguen.length });
    activos = siguen;
  }
  return pasos;
}

function grupos(partidas, suColor, clave) {
  const mapa = new Map();
  for (const p of partidas) {
    if (p.colorJugador !== suColor || p.puntos === null) continue;
    const k = clave(p);
    (mapa.get(k) ?? mapa.set(k, []).get(k)).push(p);
  }
  return mapa;
}

/** Recomendaciones para jugar con «nuestro» color contra el jugador estudiado: lo que peor le sale a él. */
export function calcular(partidas, nuestro) {
  const suColor = nuestro === 'B' ? 'N' : 'B';
  const suyas = partidas.filter(p => p.colorJugador === suColor && p.puntos !== null);
  if (!suyas.length) return { nuestro, total: 0, media: null, candidatas: [] };
  const media = suyas.reduce((s, p) => s + p.puntos, 0) / suyas.length;
  const amplia = (p) => { const j = p.primerMovimiento ? convertirFiguras(p.primerMovimiento) : '—'; return nuestro === 'B' || !p.respuesta ? j : `${j} ${convertirFiguras(p.respuesta)}`; };
  const todas = [...grupos(partidas, suColor, nuestro === 'B' ? Ap.etiqueta : Ap.etiquetaDefensa), ...grupos(partidas, suColor, amplia)].map(([clave, lista]) => {
    const pts = lista.reduce((s, p) => s + p.puntos, 0), n = lista.length;
    const linea = lineaComun(lista);
    return { clave, lista, n, tasa: pts / n, ajustada: (pts + PESO_MEDIA * media) / (n + PESO_MEDIA), linea, nuestro };
  }).filter(g => g.linea.length);
  const fiables = todas.filter(g => g.n >= MINIMO).sort((a, b) => a.ajustada - b.ajustada || b.n - a.n);
  const pocas = todas.filter(g => g.n < MINIMO).sort((a, b) => a.ajustada - b.ajustada);
  const candidatas = [...fiables, ...pocas].slice(0, EN_ESTUDIO);
  return { nuestro, total: suyas.length, media, candidatas, todas };
}

/** El nombre con las figuras solo en las jugadas: convertir también el nombre de la apertura estropearía palabras («Defensa de la Plata»). */
function tituloHtml(g) {
  const [jug, fam] = g.clave.split(' · ');
  if (fam === undefined) return jugadaHtml(jug);
  return g.nuestro === 'B' && Ap.ladoQueLaJuega(g.clave) === 'N' ? `${jugadaHtml(jug)} (contra su ${esc(fam)})` : `${jugadaHtml(jug)} · ${esc(fam)}`;
}
function tituloTexto(g) {
  const [jug, fam] = g.clave.split(' · ');
  return fam === undefined ? convertirFiguras(jug) : `${convertirFiguras(jug)} · ${fam}`;
}
const SIMBOLOS_TEXTO = [[175, 'gran ventaja para ti'], [75, 'ventaja para ti'], [25, 'ligera ventaja para ti']];
function textoEval(cpTuyo) {
  if (cpTuyo === undefined) return { s: '…', t: 'calculando' };
  const a = Math.abs(cpTuyo);
  if (a < 25) return { s: '=', t: 'igualada' };
  const s = simbolo(cpTuyo);
  if (cpTuyo > 0) return { s, t: SIMBOLOS_TEXTO.find(([m]) => a >= m)[1] };
  return { s, t: a >= 175 ? 'gran desventaja para ti' : a >= 75 ? 'desventaja para ti' : 'ligera desventaja para ti' };
}

function fensDe(g) {
  const t = new Chess(), fens = [t.fen()], mov = [null];
  for (const p of g.linea) { const m = t.move(p.san); fens.push(t.fen()); mov.push([m.from, m.to]); }
  return { fens, mov };
}
const fenFinal = (g) => fensDe(g).fens.at(-1);

const dots = (n) => [1, 2, 3, 4].map(i => `<i class="qj-punto${i <= n ? ' on' : ''}${n === 1 ? ' bajo' : n === 4 ? ' alto' : ' medio'}"></i>`).join('');
const fichaColor = (c) => `<i class="qj-ficha ${c === 'B' ? 'b' : 'n'}"></i>`;

function chips(g) {
  const nuestras = g.nuestro === 'B' ? 0 : 1;
  return `<div class="qj-jug">${g.linea.map((p, i) => {
    const num = p.ply % 2 === 0 ? `${p.ply / 2 + 1}.` : '';
    return `<span class="${p.ply % 2 === nuestras ? 'mia' : 'suya'}">${num}${jugadaHtml(p.san)}</span>`;
  }).join('')}</div>`;
}

export function montarQueJugar(contenedor, { nombreJugador = () => '', apellido = () => 'el jugador', alVerPartidas = () => {} } = {}) {
  let partidas = [], debilidades = [], vista = 'resumen', actual = null;
  const datos = { B: null, N: null };
  const evaluador = new EvaluadorArbol(), evals = new Map();   // fen → centipeones (desde las blancas)
  let generacion = 0, reloj = null, tablero = null, fens = [], movs = [], paso = 0;

  const tuEval = (g) => { const cp = evals.get(fenFinal(g)); return cp === undefined ? undefined : g.nuestro === 'B' ? cp : -cp; };

  function elegidas(c) {
    const lista = c.candidatas.filter(g => { const e = tuEval(g); return e === undefined || e >= PEOR_PARA_TI; });
    const pool = lista.length >= 2 ? lista : c.candidatas, primera = pool[0];
    if (!primera) return [];
    const otra = pool.slice(1).find(g => g.clave.split(' ')[0] !== primera.clave.split(' ')[0]) ?? pool[1];
    return otra ? [primera, otra] : [primera];
  }

  function tarjeta(g, i, color) {
    const e = textoEval(tuEval(g)), f = fiabilidad(g.n), media = datos[color].media;
    const delta = pct(media - g.tasa);
    const porque = g.n < MINIMO ? 'Pocas partidas: úsala como sorpresa, no como plan principal.'
      : delta >= 5 ? `Es su punto flojo: aquí rinde ${delta} puntos por debajo de su media.`
      : delta > -5 ? 'Es una línea que conoce, pero sin ventaja clara para él: la más fiable por número de partidas.'
      : 'Aquí rinde mejor que su media; es la más segura entre las que conoce menos.';
    return `<button type="button" class="qj-rec ${i === 0 ? 'prin' : 'alt'}" data-qj-ver="${color}:${i}" title="Pulsa para ver por qué se recomienda y cómo jugarla">
      <div class="qj-rec-cab"><span class="qj-tag">${g.n < MINIMO ? 'POCOS DATOS' : i === 0 ? '★ RECOMENDADA' : 'ALTERNATIVA'}</span><span class="qj-ver">Ver por qué y cómo jugarla ›</span></div>
      <h3>${tituloHtml(g)}</h3>
      ${chips(g)}
      <div class="qj-datos"><div><div class="qj-barra"><i style="width:${pct(g.tasa)}%"></i><u style="left:${pct(media)}%"></u></div>
        ${i === 0 ? `<small>Él puntúa contra esto · la raya es su media con ${color === 'B' ? 'negras' : 'blancas'} (${pct(media)} %)</small>` : ''}</div>
        <div class="qj-num">${pct(g.tasa)} %<small>${g.n} ${g.n === 1 ? 'partida' : 'partidas'}</small></div></div>
      <p class="qj-porque">${esc(porque)}</p>
      <div class="qj-meta"><span>Fiabilidad ${dots(f.puntos)} ${f.texto}</span><span data-qj-eval="${esc(fenFinal(g))}" data-qj-color="${g.nuestro}">Stockfish: <b class="qj-simb">${e.s}</b> ${e.t}</span></div>
    </button>`;
  }

  function columna(color) {
    const c = datos[color], quien = color === 'B' ? 'blancas' : 'negras';
    const cab = `<div class="qj-col-tit">${fichaColor(color)}CUANDO LLEVAS LAS ${quien.toUpperCase()}</div>`;
    if (!c.total) return `<div>${cab}<p class="vacio-texto">Todavía no hay partidas suyas con ${color === 'B' ? 'negras' : 'blancas'}: importa más para poder recomendarte algo.</p></div>`;
    return `<div>${cab}${elegidas(c).map((g, i) => tarjeta(g, i, color)).join('')}</div>`;
  }

  function respuesta() {
    const b = elegidas(datos.B)[0], n = elegidas(datos.N)[0];
    const l1 = b ? `Con blancas, juega <b>${tituloHtml(b)}</b>.` : '';
    const l2 = n ? `Con negras, responde con <b>${tituloHtml(n)}</b>.` : '';
    return `<div class="qj-respuesta"><span class="qj-sello">RESPUESTA</span><div class="qj-txt">${[l1, l2].filter(Boolean).join('<br>')}
      <small>Son las opciones donde ${esc(apellido())} puntúa menos y que Stockfish considera sólidas para ti.</small></div></div>`;
  }

  function pintarResumen() {
    const hay = datos.B.total + datos.N.total;
    if (!hay) {
      contenedor.innerHTML = '<div class="estado-vacio"><b>Todavía no hay partidas de este jugador</b><p>Importa sus partidas y aquí aparecerá qué jugarle, con blancas y con negras.</p></div>';
      return;
    }
    contenedor.innerHTML = `<div class="qj-panel"><div class="qj-cab"><span>¿Qué debemos jugar contra ${esc(nombreJugador())}?</span></div><div class="qj-cuerpo">
      ${respuesta()}
      <div class="qj-dos">${columna('B')}${columna('N')}</div>
      <div class="qj-pie"><span>Calculado con sus ${datos.B.total + datos.N.total} partidas y Stockfish. Pulsa una opción para ver por qué se recomienda.</span>
        <button type="button" class="btn btn-primario" data-qj-hoja>${'Hoja de preparación'}</button></div></div></div>`;
  }

  // ---------- Pantalla 2 ----------
  function barras(color, g) {
    const c = datos[color];
    const filas = (c.todas ?? []).filter(x => x.n >= 2).sort((a, b) => a.ajustada - b.ajustada).slice(0, 6);
    if (!filas.includes(g)) filas.push(g);
    return filas.map(x => `<div class="qj-fila ${x === g ? 'sel' : ''}"><span class="lab">${tituloHtml(x)}${x === g ? ' ★' : ''}</span>
      <div class="bar"><i style="width:${pct(x.tasa)}%"></i><u style="left:${pct(c.media)}%"></u></div><span class="val">${pct(x.tasa)} % <small>${x.n} p.${x.n < MINIMO ? ' · pocas' : ''}</small></span></div>`).join('');
  }

  function esperable(g) {
    const suyos = g.linea.filter(p => p.ply % 2 !== (g.nuestro === 'B' ? 0 : 1)).slice(0, 4);
    if (!suyos.length) {      // línea de una sola jugada: lo que suele contestar a ella
      const ply = g.linea.length, cuenta = new Map();
      for (const p of g.lista) { const s = jugadasSan(p)[ply]; if (s) (cuenta.get(s) ?? cuenta.set(s, []).get(s)).push(p); }
      const total = [...cuenta.values()].reduce((a, l) => a + l.length, 0);
      if (!total) return '<p class="vacio-texto">Todavía no hay jugadas suyas en esta línea.</p>';
      const t = g.linea.map(q => q.san);
      const tras = jugadaHtml(`${t.length % 2 === 0 ? `${t.length / 2 + 1}.` : `${(t.length + 1) / 2}…`}${t.at(-1)}`);
      return `<table class="qj-tabla"><tr><th>Tras…</th><th>Suele jugar</th><th>Veces</th><th>Cómo le va</th></tr>${[...cuenta].sort((a, b) => b[1].length - a[1].length).slice(0, 3).map(([san, l]) =>
        `<tr><td>${tras}</td><td><b>${jugadaHtml(san)}</b></td><td>${pct(l.length / total)} %</td><td>${pct(l.reduce((s, p) => s + p.puntos, 0) / l.length)} %</td></tr>`).join('')}</table>`;
    }
    const previo = (p) => g.linea.slice(0, p.ply).map(q => q.san);
    return `<table class="qj-tabla"><tr><th>Tras…</th><th>Suele jugar</th><th>Veces</th><th>Cómo le va</th></tr>${suyos.map(p => {
      const t = previo(p), tras = t.length ? jugadaHtml(`${t.length % 2 === 0 ? `${t.length / 2 + 1}.` : `${(t.length + 1) / 2}…`}${t.at(-1)}`) : 'el inicio';
      return `<tr><td>${tras}</td><td><b>${jugadaHtml(p.san)}</b></td><td>${pct(p.share)} %</td><td>${pct(p.tasa)} %</td></tr>`;
    }).join('')}</table>`;
  }

  function porQueFunciona(color, g) {
    const c = datos[color], delta = pct(c.media - g.tasa), e = textoEval(tuEval(g)), items = [];
    items.push(delta > 0 ? `Contra esto rinde <b>${delta} puntos por debajo de su media</b> (${g.n} partidas).` : `Sus resultados aquí son <b>normales</b> (${pct(g.tasa)} % en ${g.n} partidas): es una línea que conoce.`);
    items.push(`Stockfish: al final de la línea hay <b class="qj-simb" data-qj-eval-simb>${e.s}</b> <b data-qj-eval-txt>${e.t}</b>.`);
    if (debilidades[0]) items.push(`Su debilidad principal, <b>«${esc(debilidades[0].titulo)}»</b>, es un buen motivo para llevarle a un juego largo y posicional.`);
    const primera = g.clave.split(' ')[0];
    const peligro = (c.todas ?? []).filter(x => x !== g && x.n >= MINIMO && x.tasa >= 0.6 && x.clave.split(' ')[0] === primera).sort((a, b) => b.tasa - a.tasa)[0];
    return `<ul class="qj-lista">${items.map(i => `<li>${i}</li>`).join('')}</ul>${peligro ? `<div class="qj-aviso">⚠ <b>Cuidado:</b> en ${tituloHtml(peligro)} sí puntúa ${pct(peligro.tasa)} % (${peligro.n} partidas). Evítalo.</div>` : ''}`;
  }

  function pintarDetalle(color, i) {
    const c = datos[color], g = elegidas(c)[i];
    if (!g) { vista = 'resumen'; pintarResumen(); return; }
    actual = { color, i, g };
    ({ fens, mov: movs } = fensDe(g));
    paso = fens.length - 1;
    contenedor.innerHTML = `<div class="qj-panel"><div class="qj-cab"><span>${color === 'B' ? 'Con blancas' : 'Con negras'}: ${tituloHtml(g)}</span></div><div class="qj-cuerpo">
      <div class="qj-migas"><button type="button" class="btn btn-primario qj-volver" data-qj-volver>${'Volver a la respuesta'}</button><span>Contra ${esc(nombreJugador())} · tú llevas las <b>${color === 'B' ? 'blancas' : 'negras'}</b>, él las <b>${color === 'B' ? 'negras' : 'blancas'}</b></span></div>
      <div class="qj-grid"><div class="qj-izq"><div data-qj-tablero></div>${chips(g)}
        <div class="qj-ctrl"><button type="button" class="btn" data-qj-ant>‹ Anterior</button><button type="button" class="btn" data-qj-sig>Siguiente ›</button><button type="button" class="btn btn-primario" data-qj-rep>▶ Reproducir</button></div>
        <div class="qj-ley">Azul: tus jugadas · Gris: las suyas</div></div>
        <div class="qj-der">
          <div class="qj-caja"><h4>① Dónde le va peor (sus resultados con ${color === 'B' ? 'negras' : 'blancas'})</h4>${barras(color, g)}<div class="qj-ley">La raya negra es su media (${pct(c.media)} %). Cuanto más a la izquierda, mejor para ti.</div></div>
          <div class="qj-caja"><h4>② Qué esperar de él en esta línea</h4>${esperable(g)}</div>
          <div class="qj-caja"><h4>③ Por qué funciona</h4>${porQueFunciona(color, g)}</div>
        </div></div>
      <div class="qj-acc"><button type="button" class="btn btn-secundario qj-ver-partidas" data-qj-partidas>${`Ver sus ${g.n} partidas en esta línea`}</button><button type="button" class="btn btn-primario" data-qj-arbol>Estudiar la línea en el Árbol</button></div></div></div>`;
    tablero = new Tablero(contenedor.querySelector('[data-qj-tablero]'), { casilla: 44 });
    irAPaso(paso);
  }

  function irAPaso(i) {
    paso = Math.max(0, Math.min(fens.length - 1, i));
    const m = movs[paso];
    tablero.mostrar(fens[paso], m?.[0] ?? null, m?.[1] ?? null, actual.color === 'N');
    contenedor.querySelectorAll('.qj-izq .qj-jug span').forEach((s, k) => s.classList.toggle('actual', k === paso - 1));
  }

  function parar() { clearInterval(reloj); reloj = null; const b = contenedor.querySelector('[data-qj-rep]'); if (b) b.textContent = '▶ Reproducir'; }
  function reproducir() {
    if (reloj) { parar(); return; }
    if (paso >= fens.length - 1) irAPaso(0);
    contenedor.querySelector('[data-qj-rep]').textContent = '❚❚ Parar';
    reloj = setInterval(() => { if (paso >= fens.length - 1) parar(); else irAPaso(paso + 1); }, 900);
  }

  // ---------- Pantalla 3: la hoja ----------
  function textoLinea(g) {
    return g.linea.map(p => `${p.ply % 2 === 0 ? `${p.ply / 2 + 1}.` : ''}${convertirFiguras(p.san)}`).join(' ');
  }

  function filasHoja() {
    return ['B', 'N'].flatMap(color => datos[color].total ? elegidas(datos[color]).map((g, i) => ({ color, g, principal: i === 0 })) : []);
  }

  function htmlHoja() {
    const filas = filasHoja();
    const tabla = `<table class="qj-plan"><tr><th>Tu color</th><th>Qué jugar</th><th>Línea</th><th>Él puntúa</th><th>Fiabilidad</th></tr>${filas.map(({ color, g, principal }) =>
      `<tr class="${principal ? 'prin' : ''}"><td class="col">${fichaColor(color)}${color === 'B' ? 'Blancas' : 'Negras'}</td><td><div class="nom">${principal ? '★ ' : ''}${tituloHtml(g)}</div></td>
      <td class="lin">${esc(textoLinea(g))}</td><td><b>${pct(g.tasa)} %</b> · ${g.n} p.</td><td>${fiabilidad(g.n).texto}</td></tr>`).join('')}</table>`;
    const d = debilidades.slice(0, 3);
    return `<div class="qj-hoja"><h2>Preparación contra ${esc(nombreJugador())}</h2>
      <div class="qj-fecha">Basada en ${datos.B.total + datos.N.total} partidas y Stockfish · ${new Date().toLocaleDateString()}</div>${tabla}
      <div class="qj-tres"><div class="qj-caja"><h4>🎯 Dónde falla (aprovéchalo)</h4>${d.length ? `<ul class="qj-lista">${d.map(x => `<li>${esc(x.titulo)}</li>`).join('')}</ul>` : '<p class="vacio-texto">Analiza sus partidas para ver aquí sus debilidades.</p>'}</div>
      <div class="qj-caja"><h4>🧭 Plan de la partida</h4><ol class="qj-pasos"><li>Llega a la línea recomendada sin desviarte en la apertura.</li><li>Busca posiciones que no controle: pierde más cuando se sale de lo que conoce.</li><li>Si sale la primera línea mal, cambia a la alternativa: está pensada para eso.</li></ol></div></div>
      <div class="qj-acc"><button type="button" class="btn" data-qj-copiar>Copiar texto</button><button type="button" class="btn btn-primario" data-qj-imprimir>Imprimir / guardar PDF</button></div></div>`;
  }

  function textoPlano() {
    return [`Preparación contra ${nombreJugador()}`, ...filasHoja().map(({ color, g, principal }) => `${color === 'B' ? 'Blancas' : 'Negras'}${principal ? ' ★' : ''}: ${tituloTexto(g)} — ${textoLinea(g)} (él puntúa ${pct(g.tasa)} % en ${g.n} partidas)`)].join('\n');
  }

  function abrirHoja() {
    abrirPanel('Hoja de preparación', htmlHoja(), 'qj-panel-hoja');
    const panel = document.querySelector('.qj-panel-hoja');
    panel?.querySelector('[data-qj-copiar]')?.addEventListener('click', async (e) => {
      try { await navigator.clipboard.writeText(textoPlano()); e.currentTarget.textContent = 'Copiado'; } catch { /* sin permiso para el portapapeles */ }
    });
    panel?.querySelector('[data-qj-imprimir]')?.addEventListener('click', () => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;width:0;height:0;border:0';
      f.srcdoc = `<meta charset="utf-8"><title>Preparación</title><style>body{font:14px system-ui;padding:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:6px;text-align:left}.qj-acc,button{display:none}.qj-ficha{display:none}</style>${panel.querySelector('.qj-hoja').outerHTML}`;
      f.onload = () => { f.contentWindow.print(); setTimeout(() => f.remove(), 2000); };
      document.body.appendChild(f);
    });
  }

  // ---------- Eventos y datos ----------
  contenedor.addEventListener('click', (e) => {
    const ver = e.target.closest('[data-qj-ver]');
    if (ver) { const [color, i] = ver.dataset.qjVer.split(':'); vista = 'detalle'; pintarDetalle(color, Number(i)); return; }
    if (e.target.closest('[data-qj-volver]')) { parar(); vista = 'resumen'; pintarResumen(); return; }
    if (e.target.closest('[data-qj-hoja]')) { abrirHoja(); return; }
    if (e.target.closest('[data-qj-ant]')) { parar(); irAPaso(paso - 1); return; }
    if (e.target.closest('[data-qj-sig]')) { parar(); irAPaso(paso + 1); return; }
    if (e.target.closest('[data-qj-rep]')) { reproducir(); return; }
    if (e.target.closest('[data-qj-arbol]')) { document.querySelector('[data-pestana="arbol"]')?.click(); return; }
    if (e.target.closest('[data-qj-partidas]') && actual) {
      parar();
      // La misma muestra que sustenta el recuento y los resultados de la recomendación.
      alVerPartidas({ ids: actual.g.lista.map(p => p.id), titulo: tituloTexto(actual.g) });
    }
  });

  function actualizarEval() {
    for (const s of contenedor.querySelectorAll('[data-qj-eval]')) {
      const cp = evals.get(s.dataset.qjEval);
      if (cp === undefined) continue;
      const e = textoEval(s.dataset.qjColor === 'B' ? cp : -cp);
      s.innerHTML = `Stockfish: <b class="qj-simb">${e.s}</b> ${e.t}`;
    }
    if (actual && vista === 'detalle') {
      const e = textoEval(tuEval(actual.g));
      const a = contenedor.querySelector('[data-qj-eval-simb]'), b = contenedor.querySelector('[data-qj-eval-txt]');
      if (a) a.textContent = e.s; if (b) b.textContent = e.t;
    }
  }

  async function estudiarConMotor() {
    const mia = ++generacion;
    const pendientes = ['B', 'N'].flatMap(c => datos[c].candidatas).filter(g => !evals.has(fenFinal(g)));
    for (const g of pendientes) {
      if (mia !== generacion) return;
      const fen = fenFinal(g), cp = await evaluador.evaluar(fen);
      if (mia !== generacion || cp === null) return;
      evals.set(fen, cp);
      const antes = JSON.stringify(['B', 'N'].map(c => elegidas(datos[c]).map(x => x.clave)));
      actualizarEval();
      const ahora = JSON.stringify(['B', 'N'].map(c => elegidas(datos[c]).map(x => x.clave)));
      if (antes !== ahora && vista === 'resumen') pintarResumen();      // Stockfish descartó una línea: se muestra la siguiente
    }
  }

  return {
    pintar(vis, listaDebilidades = []) {
      partidas = vis; debilidades = listaDebilidades;
      datos.B = calcular(vis, 'B'); datos.N = calcular(vis, 'N');
      parar(); vista = 'resumen'; pintarResumen();
      estudiarConMotor();
    },
    alMostrar() { if (vista === 'resumen' && (datos.B?.total || datos.N?.total)) actualizarEval(); },
    liberar() { generacion++; evaluador.liberar(); }
  };
}
