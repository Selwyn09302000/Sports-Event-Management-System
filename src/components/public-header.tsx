import Link from "next/link";

export function PublicHeader({ subtitle }: { subtitle?: string }) {
  return (
    <header className="bg-slate-950 text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-orange-600 text-sm font-black">C</span>
          <span className="text-sm font-black uppercase tracking-[0.25em]">CourtSide</span>
        </Link>
        {subtitle ? <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{subtitle}</p> : null}
        <nav className="flex items-center gap-3 text-xs font-semibold">
          <Link className="text-slate-300 hover:text-white" href="/">
            All tournaments
          </Link>
          <Link className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/20" href="/login">
            Organizer sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="mt-12 border-t border-slate-200 py-6 text-center text-xs text-slate-500">
      CourtSide — offline-first tournament management. Public pages show the last published or synchronized data.
    </footer>
  );
}
