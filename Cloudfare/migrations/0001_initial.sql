PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '📁',
  name TEXT NOT NULL,
  system_prompt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  emoji TEXT NOT NULL DEFAULT '💬',
  name TEXT NOT NULL,
  system_prompt TEXT NOT NULL DEFAULT '',
  messages_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS folders_owner_updated_idx ON folders(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS chats_owner_updated_idx ON chats(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS chats_owner_folder_idx ON chats(owner_id, folder_id);
