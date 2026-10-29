import { beforeEach, describe, expect, it } from "vitest";
import { seedTournament, useMemoryDatabase } from "./helpers";
import { all, one, run } from "@/lib/db/sql";
import {
  approveResult,
  correctEvent,
  getGameRow,
  getRosterForGame,
  loadGameState,
  recordEvent,
  submitResult,
  voidEvent,
} from "@/lib/repos/games";
import { clearDivisionSchedule, generateDivisionSchedule, listDivisionGames } from "@/lib/repos/schedule";
import { getDivisionStandings } from "@/lib/repos/standings";

const actor = (fixture: { userId: string }) => ({ userId: fixture.userId, name: "Test User" });

beforeEach(() => {
  useMemoryDatabase();
});

describe("tenant isolation", () => {
  it("refuses to read another organization's game", () => {
    const a = seedTournament({ teamCount: 4 });
    const b = seedTournament({ teamCount: 4 });

    generateDivisionSchedule({
      organizationId: a.organizationId,
      tournamentId: a.tournamentId,
      divisionId: a.divisionId,
      startAt: null,
      actor: actor(a),
    });

    const games = listDivisionGames(a.organizationId, a.divisionId);
    expect(games).toHaveLength(6);

    expect(() => getGameRow(games[0].id, b.organizationId)).toThrow(/not found/i);
    expect(() => loadGameState({ gameId: games[0].id, organizationId: b.organizationId })).toThrow(/not found/i);
  });

  it("keeps standings scoped to the owning organization", () => {
    const a = seedTournament({ teamCount: 3 });
    const b = seedTournament({ teamCount: 3 });
    expect(() => getDivisionStandings(b.organizationId, a.divisionId)).toThrow(/not found/i);
  });
});

