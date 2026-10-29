/**
 * Schedule generation. Pure functions: the repository layer persists the
 * result, so every algorithm here is directly testable.
 */
import { invalid } from "./errors";

export type ScheduledPairing = {
  round: number;
  slot: number;
  homeTeamId: string;
  awayTeamId: string;
};

/**
 * Circle method round robin.
 *
 * For `n` teams the result always contains exactly n(n-1)/2 games (single
 * round). Odd counts are padded with a bye and the bye pairing is dropped.
 */
export function roundRobinSchedule(teamIds: string[], options: { doubleRound?: boolean } = {}): ScheduledPairing[] {
  const unique = dedupe(teamIds);
  if (unique.length < 2) throw invalid("A round robin needs at least two teams.");

  const single = buildSingleRoundRobin(unique);
  if (!options.doubleRound) return single;

  const roundsInSingle = Math.max(...single.map((game) => game.round));
  const secondLeg = single.map((game) => ({
    round: game.round + roundsInSingle,
    slot: game.slot,
    // Swap home/away for the second leg so each team hosts once.
    homeTeamId: game.awayTeamId,
    awayTeamId: game.homeTeamId,
  }));
  return [...single, ...secondLeg];
}

function buildSingleRoundRobin(teamIds: string[]): ScheduledPairing[] {
  const entries: (string | null)[] = [...teamIds];
  if (entries.length % 2 === 1) entries.push(null);

  const totalRounds = entries.length - 1;
  const half = entries.length / 2;
  const games: ScheduledPairing[] = [];

  let rotation = [...entries];
  for (let round = 0; round < totalRounds; round += 1) {
    let slot = 0;
    for (let index = 0; index < half; index += 1) {
      const left = rotation[index];
      const right = rotation[rotation.length - 1 - index];
      if (left === null || right === null) continue;

      const flip = (round + index) % 2 === 1;
      games.push({
        round: round + 1,
        slot: slot + 1,
        homeTeamId: flip ? right : left,
        awayTeamId: flip ? left : right,
      });
      slot += 1;
    }
    // Fix the first entry and rotate the rest.
    rotation = [rotation[0], rotation[rotation.length - 1], ...rotation.slice(1, -1)];
  }

  return games;
}

export type BracketParticipant =
  | { kind: "seed"; seed: number }
  | { kind: "winner_of"; round: number; slot: number };

export type BracketMatch = {
  round: number;
  slot: number;
  home: BracketParticipant;
  away: BracketParticipant;
  /** True when one side is a seed that does not exist (auto-advance). */
  bye: boolean;
  /** Set for byes: the team that advances without playing. */
  autoAdvanceSeed?: number;
};

export type BracketPlan = {
  size: number;
  byes: number;
  rounds: number;
  matches: BracketMatch[];
  /** Round-one matches that must actually be played. */
  playable: { round: number; slot: number; homeSeed: number; awaySeed: number }[];
};

/** Standard bracket seed order, e.g. size 8 => [1,8,4,5,2,7,3,6]. */
export function bracketSeedOrder(size: number): number[] {
  if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0) {
    throw invalid("Bracket size must be a power of two.");
  }
  let order = [1, 2];
  let rounds = Math.log2(size);
  for (let round = 1; round < rounds; round += 1) {
    const sum = 2 ** (round + 1) + 1;
    const next: number[] = [];
    for (const seed of order) {
      next.push(seed, sum - seed);
    }
    order = next;
  }
  return order;
}

/**
 * Single elimination with automatic byes.
 *
 * Teams are seeded in the order given. `size` is the next power of two; the
 * top seeds receive the byes, which is the standard convention.
 */
