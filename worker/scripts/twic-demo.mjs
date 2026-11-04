// Solo datos locales. Se comparte el puerto del Worker habitual para probar la ficha real.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const dir = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const config = 'wrangler.twic.local.toml';
const opcion = process.argv[2] ?? 'iniciar';
async function actualizar() {
  for (let intento = 0; intento < 3; intento++) {
    try {
      const r = await fetch('http://127.0.0.1:8787/__twic/actualizar', { method: 'POST', signal: AbortSignal.timeout(180000) });
      const d = await r.json().catch(() => ({ error: 'Se interrumpió la conexión con el Worker local. Vuelve a ejecutar el comando para continuar.' }));
      if (r.ok) return d;
      if (r.status < 500) throw Object.assign(new Error(d.error || 'No se pudo preparar la entrega.'), { definitivo: true });
      throw new Error(d.error || 'No se pudo preparar la entrega.');
    } catch (e) {
      if (e.definitivo || intento === 2) throw e;
      console.log(`Conexión interrumpida; reintento ${intento + 1}/2.`);
      await setTimeout(1000 * (intento + 1));
    }
  }
}
if (opcion === 'cargar') {
  const maximo = Math.max(1, Math.min(54, Math.floor(Number(process.argv[3]) || 1)));
  for (let n = 0; n < maximo; n++) {
    const d = await actualizar();
    if (!d.entrega) {
      console.log(d.estado === 'completo' ? 'El histórico local ya está completo.' : `Quedan ${d.pendientes ?? '?'} entregas. Hay una actualización reservada o en espera de reintento; vuelve a ejecutar el comando más tarde.`);
      break;
    }
    console.log(`Entrega ${d.entrega} preparada (${n + 1}/${maximo}).`);
    await setTimeout(100);
  }
} else if (opcion === 'iniciar') {
  const migrar = spawnSync(process.execPath, [cli, 'd1', 'migrations', 'apply', 'TWIC_DB', '--local', '--config', config], { cwd: dir, stdio: 'inherit', windowsHide: true });
  if (migrar.status) process.exit(migrar.status || 1);
  const migrarLumbra = spawnSync(process.execPath, [cli, 'd1', 'migrations', 'apply', 'LUMBRA_DB', '--local', '--config', config], { cwd: dir, stdio: 'inherit', windowsHide: true });
  if (migrarLumbra.status) process.exit(migrarLumbra.status || 1);
  const servidor = spawn(process.execPath, [cli, 'dev', '--port', '8787', '--config', config], { cwd: dir, stdio: 'inherit', windowsHide: true });
  servidor.on('exit', n => process.exit(n || 0));
  for (const señal of ['SIGINT', 'SIGTERM']) process.on(señal, () => servidor.kill(señal));
} else throw new Error('Usa iniciar o cargar [número de entregas].');
