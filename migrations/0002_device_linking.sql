-- Temporary one-use codes for linking a new device to an existing person.
-- One active code per source device; plaintext codes are never stored.

CREATE TABLE IF NOT EXISTS device_link_codes (
  source_device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  source_person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_link_codes_expiry
  ON device_link_codes(expires_at);
