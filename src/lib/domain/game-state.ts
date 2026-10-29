import { AppError } from "./errors";

export const GAME_STATUSES = [
  "scheduled",
  "ready",
  "live",
  "paused",
  "halftime",
  "period_ended",
  "awaiting_review",
  "final",
  "corrected",
] as const;

export type GameStatus = (typeof GAME_STATUSES)[number];

const TRANSITIONS: Record<GameStatus, GameStatus[]> = {
  scheduled: ["ready", "live"],
  ready: ["live", "scheduled"],
  live: ["paused", "halftime", "period_ended", "awaiting_review"],
  paused: ["live", "halftime", "period_ended", "awaiting_review"],
  halftime: ["live", "paused", "period_ended", "awaiting_review"],
  period_ended: ["live", "paused", "halftime", "awaiting_review"],
  awaiting_review: ["final", "live", "paused", "period_ended"],
  final: ["corrected"],
  corrected: [],
};

export function assertTransition(from: GameStatus, to: GameStatus): void {
  if (from === to) return;
  if (!TRANSITIONS[from].includes(to)) {
    throw new AppError("conflict", `A game cannot move from ${from} to ${to}.`);
  }
}

/**
 * States in which a scorer may record an event. `scheduled` and `ready` are
 * included because the first recorded action is what starts a game; anything
 * after the final horn must go through the review workflow.
 */
export function isScoringOpen(status: GameStatus): boolean {
  return (
    status === "scheduled" ||
    status === "ready" ||
    status === "live" ||
    status === "paused" ||
    status === "halftime" ||
    status === "period_ended"
  );
}

export function isFinalized(status: GameStatus): boolean {
  return status === "final" || status === "corrected";
}

export function isLiveLike(status: GameStatus): boolean {
  return status === "live" || status === "paused" || status === "halftime" || status === "period_ended";
}

export const GAME_STATUS_LABELS: Record<GameStatus, string> = {
  scheduled: "Scheduled",
  ready: "Ready",
  live: "Live",
  paused: "Paused",
  halftime: "Halftime",
  period_ended: "Period ended",
  awaiting_review: "Awaiting review",
  final: "Final",
  corrected: "Corrected",
};
