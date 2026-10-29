import { DEFAULT_RULESET, type Ruleset } from "./ruleset";

export type ResultInput = {
  gameId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
};

export type StandingRow = {
  teamId: string;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  leaguePoints: number;
  winPct: number;
  rank: number;
};

/**
 * Standings are always derived from approved results — never stored as a
 * separate editable number.
 */
export function computeStandings(
  teamIds: string[],
  results: ResultInput[],
  ruleset: Ruleset = DEFAULT_RULESET,
): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  for (const teamId of teamIds) {
    rows.set(teamId, {
      teamId,
      played: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDiff: 0,
      leaguePoints: 0,
      winPct: 0,
      rank: 0,
    });
  }

  for (const result of results) {
    const home = rows.get(result.homeTeamId);
    const away = rows.get(result.awayTeamId);
    if (!home || !away) continue;

    home.played += 1;
    away.played += 1;
    home.pointsFor += result.homeScore;
    home.pointsAgainst += result.awayScore;
    away.pointsFor += result.awayScore;
    away.pointsAgainst += result.homeScore;

    if (result.homeScore === result.awayScore) {
      // Ties should not exist in a sport that forbids them (the submit step
      // rejects them), but if one is recorded it must never award a phantom win.
      home.draws += 1;
      away.draws += 1;
      home.leaguePoints += ruleset.standingPoints.loss;
      away.leaguePoints += ruleset.standingPoints.loss;
    } else if (result.homeScore > result.awayScore) {
      home.wins += 1;
      away.losses += 1;
      home.leaguePoints += ruleset.standingPoints.win;
      away.leaguePoints += ruleset.standingPoints.loss;
    } else {
      away.wins += 1;
      home.losses += 1;
      away.leaguePoints += ruleset.standingPoints.win;
      home.leaguePoints += ruleset.standingPoints.loss;
    }
  }

  for (const row of rows.values()) {
    row.pointDiff = row.pointsFor - row.pointsAgainst;
    row.winPct = row.played === 0 ? 0 : row.wins / row.played;
  }

  const sorted = [...rows.values()].sort((a, b) => {
    if (b.winPct !== a.winPct) return b.winPct - a.winPct;
    if (b.leaguePoints !== a.leaguePoints) return b.leaguePoints - a.leaguePoints;
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    return a.teamId.localeCompare(b.teamId);
  });

  return sorted.map((row, index) => ({ ...row, rank: index + 1 }));
}
