-- Manual clipboard deletion now writes a minimal delete event and physically removes
-- the text row in the same backend operation. The old soft-delete trigger is no
-- longer part of the active model.

-- Existing soft-deleted rows already have a delete event from 0004, so their text can
-- be physically removed once during this migration without losing synchronization.
DELETE FROM clipboard_items
WHERE deleted_at IS NOT NULL;

DROP TRIGGER IF EXISTS trg_clipboard_items_delete_change;

-- Global maintenance runs by expiry/change time, so these indexes keep the hourly
-- cleanup bounded instead of scanning the full clipboard tables.
CREATE INDEX IF NOT EXISTS idx_clipboard_items_expires_at
  ON clipboard_items(expires_at);

CREATE INDEX IF NOT EXISTS idx_clipboard_changes_changed_at
  ON clipboard_changes(changed_at);
