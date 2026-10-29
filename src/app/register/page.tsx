import Link from "next/link";
import { redirect } from "next/navigation";
import { registerAction } from "@/app/actions/auth";
import { getSession } from "@/lib/auth/session";
import { Alert } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getSession();
  if (session) redirect("/dashboard");
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <p className="text-sm font-bold uppercase tracking-[0.3em] text-orange-500">CourtSide</p>
          <h1 className="mt-2 text-3xl font-black text-white">Create your organization</h1>
          <p className="mt-2 text-sm text-slate-400">
            Each organization keeps its own tournaments, teams, players and reports.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-2xl">
          {error ? (
            <div className="mb-4">
              <Alert tone="danger">{error}</Alert>
            </div>
          ) : null}

          <form action={registerAction} className="space-y-4">
            <div>
              <label className="label" htmlFor="name">
                Your full name
              </label>
              <input id="name" name="name" className="input" required autoComplete="name" />
            </div>
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input id="email" name="email" type="email" className="input" required autoComplete="email" />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                className="input"
                required
                minLength={10}
                autoComplete="new-password"
              />
              <p className="mt-1 text-xs text-slate-500">At least 10 characters, with a letter and a number.</p>
            </div>
            <hr className="border-slate-200" />
            <div>
              <label className="label" htmlFor="organizationName">
                Organization name
              </label>
              <input
                id="organizationName"
                name="organizationName"
                className="input"
                required
                placeholder="Barangay San Roque Basketball League"
              />
            </div>
            <div>
              <label className="label" htmlFor="location">
                Location (optional)
              </label>
              <input id="location" name="location" className="input" placeholder="San Roque Covered Court" />
            </div>

            <button type="submit" className="btn-accent w-full">
              Create organization
            </button>
          </form>

          <p className="mt-6 border-t border-slate-200 pt-4 text-center text-sm text-slate-600">
            Already registered?{" "}
            <Link className="font-semibold text-orange-700 hover:underline" href="/login">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
