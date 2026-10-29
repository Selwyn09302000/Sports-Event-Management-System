# CourtSide — Sports & Events Management System

Offline-first, multi-organization tournament management for basketball: organizations,
tournaments, rosters, scheduling, live scoring, player statistics, an official review
workflow, a projector scoreboard, and public pages — all running on the tournament
laptop, with optional synchronization to hosted Supabase.

**Primary design rule:** a tournament must keep running with no internet and no router.
The laptop is the server. Online features are additive, never required.

---

## 1. What this repository is

A complete Next.js application plus a local SQLite store. The scoring laptop runs it;
the projector laptop and officials' phones connect to it over the local network.

```
Laptop A (server + scorer)                Laptop B (projector)      Officials' phones
┌──────────────────────────────┐          ┌───────────────────┐    ┌──────────────────┐
│ Next.js server :3000         │◄── LAN ──│ /scoreboard/:id    │    │ scorer console   │
│ SQLite (authoritative)       │◄── LAN ──│ (read-only SSE)    │    │ review screen    │
│ event log + clock + outbox   │◄── LAN ─────────────────────────│ (authenticated)  │
└──────────┬───────────────────┘                                    └──────────────────┘
           │ HTTPS (only when the venue has internet)
           ▼
   Hosted Supabase: idempotent push of confirmed events/results + RLS-protected reads
```

The browser is never the source of truth. Scores, the game clock, statistics and the
synchronization queue live in `data/local.sqlite`, so a refresh, a crash or a dead
battery cannot lose an official record.

---

## 2. Quick start (Windows 11 laptop)

Prerequisites: **Node.js 24 LTS** (Node 22.5+ works) and npm. No Python, no C++
build tools, no Docker required for the local server — persistence uses Node's built-in
`node:sqlite` driver.

```bash
npm install
cp .env.example .env          # optional; defaults work offline
node scripts/migrate.mjs      # create the local database
node scripts/seed.mjs         # optional demo league (remove before real use)
npm run build
npm run start                 # binds 0.0.0.0:3000
```

Then, on Laptop A: `http://localhost:3000`. On Laptop B or a phone: `http://<LAPTOP-A-IP>:3000`
(find the IP with `ipconfig`; see [docs/WINDOWS_HOTSPOT.md](docs/WINDOWS_HOTSPOT.md)).

Demo accounts created by the seed (password `CourtSide2026!`): `admin@example.com`,
`scorer@example.com`, `official@example.com`. Change or remove them before a real event.

For development use `npm run dev` instead of `build` + `start`.

---

## 3. Verification status

Everything below was executed on this machine, not assumed:

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | passes |
| Production build | `npm run build` | passes |
| Unit + integration tests | `npm test` | **70 tests pass** (scheduling, clock, scoring, standings, tenant isolation, idempotency, corrections, bracket progression, sync) |
| HTTP smoke suite | `npm run smoke` | **25 checks pass** (auth, scoring, duplicate protection, RBAC, CSRF, clock, public pages) |
| Browser E2E | `npm run test:e2e` | **passes** — sign in, pick a player, score, projector connects over SSE |
| LAN access + SSE | `curl http://<lan-ip>:3000/...` | scoreboard 200, event stream delivers live data |
| Postgres migration | applied to Postgres 16 via Docker | 24 tables, 40 RLS policies, no errors |
| RLS isolation | SQL session per user role | cross-organization rows invisible; anon denied `birth_date`, `guardian_name` |
| Local backup | `npm run db:backup` | snapshot written and readable |

