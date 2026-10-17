-- Stable "Contexto sobre mí" profile (2-5 short lines), one row per owner.
-- Kept apart from memory_items, which change chat by chat.
CREATE TABLE IF NOT EXISTS memory_profile (
  owner_id TEXT PRIMARY KEY,
  text TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
