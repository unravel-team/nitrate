CREATE TABLE IF NOT EXISTS mcp_connections (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  source_session_id TEXT REFERENCES plugin_sessions(id),
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  client TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience = 'nitrate-mcp'),
  scopes_json TEXT NOT NULL CHECK (json_valid(scopes_json) AND json_type(scopes_json) = 'array'),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_mcp_connections_owner
ON mcp_connections(agency_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_connections_expiry
ON mcp_connections(expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS mcp_external_asset_imports (
  id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  connection_id TEXT NOT NULL REFERENCES mcp_connections(id),
  assignment_id TEXT NOT NULL REFERENCES assignments(id),
  provider TEXT NOT NULL,
  external_asset_id TEXT NOT NULL,
  return_id TEXT REFERENCES returns(id),
  staging_key TEXT,
  lease_expires_at TEXT NOT NULL,
  cleanup_error TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'committed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (agency_id, provider, external_asset_id)
);

CREATE INDEX IF NOT EXISTS idx_mcp_external_asset_assignment
ON mcp_external_asset_imports(assignment_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_mcp_external_asset_lease
ON mcp_external_asset_imports(status, lease_expires_at);
