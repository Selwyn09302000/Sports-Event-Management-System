import { AppError, invalid, notFound } from "../domain/errors";
import { newId, nowIso, slugify } from "../domain/ids";
import { parseRuleset, parseRulesetJson, type Ruleset } from "../domain/ruleset";
import { roundRobinSchedule, singleEliminationBracket, type ScheduledPairing } from "../domain/scheduling";
import { detectConflicts, type ConflictInput, type ScheduleConflict } from "../domain/scheduling";
import { getSportAdapter } from "../domain/sports/registry";
import { all, one, run } from "../db/sql";
import { recordAudit } from "./audit";

export type TournamentFormat = "round_robin" | "double_round_robin" | "single_elimination";

export const FORMAT_LABELS: Record<TournamentFormat, string> = {
  round_robin: "Single round robin",
  double_round_robin: "Double round robin",
  single_elimination: "Single elimination",
};

export type Tournament = {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  description: string | null;
  location: string | null;
  startsOn: string | null;
  endsOn: string | null;
  sportKey: string;
  format: TournamentFormat;
  status: "draft" | "published" | "archived";
  ruleset: Ruleset;
  rosterLocked: boolean;
  createdAt: string;
  publishedAt: string | null;
};

type TournamentRow = {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  description: string | null;
  location: string | null;
  starts_on: string | null;
  ends_on: string | null;
  sport_key: string;
  format: TournamentFormat;
  status: "draft" | "published" | "archived";
  ruleset_json: string;
  roster_locked: number;
  created_at: string;
  published_at: string | null;
};

