import { describe, expect, it } from "vitest";
import { computeStandings } from "@/lib/domain/standings";
import { DEFAULT_RULESET } from "@/lib/domain/ruleset";
import { assertTransition, isFinalized, isScoringOpen } from "@/lib/domain/game-state";

describe("standings", () => {
  it("awards league points for wins and losses", () => {
    const rows = computeStandings(
      ["a", "b", "c"],
      [
        { gameId: "1", homeTeamId: "a", awayTeamId: "b", homeScore: 80, awayScore: 70 },
        { gameId: "2", homeTeamId: "b", awayTeamId: "c", homeScore: 65, awayScore: 60 },
      ],
      DEFAULT_RULESET,
    );

    expect(rows[0].teamId).toBe("a");
    expect(rows[0].wins).toBe(1);
    expect(rows[0].leaguePoints).toBe(2);

    const c = rows.find((row) => row.teamId === "c")!;
    expect(c.losses).toBe(1);
    expect(c.leaguePoints).toBe(1);
  });

  it("breaks ties on point difference then points scored", () => {
    const rows = computeStandings(
      ["a", "b", "c"],
      [
        { gameId: "1", homeTeamId: "a", awayTeamId: "c", homeScore: 90, awayScore: 60 },
        { gameId: "2", homeTeamId: "b", awayTeamId: "c", homeScore: 70, awayScore: 60 },
      ],
      DEFAULT_RULESET,
    );
    expect(rows[0].teamId).toBe("a");
    expect(rows[0].pointDiff).toBe(30);
    expect(rows[1].teamId).toBe("b");
    expect(rows[1].pointDiff).toBe(10);
  });

  it("never awards a win for a tied game", () => {
    const rows = computeStandings(
      ["a", "b"],
      [{ gameId: "1", homeTeamId: "a", awayTeamId: "b", homeScore: 50, awayScore: 50 }],
      DEFAULT_RULESET,
    );
    expect(rows.every((row) => row.wins === 0)).toBe(true);
    expect(rows.every((row) => row.draws === 1)).toBe(true);
  });

  it("ranks every registered team, including those with no games", () => {
    const rows = computeStandings(["a", "b", "c"], [], DEFAULT_RULESET);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3]);
  });
});

describe("game state machine", () => {
  it("allows the expected lifecycle", () => {
    expect(() => assertTransition("scheduled", "live")).not.toThrow();
    expect(() => assertTransition("live", "paused")).not.toThrow();
    expect(() => assertTransition("paused", "live")).not.toThrow();
    expect(() => assertTransition("live", "awaiting_review")).not.toThrow();
    expect(() => assertTransition("awaiting_review", "final")).not.toThrow();
    expect(() => assertTransition("final", "corrected")).not.toThrow();
  });

  it("rejects skipping approval", () => {
    expect(() => assertTransition("live", "final")).toThrow(/cannot move/i);
    expect(() => assertTransition("final", "live")).toThrow(/cannot move/i);
  });

  it("keeps scoring open through live phases but closed after review", () => {
    expect(isScoringOpen("scheduled")).toBe(true);
    expect(isScoringOpen("live")).toBe(true);
    expect(isScoringOpen("period_ended")).toBe(true);
    expect(isScoringOpen("awaiting_review")).toBe(false);
    expect(isScoringOpen("final")).toBe(false);

    expect(isFinalized("final")).toBe(true);
    expect(isFinalized("corrected")).toBe(true);
    expect(isFinalized("live")).toBe(false);
  });
});
