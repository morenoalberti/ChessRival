// Análisis de una partida en el visor (parte de VisorPartidaWindow.xaml.cs): precisión de cada jugador con el método de Lichess, marcas de error y
// las conclusiones, que solo dicen lo que sostienen los datos del motor.
import { materialSinPeones } from './analizador.js';
import { convertirFiguras } from './figuritas.js';
import { puntos } from './debilidades.js';
import { t as tr, decimal } from './i18n.js';   // las frases se componen ya traducidas, por trozos

export const PROFUNDIDAD_ANALISIS = 18;
export const TOPE = 1000;

const FEN_INICIAL = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const mueveBlancasEn = (fen) => fen.split(' ')[1] === 'w';
const decimales = (x, n = 1) => decimal(x, n);

/** Probabilidad de ganar (0-100) para una evaluación en centipeones, con la curva de Lichess. */
const probabilidadDeGanar = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);

const desviacion = (xs) => { const m = xs.reduce((s, x) => s + x, 0) / xs.length; return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length); };

/** Media de la media ponderada por la volatilidad de la partida y la media armónica. */
function mediaPrecision(datos) {
  if (!datos.length) return null;
  const ponderada = datos.reduce((s, d) => s + d.precision * d.peso, 0) / datos.reduce((s, d) => s + d.peso, 0);
  const armonica = datos.length / datos.reduce((s, d) => s + 1 / Math.max(d.precision, 0.001), 0);
  return (ponderada + armonica) / 2;
}

/** «valores»: evaluación de cada posición desde quien mueve. Devuelve { blancas, negras, detalle: [{ ply, blancas, precision, peso }] }. */
export function calcularPrecisiones(valores, fens, blancasEmpiezan) {
  const jugadas = fens.length - 1;
  if (jugadas < 2) return { blancas: null, negras: null, detalle: [] };

  // Probabilidad de ganar de las blancas en cada posición (la inicial cuenta como +15 cp, como en Lichess).
  const blancasGanan = fens.map((fen, i) => probabilidadDeGanar(i === 0 && fen === FEN_INICIAL ? 15 : valores[i] * (mueveBlancasEn(fen) ? 1 : -1)));

  // Peso de cada jugada: desviación típica de la probabilidad en una ventana alrededor (entre 0,5 y 12).
  const ventana = Math.min(8, Math.max(2, Math.trunc(jugadas / 10)));
  const ventanas = [];
  for (let i = 0; i < ventana - 2; i++) ventanas.push(blancasGanan.slice(0, ventana));
  for (let i = 0; i + ventana <= blancasGanan.length; i++) ventanas.push(blancasGanan.slice(i, i + ventana));

  const propias = { blancas: [], negras: [] }, detalle = [];
  for (let i = 0; i < jugadas && i < ventanas.length; i++) {
    const peso = Math.min(12, Math.max(0.5, desviacion(ventanas[i])));
    const mueveBlancas = (i % 2 === 0) === blancasEmpiezan;
    const antes = mueveBlancas ? blancasGanan[i] : 100 - blancasGanan[i];
    const despues = mueveBlancas ? blancasGanan[i + 1] : 100 - blancasGanan[i + 1];
    const precision = Math.min(100, Math.max(0, 103.1668100711649 * Math.exp(-0.04354415386753951 * Math.max(0, antes - despues)) - 3.166924740191411 + 1));
    (mueveBlancas ? propias.blancas : propias.negras).push({ precision, peso });
    detalle.push({ ply: i + 1, blancas: mueveBlancas, precision, peso });
  }
  return { blancas: mediaPrecision(propias.blancas), negras: mediaPrecision(propias.negras), detalle };
}

/** Fase de la partida en la que se juega la jugada «ply»: apertura (primeras 10 jugadas), final (poco material) o medio juego. */
export const faseDe = (ply, fens) => (ply <= 20 ? 'apertura' : materialSinPeones(fens[ply - 1]) <= 24 ? 'final' : 'medio juego');

