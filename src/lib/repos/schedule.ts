import { AppError, invalid } from "../domain/errors";
import { newId, nowIso } from "../domain/ids";
import { parseRuleset } from "../domain/ruleset";
import {
  detectConflicts,
  roundRobinSchedule,
  singleEliminationBracket,
  type ConflictInput,
  type ScheduleConflict,
  type ScheduledPairing,
} from "../domain/scheduling";
import { all, one, run } from "../db/sql";
import { transaction } from "../db/client";
import { recordAudit } from "./audit";
import { getTournament, listTournamentTeams, type TournamentFormat } from "./tournaments";

export type GameSummary = {
  id: string;
  organizationId: string;
  tournamentId: string;
  divisionId: string;
  divisionName: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeShort: string | null;
  awayShort: string | null;
  homeColor: string | null;
  awayColor: string | null;
  venueName: string | null;
  scheduledAt: string | null;
  status: string;
  stage: string;
  roundNumber: number;
  bracketSlot: number | null;
  homeScore: number;
  awayScore: number;
  currentPeriod: number;
  periodCount: number;
  periodSeconds: number;
  updatedAt: string;
  lastEventSeq: number;
};

export const GAME_SUMMARY_SELECT = `
  SELECT g.*, d.name AS division_name, t.name AS tournament_name, t.slug AS tournament_slug,
         ht.name AS home_name, ht.short_name AS home_short, ht.color AS home_color,
         at.name AS away_name, at.short_name AS away_short, at.color AS away_color,
         v.name AS venue_name
    FROM games g
    JOIN divisions d ON d.id = g.division_id
    JOIN tournaments t ON t.id = g.tournament_id
    JOIN teams ht ON ht.id = g.home_team_id
    JOIN teams at ON at.id = g.away_team_id
    LEFT JOIN venues v ON v.id = g.venue_id
`;

export function mapGameSummary(row: Record<string, unknown>): GameSummary {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    tournamentId: row.tournament_id as string,
    divisionId: row.division_id as string,
    divisionName: row.division_name as string,
    homeTeamId: row.home_team_id as string,
    awayTeamId: row.away_team_id as string,
    homeTeamName: row.home_name as string,
    awayTeamName: row.away_name as string,
    homeShort: (row.home_short as string) ?? null,
    awayShort: (row.away_short as string) ?? null,
    homeColor: (row.home_color as string) ?? null,
    awayColor: (row.away_color as string) ?? null,
    venueName: (row.venue_name as string) ?? null,
    scheduledAt: (row.scheduled_at as string) ?? null,
    status: row.status as string,
    stage: row.stage as string,
    roundNumber: row.round_number as number,
    bracketSlot: (row.bracket_slot as number) ?? null,
    homeScore: row.home_score as number,
    awayScore: row.away_score as number,
    currentPeriod: row.current_period as number,
    periodCount: row.period_count as number,
    periodSeconds: row.period_seconds as number,
    updatedAt: row.updated_at as string,
    lastEventSeq: row.last_event_seq as number,
  };
}

export function listTournamentGames(organizationId: string, tournamentId: string): GameSummary[] {
  return all<Record<string, unknown>>(
    `${GAME_SUMMARY_SELECT} WHERE g.organization_id = ? AND g.tournament_id = ?
      ORDER BY g.round_number, g.bracket_slot, g.scheduled_at, g.created_at`,
    [organizationId, tournamentId],
  ).map(mapGameSummary);
}

export function listDivisionGames(organizationId: string, divisionId: string): GameSummary[] {
  return all<Record<string, unknown>>(
    `${GAME_SUMMARY_SELECT} WHERE g.organization_id = ? AND g.division_id = ?
      ORDER BY g.round_number, g.bracket_slot, g.scheduled_at, g.created_at`,
    [organizationId, divisionId],
  ).map(mapGameSummary);
}

export function listPublicGames(tournamentId: string): GameSummary[] {
  return all<Record<string, unknown>>(
    `${GAME_SUMMARY_SELECT} WHERE g.tournament_id = ? AND t.status = 'published'
      ORDER BY g.round_number, g.bracket_slot, g.scheduled_at, g.created_at`,
    [tournamentId],
  ).map(mapGameSummary);
}

// ---------------------------------------------------------------------------
// Schedule planning / generation
// ---------------------------------------------------------------------------

export type ScheduleDraft = {
  round: number;
  slot: number;
  stage: string;
  bracketSlot: number | null;
  homeTeamId: string;
  awayTeamId: string;
  scheduledAt: string | null;
  venueId: string | null;
};

export type SchedulePlan = {
  drafts: ScheduleDraft[];
  conflicts: ScheduleConflict[];
  byes: { seed: number; round: number; slot: number }[];
  expectedGameCount: number;
  /** Total rounds in the format, including rounds that are created later. */
  totalRounds: number;
};

function stageForRound(round: number, totalRounds: number): string {
  if (totalRounds <= 1) return "final";
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return "final";
  if (fromEnd === 1) return "semifinal";
  if (fromEnd === 2) return "quarterfinal";
  return `r${round}`;
}

