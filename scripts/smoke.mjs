/**
 * End-to-end smoke test against a running local server.
 *
 *   node scripts/seed.mjs
 *   npm run build && npm run start
 *   node scripts/smoke.mjs
 *
 * Covers: authentication, scoring, duplicate protection, missed shots,
 * role-based authorization, clock control and public page availability.
 * Mutates the seeded demo games.
 */
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const PASSWORD = "CourtSide2026!";

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function login(email) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const cookies = response.headers.getSetCookie?.() ?? [];
  const cookie = cookies.map((entry) => entry.split(";")[0]).join("; ");
  if (!response.ok) throw new Error(`login failed for ${email}: ${await response.text()}`);
  return cookie;
}

async function api(path, options = {}, cookie) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

const html = async (path) => (await fetch(`${BASE}${path}`)).status;

async function main() {
  console.log(`Smoke testing ${BASE}\n`);

  const health = await api("/api/health");
  check("health endpoint responds", health.status === 200 && health.body.ok === true);

  const tournamentSlug = "summer-invitational-2026";
  const publicSchedule = await html(`/tournaments/${tournamentSlug}/schedule`);
  check("public schedule renders", publicSchedule === 200, `status ${publicSchedule}`);

  const scorer = await login("scorer@example.com");
  const official = await login("official@example.com");

  const dashboard = await fetch(`${BASE}/dashboard`, { headers: { cookie: scorer } });
  check("authenticated dashboard renders", dashboard.status === 200, `status ${dashboard.status}`);

  // Find a game that has not been finalized yet.
  const gamesHtml = await fetch(`${BASE}/tournaments/${tournamentSlug}/schedule`, { headers: { cookie: scorer } });
  const scheduleText = await gamesHtml.text();
  const gameIds = [...scheduleText.matchAll(/\/games\/(gam_[a-z0-9]+)\/live/g)].map((match) => match[1]);
  check("schedule lists seeded games", gameIds.length >= 2, `found ${gameIds.length}`);

  // Pick a game that can still be scored, so repeated runs stay valid.
  const scorable = ["scheduled", "ready", "live", "paused", "period_ended"];
  let gameId = process.env.GAME_ID || null;
  let state = null;
  for (const candidate of gameIds) {
    const candidateState = (await api(`/api/games/${candidate}/state`, {}, scorer)).body;
    if (!candidateState?.game?.id) continue;
    if (!gameId) {
      gameId = candidate;
      state = candidateState;
    }
    if (scorable.includes(candidateState.game.status) && candidateState.game.status === "scheduled") {
      gameId = candidate;
      state = candidateState;
      break;
    }
  }
  check("game state loads for scorer", Boolean(state?.game?.id), JSON.stringify(state).slice(0, 120));

  const homeTeamId = state.game.homeTeamId;
  const player = state.roster.home[0];
  check("seeded roster contains players", Boolean(player?.playerId));

  const startingScore = state.game.homeScore;
  const wasScheduled = state.game.status === "scheduled";

  const unauthorized = await api(`/api/games/${gameId}/events`, {
    method: "POST",
    body: JSON.stringify({ eventType: "two_point_made", teamId: homeTeamId, playerId: player.playerId }),
  });
  check("unauthenticated scoring is rejected", unauthorized.status === 401, `status ${unauthorized.status}`);

  const actionId = `smoke-${Date.now()}`;
  const made = await api(
    `/api/games/${gameId}/events`,
    {
      method: "POST",
      body: JSON.stringify({
        eventType: "two_point_made",
        teamId: homeTeamId,
        playerId: player.playerId,
        clientActionId: actionId,
      }),
    },
    scorer,
  );
  check("scorer records a two-point basket", made.status === 200 && made.body.state?.game?.homeScore === startingScore + 2, `status ${made.status}`);
  if (wasScheduled) {
    check("first event moves a scheduled game to live", made.body.state?.game?.status === "live", made.body.state?.game?.status);
  } else {
    console.log(`  SKIP  scheduled-to-live transition (game was already ${state.game.status})`);
  }

  const replay = await api(
    `/api/games/${gameId}/events`,
    {
      method: "POST",
      body: JSON.stringify({
        eventType: "two_point_made",
        teamId: homeTeamId,
        playerId: player.playerId,
        clientActionId: actionId,
      }),
    },
    scorer,
  );
  check(
    "duplicate request is idempotent (no extra points)",
    replay.body.duplicate === true && replay.body.state?.game?.homeScore === startingScore + 2,
    `score ${replay.body.state?.game?.homeScore}`,
  );

  const missed = await api(
    `/api/games/${gameId}/events`,
    {
      method: "POST",
      body: JSON.stringify({
        eventType: "two_point_missed",
        teamId: homeTeamId,
        playerId: player.playerId,
        clientActionId: `${actionId}-miss`,
      }),
    },
    scorer,
  );
  const missedLine = missed.body.state?.boxScore?.players?.find((line) => line.playerId === player.playerId);
  check("missed shot does not add points", missed.body.state?.game?.homeScore === startingScore + 2);
  check("missed shot counts as an attempt", (missedLine?.fga2 ?? 0) >= 1);

  const scorerCannotVoid = await api(
    `/api/games/${gameId}/events/${made.body.eventId}/void`,
    { method: "POST", body: JSON.stringify({ reason: "smoke test" }) },
    scorer,
  );
  check("scorer cannot void events (needs review permission)", scorerCannotVoid.status === 403, `status ${scorerCannotVoid.status}`);

  const officialVoids = await api(
    `/api/games/${gameId}/events/${made.body.eventId}/void`,
    { method: "POST", body: JSON.stringify({ reason: "Smoke test: void the basket" }) },
    official,
  );
  check("official voids the basket", officialVoids.status === 200, `status ${officialVoids.status}`);
  check(
    "voiding removes the points",
    officialVoids.body.state?.game?.homeScore === startingScore,
    `score ${officialVoids.body.state?.game?.homeScore}`,
  );

  const clockStart = await api(
    `/api/games/${gameId}/clock`,
    { method: "POST", body: JSON.stringify({ command: { type: "start" } }) },
    scorer,
  );
  check("scorer starts the clock", clockStart.body.state?.clock?.running === true);
  check("clock derives a positive remaining time", (clockStart.body.state?.clock?.remainingMs ?? 0) > 0);

  const clockPause = await api(
    `/api/games/${gameId}/clock`,
    { method: "POST", body: JSON.stringify({ command: { type: "pause" } }) },
    scorer,
  );
  check("scorer pauses the clock", clockPause.body.state?.clock?.running === false);

  const crossOrigin = await fetch(`${BASE}/api/games/${gameId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: scorer, origin: "https://evil.example" },
    body: JSON.stringify({ eventType: "timeout", teamId: homeTeamId }),
  });
  check("cross-origin mutation is rejected", crossOrigin.status === 403, `status ${crossOrigin.status}`);

  for (const path of [
    `/scoreboard/${gameId}`,
    `/games/${gameId}/live`,
    `/games/${gameId}/box-score`,
    `/tournaments/${tournamentSlug}`,
    `/tournaments/${tournamentSlug}/standings`,
    `/organizations/san-roque`,
  ]) {
    const status = await html(path);
    check(`public page ${path}`, status === 200, `status ${status}`);
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const failure of failures) console.log(` - ${failure}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\nSmoke run crashed:", error.message);
  process.exit(1);
});
