import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const perfil = `<h1 class="player-title">Jugador oficial</h1>
  <h5>FIDE title</h5><div class="profile-info-title "><p>International Master</p></div>
  <p class="profile-info-byear ">1990</p>
  <div class="profile-standart profile-game"><p>2400</p></div>`;
const respaldo = { id: 123, name: 'Jugador de prueba', title: 'GM', year: 1980, federation: 'ESP', standard: 2300 };
const json = datos => new Response(JSON.stringify(datos), { headers: { 'content-type': 'application/json' } });
const pedir = ruta => worker.fetch(new Request('https://chessrival.test/api/fide/' + ruta), { ORIGENES_PERMITIDOS: '*' });

async function conFuentes(responder, verificar) {
  const original = globalThis.fetch, llamadas = [];
  globalThis.fetch = async (url, opciones) => {
    const u = new URL(url); llamadas.push(u);
    assert.ok(opciones.signal, 'Las consultas deben tener tiempo límite');
    return responder(u);
  };
  try { await verificar(llamadas); }
  finally { globalThis.fetch = original; }
}

await test('Títulos y edad: FIDE tiene prioridad y no se consulta Lichess si responde', async () => {
  await conFuentes(u => {
    assert.equal(u.hostname, 'ratings.fide.com');
    return new Response(perfil);
  }, async llamadas => {
    const p = await (await pedir('ficha?id=123')).json();
    assert.equal(p.titulo, 'IM');
    assert.equal(p.edad, `${new Date().getFullYear() - 1990} años`);
    assert.equal(llamadas.length, 1);
  });
});

await test('Un jugador FIDE sin título conserva ese dato y no se sustituye por otro de Lichess', async () => {
  await conFuentes(() => new Response('<h1 class="player-title">Jugador sin título</h1>'), async llamadas => {
    assert.deepEqual(await (await pedir('ficha?id=123')).json(), { titulo: '', edad: '' });
    assert.equal(llamadas.length, 1);
  });
});

await test('Error HTTP, respuesta vacía, página no válida y tiempo agotado permiten el respaldo Lichess', async () => {
  for (const caso of ['http', 'vacia', 'no-valida', 'timeout']) {
    await conFuentes(u => {
      if (u.hostname === 'lichess.org') return json(respaldo);
      if (caso === 'http') return new Response('Error', { status: 503 });
      if (caso === 'timeout') throw new DOMException('Tiempo agotado', 'TimeoutError');
      return new Response(caso === 'vacia' ? '' : '<html>Sin perfil</html>');
    }, async llamadas => {
      const p = await (await pedir('ficha?id=123')).json();
      assert.equal(p.titulo, 'GM', caso);
      assert.equal(p.edad, `${new Date().getFullYear() - 1980} años`);
      assert.deepEqual(llamadas.map(u => u.hostname), ['ratings.fide.com', 'lichess.org']);
    });
  }
});

await test('El respaldo nunca acepta datos de un ID FIDE diferente', async () => {
  await conFuentes(u => u.hostname === 'ratings.fide.com' ? new Response('Error', { status: 503 }) : json({ ...respaldo, id: 456 }), async () => {
    assert.deepEqual(await (await pedir('ficha?id=123')).json(), { titulo: '', edad: '' });
  });
});

await test('Las estadísticas oficiales y el ELO FIDE ganan sin consultar Lichess', async () => {
  await conFuentes(u => {
    assert.equal(u.hostname, 'ratings.fide.com');
    return u.pathname.endsWith('a_data_stats.php') ? json([{ white_total: 10, white_win_num: 6, white_draw_num: 2 }]) : new Response(perfil);
  }, async llamadas => {
    const p = await (await pedir('estadisticas?id=123')).json();
    assert.equal(p.bloques[1].elo, '2400');
    assert.equal(p.bloques[0].blancas.victorias, 6);
    assert.equal(p.titulo, 'IM');
    assert.equal(llamadas.length, 2);
  });
});

await test('Si falla FIDE, las estadísticas Lichess indican que no hay resultados por color', async () => {
  await conFuentes(u => u.hostname === 'lichess.org' ? json(respaldo) : new Response('Error', { status: 503 }), async llamadas => {
    const p = await (await pedir('estadisticas?id=123')).json();
    assert.equal(p.parcial, true);
    assert.equal(p.bloques[0].elo, '2300');
    assert.equal(p.bloques[0].blancas, null);
    assert.equal(p.bloques[0].negras, null);
    assert.deepEqual(llamadas.map(u => u.hostname), ['ratings.fide.com', 'ratings.fide.com', 'lichess.org']);
  });
});

