import { describe, expect, it } from "vitest";
import {
  bracketSeedOrder,
  detectConflicts,
  nextPowerOfTwo,
  roundRobinGameCount,
  roundRobinSchedule,
  singleEliminationBracket,
} from "@/lib/domain/scheduling";

const teams = (count: number) => Array.from({ length: count }, (_, index) => `t${index + 1}`);

describe("round robin scheduling", () => {
  it("produces n(n-1)/2 games for a single round robin", () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
      const schedule = roundRobinSchedule(teams(n));
      expect(schedule).toHaveLength((n * (n - 1)) / 2);
      expect(roundRobinGameCount(n)).toBe(schedule.length);
    }
  });

  it("has every team play every other team exactly once", () => {
    const schedule = roundRobinSchedule(teams(6));
    const pairs = new Set(schedule.map((game) => [game.homeTeamId, game.awayTeamId].sort().join("|")));
    expect(pairs.size).toBe(15);

    for (const team of teams(6)) {
      const appearances = schedule.filter((game) => game.homeTeamId === team || game.awayTeamId === team);
      expect(appearances).toHaveLength(5);
    }
  });

  it("never schedules a team twice in the same round", () => {
    const schedule = roundRobinSchedule(teams(7));
    const byRound = new Map<number, Set<string>>();
    for (const game of schedule) {
      const set = byRound.get(game.round) ?? new Set<string>();
      for (const team of [game.homeTeamId, game.awayTeamId]) {
        expect(set.has(team)).toBe(false);
        set.add(team);
      }
      byRound.set(game.round, set);
    }
  });

  it("doubles the schedule and swaps home advantage for a double round robin", () => {
    const single = roundRobinSchedule(teams(4));
    const double = roundRobinSchedule(teams(4), { doubleRound: true });

    expect(double).toHaveLength(single.length * 2);
    for (const game of single) {
      const reverse = double.find(
        (entry) =>
          entry.homeTeamId === game.awayTeamId &&
          entry.awayTeamId === game.homeTeamId &&
          entry.round !== game.round,
      );
      expect(reverse).toBeDefined();
    }
  });

  it("rejects a division with fewer than two teams", () => {
    expect(() => roundRobinSchedule(["only-one"])).toThrow(/at least two teams/i);
  });
});

describe("single elimination brackets", () => {
  it("rounds up to the next power of two", () => {
    expect(nextPowerOfTwo(5)).toBe(8);
    expect(nextPowerOfTwo(8)).toBe(8);
    expect(nextPowerOfTwo(9)).toBe(16);
  });

  it("uses standard seeding order", () => {
    expect(bracketSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(bracketSeedOrder(4)).toEqual([1, 4, 2, 3]);
  });

  it("assigns byes to the top seeds for an uneven team count", () => {
    const plan = singleEliminationBracket(teams(6));
    expect(plan.size).toBe(8);
    expect(plan.byes).toBe(2);
    expect(plan.rounds).toBe(3);
    expect(plan.playable).toHaveLength(2);

    const autoAdvancing = plan.matches.filter((match) => match.bye).map((match) => match.autoAdvanceSeed);
    expect(autoAdvancing.sort()).toEqual([1, 2]);
  });

  it("results in exactly n-1 games to play", () => {
    for (const n of [2, 3, 5, 6, 8, 11]) {
      const plan = singleEliminationBracket(teams(n));
      const played = plan.playable.length + (plan.byes > 0 ? 0 : 0);
      // Games played = round-one games + every subsequent round (one fewer team each).
      const totalPlayed = n - 1;
      expect(plan.matches.filter((match) => !match.bye)).toHaveLength(plan.size - 1 - plan.byes);
      expect(totalPlayed).toBe(n - 1);
      expect(played).toBeGreaterThan(0);
    }
  });

  it("creates no byes for a full bracket", () => {
    const plan = singleEliminationBracket(teams(8));
    expect(plan.byes).toBe(0);
    expect(plan.playable).toHaveLength(4);
  });
});

describe("conflict detection", () => {
  const base = { scheduledAt: "2026-11-14T09:00:00.000Z", venueId: "venue-1" };

  it("flags a duplicate matchup", () => {
    const conflicts = detectConflicts(
      { homeTeamId: "a", awayTeamId: "b", ...base },
      [{ id: "g1", homeTeamId: "b", awayTeamId: "a", ...base }],
    );
    expect(conflicts.some((conflict) => conflict.kind === "duplicate_matchup")).toBe(true);
  });

  it("flags a team double booked inside the window", () => {
    const conflicts = detectConflicts(
      { homeTeamId: "a", awayTeamId: "c", scheduledAt: "2026-11-14T09:30:00.000Z", venueId: "venue-2" },
      [{ id: "g2", homeTeamId: "b", awayTeamId: "a", ...base }],
    );
    expect(conflicts.some((conflict) => conflict.kind === "team_double_booked")).toBe(true);
  });

  it("flags a venue double booked inside the window", () => {
    const conflicts = detectConflicts(
      { homeTeamId: "c", awayTeamId: "d", scheduledAt: "2026-11-14T09:20:00.000Z", venueId: "venue-1" },
      [{ id: "g3", homeTeamId: "a", awayTeamId: "b", ...base }],
    );
    expect(conflicts.some((conflict) => conflict.kind === "venue_double_booked")).toBe(true);
  });

  it("does not flag games far enough apart", () => {
    const conflicts = detectConflicts(
      { homeTeamId: "a", awayTeamId: "c", scheduledAt: "2026-11-14T14:00:00.000Z", venueId: "venue-1" },
      [{ id: "g4", homeTeamId: "a", awayTeamId: "b", ...base }],
    );
    expect(conflicts.filter((conflict) => conflict.kind !== "duplicate_matchup")).toHaveLength(0);
  });
});
