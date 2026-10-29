import { all, one } from "../db/sql";
import type { GameSummary } from "./schedule";
import { GAME_SUMMARY_SELECT, mapGameSummary } from "./schedule";
import { syncSummary, type SyncSummary } from "./sync";

export type DashboardData = {
  tournaments: number;
  publishedTournaments: number;
  teams: number;
  players: number;
  games: number;
  liveGames: number;
  awaitingReview: number;
  upcomingGames: GameSummary[];
  sync: SyncSummary;
  recentGames: GameSummary[];
};

export function getDashboard(organizationId: string): DashboardData {
  const count = (sql: string) => one<{ n: number }>(sql, [organizationId])?.n ?? 0;

  return {
    tournaments: count("SELECT COUNT(*) AS n FROM tournaments WHERE organization_id = ?"),
    publishedTournaments: count(
      "SELECT COUNT(*) AS n FROM tournaments WHERE organization_id = ? AND status = 'published'",
    ),
    teams: count("SELECT COUNT(*) AS n FROM teams WHERE organization_id = ?"),
    players: count("SELECT COUNT(*) AS n FROM players WHERE organization_id = ?"),
    games: count("SELECT COUNT(*) AS n FROM games WHERE organization_id = ?"),
    liveGames: count(
      "SELECT COUNT(*) AS n FROM games WHERE organization_id = ? AND status IN ('live','paused','halftime','period_ended')",
    ),
    awaitingReview: count(
      "SELECT COUNT(*) AS n FROM games WHERE organization_id = ? AND status = 'awaiting_review'",
    ),
    upcomingGames: all<Record<string, unknown>>(
      `${GAME_SUMMARY_SELECT}
        WHERE g.organization_id = ? AND g.status IN ('scheduled','ready')
        ORDER BY COALESCE(g.scheduled_at, '9999') LIMIT 6`,
      [organizationId],
    ).map(mapGameSummary),
    recentGames: all<Record<string, unknown>>(
      `${GAME_SUMMARY_SELECT}
        WHERE g.organization_id = ? AND g.last_event_seq > 0
        ORDER BY g.updated_at DESC LIMIT 6`,
      [organizationId],
    ).map(mapGameSummary),
    sync: syncSummary(organizationId),
  };
}
