import { invalid } from "../errors";
import type {
  BoxScore,
  EventDefinition,
  EventInput,
  GameTeams,
  NormalizedEvent,
  PlayerStatLine,
  SportAdapter,
  TeamStatLine,
  ValidationContext,
} from "./types";

export const BASKETBALL_EVENTS: EventDefinition[] = [
  { key: "two_point_made", label: "2PT made", category: "scoring", points: 2, requiresPlayer: true, requiresTeam: true },
  { key: "two_point_missed", label: "2PT missed", category: "scoring", points: 0, requiresPlayer: true, requiresTeam: true },
  { key: "three_point_made", label: "3PT made", category: "scoring", points: 3, requiresPlayer: true, requiresTeam: true },
  { key: "three_point_missed", label: "3PT missed", category: "scoring", points: 0, requiresPlayer: true, requiresTeam: true },
  { key: "free_throw_made", label: "FT made", category: "scoring", points: 1, requiresPlayer: true, requiresTeam: true },
  { key: "free_throw_missed", label: "FT missed", category: "scoring", points: 0, requiresPlayer: true, requiresTeam: true },
  { key: "personal_foul", label: "Personal foul", category: "foul", requiresPlayer: true, requiresTeam: true },
  { key: "technical_foul", label: "Technical foul", category: "foul", requiresPlayer: true, requiresTeam: true },
  { key: "offensive_rebound", label: "Off. rebound", category: "rebound", requiresPlayer: true, requiresTeam: true },
  { key: "defensive_rebound", label: "Def. rebound", category: "rebound", requiresPlayer: true, requiresTeam: true },
  { key: "assist", label: "Assist", category: "ball", requiresPlayer: true, requiresTeam: true },
  { key: "steal", label: "Steal", category: "ball", requiresPlayer: true, requiresTeam: true },
  { key: "block", label: "Block", category: "ball", requiresPlayer: true, requiresTeam: true },
  { key: "turnover", label: "Turnover", category: "ball", requiresPlayer: true, requiresTeam: true },
  { key: "substitution", label: "Substitution", category: "team", requiresTeam: true },
  { key: "timeout", label: "Timeout", category: "team", requiresTeam: true },
  { key: "clock_started", label: "Clock started", category: "clock", informational: true },
  { key: "clock_paused", label: "Clock paused", category: "clock", informational: true },
  { key: "clock_adjusted", label: "Clock adjusted", category: "clock", informational: true },
  { key: "clock_reset", label: "Clock reset", category: "clock", informational: true },
  { key: "period_started", label: "Period started", category: "clock", informational: true },
  { key: "period_ended", label: "Period ended", category: "clock", informational: true },
  { key: "game_started", label: "Game started", category: "admin", informational: true },
  { key: "note", label: "Note", category: "admin", informational: true },
  { key: "score_corrected", label: "Score corrected", category: "admin", informational: true },
  { key: "game_finalized", label: "Game finalized", category: "admin", informational: true },
];

const EVENT_MAP = new Map(BASKETBALL_EVENTS.map((event) => [event.key, event]));

export const BASKETBALL_DEFAULTS = {
  periodCount: 4,
  periodSeconds: 600,
  overtimeSeconds: 300,
  maxPersonalFouls: 5,
  maxTimeouts: 5,
};

export function emptyPlayerLine(playerId: string, teamId: string): PlayerStatLine {
  return {
    playerId,
    teamId,
    points: 0,
    fgm2: 0,
    fga2: 0,
    fgm3: 0,
    fga3: 0,
    ftm: 0,
    fta: 0,
    fouls: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    substitutions: 0,
    secondsPlayed: 0,
    foulsByPeriod: {},
  };
}

export function emptyTeamLine(teamId: string): TeamStatLine {
  return {
    teamId,
    points: 0,
    fouls: 0,
    foulsByPeriod: {},
    timeoutsUsed: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
  };
}

export function pointsFor(event: NormalizedEvent): number {
  const definition = EVENT_MAP.get(event.eventType);
  if (!definition) return 0;
  return definition.points ?? 0;
}

export function applyBasketballEvent(line: PlayerStatLine, event: NormalizedEvent): void {
  const period = event.period || 1;

  switch (event.eventType) {
    case "two_point_made":
      line.fga2 += 1;
      line.fgm2 += 1;
      line.points += 2;
      break;
    case "two_point_missed":
      line.fga2 += 1;
      break;
    case "three_point_made":
      line.fga3 += 1;
      line.fgm3 += 1;
      line.points += 3;
      break;
    case "three_point_missed":
      line.fga3 += 1;
      break;
    case "free_throw_made":
      line.fta += 1;
      line.ftm += 1;
      line.points += 1;
      break;
    case "free_throw_missed":
      line.fta += 1;
      break;
    case "personal_foul":
    case "technical_foul":
      line.fouls += 1;
      line.foulsByPeriod[period] = (line.foulsByPeriod[period] ?? 0) + 1;
      break;
    case "offensive_rebound":
      line.offensiveRebounds += 1;
      line.rebounds += 1;
      break;
    case "defensive_rebound":
      line.defensiveRebounds += 1;
      line.rebounds += 1;
      break;
    case "assist":
      line.assists += 1;
      break;
    case "steal":
      line.steals += 1;
      break;
    case "block":
      line.blocks += 1;
      break;
    case "turnover":
      line.turnovers += 1;
      break;
    case "substitution":
      line.substitutions += 1;
      break;
    default:
      break;
  }
}