/** Precisión de un jugador en una fase, con el mismo método que la total; null si jugó menos de tres jugadas en ella. */
export function precisionEnFase(detalle, blancas, fase, fens) {
  const datos = detalle.filter(d => d.blancas === blancas && faseDe(d.ply, fens) === fase);
  return datos.length < 3 ? null : mediaPrecision(datos);
}

/** «igualdad», «ligera ventaja», «ventaja», «ventaja clara» o «ventaja decisiva», con la cifra cuando no es decisiva. «contra»: dicho de una desventaja. */
function describir(cp, contra = false) {
  const a = Math.abs(cp);
  if (a < 50) return tr('igualdad');
  const base = a < 100 ? 'ligera ventaja' : a < 200 ? 'ventaja' : a < 500 ? 'ventaja clara' : 'ventaja decisiva';
  const texto = tr(contra ? base.replace('ventaja', 'desventaja') : base);
  return a >= 500 ? texto : `${texto}, ${cp > 0 ? '+' : '−'}${puntos(a)}`;
}

/** Los errores (marca, pérdida y mejor jugada) a partir de las evaluaciones: valores desde quien mueve en cada posición. */
export function calcularErrores(valores, sansDe, mejorEnSan, blancasEmpiezan) {
  const errores = new Map();
  for (let ply = 1; ply <= sansDe; ply++) {
    const perdida = Math.max(0, valores[ply - 1] + valores[ply]);                 // el valor de después es del rival: se invierte
    const marca = perdida >= 300 ? '??' : perdida >= 150 ? '?' : perdida >= 70 ? '?!' : null;
    if (!marca) continue;
    errores.set(ply, { ply, blancas: (ply % 2 === 1) === blancasEmpiezan, marca, perdida, mejor: mejorEnSan(ply - 1) });
  }
  return errores;
}

/** «Sin errores» / «1 error grave · 2 imprecisiones». */
export function resumenErrores(errores, blancas) {
  const propios = [...errores.values()].filter(x => x.blancas === blancas);
  if (!propios.length) return tr('Sin errores');
  const partes = [];
  const contar = (marca, unica, plural) => { const n = propios.filter(x => x.marca === marca).length; if (n) partes.push(`${n} ${tr(n === 1 ? unica : plural)}`); };
  contar('??', 'error grave', 'errores graves');
  contar('?', 'error', 'errores');
  contar('?!', 'imprecisión', 'imprecisiones');
  return partes.join(' · ');
}

export const corto = (nombre) => (!nombre || !nombre.trim() ? '?' : nombre.split(',')[0].trim());