function mapTournament(row: TournamentRow): Tournament {
  return {
    id: row.id,
    organizationId: row.organization_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    location: row.location,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    sportKey: row.sport_key,
    format: row.format,
    status: row.status,
    ruleset: parseRulesetJson(row.ruleset_json),
    rosterLocked: row.roster_locked === 1,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

export function listTournaments(organizationId: string): Tournament[] {
  return all<TournamentRow>(
    "SELECT * FROM tournaments WHERE organization_id = ? ORDER BY created_at DESC",
    [organizationId],
  ).map(mapTournament);
}

export function getTournament(organizationId: string, tournamentId: string): Tournament {
  const row = one<TournamentRow>("SELECT * FROM tournaments WHERE id = ? AND organization_id = ?", [
    tournamentId,
    organizationId,
  ]);
  if (!row) throw notFound("Tournament");
  return mapTournament(row);
}

export function getPublicTournamentBySlug(slug: string): (Tournament & { organizationName: string; organizationSlug: string }) | null {
  const row = one<TournamentRow & { organization_name: string; organization_slug: string }>(
    `SELECT t.*, o.name AS organization_name, o.slug AS organization_slug
       FROM tournaments t JOIN organizations o ON o.id = t.organization_id
      WHERE t.slug = ? AND t.status = 'published'`,
    [slug],
  );
  if (!row) return null;
  return { ...mapTournament(row), organizationName: row.organization_name, organizationSlug: row.organization_slug };
}

export function listPublishedTournaments(organizationSlug?: string): Tournament[] {
  if (organizationSlug) {
    return all<TournamentRow>(
      `SELECT t.* FROM tournaments t JOIN organizations o ON o.id = t.organization_id
        WHERE o.slug = ? AND t.status = 'published' ORDER BY t.starts_on DESC`,
      [organizationSlug],
    ).map(mapTournament);
  }
  return all<TournamentRow>(
    "SELECT * FROM tournaments WHERE status = 'published' ORDER BY starts_on DESC",
  ).map(mapTournament);
}

export function createTournament(input: {
  organizationId: string;
  name: string;
  slug?: string;
  description?: string | null;
  location?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  sportKey: string;
  format: TournamentFormat;
  ruleset?: unknown;
  actor: { userId: string; name: string };
}): Tournament {
  const adapter = getSportAdapter(input.sportKey);
  const ruleset = parseRuleset(input.ruleset);

  const name = input.name.trim();
  if (name.length < 2) throw invalid("Tournament name is too short.");

  let slug = slugify(input.slug?.trim() || name);
  if (!slug) slug = `tournament-${Math.random().toString(36).slice(2, 8)}`;
  if (one("SELECT id FROM tournaments WHERE slug = ?", [slug])) {
    slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const id = newId("trn");
  const now = nowIso();

  run(
    `INSERT INTO tournaments (id, organization_id, slug, name, description, location, starts_on, ends_on, sport_key, format, status, ruleset_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    [
      id,
      input.organizationId,
      slug,
      name,
      input.description ?? null,
      input.location ?? null,
      input.startsOn ?? null,
      input.endsOn ?? null,
      adapter.key,
      input.format,
      JSON.stringify({ ...ruleset, periodCount: ruleset.periodCount || adapter.defaultPeriodCount }),
      now,
      now,
    ],
  );

  recordAudit({
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
    actorName: input.actor.name,
    action: "tournament.created",
    entityType: "tournament",
    entityId: id,
    after: { name, format: input.format, sport: adapter.key },
  });

  return getTournament(input.organizationId, id);
}

export function updateTournament(input: {
  organizationId: string;
  tournamentId: string;
  patch: {
    name?: string;
    description?: string | null;
    location?: string | null;
    startsOn?: string | null;
    endsOn?: string | null;
    format?: TournamentFormat;
    ruleset?: unknown;
  };
  actor: { userId: string; name: string };
}): void {
  const before = getTournament(input.organizationId, input.tournamentId);
  if (before.status === "archived") throw invalid("Archived tournaments cannot be edited.");

  const ruleset = input.patch.ruleset === undefined ? before.ruleset : parseRuleset(input.patch.ruleset);

  run(
    `UPDATE tournaments SET name = ?, description = ?, location = ?, starts_on = ?, ends_on = ?, format = ?, ruleset_json = ?, updated_at = ?
      WHERE id = ? AND organization_id = ?`,
    [
      input.patch.name?.trim() || before.name,
      input.patch.description ?? before.description,
      input.patch.location ?? before.location,
      input.patch.startsOn ?? before.startsOn,
      input.patch.endsOn ?? before.endsOn,
      input.patch.format ?? before.format,
      JSON.stringify(ruleset),
      nowIso(),
      before.id,
      input.organizationId,
    ],
  );

  recordAudit({
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
    actorName: input.actor.name,
    action: "tournament.updated",
    entityType: "tournament",
    entityId: before.id,
    before: { name: before.name, format: before.format, ruleset: before.ruleset },
    after: input.patch,
  });
}

export function setTournamentStatus(input: {
  organizationId: string;
  tournamentId: string;
  status: "draft" | "published" | "archived";
  actor: { userId: string; name: string };
}): void {
  const tournament = getTournament(input.organizationId, input.tournamentId);

  if (input.status === "published") {
    const divisions = one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM divisions WHERE tournament_id = ?",
      [tournament.id],
    );
    if (!divisions || divisions.n === 0) {
      throw invalid("Add at least one division before publishing.");
    }
  }

  run("UPDATE tournaments SET status = ?, published_at = ?, updated_at = ? WHERE id = ?", [
    input.status,
    input.status === "published" ? nowIso() : tournament.publishedAt,
    nowIso(),
    tournament.id,
  ]);

  recordAudit({
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
    actorName: input.actor.name,
    action: `tournament.${input.status}`,
    entityType: "tournament",
    entityId: tournament.id,
    before: { status: tournament.status },
    after: { status: input.status },
  });
}

export function setRosterLock(input: {
  organizationId: string;
  tournamentId: string;
  locked: boolean;
  reason?: string;
  actor: { userId: string; name: string };
}): void {
  const tournament = getTournament(input.organizationId, input.tournamentId);
  run("UPDATE tournaments SET roster_locked = ?, updated_at = ? WHERE id = ?", [
    input.locked,
    nowIso(),
    tournament.id,
  ]);
  recordAudit({
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
    actorName: input.actor.name,
    action: input.locked ? "roster.locked" : "roster.unlocked",
    entityType: "tournament",
    entityId: tournament.id,
    before: { rosterLocked: tournament.rosterLocked },
    after: { rosterLocked: input.locked },
    reason: input.reason ?? null,
  });
}

// ---------------------------------------------------------------------------
// Divisions
// ---------------------------------------------------------------------------

export type Division = { id: string; tournamentId: string; name: string; ageGroup: string | null };

export function listDivisions(organizationId: string, tournamentId: string): Division[] {
  return all<{ id: string; tournament_id: string; name: string; age_group: string | null }>(
    "SELECT id, tournament_id, name, age_group FROM divisions WHERE organization_id = ? AND tournament_id = ? ORDER BY name",
    [organizationId, tournamentId],
  ).map((row) => ({
    id: row.id,
    tournamentId: row.tournament_id,
    name: row.name,
    ageGroup: row.age_group,
  }));
}

export function createDivision(input: {
  organizationId: string;
  tournamentId: string;
  name: string;
  ageGroup?: string | null;
}): Division {
  getTournament(input.organizationId, input.tournamentId);
  const name = input.name.trim();
  if (!name) throw invalid("Division name is required.");

  const id = newId("div");
  try {
    run(
      "INSERT INTO divisions (id, organization_id, tournament_id, name, age_group, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [id, input.organizationId, input.tournamentId, name, input.ageGroup ?? null, nowIso()],
    );
  } catch (error) {
    if (String((error as Error).message).includes("UNIQUE")) {
      throw new AppError("conflict", "That division already exists in this tournament.");
    }
    throw error;
  }

  return { id, tournamentId: input.tournamentId, name, ageGroup: input.ageGroup ?? null };
}

// ---------------------------------------------------------------------------
// Teams, players, roster
// ---------------------------------------------------------------------------

export type Team = {
  id: string;
  name: string;
  shortName: string | null;
  color: string | null;
  logoUrl: string | null;
  contactName: string | null;
  contactPhone: string | null;
};

export function listTeams(organizationId: string): Team[] {
  return all<{
    id: string;
    name: string;
    short_name: string | null;
    color: string | null;
    logo_url: string | null;
    contact_name: string | null;
    contact_phone: string | null;
  }>("SELECT * FROM teams WHERE organization_id = ? ORDER BY name", [organizationId]).map((row) => ({
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    color: row.color,
    logoUrl: row.logo_url,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
  }));
}

export function createTeam(input: {
  organizationId: string;
  name: string;
  shortName?: string | null;
  color?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
}): Team {
  const name = input.name.trim();
  if (!name) throw invalid("Team name is required.");
  const id = newId("tem");
  const now = nowIso();
  run(
    `INSERT INTO teams (id, organization_id, name, short_name, color, logo_url, contact_name, contact_phone, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    [
      id,
      input.organizationId,
      name,
      input.shortName ?? name.slice(0, 4).toUpperCase(),
      input.color ?? "#1d4ed8",
      input.contactName ?? null,
      input.contactPhone ?? null,
      now,
      now,
    ],
  );
  return { id, name, shortName: input.shortName ?? name.slice(0, 4).toUpperCase(), color: input.color ?? "#1d4ed8", logoUrl: null, contactName: input.contactName ?? null, contactPhone: input.contactPhone ?? null };
}

export type Player = {
  id: string;
  fullName: string;
  birthDate: string | null;
  guardianName: string | null;
  notes: string | null;
};

export type PublicPlayer = { id: string; fullName: string };

export function listPlayers(organizationId: string): Player[] {
  return all<{ id: string; full_name: string; birth_date: string | null; guardian_name: string | null; notes: string | null }>(
    "SELECT id, full_name, birth_date, guardian_name, notes FROM players WHERE organization_id = ? ORDER BY full_name",
    [organizationId],
  ).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    birthDate: row.birth_date,
    guardianName: row.guardian_name,
    notes: row.notes,
  }));
}

export function createPlayer(input: {
  organizationId: string;
  fullName: string;
  birthDate?: string | null;
  guardianName?: string | null;
  notes?: string | null;
  actor: { userId: string; name: string };
}): Player {
  const fullName = input.fullName.trim();
  if (fullName.length < 2) throw invalid("Player name is required.");
  const id = newId("ply");
  const now = nowIso();
  run(
    `INSERT INTO players (id, organization_id, full_name, birth_date, guardian_name, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.organizationId,
      fullName,
      input.birthDate ?? null,
      input.guardianName ?? null,
      input.notes ?? null,
      now,
      now,
    ],
  );
  recordAudit({
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
    actorName: input.actor.name,
    action: "player.created",
    entityType: "player",
    entityId: id,
    after: { fullName },
  });
  return { id, fullName, birthDate: input.birthDate ?? null, guardianName: input.guardianName ?? null, notes: input.notes ?? null };
}

export type RosterEntry = {
  id: string;
  teamId: string;
  teamName: string;
  playerId: string;
  playerName: string;
  jerseyNumber: number;
  position: string | null;
  status: "pending" | "active" | "inactive";
  eligible: boolean;
};

export function listRoster(organizationId: string, tournamentId: string, teamId?: string): RosterEntry[] {
  const params: (string | null)[] = [organizationId, tournamentId];
  let sql = `SELECT r.*, t.name AS team_name, p.full_name AS player_name
               FROM roster_entries r
               JOIN teams t ON t.id = r.team_id
               JOIN players p ON p.id = r.player_id
              WHERE r.organization_id = ? AND r.tournament_id = ?`;
  if (teamId) {
    sql += " AND r.team_id = ?";
    params.push(teamId);
  }
  sql += " ORDER BY t.name, r.jersey_number";

  return all<{
    id: string;
    team_id: string;
    team_name: string;
    player_id: string;
    player_name: string;
    jersey_number: number;
    position: string | null;
    status: "pending" | "active" | "inactive";
    eligible: number;
  }>(sql, params).map((row) => ({
    id: row.id,
    teamId: row.team_id,
    teamName: row.team_name,
    playerId: row.player_id,
    playerName: row.player_name,
    jerseyNumber: row.jersey_number,
    position: row.position,
    status: row.status,
    eligible: row.eligible === 1,
  }));
}

export function addRosterEntry(input: {
  organizationId: string;
  tournamentId: string;
  teamId: string;
  playerId: string;
  jerseyNumber: number;
  position?: string | null;
  actor: { userId: string; name: string };
}): RosterEntry {
  const tournament = getTournament(input.organizationId, input.tournamentId);
  if (tournament.rosterLocked) {
    throw invalid("The roster is locked. Unlock it to make roster changes.");
  }
  if (!Number.isInteger(input.jerseyNumber) || input.jerseyNumber < 0 || input.jerseyNumber > 99) {
    throw invalid("Jersey number must be between 0 and 99.");
  }

  const teamMember = one("SELECT id FROM tournament_teams WHERE tournament_id = ? AND team_id = ?", [
    input.tournamentId,
    input.teamId,
  ]);
  if (!teamMember) throw invalid("Register the team in this tournament before adding players.");

  const id = newId("ros");
  try {
    run(
      `INSERT INTO roster_entries (id, organization_id, tournament_id, team_id, player_id, jersey_number, position, status, eligible, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?)`,
      [
        id,
        input.organizationId,
        input.tournamentId,
        input.teamId,
        input.playerId,
        input.jerseyNumber,
        input.position ?? null,
        nowIso(),
      ],
    );
  } catch (error) {
    const message = String((error as Error).message);
    if (message.includes("UNIQUE") && message.includes("player_id")) {
      throw new AppError("conflict", "That player is already registered in this tournament.");
    }
    if (message.includes("UNIQUE")) {
      throw new AppError("conflict", "That jersey number is already used on this team.");
    }
    throw error;
  }

  recordAudit({
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
    actorName: input.actor.name,
    action: "roster.entry_added",
    entityType: "roster_entry",
    entityId: id,
    after: { teamId: input.teamId, playerId: input.playerId, jerseyNumber: input.jerseyNumber },
  });

  return listRoster(input.organizationId, input.tournamentId, input.teamId).find((entry) => entry.id === id)!;
}

export function updateRosterEntry(input: {
  organizationId: string;
  entryId: string;
  patch: { jerseyNumber?: number; status?: "pending" | "active" | "inactive"; eligible?: boolean };
  actor: { userId: string; name: string };
}): void {
  const entry = one<{
    id: string;
    tournament_id: string;
    jersey_number: number;
    status: string;
    eligible: number;
  }>("SELECT id, tournament_id, jersey_number, status, eligible FROM roster_entries WHERE id = ? AND organization_id = ?", [
    input.entryId,
    input.organizationId,
  ]);
  if (!entry) throw notFound("Roster entry");

  const tournament = getTournament(input.organizationId, entry.tournament_id);
  if (tournament.rosterLocked) throw invalid("The roster is locked. Unlock it to make roster changes.");

  run("UPDATE roster_entries SET jersey_number = ?, status = ?, eligible = ? WHERE id = ?", [
    input.patch.jerseyNumber ?? entry.jersey_number,
    input.patch.status ?? entry.status,
    input.patch.eligible === undefined ? entry.eligible : input.patch.eligible,
    entry.id,
  ]);

  recordAudit({
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
    actorName: input.actor.name,
    action: "roster.entry_updated",
    entityType: "roster_entry",
    entityId: entry.id,
    before: { jerseyNumber: entry.jersey_number, status: entry.status, eligible: entry.eligible === 1 },
    after: input.patch,
  });
}

export function registerTeam(input: {
  organizationId: string;
  tournamentId: string;
  divisionId: string;
  teamId: string;
  seed?: number | null;
}): void {
  const division = one("SELECT id FROM divisions WHERE id = ? AND tournament_id = ? AND organization_id = ?", [
    input.divisionId,
    input.tournamentId,
    input.organizationId,
  ]);
  if (!division) throw notFound("Division");

  try {
    run(
      `INSERT INTO tournament_teams (id, organization_id, tournament_id, division_id, team_id, seed, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'registered', ?)`,
      [
        newId("ttm"),
        input.organizationId,
        input.tournamentId,
        input.divisionId,
        input.teamId,
        input.seed ?? null,
        nowIso(),
      ],
    );
  } catch (error) {
    if (String((error as Error).message).includes("UNIQUE")) {
      throw new AppError("conflict", "That team is already registered in this tournament.");
    }
    throw error;
  }
}

export type TournamentTeam = { teamId: string; teamName: string; divisionId: string; seed: number | null; status: string };

export function listTournamentTeams(organizationId: string, tournamentId: string): TournamentTeam[] {
  return all<{ team_id: string; name: string; division_id: string; seed: number | null; status: string }>(
    `SELECT tt.team_id, t.name, tt.division_id, tt.seed, tt.status
       FROM tournament_teams tt JOIN teams t ON t.id = tt.team_id
      WHERE tt.organization_id = ? AND tt.tournament_id = ?
      ORDER BY tt.division_id, COALESCE(tt.seed, 999), t.name`,
    [organizationId, tournamentId],
  ).map((row) => ({
    teamId: row.team_id,
    teamName: row.name,
    divisionId: row.division_id,
    seed: row.seed,
    status: row.status,
  }));
}

// ---------------------------------------------------------------------------
// Venues
// ---------------------------------------------------------------------------

export type Venue = { id: string; name: string; address: string | null };

export function listVenues(organizationId: string, tournamentId: string): Venue[] {
  return all<{ id: string; name: string; address: string | null }>(
    "SELECT id, name, address FROM venues WHERE organization_id = ? AND tournament_id = ? ORDER BY name",
    [organizationId, tournamentId],
  );
}

export function createVenue(input: {
  organizationId: string;
  tournamentId: string;
  name: string;
  address?: string | null;
}): Venue {
  getTournament(input.organizationId, input.tournamentId);
  const name = input.name.trim();
  if (!name) throw invalid("Venue name is required.");
  const id = newId("ven");
  run("INSERT INTO venues (id, organization_id, tournament_id, name, address, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
    id,
    input.organizationId,
    input.tournamentId,
    name,
    input.address ?? null,
    nowIso(),
  ]);
  return { id, name, address: input.address ?? null };
}
