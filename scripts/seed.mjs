/**
 * Development / pilot seed. Creates one organization with three users, a
 * published tournament, four teams with rosters, and two games ready to score.
 *
 *   node scripts/seed.mjs
 *
 * Safe to re-run: it exits early if the demo organization already exists.
 * This script writes plain SQL directly; the application's own repositories and
 * scheduling engine are the tested path for real data.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID, scryptSync } from "node:crypto";

const DB_PATH = resolve(process.cwd(), process.env.LOCAL_DB_PATH || "./data/local.sqlite");
const PASSWORD = "CourtSide2026!";

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

const schema = readFileSync("src/lib/db/migrations/0001_init.sql", "utf8");
db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
db.exec(schema);
db.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
  "0001_init",
  new Date().toISOString(),
);
db.prepare("INSERT OR IGNORE INTO sports (key, name, created_at) VALUES (?, ?, ?)").run(
  "basketball",
  "Basketball",
  new Date().toISOString(),
);

const now = new Date().toISOString();
const id = (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`;

function hashPassword(password) {
  const salt = randomUUID().replaceAll("-", "");
  const derived = scryptSync(password, salt, 64, { N: 16384 });
  return `scrypt$16384$${salt}$${derived.toString("hex")}`;
}

const existing = db
  .prepare("SELECT id FROM organizations WHERE slug = ?")
  .get("san-roque");
if (existing) {
  console.log("Demo organization already exists — nothing to do.");
  process.exit(0);
}

const orgId = id("org");
db.prepare(
  `INSERT INTO organizations (id, slug, name, description, location, contact_email, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
).run(
  orgId,
  "san-roque",
  "San Roque Basketball League",
  "Community basketball league for the San Roque district.",
  "San Roque Covered Court",
  "league@example.com",
  now,
  now,
);

const users = [
  { email: "admin@example.com", name: "Ana Reyes", roles: ["org_admin"] },
  { email: "scorer@example.com", name: "Ben Cruz", roles: ["scorer", "statistician"] },
  { email: "official@example.com", name: "Cora Diaz", roles: ["official"] },
];

for (const user of users) {
  const userId = id("usr");
  db.prepare(
    "INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(userId, user.email, user.name, hashPassword(PASSWORD), now, now);
  db.prepare(
    `INSERT INTO organization_members (id, organization_id, user_id, roles, status, created_at)
     VALUES (?, ?, ?, ?, 'active', ?)`,
  ).run(id("mem"), orgId, userId, JSON.stringify(user.roles), now);
}

const tournamentId = id("trn");
const ruleset = {
  periodCount: 4,
  periodSeconds: 600,
  overtimeSeconds: 300,
  maxPersonalFouls: 5,
  maxTimeouts: 5,
  standingPoints: { win: 2, loss: 1, forfeit: 0 },
  allowDraws: false,
};
db.prepare(
  `INSERT INTO tournaments (id, organization_id, slug, name, description, location, starts_on, ends_on,
                            sport_key, format, status, ruleset_json, created_at, updated_at, published_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'basketball', 'round_robin', 'published', ?, ?, ?, ?)`,
).run(
  tournamentId,
  orgId,
  "summer-invitational-2026",
  "Summer Invitational 2026",
  "Barangay-level invitational tournament.",
  "San Roque Covered Court",
  "2026-11-14",
  "2026-11-22",
  JSON.stringify(ruleset),
  now,
  now,
  now,
);

const divisionId = id("div");
db.prepare(
  "INSERT INTO divisions (id, organization_id, tournament_id, name, age_group, created_at) VALUES (?, ?, ?, ?, ?, ?)",
).run(divisionId, orgId, tournamentId, "Men's Open", "18+", now);

const venueId = id("ven");
db.prepare(
  "INSERT INTO venues (id, organization_id, tournament_id, name, address, created_at) VALUES (?, ?, ?, ?, ?, ?)",
).run(venueId, orgId, tournamentId, "Court 1", "San Roque Covered Court", now);

const teamSpecs = [
  { name: "San Roque Warriors", short: "SRW", color: "#dc2626" },
  { name: "Riverside Falcons", short: "RVF", color: "#2563eb" },
  { name: "Northside Titans", short: "NST", color: "#059669" },
  { name: "Covered Court Kings", short: "CCK", color: "#7c3aed" },
];

const firstNames = ["Miguel", "Jose", "Andres", "Paolo", "Rafael", "Carlo", "Dante", "Emilio", "Ferdinand", "Gabriel", "Hector", "Ivan"];
const lastNames = ["Santos", "Reyes", "Cruz", "Bautista", "Garcia", "Mendoza", "Torres", "Aquino", "Ramos", "Flores", "Navarro", "Salazar"];

const teamIds = [];
for (const [teamIndex, spec] of teamSpecs.entries()) {
  const teamId = id("tem");
  teamIds.push(teamId);
  db.prepare(
    `INSERT INTO teams (id, organization_id, name, short_name, color, logo_url, contact_name, contact_phone, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
  ).run(teamId, orgId, spec.name, spec.short, spec.color, now, now);

  db.prepare(
    `INSERT INTO tournament_teams (id, organization_id, tournament_id, division_id, team_id, seed, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
  ).run(id("ttm"), orgId, tournamentId, divisionId, teamId, teamIndex + 1, now);

  for (let slot = 0; slot < 8; slot += 1) {
    const playerId = id("ply");
    const fullName = `${firstNames[(teamIndex * 3 + slot) % firstNames.length]} ${lastNames[(teamIndex * 5 + slot) % lastNames.length]}`;
    db.prepare(
      `INSERT INTO players (id, organization_id, full_name, birth_date, guardian_name, notes, created_at, updated_at)
       VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)`,
    ).run(playerId, orgId, fullName, now, now);
    db.prepare(
      `INSERT INTO roster_entries (id, organization_id, tournament_id, team_id, player_id, jersey_number, position, status, eligible, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?)`,
    ).run(
      id("ros"),
      orgId,
      tournamentId,
      teamId,
      playerId,
      4 + slot,
      slot === 0 ? "G" : slot < 3 ? "F" : "C",
      now,
    );
  }
}

function createGame(homeTeamId, awayTeamId, scheduledAt, stage, round, slot) {
  const gameId = id("gam");
  db.prepare(
    `INSERT INTO games (id, organization_id, tournament_id, division_id, home_team_id, away_team_id, venue_id,
                        scheduled_at, status, stage, round_number, bracket_slot, period_count, period_seconds, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, 4, 600, ?, ?)`,
  ).run(gameId, orgId, tournamentId, divisionId, homeTeamId, awayTeamId, venueId, scheduledAt, stage, round, slot, now, now);
  db.prepare(
    `INSERT INTO game_clock_states (game_id, period, remaining_ms, running, anchor_at, version, updated_at)
     VALUES (?, 1, 600000, 0, ?, 1, ?)`,
  ).run(gameId, now, now);
  return gameId;
}

const game1 = createGame(teamIds[0], teamIds[1], "2026-11-14T09:00:00.000Z", "group", 1, 1);
const game2 = createGame(teamIds[2], teamIds[3], "2026-11-14T10:30:00.000Z", "group", 1, 2);

for (let round = 1; round <= 3; round += 1) {
  db.prepare(
    `INSERT INTO tournament_rounds (id, organization_id, tournament_id, division_id, round_number, name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id("rnd"), orgId, tournamentId, divisionId, round, `Round ${round}`, now);
}

console.log("Seeded demo data.");
console.log(`  Organization: San Roque Basketball League (/san-roque)`);
console.log(`  Tournament:   Summer Invitational 2026 (/tournaments/summer-invitational-2026)`);
console.log(`  Games ready:  ${game1}  ${game2}`);
console.log(`  Sign in:      admin@example.com / ${PASSWORD}`);
console.log(`                scorer@example.com, official@example.com (same password)`);
