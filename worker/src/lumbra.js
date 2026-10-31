// Fuente Lumbra de evaluación privada. Las consultas solo leen el índice local.
import { palabras } from '../../js/pgn.js';

export const LUMBRA_PAGE_SIZE = 100;
export const MAX_LUMBRA_PAGES = 20;
const keyName = name => [...palabras(String(name ?? ''))].sort().join(' ');
const fideId = value => /^\d{1,12}$/.test(String(value ?? '')) && Number(value) > 0 ? String(Number(value)) : '';

export function periodoLumbra(now = new Date()) {
  const until = now.toISOString().slice(0, 10), d = new Date(`${until}T00:00:00Z`);
  const month = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  if (d.getUTCMonth() !== month) d.setUTCDate(0);
  return { desde: d.toISOString().slice(0, 10), hasta: until };
}

export function fechaLumbra(value) {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return '';
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === `${m[1]}-${m[2]}-${m[3]}`
    ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function leerCabeceras(text) {
  const headers = Object.create(null);
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) break;
    const match = /^\[([A-Za-z0-9_]+)\s+"((?:\\.|[^"\\])*)"\]\s*$/.exec(line);
    if (match) headers[match[1]] = match[2].replace(/\\(["\\])/g, '$1');
  }
  return headers;
}

export function partidasLumbra(text, desde, hasta) {
  const starts = [];
  for (const m of String(text).matchAll(/^\[Event[ \t]+"/gm)) starts.push(m.index);
  const games = [];
  for (let i = 0; i < starts.length; i++) {
    const pgn = String(text).slice(starts[i], starts[i + 1] ?? text.length).trim();
    const tags = leerCabeceras(pgn);
    const date = fechaLumbra(tags.Date);
    if (!date || date < desde || date > hasta) continue;
    const white = tags.White?.trim() ?? '', black = tags.Black?.trim() ?? '';
    if (!white || !black) continue;
    const id = String(tags.DeduplicatorId ?? '').trim();
    if (!id || id.length > 80) continue;
    games.push({
      id, date, whiteId: fideId(tags.WhiteFideId), blackId: fideId(tags.BlackFideId),
      white: keyName(white), black: keyName(black), whiteRating: tags.WhiteElo ?? '',
      blackRating: tags.BlackElo ?? '', source: tags.Source ?? '',
      quality: tags.SourceQuality ?? '', identityWhite: tags.IdentityEvidenceWhite ?? '',
      identityBlack: tags.IdentityEvidenceBlack ?? '', pgn
    });
  }
  return games;
}

export async function guardarLumbraLote(db, games) {
  if (!Array.isArray(games) || games.length > 250) throw new Error('El lote local de Lumbra no es válido.');
  if (games.length) await db.prepare(`INSERT INTO lumbra_games
    (game_id,game_date,white_id,black_id,white_name,black_name,white_rating,black_rating,source,source_quality,identity_white,identity_black,pgn)
    SELECT json_extract(value,'$.id'),json_extract(value,'$.date'),json_extract(value,'$.whiteId'),json_extract(value,'$.blackId'),
    json_extract(value,'$.white'),json_extract(value,'$.black'),json_extract(value,'$.whiteRating'),json_extract(value,'$.blackRating'),
    json_extract(value,'$.source'),json_extract(value,'$.quality'),json_extract(value,'$.identityWhite'),json_extract(value,'$.identityBlack'),
    json_extract(value,'$.pgn') FROM json_each(?) WHERE true ON CONFLICT(game_id) DO UPDATE SET
    game_date=excluded.game_date,white_id=excluded.white_id,black_id=excluded.black_id,white_name=excluded.white_name,
    black_name=excluded.black_name,white_rating=excluded.white_rating,black_rating=excluded.black_rating,source=excluded.source,
    source_quality=excluded.source_quality,identity_white=excluded.identity_white,identity_black=excluded.identity_black,pgn=excluded.pgn`)
    .bind(JSON.stringify(games)).run();
  return games.length;
}

export async function consultarLumbra(env, params, now = new Date()) {
  if (!env.LUMBRA_DB) return { estado: 'sin_configurar', partidas: [] };
  const db = env.LUMBRA_DB, periodo = periodoLumbra(now);
  const name = String(params.get('name') ?? '').trim(), fide = fideId(params.get('fideId'));
  const key = keyName(name), cursor = params.get('cursor') ?? '';
  if (name.length > 150 || (!fide && key.split(' ').length < 2) || (cursor && !/^\d{4}-\d{2}-\d{2}\|[\w.-]{1,80}$/.test(cursor)))
    return { estado: 'error', error: 'Indica el nombre completo o el ID FIDE del jugador.', partidas: [] };
  const ramas = [], args = [];
  for (const side of ['white', 'black']) {
    if (fide) { ramas.push(`SELECT game_id FROM lumbra_games WHERE ${side}_id = ?`); args.push(fide); }
    if (key.split(' ').length >= 2) {
      ramas.push(`SELECT game_id FROM lumbra_games WHERE ${side}_name = ?${fide ? ` AND (${side}_id = '' OR ${side}_id = ?)` : ''}`);
      args.push(key); if (fide) args.push(fide);
    }
  }
  const [cursorDate, cursorId] = cursor ? cursor.split('|') : ['9999-12-31', '\uffff'];
  const rows = (await db.prepare(`WITH candidates AS (${ramas.join(' UNION ')}), page AS (
      SELECT g.game_id FROM candidates c JOIN lumbra_games g USING(game_id)
      WHERE g.game_date BETWEEN ? AND ? AND (g.game_date < ? OR (g.game_date = ? AND g.game_id < ?))
      ORDER BY g.game_date DESC, g.game_id DESC LIMIT ?)
    SELECT g.* FROM page p JOIN lumbra_games g USING(game_id) ORDER BY g.game_date DESC, g.game_id DESC`)
    .bind(...args, periodo.desde, periodo.hasta, cursorDate, cursorDate, cursorId, LUMBRA_PAGE_SIZE + 1).all()).results;
  const page = rows.slice(0, LUMBRA_PAGE_SIZE), last = page.at(-1);
  const meta = await db.prepare("SELECT value FROM lumbra_meta WHERE key='version'").first();
  const completa = await db.prepare("SELECT value FROM lumbra_meta WHERE key='completa'").first();
  const count = await db.prepare('SELECT count(*) AS n,max(game_date) AS ultima FROM lumbra_games WHERE game_date BETWEEN ? AND ?').bind(periodo.desde, periodo.hasta).first();
  if (completa?.value !== '1') return {
    estado: 'preparando', version: meta?.value ?? '', completa: false,
    desde: periodo.desde, hasta: periodo.hasta, juegosIndexados: count.n, ultimaPartida: count.ultima ?? null, partidas: [], siguiente: null
  };
  return {
    estado: count.n ? 'listo' : 'preparando', desde: periodo.desde, hasta: periodo.hasta,
    version: meta?.value ?? '', completa: true, juegosIndexados: count.n, ultimaPartida: count.ultima ?? null,
    partidas: page.map(g => ({ pgn: g.pgn, source: g.source, quality: g.source_quality,
      identityWhite: g.identity_white, identityBlack: g.identity_black })),
    siguiente: rows.length > LUMBRA_PAGE_SIZE && last ? `${last.game_date}|${last.game_id}` : null
  };
}
