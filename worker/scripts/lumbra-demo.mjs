// Carga local y privada para evaluación. No configura recursos remotos ni publica PGN.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sevenZip from '7zip-bin';
import { parse } from 'node-html-parser';
import { partidasLumbra, periodoLumbra } from '../src/lumbra.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const files = path.join(root, '.lumbra');
const api = 'http://127.0.0.1:8787';
const pagina = 'https://lumbrasgigabase.com/en/download-the-scid-database-en/?cp=2';
const run = process.argv[2] ?? 'cargar';

async function estado() {
  const r = await fetch(`${api}/__lumbra/estado`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`No responde el Worker local (${r.status}). Inícialo con npm --prefix worker run twic:demo.`);
  return r.json();
}

async function packages() {
  const r = await fetch(pagina, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Lumbra’s Gigabase respondió HTTP ${r.status}.`);
  const doc = parse(await r.text());
  const titles = ['OTB 2025', 'OTB partial 2026'];
  const found = titles.map(title => {
    const card = doc.querySelectorAll('.ptitle').find(el => el.text.trim() === title)?.closest('.card');
    const link = card?.querySelector('.wpdm-download-link')?.getAttribute('data-downloadurl');
    const text = card?.text ?? '';
    const version = /Version:\s*(\d{4}-\d{2}-\d{2})/.exec(text)?.[1] ?? '';
    if (!link || !version || new URL(link).origin !== 'https://lumbrasgigabase.com') throw new Error(`No se pudo comprobar el paquete oficial «${title}».`);
    const stem = title === 'OTB 2025' ? 'otb-2025' : 'otb-partial-2026';
    return { title, link, version, file: path.join(files, `${stem}-${version}.7z`) };
  });
  if (found[0].version !== found[1].version) throw new Error('Los paquetes OTB de 2025 y 2026 tienen versiones distintas.');
  return found;
}

async function download(item) {
  try { if ((await stat(item.file)).size > 1000000) { console.log(`${item.title}: archivo local disponible.`); return; } } catch {}
  const response = await fetch(item.link, { redirect: 'follow', signal: AbortSignal.timeout(180000) });
  if (!response.ok || !response.body) throw new Error(`No se pudo descargar ${item.title} (HTTP ${response.status}).`);
  let bytes = 0;
  const stream = Readable.fromWeb(response.body);
  stream.on('data', chunk => { bytes += chunk.length; });
  await pipeline(stream, createWriteStream(item.file));
  if (bytes < 1000000) throw new Error(`El archivo descargado de ${item.title} está incompleto.`);
  console.log(`${item.title}: ${(bytes / 1048576).toFixed(1)} MB descargados.`);
}

async function importArchive(item, version, desde, hasta) {
  console.log(`Leyendo ${item.title} (${version}); se guardan partidas fechadas entre ${desde} y ${hasta}.`);
  const child = spawn(sevenZip.path7za, ['x', '-so', item.file], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stopped = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const decoder = new StringDecoder('utf8');
  let pending = '', stderr = '', count = 0, skipped = 0, batch = [], batchBytes = 0;
  child.stderr.on('data', chunk => { if (stderr.length < 4000) stderr += chunk.toString('utf8'); });
  const sendBatch = async () => {
    if (!batch.length) return;
    const response = await fetch(`${api}/__lumbra/lote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partidas: batch }), signal: AbortSignal.timeout(60000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `El Worker local rechazó un lote (${response.status}).`);
    count += result.guardadas;
    if (count && count % 10000 < batch.length) console.log(`  ${item.title}: ${count.toLocaleString('es-ES')} partidas indexadas`);
    batch = []; batchBytes = 0;
  };
  const processGame = async text => {
    const games = partidasLumbra(text, desde, hasta);
    if (!games.length) { skipped++; return; }
    for (const game of games) {
      batch.push(game);
      batchBytes += Buffer.byteLength(JSON.stringify(game)) + 1;
      if (batch.length >= 250 || batchBytes >= 1400000) await sendBatch();
    }
  };
  const extract = async function* () {
    for await (const chunk of child.stdout) {
      pending += decoder.write(chunk);
      let next;
      while ((next = pending.indexOf('\n[Event "', 1)) >= 0) {
        const game = pending.slice(0, next + 1);
        pending = pending.slice(next + 1);
        await processGame(game);
      }
    }
    pending += decoder.end();
    if (pending.trim()) await processGame(pending);
  };
  try {
    for await (const _ of extract()) {}
    const code = await stopped;
    if (code !== 0) throw new Error(`No se pudo extraer ${item.title}: ${stderr.trim() || `7-Zip terminó con código ${code}`}`);
    await sendBatch();
  } catch (error) {
    child.kill();
    throw error;
  }
  console.log(`${item.title}: ${count.toLocaleString('es-ES')} partidas dentro del periodo indexadas; ${skipped.toLocaleString('es-ES')} partidas antiguas o sin fecha omitidas.`);
  return count;
}

if (run === 'estado') {
  console.log(await estado());
} else if (run === 'cargar') {
  await mkdir(files, { recursive: true });
  const items = await packages();
  const current = await estado();
  if (current.completa && current.version === items[0].version && current.partidas > 0) {
    console.log(`Lumbra ${current.version} ya está indexada (${current.partidas.toLocaleString('es-ES')} partidas).`);
    process.exit(0);
  }
  const start = await fetch(`${api}/__lumbra/iniciar`, { method: 'POST', signal: AbortSignal.timeout(30000) });
  if (!start.ok) throw new Error('No se pudo preparar el índice Lumbra local.');
  for (const item of items) await download(item);
  const { desde, hasta } = periodoLumbra();
  let total = 0;
  for (const item of items) total += await importArchive(item, item.version, desde, hasta);
  const finish = await fetch(`${api}/__lumbra/finalizar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: items[0].version }), signal: AbortSignal.timeout(30000)
  });
  if (!finish.ok) throw new Error('Los PGN se cargaron, pero no se pudo marcar la versión como completa. Vuelve a ejecutar la carga.');
  const final = await estado();
  console.log(`Índice local listo: ${final.partidas.toLocaleString('es-ES')} partidas entre ${final.desde} y ${final.hasta}; versión ${final.version}.`);
} else {
  throw new Error('Usa cargar o estado.');
}