await test('Un perfil FIDE válido conserva su ELO aunque fallen los resultados por color', async () => {
  await conFuentes(u => {
    assert.equal(u.hostname, 'ratings.fide.com');
    return u.pathname.endsWith('a_data_stats.php') ? new Response('JSON no válido') : new Response(perfil);
  }, async () => {
    const p = await (await pedir('estadisticas?id=123')).json();
    assert.equal(p.parcial, true);
    assert.equal(p.titulo, 'IM');
    assert.equal(p.bloques[0].elo, '2400');
    assert.equal(p.bloques[0].blancas, null);
  });
});

await test('Historial: usa los meses oficiales FIDE sin consultar Lichess', async () => {
  await conFuentes(u => {
    assert.equal(u.hostname, 'ratings.fide.com');
    return json([null, { date_2: '2024-Feb', rating: 2420 }, { date_2: '2024-Jan', rating: 2400 }, { date_2: '2024-Mar', rating: 0 }]);
  }, async llamadas => {
    const p = await (await pedir('historial?id=123')).json();
    assert.deepEqual(p.map(x => [x.fecha, x.standard]), [['2024-01', 2400], ['2024-02', 2420]]);
    assert.equal(llamadas.length, 1);
  });
});

await test('Historial: si FIDE está vacío o contiene JSON no válido, entra Lichess después', async () => {
  for (const vacio of ['', '[]', 'JSON no válido']) {
    await conFuentes(u => u.hostname === 'ratings.fide.com' ? new Response(vacio)
      : new Response(`fideRatingChart',{init:{"standard":[2024012300,2024022310]}}`), async llamadas => {
      const p = await (await pedir('historial?id=123')).json();
      assert.deepEqual(p.map(x => [x.fecha, x.standard]), [['2024-01', 2300], ['2024-02', 2310]]);
      assert.deepEqual(llamadas.map(u => u.hostname), ['ratings.fide.com', 'lichess.org']);
    });
  }
});

await test('Foto: FIDE tiene prioridad sobre una posible foto de Lichess', async () => {
  await conFuentes(u => {
    assert.equal(u.hostname, 'ratings.fide.com');
    return new Response(perfil + '<img class="profile-top__photo" src="data:image/jpeg;base64,RklERQ==">');
  }, async llamadas => {
    const r = await pedir('foto?id=123');
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'FIDE');
    assert.equal(llamadas.length, 1);
  });
});

await test('Foto: al fallar FIDE se consulta Lichess antes que Wikimedia', async () => {
  await conFuentes(u => {
    if (u.hostname === 'ratings.fide.com') return new Response('Error', { status: 503 });
    if (u.hostname === 'lichess.org') return json({ ...respaldo, photo: { medium: 'https://image.lichess1.org/foto.webp' } });
    assert.equal(u.hostname, 'image.lichess1.org');
    return new Response('Lichess', { headers: { 'content-type': 'image/webp' } });
  }, async llamadas => {
    const r = await pedir('foto?id=123');
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'Lichess');
    assert.deepEqual(llamadas.map(u => u.hostname), ['ratings.fide.com', 'lichess.org', 'image.lichess1.org']);
  });
});

const resultadoBusqueda = `<table id="table_results"><tbody><tr><td>123</td><td><a class="found_name">Jugador de prueba</a></td><td>IM</td><td></td><td>ESP</td><td>2400</td><td>2300</td><td>2200</td><td>1990</td></tr></tbody></table>`;
await test('La búsqueda por nombre usa FIDE sin pedir resultados a Lichess si los encuentra', async () => {
  await conFuentes(u => {
    assert.equal(u.hostname, 'ratings.fide.com');
    return new Response(resultadoBusqueda);
  }, async llamadas => {
    const p = await (await pedir('buscar?q=Jugador')).json();
    assert.equal(p[0].fideId, '123');
    assert.equal(p[0].elo, 2400);
    assert.equal(llamadas.length, 1);
  });
});

await test('La búsqueda por nombre o ID recurre a Lichess solo después del fallo FIDE', async () => {
  for (const consulta of ['Jugador', '123']) {
    await conFuentes(u => {
      if (u.hostname === 'ratings.fide.com') return new Response('Error', { status: 503 });
      if (consulta === 'Jugador') {
        assert.equal(u.pathname, '/api/fide/player/search');
        return json([respaldo, { ...respaldo, id: 456, name: 'Otra persona' }]);
      }
      assert.equal(u.pathname, '/api/fide/player/123');
      return json(respaldo);
    }, async llamadas => {
      const p = await (await pedir('buscar?q=' + consulta)).json();
      assert.equal(p.length, 1);
      assert.equal(p[0].fideId, '123');
      assert.equal(p[0].elo, 2300);
      assert.deepEqual(llamadas.map(u => u.hostname), ['ratings.fide.com', 'lichess.org']);
    });
  }
});
