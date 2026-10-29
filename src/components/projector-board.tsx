"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatClock } from "@/lib/domain/clock";
import type { ScoreboardView } from "@/lib/repos/scoreboard";

type Connection = "connecting" | "live" | "reconnecting";

export function ProjectorBoard({ gameId, initial }: { gameId: string; initial: ScoreboardView }) {
  const [view, setView] = useState<ScoreboardView>(initial);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [soundOn, setSoundOn] = useState(false);

  const receivedAtRef = useRef(Date.now());
  const offsetRef = useRef(0);
  const lastBuzzerRef = useRef<string | null>(null);
  const audioRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const events = new EventSource(`/api/games/${gameId}/stream`);

    events.onopen = () => setConnection("live");
    events.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as ScoreboardView;
        receivedAtRef.current = Date.now();
        offsetRef.current = Date.parse(payload.clock.serverNow) - receivedAtRef.current;
        setView(payload);
        setConnection("live");
      } catch {
        // ignore malformed frame
      }
    };
    events.onerror = () => setConnection("reconnecting");

    return () => events.close();
  }, [gameId]);

  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);

  const remainingMs = useMemo(() => {
    if (!view.clock.running) return view.clock.remainingMs;
    const anchor = Date.parse(view.clock.anchorAt);
    return Math.max(0, view.clock.remainingMs - (clockNow + offsetRef.current - anchor));
  }, [clockNow, view.clock]);

  const beep = useCallback(() => {
    if (!soundOn) return;
    try {
      audioRef.current ??= new AudioContext();
      const context = audioRef.current;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = 880;
      gain.gain.value = 0.08;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.5);
    } catch {
      // Audio is optional and may be blocked until user interaction.
    }
  }, [soundOn]);

  // Buzzer once when the clock reaches zero.
  useEffect(() => {
    if (remainingMs === 0 && view.clock.running) {
      if (lastBuzzerRef.current !== view.clock.anchorAt) {
        lastBuzzerRef.current = view.clock.anchorAt;
        beep();
      }
    }
  }, [remainingMs, view.clock.running, view.clock.anchorAt, beep]);

  const goFullscreen = async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      // Some kiosk browsers block fullscreen; the board still works.
    }
  };

  const clockTone = view.clock.running
    ? "text-emerald-400"
    : remainingMs === 0
      ? "text-red-500"
      : "text-amber-400";

  const statusLabel = view.status === "live" && !view.clock.running ? "LIVE · CLOCK STOPPED" : view.statusLabel.toUpperCase();

  return (
    <div className="projector flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-6 px-8 py-4">
        <div className="min-w-0">
          <p className="truncate text-xl font-bold uppercase tracking-[0.25em] text-slate-400">
            {view.tournamentName}
          </p>
          <p className="truncate text-lg text-slate-500">{view.divisionName}</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span
            className={`rounded-full px-3 py-1 font-bold uppercase tracking-wide ${
              connection === "live" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/20 text-amber-300"
            }`}
          >
            {connection === "live" ? "Connected" : "Reconnecting…"}
          </span>
          <button
            className="rounded-full bg-white/10 px-3 py-1 font-semibold text-white hover:bg-white/20"
            onClick={() => setSoundOn((value) => !value)}
            aria-pressed={soundOn}
          >
            Sound {soundOn ? "on" : "off"}
          </button>
          <button className="rounded-full bg-white/10 px-3 py-1 font-semibold text-white hover:bg-white/20" onClick={goFullscreen}>
            Fullscreen
          </button>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-[1fr_auto_1fr] items-stretch gap-4 px-6 pb-4">
        <TeamSide name={view.home.name} color={view.home.color} score={view.home.score} fouls={view.home.teamFouls} timeouts={view.home.timeoutsUsed} align="left" />

        <div className="flex min-w-[26vw] flex-col items-center justify-center gap-3 rounded-3xl bg-slate-950/80 px-8 py-6 ring-1 ring-white/10">
          <p className="text-2xl font-bold uppercase tracking-[0.4em] text-slate-400">
            {view.period > 4 ? `OT${view.period - 4}` : `Q${view.period}`}
          </p>
          <p className={`tabular font-mono text-[13vw] font-black leading-none tracking-tight ${clockTone}`}>
            {formatClock(remainingMs)}
          </p>
          <p className="text-xl font-bold uppercase tracking-[0.2em] text-slate-300">{statusLabel}</p>
          {view.clock.running ? (
            <span className="rounded-full bg-emerald-500/20 px-4 py-1 text-sm font-bold uppercase tracking-widest text-emerald-300">
              Running
            </span>
          ) : (
            <span className="rounded-full bg-amber-500/20 px-4 py-1 text-sm font-bold uppercase tracking-widest text-amber-300">
              Stopped
            </span>
          )}
        </div>

        <TeamSide name={view.away.name} color={view.away.color} score={view.away.score} fouls={view.away.teamFouls} timeouts={view.away.timeoutsUsed} align="right" />
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-8 py-3 text-sm text-slate-400">
        <span>
          {view.venueName ?? "Venue TBD"} · {view.scheduledAt ? new Date(view.scheduledAt).toLocaleString() : "Unscheduled"}
        </span>
        <span>
          {view.pendingSyncEvents > 0
            ? `Local record · ${view.pendingSyncEvents} change(s) awaiting cloud sync`
            : view.lastSyncedAt
              ? `Cloud synced ${new Date(view.lastSyncedAt).toLocaleTimeString()}`
              : "Local record · cloud sync not configured"}
        </span>
      </footer>
    </div>
  );
}

function TeamSide({
  name,
  color,
  score,
  fouls,
  timeouts,
  align,
}: {
  name: string;
  color: string | null;
  score: number;
  fouls: number;
  timeouts: number;
  align: "left" | "right";
}) {
  return (
    <div
      className={`flex flex-col justify-center rounded-3xl px-6 py-4 ring-1 ring-white/10 ${
        align === "right" ? "items-end text-right" : "items-start text-left"
      }`}
      style={{ background: `linear-gradient(140deg, ${color ?? "#0f172a"}55, transparent 75%)` }}
    >
      <div className="flex items-center gap-3">
        <span className="h-6 w-6 rounded-full ring-2 ring-white/40" style={{ backgroundColor: color ?? "#334155" }} />
        <p className="text-[4vw] font-black uppercase leading-none tracking-tight">{name}</p>
      </div>
      <p className="tabular mt-4 font-mono text-[15vw] font-black leading-none">{score}</p>
      <div className={`mt-4 flex gap-6 text-lg font-bold uppercase tracking-wider ${align === "right" ? "justify-end" : ""}`}>
        <span className={fouls >= 5 ? "text-red-400" : "text-slate-300"}>Team fouls {fouls}</span>
        <span className="text-slate-500">Timeouts {timeouts}</span>
      </div>
    </div>
  );
}
