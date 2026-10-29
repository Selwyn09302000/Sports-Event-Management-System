import { AppError, invalid, notFound } from "../domain/errors";
import { newId, nowIso } from "../domain/ids";
import { applyClockCommand, deriveRemainingMs, displaySeconds, snapshotClock, type ClockCommand, type ClockSnapshot } from "../domain/clock";
import { assertTransition, isFinalized, isScoringOpen, type GameStatus } from "../domain/game-state";
import { parseRulesetJson, type Ruleset } from "../domain/ruleset";
import type { BoxScore, EventInput, NormalizedEvent } from "../domain/sports/types";
import { getSportAdapter } from "../domain/sports/registry";
import { getDb, transaction } from "../db/client";
import { all, one, parseJson, run } from "../db/sql";
import { recordAudit } from "./audit";
import { enqueueSyncOperation } from "./sync";
import { GAME_SUMMARY_SELECT, mapGameSummary, type GameSummary } from "./schedule";

export type GameRow = {
  id: string;
  organization_id: string;
  tournament_id: string;
  division_id: string;
  home_team_id: string;
  away_team_id: string;
  venue_id: string | null;
  scheduled_at: string | null;
  status: GameStatus;
  stage: string;
  round_number: number;
  bracket_slot: number | null;
  home_score: number;
  away_score: number;
  current_period: number;
  period_count: number;
  period_seconds: number;
  version: number;
  last_event_seq: number;
  created_at: string;
  updated_at: string;
};

export type GameEventRow = {
  id: string;
  game_id: string;
  organization_id: string;
  tournament_id: string;
  team_id: string | null;
  player_id: string | null;
  event_type: string;
  period: number;
  clock_seconds_remaining: number;
  occurred_at: string;
  recorded_by: string;
  recorded_by_name: string | null;
  device_id: string | null;
  payload_json: string;
  schema_version: number;
  seq: number;
  client_action_id: string | null;
  sync_status: string;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  corrects_event_id: string | null;
  created_at: string;
};

export type RosterPlayer = {
  playerId: string;
  fullName: string;
  jerseyNumber: number;
  position: string | null;
  eligible: boolean;
  teamId: string;
};

export type GameState = {
  game: GameSummary;
  ruleset: Ruleset;
  format: string;
  tournament: { name: string; slug: string; status: string };
  clock: ClockSnapshot;
  events: (NormalizedEvent & {
    recordedByName: string | null;
    deviceId: string | null;
    syncStatus: string;
    voidedAt: string | null;
    voidReason: string | null;
    correctsEventId: string | null;
  })[];
  boxScore: BoxScore;
  periods: { period: number; homeScore: number; awayScore: number; durationSeconds: number }[];
  roster: { home: RosterPlayer[]; away: RosterPlayer[] };
  result: ResultRow | null;
  pendingSyncEvents: number;
};

export type ResultRow = {
  id: string;
  gameId: string;
  homeScore: number;
  awayScore: number;
  status: "submitted" | "approved" | "rejected" | "superseded";
  submittedBy: string;
  submittedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  correctedFromId: string | null;
};

type ResultDbRow = {
  id: string;
  game_id: string;
  home_score: number;
  away_score: number;
  status: ResultRow["status"];
  submitted_by: string;
  submitted_at: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  corrected_from_id: string | null;
  final_event_seq: number | null;
};