export function validateBasketballEvent(input: EventInput, context: ValidationContext): void {
  const definition = EVENT_MAP.get(input.eventType);
  if (!definition) throw invalid(`Unknown basketball event type: ${input.eventType}`);

  if (definition.requiresTeam && !input.teamId) {
    throw invalid(`${definition.label} requires a team.`);
  }
  if (definition.requiresPlayer && !input.playerId) {
    throw invalid(`${definition.label} requires a player.`);
  }

  if (input.playerId) {
    const teamId = context.roster.get(input.playerId);
    if (!teamId) {
      throw invalid("That player is not on an eligible roster for this game.");
    }
    if (input.teamId && teamId !== input.teamId) {
      throw invalid("That player does not belong to the selected team.");
    }
  }

  if (input.eventType === "personal_foul" && input.playerId) {
    const recorded = context.personalFoulsByPlayer.get(input.playerId) ?? 0;
    if (recorded >= context.maxPersonalFouls) {
      throw invalid(
        `Player already has ${recorded} personal fouls (limit ${context.maxPersonalFouls}). Correct the earlier record if this is wrong.`,
      );
    }
  }

  if (input.eventType === "timeout" && input.teamId) {
    const used = context.timeoutsByTeam.get(input.teamId) ?? 0;
    if (used >= context.maxTimeouts) {
      throw invalid(`That team has used all ${context.maxTimeouts} timeouts.`);
    }
  }

  if (input.eventType === "substitution") {
    const playerIn = typeof input.payload?.playerInId === "string" ? input.payload.playerInId : null;
    const playerOut = typeof input.payload?.playerOutId === "string" ? input.payload.playerOutId : null;
    if (!playerIn || !playerOut) throw invalid("A substitution needs both the player coming in and going out.");
    if (playerIn === playerOut) throw invalid("A player cannot substitute for themselves.");
    if (context.roster.get(playerIn) !== input.teamId) throw invalid("The incoming player is not on that team.");
    if (context.roster.get(playerOut) !== input.teamId) throw invalid("The outgoing player is not on that team.");
  }
}

function buildBoxScore(events: NormalizedEvent[], teams: GameTeams): BoxScore {
  const players = new Map<string, PlayerStatLine>();
  const teamLines = new Map<string, TeamStatLine>([
    [teams.homeTeamId, emptyTeamLine(teams.homeTeamId)],
    [teams.awayTeamId, emptyTeamLine(teams.awayTeamId)],
  ]);

  for (const event of events) {
    if (event.voided) continue;

    const teamLine = event.teamId ? teamLines.get(event.teamId) : undefined;
    const points = pointsFor(event);

    if (teamLine) {
      teamLine.points += points;
      if (event.eventType === "personal_foul" || event.eventType === "technical_foul") {
        teamLine.fouls += 1;
        const period = event.period || 1;
        teamLine.foulsByPeriod[period] = (teamLine.foulsByPeriod[period] ?? 0) + 1;
      }
      if (event.eventType === "timeout") teamLine.timeoutsUsed += 1;
      if (event.eventType === "offensive_rebound") teamLine.offensiveRebounds += 1;
      if (event.eventType === "defensive_rebound") teamLine.defensiveRebounds += 1;
      if (event.eventType === "offensive_rebound" || event.eventType === "defensive_rebound") {
        teamLine.rebounds += 1;
      }
      if (event.eventType === "assist") teamLine.assists += 1;
      if (event.eventType === "steal") teamLine.steals += 1;
      if (event.eventType === "block") teamLine.blocks += 1;
      if (event.eventType === "turnover") teamLine.turnovers += 1;
    }

    if (event.playerId && event.teamId) {
      const line = players.get(event.playerId) ?? emptyPlayerLine(event.playerId, event.teamId);
      applyBasketballEvent(line, event);
      players.set(event.playerId, line);
    }
  }

  // A timeout is team-only; keep the player list free of synthetic entries.

  const home = teamLines.get(teams.homeTeamId)!;
  const away = teamLines.get(teams.awayTeamId)!;

  return {
    players: [...players.values()],
    teams: [home, away],
    score: { home: home.points, away: away.points },
    playingTimeAvailable: false,
  };
}

export const basketballAdapter: SportAdapter = {
  key: "basketball",
  name: "Basketball",
  defaultPeriodCount: BASKETBALL_DEFAULTS.periodCount,
  defaultPeriodSeconds: BASKETBALL_DEFAULTS.periodSeconds,
  overtimeSeconds: BASKETBALL_DEFAULTS.overtimeSeconds,
  events: BASKETBALL_EVENTS,
  eventByKey: (key) => EVENT_MAP.get(key),
  validateEvent: validateBasketballEvent,
  emptyLine: emptyPlayerLine,
  emptyTeamLine,
  applyEvent: applyBasketballEvent,
  scorePoints: pointsFor,
  boxScore: buildBoxScore,
};
