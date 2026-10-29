# Architecture

## Why the server owns the data

The projector laptop and officials' phones must see the same score in real time. Browser
storage (IndexedDB/Dexie) is per-browser and would fork the game state across devices, so it
is deliberately not used as the system of record. Instead:

- **Laptop A runs the Next.js server** (`npm run start`, bound to `0.0.0.0:3000`).
- **SQLite is the authoritative store** (`data/local.sqlite`, WAL mode, `synchronous=FULL`).
- Every scorer action is committed locally **before** the UI reports success.
- Projector and live pages read over the LAN through Server-Sent Events.

No internet is needed for any of that.

## Layers

```
src/app            Next.js App Router pages, route handlers, server actions
src/components     UI (scorer console, projector, review panel, box score)
src/lib/repos      Organization-scoped data access + business operations
src/lib/domain     Pure logic: clock, basketball rules, scheduling, standings, state machine
src/lib/db         SQLite connection, migrations, query helpers
src/lib/auth       Sessions, password hashing, RBAC
src/lib/sync       Outbox transport to Supabase (server-only)
supabase/          Hosted Postgres schema + RLS
```

The repository layer is the only place that writes to the database, and every function
takes `organizationId` from the session. Cross-organization access therefore fails closed
(`getGameRow(gameId, otherOrgId)` throws `not_found`).

## Event sourcing, lightly

`game_events` is append-only. Each row carries:

```
id, organization_id, tournament_id, game_id, team_id, player_id, event_type,
period, clock_seconds_remaining, occurred_at, recorded_by, device_id,
payload_json, schema_version, seq, client_action_id, sync_status, voided_at,
voided_by, void_reason, corrects_event_id
```

- **Nothing is deleted or edited in place.** A wrong entry is voided with a reason, or
  corrected by voiding it and appending a replacement that points at it
  (`corrects_event_id`).
- **Scores and statistics are derived** (`refreshDerived`) from non-voided events, and the
  cached tables (`player_game_statistics`, `team_game_statistics`, `games.home_score`) are
  rebuilt inside the same transaction as the write. Caches can never drift.
- **Idempotency**: `(game_id, client_action_id)` is unique. A retried request returns the
  original event instead of scoring twice.

## The clock

Not a decrementing counter. The stored state is:

```
remaining_ms  running  anchor_at  period  version
```

Displayed value = `remaining_ms - (now - anchor_at)` when running, otherwise `remaining_ms`.
Consequences:

- A refresh, reload or laptop restart recovers the exact clock.
- A backgrounded browser tab cannot make the official clock drift; the display is derived.
- Starting/pausing rewrites `remaining_ms` with the derived value and re-anchors.

Period lengths come from the tournament ruleset (`periods × period_seconds`, overtime
length), never from the client. A period ending never finalizes the game by itself.

## Sport extensibility

`src/lib/domain/sports/` defines a `SportAdapter` boundary: event catalogue, validation,
stat reducers and box-score construction. Basketball lives in `basketball.ts` and is
registered in `registry.ts`. Organizations, tournaments, scheduling, permissions, review
and sync are sport-agnostic; adding volleyball means adding an adapter, not editing
tournament management.

## Scheduling

`src/lib/domain/scheduling.ts` is pure and fully unit-tested:

- Round robin via the circle method → exactly `n(n-1)/2` games.
- Double round robin → mirrored second leg with home/away swapped.
- Single elimination → next power of two, standard seeding (`1v8, 4v5, …`), byes to the
  top seeds, `n-1` games played.
- Conflict detection: duplicate matchup, team double-booked, venue double-booked.

Later bracket rounds are created as winners emerge (`sweepBracket`), because a game row
requires two known teams.

## Synchronization

```
scorer action ──► SQLite event (sync_status=pending)
                     └─► sync_operations row (unique idempotency_key)
                              │  POST /api/sync/run (admin only)
                              ▼
                    SupabaseTransport (service-role, server-only)
                     ├─ 2xx → synchronized + remote_confirmed_at
                     ├─ 5xx/network → stays pending, attempts+1
                     ├─ 409 / differing result → conflicted
                     └─ other 4xx → rejected
```

- Cloud writes go to `game_events` and `game_results` with `Prefer: resolution=ignore-duplicates`,
  so the same event id can be pushed repeatedly with no duplicate points.
- A finalized result is compared against the cloud first; if the cloud already holds a
  different approved score, the operation becomes **conflicted** instead of overwriting.
- Local first, cloud second. Nothing in the sync path ever writes back into a local game.
- UI states: *local record safe*, *N unsynced*, *cloud synchronized at …*. A timestamp is
  only shown for confirmed pushes.

## Realtime without WebSockets

`/api/games/[id]/stream` is a Server-Sent Events endpoint that re-projects the scoreboard
once per second. It carries no player personal data, works through the hotspot, and needs
no extra service. The client corrects for clock skew using the server's `serverNow`.

## Why separate admin and public rendering

Public pages only read published tournaments (`status = 'published'`) and never expose
birth dates, guardians, contact details or events. The projector projection
(`buildScoreboardView`) is a deliberately small, public-safe shape.
