-- Índice local de prueba para Lumbra's Gigabase. No contiene datos de usuarios.
CREATE TABLE IF NOT EXISTS lumbra_games (
  game_id TEXT PRIMARY KEY,
  game_date TEXT NOT NULL,
  white_id TEXT NOT NULL,
  black_id TEXT NOT NULL,
  white_name TEXT NOT NULL,
  black_name TEXT NOT NULL,
  white_rating TEXT NOT NULL,
  black_rating TEXT NOT NULL,
  source TEXT NOT NULL,
  source_quality TEXT NOT NULL,
  identity_white TEXT NOT NULL,
  identity_black TEXT NOT NULL,
  pgn TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lumbra_white_id_date ON lumbra_games(white_id, game_date DESC, game_id DESC);
CREATE INDEX IF NOT EXISTS lumbra_black_id_date ON lumbra_games(black_id, game_date DESC, game_id DESC);
CREATE INDEX IF NOT EXISTS lumbra_white_name_date ON lumbra_games(white_name, game_date DESC, game_id DESC);
CREATE INDEX IF NOT EXISTS lumbra_black_name_date ON lumbra_games(black_name, game_date DESC, game_id DESC);
CREATE TABLE IF NOT EXISTS lumbra_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
