-- Real text clipboard items for General.
-- Cursor order is server-assigned through sequence; item_id provides idempotency.

CREATE TABLE IF NOT EXISTS clipboard_items (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL UNIQUE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  author_person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  author_device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind = 'text'),
  text_content TEXT NOT NULL CHECK(length(text_content) BETWEEN 1 AND 8000),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_clipboard_room_sequence
  ON clipboard_items(room_id, sequence);

CREATE INDEX IF NOT EXISTS idx_clipboard_room_expiry
  ON clipboard_items(room_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_clipboard_device_created
  ON clipboard_items(author_device_id, created_at DESC);
