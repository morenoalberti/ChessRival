-- Índice público de TWIC. No contiene datos, análisis ni claves de los usuarios.
CREATE TABLE IF NOT EXISTS twic_entregas (
  numero INTEGER PRIMARY KEY,
  fecha TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  total INTEGER NOT NULL DEFAULT 0,
  actualizada TEXT,
  error TEXT,
  lease TEXT,
  lease_hasta INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS twic_entregas_fecha ON twic_entregas(fecha);
CREATE TABLE IF NOT EXISTS twic_partidas (
  entrega INTEGER NOT NULL,
  orden INTEGER NOT NULL,
  blancas_id TEXT NOT NULL,
  negras_id TEXT NOT NULL,
  blancas_nombre TEXT NOT NULL,
  negras_nombre TEXT NOT NULL,
  pgn TEXT NOT NULL,
  PRIMARY KEY (entrega, orden)
);
CREATE INDEX IF NOT EXISTS twic_blancas_id ON twic_partidas(blancas_id, entrega, orden);
CREATE INDEX IF NOT EXISTS twic_negras_id ON twic_partidas(negras_id, entrega, orden);
CREATE INDEX IF NOT EXISTS twic_blancas_nombre ON twic_partidas(blancas_nombre, entrega, orden);
CREATE INDEX IF NOT EXISTS twic_negras_nombre ON twic_partidas(negras_nombre, entrega, orden);
CREATE TABLE IF NOT EXISTS twic_cuota (dia TEXT PRIMARY KEY, usadas INTEGER NOT NULL DEFAULT 0);
