CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  team_size TEXT,
  workflow TEXT,
  created_at TEXT NOT NULL
);
