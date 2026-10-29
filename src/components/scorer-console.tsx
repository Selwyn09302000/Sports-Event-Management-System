"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatClock } from "@/lib/domain/clock";
import { GAME_STATUS_LABELS, isFinalized, type GameStatus } from "@/lib/domain/game-state";
import type { GameState, RosterPlayer } from "@/lib/repos/games";

type ActionBody = Record<string, unknown> & { eventType?: string };

type PendingRetry = { path: string; body: ActionBody; label: string };

const PLAYER_ACTIONS: { eventType: string; label: string; key: string; tone: "score" | "miss" | "stat" }[] = [
  { eventType: "two_point_made", label: "+2", key: "2", tone: "score" },
  { eventType: "three_point_made", label: "+3", key: "3", tone: "score" },
  { eventType: "free_throw_made", label: "+1 FT", key: "1", tone: "score" },
  { eventType: "two_point_missed", label: "Miss 2", key: "m2", tone: "miss" },
  { eventType: "three_point_missed", label: "Miss 3", key: "m3", tone: "miss" },
  { eventType: "free_throw_missed", label: "Miss FT", key: "m1", tone: "miss" },
  { eventType: "personal_foul", label: "Foul", key: "pf", tone: "stat" },
  { eventType: "offensive_rebound", label: "OREB", key: "orb", tone: "stat" },
  { eventType: "defensive_rebound", label: "DREB", key: "drb", tone: "stat" },
  { eventType: "assist", label: "AST", key: "ast", tone: "stat" },
  { eventType: "steal", label: "STL", key: "stl", tone: "stat" },
  { eventType: "block", label: "BLK", key: "blk", tone: "stat" },
  { eventType: "turnover", label: "TOV", key: "tov", tone: "stat" },
];

function newActionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `act-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ScorerConsole({
  initialState,
  canScore,
  canReview,
  canFinalize,
}: {
  initialState: GameState;
  canScore: boolean;
  canReview: boolean;
  canFinalize: boolean;
}) {
  const [state, setState] = useState<GameState>(initialState);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [retry, setRetry] = useState<PendingRetry | null>(null);
  const [dialog, setDialog] = useState<null | { kind: "void"; eventId: string; label: string } | { kind: "reset" } | { kind: "sub" } | { kind: "end" }>(null);
  const [reason, setReason] = useState("");
  const [subOut, setSubOut] = useState("");
  const [subIn, setSubIn] = useState("");

  const offsetRef = useRef(0);
  const [now, setNow] = useState(() => Date.now());

  const game = state.game;
  const finalized = isFinalized(game.status as GameStatus);
  const scoringOpen = !finalized;
  const active = canScore && scoringOpen;

  // Correct the local clock against the server's own now, once per payload.
  useEffect(() => {
    offsetRef.current = Date.parse(state.clock.serverNow) - Date.now();
  }, [state.clock.serverNow]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);

  const remainingMs = useMemo(() => {
    if (!state.clock.running) return state.clock.remainingMs;
const anchor = Date.parse(state.clock.serverNow);
const elapsed = now + offsetRef.current - anchor;
return Math.max(0, state.clock.remainingMs - elapsed);
  }, [now, state.clock]);

  // Periodic reconciliation: another official's phone may be scoring too.
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/games/${game.id}/state`, { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as GameState;
        setState(data);
      } catch {
        // Offline is expected; the local server is the same machine in the gym.
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [game.id]);

  const selectedPlayer: RosterPlayer | null = useMemo(() => {
    if (!selectedPlayerId) return null;
    return [...state.roster.home, ...state.roster.away].find((player) => player.playerId === selectedPlayerId) ?? null;
  }, [selectedPlayerId, state.roster]);

  const send = useCallback(
    async (path: string, body: ActionBody, label: string, actionId?: string): Promise<boolean> => {
      if (!active) return false;
      setBusy(true);
      setFlash(null);
      try {
        const response = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, clientActionId: actionId ?? newActionId() }),
        });
        const data = (await response.json()) as { state?: GameState; error?: string; duplicate?: boolean };
        if (!response.ok || !data.state) {
          setFlash({ tone: "error", message: data.error ?? "Could not record that action." });
          setRetry(null);
          return false;
        }
        setState(data.state);
        setRetry(null);
        setFlash({
          tone: "ok",
          message: data.duplicate ? `${label}: already recorded (duplicate ignored).` : `${label} recorded.`,
        });
        return true;
      } catch {
        // Keep the same clientActionId so a retry can never double-count.
        setRetry({ path, body, label });
        setFlash({ tone: "error", message: "Network problem. The action was not confirmed — retry is safe." });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [active],
  );

  const recordPlayerAction = (eventType: string, label: string) => {
    if (!selectedPlayer) {
      setFlash({ tone: "error", message: "Select a player first." });
      return;
    }
    void send(
      `/api/games/${game.id}/events`,
      { eventType, playerId: selectedPlayer.playerId, teamId: selectedPlayer.teamId },
      `${label} · #${selectedPlayer.jerseyNumber} ${selectedPlayer.fullName}`,
    );
  };

  const recordTimeout = (teamId: string, teamName: string) => {
    void send(`/api/games/${game.id}/events`, { eventType: "timeout", teamId }, `Timeout · ${teamName}`);
  };

  const clockCommand = (command: Record<string, unknown>, label: string) => {
    void send(`/api/games/${game.id}/clock`, { command }, label);
  };

  const lifecycle = (action: string, label: string, extra: Record<string, unknown> = {}) => {
    void send(`/api/games/${game.id}/lifecycle`, { action, ...extra }, label);
  };

  const doVoid = async () => {
    if (dialog?.kind !== "void" || reason.trim().length < 3) return;
    const ok = await send(
      `/api/games/${game.id}/events/${dialog.eventId}/void`,
      { reason },
      `Void ${dialog.label}`,
    );
    if (ok) {
      setDialog(null);
      setReason("");
    }
  };

  const doSubstitution = async () => {
    if (dialog?.kind !== "sub" || !subOut || !subIn) return;
    const teamId = [...state.roster.home, ...state.roster.away].find((p) => p.playerId === subOut)?.teamId;
    if (!teamId) return;
    const ok = await send(
      `/api/games/${game.id}/events`,
      { eventType: "substitution", teamId, payload: { playerOutId: subOut, playerInId: subIn } },
      "Substitution",
    );
    if (ok) {
      setDialog(null);
      setSubOut("");
      setSubIn("");
    }
  };

  const clockTone = state.clock.running ? "text-emerald-300" : remainingMs === 0 ? "text-red-300" : "text-amber-300";

  return (
    <div className="space-y-4">
      {/* Header ---------------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3 text-white">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-400">
            {state.tournament.name} · {game.divisionName}
          </p>
          <h1 className="text-lg font-black">
            {game.homeTeamName} <span className="text-slate-500">vs</span> {game.awayTeamName}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-slate-800 px-2.5 py-1 font-semibold">
            {GAME_STATUS_LABELS[game.status as GameStatus] ?? game.status}
          </span>
          <span className="rounded-full bg-slate-800 px-2.5 py-1 font-semibold">
            Period {state.clock.period} / {game.periodCount}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 font-semibold ${
              state.pendingSyncEvents > 0 ? "bg-amber-500/20 text-amber-200" : "bg-emerald-500/20 text-emerald-200"
            }`}
          >
            {state.pendingSyncEvents > 0 ? `${state.pendingSyncEvents} unsynced` : "Local record safe"}
          </span>
          <Link className="rounded-full bg-white px-2.5 py-1 font-semibold text-slate-900" href={`/scoreboard/${game.id}`} target="_blank">
            Projector
          </Link>
          <Link className="rounded-full bg-white px-2.5 py-1 font-semibold text-slate-900" href={`/dashboard/games/${game.id}/review`}>
            Review
          </Link>
        </div>
      </div>

      {flash ? (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-2 text-sm ${
            flash.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          <span>{flash.message}</span>
          {retry ? (
            <button
              className="btn-outline btn-sm"
              disabled={busy}
              onClick={() => void send(retry.path, retry.body, retry.label)}
            >
              Retry {retry.label}
            </button>
          ) : null}
        </div>
      ) : null}

      {!canScore ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          You have read-only access to this game. Ask an administrator for the Scorer role to record actions.
        </p>
      ) : null}

      {finalized ? (
        <p className="rounded-lg border border-slate-300 bg-slate-100 px-4 py-2 text-sm text-slate-800">
          This game is finalized. Corrections go through the review workflow and are recorded in the audit log.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px_1fr]">
        <TeamPanel
          title={game.homeTeamName}
          color={game.homeColor}
          score={game.homeScore}
          teamFouls={state.boxScore.teams.find((t) => t.teamId === game.homeTeamId)?.fouls ?? 0}
          timeouts={state.boxScore.teams.find((t) => t.teamId === game.homeTeamId)?.timeoutsUsed ?? 0}
          maxTimeouts={state.ruleset.maxTimeouts}
          roster={state.roster.home}
          selectedPlayerId={selectedPlayerId}
          onSelect={setSelectedPlayerId}
          disabled={!active}
          onTimeout={() => recordTimeout(game.homeTeamId, game.homeTeamName)}
        />

        <div className="space-y-3">
          <div className="rounded-xl bg-slate-900 p-4 text-center text-white">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">
              Period {state.clock.period}
            </p>
            <p className={`tabular mt-1 font-mono text-5xl font-black ${clockTone}`}>{formatClock(remainingMs)}</p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {state.clock.running ? "Clock running" : remainingMs === 0 ? "Period clock at zero" : "Clock paused"}
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                className="btn-accent"
                disabled={!active || busy}
                onClick={() => clockCommand({ type: "toggle" }, state.clock.running ? "Clock paused" : "Clock started")}
              >
                {state.clock.running ? "Pause" : "Start"}
              </button>
              <button
                className="btn-outline"
                disabled={!active || busy}
                onClick={() => clockCommand({ type: "next_period" }, "Next period")}
              >
                Next period
              </button>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                className="rounded-lg border border-slate-700 px-2 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                disabled={!active || busy}
                onClick={() => setDialog({ kind: "reset" })}
              >
                Reset clock
              </button>
              <button
                className="rounded-lg border border-slate-700 px-2 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                disabled={!active || busy}
                onClick={() => lifecycle("end_period", "Period ended")}
              >
                End period
              </button>
            </div>

            <button
              className="mt-2 w-full rounded-lg bg-red-600 px-2 py-1.5 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-50"
              disabled={!active || busy}
              onClick={() => setDialog({ kind: "end" })}
            >
              End game → send to review
            </button>
          </div>

          <div className="card-pad">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected player</p>
            {selectedPlayer ? (
              <div className="mt-1">
                <p className="text-lg font-black leading-tight">
                  #{selectedPlayer.jerseyNumber} {selectedPlayer.fullName}
                </p>
                <p className="text-xs text-slate-500">
                  {selectedPlayer.teamId === game.homeTeamId ? game.homeTeamName : game.awayTeamName}
                </p>
              </div>
            ) : (
              <p className="muted mt-1">Pick a player, then record an action.</p>
            )}

            <div className="mt-3 grid grid-cols-3 gap-2">
              {PLAYER_ACTIONS.map((action) => (
                <button
                  key={action.eventType}
                  className={`rounded-lg px-2 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    action.tone === "score"
                      ? "bg-orange-600 text-white hover:bg-orange-500"
                      : action.tone === "miss"
                        ? "bg-slate-200 text-slate-800 hover:bg-slate-300"
                        : "bg-slate-800 text-white hover:bg-slate-700"
                  }`}
                  disabled={!active || busy || !selectedPlayer}
                  onClick={() => recordPlayerAction(action.eventType, PLAYER_ACTIONS.find((a) => a.eventType === action.eventType)?.label ?? action.eventType)}
                  aria-label={action.label}
                >
                  {action.label}
                </button>
              ))}
            </div>

            <button
              className="mt-2 w-full rounded-lg border border-slate-300 px-2 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              disabled={!active || busy}
              onClick={() => setDialog({ kind: "sub" })}
            >
              Record substitution
            </button>
            <p className="mt-2 text-[11px] leading-snug text-slate-500">
              Field-goal and free-throw percentages are calculated from these events. Missed shots never add points.
            </p>
          </div>
        </div>

        <TeamPanel
          title={game.awayTeamName}
          color={game.awayColor}
          score={game.awayScore}
          teamFouls={state.boxScore.teams.find((t) => t.teamId === game.awayTeamId)?.fouls ?? 0}
          timeouts={state.boxScore.teams.find((t) => t.teamId === game.awayTeamId)?.timeoutsUsed ?? 0}
          maxTimeouts={state.ruleset.maxTimeouts}
          roster={state.roster.away}
          selectedPlayerId={selectedPlayerId}
          onSelect={setSelectedPlayerId}
          disabled={!active}
          onTimeout={() => recordTimeout(game.awayTeamId, game.awayTeamName)}
        />
      </div>

      {/* Event feed ------------------------------------------------------ */}
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <h2 className="text-sm font-bold">Event history</h2>
          <span className="text-xs text-slate-500">{state.events.length} events · newest first</span>
        </div>
        {state.events.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No events yet. Starting the period clock records the first one.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {[...state.events].reverse().slice(0, 12).map((event) => {
              const player = [...state.roster.home, ...state.roster.away].find((p) => p.playerId === event.playerId);
              const label = event.eventType.replaceAll("_", " ");
              return (
                <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                  <div className={event.voided ? "text-slate-400 line-through" : ""}>
                    <span className="font-semibold">
                      {player ? `#${player.jerseyNumber} ${player.fullName}` : event.teamId === game.homeTeamId ? game.homeTeamName : event.teamId === game.awayTeamId ? game.awayTeamName : "Game"}
                    </span>{" "}
                    <span className="text-slate-600">{label}</span>
                    <span className="ml-2 text-xs text-slate-400">
                      P{event.period} · {event.clockSecondsRemaining}s · {event.recordedByName ?? "scorer"}
                    </span>
                    {event.voided ? (
                      <span className="ml-2 text-xs font-semibold text-slate-500">
                        voided{event.voidReason ? `: ${event.voidReason}` : ""}
                      </span>
                    ) : null}
                  </div>
                  {canReview && !event.voided ? (
                    <button
                      className="rounded border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      disabled={busy}
                      onClick={() => {
                        setReason("");
                        setDialog({ kind: "void", eventId: event.id, label });
                      }}
                    >
                      Void…
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Dialogs --------------------------------------------------------- */}
      {dialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm action"
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
            onKeyDown={(event) => {
              if (event.key === "Escape") setDialog(null);
            }}
          >
            {dialog.kind === "reset" ? (
              <>
                <h2 className="text-lg font-bold">Reset the period clock?</h2>
                <p className="muted mt-1">
                  The clock returns to {Math.round(game.periodSeconds / 60)}:00 for period {state.clock.period}. This is
                  recorded in the audit log; scores and statistics are untouched.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button className="btn-outline" onClick={() => setDialog(null)}>
                    Cancel
                  </button>
                  <button
                    className="btn-danger"
                    disabled={busy}
                    onClick={async () => {
                      const ok = await send(`/api/games/${game.id}/clock`, { command: { type: "reset_period" } }, "Clock reset");
                      if (ok) setDialog(null);
                    }}
                  >
                    Reset clock
                  </button>
                </div>
              </>
            ) : null}

            {dialog.kind === "end" ? (
              <>
                <h2 className="text-lg font-bold">End the game?</h2>
                <p className="muted mt-1">
                  The clock stops and the game moves to review. An approving official must still review and approve the
                  result — this does not finalize it.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button className="btn-outline" onClick={() => setDialog(null)}>
                    Cancel
                  </button>
                  <button
                    className="btn-danger"
                    disabled={busy}
                    onClick={async () => {
                      const ok = await send(`/api/games/${game.id}/lifecycle`, { action: "end_game" }, "Game ended");
                      if (ok) setDialog(null);
                    }}
                  >
                    End game
                  </button>
                </div>
              </>
            ) : null}

            {dialog.kind === "void" ? (
              <>
                <h2 className="text-lg font-bold">Void this event?</h2>
                <p className="muted mt-1">
                  “{dialog.label}” will be marked void and excluded from totals. The original record is kept, and both
                  the void and the reason are written to the audit log.
                </p>
                <label className="label mt-3" htmlFor="void-reason">
                  Reason
                </label>
                <textarea
                  id="void-reason"
                  autoFocus
                  rows={3}
                  className="input"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Wrong player selected"
                />
                <div className="mt-4 flex justify-end gap-2">
                  <button className="btn-outline" onClick={() => setDialog(null)}>
                    Cancel
                  </button>
                  <button className="btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => void doVoid()}>
                    Void event
                  </button>
                </div>
              </>
            ) : null}

            {dialog.kind === "sub" ? (
              <>
                <h2 className="text-lg font-bold">Record substitution</h2>
                <p className="muted mt-1">Choose the player leaving and the player entering. Both must be on the same team.</p>
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="label" htmlFor="sub-out">
                      Player out
                    </label>
                    <select id="sub-out" className="input" value={subOut} onChange={(event) => setSubOut(event.target.value)}>
                      <option value="">Select…</option>
                      {[...state.roster.home, ...state.roster.away].map((player) => (
                        <option key={player.playerId} value={player.playerId}>
                          #{player.jerseyNumber} {player.fullName} ({player.teamId === game.homeTeamId ? "Home" : "Away"})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="sub-in">
                      Player in
                    </label>
                    <select id="sub-in" className="input" value={subIn} onChange={(event) => setSubIn(event.target.value)}>
                      <option value="">Select…</option>
                      {[...state.roster.home, ...state.roster.away]
                        .filter((player) => player.playerId !== subOut)
                        .map((player) => (
                          <option key={player.playerId} value={player.playerId}>
                            #{player.jerseyNumber} {player.fullName} ({player.teamId === game.homeTeamId ? "Home" : "Away"})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button className="btn-outline" onClick={() => setDialog(null)}>
                    Cancel
                  </button>
                  <button className="btn-primary" disabled={busy || !subOut || !subIn} onClick={() => void doSubstitution()}>
                    Record substitution
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {canFinalize && game.status === "awaiting_review" ? (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          This game is awaiting review.{" "}
          <Link className="font-semibold underline" href={`/dashboard/games/${game.id}/review`}>
            Open the review screen
          </Link>{" "}
          to submit and approve the result.
        </div>
      ) : null}
    </div>
  );
}

function TeamPanel({
  title,
  color,
  score,
  teamFouls,
  timeouts,
  maxTimeouts,
  roster,
  selectedPlayerId,
  onSelect,
  disabled,
  onTimeout,
}: {
  title: string;
  color: string | null;
  score: number;
  teamFouls: number;
  timeouts: number;
  maxTimeouts: number;
  roster: RosterPlayer[];
  selectedPlayerId: string | null;
  onSelect: (playerId: string) => void;
  disabled: boolean;
  onTimeout: () => void;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="px-4 py-3 text-white" style={{ backgroundColor: color ?? "#0f172a" }}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate text-base font-black">{title}</h2>
          <p className="tabular font-mono text-3xl font-black">{score}</p>
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-white/80">
          <span>
            Team fouls {teamFouls} · Timeouts {timeouts}/{maxTimeouts}
          </span>
          <button
            className="rounded bg-white/20 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-white/30 disabled:opacity-50"
            disabled={disabled}
            onClick={onTimeout}
          >
            Timeout
          </button>
        </div>
      </div>

      {roster.length === 0 ? (
        <p className="p-4 text-sm text-slate-500">No eligible players on this roster.</p>
      ) : (
        <ul className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto">
          {roster.map((player) => {
            const selected = player.playerId === selectedPlayerId;
            return (
              <li key={player.playerId}>
                <button
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition ${
                    selected ? "bg-orange-50 ring-2 ring-inset ring-orange-500" : "hover:bg-slate-50"
                  }`}
                  onClick={() => onSelect(player.playerId)}
                  aria-pressed={selected}
                >
                  <span className="flex items-center gap-2">
                    <span className="tabular w-7 font-mono text-xs font-bold text-slate-500">{player.jerseyNumber}</span>
                    <span className="font-semibold text-slate-800">{player.fullName}</span>
                  </span>
                  {player.position ? <span className="text-[11px] text-slate-500">{player.position}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