/** Lo que se puede decir de un jugador a partir de esta partida, de más a menos importante. */
function valorarJugador(c, blancas, ev, resultado) {
  const fuertes = [], debiles = [];
  const suya = ev.map(v => (blancas ? v : -v));                                  // evaluación desde su punto de vista
  const gana = resultado === (blancas ? '1-0' : '0-1'), pierde = resultado === (blancas ? '0-1' : '1-0');

  // Errores propios
  const propios = [...c.errores.values()].filter(x => x.blancas === blancas);
  const graves = propios.filter(x => x.marca === '??').length, errores = propios.filter(x => x.marca === '?').length;
  if (graves > 0) debiles.push(`${graves} ${tr(graves === 1 ? 'error grave' : 'errores graves')}`);
  else if (errores >= 2) debiles.push(`${errores} ${tr('errores')}`);
  if (graves === 0 && errores === 0) fuertes.push(tr('ningún error: solo, como mucho, imprecisiones'));

  // Ventajas: convertidas o desaprovechadas
  const mejorMomento = Math.max(...suya), peorMomento = Math.min(...suya);
  const desv = (cp) => describir(cp, true);
  if (mejorMomento >= 200 && gana) fuertes.push(tr(`convirtió su ventaja (${describir(mejorMomento)})`));
  else if (mejorMomento >= 200 && !gana) debiles.push(tr(`llegó a tener ${describir(mejorMomento)} y no ganó`));
  if (peorMomento <= -150 && gana) fuertes.push(tr(`remontó una posición peor (${desv(peorMomento)})`));
  else if (peorMomento <= -200 && pierde) debiles.push(tr(`no logró salvar una posición con ${desv(peorMomento)}`));

  // Fases: la mejor y la peor, si se distinguen claramente
  const fases = ['apertura', 'medio juego', 'final'].map(f => ({ fase: f, valor: precisionEnFase(c.detalle, blancas, f, c.fens) })).filter(x => x.valor !== null);
  if (fases.length >= 2) {
    const mejor = [...fases].sort((a, b) => b.valor - a.valor)[0], peor = [...fases].sort((a, b) => a.valor - b.valor)[0];
    if (mejor.valor - peor.valor >= 8) {
      const nombre = (f) => tr(f === 'apertura' ? 'la apertura' : 'el ' + f);
      fuertes.push(tr(`su mejor fase fue ${nombre(mejor.fase)} (${decimales(mejor.valor)} %)`));
      debiles.push(tr(`su fase más floja fue ${nombre(peor.fase)} (${decimales(peor.valor)} %)`));
    }
  }

  // Cómo salió de la apertura
  if (ev.length > 21) {
    const alSalir = suya[20];
    if (alSalir >= 50) fuertes.push(tr(`salió de la apertura mejor (${describir(alSalir)})`));
    else if (alSalir <= -80) debiles.push(tr(`salió de la apertura peor (${desv(alSalir)})`));
  }

  // Precisión total
  const pr = blancas ? c.precisionBlancas : c.precisionNegras;
  if (pr !== null && pr !== undefined) {
    if (pr >= 92) fuertes.push(tr(`juego muy preciso en conjunto (${decimales(pr)} %)`));
    else if (pr < 80) debiles.push(tr(`juego poco preciso en conjunto (${decimales(pr)} %)`));
  }

  // Coincidencia con la primera opción del motor
  if (c.mejores) {
    let jugadas = 0, coinciden = 0;
    for (let ply = 1; ply <= c.casillasP.length && ply - 1 < c.mejores.length; ply++) {
      const mueveBlancas = (ply % 2 === 1) === c.blancasEmpiezan;
      if (mueveBlancas !== blancas || !c.mejores[ply - 1] || c.mejores[ply - 1].length < 4) continue;
      jugadas++;
      const [desde, hasta] = c.casillasP[ply - 1];
      if (c.mejores[ply - 1].startsWith(desde + hasta)) coinciden++;
    }
    if (jugadas >= 12) {
      const porc = coinciden * 100 / jugadas;
      if (porc >= 55) fuertes.push(tr(`coincidió con la primera opción de Stockfish en ${coinciden} de ${jugadas} jugadas (${Math.round(porc)} %)`));
      else if (porc < 30) debiles.push(tr(`solo coincidió con la primera opción de Stockfish en ${coinciden} de ${jugadas} jugadas (${Math.round(porc)} %)`));
    }
  }
  return { fuertes, debiles };
}

/** Los comentarios más importantes que se deducen de la evaluación de Stockfish en cada posición. Solo se dice lo que los datos sostienen:
 *  una ventaja cuenta si se mantiene varias jugadas, y los calificativos dependen de cuántos puntos son.
 *  «c»: { partida, nombreBlancas, nombreNegras, valores, fens, sans, errores, detalle, precisionBlancas, precisionNegras, mejores, casillasP, blancasEmpiezan, numeroInicial }.
 *  Devuelve [{ titulo, texto }]. */
