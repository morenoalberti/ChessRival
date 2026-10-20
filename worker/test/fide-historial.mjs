import test from 'node:test';
import assert from 'node:assert/strict';
import { datosDelHistorial, completarConHistorial, tarjetaTrayectoria } from '../../js/fide-historial-datos.js';

const H = [
  { fecha: '2022-01', standard: 2400, rapid: null, blitz: 2300 },
  { fecha: '2023-01', standard: 2450, rapid: 2380, blitz: 2310 },
  { fecha: '2024-01', standard: 2500, rapid: 2390, blitz: 2290 },
  { fecha: '2025-01', standard: 2480, rapid: 2400, blitz: 2290 },
  { fecha: '2025-10', standard: 2490, rapid: 2410, blitz: 2290 }
];

test('El máximo y la variación del último año salen del historial', () => {
  const s = datosDelHistorial('Standard', H);
  assert.deepEqual(s[0], { etiqueta: 'Máximo', icono: 'copa', valor: '2500 en 2024' });
  assert.deepEqual(s[1], { etiqueta: 'Último año', icono: 'tendencia', valor: '−10', tendencia: -1 });   // 2490 frente a 2500 de hace 12+ meses (2024-01)
  const b = datosDelHistorial('Blitz', H);
  assert.equal(b[1].valor, '0');
  const corto = datosDelHistorial('Rapid', [{ fecha: '2025-01', rapid: 2400 }, { fecha: '2025-06', rapid: 2410 }]);
  assert.deepEqual(corto, [{ etiqueta: 'Máximo', icono: 'copa', valor: '2410 en 2025' }]);             // sin 12 meses de historial no hay variación
});

test('Sin historial suficiente no se inventa nada', () => {
  assert.deepEqual(datosDelHistorial('Standard', []), []);
  assert.deepEqual(datosDelHistorial('Standard', [{ fecha: '2025-01', standard: 2400 }]), []);
  assert.deepEqual(datosDelHistorial('Total', H), []);
});

test('Solo se completan los bloques sin resultados de la FIDE', () => {
  const completo = { titulo: 'Standard', elo: '2490', blancas: { total: 10 }, negras: { total: 12 } };
  const parcial = { titulo: 'Standard', elo: '2490', blancas: null, negras: null };
  const r = completarConHistorial([completo, parcial], H);
  assert.equal(r[0].titulo, 'Trayectoria');                     // la tarjeta de la trayectoria se añade al principio
  assert.equal(r[1].extras, undefined);
  assert.equal(r[2].extras.length, 2);
  assert.equal(completarConHistorial([completo], H).length, 1);   // con resultados completos no hace falta
});

test('La trayectoria dice desde cuándo tiene Elo, su mejor Elo y su ritmo más fuerte', () => {
  const bloques = [{ titulo: 'Standard', elo: '2490' }, { titulo: 'Rapid', elo: '2410' }, { titulo: 'Blitz', elo: '2290' }];
  const t = tarjetaTrayectoria(bloques, H);
  assert.deepEqual(t.extras.map(e => e.valor), ['2022', '2500 en Standard 2024', 'Standard 2490']);
  assert.equal(tarjetaTrayectoria(bloques, []), null);
});
