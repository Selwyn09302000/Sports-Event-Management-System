import Link from "next/link";
import { Badge, Card, EmptyState, formatDate } from "@/components/ui";
import { listPublicOrganizations } from "@/lib/repos/orgs";
import { listPublishedTournaments } from "@/lib/repos/tournaments";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const organizations = listPublicOrganizations();
  const tournaments = listPublishedTournaments();
  const session = await getSession();

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-slate-950 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-orange-600 text-sm font-black">C</span>
            <span className="text-sm font-black uppercase tracking-[0.25em]">CourtSide</span>
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            <Link className="text-slate-300 hover:text-white" href="/login">
              Scorer sign in
            </Link>
            <Link className="rounded-lg bg-orange-600 px-3 py-1.5 font-semibold hover:bg-orange-500" href="/register">
              Register organization
            </Link>
          </nav>
        </div>

        <div className="mx-auto max-w-6xl px-4 pb-14 pt-10">
          <h1 className="max-w-3xl text-4xl font-black leading-tight sm:text-5xl">
            Tournament control that keeps running when the gym has no internet.
          </h1>
          <p className="mt-4 max-w-2xl text-slate-300">
            Live basketball scoring, player statistics, projector scoreboard and schedules — operated entirely on the
            tournament laptop, published online when connectivity returns.
          </p>
          {session ? (
            <Link className="btn-accent mt-6" href="/dashboard">
              Open dashboard
            </Link>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-10">
        <section>
          <h2 className="text-xl font-black text-slate-900">Published tournaments</h2>
          {tournaments.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="No tournament has been published yet"
                description="Organizers publish a tournament from the dashboard once the schedule is ready."
              />
            </div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tournaments.map((tournament) => (
                <Link
                  key={tournament.id}
                  href={`/tournaments/${tournament.slug}`}
                  className="card-pad transition hover:border-orange-300 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-slate-900">{tournament.name}</h3>
                    <Badge tone="success">published</Badge>
                  </div>
                  <p className="muted mt-1">{tournament.location ?? "Location TBD"}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {formatDate(tournament.startsOn)} – {formatDate(tournament.endsOn)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-xl font-black text-slate-900">Organizations</h2>
          {organizations.length === 0 ? (
            <p className="muted mt-2">Organizations appear here once they publish a tournament.</p>
          ) : (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {organizations.map((organization) => (
                <li key={organization.id}>
                  <Link href={`/organizations/${organization.slug}`} className="card-pad block hover:border-orange-300">
                    <p className="font-bold">{organization.name}</p>
                    <p className="muted mt-1">{organization.location ?? "—"}</p>
                    <p className="mt-2 text-xs text-slate-500">{organization.tournamentCount} published tournament(s)</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Card>
          <h2 className="section-title">Installing this on the tournament laptop</h2>
          <p className="muted mt-1">
            The scoring laptop runs the server. The projector and officials&apos; phones connect to the same local
            network. See <code className="rounded bg-slate-100 px-1">docs/WINDOWS_HOTSPOT.md</code> for the Windows 11
            setup.
          </p>
        </Card>
      </main>
    </div>
  );
}
