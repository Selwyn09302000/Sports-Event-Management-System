import type { BoxScore } from "@/lib/domain/sports/types";

function pct(made: number, attempted: number): string {
  if (attempted === 0) return "—";
  return `${Math.round((made / attempted) * 100)}%`;
}

export function BoxScoreTable({
  boxScore,
  teamId,
  teamName,
  players,
  showPrivate = false,
}: {
  boxScore: BoxScore;
  teamId: string;
  teamName: string;
  players: { playerId: string; fullName: string; jerseyNumber: number }[];
  showPrivate?: boolean;
}) {
  const lines = boxScore.players.filter((line) => line.teamId === teamId);
  const byPlayer = new Map(lines.map((line) => [line.playerId, line]));
  const rows = players
    .map((player) => ({ player, line: byPlayer.get(player.playerId) }))
    .sort((a, b) => a.player.jerseyNumber - b.player.jerseyNumber);

  const totals = lines.reduce(
    (acc, line) => ({
      points: acc.points + line.points,
      fgm2: acc.fgm2 + line.fgm2,
      fga2: acc.fga2 + line.fga2,
      fgm3: acc.fgm3 + line.fgm3,
      fga3: acc.fga3 + line.fga3,
      ftm: acc.ftm + line.ftm,
      fta: acc.fta + line.fta,
      rebounds: acc.rebounds + line.rebounds,
      assists: acc.assists + line.assists,
      steals: acc.steals + line.steals,
      blocks: acc.blocks + line.blocks,
      turnovers: acc.turnovers + line.turnovers,
      fouls: acc.fouls + line.fouls,
    }),
    {
      points: 0,
      fgm2: 0,
      fga2: 0,
      fgm3: 0,
      fga3: 0,
      ftm: 0,
      fta: 0,
      rebounds: 0,
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      fouls: 0,
    },
  );

  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <caption className="sr-only">{teamName} box score</caption>
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col" className="text-right">PTS</th>
            <th scope="col" className="text-right">2PT</th>
            <th scope="col" className="text-right">3PT</th>
            <th scope="col" className="text-right">FT</th>
            <th scope="col" className="text-right">REB</th>
            <th scope="col" className="text-right">AST</th>
            <th scope="col" className="text-right">STL</th>
            <th scope="col" className="text-right">BLK</th>
            <th scope="col" className="text-right">TO</th>
            <th scope="col" className="text-right">PF</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={11} className="py-4 text-center text-sm text-slate-500">
                No players recorded for this team.
              </td>
            </tr>
          ) : (
            rows.map(({ player, line }) => (
              <tr key={player.playerId}>
                <td className="whitespace-nowrap">
                  <span className="mr-2 font-mono text-xs text-slate-500">{player.jerseyNumber}</span>
                  {player.fullName}
                  {showPrivate && line ? null : null}
                </td>
                <td className="text-right font-mono font-bold">{line?.points ?? 0}</td>
                <td className="text-right font-mono text-xs">
                  {line ? `${line.fgm2}/${line.fga2}` : "0/0"}
                  <span className="ml-1 text-slate-400">{line ? pct(line.fgm2, line.fga2) : ""}</span>
                </td>
                <td className="text-right font-mono text-xs">
                  {line ? `${line.fgm3}/${line.fga3}` : "0/0"}
                  <span className="ml-1 text-slate-400">{line ? pct(line.fgm3, line.fga3) : ""}</span>
                </td>
                <td className="text-right font-mono text-xs">
                  {line ? `${line.ftm}/${line.fta}` : "0/0"}
                  <span className="ml-1 text-slate-400">{line ? pct(line.ftm, line.fta) : ""}</span>
                </td>
                <td className="text-right font-mono">{(line?.offensiveRebounds ?? 0) + (line?.defensiveRebounds ?? 0)}</td>
                <td className="text-right font-mono">{line?.assists ?? 0}</td>
                <td className="text-right font-mono">{line?.steals ?? 0}</td>
                <td className="text-right font-mono">{line?.blocks ?? 0}</td>
                <td className="text-right font-mono">{line?.turnovers ?? 0}</td>
                <td className="text-right font-mono">{line?.fouls ?? 0}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="bg-slate-50 font-semibold">
            <td>Team totals</td>
            <td className="text-right font-mono">{totals.points}</td>
            <td className="text-right font-mono text-xs">{`${totals.fgm2}/${totals.fga2}`}</td>
            <td className="text-right font-mono text-xs">{`${totals.fgm3}/${totals.fga3}`}</td>
            <td className="text-right font-mono text-xs">{`${totals.ftm}/${totals.fta}`}</td>
            <td className="text-right font-mono">{totals.rebounds}</td>
            <td className="text-right font-mono">{totals.assists}</td>
            <td className="text-right font-mono">{totals.steals}</td>
            <td className="text-right font-mono">{totals.blocks}</td>
            <td className="text-right font-mono">{totals.turnovers}</td>
            <td className="text-right font-mono">{totals.fouls}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
