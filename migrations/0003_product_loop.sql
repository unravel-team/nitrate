ALTER TABLE returns ADD COLUMN branch TEXT NOT NULL DEFAULT 'Launch';
ALTER TABLE returns ADD COLUMN parent_return_id TEXT;
ALTER TABLE returns ADD COLUMN decisions_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE returns ADD COLUMN comments_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('project', 'version')),
  target_id TEXT NOT NULL,
  label TEXT NOT NULL,
  allow_download INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);
