/**
 * Sport adapter boundary.
 *
 * Everything in this file is sport-agnostic. Adding volleyball or badminton
 * means adding another adapter, not touching organizations, tournaments,
 * scheduling, permissions, reporting or sync.
 */

export type EventCategory =
  | "scoring"
  | "foul"
  | "rebound"
  | "ball"
  | "team"
  | "clock"
  | "admin";

export type EventDefinition = {
  key: string;
  label: string;
  category: EventCategory;
  /** Points added to the team/player total when this event is recorded. */
  points?: number;
  requiresPlayer?: boolean;
  requiresTeam?: boolean;
  /** Recorded for the record but does not affect a statistic line. */
  informational?: boolean;
};

export type EventInput = {
  eventType: string;
  teamId?: string | null;
  playerId?: string | null;
  payload?: Record<string, unknown>;
};

export type ValidationContext = {
  /** playerId -> teamId for the current game's eligible roster. */
  roster: Map<string, string>;
  /** Team -> number of non-voided personal fouls already recorded per player. */
  personalFoulsByPlayer: Map<string, number>;
  /** Team -> timeouts already used. */
  timeoutsByTeam: Map<string, number>;
  maxPersonalFouls: number;
  maxTimeouts: number;
  period: number;
};

export type PlayerStatLine = {
  playerId: string;
  teamId: string;
  points: number;
  fgm2: number;
  fga2: number;
  fgm3: number;
  fga3: number;
  ftm: number;
  fta: number;
  fouls: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  substitutions: number;
  secondsPlayed: number;
  foulsByPeriod: Record<number, number>;
};

export type TeamStatLine = {
  teamId: string;
  points: number;
  fouls: number;
  foulsByPeriod: Record<number, number>;
  timeoutsUsed: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
};

export type BoxScore = {
  players: PlayerStatLine[];
  teams: TeamStatLine[];
  score: { home: number; away: number };
  /** Populated only when on-court membership is known from recorded events. */
  playingTimeAvailable: boolean;
};

export type NormalizedEvent = {
  id: string;
  seq: number;
  eventType: string;
  teamId: string | null;
  playerId: string | null;
  period: number;
  clockSecondsRemaining: number;
  occurredAt: string;
  payload: Record<string, unknown>;
  voided: boolean;
};

export type GameTeams = { homeTeamId: string; awayTeamId: string };

export interface SportAdapter {
  key: string;
  name: string;
  defaultPeriodCount: number;
  defaultPeriodSeconds: number;
  overtimeSeconds: number;
  events: EventDefinition[];
  eventByKey(key: string): EventDefinition | undefined;
  validateEvent(input: EventInput, context: ValidationContext): void;
  emptyLine(playerId: string, teamId: string): PlayerStatLine;
  emptyTeamLine(teamId: string): TeamStatLine;
  applyEvent(line: PlayerStatLine, event: NormalizedEvent): void;
  scorePoints(event: NormalizedEvent): number;
  boxScore(events: NormalizedEvent[], teams: GameTeams): BoxScore;
}