describe("event recording", () => {
  function setup() {
    const fixture = seedTournament({ teamCount: 4, playersPerTeam: 5 });
    generateDivisionSchedule({
      organizationId: fixture.organizationId,
      tournamentId: fixture.tournamentId,
      divisionId: fixture.divisionId,
      startAt: null,
      actor: actor(fixture),
    });
    const game = listDivisionGames(fixture.organizationId, fixture.divisionId)[0];
    const roster = getRosterForGame(getGameRow(game.id, fixture.organizationId));
    const homePlayer = roster.find((player) => player.teamId === game.homeTeamId)!;
    const homeTeamMate = roster.find(
      (player) => player.teamId === game.homeTeamId && player.playerId !== homePlayer.playerId,
    )!;
    return { fixture, game, homePlayer, homeTeamMate };
  }

  it("is idempotent for a repeated client action id", () => {
    const { fixture, game, homePlayer } = setup();

    const first = recordEvent({
      organizationId: fixture.organizationId,
      gameId: game.id,
      event: { eventType: "two_point_made", teamId: game.homeTeamId, playerId: homePlayer.playerId },
      clientActionId: "action-1",
      actor: actor(fixture),
    });

    const second = recordEvent({
      organizationId: fixture.organizationId,
      gameId: game.id,
      event: { eventType: "two_point_made", teamId: game.homeTeamId, playerId: homePlayer.playerId },
      clientActionId: "action-1",
      actor: actor(fixture),
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.eventId).toBe(first.eventId);

    const events = all<{ id: string }>("SELECT id FROM game_events WHERE game_id = ?", [game.id]);
    expect(events).toHaveLength(1);
    expect(second.state.game.homeScore).toBe(2);
  });

  it("does not score a missed shot but records the attempt", () => {
    const { fixture, game, homePlayer } = setup();
    const result = recordEvent({
      organizationId: fixture.organizationId,
      gameId: game.id,
      event: { eventType: "three_point_missed", teamId: game.homeTeamId, playerId: homePlayer.playerId },
      actor: actor(fixture),
    });

    expect(result.state.game.homeScore).toBe(0);
    const line = result.state.boxScore.players.find((entry) => entry.playerId === homePlayer.playerId)!;
    expect(line.fga3).toBe(1);
    expect(line.points).toBe(0);
  });

  it("keeps the clock snapshot on every event", () => {
    const { fixture, game, homePlayer } = setup();
    const result = recordEvent({
      organizationId: fixture.organizationId,
      gameId: game.id,
      event: { eventType: "two_point_made", teamId: game.homeTeamId, playerId: homePlayer.playerId },
      actor: actor(fixture),
    });

    expect(result.state.events[0].clockSecondsRemaining).toBe(600);
    expect(result.state.events[0].period).toBe(1);
  });

  it("rejects scoring for a player outside the roster", () => {
    const { fixture, game } = setup();
    expect(() =>
      recordEvent({
        organizationId: fixture.organizationId,
        gameId: game.id,
        event: { eventType: "assist", teamId: game.homeTeamId, playerId: "intruder" },
        actor: actor(fixture),
      }),
    ).toThrow(/eligible roster/i);
  });

  it("rejects a sixth personal foul", () => {
    const { fixture, game, homePlayer } = setup();
    for (let index = 0; index < 5; index += 1) {
      recordEvent({
        organizationId: fixture.organizationId,
        gameId: game.id,
        event: { eventType: "personal_foul", teamId: game.homeTeamId, playerId: homePlayer.playerId },
        actor: actor(fixture),
      });
    }

    expect(() =>
      recordEvent({
        organizationId: fixture.organizationId,
        gameId: game.id,
        event: { eventType: "personal_foul", teamId: game.homeTeamId, playerId: homePlayer.playerId },
        actor: actor(fixture),
      }),
    ).toThrow(/limit 5/i);
  });
});

describe("corrections", () => {
  function setup() {
    const fixture = seedTournament({ teamCount: 4, playersPerTeam: 5 });
    generateDivisionSchedule({
      organizationId: fixture.organizationId,
      tournamentId: fixture.tournamentId,
      divisionId: fixture.divisionId,
      startAt: null,
      actor: actor(fixture),
    });
    const game = listDivisionGames(fixture.organizationId, fixture.divisionId)[0];
    const roster = getRosterForGame(getGameRow(game.id, fixture.organizationId));
    const homePlayers = roster.filter((player) => player.teamId === game.homeTeamId);
    return { fixture, game, first: homePlayers[0], second: homePlayers[1] };
  }

  it("voids an event, preserves it, and writes an audit entry", () => {
    const { fixture, game, first } = setup();
    const recorded = recordEvent({
      organizationId: fixture.organizationId,
      gameId: game.id,
      event: { eventType: "three_point_made", teamId: game.homeTeamId, playerId: first.playerId },
      actor: actor(fixture),
    });
    expect(recorded.state.game.homeScore).toBe(3);

    const voided = voidEvent({
      organizationId: fixture.organizationId,
      gameId: game.id,
      eventId: recorded.eventId,
      reason: "Wrong team credited",
      actor: actor(fixture),
    });

    expect(voided.game.homeScore).toBe(0);
    const row = one<{ voided_at: string | null; void_reason: string | null }>(
      "SELECT voided_at, void_reason FROM game_events WHERE id = ?",
      [recorded.eventId],
    );
    expect(row?.voided_at).not.toBeNull();
    expect(row?.void_reason).toBe("Wrong team credited");

    const audit = one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'game.event_voided' AND entity_id = ?",
      [recorded.eventId],
    );
    expect(audit?.n).toBe(1);
  });

  it("moves statistics to the corrected player and keeps history", () => {
    const { fixture, game, first, second } = setup();
    const recorded = recordEvent({
      organizationId: fixture.organizationId,
      gameId: game.id,
      event: { eventType: "two_point_made", teamId: game.homeTeamId, playerId: first.playerId },
      actor: actor(fixture),
    });

    const corrected = correctEvent({
      organizationId: fixture.organizationId,
      gameId: game.id,
      eventId: recorded.eventId,
      replacement: { playerId: second.playerId, teamId: game.homeTeamId },
      reason: "Scorekeeper picked the wrong number",
      actor: actor(fixture),
    });

    expect(corrected.game.homeScore).toBe(2);
    const firstLine = corrected.boxScore.players.find((line) => line.playerId === first.playerId);
    const secondLine = corrected.boxScore.players.find((line) => line.playerId === second.playerId);
    expect(firstLine?.points ?? 0).toBe(0);
    expect(secondLine?.points).toBe(2);

    const events = all<{ voided_at: string | null; corrects_event_id: string | null }>(
      "SELECT voided_at, corrects_event_id FROM game_events WHERE game_id = ? ORDER BY seq",
      [game.id],
    );
    expect(events).toHaveLength(2);
    expect(events[0].voided_at).not.toBeNull();
    expect(events[1].corrects_event_id).toBe(recorded.eventId);
  });
});

