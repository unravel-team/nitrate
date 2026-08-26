CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('team_lead', 'ai_creator')),
  clanker TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plugin_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  clanker TEXT NOT NULL,
  surface TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('team_lead', 'ai_creator')),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS packets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client TEXT,
  brief TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  input_assets_json TEXT NOT NULL DEFAULT '[]',
  output_structure_json TEXT NOT NULL DEFAULT '[]',
  review_criteria_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  packet_id TEXT NOT NULL REFERENCES packets(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  clanker TEXT NOT NULL,
  task TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'delivered', 'pulled', 'working', 'returned', 'blocked')),
  pushed_at TEXT,
  returned_at TEXT
);

CREATE TABLE IF NOT EXISTS returns (
  id TEXT PRIMARY KEY,
  packet_id TEXT NOT NULL REFERENCES packets(id),
  assignment_id TEXT NOT NULL REFERENCES assignments(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  made_with TEXT NOT NULL,
  prompt TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('needs_review', 'approved', 'rejected', 'changes_requested')),
  object_key TEXT,
  filename TEXT,
  content_type TEXT,
  size_bytes INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES returns(id),
  actor_id TEXT REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON plugin_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_assignments_packet ON assignments(packet_id);
CREATE INDEX IF NOT EXISTS idx_assignments_user ON assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_returns_packet ON returns(packet_id);
CREATE INDEX IF NOT EXISTS idx_returns_assignment ON returns(assignment_id);
