import { GAME_STATUS_LABELS, type GameStatus } from "../domain/game-state";
import { one } from "../db/sql";
import { loadGameState } from "./games";

/**
 * Public-safe scoreboard projection. Contains no player personal data — only
 * team-level information suitable for a projector in a gymnasium and for the
 * public live page.
 */
export type ScoreboardTeamView = {
  teamId: string;
  name: string;
  shortName: string | null;
  color: string | null;
  score: number;
  teamFouls: number;
  timeoutsUsed: number;
};

export type ScoreboardView = {
  gameId: string;
  status: GameStatus;
  statusLabel: string;
  period: number;
  periodCount: number;
  clock: {
    remainingMs: number;
    running: boolean;
    expired: boolean;
    anchorAt: string;
    serverNow: string;
  };
  home: ScoreboardTeamView;
  away: ScoreboardTeamView;
  tournamentName: string;
  tournamentFormat: string;
  divisionName: string;
  venueName: string | null;
  scheduledAt: string | null;
  lastEventSeq: number;
  updatedAt: string;
  lastSyncedAt: string | null;
  pendingSyncEvents: number;
  syncState: "synchronized" | "pending" | "local_only";
  hasApprovedResult: boolean;
};

export function buildScoreboardView(input: {
  gameId: string;
  organizationId?: string | null;
}): ScoreboardView {
  const state = loadGameState({ gameId: input.gameId, organizationId: input.organizationId });
  const game = state.game;

  const homeStats = state.boxScore.teams.find((team) => team.teamId === game.homeTeamId);
  const awayStats = state.boxScore.teams.find((team) => team.teamId === game.awayTeamId);

  const lastSyncedAt =
    one<{ at: string | null }>(
      `SELECT MAX(o.remote_confirmed_at) AS at
         FROM sync_operations o JOIN game_events e ON e.id = o.entity_id
        WHERE e.game_id = ? AND o.status = 'synchronized'`,
      [game.id],
    )?.at ?? null;

  const hasApprovedResult =
    (one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM game_results WHERE game_id = ? AND status = 'approved'",
      [game.id],
    )?.n ?? 0) > 0;

  return {
    gameId: game.id,
    status: game.status as GameStatus,
    statusLabel: GAME_STATUS_LABELS[game.status as GameStatus] ?? game.status,
    period: state.clock.period,
    periodCount: game.periodCount,
    clock: {
      remainingMs: state.clock.remainingMs,
      running: state.clock.running,
      expired: state.clock.expired,
      anchorAt: state.clock.anchorAt,
      serverNow: state.clock.serverNow,
    },
    home: {
      teamId: game.homeTeamId,
      name: game.homeTeamName,
      shortName: game.homeShort,
      color: game.homeColor,
      score: game.homeScore,
      teamFouls: homeStats?.fouls ?? 0,
      timeoutsUsed: homeStats?.timeoutsUsed ?? 0,
    },
    away: {
      teamId: game.awayTeamId,
      name: game.awayTeamName,
      shortName: game.awayShort,
      color: game.awayColor,
      score: game.awayScore,
      teamFouls: awayStats?.fouls ?? 0,
      timeoutsUsed: awayStats?.timeoutsUsed ?? 0,
    },
    tournamentName: state.tournament.name,
    tournamentFormat: state.format,
    divisionName: game.divisionName,
    venueName: game.venueName,
    scheduledAt: game.scheduledAt,
    lastEventSeq: game.lastEventSeq,
    updatedAt: game.updatedAt,
    lastSyncedAt,
    pendingSyncEvents: state.pendingSyncEvents,
    syncState: state.pendingSyncEvents === 0 ? "synchronized" : lastSyncedAt ? "pending" : "local_only",
    hasApprovedResult,
  };
}
