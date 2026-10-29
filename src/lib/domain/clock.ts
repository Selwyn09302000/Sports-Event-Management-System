/**
 * Persisted game clock.
 *
 * The clock is never stored as a decrementing counter. We store the remaining
 * time at the moment of the last state change plus an anchor timestamp, and
 * derive the displayed value:
 *
 *   running: remaining = remaining_ms - (now - anchor_at)
 *   paused:  remaining = remaining_ms
 *
 * That makes reload/restart recovery exact, and means a backgrounded browser
 * tab cannot drift the official clock.
 */

export type ClockState = {
  gameId: string;
  period: number;
  remainingMs: number;
  running: boolean;
  /** ISO timestamp of the last state change. */
  anchorAt: string;
  version: number;
};

export type ClockSnapshot = {
  period: number;
  remainingMs: number;
  running: boolean;
  /** True when the derived remaining time has reached zero. */
  expired: boolean;
  anchorAt: string;
  serverNow: string;
  version: number;
};

export function deriveRemainingMs(state: ClockState, atMs: number): number {
  if (!state.running) return Math.max(0, state.remainingMs);
  const anchorMs = Date.parse(state.anchorAt);
  if (Number.isNaN(anchorMs)) return Math.max(0, state.remainingMs);
  const elapsed = Math.max(0, atMs - anchorMs);
  return Math.max(0, state.remainingMs - elapsed);
}

export function snapshotClock(state: ClockState, atMs = Date.now()): ClockSnapshot {
  const remainingMs = deriveRemainingMs(state, atMs);
  return {
    period: state.period,
    remainingMs,
    running: state.running && remainingMs > 0,
    expired: remainingMs === 0,
    anchorAt: state.anchorAt,
    serverNow: new Date(atMs).toISOString(),
    version: state.version,
  };
}

/** Remaining seconds rounded up, as shown on a scoreboard. */
export function displaySeconds(remainingMs: number): number {
  return Math.ceil(remainingMs / 1000);
}

export function formatClock(remainingMs: number): string {
  const safeMs = Math.max(0, remainingMs);
    const tenths = Math.ceil(safeMs / 100);
  if (tenths < 600) {
    // Under a minute, basketball scoreboards show tenths: 9.4, 0.2, 0.0.
    // (tenths reaching 600 means 59.9+ seconds, which shows as 1:00 below.)
    return `${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  const totalSeconds = Math.ceil(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export type ClockCommand =
  | { type: "start" }
  | { type: "pause" }
  | { type: "toggle" }
  | { type: "set"; remainingMs: number }
  | { type: "next_period"; periodSeconds: number }
  | { type: "reset_period"; periodSeconds: number };

export type ClockTransition = {
  remainingMs: number;
  running: boolean;
  period: number;
  /** Event type to append to the game event log, if any. */
  eventType: string | null;
};

/**
 * Pure clock command evaluation. Callers persist the returned state and append
 * the event in the same transaction, so the clock and the event log can never
 * disagree.
 */
export function applyClockCommand(
  state: ClockState,
  command: ClockCommand,
  atMs = Date.now(),
): ClockTransition {
  const derived = deriveRemainingMs(state, atMs);

  switch (command.type) {
    case "start":
      if (state.running) return { remainingMs: derived, running: true, period: state.period, eventType: null };
      if (derived === 0) {
        throw new Error("Cannot start a period clock that has reached zero.");
      }
      return { remainingMs: derived, running: true, period: state.period, eventType: "clock_started" };

    case "pause":
      return { remainingMs: derived, running: false, period: state.period, eventType: "clock_paused" };

    case "toggle":
      return applyClockCommand(state, { type: state.running ? "pause" : "start" }, atMs);

    case "set": {
      if (!Number.isFinite(command.remainingMs) || command.remainingMs < 0) {
        throw new Error("Clock time must be zero or greater.");
      }
      return {
        remainingMs: Math.round(command.remainingMs),
        running: state.running,
        period: state.period,
        eventType: "clock_adjusted",
      };
    }

    case "next_period":
      return {
        remainingMs: command.periodSeconds * 1000,
        running: false,
        period: state.period + 1,
        eventType: "period_started",
      };

    case "reset_period":
      // Resetting is destructive, so it also stops the clock: the operator
      // must explicitly restart it after confirming the new time.
      return {
        remainingMs: command.periodSeconds * 1000,
        running: false,
        period: state.period,
        eventType: "clock_reset",
      };
  }
}
