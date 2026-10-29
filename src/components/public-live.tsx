"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatClock } from "@/lib/domain/clock";
import type { ScoreboardView } from "@/lib/repos/scoreboard";

export function PublicLive({ gameId, initial }: { gameId: string; initial: ScoreboardView }) {
  const [view, setView] = useState<ScoreboardView>(initial);
  const [connected, setConnected] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const offsetRef = useRef(0);
  const receivedRef = useRef(Date.now());

  useEffect(() => {
    const events = new EventSource(`/api/games/${gameId}/stream`);
    events.onopen = () => setConnected(true);
    events.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as ScoreboardView;
        receivedRef.current = Date.now();
        offsetRef.current = Date.parse(payload.clock.serverNow) - receivedRef.current;
        setView(payload);
        setConnected(true);
      } catch {
        // ignore
      }
    };
    events.onerror = () => setConnected(false);
    return () => events.close();
  }, [gameId]);

  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const remainingMs = useMemo(() => {
    if (!view.clock.running) return view.clock.remainingMs;
    const anchor = Date.parse(view.clock.anchorAt);
    return Math.max(0, view.clock.remainingMs - (clockNow + offsetRef.current - anchor));
  }, [clockNow, view.clock]);

  return (
    <div className="rounded-2xl bg-slate-900 p-6 text-white shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <p className="font-bold uppercase tracking-[0.25em] text-orange-400">{view.statusLabel}</p>
        <p className="text-slate-400">
          {view.clock.running ? "Clock running" : "Clock stopped"} · Period {view.period}/{view.periodCount}
        </p>
      </div>

      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div>
          <p className="truncate text-sm font-semibold uppercase tracking-wide text-slate-300">{view.home.name}</p>
          <p className="tabular font-mono text-6xl font-black">{view.home.score}</p>
          <p className="text-xs text-slate-400">Team fouls {view.home.teamFouls}</p>
        </div>
        <div className="text-center">
          <p className="tabular font-mono text-4xl font-black text-amber-300">{formatClock(remainingMs)}</p>
          <p className="text-[11px] uppercase tracking-widest text-slate-400">Period {view.period}</p>
        </div>
        <div className="text-right">
          <p className="truncate text-sm font-semibold uppercase tracking-wide text-slate-300">{view.away.name}</p>
          <p className="tabular font-mono text-6xl font-black">{view.away.score}</p>
          <p className="text-xs text-slate-400">Team fouls {view.away.teamFouls}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 text-xs text-slate-400">
        <span>
          {connected ? "Live connection" : "Reconnecting…"}
          {view.pendingSyncEvents > 0
            ? ` · ${view.pendingSyncEvents} change(s) not yet in the cloud`
            : view.lastSyncedAt
              ? ` · cloud updated ${new Date(view.lastSyncedAt).toLocaleTimeString()}`
              : " · cloud sync not configured"}
        </span>
        <Link className="font-semibold text-white hover:underline" href={`/games/${gameId}/box-score`}>
          Box score →
        </Link>
      </div>

      {view.pendingSyncEvents > 0 ? (
        <p className="mt-3 rounded-lg bg-amber-500/15 px-3 py-2 text-[11px] text-amber-200">
          The cloud does not have the latest score yet. This figure comes from the venue&apos;s official local record and
          will publish once connectivity returns.
        </p>
      ) : null}
    </div>
  );
}