function existingConflicts(organizationId: string, tournamentId: string, divisionId: string): ConflictInput[] {
  return all<{ id: string; home_team_id: string; away_team_id: string; scheduled_at: string | null; venue_id: string | null }>(
    `SELECT id, home_team_id, away_team_id, scheduled_at, venue_id FROM games
      WHERE organization_id = ? AND tournament_id = ? AND division_id = ?`,
    [organizationId, tournamentId, divisionId],
  ).map((row) => ({
    id: row.id,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
    scheduledAt: row.scheduled_at,
    venueId: row.venue_id,
  }));
}

export function planDivisionSchedule(input: {
  organizationId: string;
  tournamentId: string;
  divisionId: string;
  format: TournamentFormat;
  startAt: string | null;
  intervalMinutes: number;
  venueId: string | null;
}): SchedulePlan {
  const tournament = getTournament(input.organizationId, input.tournamentId);
  const teams = listTournamentTeams(input.organizationId, input.tournamentId)
    .filter((team) => team.divisionId === input.divisionId && team.status !== "withdrawn")
    .sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999) || a.teamName.localeCompare(b.teamName));

  if (teams.length < 2) throw invalid("Register at least two teams in this division first.");

  const existing = existingConflicts(input.organizationId, input.tournamentId, input.divisionId);
  const drafts: ScheduleDraft[] = [];
  const byes: SchedulePlan["byes"] = [];
  let expectedGameCount = 0;
  let totalRounds = 1;

  if (input.format === "single_elimination") {
    const plan = singleEliminationBracket(teams.map((team) => team.teamId));
    expectedGameCount = plan.playable.length;
    totalRounds = plan.rounds;
    const seedToTeam = new Map<number, string>();
    teams.forEach((team, index) => seedToTeam.set(index + 1, team.teamId));

    plan.playable.forEach((match, index) => {
      drafts.push({
        round: 1,
        slot: match.slot,
        stage: stageForRound(1, plan.rounds),
        bracketSlot: match.slot,
        homeTeamId: seedToTeam.get(match.homeSeed)!,
        awayTeamId: seedToTeam.get(match.awaySeed)!,
        scheduledAt: addMinutes(input.startAt, index * input.intervalMinutes),
        venueId: input.venueId,
      });
    });

    for (const match of plan.matches.filter((entry) => entry.bye)) {
      byes.push({ seed: match.autoAdvanceSeed!, round: 1, slot: match.slot });
    }
  } else {
    const doubleRound = input.format === "double_round_robin";
    const pairings = roundRobinSchedule(
      teams.map((team) => team.teamId),
      { doubleRound },
    );
    expectedGameCount = pairings.length;
    totalRounds = Math.max(1, ...pairings.map((pairing) => pairing.round));
    pairings.forEach((pairing: ScheduledPairing, index) => {
      drafts.push({
        round: pairing.round,
        slot: pairing.slot,
        stage: "group",
        bracketSlot: null,
        homeTeamId: pairing.homeTeamId,
        awayTeamId: pairing.awayTeamId,
        scheduledAt: addMinutes(input.startAt, index * input.intervalMinutes),
        venueId: input.venueId,
      });
    });
  }

  // Detect conflicts against existing games and within the new batch.
  const accumulated: ConflictInput[] = [...existing];
  const seen = new Set<string>();
  const conflicts: ScheduleConflict[] = [];

  for (const draft of drafts) {
    const found = detectConflicts(draft, accumulated, input.intervalMinutes);
    for (const conflict of found) {
      // A double round robin intentionally repeats matchups.
      if (conflict.kind === "duplicate_matchup" && input.format === "double_round_robin") continue;
      const key = `${conflict.kind}:${conflict.gameId ?? "batch"}:${draft.round}:${draft.slot}`;
      if (seen.has(key)) continue;
      seen.add(key);
      conflicts.push({
        ...conflict,
        message: `${conflict.message} (round ${draft.round}, slot ${draft.slot})`,
      });
    }
    if (draft.scheduledAt && draft.venueId) {
      accumulated.push({
        homeTeamId: draft.homeTeamId,
        awayTeamId: draft.awayTeamId,
        scheduledAt: draft.scheduledAt,
        venueId: draft.venueId,
      });
    }
  }

  // Sanity: never allow a team to appear twice in the same round of a bracket.
  if (input.format === "single_elimination") {
    const perRound = new Map<number, Set<string>>();
    for (const draft of drafts) {
      const set = perRound.get(draft.round) ?? new Set<string>();
      for (const teamId of [draft.homeTeamId, draft.awayTeamId]) {
        if (set.has(teamId)) throw new AppError("validation", "Generated bracket contains a duplicate team.");
        set.add(teamId);
      }
      perRound.set(draft.round, set);
    }
  }

  void tournament;
  return { drafts, conflicts, byes, expectedGameCount, totalRounds };
}

