import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicFooter, PublicHeader } from "@/components/public-header";
import { Badge, EmptyState, formatDate } from "@/components/ui";
import { getOrganizationBySlug } from "@/lib/repos/orgs";
import { listPublishedTournaments } from "@/lib/repos/tournaments";

export const dynamic = "force-dynamic";

export default async function OrganizationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const organization = getOrganizationBySlug(slug);
  if (!organization) notFound();

  const tournaments = listPublishedTournaments(slug);

  return (
    <div className="min-h-screen">
      <PublicHeader subtitle={organization.name} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-3xl font-black">{organization.name}</h1>
        <p className="muted mt-1">{organization.location ?? "—"}</p>
        {organization.description ? <p className="mt-3 max-w-2xl text-slate-700">{organization.description}</p> : null}

        <h2 className="mt-8 text-xl font-bold">Tournaments</h2>
        {tournaments.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No published tournaments" description="Check back once the organizer publishes the schedule." />
          </div>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tournaments.map((tournament) => (
              <li key={tournament.id}>
                <Link href={`/tournaments/${tournament.slug}`} className="card-pad block hover:border-orange-300">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-bold">{tournament.name}</p>
                    <Badge tone="success">published</Badge>
                  </div>
                  <p className="muted mt-1">{tournament.location ?? "Location TBD"}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {formatDate(tournament.startsOn)} – {formatDate(tournament.endsOn)}
                  </p>
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
