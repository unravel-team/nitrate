CREATE TABLE IF NOT EXISTS agencies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agency_memberships (
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('team_lead', 'ai_creator')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (agency_id, user_id)
);

ALTER TABLE plugin_sessions ADD COLUMN agency_id TEXT REFERENCES agencies(id);
ALTER TABLE packets ADD COLUMN agency_id TEXT REFERENCES agencies(id);
ALTER TABLE assignments ADD COLUMN accepted_at TEXT;
ALTER TABLE assignments ADD COLUMN pulled_at TEXT;
ALTER TABLE returns ADD COLUMN sha256 TEXT;
ALTER TABLE returns ADD COLUMN relative_path TEXT;
ALTER TABLE returns ADD COLUMN uploaded_at TEXT;
ALTER TABLE returns ADD COLUMN validation_json TEXT;
ALTER TABLE returns ADD COLUMN reservation_active INTEGER NOT NULL DEFAULT 0
  CHECK (reservation_active IN (0, 1));

CREATE TABLE IF NOT EXISTS plugin_invitations (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  packet_id TEXT NOT NULL REFERENCES packets(id),
  assignment_id TEXT NOT NULL UNIQUE REFERENCES assignments(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  invited_email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_session_id TEXT UNIQUE,
  revoked_at TEXT
);

ALTER TABLE plugin_sessions ADD COLUMN invite_id TEXT REFERENCES plugin_invitations(id);

CREATE TABLE IF NOT EXISTS packet_inputs (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  packet_id TEXT NOT NULL REFERENCES packets(id),
  name TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL,
  object_key TEXT UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  uploaded_at TEXT
);

CREATE TABLE IF NOT EXISTS review_decisions (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  packet_id TEXT NOT NULL REFERENCES packets(id),
  return_id TEXT NOT NULL REFERENCES returns(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('approve', 'reject', 'request_changes', 'reopen')),
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activation_events (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  packet_id TEXT NOT NULL REFERENCES packets(id),
  assignment_id TEXT REFERENCES assignments(id),
  return_id TEXT REFERENCES returns(id),
  event_type TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id),
  occurred_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON agency_memberships(user_id, agency_id);
CREATE INDEX IF NOT EXISTS idx_sessions_agency_user ON plugin_sessions(agency_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_invite ON plugin_sessions(invite_id) WHERE invite_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_packets_agency ON packets(agency_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_invitations_token_hash ON plugin_invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_invitations_packet ON plugin_invitations(packet_id, assignment_id);
CREATE INDEX IF NOT EXISTS idx_packet_inputs_packet ON packet_inputs(packet_id, uploaded_at);
CREATE INDEX IF NOT EXISTS idx_review_decisions_return ON review_decisions(return_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activation_packet_type ON activation_events(packet_id, event_type, occurred_at);

-- Keep pre-migration prototype data available in one explicitly legacy-scoped agency.
INSERT OR IGNORE INTO agencies (id, name, created_by, created_at)
VALUES ('agency_legacy', 'Nitrate legacy workspace', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

UPDATE packets SET agency_id = 'agency_legacy' WHERE agency_id IS NULL;
UPDATE plugin_sessions SET agency_id = 'agency_legacy' WHERE agency_id IS NULL;

INSERT OR IGNORE INTO agency_memberships (agency_id, user_id, role, created_at)
SELECT 'agency_legacy', id,
       CASE WHEN role = 'team_lead' THEN 'team_lead' ELSE 'ai_creator' END,
       created_at
FROM users;

UPDATE assignments
SET pulled_at = pushed_at
WHERE pulled_at IS NULL AND status IN ('pulled', 'working', 'returned');

UPDATE returns
SET uploaded_at = created_at,
    relative_path = COALESCE(relative_path, filename)
WHERE object_key IS NOT NULL AND uploaded_at IS NULL;

-- Only reservations created by the verified two-step flow participate. This
-- leaves any historical metadata-only rows readable without blocking rollout.
CREATE UNIQUE INDEX IF NOT EXISTS idx_returns_pending_assignment
ON returns(assignment_id) WHERE reservation_active = 1 AND uploaded_at IS NULL;

INSERT OR IGNORE INTO activation_events
  (id, agency_id, packet_id, event_type, actor_user_id, occurred_at, metadata_json)
SELECT 'event_packet_created_' || id, agency_id, id, 'packet_created', created_by, created_at, '{}'
FROM packets
WHERE agency_id IS NOT NULL;

INSERT OR IGNORE INTO activation_events
  (id, agency_id, packet_id, assignment_id, event_type, actor_user_id, occurred_at, metadata_json)
SELECT 'event_assignment_delivered_' || a.id, p.agency_id, a.packet_id, a.id,
       'assignment_delivered', p.created_by, a.pushed_at, '{}'
FROM assignments a
JOIN packets p ON p.id = a.packet_id
WHERE p.agency_id IS NOT NULL AND a.pushed_at IS NOT NULL;

INSERT OR IGNORE INTO activation_events
  (id, agency_id, packet_id, assignment_id, event_type, actor_user_id, occurred_at, metadata_json)
SELECT 'event_assignment_pulled_' || a.id, p.agency_id, a.packet_id, a.id,
       'assignment_pulled', a.user_id, a.pulled_at, '{}'
FROM assignments a
JOIN packets p ON p.id = a.packet_id
WHERE p.agency_id IS NOT NULL AND a.pulled_at IS NOT NULL;

INSERT OR IGNORE INTO activation_events
  (id, agency_id, packet_id, assignment_id, return_id, event_type, actor_user_id, occurred_at, metadata_json)
SELECT 'event_return_uploaded_' || r.id, p.agency_id, r.packet_id, r.assignment_id, r.id,
       'return_uploaded', r.user_id, r.uploaded_at, '{}'
FROM returns r
JOIN packets p ON p.id = r.packet_id
WHERE p.agency_id IS NOT NULL AND r.uploaded_at IS NOT NULL;

INSERT OR IGNORE INTO review_decisions
  (id, agency_id, packet_id, return_id, actor_user_id, action, note, created_at)
SELECT 'decision_legacy_' || r.id || '_' || decision.key,
       p.agency_id,
       r.packet_id,
       r.id,
       COALESCE(r.user_id, p.created_by),
       json_extract(decision.value, '$.action'),
       COALESCE(json_extract(decision.value, '$.note'), ''),
       json_extract(decision.value, '$.at')
FROM returns r
JOIN packets p ON p.id = r.packet_id
JOIN json_each(CASE WHEN json_valid(r.decisions_json) THEN r.decisions_json ELSE '[]' END) AS decision
WHERE p.agency_id IS NOT NULL
  AND COALESCE(r.user_id, p.created_by) IS NOT NULL
  AND json_extract(decision.value, '$.action') IN ('approve', 'reject', 'request_changes', 'reopen')
  AND json_extract(decision.value, '$.at') IS NOT NULL;

INSERT OR IGNORE INTO activation_events
  (id, agency_id, packet_id, return_id, event_type, actor_user_id, occurred_at, metadata_json)
SELECT 'event_' || id, agency_id, packet_id, return_id,
       'return_decided', actor_user_id, created_at,
       json_object('action', action)
FROM review_decisions;
