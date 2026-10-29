import { describe, expect, it } from "vitest";
import { basketballAdapter, validateBasketballEvent } from "@/lib/domain/sports/basketball";
import type { NormalizedEvent, ValidationContext } from "@/lib/domain/sports/types";

const HOME = "team-home";
const AWAY = "team-away";

function event(overrides: Partial<NormalizedEvent> & Pick<NormalizedEvent, "eventType">): NormalizedEvent {
  return {
    id: `e-${Math.random().toString(36).slice(2)}`,
    seq: 1,
    teamId: HOME,
    playerId: "p1",
    period: 1,
    clockSecondsRemaining: 600,
    occurredAt: new Date().toISOString(),
    payload: {},
    voided: false,
    ...overrides,
  };
}

const teams = { homeTeamId: HOME, awayTeamId: AWAY };

describe("basketball box score", () => {
  it("adds points only for made shots", () => {
    const box = basketballAdapter.boxScore(
      [
        event({ eventType: "two_point_made" }),
        event({ eventType: "three_point_made" }),
        event({ eventType: "free_throw_made" }),
        event({ eventType: "two_point_missed" }),
        event({ eventType: "three_point_missed" }),
        event({ eventType: "free_throw_missed" }),
      ],
      teams,
    );

    expect(box.score.home).toBe(6);
    expect(box.score.away).toBe(0);

    const line = box.players[0];
    expect(line.points).toBe(6);
    expect(line.fgm2).toBe(1);
    expect(line.fga2).toBe(2);
    expect(line.fgm3).toBe(1);
    expect(line.fga3).toBe(2);
    expect(line.ftm).toBe(1);
    expect(line.fta).toBe(2);
  });

  it("separates offensive and defensive rebounds while keeping a total", () => {
    const box = basketballAdapter.boxScore(
      [event({ eventType: "offensive_rebound" }), event({ eventType: "defensive_rebound" })],
      teams,
    );
    const line = box.players[0];
    expect(line.offensiveRebounds).toBe(1);
    expect(line.defensiveRebounds).toBe(1);
    expect(line.rebounds).toBe(2);
  });

  it("attributes fouls to the player, the period and the team", () => {
    const box = basketballAdapter.boxScore(
      [
        event({ eventType: "personal_foul", period: 1 }),
        event({ eventType: "personal_foul", period: 1 }),
        event({ eventType: "personal_foul", period: 2 }),
      ],
      teams,
    );

    const line = box.players[0];
    expect(line.fouls).toBe(3);
    expect(line.foulsByPeriod[1]).toBe(2);
    expect(line.foulsByPeriod[2]).toBe(1);

    const homeTeam = box.teams.find((team) => team.teamId === HOME)!;
    expect(homeTeam.fouls).toBe(3);
    expect(homeTeam.foulsByPeriod[1]).toBe(2);
  });

  it("counts team timeouts", () => {
    const box = basketballAdapter.boxScore(
      [event({ eventType: "timeout", playerId: null }), event({ eventType: "timeout", playerId: null })],
      teams,
    );
    expect(box.teams.find((team) => team.teamId === HOME)?.timeoutsUsed).toBe(2);
    expect(box.players).toHaveLength(0);
  });

  it("excludes voided events from every total", () => {
    const box = basketballAdapter.boxScore(
      [
        event({ eventType: "three_point_made" }),
        event({ eventType: "three_point_made", voided: true }),
      ],
      teams,
    );
    expect(box.score.home).toBe(3);
    const line = box.players[0];
    expect(line.fgm3).toBe(1);
    expect(line.fga3).toBe(1);
  });

  it("keeps the away team's points separate", () => {
    const box = basketballAdapter.boxScore(
      [event({ eventType: "two_point_made" }), event({ eventType: "three_point_made", teamId: AWAY, playerId: "p2" })],
      teams,
    );
    expect(box.score).toEqual({ home: 2, away: 3 });
    expect(box.players).toHaveLength(2);
  });

  it("records assists, steals, blocks and turnovers as individual events", () => {
    const box = basketballAdapter.boxScore(
      [
        event({ eventType: "assist" }),
        event({ eventType: "steal" }),
        event({ eventType: "block" }),
        event({ eventType: "turnover" }),
      ],
      teams,
    );
    const line = box.players[0];
    expect([line.assists, line.steals, line.blocks, line.turnovers]).toEqual([1, 1, 1, 1]);
    expect(line.points).toBe(0);
  });
});

function context(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    roster: new Map([
      ["p1", HOME],
      ["p2", HOME],
      ["p3", AWAY],
    ]),
    personalFoulsByPlayer: new Map(),
    timeoutsByTeam: new Map(),
    maxPersonalFouls: 5,
    maxTimeouts: 2,
    period: 1,
    ...overrides,
  };
}

describe("basketball event validation", () => {
  it("rejects an unknown event type", () => {
    expect(() => validateBasketballEvent({ eventType: "dunk_from_half_court" }, context())).toThrow(/unknown/i);
  });

  it("rejects a stat without a player", () => {
    expect(() => validateBasketballEvent({ eventType: "assist", teamId: HOME }, context())).toThrow(/requires a player/i);
  });

  it("rejects a player who is not on the game roster", () => {
    expect(() =>
      validateBasketballEvent({ eventType: "assist", teamId: HOME, playerId: "stranger" }, context()),
    ).toThrow(/not on an eligible roster/i);
  });

  it("rejects a player attributed to the wrong team", () => {
    expect(() =>
      validateBasketballEvent({ eventType: "assist", teamId: AWAY, playerId: "p1" }, context()),
    ).toThrow(/does not belong/i);
  });

  it("rejects a sixth personal foul", () => {
    expect(() =>
      validateBasketballEvent(
        { eventType: "personal_foul", teamId: HOME, playerId: "p1" },
        context({ personalFoulsByPlayer: new Map([["p1", 5]]) }),
      ),
    ).toThrow(/limit 5/i);
  });

  it("rejects a substitution that does not name both players", () => {
    expect(() =>
      validateBasketballEvent({ eventType: "substitution", teamId: HOME, payload: { playerInId: "p2" } }, context()),
    ).toThrow(/player coming in and going out/i);
  });

  it("rejects a substitution between different teams", () => {
    expect(() =>
      validateBasketballEvent(
        { eventType: "substitution", teamId: HOME, payload: { playerInId: "p3", playerOutId: "p1" } },
        context(),
      ),
    ).toThrow(/incoming player/i);
  });

  it("accepts a valid substitution", () => {
    expect(() =>
      validateBasketballEvent(
        { eventType: "substitution", teamId: HOME, payload: { playerInId: "p2", playerOutId: "p1" } },
        context(),
      ),
    ).not.toThrow();
  });

  it("rejects a timeout beyond the configured limit", () => {
    expect(() =>
      validateBasketballEvent(
        { eventType: "timeout", teamId: HOME },
        context({ timeoutsByTeam: new Map([[HOME, 2]]) }),
      ),
    ).toThrow(/timeouts/i);
  });
});
