"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReviewPanel({
  gameId,
  status,
  resultStatus,
  resultId,
  homeScore,
  awayScore,
  canSubmit,
  canApprove,
  pendingSyncEvents,
}: {
  gameId: string;
  status: string;
  resultStatus: string | null;
  resultId: string | null;
  homeScore: number;
  awayScore: number;
  canSubmit: boolean;
  canApprove: boolean;
  pendingSyncEvents: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showCorrect, setShowCorrect] = useState(false);
  const [corrected, setCorrected] = useState({ home: homeScore, away: awayScore, reason: "" });

  const call = async (body: Record<string, unknown>, successText: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/games/${gameId}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage({ tone: "error", text: data.error ?? "The action failed." });
        return;
      }
      setMessage({ tone: "ok", text: successText });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "Could not reach the local server." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {message ? (
        <p
          role="status"
          className={`rounded-lg border px-4 py-2 text-sm ${
            message.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {message.text}
        </p>
      ) : null}

      {pendingSyncEvents > 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {pendingSyncEvents} event(s) have not reached the cloud yet. Finalizing is allowed; the audit trail records
          that this result is local-first and it will sync when connectivity returns.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          className="btn-primary"
          disabled={!canSubmit || busy || status === "final" || status === "corrected"}
          onClick={() => void call({ action: "submit" }, "Result submitted for approval.")}
        >
          Submit result for approval
        </button>

        <button
          className="btn-accent"
          disabled={!canApprove || busy || resultStatus !== "submitted"}
          onClick={() => void call({ action: "approve" }, "Result approved. Standings and bracket updated.")}
        >
          Approve result
        </button>

        <button
          className="btn-outline"
          disabled={!canApprove || busy || resultStatus !== "submitted"}
          onClick={() => {
            if (rejectReason.trim().length < 3) {
              setMessage({ tone: "error", text: "Enter a rejection reason first." });
              return;
            }
            void call({ action: "reject", reason: rejectReason }, "Result rejected and returned to the scorer.");
          }}
        >
          Reject
        </button>

        {(status === "final" || status === "corrected") && canApprove ? (
          <button className="btn-outline" disabled={busy} onClick={() => setShowCorrect((value) => !value)}>
            Correct final result
          </button>
        ) : null}
      </div>

      {resultStatus === "submitted" && canApprove ? (
        <div>
          <label className="label" htmlFor="reject-reason">
            Rejection reason (required to reject)
          </label>
          <input
            id="reject-reason"
            className="input"
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder="Scorekeeper recorded a basket for the wrong team"
          />
        </div>
      ) : null}

      {showCorrect ? (
        <div className="card-pad space-y-3">
          <h3 className="text-sm font-bold">Correct the final result</h3>
          <p className="muted">
            The approved result is kept as superseded. The correction records your name, the reason and a timestamp.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="correct-home">
                Home score
              </label>
              <input
                id="correct-home"
                type="number"
                min={0}
                className="input"
                value={corrected.home}
                onChange={(event) => setCorrected({ ...corrected, home: Number(event.target.value) })}
              />
            </div>
            <div>
              <label className="label" htmlFor="correct-away">
                Away score
              </label>
              <input
                id="correct-away"
                type="number"
                min={0}
                className="input"
                value={corrected.away}
                onChange={(event) => setCorrected({ ...corrected, away: Number(event.target.value) })}
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="correct-reason">
              Reason
            </label>
            <textarea
              id="correct-reason"
              rows={2}
              className="input"
              value={corrected.reason}
              onChange={(event) => setCorrected({ ...corrected, reason: event.target.value })}
            />
          </div>
          <button
            className="btn-danger"
            disabled={busy || corrected.reason.trim().length < 3}
            onClick={() =>
              void call(
                {
                  action: "correct_final",
                  homeScore: corrected.home,
                  awayScore: corrected.away,
                  reason: corrected.reason,
                },
                "Final result corrected and re-approved.",
              )
            }
          >
            Save correction
          </button>
        </div>
      ) : null}

      <p className="text-xs text-slate-500">
        Only users with the Approving Official or Organization Administrator role can approve or correct a result.
        {resultId ? ` Current result record: ${resultId.slice(0, 12)}…` : ""}
      </p>
    </div>
  );
}
