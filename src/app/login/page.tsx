import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-sm font-bold uppercase tracking-[0.3em] text-orange-500">CourtSide</p>
          <h1 className="mt-2 text-3xl font-black text-white">Scorer console sign in</h1>
          <p className="mt-2 text-sm text-slate-400">
            This account lives on the tournament laptop, so signing in works without internet.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-2xl">
          <LoginForm />
          <p className="mt-6 border-t border-slate-200 pt-4 text-center text-sm text-slate-600">
            New organization?{" "}
            <Link className="font-semibold text-orange-700 hover:underline" href="/register">
              Create an account
            </Link>
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          <Link className="hover:underline" href="/">
            Public tournament pages
          </Link>
        </p>
      </div>
    </main>
  );
}