Not verified (see [Known limitations](#10-known-limitations)): a real Supabase project,
Vercel deployment, Windows Mobile Hotspot on physical hardware, and two physical laptops.

---

## 4. Feature status

### Implemented and tested
- **Multi-organization** tenancy with server-side scoping on every query; roles:
  platform admin, organization admin, tournament manager, registrar, scorer,
  statistician, approving official, team manager, viewer. Multiple roles per member.
- **Local authentication** (scrypt password hashing, hashed session tokens, HttpOnly
  cookies) that works with no internet.
- **Tournaments**: create, edit, publish/unpublish, divisions, venues, rules
  (period length/count, foul limit, timeouts) per tournament.
- **Teams, players, rosters**: registration, jersey uniqueness, eligibility, roster
  locking with audit trail, inline creation while registering.
- **Scheduling**: single round robin, double round robin, single elimination with
  automatic byes, conflict detection (team, venue, duplicate matchup), transactional
  generation, guard against clearing a started schedule.
- **Live scoring**: immutable event log, durable clock (anchor + timestamp, not a
  counter), periods/overtime, undo-by-void, corrections that replace without erasing,
  timeouts, substitutions, foul-out protection, idempotent client action ids.
- **Player statistics**: points, 2PT/3PT/FT made-attempted, personal fouls, offensive
  and defensive rebounds, assists, steals, blocks, turnovers, substitutions; team fouls
  per period; cached aggregates rebuilt from events in the same transaction.
- **Official review**: submit → approve/reject → final, plus post-final corrections
  that supersede and preserve the original. Only approving officials/admins can approve.
- **Standings and brackets** derived from approved results only; winners advance and
  the next-round game is created automatically.
- **Projector scoreboard**: read-only, high contrast, full-screen, connection state,
  optional buzzer, never depends on the internet.
- **Public pages**: home, organization, tournament, schedule, standings, bracket, live
  game and box score. Only published tournaments are public; no private player data.
- **Synchronization**: durable outbox, one operation per event, unique idempotency keys,
  explicit pending/synchronized/conflicted/rejected states, retry button, and a rule that
  nothing is reported as synced without a cloud receipt.
- **Audit log** for corrections, voids, approvals, roster changes and role changes.
- **Backup tooling** (`npm run db:backup`) and documented restore procedure.

### Partially implemented
- **Cloud sync** is implemented and unit-tested against a fake transport, but has not
  been exercised against a live Supabase project (no project credentials here).
- **Schedule review before publishing**: the planner returns conflicts and the
  generation step reports them, but there is no separate drag-and-drop schedule editor.
- **Device management**: the `devices` table and role exist; no management UI yet.

### Not implemented
- Supabase Auth for cloud accounts (local accounts are the working path).
- Playing-time tracking (requires complete substitution + on-court tracking; the column
  exists and stays 0 rather than showing a wrong number).
- Shot clock, possession indicator, announcements UI, CSV/PDF export.
- Pull/reconciliation UI for conflicts (conflicts are surfaced and the review screen
  lets an official correct the result; there is no side-by-side diff screen).
- Public live pages served *from the cloud*: the public live view is served by the local
  server. A Vercel deployment would need a reader for the synced tables.
- Service worker / installable PWA. Offline resilience comes from the local server, which
  is stronger for the projector scenario, but the app is not installable.

---

## 5. Roles

| Role | Can do |
| --- | --- |
| Platform Super Admin | everything within every organization |
| Organization Administrator | all organization settings, members, tournaments, approvals |
| Tournament Manager | tournaments, divisions, venues, schedules, rosters, scoring |
| Registrar | teams, players, rosters |
| Scorer | scoring console, clock, statistics, submit results |
| Statistics Recorder | statistics entry only |
| Approving Official | review, approve/reject results, corrections, audit |
| Team Manager | roster management |
| Viewer | read-only within the organization |

Permissions are checked on the server for every action (`src/lib/auth/rbac.ts`). Hiding a
button is never the control.

---

## 6. Data model

Local SQLite: [src/lib/db/migrations/0001_init.sql](src/lib/db/migrations/0001_init.sql)
Cloud Postgres + RLS: [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql)

Events are immutable. Scores and statistics are always recomputed from non-voided events
(`refreshDerived`), so cached numbers can be reproduced from the event log. Corrections
void the original and append a replacement that references it.

The game clock stores `remaining_ms` + `anchor_at` + `running`, and the display is derived
from those values. Reloading a page or restarting the laptop recovers the exact clock.

---

## 7. Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | development server on `0.0.0.0:3000` |
| `npm run build` / `npm run start` | production build and local server |
| `npm test` | Vitest suite |
| `npm run smoke` | HTTP acceptance checks against a running server |
| `npm run test:e2e` | Playwright (requires `npx playwright install chromium` and seeded data) |
| `npm run db:migrate` | apply local migrations |
| `npm run db:seed` | demo organization, teams, rosters and two games |
| `npm run db:backup` | consistent SQLite snapshot into `backups/` |
| `npm run typecheck` | TypeScript only |

---

## 8. Security model

- Every repository call takes the organization id from the server session, never from
  the request body.
- Mutating endpoints validate `Origin` (CSRF), require an authenticated session with the
  right permission, and are rate limited.
- Input is validated with Zod on every API route and server action.
- Supabase service-role key is read only in server code and only when `SYNC_ENABLED=true`;
  it is never sent to the browser.
- RLS on the cloud schema denies cross-organization reads and hides private player columns
  from `anon` (verified with column-level grants).
- Offline sessions keep their last known roles. Revoking a role takes effect when the
  device can reach the server again; that limitation is inherent to offline operation.

---

## 9. Documentation

- [Architecture and offline design](docs/ARCHITECTURE.md)
- [Windows 11 hotspot & local network](docs/WINDOWS_HOTSPOT.md)
- [Projector setup](docs/PROJECTOR.md)
- [Scorer & officials guide](docs/SCORING_GUIDE.md)
- [Backup and recovery](docs/BACKUP_RECOVERY.md)
- [Deploying to Vercel + Supabase](docs/DEPLOYMENT.md)

---

## 10. Known limitations

1. **One real deployment is missing.** Cloud sync, Vercel and Supabase Auth are coded or
   modelled but not proven against live services here.
2. **Windows hotspot behaviour is untested on this hardware.** The server does bind
   `0.0.0.0` and was reached over the LAN address, but hotspot client isolation and
   internet sharing must be tested per laptop (checklist in the hotspot guide).
3. **A browser clock is a timing aid, not a certified device.** Use a physical backup
   timer for games that matter.
4. **Playing time is not computed**, because partial substitution tracking would produce
   misleading numbers.
5. **Local accounts are per laptop.** There is no central user directory; the cloud
   profile table exists but Supabase Auth is not wired.
6. **The sync queue is process-local in behaviour** and pushes in batches; a very large
   backlog will take several runs.
