-- Cross-chat memory for the voice thinking partner: short items extracted when a
-- chat is closed ("cierra" or the "Cerrar y recordar" button).
-- source_chat_id has no foreign key on purpose: memory must survive deleting the
-- chat, and the chat row may not be synced to D1 yet when the items are saved.
CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('decision', 'paso', 'pregunta', 'patron')),
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done')),
  source_chat_id TEXT,
  source_chat_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS memory_owner_created_idx ON memory_items(owner_id, created_at DESC);
