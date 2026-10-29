import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicFooter, PublicHeader } from "@/components/public-header";
import { EmptyState, formatDate } from "@/components/ui";
import { getOrganizationBySlug } from "@/lib/repos/orgs";
import { listPublishedTournaments } from "@/lib/repos/tournaments";

export const dynamic = "force-dynamic";

export default async function OrganizationTournamentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const organization = getOrganizationBySlug(slug);
  if (!organization) notFound();

  const tournaments = listPublishedTournaments(slug);

  return (
    <div className="min-h-screen">
      <PublicHeader subtitle={`${organization.name} · tournaments`} />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-black">Tournaments</h1>
        {tournaments.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="Nothing published yet" />
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {tournaments.map((tournament) => (
              <li key={tournament.id} className="card-pad flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Link className="font-bold hover:underline" href={`/tournaments/${tournament.slug}`}>
                    {tournament.name}
                  </Link>
                  <p className="muted">
                    {tournament.location ?? "—"} · {formatDate(tournament.startsOn)} – {formatDate(tournament.endsOn)}
                  </p>
                </div>
                <Link className="btn-outline btn-sm" href={`/tournaments/${tournament.slug}/schedule`}>
                  Schedule
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
