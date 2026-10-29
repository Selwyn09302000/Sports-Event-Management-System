import { notFound } from "next/navigation";
import { PublicFooter, PublicHeader } from "@/components/public-header";
import { PublicLive } from "@/components/public-live";
import { formatDateTime } from "@/components/ui";
import { isGamePublic } from "@/lib/repos/games";
import { buildScoreboardView } from "@/lib/repos/scoreboard";

export const dynamic = "force-dynamic";

export default async function PublicLivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isGamePublic(id)) notFound();

  const view = buildScoreboardView({ gameId: id, organizationId: null });

  return (
    <div className="min-h-screen">
      <PublicHeader subtitle={`${view.tournamentName} · ${view.divisionName}`} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-black">
          {view.home.name} vs {view.away.name}
        </h1>
        <p className="muted mt-1">
          {formatDateTime(view.scheduledAt)} · {view.venueName ?? "Venue TBD"}
        </p>

        <div className="mt-5">
          <PublicLive gameId={id} initial={view} />
        </div>

        <p className="mt-6 rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
          Scores on this page come from the venue&apos;s local scoring system. When the venue has no internet, this page
          cannot update — the timestamp above shows how fresh the cloud copy is. The official record always lives on the
          tournament laptop until it is synchronized.
        </p>
      </main>
      <PublicFooter />
    </div>
  );
}
