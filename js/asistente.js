// El asistente de IA (Services/Asistente/AsistenteIa.cs y ResumenJugador.cs): se le pasa un resumen con los datos ya calculados
// (resultados, aperturas, debilidades…) y la conversación; no recibe las partidas enteras. Las preguntas pasan por el servidor
// intermedio, que las reenvía a OpenAI o Anthropic con la clave del usuario (no la guarda).
import { LOCALE, IDIOMA, t as tr } from './i18n.js';
import { PROXY_URL } from './config.js';
import { leerAjuste, guardarAjuste } from './db.js';

import * as Ap from './aperturas.js';
import { nombreConTitulo, textoColoresDeLinea } from './nombre-jugador.js';
import { calcular as calcularDebilidades, puntos } from './debilidades.js';

export const Proveedor = { OpenAI: 'openai', Anthropic: 'anthropic' };
export const nombreProveedor = (p) => (p === Proveedor.OpenAI ? 'ChatGPT' : 'Claude');
export const modeloPorDefecto = (p) => (p === Proveedor.OpenAI ? 'gpt-4o-mini' : 'claude-sonnet-5-5');
export const modelosConocidos = (p) => p === Proveedor.OpenAI
  ? ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o4-mini', 'o3-mini']
  : ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-haiku-5-5'];

/** De qué proveedor es un modelo, por su nombre; null si no se reconoce. */
export function proveedorDe(modelo) {
  modelo = modelo.trim().toLowerCase();
  if (modelo.startsWith('claude')) return Proveedor.Anthropic;
  if (modelo.startsWith('gpt') || modelo.startsWith('chatgpt') || /^o\d/.test(modelo)) return Proveedor.OpenAI;
  return null;
}

// ---------- Configuración ----------

export async function cargarAjustes() {
  const modelo = ((await leerAjuste('ia_modelo', '')) ?? '').trim();
  const claveOpenAI = (await leerAjuste('ia_clave_openai', '')) ?? '';
  const claveAnthropic = (await leerAjuste('ia_clave_anthropic', '')) ?? '';
  const guardado = await leerAjuste('ia_proveedor', '');
  const proveedor = Object.values(Proveedor).includes(guardado) ? guardado : (proveedorDe(modelo) ?? Proveedor.Anthropic);
  const m = !modelo || (proveedorDe(modelo) && proveedorDe(modelo) !== proveedor) ? modeloPorDefecto(proveedor) : modelo;
  return { proveedor, modelo: m, claveOpenAI, claveAnthropic };
}

export const configDe = (a) => ({ proveedor: a.proveedor, modelo: a.modelo, clave: a.proveedor === Proveedor.OpenAI ? a.claveOpenAI : a.claveAnthropic });
export const estaLista = (c) => c.clave.length > 0 && c.modelo.length > 0;

export async function guardarAjustes(a) {
  await guardarAjuste('ia_proveedor', a.proveedor);
  await guardarAjuste('ia_modelo', a.modelo.trim());
  await guardarAjuste('ia_clave_openai', a.claveOpenAI.trim());
  await guardarAjuste('ia_clave_anthropic', a.claveAnthropic.trim());
}

// ---------- Llamadas al servidor intermedio ----------

async function llamar(ruta, { metodo = 'GET', clave, cuerpo, parametros = {} }) {
  if (!PROXY_URL) throw new Error(tr('El asistente necesita el servidor intermedio, que aún no está configurado (js/config.js).'));
  const url = new URL(ruta, PROXY_URL);
  for (const [k, v] of Object.entries(parametros)) url.searchParams.set(k, v);
  let r;
  try {
    r = await fetch(url, {
      method: metodo, headers: { 'Content-Type': 'application/json', 'X-Clave-Ia': clave },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined, signal: AbortSignal.timeout(120000)
    });
  } catch (ex) {
    throw new Error(tr(ex.name === 'TimeoutError' ? 'El servicio tardó demasiado en responder. Inténtalo de nuevo.' : 'No se pudo conectar con el servicio. Comprueba la conexión a internet.'));
  }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error ?? `El servicio respondió con un error (${r.status}).`);
  return datos;
}

/** Los modelos de chat que tiene disponibles esa clave. */
export async function listarModelos(proveedor, clave) {
  return (await llamar('/api/ia/modelos', { clave, parametros: { proveedor } })).modelos;
}