export function generateDivisionSchedule(input: {
  organizationId: string;
  tournamentId: string;
  divisionId: string;
  startAt: string | null;
  intervalMinutes?: number;
  venueId?: string | null;
  actor: { userId: string; name: string };
}): { created: number; conflicts: ScheduleConflict[]; byes: number } {
  const tournament = getTournament(input.organizationId, input.tournamentId);
  const ruleset = parseRuleset(tournament.ruleset);

  const existingGames = one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM games WHERE division_id = ? AND organization_id = ?",
    [input.divisionId, input.organizationId],
  );
  if ((existingGames?.n ?? 0) > 0) {
    throw new AppError("conflict", "This division already has a schedule. Clear it before regenerating.");
  }

  const plan = planDivisionSchedule({
    organizationId: input.organizationId,
    tournamentId: input.tournamentId,
    divisionId: input.divisionId,
    format: tournament.format,
    startAt: input.startAt,
    intervalMinutes: input.intervalMinutes ?? 90,
    venueId: input.venueId ?? null,
  });

  const now = nowIso();
  const seedToTeam = listTournamentTeams(input.organizationId, input.tournamentId)
    .filter((team) => team.divisionId === input.divisionId)
    .sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999) || a.teamName.localeCompare(b.teamName));

  transaction((db) => {
    for (const draft of plan.drafts) {
      const id = newId("gam");
      db.prepare(
        `INSERT INTO games (id, organization_id, tournament_id, division_id, home_team_id, away_team_id, venue_id,
                            scheduled_at, status, stage, round_number, bracket_slot, period_count, period_seconds,
                            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.organizationId,
        input.tournamentId,
        input.divisionId,
        draft.homeTeamId,
        draft.awayTeamId,
        draft.venueId,
        draft.scheduledAt,
        draft.stage,
        draft.round,
        draft.bracketSlot,
        ruleset.periodCount,
        ruleset.periodSeconds,
        now,
        now,
      );

      db.prepare(
        `INSERT OR IGNORE INTO game_clock_states (game_id, period, remaining_ms, running, anchor_at, version, updated_at)
         VALUES (?, 1, ?, 0, ?, 1, ?)`,
      ).run(id, ruleset.periodSeconds * 1000, now, now);
    }

    // Record byes so the bracket view and advancement logic both see them.
    for (const bye of plan.byes) {
      const teamId = seedToTeam[bye.seed - 1]?.teamId;
      if (!teamId) continue;
      db.prepare(
        `INSERT OR REPLACE INTO bracket_advancements (id, organization_id, tournament_id, division_id, round_number, slot, source_game_id, winner_team_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      ).run(
        newId("brk"),
        input.organizationId,
        input.tournamentId,
        input.divisionId,
        bye.round,
        bye.slot,
        teamId,
        nowIso(),
      );
    }

    // Register every round, including rounds whose games are created later as
    // winners emerge. Bracket progression depends on knowing the final round.
    for (let roundNumber = 1; roundNumber <= plan.totalRounds; roundNumber += 1) {
      db.prepare(
        `INSERT OR REPLACE INTO tournament_rounds (id, organization_id, tournament_id, division_id, round_number, name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newId("rnd"),
        input.organizationId,
        input.tournamentId,
        input.divisionId,
        roundNumber,
        `Round ${roundNumber}`,
        nowIso(),
      );
    }
  });

  recordAudit({
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
    actorName: input.actor.name,
    action: "schedule.generated",
    entityType: "division",
    entityId: input.divisionId,
    after: { games: plan.drafts.length, format: tournament.format, byes: plan.byes.length },
  });

  return { created: plan.drafts.length, conflicts: plan.conflicts, byes: plan.byes.length };
}

export function clearDivisionSchedule(input: {
  organizationId: string;
  divisionId: string;
  actor: { userId: string; name: string };
}): number {
  const started = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM games g
      WHERE g.division_id = ? AND g.organization_id = ?
        AND (g.status <> 'scheduled' OR g.last_event_seq > 0)`,
    [input.divisionId, input.organizationId],
  );
  if ((started?.n ?? 0) > 0) {
    throw new AppError("conflict", "Games in this division have already started and cannot be cleared.");
  }

  const count = one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM games WHERE division_id = ? AND organization_id = ?",
    [input.divisionId, input.organizationId],
  );
  run("DELETE FROM games WHERE division_id = ? AND organization_id = ?", [
    input.divisionId,
    input.organizationId,
  ]);
  run("DELETE FROM bracket_advancements WHERE division_id = ? AND organization_id = ?", [
    input.divisionId,
    input.organizationId,
  ]);

  recordAudit({
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
    actorName: input.actor.name,
    action: "schedule.cleared",
    entityType: "division",
    entityId: input.divisionId,
    before: { games: count?.n ?? 0 },
  });

  return count?.n ?? 0;
}

function addMinutes(base: string | null, minutes: number): string | null {
  if (!base) return null;
  const parsed = new Date(base);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getTime() + minutes * 60_000).toISOString();
}
