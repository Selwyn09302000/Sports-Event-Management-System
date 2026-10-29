import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addRosterAction,
  clearScheduleAction,
  createDivisionAction,
  createVenueAction,
  generateScheduleAction,
  registerTeamAction,
  setRosterLockAction,
  setTournamentStatusAction,
  updateRosterEntryAction,
  updateTournamentAction,
} from "@/app/actions/tournaments";
import { requireOrganization } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import {
  getTournament,
  listDivisions,
  listPlayers,
  listRoster,
  listTeams,
  listTournamentTeams,
  listVenues,
} from "@/lib/repos/tournaments";
import { listTournamentGames } from "@/lib/repos/schedule";
import { Badge, Card, EmptyState, Flash, SectionHeader, formatDateTime } from "@/components/ui";
import { GAME_STATUS_LABELS, type GameStatus } from "@/lib/domain/game-state";
import { AppError } from "@/lib/domain/errors";

export const dynamic = "force-dynamic";

export default async function TournamentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const session = await requireOrganization();
  const { id } = await params;
  const { error, notice } = await searchParams;

  let tournament;
  try {
    tournament = getTournament(session.organizationId, id);
  } catch (caught) {
    if (caught instanceof AppError && caught.code === "not_found") notFound();
    throw caught;
  }

  const divisions = listDivisions(session.organizationId, tournament.id);
  const teams = listTeams(session.organizationId);
  const players = listPlayers(session.organizationId);
  const registered = listTournamentTeams(session.organizationId, tournament.id);
  const venues = listVenues(session.organizationId, tournament.id);
  const games = listTournamentGames(session.organizationId, tournament.id);
  const roster = listRoster(session.organizationId, tournament.id);

  const canManage = hasPermission(session.roles, "tournament.manage");
  const canRoster = hasPermission(session.roles, "roster.manage");
  const returnTo = `/dashboard/tournaments/${tournament.id}`;

  return (
    <div className="space-y-6">
      <Flash error={error} notice={notice} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link className="text-xs font-semibold uppercase tracking-wide text-slate-500 hover:underline" href="/dashboard/tournaments">
            ← Tournaments
          </Link>
          <h1 className="mt-1 text-2xl font-black text-slate-900">{tournament.name}</h1>
          <p className="muted mt-1">
            {tournament.location ?? "Location TBD"} · {tournament.status} ·{" "}
            {tournament.format.replaceAll("_", " ")} · {tournament.ruleset.periodCount} ×{" "}
            {Math.round(tournament.ruleset.periodSeconds / 60)} min periods
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tournament.status === "published" ? "success" : "warning"}>{tournament.status}</Badge>
          {tournament.status === "published" ? (
            <Link className="btn-outline btn-sm" href={`/tournaments/${tournament.slug}`}>
              Public page
            </Link>
          ) : null}
          {canManage ? (
            <form action={setTournamentStatusAction}>
              <input type="hidden" name="tournamentId" value={tournament.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <input
                type="hidden"
                name="status"
                value={tournament.status === "published" ? "draft" : "published"}
              />
              <button className={tournament.status === "published" ? "btn-outline btn-sm" : "btn-accent btn-sm"}>
                {tournament.status === "published" ? "Unpublish" : "Publish tournament"}
              </button>
            </form>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Settings ------------------------------------------------------- */}
        <Card className="lg:col-span-1">
          <h2 className="section-title mb-3">Settings</h2>
          {canManage ? (
            <form action={updateTournamentAction} className="space-y-3">
              <input type="hidden" name="tournamentId" value={tournament.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <div>
                <label className="label" htmlFor="t-name">
                  Name
                </label>
                <input id="t-name" name="name" className="input" defaultValue={tournament.name} required />
              </div>
              <div>
                <label className="label" htmlFor="t-location">
                  Location
                </label>
                <input id="t-location" name="location" className="input" defaultValue={tournament.location ?? ""} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="t-start">
                    Starts
                  </label>
                  <input id="t-start" name="startsOn" type="date" className="input" defaultValue={tournament.startsOn ?? ""} />
                </div>
                <div>
                  <label className="label" htmlFor="t-end">
                    Ends
                  </label>
                  <input id="t-end" name="endsOn" type="date" className="input" defaultValue={tournament.endsOn ?? ""} />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="t-format">
                  Format
                </label>
                <select id="t-format" name="format" className="input" defaultValue={tournament.format}>
                  <option value="round_robin">Single round robin</option>
                  <option value="double_round_robin">Double round robin</option>
                  <option value="single_elimination">Single elimination</option>
                </select>
                <p className="mt-1 text-xs text-slate-500">Changing the format does not rewrite an existing schedule.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="t-minutes">
                    Period minutes
                  </label>
                  <input
                    id="t-minutes"
                    name="periodMinutes"
                    type="number"
                    min={1}
                    max={30}
                    className="input"
                    defaultValue={Math.round(tournament.ruleset.periodSeconds / 60)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="t-periods">
                    Periods
                  </label>
                  <input
                    id="t-periods"
                    name="periodCount"
                    type="number"
                    min={1}
                    max={8}
                    className="input"
                    defaultValue={tournament.ruleset.periodCount}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="t-fouls">
                    Foul limit
                  </label>
                  <input
                    id="t-fouls"
                    name="maxPersonalFouls"
                    type="number"
                    min={1}
                    max={10}
                    className="input"
                    defaultValue={tournament.ruleset.maxPersonalFouls}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="t-timeouts">
                    Timeouts
                  </label>
                  <input
                    id="t-timeouts"
                    name="maxTimeouts"
                    type="number"
                    min={0}
                    max={12}
                    className="input"
                    defaultValue={tournament.ruleset.maxTimeouts}
                  />
                </div>
              </div>
              <button className="btn-primary w-full">Save settings</button>
            </form>
          ) : (
            <p className="muted">You do not have permission to change tournament settings.</p>
          )}
        </Card>

        {/* Divisions & venues --------------------------------------------- */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <SectionHeader title="Divisions" description="Groups and age brackets. Every team registers into a division." />
            {divisions.length === 0 ? (
              <EmptyState title="No divisions yet" description="Add at least one division before publishing." />
            ) : (
              <ul className="mb-4 divide-y divide-slate-200">
                {divisions.map((division) => {
                  const divisionalTeams = registered.filter((team) => team.divisionId === division.id);
                  return (
                    <li key={division.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div>
                        <p className="font-semibold">{division.name}</p>
                        <p className="text-xs text-slate-500">
                          {division.ageGroup ?? "Open age"} · {divisionalTeams.length} team(s)
                        </p>
                      </div>
                      <span className="text-xs text-slate-500">
                        {games.filter((game) => game.divisionId === division.id).length} game(s)
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {canManage ? (
              <form action={createDivisionAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="tournamentId" value={tournament.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <div className="min-w-40 flex-1">
                  <label className="label" htmlFor="div-name">
                    Division name
                  </label>
                  <input id="div-name" name="name" className="input" placeholder="Men's Open" required />
                </div>
                <div className="min-w-32 flex-1">
                  <label className="label" htmlFor="div-age">
                    Age group
                  </label>
                  <input id="div-age" name="ageGroup" className="input" placeholder="18+" />
                </div>
                <button className="btn-outline">Add division</button>
              </form>
            ) : null}
          </Card>

          <Card>
            <SectionHeader title="Venues" description="Used by the schedule generator and conflict detection." />
            {venues.length === 0 ? (
              <p className="muted mb-3">No venues yet. You can still schedule games without one.</p>
            ) : (
              <ul className="mb-3 flex flex-wrap gap-2">
                {venues.map((venue) => (
                  <li key={venue.id} className="rounded-full bg-slate-100 px-3 py-1 text-sm">
                    {venue.name}
                  </li>
                ))}
              </ul>
            )}
            {canManage ? (
              <form action={createVenueAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="tournamentId" value={tournament.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <div className="min-w-40 flex-1">
                  <label className="label" htmlFor="venue-name">
                    Venue name
                  </label>
                  <input id="venue-name" name="name" className="input" placeholder="Court 1" required />
                </div>
                <div className="min-w-40 flex-1">
                  <label className="label" htmlFor="venue-address">
                    Address
                  </label>
                  <input id="venue-address" name="address" className="input" />
                </div>
                <button className="btn-outline">Add venue</button>
              </form>
            ) : null}
          </Card>
        </div>
      </div>

      {/* Teams & rosters ------------------------------------------------- */}
      <section>
        <SectionHeader
          title="Teams, rosters and schedule"
          description="Register teams into a division, add players, then generate the schedule."
          action={
            <form action={setRosterLockAction} className="flex items-center gap-2">
              <input type="hidden" name="tournamentId" value={tournament.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="locked" value={tournament.rosterLocked ? "0" : "1"} />
              <Badge tone={tournament.rosterLocked ? "warning" : "success"}>
                {tournament.rosterLocked ? "Roster locked" : "Roster open"}
              </Badge>
              {canManage ? (
                <button className="btn-outline btn-sm">{tournament.rosterLocked ? "Unlock roster" : "Lock roster"}</button>
              ) : null}
            </form>
          }
        />

        {divisions.length === 0 ? (
          <EmptyState title="Add a division first" description="Teams register into a division." />
        ) : (
          <div className="space-y-4">
            {divisions.map((division) => {
              const divisionTeams = registered.filter((team) => team.divisionId === division.id);
              const divisionGames = games.filter((game) => game.divisionId === division.id);
              const unregisteredTeams = teams.filter(
                (team) => !registered.some((entry) => entry.teamId === team.id),
              );

              return (
                <Card key={division.id}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-bold">{division.name}</h3>
                    <div className="flex gap-2 text-xs text-slate-500">
                      <span>{divisionTeams.length} teams</span>
                      <span>·</span>
                      <span>{divisionGames.length} games</span>
                    </div>
                  </div>

                  {divisionTeams.length === 0 ? (
                    <p className="muted mb-3">No teams registered in this division.</p>
                  ) : (
                    <div className="mb-4 space-y-3">
                      {divisionTeams.map((team) => {
                        const teamRoster = roster.filter((entry) => entry.teamId === team.teamId);
                        const availablePlayers = players.filter(
                          (player) => !roster.some((entry) => entry.playerId === player.id),
                        );
                        return (
                          <details key={team.teamId} className="rounded-lg border border-slate-200">
                            <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-semibold">
                              <span>
                                {team.teamName}
                                {team.seed ? <span className="ml-2 text-xs text-slate-500">seed {team.seed}</span> : null}
                              </span>
                              <span className="text-xs font-normal text-slate-500">{teamRoster.length} players</span>
                            </summary>
                            <div className="border-t border-slate-200 px-3 py-3">
                              {teamRoster.length === 0 ? (
                                <p className="muted mb-2">No players on the roster yet.</p>
                              ) : (
                                <table className="table-base mb-3">
                                  <thead>
                                    <tr>
                                      <th>#</th>
                                      <th>Player</th>
                                      <th>Status</th>
                                      <th />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {teamRoster.map((entry) => (
                                      <tr key={entry.id}>
                                        <td className="font-mono">{entry.jerseyNumber}</td>
                                        <td>{entry.playerName}</td>
                                        <td>
                                          <Badge tone={entry.eligible ? "success" : "warning"}>
                                            {entry.eligible ? "eligible" : entry.status}
                                          </Badge>
                                        </td>
                                        <td className="text-right">
                                          {canRoster && !tournament.rosterLocked ? (
                                            <form action={updateRosterEntryAction} className="flex items-center justify-end gap-1">
                                              <input type="hidden" name="tournamentId" value={tournament.id} />
                                              <input type="hidden" name="entryId" value={entry.id} />
                                              <input type="hidden" name="returnTo" value={returnTo} />
                                              <input type="hidden" name="eligible" value={entry.eligible ? "0" : "1"} />
                                              <button className="btn-outline btn-sm">
                                                {entry.eligible ? "Mark ineligible" : "Mark eligible"}
                                              </button>
                                            </form>
                                          ) : null}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}

                              {canRoster && !tournament.rosterLocked ? (
                                <form action={addRosterAction} className="flex flex-wrap items-end gap-2">
                                  <input type="hidden" name="tournamentId" value={tournament.id} />
                                  <input type="hidden" name="teamId" value={team.teamId} />
                                  <input type="hidden" name="returnTo" value={returnTo} />
                                  <div className="min-w-40 flex-1">
                                    <label className="label">Existing player</label>
                                    <select name="playerId" className="input" defaultValue="">
                                      <option value="">— or add new below —</option>
                                      {availablePlayers.map((player) => (
                                        <option key={player.id} value={player.id}>
                                          {player.fullName}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="min-w-36 flex-1">
                                    <label className="label">New player name</label>
                                    <input name="newPlayerName" className="input" placeholder="Juan Dela Cruz" />
                                  </div>
                                  <div className="w-20">
                                    <label className="label">Jersey</label>
                                    <input name="jerseyNumber" type="number" min={0} max={99} className="input" required />
                                  </div>
                                  <button className="btn-outline">Add</button>
                                </form>
                              ) : null}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  )}

                  {canRoster ? (
                    <form action={registerTeamAction} className="flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3">
                      <input type="hidden" name="tournamentId" value={tournament.id} />
                      <input type="hidden" name="divisionId" value={division.id} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <div className="min-w-40 flex-1">
                        <label className="label">Register team</label>
                        <select name="teamId" className="input" defaultValue="">
                          <option value="">— or create a new team —</option>
                          {unregisteredTeams.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="min-w-36 flex-1">
                        <label className="label">New team name</label>
                        <input name="newTeamName" className="input" placeholder="Team Falcons" />
                      </div>
                      <div className="w-20">
                        <label className="label">Seed</label>
                        <input name="seed" type="number" min={1} className="input" />
                      </div>
                      <button className="btn-outline">Register</button>
                    </form>
                  ) : null}

                  {canManage ? (
                    <div className="mt-4 border-t border-slate-200 pt-3">
                      {divisionGames.length === 0 ? (
                        <form action={generateScheduleAction} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="tournamentId" value={tournament.id} />
                          <input type="hidden" name="divisionId" value={division.id} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <div className="min-w-40 flex-1">
                            <label className="label">First game (optional)</label>
                            <input name="startAt" type="datetime-local" className="input" />
                          </div>
                          <div className="w-28">
                            <label className="label">Gap (min)</label>
                            <input name="intervalMinutes" type="number" min={15} step={5} defaultValue={90} className="input" />
                          </div>
                          <div className="min-w-36 flex-1">
                            <label className="label">Venue</label>
                            <select name="venueId" className="input" defaultValue="">
                              <option value="">No venue</option>
                              {venues.map((venue) => (
                                <option key={venue.id} value={venue.id}>
                                  {venue.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <button className="btn-accent">Generate schedule</button>
                        </form>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="muted">Schedule generated.</p>
                          <form action={clearScheduleAction}>
                            <input type="hidden" name="tournamentId" value={tournament.id} />
                            <input type="hidden" name="divisionId" value={division.id} />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <button className="btn-outline btn-sm">Clear unplayed schedule</button>
                          </form>
                        </div>
                      )}
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Games ----------------------------------------------------------- */}
      <section>
        <SectionHeader
          title="Games"
          description="Open the scorer console for a game. Officials use the review screen after the final horn."
          action={
            <div className="flex gap-2">
              <Link className="btn-outline btn-sm" href={`/tournaments/${tournament.slug}/schedule`}>
                Public schedule
              </Link>
              <Link className="btn-outline btn-sm" href={`/tournaments/${tournament.slug}/standings`}>
                Standings
              </Link>
            </div>
          }
        />

        {games.length === 0 ? (
          <EmptyState title="No games scheduled" description="Generate a schedule for a division above." />
        ) : (
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Round</th>
                  <th>Matchup</th>
                  <th>When</th>
                  <th>Score</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {games.map((game) => (
                  <tr key={game.id}>
                    <td className="text-xs text-slate-500">
                      {game.stage === "group" ? `R${game.roundNumber}` : game.stage}
                    </td>
                    <td>
                      <p className="font-semibold">
                        {game.homeTeamName} <span className="text-slate-400">vs</span> {game.awayTeamName}
                      </p>
                      <p className="text-xs text-slate-500">{game.divisionName}</p>
                    </td>
                    <td className="whitespace-nowrap text-xs text-slate-600">{formatDateTime(game.scheduledAt)}</td>
                    <td className="font-mono font-bold">
                      {game.homeScore}–{game.awayScore}
                    </td>
                    <td>
                      <Badge tone={game.status === "final" ? "success" : game.status === "live" ? "live" : "neutral"}>
                        {GAME_STATUS_LABELS[game.status as GameStatus] ?? game.status}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <div className="flex justify-end gap-1">
                        <Link className="btn-primary btn-sm" href={`/dashboard/games/${game.id}`}>
                          Score
                        </Link>
                        <Link className="btn-outline btn-sm" href={`/dashboard/games/${game.id}/review`}>
                          Review
                        </Link>
                        <Link className="btn-outline btn-sm" href={`/scoreboard/${game.id}`} target="_blank">
                          Board
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
