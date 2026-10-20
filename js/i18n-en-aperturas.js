// Nombres de aperturas en inglés. Los datos de la aplicación parten de los nombres ingleses de Lichess y los traducen al español
// (aperturas-datos.js): aquí se hace el camino inverso, y se aplica a cualquier texto que lleve un nombre de apertura en español.
import { FAMILIAS_ES, VARIANTES_ES, TIPOS } from './aperturas-datos.js';
import { nombresRegistrados } from './i18n.js';

// Nombres de las familias por código ECO y otros nombres que usa la aplicación directamente.
const A_MANO = {
  'Irregulares y Bird': 'Irregular & Bird', 'Réti': 'Réti', 'Inglesa': 'English', 'Peón de dama (irregulares)': 'Queen’s Pawn (irregular)',
  'Sistemas indios (Londres, Trompowsky)': 'Indian systems (London, Trompowsky)', 'India de dama y Benoni': 'Queen’s Indian and Benoni',
  'Holandesa': 'Dutch', 'Defensas semiabiertas (Pirc, Moderna)': 'Semi-open defences (Pirc, Modern)', 'Caro-Kann': 'Caro-Kann',
  'Siciliana': 'Sicilian', 'Francesa': 'French', 'Peón de rey': 'King’s Pawn', 'Centro y Danesa': 'Centre and Danish',
  'Apertura del alfil': 'Bishop’s Opening', 'Vienesa': 'Vienna', 'Gambito de rey': 'King’s Gambit', 'Caballo de rey': 'King’s Knight',
  'Philidor': 'Philidor', 'Petrov': 'Petrov', 'Caballo de rey (Ponziani)': 'King’s Knight (Ponziani)', 'Escocesa': 'Scotch',
  'Tres caballos': 'Three Knights', 'Cuatro caballos': 'Four Knights', 'Italiana': 'Italian', 'Gambito Evans': 'Evans Gambit',
  'Dos caballos': 'Two Knights', 'Española': 'Spanish', 'Peón de dama (Londres, Colle)': 'Queen’s Pawn (London, Colle)',
  'Gambito de dama': 'Queen’s Gambit', 'Grünfeld': 'Grünfeld', 'Catalana': 'Catalan', 'India de dama': 'Queen’s Indian',
  'Nimzoindia': 'Nimzo-Indian', 'India de rey': 'King’s Indian', 'Escandinava': 'Scandinavian', 'Alekhine': 'Alekhine',
  'Moderna': 'Modern', 'Pirc': 'Pirc', 'Eslava': 'Slav', 'Semieslava': 'Semi-Slav', 'Benoni': 'Benoni', 'Bogoindia': 'Bogo-Indian',
  'Sistema Londres': 'London System', 'Trompowsky': 'Trompowsky', 'Bird': 'Bird', 'Peón de dama': 'Queen’s Pawn',
  'Sin clasificar': 'Unclassified',
  'aceptado': 'Accepted', 'aceptada': 'Accepted', 'rehusado': 'Declined', 'rehusada': 'Declined', 'diferido': 'Deferred', 'diferida': 'Deferred',
  'acelerado': 'Accelerated', 'retrasado': 'Delayed', 'invertido': 'Reversed'
};

const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Devuelve una función que cambia los nombres de aperturas españoles de un texto por los ingleses. */
export function crearTraductorNombres() {
  const pares = new Map();
  const poner = (es, en) => { if (es && en && es.trim().length >= 4 && es.toLowerCase() !== en.toLowerCase() && !pares.has(es)) pares.set(es, en); };
  for (const [es, en] of Object.entries(A_MANO)) poner(es, en);
  for (const [en, es] of Object.entries(FAMILIAS_ES)) poner(es, en);
  for (const [en, es] of Object.entries(VARIANTES_ES)) poner(es, en);
  for (const [en, es] of TIPOS) poner(es, en);
  // Además, los que va calculando la aplicación al traducir los nombres ingleses de Lichess: ahí está el nombre inglés original.
  let re = null, versionRe = -1;
  const reconstruir = () => {
    const registrados = nombresRegistrados();
    for (const [es, en] of registrados) if (es.trim().length >= 4 && es.toLowerCase() !== en.toLowerCase()) pares.set(es, en);   // lo registrado manda
    const claves = [...pares.keys()].sort((a, b) => b.length - a.length);
    re = new RegExp(`(?<![\\p{L}\\d])(${claves.map(escapar).join('|')})(?![\\p{L}\\d])`, 'gu');
    versionRe = registrados.size;
  };
  return (texto) => {
    if (nombresRegistrados().size !== versionRe) reconstruir();
    return texto.replace(re, (m) => pares.get(m) ?? m);
  };
}
