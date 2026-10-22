// Fechas PGN: conserva lo que se conoce sin inventar meses ni días.
export function fechaPartida(partida) {
  const fecha = typeof partida === 'string' ? partida : partida?.fecha;
  const partes = /^(\d{4}|\?{4})[.-](\d{2}|\?{2})[.-](\d{2}|\?{2})$/.exec(fecha || '');
  if (!partes || partes[1] === '????' || +partes[1] < 1) return '';
  const [, ano, mes, dia] = partes;
  if (mes === '??') return ano;
  if (+mes < 1 || +mes > 12) return '';
  if (dia === '??') return `${mes}/${ano}`;
  const bisiesto = +ano % 4 === 0 && (+ano % 100 !== 0 || +ano % 400 === 0);
  const limite = [31, bisiesto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][+mes - 1];
  if (+dia < 1 || +dia > limite) return '';
  return `${dia}/${mes}/${ano}`;
}

export const textoFechaPartida = partida => `Fecha de la partida: ${fechaPartida(partida) || 'desconocida'}`;

/** Los tableros de aperturas representan varias partidas, no una partida elegida al azar. */
export function textoFechasPartidas(partidas = []) {
  if (!partidas.length) return 'Línea de preparación · sin partida concreta';
  if (partidas.length === 1) return textoFechaPartida(partidas[0]);
  const fechas = [...new Set(partidas.filter(p => fechaPartida(p)).map(p => p.fecha))].sort();
  const sinFecha = partidas.filter(p => !fechaPartida(p)).length;
  if (!fechas.length) return 'Fechas de las partidas: desconocidas';
  const primera = fechaPartida(fechas[0]), ultima = fechaPartida(fechas.at(-1));
  return `Fechas de las partidas: ${primera === ultima ? primera : `${primera} – ${ultima}`}${sinFecha ? ` · Sin fecha: ${sinFecha}` : ''}`;
}
