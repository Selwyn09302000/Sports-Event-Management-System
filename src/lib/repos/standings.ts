import { computeStandings, type StandingRow } from "../domain/standings";
import { parseRulesetJson } from "../domain/ruleset";
import { all, one } from "../db/sql";
import type { GameSummary } from "./schedule";
import { GAME_SUMMARY_SELECT, mapGameSummary } from "./schedule";

export type DivisionStandings = {
  divisionId: string;
  divisionName: string;
  rows: (StandingRow & { teamName: string; teamShort: string | null })[];
};

export function getDivisionStandings(organizationId: string, divisionId: string): DivisionStandings {
  const division = one<{ id: string; name: string; tournament_id: string }>(
    "SELECT id, name, tournament_id FROM divisions WHERE id = ? AND organization_id = ?",
    [divisionId, organizationId],
  );
  if (!division) throw new Error("Division not found");

  const tournament = one<{ ruleset_json: string }>("SELECT ruleset_json FROM tournaments WHERE id = ?", [
    division.tournament_id,
  ]);
  const ruleset = parseRulesetJson(tournament?.ruleset_json);

  const teams = all<{ team_id: string; name: string; short_name: string | null }>(
    `SELECT tt.team_id, t.name, t.short_name
       FROM tournament_teams tt JOIN teams t ON t.id = tt.team_id
      WHERE tt.division_id = ? AND tt.organization_id = ? AND tt.status <> 'withdrawn'
      ORDER BY t.name`,
    [divisionId, organizationId],
  );

  // Only approved results count toward standings.
  const results = all<{ game_id: string; home_team_id: string; away_team_id: string; home_score: number; away_score: number }>(
    `SELECT r.game_id, g.home_team_id, g.away_team_id, r.home_score, r.away_score
       FROM game_results r JOIN games g ON g.id = r.game_id
      WHERE g.division_id = ? AND g.organization_id = ? AND r.status = 'approved'`,
    [divisionId, organizationId],
  );

  const table = computeStandings(
    teams.map((team) => team.team_id),
    results.map((row) => ({
      gameId: row.game_id,
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id,
      homeScore: row.home_score,
      awayScore: row.away_score,
    })),
    ruleset,
  );

  const byId = new Map(teams.map((team) => [team.team_id, team]));
  return {
    divisionId,
    divisionName: division.name,
    rows: table.map((row) => ({
      ...row,
      teamName: byId.get(row.teamId)?.name ?? row.teamId,
      teamShort: byId.get(row.teamId)?.short_name ?? null,
    })),
  };
}

export type BracketSlotView = {
  round: number;
  slot: number;
  game: GameSummary | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeName: string | null;
  awayName: string | null;
  winnerTeamId: string | null;
  status: string;
};

export type DivisionBracket = {
  divisionId: string;
  divisionName: string;
  rounds: { round: number; name: string; slots: BracketSlotView[] }[];
};

export function getDivisionBracket(organizationId: string, divisionId: string): DivisionBracket {
  const division = one<{ id: string; name: string }>(
    "SELECT id, name FROM divisions WHERE id = ? AND organization_id = ?",
    [divisionId, organizationId],
  );
  if (!division) throw new Error("Division not found");

  const games = all<Record<string, unknown>>(
    `${GAME_SUMMARY_SELECT} WHERE g.organization_id = ? AND g.division_id = ? AND g.stage <> 'group'
      ORDER BY g.round_number, g.bracket_slot`,
    [organizationId, divisionId],
  ).map(mapGameSummary);

  const advancements = all<{ round_number: number; slot: number; winner_team_id: string | null; team_name: string | null }>(
    `SELECT a.round_number, a.slot, a.winner_team_id, t.name AS team_name
       FROM bracket_advancements a LEFT JOIN teams t ON t.id = a.winner_team_id
      WHERE a.division_id = ? AND a.organization_id = ?`,
    [divisionId, organizationId],
  );

  const rounds = all<{ round_number: number; name: string }>(
    "SELECT round_number, name FROM tournament_rounds WHERE division_id = ? AND organization_id = ? ORDER BY round_number",
    [divisionId, organizationId],
  );

  const maxRound = Math.max(
    0,
    ...rounds.map((row) => row.round_number),
    ...games.map((game) => game.roundNumber),
  );

  const result: DivisionBracket["rounds"] = [];
  for (let round = 1; round <= maxRound; round += 1) {
    const roundGames = games.filter((game) => game.roundNumber === round);
    const slots: BracketSlotView[] = [];

    for (const game of roundGames) {
      const advancement = advancements.find((row) => row.round_number === round && row.slot === game.bracketSlot);
      slots.push({
        round,
        slot: game.bracketSlot ?? 0,
        game,
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId,
        homeName: game.homeTeamName,
        awayName: game.awayTeamName,
        winnerTeamId: advancement?.winner_team_id ?? null,
        status: game.status,
      });
    }

    // Byes and pending slots have an advancement but no game yet.
    for (const advancement of advancements.filter((row) => row.round_number === round)) {
      if (slots.some((slot) => slot.slot === advancement.slot)) continue;
      slots.push({
        round,
        slot: advancement.slot,
        game: null,
        homeTeamId: advancement.winner_team_id,
        awayTeamId: null,
        homeName: advancement.team_name,
        awayName: null,
        winnerTeamId: advancement.winner_team_id,
        status: "bye",
      });
    }

    slots.sort((a, b) => a.slot - b.slot);
    result.push({
      round,
      name: rounds.find((row) => row.round_number === round)?.name ?? `Round ${round}`,
      slots,
    });
  }

  return { divisionId, divisionName: division.name, rounds: result };
}

export function listApprovedResults(organizationId: string, tournamentId: string) {
  return all<{
    result_id: string;
    game_id: string;
    home_score: number;
    away_score: number;
    approved_at: string | null;
    home_name: string;
    away_name: string;
    division_name: string;
  }>(
    `SELECT r.id AS result_id, r.game_id, r.home_score, r.away_score, r.approved_at,
            ht.name AS home_name, at.name AS away_name, d.name AS division_name
       FROM game_results r
       JOIN games g ON g.id = r.game_id
       JOIN teams ht ON ht.id = g.home_team_id
       JOIN teams at ON at.id = g.away_team_id
       JOIN divisions d ON d.id = g.division_id
      WHERE r.organization_id = ? AND r.tournament_id = ? AND r.status = 'approved'
      ORDER BY r.approved_at DESC`,
    [organizationId, tournamentId],
  );
}