export function construirConclusiones(c) {
  const res = [];
  const nb = corto(c.nombreBlancas), nn = corto(c.nombreNegras);
  const nombre = (blancas) => (blancas ? nb : nn);
  const blancasMueven = (ply) => (ply % 2 === 1) === c.blancasEmpiezan;
  const numeroDe = (ply) => c.numeroInicial + (c.blancasEmpiezan ? Math.trunc((ply - 1) / 2) : Math.trunc(ply / 2));
  const jugada = (ply) => `${numeroDe(ply)}${blancasMueven(ply) ? '.' : '...'}${convertirFiguras(c.sans[ply - 1])}`;

  // Evaluación de cada posición desde las blancas (los valores del análisis son desde quien mueve).
  const n = c.fens.length;
  const ev = c.fens.map((fen, i) => c.valores[i] * (mueveBlancasEn(fen) ? 1 : -1));

  // 1) Precisión
  if (c.precisionBlancas != null && c.precisionNegras != null) {
    const dif = Math.abs(c.precisionBlancas - c.precisionNegras);
    res.push({ titulo: tr('Precisión'), texto: tr(`${nb} ${decimales(c.precisionBlancas)} % y ${nn} ${decimales(c.precisionNegras)} %.`) + ' ' +
      (dif < 1.5 ? tr('Los dos jugaron con una precisión muy parecida.') : tr(`${c.precisionBlancas > c.precisionNegras ? nb : nn} jugó con más precisión.`)) });
  }

  // 1b) Precisión en cada fase (el final solo si se llegó a uno)
  {
    const lineas = [];
    for (const fase of ['apertura', 'medio juego', 'final']) {
      const b = precisionEnFase(c.detalle, true, fase, c.fens), g = precisionEnFase(c.detalle, false, fase, c.fens);
      if (b === null && g === null) continue;
      const F = (v) => (v !== null ? `${decimales(v)} %` : '—');
      lineas.push(`${tr(fase[0].toUpperCase() + fase.slice(1))}: ${nb} ${F(b)} · ${nn} ${F(g)}`);
    }
    if (lineas.length) {
      if (!lineas.some(l => l.startsWith(tr('Final')))) lineas.push(tr('No se llegó a un final.'));
      res.push({ titulo: tr('Precisión por fases'), texto: lineas.join('\n') });
    }
  }

  // 2) Errores de cada uno
  res.push({ titulo: tr('Errores'), texto: `${nb}: ${resumenErrores(c.errores, true).toLowerCase()}. ${nn}: ${resumenErrores(c.errores, false).toLowerCase()}.` });

  // 3) Cómo evolucionó: quién estuvo mejor, y desde cuándo hubo una ventaja que se mantuvo
  const mejorBlancas = ev.filter(v => v >= 50).length * 100 / n, mejorNegras = ev.filter(v => v <= -50).length * 100 / n;
  let texto = tr(`Estuvo mejor ${nb} durante el ${Math.round(mejorBlancas)} % de las posiciones y ${nn} durante el ${Math.round(mejorNegras)} %; el resto, la igualdad.`);
  let sostenida = null;      // primera jugada tras la cual una ventaja de 1 punto se mantiene al menos tres jugadas más
  for (let i = 1; i < n && sostenida === null; i++) {
    if (Math.abs(ev[i]) < 100) continue;
    const signo = Math.sign(ev[i]);
    let seMantiene = true;
    for (let j = i; j <= Math.min(i + 3, n - 1); j++) if (Math.sign(ev[j]) !== signo || Math.abs(ev[j]) < 70) { seMantiene = false; break; }
    if (seMantiene) sostenida = i;
  }
  texto += ' ' + (sostenida !== null
    ? tr(`La partida se mantuvo igualada hasta la jugada ${jugada(sostenida)} de ${nombre(blancasMueven(sostenida))}; desde ahí ${ev[sostenida] > 0 ? nb : nn} tuvo ventaja (${describir(ev[sostenida])}).`)
    : tr('Ninguno llegó a tener una ventaja de un punto que se mantuviera.'));
  res.push({ titulo: tr('Cómo evolucionó'), texto });

  // 4) El momento más importante: la jugada que más cuesta, con el calificativo que le corresponde
  if (c.errores.size > 0) {
    const peor = [...c.errores.values()].sort((a, b) => b.perdida - a.perdida)[0];
    const calificativo = tr(peor.perdida >= 300 ? 'El error más grave' : peor.perdida >= 150 ? 'El mayor error' : 'La mayor imprecisión');
    res.push({ titulo: tr('Momento clave'), texto: tr(`${calificativo} fue ${jugada(peor.ply)} de ${nombre(peor.blancas)}: pierde ${puntos(peor.perdida)}`) +
      (peor.mejor ? ' ' + tr(`y era mejor ${convertirFiguras(peor.mejor)}.`) : '.') });

    // 5) En qué fase se equivocó cada uno (solo errores, no imprecisiones, y solo si hay varios)
    const fases = [];
    for (const blancas of [true, false]) {
      const suyos = [...c.errores.values()].filter(x => x.blancas === blancas && x.marca !== '?!');
      if (suyos.length < 2) continue;
      const grupos = new Map();
      for (const x of suyos) grupos.set(faseDe(x.ply, c.fens), (grupos.get(faseDe(x.ply, c.fens)) ?? 0) + 1);
      const [fase, cuantos] = [...grupos].sort((a, b) => b[1] - a[1])[0];
      if (cuantos * 2 > suyos.length) fases.push(tr(`${nombre(blancas)} falló sobre todo en ${tr(fase === 'apertura' ? 'la apertura' : 'el ' + fase)} (${cuantos} de sus ${suyos.length} errores)`));
    }
    if (fases.length) res.push({ titulo: tr('Dónde se equivocaron'), texto: fases.join('; ') + '.' });
  }

  // 6) El resultado frente a lo que decía el análisis
  const resultado = c.partida.resultado;
  const ganaBlancas = resultado === '1-0' ? true : resultado === '0-1' ? false : null;
  if (ganaBlancas !== null) {
    const gb = ganaBlancas, ganador = nombre(gb), perdedor = nombre(!gb);
    const delGanador = ev.map(v => (gb ? v : -v));       // evaluación desde el punto de vista de quien ganó
    const partes = [];
    const peorDelGanador = Math.min(...delGanador);
    if (peorDelGanador <= -150) partes.push(tr(`${ganador} ganó tras haber estado peor, con ${describir(-peorDelGanador, true)}`));
    const maxPerdedor = Math.max(...delGanador.map(v => -v));
    if (maxPerdedor >= 200) partes.push(tr(`${perdedor} llegó a tener ${describir(maxPerdedor)} y acabó perdiendo`));
    if (!partes.length) partes.push(tr(`El resultado concuerda con el análisis: ${ganador} fue el que mejor estuvo`));
    // cuándo quedó decidida: desde la última posición en que el ganador no tenía al menos +2 puntos
    let ultima = -1;
    for (let i = delGanador.length - 1; i >= 0; i--) if (delGanador[i] < 200) { ultima = i; break; }
    if (ultima < n - 1 && ultima >= 0 && delGanador.at(-1) >= 200)
      partes.push(tr(`la partida quedó prácticamente decidida a partir de la jugada ${jugada(Math.max(1, ultima + 1))}, con ventaja sostenida de ${ganador}`));
    res.push({ titulo: tr('Resultado') + ' ' + resultado, texto: partes.join('; ') + '.' });
  } else if (resultado === '1/2-1/2') {
    const partes = [];
    if (Math.max(...ev) >= 200) partes.push(tr(`${nb} llegó a tener ${describir(Math.max(...ev))}`));
    if (-Math.min(...ev) >= 200) partes.push(tr(`${nn} llegó a tener ${describir(-Math.min(...ev))}`));
    res.push({ titulo: tr('Resultado') + ' ½-½', texto: partes.length ? tr('Terminó en tablas, pero') + ' ' + partes.join(tr(' y ')) + ' ' + tr('sin llegar a ganar.') : tr('Las tablas concuerdan con el análisis: nadie tuvo una ventaja clara.') });
  }

  // 7) Conclusión final: puntos fuertes y débiles de cada jugador, solo con lo que muestran los datos de esta partida
  for (const blancas of [true, false]) {
    const { fuertes, debiles } = valorarJugador(c, blancas, ev, resultado);
    const lista = (l) => (l.length === 0 ? tr('nada destacable en esta partida') : l.slice(0, 3).join('; '));
    res.push({ titulo: (blancas ? tr('Puntos fuertes y débiles') + ' · ' : '') + nombre(blancas), texto: `${tr('Fuertes:')} ${lista(fuertes)}.\n${tr('Débiles:')} ${lista(debiles)}.` });
  }

  res.push({ titulo: '', texto: tr(`Basado en el análisis de Stockfish a profundidad ${PROFUNDIDAD_ANALISIS}: son valores orientativos, no una verdad absoluta.`) });
  return res;
}
