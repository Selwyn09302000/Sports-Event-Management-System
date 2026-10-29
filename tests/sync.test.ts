import { beforeEach, describe, expect, it, vi } from "vitest";
import { getGameRow, getRosterForGame, recordEvent } from "@/lib/repos/games";
import { generateDivisionSchedule, listDivisionGames } from "@/lib/repos/schedule";
import { enqueueSyncOperation, syncSummary } from "@/lib/repos/sync";
import { runSync } from "@/lib/sync/runner";
import { one } from "@/lib/db/sql";
import { seedTournament, useMemoryDatabase } from "./helpers";

const transportState = vi.hoisted(() => ({ mode: "synchronized" as "synchronized" | "pending" | "conflicted" }));

vi.mock("@/lib/sync/transport", () => ({
  syncConfigured: () => true,
  getSyncTransport: () => ({
    name: "fake",
    enabled: true,
    push: async (items: { operationId: string }[]) =>
      items.map((item) => ({
        operationId: item.operationId,
        status: transportState.mode,
        error: transportState.mode === "synchronized" ? null : `simulated ${transportState.mode}`,
        confirmedAt: transportState.mode === "synchronized" ? new Date().toISOString() : null,
      })),
  }),
}));

beforeEach(() => {
  useMemoryDatabase();
  transportState.mode = "synchronized";
});

function setup() {
  const fixture = seedTournament({ teamCount: 2 });
  generateDivisionSchedule({
    organizationId: fixture.organizationId,
    tournamentId: fixture.tournamentId,
    divisionId: fixture.divisionId,
    startAt: null,
    actor: { userId: fixture.userId, name: "Test User" },
  });
  const game = listDivisionGames(fixture.organizationId, fixture.divisionId)[0];
  const roster = getRosterForGame(getGameRow(game.id, fixture.organizationId));
  const player = roster.find((entry) => entry.teamId === game.homeTeamId)!;
  return { fixture, game, player };
}

describe("sync outbox", () => {
  it("deduplicates operations by idempotency key", () => {
    const fixture = seedTournament({ teamCount: 2 });
    const payload = { eventId: "evt-1", gameId: "game-1" };

    enqueueSyncOperation({
      organizationId: fixture.organizationId,
      entityType: "game_event",
      entityId: "evt-1",
      payload,
      idempotencyKey: "game_event:evt-1",
    });
    enqueueSyncOperation({
      organizationId: fixture.organizationId,
      entityType: "game_event",
      entityId: "evt-1",
      payload,
      idempotencyKey: "game_event:evt-1",
    });

    expect(syncSummary(fixture.organizationId).pending).toBe(1);
  });

  it("queues one operation per recorded event", () => {
    const { fixture, game, player } = setup();
    recordEvent({
      organizationId: fixture.organizationId,
      gameId: game.id,
      event: { eventType: "two_point_made", teamId: game.homeTeamId, playerId: player.playerId },
      actor: { userId: fixture.userId, name: "Test User" },
    });

    const queued = one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sync_operations WHERE organization_id = ? AND entity_type = 'game_event'",
      [fixture.organizationId],
    );
    expect(queued?.n).toBe(1);
    expect(syncSummary(fixture.organizationId).pendingEvents).toBe(1);
  });

  it("marks events synchronized only when the transport confirms them", async () => {
    const { fixture, game, player } = setup();
    recordEvent({
      organizationId: fixture.organizationId,
      gameId: game.id,
      event: { eventType: "three_point_made", teamId: game.homeTeamId, playerId: player.playerId },
      actor: { userId: fixture.userId, name: "Test User" },
    });

    const result = await runSync(fixture.organizationId);

    expect(result.configured).toBe(true);
    expect(result.synchronized).toBe(1);
    expect(result.conflicted).toBe(0);

    const operation = one<{ status: string }>("SELECT status FROM sync_operations WHERE organization_id = ?", [
      fixture.organizationId,
    ]);
    expect(operation?.status).toBe("synchronized");

    const eventStatus = one<{ sync_status: string }>("SELECT sync_status FROM game_events WHERE game_id = ?", [
      game.id,
    ]);
    expect(eventStatus?.sync_status).toBe("synchronized");

    // A second run has nothing left to push.
    const second = await runSync(fixture.organizationId);
    expect(second.attempted).toBe(0);
  });

  it("leaves operations pending when the cloud does not confirm", async () => {
    const { fixture, game, player } = setup();
    recordEvent({
      organizationId: fixture.organizationId,
      gameId: game.id,
      event: { eventType: "two_point_made", teamId: game.homeTeamId, playerId: player.playerId },
      actor: { userId: fixture.userId, name: "Test User" },
    });

    transportState.mode = "pending";
    const result = await runSync(fixture.organizationId);

    expect(result.synchronized).toBe(0);
    expect(result.stillPending).toBe(1);

    const operation = one<{ status: string; attempts: number; last_error: string | null }>(
      "SELECT status, attempts, last_error FROM sync_operations WHERE organization_id = ?",
      [fixture.organizationId],
    );
    expect(operation?.status).toBe("pending");
    expect(operation?.attempts).toBe(1);
    expect(operation?.last_error).toContain("simulated pending");

    const eventStatus = one<{ sync_status: string }>("SELECT sync_status FROM game_events WHERE game_id = ?", [
      game.id,
    ]);
    expect(eventStatus?.sync_status).toBe("pending");
  });

  it("flags conflicts for human review instead of overwriting", async () => {
    const { fixture, game, player } = setup();
    recordEvent({
      organizationId: fixture.organizationId,
      gameId: game.id,
      event: { eventType: "two_point_made", teamId: game.homeTeamId, playerId: player.playerId },
      actor: { userId: fixture.userId, name: "Test User" },
    });

    transportState.mode = "conflicted";
    const result = await runSync(fixture.organizationId);

    expect(result.conflicted).toBe(1);
    const summary = syncSummary(fixture.organizationId);
    expect(summary.conflicted).toBe(1);
    expect(summary.pendingEvents).toBe(1);
  });
});
