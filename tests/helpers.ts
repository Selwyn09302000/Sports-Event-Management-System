import { openDatabase, resetDbForTests } from "@/lib/db/client";
import { newId, nowIso } from "@/lib/domain/ids";
import { run } from "@/lib/db/sql";
import { createOrganization } from "@/lib/repos/orgs";
import { createDivision, createTeam, registerTeam, createTournament, type TournamentFormat } from "@/lib/repos/tournaments";

export function useMemoryDatabase(): void {
  // getDb() re-opens when the configured path differs from the cached handle,
  // so the env var must point at :memory: as well — otherwise tests would hit
  // the real ./data/local.sqlite file.
  process.env.LOCAL_DB_PATH = ":memory:";
  const db = openDatabase(":memory:");
  resetDbForTests(db);
}

export function seedUser(email = `user-${newId("x")}@example.com`): string {
  const id = newId("usr");
  const now = nowIso();
  run("INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [
    id,
    email,
    "Test User",
    "scrypt$1$salt$hash",
    now,
    now,
  ]);
  return id;
}

export type Fixture = {
  userId: string;
  organizationId: string;
  tournamentId: string;
  divisionId: string;
  teamIds: string[];
  playerIds: string[];
};

/** Builds a tournament with `teamCount` teams of `playersPerTeam` players. */
export function seedTournament(options: {
  teamCount?: number;
  playersPerTeam?: number;
  format?: TournamentFormat;
  name?: string;
} = {}): Fixture {
  const {
    teamCount = 4,
    playersPerTeam = 5,
    format = "round_robin",
    name = "Test Cup",
  } = options;

  const userId = seedUser();
  const organization = createOrganization({
    name: `${name} Org ${newId("o")}`,
    ownerUserId: userId,
    ownerName: "Test User",
  });

  const actor = { userId, name: "Test User" };

  const tournament = createTournament({
    organizationId: organization.id,
    name,
    format,
    sportKey: "basketball",
    actor,
  });

  const division = createDivision({
    organizationId: organization.id,
    tournamentId: tournament.id,
    name: "Open",
  });

  const teamIds: string[] = [];
  const playerIds: string[] = [];

  for (let teamIndex = 0; teamIndex < teamCount; teamIndex += 1) {
    const team = createTeam({ organizationId: organization.id, name: `Team ${teamIndex + 1}` });
    teamIds.push(team.id);
    registerTeam({
      organizationId: organization.id,
      tournamentId: tournament.id,
      divisionId: division.id,
      teamId: team.id,
      seed: teamIndex + 1,
    });

    const roster: { playerId: string; jerseyNumber: number }[] = [];
    for (let slot = 0; slot < playersPerTeam; slot += 1) {
      const playerId = newId("ply");
      run(
        "INSERT INTO players (id, organization_id, full_name, birth_date, guardian_name, notes, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)",
        [playerId, organization.id, `Player ${teamIndex + 1}-${slot + 1}`, nowIso(), nowIso()],
      );
      run(
        `INSERT INTO roster_entries (id, organization_id, tournament_id, team_id, player_id, jersey_number, position, status, eligible, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 'active', 1, ?)`,
        [newId("ros"), organization.id, tournament.id, team.id, playerId, slot + 4, nowIso()],
      );
      playerIds.push(playerId);
      roster.push({ playerId, jerseyNumber: slot + 4 });
    }
  }

  return {
    userId,
    organizationId: organization.id,
    tournamentId: tournament.id,
    divisionId: division.id,
    teamIds,
    playerIds,
  };
}