describe("schedule generation", () => {
  it("creates a single round robin and refuses to duplicate it", () => {
    const fixture = seedTournament({ teamCount: 5 });
    const result = generateDivisionSchedule({
      organizationId: fixture.organizationId,
      tournamentId: fixture.tournamentId,
      divisionId: fixture.divisionId,
      startAt: null,
      actor: actor(fixture),
    });

    expect(result.created).toBe(10);
    expect(listDivisionGames(fixture.organizationId, fixture.divisionId)).toHaveLength(10);

    expect(() =>
      generateDivisionSchedule({
        organizationId: fixture.organizationId,
        tournamentId: fixture.tournamentId,
        divisionId: fixture.divisionId,
        startAt: null,
        actor: actor(fixture),
      }),
    ).toThrow(/already has a schedule/i);
  });

  it("clears only an unplayed schedule", () => {
    const fixture = seedTournament({ teamCount: 4 });
    generateDivisionSchedule({
      organizationId: fixture.organizationId,
      tournamentId: fixture.tournamentId,
      divisionId: fixture.divisionId,
      startAt: null,
      actor: actor(fixture),
    });

    const game = listDivisionGames(fixture.organizationId, fixture.divisionId)[0];
    const roster = getRosterForGame(getGameRow(game.id, fixture.organizationId));
    const player = roster.find((entry) => entry.teamId === game.homeTeamId)!;

    recordEvent({
      organizationId: fixture.organizationId,
      gameId: game.id,
      event: { eventType: "two_point_made", teamId: game.homeTeamId, playerId: player.playerId },
      actor: actor(fixture),
    });

    expect(() =>
      clearDivisionSchedule({
        organizationId: fixture.organizationId,
        divisionId: fixture.divisionId,
        actor: actor(fixture),
      }),
    ).toThrow(/already started/i);
  });
});