const INSTRUCCIONES =
  'Eres un entrenador de ajedrez que ayuda a preparar una partida contra un jugador concreto. '
  + 'El usuario es el rival que se prepara para jugar contra él: si dice que juega con negras, el jugador del resumen juega con blancas, y al revés. '
  + 'Cada vez que menciones una jugada de apertura (1.e4, 1.d4, 1.c4…) di siempre quién la juega: «él juega 1.d4 con blancas» o «su rival juega 1.d4 y él responde con negras». '
  + 'Para proponer una línea a revisar exige al menos 5 partidas independientes. Contrasta los resultados con los ELO históricos y el informe de preparación; una derrota aislada o rivales superiores no prueban debilidad. '
  + 'El PLAN DE PREPARACIÓN del informe con evidencias prevalece sobre las listas de porcentajes: estas últimas son descriptivas y un mal porcentaje puede explicarse por rivales superiores. Si el plan no tiene respaldo suficiente, no presentes una línea como recomendación firme. '
  + 'Cuando te pidan una previsión (qué jugará, qué esperar, cómo juega ahora), apóyate solo en las partidas recientes del resumen (unas 50, de los últimos 3 años) y en el apartado TENDENCIA: '
  + 'compara el último año con los anteriores, di qué opciones son las más probables con porcentajes aproximados, indica sobre cuántas partidas lo dices y avisa de que es una estimación y no una certeza. '
  + 'No confundas los colores: la efectividad o el porcentaje del que se habla es siempre el del jugador del resumen, nunca el del usuario. '
  + 'Respondes SOLO con los datos del resumen que se te da; no inventes partidas, resultados, aperturas ni cifras. '
  + 'Cada afirmación específica sobre un error o patrón debe citar una evidencia disponible con el formato [Partida #123, jugada 12]. Si no hay prueba, indícalo como hipótesis o falta de datos. Distingue errores confirmados de los pendientes. '
  + 'Si el resumen no tiene datos suficientes para contestar, dilo claramente y di qué faltaría. '
  + 'Indica siempre cuántas partidas respaldan lo que dices, y avisa cuando sean pocas (menos de 5). '
  + 'Cuando te pregunten por aperturas o defensas (cómo las juega, con qué resultados), sé preciso: usa TODAS las partidas del resumen '
  + '(el apartado «Partidas consideradas» dice cuántas son; si hay menos de 100, avísalo), desglosa por primera jugada y por línea con el número exacto de partidas y el porcentaje, '
  + 'cuenta las líneas tú mismo a partir de la lista de partidas si hace falta y no te limites a las primeras de la lista. '
  + 'Ten en cuenta quién elige cada cosa: una defensa la elige quien juega con negras; un sistema de ataque, quien juega con blancas. '
  + 'Los porcentajes son los puntos que ha sacado el jugador (victoria 1, tablas 0,5). '
  + 'Responde en @IDIOMA@, de forma clara y breve, con frases cortas y, si ayuda, viñetas. Usa notación algebraica en inglés (1.e4 e5 2.Nf3 Nc6 3.Bb5, con N, B, R, Q y K para las piezas) y nunca letras en español. '
  + 'No uses formato Markdown (nada de **, #, tablas ni código): escribe texto llano y, para las listas, una línea por elemento que empiece por «• ».';

/** Envía la conversación (turnos «user» y «assistant», el último del usuario) con el resumen del jugador y devuelve la respuesta. */
export async function preguntar(config, resumen, conversacion) {
  const datos = await llamar('/api/ia/preguntar', {
    metodo: 'POST', clave: config.clave,
    cuerpo: { proveedor: config.proveedor, modelo: config.modelo, sistema: `${INSTRUCCIONES.replace('@IDIOMA@', IDIOMA === 'en' ? 'inglés' : 'español')}\n\nRESUMEN DEL JUGADOR:\n${resumen}`, mensajes: conversacion.map(m => ({ rol: m[0], texto: m[1] })) }
  });
  return (datos.texto ?? '').trim();
}

