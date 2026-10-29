"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SyncRunButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/sync/run", { method: "POST" });
      const data = (await response.json()) as {
        error?: string;
        configured?: boolean;
        attempted?: number;
        synchronized?: number;
        conflicted?: number;
        rejected?: number;
        errors?: string[];
      };

      if (!response.ok) {
        setMessage(data.error ?? "Sync failed.");
      } else if (!data.configured) {
        setMessage("Cloud sync is not configured. Everything stays safe on this laptop.");
      } else if (data.attempted === 0) {
        setMessage("Nothing was waiting to sync.");
      } else {
        setMessage(
          `Cloud confirmed ${data.synchronized ?? 0} of ${data.attempted} operation(s).` +
            (data.conflicted ? ` ${data.conflicted} conflict(s) need review.` : "") +
            (data.rejected ? ` ${data.rejected} rejected.` : "") +
            (data.errors?.length ? ` ${data.errors[0]}` : ""),
        );
      }
      router.refresh();
    } catch {
      setMessage("Could not reach the server. The local record is unaffected.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <button className="btn-accent" onClick={() => void run()} disabled={busy || disabled}>
        {busy ? "Pushing…" : "Sync now"}
      </button>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
    </div>
  );
}
