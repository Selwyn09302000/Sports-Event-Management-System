import { describe, expect, it } from "vitest";
import {
  applyClockCommand,
  deriveRemainingMs,
  displaySeconds,
  formatClock,
  snapshotClock,
  type ClockState,
} from "@/lib/domain/clock";

const START = Date.parse("2026-11-14T09:00:00.000Z");

function state(overrides: Partial<ClockState> = {}): ClockState {
  return {
    gameId: "game-1",
    period: 1,
    remainingMs: 600_000,
    running: false,
    anchorAt: new Date(START).toISOString(),
    version: 1,
    ...overrides,
  };
}

describe("persisted clock derivation", () => {
  it("keeps remaining time frozen while paused", () => {
    expect(deriveRemainingMs(state(), START + 60_000)).toBe(600_000);
  });

  it("derives remaining time from the anchor while running", () => {
    const running = state({ running: true });
    expect(deriveRemainingMs(running, START + 90_000)).toBe(510_000);
    expect(deriveRemainingMs(running, START + 600_000)).toBe(0);
  });

  it("never goes below zero", () => {
    expect(deriveRemainingMs(state({ running: true }), START + 10_000_000)).toBe(0);
  });

  it("survives a reload: the same stored state yields the same clock", () => {
    const stored = state({ running: true, remainingMs: 300_000, anchorAt: new Date(START).toISOString() });
    const atReload = START + 45_000;
    expect(deriveRemainingMs(stored, atReload)).toBe(255_000);
    // A second read must not consume time twice.
    expect(deriveRemainingMs(stored, atReload)).toBe(255_000);
  });

  it("reports expiry in the snapshot", () => {
    const snapshot = snapshotClock(state({ running: true }), START + 700_000);
    expect(snapshot.expired).toBe(true);
    expect(snapshot.running).toBe(false);
    expect(snapshot.remainingMs).toBe(0);
  });

  it("formats the scoreboard display", () => {
    expect(formatClock(600_000)).toBe("10:00");
    expect(formatClock(61_000)).toBe("1:01");
    expect(formatClock(9_400)).toBe("9.4");
    expect(formatClock(600)).toBe("0.6");
    expect(formatClock(0)).toBe("0.0");
    expect(displaySeconds(9_001)).toBe(10);
  });
});

describe("clock commands", () => {
  it("starts and pauses the clock without losing the derived time", () => {
    const started = applyClockCommand(state(), { type: "start" }, START);
    expect(started.running).toBe(true);
    expect(started.remainingMs).toBe(600_000);
    expect(started.eventType).toBe("clock_started");

    const paused = applyClockCommand(state({ running: true }), { type: "pause" }, START + 30_000);
    expect(paused.running).toBe(false);
    expect(paused.remainingMs).toBe(570_000);
  });

  it("refuses to start a clock that has already expired", () => {
    expect(() => applyClockCommand(state({ remainingMs: 0 }), { type: "start" }, START)).toThrow(/reached zero/i);
  });

  it("advances to the next period with a fresh clock", () => {
    const next = applyClockCommand(state({ period: 1, remainingMs: 0 }), { type: "next_period", periodSeconds: 600 }, START);
    expect(next.period).toBe(2);
    expect(next.remainingMs).toBe(600_000);
    expect(next.running).toBe(false);
    expect(next.eventType).toBe("period_started");
  });

  it("uses the configured overtime length for extra periods", () => {
    const overtime = applyClockCommand(state({ period: 4, remainingMs: 0 }), { type: "next_period", periodSeconds: 300 }, START);
    expect(overtime.period).toBe(5);
    expect(overtime.remainingMs).toBe(300_000);
  });

  it("resets the period clock and stops it for a deliberate restart", () => {
    const reset = applyClockCommand(state({ remainingMs: 12_000, running: true }), { type: "reset_period", periodSeconds: 600 }, START);
    expect(reset.remainingMs).toBe(600_000);
    expect(reset.running).toBe(false);
    expect(reset.eventType).toBe("clock_reset");
  });

  it("rejects a negative manual adjustment", () => {
    expect(() => applyClockCommand(state(), { type: "set", remainingMs: -1 }, START)).toThrow(/zero or greater/i);
  });
});