export function singleEliminationBracket(teamIds: string[]): BracketPlan {
  const unique = dedupe(teamIds);
  if (unique.length < 2) throw invalid("A single-elimination bracket needs at least two teams.");

  const count = unique.length;
  const size = nextPowerOfTwo(count);
  const byes = size - count;
  const rounds = Math.log2(size);
  const order = bracketSeedOrder(size);

  const matches: BracketMatch[] = [];
  const playable: BracketPlan["playable"] = [];

  for (let slot = 1; slot <= size / 2; slot += 1) {
    const homeSeed = order[(slot - 1) * 2];
    const awaySeed = order[(slot - 1) * 2 + 1];
    const homeExists = homeSeed <= count;
    const awayExists = awaySeed <= count;

    const match: BracketMatch = {
      round: 1,
      slot,
      home: { kind: "seed", seed: homeSeed },
      away: { kind: "seed", seed: awaySeed },
      bye: !homeExists || !awayExists,
    };

    if (match.bye) {
      const advancing = homeExists ? homeSeed : awaySeed;
      match.autoAdvanceSeed = advancing;
    } else {
      playable.push({ round: 1, slot, homeSeed, awaySeed });
    }

    matches.push(match);
  }

  for (let round = 2; round <= rounds; round += 1) {
    const slots = size / 2 ** round;
    for (let slot = 1; slot <= slots; slot += 1) {
      matches.push({
        round,
        slot,
        home: { kind: "winner_of", round: round - 1, slot: slot * 2 - 1 },
        away: { kind: "winner_of", round: round - 1, slot: slot * 2 },
        bye: false,
      });
    }
  }

  return { size, byes, rounds, matches, playable };
}

/** Number of games actually played in a single-elimination bracket. */
export function singleEliminationGameCount(teamCount: number): number {
  if (teamCount < 2) return 0;
  return teamCount - 1;
}

export function nextPowerOfTwo(value: number): number {
  if (value < 1) return 1;
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

/** Round-robin game count, exposed for the schedule review screen. */
export function roundRobinGameCount(teamCount: number, doubleRound = false): number {
  if (teamCount < 2) return 0;
  const single = (teamCount * (teamCount - 1)) / 2;
  return doubleRound ? single * 2 : single;
}

export type ConflictInput = {
  id?: string;
  homeTeamId: string;
  awayTeamId: string;
  scheduledAt: string | null;
  venueId: string | null;
};

export type ScheduleConflict = {
  kind: "team_double_booked" | "venue_double_booked" | "duplicate_matchup";
  message: string;
  gameId?: string;
};

/**
 * Detects conflicts against already-scheduled games. A team cannot be in two
 * places at once and a venue cannot host two concurrent games.
 */
export function detectConflicts(
  candidate: ConflictInput,
  existing: ConflictInput[],
  windowMinutes = 90,
): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];
  const candidateStart = candidate.scheduledAt ? Date.parse(candidate.scheduledAt) : null;

  for (const other of existing) {
    if (candidate.id && other.id === candidate.id) continue;

    const sameMatchup =
      (candidate.homeTeamId === other.homeTeamId && candidate.awayTeamId === other.awayTeamId) ||
      (candidate.homeTeamId === other.awayTeamId && candidate.awayTeamId === other.homeTeamId);
    if (sameMatchup) {
      conflicts.push({
        kind: "duplicate_matchup",
        message: "These two teams are already scheduled to play each other.",
        gameId: other.id,
      });
    }

    if (candidateStart === null || !other.scheduledAt) continue;
    const otherStart = Date.parse(other.scheduledAt);
    if (Number.isNaN(otherStart)) continue;
    const minutesApart = Math.abs(candidateStart - otherStart) / 60000;
    if (minutesApart >= windowMinutes) continue;

    const sharesTeam =
      candidate.homeTeamId === other.homeTeamId ||
      candidate.homeTeamId === other.awayTeamId ||
      candidate.awayTeamId === other.homeTeamId ||
      candidate.awayTeamId === other.awayTeamId;
    if (sharesTeam) {
      conflicts.push({
        kind: "team_double_booked",
        message: "A team is already scheduled within 90 minutes of this slot.",
        gameId: other.id,
      });
    }

    if (candidate.venueId && candidate.venueId === other.venueId) {
      conflicts.push({
        kind: "venue_double_booked",
        message: "The venue is already booked within 90 minutes of this slot.",
        gameId: other.id,
      });
    }
  }

  return conflicts;
}

function dedupe(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}
