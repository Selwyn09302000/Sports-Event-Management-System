/**
 * Local SQLite schema (authoritative store on the scoring laptop).
 * Generated from src/lib/db/migrations/0001_init.sql by
 * scripts/build-schema-module.mjs — edit the .sql file, then re-run the script.
 * The hosted/cloud equivalent lives in supabase/migrations/0001_init.sql.
 */
export const MIGRATION_0001_INIT = `CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  location TEXT,
  contact_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE organization_members (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  roles TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, user_id)
);
CREATE INDEX idx_members_user ON organization_members(user_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE sports (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE tournaments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  location TEXT,
  starts_on TEXT,
  ends_on TEXT,
  sport_key TEXT NOT NULL REFERENCES sports(key),
  format TEXT NOT NULL DEFAULT 'round_robin',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  ruleset_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  roster_locked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_tournaments_org ON tournaments(organization_id, status);

CREATE TABLE divisions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  age_group TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (tournament_id, name)
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  short_name TEXT,
  color TEXT,
  logo_url TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_teams_org ON teams(organization_id);

CREATE TABLE tournament_teams (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  division_id TEXT NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  seed INTEGER,
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','confirmed','withdrawn')),
  created_at TEXT NOT NULL,
  UNIQUE (tournament_id, team_id)
);
CREATE INDEX idx_tournament_teams_div ON tournament_teams(division_id);

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  birth_date TEXT,
  guardian_name TEXT,
  contact_phone TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_players_org ON players(organization_id);

CREATE TABLE roster_entries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  jersey_number INTEGER NOT NULL,
  position TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','inactive')),
  eligible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (tournament_id, team_id, jersey_number),
  UNIQUE (tournament_id, player_id)
);
CREATE INDEX idx_roster_team ON roster_entries(team_id);

CREATE TABLE venues (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  division_id TEXT NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  home_team_id TEXT NOT NULL REFERENCES teams(id),
  away_team_id TEXT NOT NULL REFERENCES teams(id),
  venue_id TEXT REFERENCES venues(id) ON DELETE SET NULL,
  scheduled_at TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  stage TEXT NOT NULL DEFAULT 'group',
  round_number INTEGER NOT NULL DEFAULT 1,
  bracket_slot INTEGER,
  home_score INTEGER NOT NULL DEFAULT 0,
  away_score INTEGER NOT NULL DEFAULT 0,
  current_period INTEGER NOT NULL DEFAULT 1,
  period_count INTEGER NOT NULL DEFAULT 4,
  period_seconds INTEGER NOT NULL DEFAULT 600,
  version INTEGER NOT NULL DEFAULT 1,
  last_event_seq INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (home_team_id <> away_team_id)
);
CREATE INDEX idx_games_tournament ON games(tournament_id, scheduled_at);
CREATE INDEX idx_games_org ON games(organization_id, status);

CREATE TABLE game_periods (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  period_number INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,
  home_score INTEGER NOT NULL DEFAULT 0,
  away_score INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  ended_at TEXT,
  PRIMARY KEY (game_id, period_number)
);

CREATE TABLE game_clock_states (
  game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  period INTEGER NOT NULL,
  remaining_ms INTEGER NOT NULL,
  running INTEGER NOT NULL DEFAULT 0,
  anchor_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE game_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tournament_id TEXT NOT NULL,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  team_id TEXT,
  player_id TEXT,
  event_type TEXT NOT NULL,
  period INTEGER NOT NULL,
  clock_seconds_remaining INTEGER NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_by_name TEXT,
  device_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  schema_version INTEGER NOT NULL DEFAULT 1,
  seq INTEGER NOT NULL,
  client_action_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending','synchronized','conflicted','rejected','local_only')),
  voided_at TEXT,
  voided_by TEXT,
  void_reason TEXT,
  corrects_event_id TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_game_events_client_action ON game_events(game_id, client_action_id) WHERE client_action_id IS NOT NULL;
CREATE INDEX idx_game_events_game_seq ON game_events(game_id, seq);
CREATE INDEX idx_game_events_sync ON game_events(organization_id, sync_status);

CREATE TABLE player_game_statistics (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  fgm2 INTEGER NOT NULL DEFAULT 0,
  fga2 INTEGER NOT NULL DEFAULT 0,
  fgm3 INTEGER NOT NULL DEFAULT 0,
  fga3 INTEGER NOT NULL DEFAULT 0,
  ftm INTEGER NOT NULL DEFAULT 0,
  fta INTEGER NOT NULL DEFAULT 0,
  fouls INTEGER NOT NULL DEFAULT 0,
  offensive_rebounds INTEGER NOT NULL DEFAULT 0,
  defensive_rebounds INTEGER NOT NULL DEFAULT 0,
  assists INTEGER NOT NULL DEFAULT 0,
  steals INTEGER NOT NULL DEFAULT 0,
  blocks INTEGER NOT NULL DEFAULT 0,
  turnovers INTEGER NOT NULL DEFAULT 0,
  substitutions INTEGER NOT NULL DEFAULT 0,
  seconds_played INTEGER NOT NULL DEFAULT 0,
  snapshot_at TEXT NOT NULL,
  PRIMARY KEY (game_id, player_id)
);

CREATE TABLE team_game_statistics (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  fouls INTEGER NOT NULL DEFAULT 0,
  timeouts_used INTEGER NOT NULL DEFAULT 0,
  snapshot_at TEXT NOT NULL,
  PRIMARY KEY (game_id, team_id)
);

CREATE TABLE game_results (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tournament_id TEXT NOT NULL,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  home_score INTEGER NOT NULL,
  away_score INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitted','approved','rejected','superseded')),
  submitted_by TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  rejection_reason TEXT,
  corrected_from_id TEXT,
  final_event_seq INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_results_game ON game_results(game_id, created_at);

CREATE TABLE tournament_rounds (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  division_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (division_id, round_number)
);

CREATE TABLE bracket_advancements (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  division_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  source_game_id TEXT,
  winner_team_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (division_id, round_number, slot)
);

CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tournament_id TEXT REFERENCES tournaments(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  published_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  device_key TEXT NOT NULL UNIQUE,
  authorized INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sync_operations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL DEFAULT 'upsert',
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','pushed','synchronized','conflicted','rejected')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  remote_confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_sync_status ON sync_operations(status, created_at);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_org ON audit_logs(organization_id, created_at);
`;
