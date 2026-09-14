-- OACLIX core schema.
-- Applied once during deployment/setup; schema changes must never run on the request path.

CREATE TABLE IF NOT EXISTS persons (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  public_key_json TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_devices_person
  ON devices(person_id);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  owner_person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('general', 'shared')),
  retention_seconds INTEGER NOT NULL DEFAULT 21600 CHECK(retention_seconds BETWEEN 3600 AND 21600),
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_general_owner
  ON rooms(owner_person_id)
  WHERE kind = 'general' AND closed_at IS NULL;

CREATE TABLE IF NOT EXISTS room_memberships (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('owner', 'member')),
  can_clear INTEGER NOT NULL DEFAULT 0 CHECK(can_clear IN (0, 1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(room_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_person
  ON room_memberships(person_id, room_id);
