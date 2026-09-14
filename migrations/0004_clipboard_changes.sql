-- Cursor-safe clipboard change log for synchronized create/delete events.
-- Triggers keep the log complete even while older clients are still active.

CREATE TABLE IF NOT EXISTS clipboard_changes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  change_kind TEXT NOT NULL CHECK(change_kind IN ('upsert', 'delete')),
  changed_at INTEGER NOT NULL,
  UNIQUE(item_id, change_kind, changed_at)
);

CREATE INDEX IF NOT EXISTS idx_clipboard_changes_room_sequence
  ON clipboard_changes(room_id, sequence);

INSERT OR IGNORE INTO clipboard_changes (room_id, item_id, change_kind, changed_at)
SELECT room_id, item_id, 'upsert', created_at
FROM clipboard_items;

INSERT OR IGNORE INTO clipboard_changes (room_id, item_id, change_kind, changed_at)
SELECT room_id, item_id, 'delete', deleted_at
FROM clipboard_items
WHERE deleted_at IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_clipboard_items_insert_change
AFTER INSERT ON clipboard_items
BEGIN
  INSERT OR IGNORE INTO clipboard_changes (room_id, item_id, change_kind, changed_at)
  VALUES (NEW.room_id, NEW.item_id, 'upsert', NEW.created_at);
END;

CREATE TRIGGER IF NOT EXISTS trg_clipboard_items_delete_change
AFTER UPDATE OF deleted_at ON clipboard_items
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO clipboard_changes (room_id, item_id, change_kind, changed_at)
  VALUES (NEW.room_id, NEW.item_id, 'delete', NEW.deleted_at);
END;