describe("finalization", () => {
  it("only counts approved results toward standings", () => {
    const fixture = seedTournament({ teamCount: 3 });
    generateDivisionSchedule({
      organizationId: fixture.organizationId,
      tournamentId: fixture.tournamentId,
      divisionId: fixture.divisionId,
      startAt: null,
      actor: actor(fixture),
    });

    const game = listDivisionGames(fixture.organizationId, fixture.divisionId)[0];
    const roster = getRosterForGame(getGameRow(game.id, fixture.organizationId));
    const scorerPlayer = roster.find((entry) => entry.teamId === game.homeTeamId)!;

    recordEvent({
      organizationId: fixture.organizationId,
      gameId: game.id,
      event: { eventType: "two_point_made", teamId: game.homeTeamId, playerId: scorerPlayer.playerId },
      actor: actor(fixture),
    });

    const before = getDivisionStandings(fixture.organizationId, fixture.divisionId);
    expect(before.rows.every((row) => row.played === 0)).toBe(true);

    const submitted = submitResult({
      organizationId: fixture.organizationId,
      gameId: game.id,
      actor: actor(fixture),
    });
    expect(submitted.game.status).toBe("awaiting_review");
    expect(submitted.result?.status).toBe("submitted");

    const approved = approveResult({
      organizationId: fixture.organizationId,
      gameId: game.id,
      actor: actor(fixture),
    });
    expect(approved.game.status).toBe("final");

    const after = getDivisionStandings(fixture.organizationId, fixture.divisionId);
    const winner = after.rows.find((row) => row.teamId === game.homeTeamId)!;
    expect(winner.wins).toBe(1);
    expect(winner.leaguePoints).toBe(2);
  });

  it("blocks submission of a tied game", () => {
    const fixture = seedTournament({ teamCount: 2 });
    generateDivisionSchedule({
      organizationId: fixture.organizationId,
      tournamentId: fixture.tournamentId,
      divisionId: fixture.divisionId,
      startAt: null,
      actor: actor(fixture),
    });
    const game = listDivisionGames(fixture.organizationId, fixture.divisionId)[0];

    expect(() =>
      submitResult({ organizationId: fixture.organizationId, gameId: game.id, actor: actor(fixture) }),
    ).toThrow(/tied/i);
  });

  it("refuses approval when the event log moved after submission", () => {
    const fixture = seedTournament({ teamCount: 2 });
    generateDivisionSchedule({
      organizationId: fixture.organizationId,
      tournamentId: fixture.tournamentId,
      divisionId: fixture.divisionId,
      startAt: null,
      actor: actor(fixture),
    });
    const game = listDivisionGames(fixture.organizationId, fixture.divisionId)[0];
    const roster = getRosterForGame(getGameRow(game.id, fixture.organizationId));
    const player = roster.find((entry) => entry.teamId === game.homeTeamId)!;

    recordEvent({
      organizationId: fixture.organizationId,
      gameId: game.id,
      event: { eventType: "two_point_made", teamId: game.homeTeamId, playerId: player.playerId },
      actor: actor(fixture),
    });
    submitResult({ organizationId: fixture.organizationId, gameId: game.id, actor: actor(fixture) });

    // The status gate already blocks new events while awaiting review, so this
    // simulates a concurrent write landing between submission and approval
    // (for example a second device's request that committed first).
    run("UPDATE games SET last_event_seq = last_event_seq + 1 WHERE id = ?", [game.id]);

    expect(() =>
      approveResult({ organizationId: fixture.organizationId, gameId: game.id, actor: actor(fixture) }),
    ).toThrow(/events were recorded after/i);
  });

  it("advances winners into the next bracket round", () => {
    const fixture = seedTournament({ teamCount: 4, format: "single_elimination" });
    generateDivisionSchedule({
      organizationId: fixture.organizationId,
      tournamentId: fixture.tournamentId,
      divisionId: fixture.divisionId,
      startAt: null,
      actor: actor(fixture),
    });

    const roundOne = listDivisionGames(fixture.organizationId, fixture.divisionId);
    expect(roundOne).toHaveLength(2);

    for (const game of roundOne) {
      const roster = getRosterForGame(getGameRow(game.id, fixture.organizationId));
      const player = roster.find((entry) => entry.teamId === game.homeTeamId)!;
      recordEvent({
        organizationId: fixture.organizationId,
        gameId: game.id,
        event: { eventType: "three_point_made", teamId: game.homeTeamId, playerId: player.playerId },
        actor: actor(fixture),
      });
      submitResult({ organizationId: fixture.organizationId, gameId: game.id, actor: actor(fixture) });
      approveResult({ organizationId: fixture.organizationId, gameId: game.id, actor: actor(fixture) });
    }

    const allGames = listDivisionGames(fixture.organizationId, fixture.divisionId);
    expect(allGames).toHaveLength(3);

    const final = allGames.find((game) => game.stage === "final");
    expect(final).toBeDefined();
    expect([roundOne[0].homeTeamId, roundOne[1].homeTeamId]).toContain(final!.homeTeamId);
    expect([roundOne[0].homeTeamId, roundOne[1].homeTeamId]).toContain(final!.awayTeamId);
  });

  it("refuses to record events on a finalized game", () => {
    const fixture = seedTournament({ teamCount: 2 });
    generateDivisionSchedule({
      organizationId: fixture.organizationId,
      tournamentId: fixture.tournamentId,
      divisionId: fixture.divisionId,
      startAt: null,
      actor: actor(fixture),
    });
    const game = listDivisionGames(fixture.organizationId, fixture.divisionId)[0];
    const roster = getRosterForGame(getGameRow(game.id, fixture.organizationId));
    const player = roster.find((entry) => entry.teamId === game.homeTeamId)!;

    recordEvent({
      organizationId: fixture.organizationId,
      gameId: game.id,
      event: { eventType: "two_point_made", teamId: game.homeTeamId, playerId: player.playerId },
      actor: actor(fixture),
    });
    submitResult({ organizationId: fixture.organizationId, gameId: game.id, actor: actor(fixture) });
    approveResult({ organizationId: fixture.organizationId, gameId: game.id, actor: actor(fixture) });

    expect(() =>
      recordEvent({
        organizationId: fixture.organizationId,
        gameId: game.id,
        event: { eventType: "two_point_made", teamId: game.homeTeamId, playerId: player.playerId },
        actor: actor(fixture),
      }),
    ).toThrow(/finalized/i);
  });
});