function mapResult(row: ResultDbRow): ResultRow {
  return {
    id: row.id,
    gameId: row.game_id,
    homeScore: row.home_score,
    awayScore: row.away_score,
    status: row.status,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    rejectionReason: row.rejection_reason,
    correctedFromId: row.corrected_from_id,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function getGameRow(gameId: string, organizationId?: string | null): GameRow {
  const row = organizationId
    ? one<GameRow>("SELECT * FROM games WHERE id = ? AND organization_id = ?", [gameId, organizationId])
    : one<GameRow>("SELECT * FROM games WHERE id = ?", [gameId]);
  if (!row) throw notFound("Game");
  return row;
}

export function getGameSummary(gameId: string, organizationId?: string | null): GameSummary {
  const row = organizationId
    ? one<Record<string, unknown>>(`${GAME_SUMMARY_SELECT} WHERE g.id = ? AND g.organization_id = ?`, [gameId, organizationId])
    : one<Record<string, unknown>>(`${GAME_SUMMARY_SELECT} WHERE g.id = ?`, [gameId]);
  if (!row) throw notFound("Game");
  return mapGameSummary(row);
}

export function isGamePublic(gameId: string): boolean {
  const row = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM games g JOIN tournaments t ON t.id = g.tournament_id
      WHERE g.id = ? AND t.status = 'published'`,
    [gameId],
  );
  return (row?.n ?? 0) > 0;
}

function readClock(game: GameRow): ClockSnapshot {
  const row = one<{
    period: number;
    remaining_ms: number;
    running: number;
    anchor_at: string;
    version: number;
  }>("SELECT period, remaining_ms, running, anchor_at, version FROM game_clock_states WHERE game_id = ?", [game.id]);

  if (!row) {
    return {
      period: 1,
      remainingMs: game.period_seconds * 1000,
      running: false,
      expired: false,
      anchorAt: nowIso(),
      serverNow: nowIso(),
      version: 1,
    };
  }

  return snapshotClock({
    gameId: game.id,
    period: row.period,
    remainingMs: row.remaining_ms,
    running: row.running === 1,
    anchorAt: row.anchor_at,
    version: row.version,
  });
}

function ensureClock(game: GameRow): void {
  const existing = one("SELECT game_id FROM game_clock_states WHERE game_id = ?", [game.id]);
  if (existing) return;
  const now = nowIso();
  run(
    `INSERT INTO game_clock_states (game_id, period, remaining_ms, running, anchor_at, version, updated_at)
     VALUES (?, 1, ?, 0, ?, 1, ?)`,
    [game.id, game.period_seconds * 1000, now, now],
  );
}

export function loadGameEvents(gameId: string): GameEventRow[] {
  return all<GameEventRow>("SELECT * FROM game_events WHERE game_id = ? ORDER BY seq", [gameId]);
}

function toNormalized(rows: GameEventRow[]): NormalizedEvent[] {
  return rows.map((row) => ({
    id: row.id,
    seq: row.seq,
    eventType: row.event_type,
    teamId: row.team_id,
    playerId: row.player_id,
    period: row.period,
    clockSecondsRemaining: row.clock_seconds_remaining,
    occurredAt: row.occurred_at,
    payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
    voided: row.voided_at !== null,
  }));
}

export function getRosterForGame(game: GameRow): RosterPlayer[] {
  return all<{
    player_id: string;
    full_name: string;
    jersey_number: number;
    position: string | null;
    eligible: number;
    team_id: string;
  }>(
    `SELECT r.player_id, p.full_name, r.jersey_number, r.position, r.eligible, r.team_id
       FROM roster_entries r JOIN players p ON p.id = r.player_id
      WHERE r.tournament_id = ? AND r.team_id IN (?, ?) AND r.status = 'active'
      ORDER BY r.team_id, r.jersey_number`,
    [game.tournament_id, game.home_team_id, game.away_team_id],
  ).map((row) => ({
    playerId: row.player_id,
    fullName: row.full_name,
    jerseyNumber: row.jersey_number,
    position: row.position,
    eligible: row.eligible === 1,
    teamId: row.team_id,
  }));
}

export function loadGameState(input: {
  gameId: string;
  organizationId?: string | null;
}): GameState {
  const game = getGameRow(input.gameId, input.organizationId);
  if (!input.organizationId && !isGamePublic(input.gameId)) throw notFound("Game");

  const tournament = one<{ name: string; slug: string; format: string; ruleset_json: string; status: string }>(
    "SELECT name, slug, format, ruleset_json, status FROM tournaments WHERE id = ?",
    [game.tournament_id],
  );
  if (!tournament) throw notFound("Tournament");

  const ruleset = parseRulesetJson(tournament.ruleset_json);
  const adapter = getSportAdapter("basketball");
  const eventRows = loadGameEvents(game.id);
  const normalized = toNormalized(eventRows);
  const boxScore = adapter.boxScore(normalized, {
    homeTeamId: game.home_team_id,
    awayTeamId: game.away_team_id,
  });

  const periods = all<{ period_number: number; home_score: number; away_score: number; duration_seconds: number }>(
    "SELECT period_number, home_score, away_score, duration_seconds FROM game_periods WHERE game_id = ? ORDER BY period_number",
    [game.id],
  ).map((row) => ({
    period: row.period_number,
    homeScore: row.home_score,
    awayScore: row.away_score,
    durationSeconds: row.duration_seconds,
  }));

  const roster = getRosterForGame(game);
  const resultRow = one<ResultDbRow>(
    "SELECT * FROM game_results WHERE game_id = ? ORDER BY created_at DESC LIMIT 1",
    [game.id],
  );
  const pendingSyncEvents =
    one<{ n: number }>("SELECT COUNT(*) AS n FROM game_events WHERE game_id = ? AND sync_status = 'pending'", [
      game.id,
    ])?.n ?? 0;

  return {
    game: getGameSummary(game.id, input.organizationId ?? undefined),
    ruleset,
    format: tournament.format,
    tournament: { name: tournament.name, slug: tournament.slug, status: tournament.status },
    clock: readClock(game),
    events: eventRows.map((row, index) => ({
      ...normalized[index],
      recordedByName: row.recorded_by_name,
      deviceId: row.device_id,
      syncStatus: row.sync_status,
      voidedAt: row.voided_at,
      voidReason: row.void_reason,
      correctsEventId: row.corrects_event_id,
    })),
    boxScore,
    periods,
    roster: {
      home: roster.filter((player) => player.teamId === game.home_team_id),
      away: roster.filter((player) => player.teamId === game.away_team_id),
    },
    result: resultRow ? mapResult(resultRow) : null,
    pendingSyncEvents,
  };
}

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

/**
 * Recomputes cached scores and statistics from the immutable event log. Called
 * in the same transaction as any write, so caches can never diverge from the
 * events that produce them.
 */
export function refreshDerived(gameId: string): void {
  const db = getDb();
  const game = one<GameRow>("SELECT * FROM games WHERE id = ?", [gameId]);
  if (!game) return;

  const rows = loadGameEvents(gameId);
  const normalized = toNormalized(rows);
  const adapter = getSportAdapter("basketball");
  const boxScore = adapter.boxScore(normalized, {
    homeTeamId: game.home_team_id,
    awayTeamId: game.away_team_id,
  });

  const clock = readClock(game);
  const periodCount = Math.max(game.period_count, clock.period, ...normalized.map((event) => event.period), 1);

  const perPeriod = new Map<number, { home: number; away: number }>();
  for (let period = 1; period <= periodCount; period += 1) perPeriod.set(period, { home: 0, away: 0 });
  for (const event of normalized) {
    if (event.voided || !event.teamId) continue;
    const points = adapter.scorePoints(event);
    if (!points) continue;
    const bucket = perPeriod.get(event.period) ?? { home: 0, away: 0 };
    if (event.teamId === game.home_team_id) bucket.home += points;
    else if (event.teamId === game.away_team_id) bucket.away += points;
    perPeriod.set(event.period, bucket);
  }

  db.prepare("UPDATE games SET home_score = ?, away_score = ?, current_period = ?, version = version + 1, updated_at = ? WHERE id = ?").run(
    boxScore.score.home,
    boxScore.score.away,
    clock.period,
    nowIso(),
    game.id,
  );

  for (const [period, scores] of perPeriod) {
    db.prepare(
      `INSERT INTO game_periods (game_id, period_number, duration_seconds, home_score, away_score)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (game_id, period_number) DO UPDATE SET home_score = excluded.home_score, away_score = excluded.away_score`,
    ).run(game.id, period, game.period_seconds, scores.home, scores.away);
  }

  const snapshotAt = nowIso();
  db.prepare("DELETE FROM player_game_statistics WHERE game_id = ?").run(game.id);
  for (const line of boxScore.players) {
    db.prepare(
      `INSERT INTO player_game_statistics
        (game_id, organization_id, team_id, player_id, points, fgm2, fga2, fgm3, fga3, ftm, fta, fouls,
         offensive_rebounds, defensive_rebounds, assists, steals, blocks, turnovers, substitutions, seconds_played, snapshot_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      game.id,
      game.organization_id,
      line.teamId,
      line.playerId,
      line.points,
      line.fgm2,
      line.fga2,
      line.fgm3,
      line.fga3,
      line.ftm,
      line.fta,
      line.fouls,
      line.offensiveRebounds,
      line.defensiveRebounds,
      line.assists,
      line.steals,
      line.blocks,
      line.turnovers,
      line.substitutions,
      line.secondsPlayed,
      snapshotAt,
    );
  }

  db.prepare("DELETE FROM team_game_statistics WHERE game_id = ?").run(game.id);
  for (const line of boxScore.teams) {
    db.prepare(
      `INSERT INTO team_game_statistics (game_id, organization_id, team_id, points, fouls, timeouts_used, snapshot_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(game.id, game.organization_id, line.teamId, line.points, line.fouls, line.timeoutsUsed, snapshotAt);
  }
}

// ---------------------------------------------------------------------------
// Event writes
// ---------------------------------------------------------------------------

function appendEvent(input: {
  game: GameRow;
  clock: ClockSnapshot;
  event: EventInput;
  actor: { userId: string; name: string };
  deviceId?: string | null;
  clientActionId?: string | null;
  correctsEventId?: string | null;
  clockSecondsOverride?: number;
}): string {
  const db = getDb();
  const seq =
    (one<{ n: number }>("SELECT COALESCE(MAX(seq), 0) AS n FROM game_events WHERE game_id = ?", [input.game.id])?.n ??
      0) + 1;

  const id = newId("evt");
  const occurredAt = nowIso();
  const clockSeconds = input.clockSecondsOverride ?? displaySeconds(input.clock.remainingMs);

  db.prepare(
    `INSERT INTO game_events
      (id, organization_id, tournament_id, game_id, team_id, player_id, event_type, period, clock_seconds_remaining,
       occurred_at, recorded_by, recorded_by_name, device_id, payload_json, schema_version, seq, client_action_id,
       sync_status, corrects_event_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'pending', ?, ?)`,
  ).run(
    id,
    input.game.organization_id,
    input.game.tournament_id,
    input.game.id,
    input.event.teamId ?? null,
    input.event.playerId ?? null,
    input.event.eventType,
    input.clock.period,
    clockSeconds,
    occurredAt,
    input.actor.userId,
    input.actor.name,
    input.deviceId ?? null,
    JSON.stringify(input.event.payload ?? {}),
    seq,
    input.clientActionId ?? null,
    input.correctsEventId ?? null,
    occurredAt,
  );

  db.prepare("UPDATE games SET last_event_seq = ?, updated_at = ? WHERE id = ?").run(seq, occurredAt, input.game.id);

  enqueueSyncOperation({
    organizationId: input.game.organization_id,
    entityType: "game_event",
    entityId: id,
    payload: {
      eventId: id,
      organizationId: input.game.organization_id,
      tournamentId: input.game.tournament_id,
      gameId: input.game.id,
      teamId: input.event.teamId ?? null,
      playerId: input.event.playerId ?? null,
      eventType: input.event.eventType,
      period: input.clock.period,
      clockSecondsRemaining: clockSeconds,
      occurredAt,
      recordedBy: input.actor.userId,
      deviceId: input.deviceId ?? null,
      payload: input.event.payload ?? {},
      schemaVersion: 1,
      seq,
    },
    idempotencyKey: `game_event:${id}`,
  });

  return id;
}

function validationContext(game: GameRow): {
  roster: Map<string, string>;
  personalFoulsByPlayer: Map<string, number>;
  timeoutsByTeam: Map<string, number>;
} {
  const roster = new Map(getRosterForGame(game).map((player) => [player.playerId, player.teamId]));
  const events = all<{ event_type: string; team_id: string | null; player_id: string | null }>(
    "SELECT event_type, team_id, player_id FROM game_events WHERE game_id = ? AND voided_at IS NULL",
    [game.id],
  );

  const personalFoulsByPlayer = new Map<string, number>();
  const timeoutsByTeam = new Map<string, number>();
  for (const event of events) {
    if (event.event_type === "personal_foul" && event.player_id) {
      personalFoulsByPlayer.set(event.player_id, (personalFoulsByPlayer.get(event.player_id) ?? 0) + 1);
    }
    if (event.event_type === "timeout" && event.team_id) {
      timeoutsByTeam.set(event.team_id, (timeoutsByTeam.get(event.team_id) ?? 0) + 1);
    }
  }
  return { roster, personalFoulsByPlayer, timeoutsByTeam };
}

export type RecordEventResult = { state: GameState; eventId: string; duplicate: boolean };

export function recordEvent(input: {
  organizationId: string;
  gameId: string;
  event: EventInput;
  clientActionId?: string | null;
  deviceId?: string | null;
  actor: { userId: string; name: string };
}): RecordEventResult {
  return transaction(() => {
    const game = getGameRow(input.gameId, input.organizationId);

    if (isFinalized(game.status)) {
      throw new AppError(
        "conflict",
        "This game is finalized. Use the review workflow to record a correction.",
      );
    }
    if (!isScoringOpen(game.status)) {
      throw new AppError("conflict", `The game is ${game.status}; scoring is not open.`);
    }

    // Idempotency: a retried action returns the original result unchanged.
    if (input.clientActionId) {
      const existing = one<{ id: string }>(
        "SELECT id FROM game_events WHERE game_id = ? AND client_action_id = ?",
        [game.id, input.clientActionId],
      );
      if (existing) {
        return {
          state: loadGameState({ gameId: game.id, organizationId: input.organizationId }),
          eventId: existing.id,
          duplicate: true,
        };
      }
    }

    ensureClock(game);
    const clock = readClock(game);
    const ruleset = parseRulesetJson(
      one<{ ruleset_json: string }>("SELECT ruleset_json FROM tournaments WHERE id = ?", [game.tournament_id])
        ?.ruleset_json,
    );
    const adapter = getSportAdapter("basketball");
    const context = validationContext(game);

    adapter.validateEvent(input.event, {
      roster: context.roster,
      personalFoulsByPlayer: context.personalFoulsByPlayer,
      timeoutsByTeam: context.timeoutsByTeam,
      maxPersonalFouls: ruleset.maxPersonalFouls,
      maxTimeouts: ruleset.maxTimeouts,
      period: clock.period,
    });

    const eventId = appendEvent({
      game,
      clock,
      event: input.event,
      actor: input.actor,
      deviceId: input.deviceId,
      clientActionId: input.clientActionId,
    });

    if (game.status === "ready" || game.status === "scheduled") {
      run("UPDATE games SET status = 'live' WHERE id = ?", [game.id]);
    }

    refreshDerived(game.id);

    return {
      state: loadGameState({ gameId: game.id, organizationId: input.organizationId }),
      eventId,
      duplicate: false,
    };
  });
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

export type ClockCommandInput =
  | { type: "start" }
  | { type: "pause" }
  | { type: "toggle" }
  | { type: "set"; remainingMs: number }
  | { type: "next_period" }
  | { type: "reset_period" };

export function runClockCommand(input: {
  organizationId: string;
  gameId: string;
  command: ClockCommandInput;
  actor: { userId: string; name: string };
  deviceId?: string | null;
}): GameState {
  return transaction(() => {
    const game = getGameRow(input.gameId, input.organizationId);
    if (isFinalized(game.status)) throw new AppError("conflict", "This game is already finalized.");

    ensureClock(game);
    const row = one<{
      period: number;
      remaining_ms: number;
      running: number;
      anchor_at: string;
      version: number;
    }>("SELECT period, remaining_ms, running, anchor_at, version FROM game_clock_states WHERE game_id = ?", [game.id])!;

    const state = {
      gameId: game.id,
      period: row.period,
      remainingMs: row.remaining_ms,
      running: row.running === 1,
      anchorAt: row.anchor_at,
      version: row.version,
    };

    const ruleset = parseRulesetJson(
      one<{ ruleset_json: string }>("SELECT ruleset_json FROM tournaments WHERE id = ?", [game.tournament_id])
        ?.ruleset_json,
    );
    const upcomingPeriod = state.period + 1;
    const periodSeconds =
      upcomingPeriod > game.period_count ? ruleset.overtimeSeconds : game.period_seconds;

    // Period lengths come from the stored game/ruleset, never from the client.
    const command: ClockCommand =
      input.command.type === "next_period" || input.command.type === "reset_period"
        ? { type: input.command.type, periodSeconds }
        : input.command;

    let transition;
    try {
      transition = applyClockCommand(state, command, Date.now());
    } catch (error) {
      throw invalid((error as Error).message);
    }

    const now = nowIso();
    run("UPDATE game_clock_states SET period = ?, remaining_ms = ?, running = ?, anchor_at = ?, version = version + 1, updated_at = ? WHERE game_id = ?", [
      transition.period,
      transition.remainingMs,
      transition.running,
      now,
      now,
      game.id,
    ]);

    const clock = readClock(game);

    if (transition.eventType) {
      appendEvent({
        game,
        clock,
        event: {
          eventType: transition.eventType,
          payload: {
            remainingMs: transition.remainingMs,
            running: transition.running,
            period: transition.period,
            command: input.command.type,
          },
        },
        actor: input.actor,
        deviceId: input.deviceId,
        clockSecondsOverride: displaySeconds(transition.remainingMs),
      });
    }

    // Status follows the clock, with explicit transitions validated.
    let nextStatus: GameStatus | null = null;
    if (transition.eventType === "clock_started") nextStatus = "live";
    if (transition.eventType === "clock_paused" && game.status !== "halftime") nextStatus = "paused";
    if (transition.eventType === "period_started" && (game.status === "period_ended" || game.status === "halftime")) {
      nextStatus = "live";
    }

    if (nextStatus) {
      assertTransition(game.status, nextStatus);
      run("UPDATE games SET status = ?, updated_at = ? WHERE id = ?", [nextStatus, now, game.id]);
    }

    if (input.command.type === "reset_period" || input.command.type === "set") {
      recordAudit({
        organizationId: input.organizationId,
        actorUserId: input.actor.userId,
        actorName: input.actor.name,
        action: "game.clock_adjusted",
        entityType: "game",
        entityId: game.id,
        before: { remainingMs: state.remainingMs, period: state.period },
        after: { remainingMs: transition.remainingMs, period: transition.period },
        reason: input.command.type === "reset_period" ? "Period clock reset" : "Clock set manually",
      });
    }

    refreshDerived(game.id);
    return loadGameState({ gameId: game.id, organizationId: input.organizationId });
  });
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

export function voidEvent(input: {
  organizationId: string;
  gameId: string;
  eventId: string;
  reason: string;
  actor: { userId: string; name: string };
}): GameState {
  if (!input.reason.trim()) throw invalid("A reason is required to void an event.");

  return transaction(() => {
    const game = getGameRow(input.gameId, input.organizationId);
    const event = one<GameEventRow>("SELECT * FROM game_events WHERE id = ? AND game_id = ?", [
      input.eventId,
      game.id,
    ]);
    if (!event) throw notFound("Event");
    if (event.voided_at) throw new AppError("conflict", "That event is already voided.");

    const now = nowIso();
    run("UPDATE game_events SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?", [
      now,
      input.actor.userId,
      input.reason.trim(),
      event.id,
    ]);

    if (isFinalized(game.status)) {
      run("UPDATE games SET status = 'corrected', updated_at = ? WHERE id = ?", [now, game.id]);
    }

    enqueueSyncOperation({
      organizationId: input.organizationId,
      entityType: "game_event_void",
      entityId: event.id,
      operation: "void",
      payload: {
        eventId: event.id,
        gameId: game.id,
        voidedAt: now,
        voidedBy: input.actor.userId,
        reason: input.reason.trim(),
      },
      idempotencyKey: `game_event_void:${event.id}`,
    });

    recordAudit({
      organizationId: input.organizationId,
      actorUserId: input.actor.userId,
      actorName: input.actor.name,
      action: "game.event_voided",
      entityType: "game_event",
      entityId: event.id,
      before: {
        eventType: event.event_type,
        playerId: event.player_id,
        teamId: event.team_id,
        period: event.period,
      },
      reason: input.reason.trim(),
    });

    refreshDerived(game.id);
    return loadGameState({ gameId: game.id, organizationId: input.organizationId });
  });
}

/**
 * Correction = void the original + append a replacement that points at it.
 * The original event is never mutated, so the audit trail stays intact.
 */
export function correctEvent(input: {
  organizationId: string;
  gameId: string;
  eventId: string;
  replacement: { playerId?: string | null; teamId?: string | null };
  reason: string;
  actor: { userId: string; name: string };
}): GameState {
  if (!input.reason.trim()) throw invalid("A reason is required to correct an event.");

  return transaction(() => {
    const game = getGameRow(input.gameId, input.organizationId);
    const event = one<GameEventRow>("SELECT * FROM game_events WHERE id = ? AND game_id = ?", [
      input.eventId,
      game.id,
    ]);
    if (!event) throw notFound("Event");
    if (event.voided_at) throw new AppError("conflict", "That event is already voided.");

    ensureClock(game);
    const clock = readClock(game);
    const now = nowIso();

    run("UPDATE game_events SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?", [
      now,
      input.actor.userId,
      `Corrected: ${input.reason.trim()}`,
      event.id,
    ]);

    const replacementTeamId = input.replacement.teamId ?? event.team_id;
    const replacementPlayerId = input.replacement.playerId ?? event.player_id;

    const replacementId = appendEvent({
      game,
      clock,
      event: {
        eventType: event.event_type,
        teamId: replacementTeamId,
        playerId: replacementPlayerId,
        payload: {
          ...parseJson<Record<string, unknown>>(event.payload_json, {}),
          correctionOf: event.id,
          reason: input.reason.trim(),
        },
      },
      actor: input.actor,
      correctsEventId: event.id,
      clockSecondsOverride: event.clock_seconds_remaining,
    });

    if (isFinalized(game.status)) {
      run("UPDATE games SET status = 'corrected', updated_at = ? WHERE id = ?", [now, game.id]);
    }

    recordAudit({
      organizationId: input.organizationId,
      actorUserId: input.actor.userId,
      actorName: input.actor.name,
      action: "game.event_corrected",
      entityType: "game_event",
      entityId: event.id,
      before: { eventType: event.event_type, playerId: event.player_id, teamId: event.team_id },
      after: { replacementEventId: replacementId, playerId: replacementPlayerId, teamId: replacementTeamId },
      reason: input.reason.trim(),
    });

    refreshDerived(game.id);
    return loadGameState({ gameId: game.id, organizationId: input.organizationId });
  });
}

// ---------------------------------------------------------------------------
// Lifecycle and review
// ---------------------------------------------------------------------------

export function endPeriod(input: {
  organizationId: string;
  gameId: string;
  actor: { userId: string; name: string };
}): GameState {
  return transaction(() => {
    const game = getGameRow(input.gameId, input.organizationId);
    if (isFinalized(game.status)) throw new AppError("conflict", "This game is already finalized.");

    ensureClock(game);
    const clockRow = one<{ period: number; remaining_ms: number; running: number; anchor_at: string; version: number }>(
      "SELECT period, remaining_ms, running, anchor_at, version FROM game_clock_states WHERE game_id = ?",
      [game.id],
    )!;
    const remaining = deriveRemainingMs(
      {
        gameId: game.id,
        period: clockRow.period,
        remainingMs: clockRow.remaining_ms,
        running: clockRow.running === 1,
        anchorAt: clockRow.anchor_at,
        version: clockRow.version,
      },
      Date.now(),
    );
    const now = nowIso();

    run("UPDATE game_clock_states SET remaining_ms = ?, running = 0, anchor_at = ?, version = version + 1, updated_at = ? WHERE game_id = ?", [
      remaining,
      now,
      now,
      game.id,
    ]);
    run("UPDATE game_periods SET ended_at = ? WHERE game_id = ? AND period_number = ?", [now, game.id, clockRow.period]);

    assertTransition(game.status, "period_ended");
    run("UPDATE games SET status = 'period_ended', updated_at = ? WHERE id = ?", [now, game.id]);

    appendEvent({
      game,
      clock: snapshotClock({
        gameId: game.id,
        period: clockRow.period,
        remainingMs: remaining,
        running: false,
        anchorAt: now,
        version: clockRow.version + 1,
      }),
      event: { eventType: "period_ended", payload: { period: clockRow.period, remainingMs: remaining } },
      actor: input.actor,
      clockSecondsOverride: displaySeconds(remaining),
    });

    refreshDerived(game.id);
    return loadGameState({ gameId: game.id, organizationId: input.organizationId });
  });
}

export function endGame(input: {
  organizationId: string;
  gameId: string;
  actor: { userId: string; name: string };
}): GameState {
  return transaction(() => {
    const game = getGameRow(input.gameId, input.organizationId);
    if (isFinalized(game.status)) throw new AppError("conflict", "This game is already finalized.");

    ensureClock(game);
    const now = nowIso();
    const clockRow = one<{ period: number; remaining_ms: number; running: number; anchor_at: string; version: number }>(
      "SELECT period, remaining_ms, running, anchor_at, version FROM game_clock_states WHERE game_id = ?",
      [game.id],
    )!;
    const remaining = deriveRemainingMs(
      {
        gameId: game.id,
        period: clockRow.period,
        remainingMs: clockRow.remaining_ms,
        running: clockRow.running === 1,
        anchorAt: clockRow.anchor_at,
        version: clockRow.version,
      },
      Date.now(),
    );

    run("UPDATE game_clock_states SET remaining_ms = ?, running = 0, anchor_at = ?, version = version + 1, updated_at = ? WHERE game_id = ?", [
      remaining,
      now,
      now,
      game.id,
    ]);
    // Final horn stops the adopted clock; it never auto-approves a result.
    assertTransition(game.status, "awaiting_review");
    run("UPDATE games SET status = 'awaiting_review', updated_at = ? WHERE id = ?", [now, game.id]);
    refreshDerived(game.id);

    recordAudit({
      organizationId: input.organizationId,
      actorUserId: input.actor.userId,
      actorName: input.actor.name,
      action: "game.ended",
      entityType: "game",
      entityId: game.id,
      after: { status: "awaiting_review" },
    });

    return loadGameState({ gameId: game.id, organizationId: input.organizationId });
  });
}

export function submitResult(input: {
  organizationId: string;
  gameId: string;
  actor: { userId: string; name: string };
}): GameState {
  return transaction(() => {
    const game = getGameRow(input.gameId, input.organizationId);
    if (isFinalized(game.status)) throw new AppError("conflict", "This result is already approved.");

    const boxScore = (() => {
      const adapter = getSportAdapter("basketball");
      const events = toNormalized(loadGameEvents(game.id));
      return adapter.boxScore(events, { homeTeamId: game.home_team_id, awayTeamId: game.away_team_id });
    })();

    const ruleset = parseRulesetJson(
      one<{ ruleset_json: string }>("SELECT ruleset_json FROM tournaments WHERE id = ?", [game.tournament_id])
        ?.ruleset_json,
    );

    if (boxScore.score.home === boxScore.score.away && !ruleset.allowDraws) {
      throw invalid("Scores are tied. Basketball games must have a winner before submission.");
    }

    const now = nowIso();
    run("UPDATE game_results SET status = 'superseded' WHERE game_id = ? AND status = 'submitted'", [game.id]);

    const resultId = newId("res");
    run(
      `INSERT INTO game_results (id, organization_id, tournament_id, game_id, home_score, away_score, status, submitted_by, submitted_at, final_event_seq, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?)`,
      [
        resultId,
        game.organization_id,
        game.tournament_id,
        game.id,
        boxScore.score.home,
        boxScore.score.away,
        input.actor.userId,
        now,
        game.last_event_seq,
        now,
      ],
    );

    if (game.status !== "awaiting_review") {
      assertTransition(game.status, "awaiting_review");
      run("UPDATE games SET status = 'awaiting_review', updated_at = ? WHERE id = ?", [now, game.id]);
    }

    recordAudit({
      organizationId: input.organizationId,
      actorUserId: input.actor.userId,
      actorName: input.actor.name,
      action: "result.submitted",
      entityType: "game_result",
      entityId: resultId,
      after: { homeScore: boxScore.score.home, awayScore: boxScore.score.away },
    });

    return loadGameState({ gameId: game.id, organizationId: input.organizationId });
  });
}

export function approveResult(input: {
  organizationId: string;
  gameId: string;
  actor: { userId: string; name: string };
}): GameState {
  return transaction(() => {
    const game = getGameRow(input.gameId, input.organizationId);
    const result = one<ResultDbRow>(
      "SELECT * FROM game_results WHERE game_id = ? AND status = 'submitted' ORDER BY created_at DESC LIMIT 1",
      [game.id],
    );
    if (!result) throw new AppError("conflict", "There is no submitted result to approve.");

    if (result.final_event_seq !== game.last_event_seq) {
      throw new AppError(
        "conflict",
        "Events were recorded after this result was submitted. Submit the result again before approving.",
      );
    }

    const now = nowIso();
    run("UPDATE game_results SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?", [
      input.actor.userId,
      now,
      result.id,
    ]);
    run("UPDATE games SET status = 'final', updated_at = ? WHERE id = ?", [now, game.id]);

    const winnerTeamId =
      result.home_score === result.away_score
        ? null
        : result.home_score > result.away_score
          ? game.home_team_id
          : game.away_team_id;

    if (winnerTeamId && game.stage !== "group") {
      advanceBracket(game, winnerTeamId);
    }

    enqueueSyncOperation({
      organizationId: game.organization_id,
      entityType: "game_result",
      entityId: result.id,
      payload: {
        resultId: result.id,
        organizationId: game.organization_id,
        tournamentId: game.tournament_id,
        gameId: game.id,
        homeScore: result.home_score,
        awayScore: result.away_score,
        submittedBy: result.submitted_by,
        submittedAt: result.submitted_at,
        approvedBy: input.actor.userId,
        approvedAt: now,
      },
      idempotencyKey: `game_result:${result.id}`,
    });

    recordAudit({
      organizationId: input.organizationId,
      actorUserId: input.actor.userId,
      actorName: input.actor.name,
      action: "result.approved",
      entityType: "game_result",
      entityId: result.id,
      after: { homeScore: result.home_score, awayScore: result.away_score, winnerTeamId },
    });

    return loadGameState({ gameId: game.id, organizationId: input.organizationId });
  });
}

export function rejectResult(input: {
  organizationId: string;
  gameId: string;
  reason: string;
  actor: { userId: string; name: string };
}): GameState {
  if (!input.reason.trim()) throw invalid("A reason is required to reject a result.");
  return transaction(() => {
    const game = getGameRow(input.gameId, input.organizationId);
    const result = one<ResultDbRow>(
      "SELECT * FROM game_results WHERE game_id = ? AND status = 'submitted' ORDER BY created_at DESC LIMIT 1",
      [game.id],
    );
    if (!result) throw new AppError("conflict", "There is no submitted result to reject.");

    const now = nowIso();
    run("UPDATE game_results SET status = 'rejected', rejection_reason = ?, approved_by = ?, approved_at = ? WHERE id = ?", [
      input.reason.trim(),
      input.actor.userId,
      now,
      result.id,
    ]);
    // Send the game back to the scorer for correction.
    run("UPDATE games SET status = 'paused', updated_at = ? WHERE id = ?", [now, game.id]);

    recordAudit({
      organizationId: input.organizationId,
      actorUserId: input.actor.userId,
      actorName: input.actor.name,
      action: "result.rejected",
      entityType: "game_result",
      entityId: result.id,
      reason: input.reason.trim(),
    });

    return loadGameState({ gameId: game.id, organizationId: input.organizationId });
  });
}

/**
 * Post-finalization correction. The previous result is preserved as
 * `superseded`; the new one records who corrected it and why.
 */
export function correctFinalResult(input: {
  organizationId: string;
  gameId: string;
  homeScore: number;
  awayScore: number;
  reason: string;
  actor: { userId: string; name: string };
}): GameState {
  if (!input.reason.trim()) throw invalid("A reason is required to correct a final result.");
  if (input.homeScore === input.awayScore) throw invalid("A corrected result cannot be a tie.");

  return transaction(() => {
    const game = getGameRow(input.gameId, input.organizationId);
    if (game.status !== "final") throw new AppError("conflict", "Only a final game can be corrected here.");

    const previous = one<ResultDbRow>(
      "SELECT * FROM game_results WHERE game_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT 1",
      [game.id],
    );
    if (!previous) throw notFound("Approved result");

    const now = nowIso();
    run("UPDATE game_results SET status = 'superseded' WHERE game_id = ? AND status = 'approved'", [game.id]);

    const resultId = newId("res");
    run(
      `INSERT INTO game_results (id, organization_id, tournament_id, game_id, home_score, away_score, status, submitted_by, submitted_at, approved_by, approved_at, corrected_from_id, final_event_seq, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?)`,
      [
        resultId,
        game.organization_id,
        game.tournament_id,
        game.id,
        input.homeScore,
        input.awayScore,
        input.actor.userId,
        now,
        input.actor.userId,
        now,
        previous.id,
        game.last_event_seq,
        now,
      ],
    );
    run("UPDATE games SET status = 'corrected', updated_at = ? WHERE id = ?", [now, game.id]);

    const winnerTeamId =
      input.homeScore > input.awayScore ? game.home_team_id : game.away_team_id;
    if (game.stage !== "group") advanceBracket(game, winnerTeamId);

    recordAudit({
      organizationId: input.organizationId,
      actorUserId: input.actor.userId,
      actorName: input.actor.name,
      action: "result.corrected",
      entityType: "game_result",
      entityId: resultId,
      before: { homeScore: previous.home_score, awayScore: previous.away_score, resultId: previous.id },
      after: { homeScore: input.homeScore, awayScore: input.awayScore },
      reason: input.reason.trim(),
    });

    return loadGameState({ gameId: game.id, organizationId: input.organizationId });
  });
}

// ---------------------------------------------------------------------------
// Bracket progression
// ---------------------------------------------------------------------------

export function advanceBracket(game: GameRow, winnerTeamId: string): void {
  const db = getDb();
  const now = nowIso();

  db.prepare(
    `INSERT INTO bracket_advancements (id, organization_id, tournament_id, division_id, round_number, slot, source_game_id, winner_team_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (division_id, round_number, slot)
     DO UPDATE SET winner_team_id = excluded.winner_team_id, source_game_id = excluded.source_game_id`,
  ).run(
    newId("brk"),
    game.organization_id,
    game.tournament_id,
    game.division_id,
    game.round_number,
    game.bracket_slot ?? 0,
    game.id,
    winnerTeamId,
    now,
  );

  sweepBracket(game.organization_id, game.division_id);
}

/**
 * Creates any next-round game whose two feeders are both decided. Called after
 * a result is approved and after a schedule is generated (to place byes).
 */
export function sweepBracket(organizationId: string, divisionId: string): number {
  const db = getDb();
  const maxRound =
    one<{ n: number | null }>("SELECT MAX(round_number) AS n FROM tournament_rounds WHERE division_id = ?", [
      divisionId,
    ])?.n ?? 0;
  if (maxRound < 2) return 0;

  const tournament = one<{ format: string; ruleset_json: string; id: string }>(
    `SELECT t.format, t.ruleset_json, t.id FROM tournaments t
       JOIN divisions d ON d.tournament_id = t.id WHERE d.id = ?`,
    [divisionId],
  );
  if (!tournament || tournament.format !== "single_elimination") return 0;

  const ruleset = parseRulesetJson(tournament.ruleset_json);
  const advancements = all<{ round_number: number; slot: number; winner_team_id: string | null }>(
    "SELECT round_number, slot, winner_team_id FROM bracket_advancements WHERE division_id = ?",
    [divisionId],
  );
  const decided = new Map(advancements.map((row) => [`${row.round_number}:${row.slot}`, row.winner_team_id]));

  const existing = new Set(
    all<{ round_number: number; bracket_slot: number | null }>(
      "SELECT round_number, bracket_slot FROM games WHERE division_id = ? AND bracket_slot IS NOT NULL",
      [divisionId],
    ).map((row) => `${row.round_number}:${row.bracket_slot}`),
  );

  const slotsPerRound = new Map<number, number>();
  for (const row of advancements) {
    slotsPerRound.set(row.round_number, Math.max(slotsPerRound.get(row.round_number) ?? 0, row.slot));
  }

  let created = 0;
  for (let round = 1; round < maxRound; round += 1) {
    const slotCount = Math.ceil((slotsPerRound.get(round) ?? 0) / 2);
    for (let nextSlot = 1; nextSlot <= slotCount; nextSlot += 1) {
      const key = `${round + 1}:${nextSlot}`;
      if (existing.has(key)) continue;

      const home = decided.get(`${round}:${nextSlot * 2 - 1}`);
      const away = decided.get(`${round}:${nextSlot * 2}`);
      if (!home || !away) continue;

      const stage = nextSlot === 1 && round + 1 === maxRound ? "final" : `r${round + 1}`;
      const gameId = newId("gam");
      const now = nowIso();
      db.prepare(
        `INSERT INTO games (id, organization_id, tournament_id, division_id, home_team_id, away_team_id, venue_id,
                            scheduled_at, status, stage, round_number, bracket_slot, period_count, period_seconds, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 'scheduled', ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        gameId,
        organizationId,
        tournament.id,
        divisionId,
        home,
        away,
        stage,
        round + 1,
        nextSlot,
        ruleset.periodCount,
        ruleset.periodSeconds,
        now,
        now,
      );
      db.prepare(
        `INSERT OR IGNORE INTO game_clock_states (game_id, period, remaining_ms, running, anchor_at, version, updated_at)
         VALUES (?, 1, ?, 0, ?, 1, ?)`,
      ).run(gameId, ruleset.periodSeconds * 1000, now, now);

      existing.add(key);
      created += 1;
    }
  }

  return created;
}

export function countStartedGames(organizationId: string, tournamentId: string): number {
  return (
    one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM games WHERE organization_id = ? AND tournament_id = ? AND last_event_seq > 0",
      [organizationId, tournamentId],
    )?.n ?? 0
  );
}