/** Quita el formato Markdown que el modelo pueda haber puesto y escribe las jugadas con figuritas. */
export function paraMostrar(texto) {
  texto = texto.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => a ?? b).replace(/^\s{0,3}#{1,6}\s*/gm, '').replace(/^(\s*)[-*]\s+/gm, '$1• ');
  return texto.replace(/(?<![\p{L}\d])([KQRBN])(?=[a-h]?[1-8]?x?[a-h][1-8])|(?<==)([QRBN])/gu, (_, a, b) => ({ K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' })[a ?? b]);
}

// ---------- El resumen del jugador ----------

const MAX_LINEAS_POR_JUGADA = 15, ULTIMAS_PARTIDAS = 150, ANIOS_PREVISION = 3, MAX_PARTIDAS = 300, MIN_PARTIDAS_PREVISION = 50, MIN_PARA_RECOMENDAR = 5;

const claveFecha = (p) => (p.fechaMostrada ? p.fecha.replace(/\?/g, '0') : '0000.00.00');
const pctDe = (lista) => (lista.length ? Math.round(lista.reduce((s, p) => s + (p.puntos ?? 0), 0) * 100 / lista.length) : 0);
const plano = (c) => c.replace(/[♚♔]/g, 'K').replace(/[♛♕]/g, 'Q').replace(/[♜♖]/g, 'R').replace(/[♝♗]/g, 'B').replace(/[♞♘]/g, 'N');

/** La fecha de la partida; si solo se sabe el año se toma el final del año, y sin año fiable, null. */
function fechaDe(p) {
  if (!p.fechaMostrada) return null;
  const [a, m, d] = p.fecha.split('.');
  const anio = parseInt(a, 10);
  if (!(anio >= 1900 && anio <= 2200)) return null;
  const mes = /^\d+$/.test(m) && +m >= 1 && +m <= 12 ? +m : 12;
  const ultimo = new Date(anio, mes, 0).getDate();
  const dia = /^\d+$/.test(d) && +d >= 1 && +d <= ultimo ? +d : ultimo;
  return new Date(anio, mes - 1, dia);
}

function seleccionar(partidas) {
  const limite = new Date(); limite.setFullYear(limite.getFullYear() - ANIOS_PREVISION);
  const ordenadas = [...partidas].sort((a, b) => claveFecha(b).localeCompare(claveFecha(a)));
  let recientes = ordenadas.filter(p => { const f = fechaDe(p); return f && f >= limite; }).slice(0, MAX_PARTIDAS);
  let ampliada = false;
  if (recientes.length < MIN_PARTIDAS_PREVISION && ordenadas.length > recientes.length) {
    recientes = ordenadas.slice(0, Math.min(MIN_PARTIDAS_PREVISION, ordenadas.length));
    ampliada = true;
  }
  const fechas = recientes.map(fechaDe).filter(Boolean);
  const desde = fechas.length ? new Date(Math.min(...fechas)) : limite;
  return { partidas: recientes, disponibles: partidas.length, ampliada, desde: ampliada ? desde : limite };
}

const mesAnio = (f) => new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' }).format(f);

function textoCobertura(s, terminadas) {
  const desde = mesAnio(s.desde);
  return s.ampliada
    ? `Evaluación basada en las ${s.partidas.length} partidas más recientes del jugador (${terminadas} terminadas, desde ${desde}): en los últimos ${ANIOS_PREVISION} años hay menos de ${MIN_PARTIDAS_PREVISION}, así que se amplía hacia atrás.`
    : `Evaluación basada en las ${s.partidas.length} partidas jugadas en los últimos ${ANIOS_PREVISION} años, desde ${desde} (${terminadas} terminadas) de las ${s.disponibles} del jugador.`;
}

/** Sobre cuántas partidas se hace la evaluación: se muestra al pie de cada respuesta, la diga o no el modelo. */
export function cobertura(partidas) {
  const s = seleccionar(partidas);
  return tr(textoCobertura(s, s.partidas.filter(p => p.puntos !== null).length));
}

const dato = (nombre, lista) => `${nombre}: ${lista.length} partidas, él puntúa ${pctDe(lista)} %`;
const agrupar = (lista, clave) => { const m = new Map(); for (const p of lista) { const k = clave(p); (m.get(k) ?? m.set(k, []).get(k)).push(p); } return [...m].map(([k, v]) => ({ key: k, lista: v })); };
const nombreVariante = p => Ap.nombreCompleto(p.apertura) || Ap.familia(p.eco, p.apertura);
const etiquetaVariante = p => [p.primerMovimiento, nombreVariante(p)].filter(Boolean).join(' · ');

function repertorio(t, terminadas, color, titulo) {
  const suyas = terminadas.filter(p => p.colorJugador === color && p.primerMovimiento);
  t.push('', titulo + ':');
  if (!suyas.length) { t.push('- sin partidas.'); return; }

  const porPrimera = agrupar(suyas, p => p.primerMovimiento).sort((a, b) => b.lista.length - a.lista.length);
  if (color === 'N') {
    const convenientes = porPrimera.filter(g => g.lista.length >= MIN_PARA_RECOMENDAR).sort((a, b) => pctDe(a.lista) - pctDe(b.lista) || b.lista.length - a.lista.length)
      .slice(0, 6).map(g => dato(g.key, g.lista));
    if (convenientes.length) t.push(`- PRIMERAS JUGADAS QUE LE CONVIENEN AL USUARIO con blancas (de más a menos conveniente: contra las que él puntúa MENOS primero; mínimo ${MIN_PARA_RECOMENDAR} partidas) → ` + convenientes.join('; '));
  }

  for (const primera of porPrimera.slice(0, 8)) {
    t.push(`- ${dato(primera.key, primera.lista)}`);
    const lineas = agrupar(primera.lista, nombreVariante).sort((a, b) => b.lista.length - a.lista.length || a.key.localeCompare(b.key)).slice(0, MAX_LINEAS_POR_JUGADA);
    for (const l of lineas) {
      const jugadas = agrupar(l.lista, p => plano(p.comienzo)).sort((a, b) => b.lista.length - a.lista.length)[0].key;
      t.push(`    · línea ${dato(l.key, l.lista)} — típicamente ${jugadas}`);
    }
    if (color === 'B') {
      const defensas = agrupar(primera.lista, Ap.etiquetaDefensa).sort((a, b) => b.lista.length - a.lista.length).slice(0, 12).map(g => dato(g.key, g.lista));
      t.push('    · defensas que le han jugado (agrupadas por la defensa que elige el rival; las variantes que escoge él no cuentan) → ' + defensas.join('; '));
      const conviene = agrupar(primera.lista.filter(p => p.respuesta), p => p.respuesta).filter(g => g.lista.length >= MIN_PARA_RECOMENDAR)
        .sort((a, b) => pctDe(a.lista) - pctDe(b.lista) || b.lista.length - a.lista.length).slice(0, 6).map(g => dato(`${primera.key} ${g.key}`, g.lista));
      t.push(conviene.length
        ? `    · RESPUESTAS QUE LE CONVIENEN AL USUARIO tras ${primera.key} (de más a menos conveniente: donde él puntúa MENOS primero; mínimo ${MIN_PARA_RECOMENDAR} partidas) → ` + conviene.join('; ')
        : `    · tras ${primera.key} no hay ninguna respuesta con al menos ${MIN_PARA_RECOMENDAR} partidas: no se puede recomendar nada con fiabilidad.`);
    }
    const respuestas = agrupar(primera.lista.filter(p => p.respuesta), p => p.respuesta).sort((a, b) => b.lista.length - a.lista.length).slice(0, 10).map(g => dato(g.key, g.lista));
    if (respuestas.length) t.push(color === 'B' ? `    · respuestas del rival a ${primera.key} → ${respuestas.join('; ')}` : `    · su respuesta tras ${primera.key} → ${respuestas.join('; ')}`);
  }
}

/** Qué juega ahora frente a antes: el último año contra los anteriores. Sirve para la previsión de lo que jugará. */
function tendencia(t, terminadas) {
  const hace1 = new Date(); hace1.setFullYear(hace1.getFullYear() - 1);
  t.push('', 'TENDENCIA (último año frente a los años anteriores del periodo; sirve para prever lo que jugará):');
  for (const [color, titulo, clave] of [['B', 'Con blancas, primera jugada que elige él', p => p.primerMovimiento], ['N', 'Con negras, su defensa (primera jugada del rival y lo que responde él)', Ap.etiquetaDefensa]]) {
    const suyas = terminadas.filter(p => p.colorJugador === color && clave(p).length > 0);
    const ultimo = suyas.filter(p => { const f = fechaDe(p); return f && f >= hace1; });
    const antes = suyas.filter(p => { const f = fechaDe(p); return f && f < hace1; });
    t.push(`- ${titulo}: ${ultimo.length} partidas en el último año y ${antes.length} antes.`);
    if (!ultimo.length && !antes.length) continue;
    for (const g of agrupar(suyas, clave).sort((a, b) => b.lista.length - a.lista.length).slice(0, 6)) {
      const u = ultimo.filter(p => clave(p) === g.key).length, a = antes.filter(p => clave(p) === g.key).length;
      const cuota = (n, total) => (total === 0 ? '—' : `${n} de ${total} (${Math.round(n * 100 / total)} %)`);
      t.push(`    · ${g.key}: último año ${cuota(u, ultimo.length)}; antes ${cuota(a, antes.length)}`);
    }
  }
}

const marcador = (l) => (l.length === 0 ? 'sin partidas' : `${l.length} partidas, ${pctDe(l)} % (V ${l.filter(p => p.puntos === 1).length}, T ${l.filter(p => p.puntos === 0.5).length}, D ${l.filter(p => p.puntos === 0).length})`);

export function construirResumen(jugador, partidas, jugadasAnalizadas) {
  const t = [
    'CÓMO LEER ESTE RESUMEN:',
    '- «Él» es el jugador de este resumen. «Tú» es el usuario, que se prepara para jugar contra él.',
    '- Todos los porcentajes («él puntúa X %») son los puntos de ÉL, no los del usuario. Cuanto más bajo, mejor para su rival.',
    '- Si el usuario dice que juega con NEGRAS, él juega con BLANCAS: usa solo la sección «ÉL JUEGA CON BLANCAS». Si el usuario juega con BLANCAS, usa solo «ÉL JUEGA CON NEGRAS». No mezcles los dos colores.',
    '', `Nombre: ${nombreConTitulo(jugador)}`
  ];
  if (jugador.federation) t.push(`Federación: ${jugador.federation}`);
  if (jugador.rating > 0) t.push(`ELO: ${jugador.rating}`);
  if (jugador.fideId) t.push(`ID FIDE: ${jugador.fideId}`);

  const sel = seleccionar(partidas);
  partidas = sel.partidas;
  const terminadas = partidas.filter(p => p.puntos !== null);
  t.push('Partidas consideradas: ' + textoCobertura(sel, terminadas.length).replace('Evaluación basada en ', '') + ' Las demás no se incluyen.');
  t.push(`Hoy es ${new Date().toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' })}. Las previsiones deben apoyarse en estas partidas, que son las más recientes.`);
  if (!terminadas.length) return t.join('\n');

  t.push('', 'RESULTADOS (puntos sobre partidas terminadas; V=victorias, T=tablas, D=derrotas):');
  for (const [color, nombre] of [['B', 'Con blancas'], ['N', 'Con negras']]) t.push(`- ${nombre}: ${marcador(terminadas.filter(p => p.colorJugador === color))}`);

  repertorio(t, terminadas, 'B', 'ÉL JUEGA CON BLANCAS (sección para cuando el usuario juega con NEGRAS contra él): la primera jugada que elige él y cómo le han respondido sus rivales');
  repertorio(t, terminadas, 'N', 'ÉL JUEGA CON NEGRAS (sección para cuando el usuario juega con BLANCAS contra él): la primera jugada que le plantean sus rivales y cómo responde él');
  tendencia(t, terminadas);

  t.push('', `PARTIDAS (hasta ${ULTIMAS_PARTIDAS}, de la más reciente a la más antigua; la columna final son sus primeras jugadas):`);
  for (const p of [...partidas].sort((a, b) => claveFecha(b).localeCompare(claveFecha(a))).slice(0, ULTIMAS_PARTIDAS)) {
    const elo = p.colorJugador === 'B' ? p.eloNegras : p.eloBlancas;
    t.push(`- Partida #${p.id} | ${p.fechaMostrada || 'sin fecha'} | ${p.colorJugador === 'B' ? 'blancas' : 'negras'} | contra ${p.rivalConTitulo}${elo ? ` (${elo})` : ''} | ${p.resultadoJugador} | ${etiquetaVariante(p)} | ${plano(p.comienzo)} | ${p.evento}`);
  }

  const analisis = calcularDebilidades(partidas, jugadasAnalizadas);
  t.push('');
  if (!analisis) t.push('ANÁLISIS DE STOCKFISH: todavía no se han analizado sus partidas.');
  else {
    t.push(`ANÁLISIS DE STOCKFISH (${analisis.partidasAnalizadas} partidas, ${analisis.jugadas} jugadas; las pérdidas son lo que pierde por jugada, en puntos):`);
    const perdidaColor = (valor) => valor === null ? 'sin jugadas analizadas' : puntos(valor);
    t.push(`- Pérdida media: ${puntos(analisis.perdidaMedia)} (con blancas ${perdidaColor(analisis.perdidaBlancas)}, con negras ${perdidaColor(analisis.perdidaNegras)}). Errores graves: ${analisis.erroresGraves}.`);
    for (const [fase, d] of Object.entries(analisis.fases)) t.push(`- ${fase}: ${puntos(d.media)} por jugada (${d.jugadas} jugadas).`);
    for (const d of analisis.debilidades) t.push(`- Debilidad (${d.gravedad >= 66 ? 'Alta' : d.gravedad >= 33 ? 'Media' : 'Baja'}): ${d.titulo}. ${textoColoresDeLinea(jugador, d.colorJugador)}.${d.linea ? ` Línea: ${d.linea}.` : ''} ${d.detalle}`);
  }
  return t.join('\n');
}
