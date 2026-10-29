# Deploying the cloud side (Vercel + hosted Supabase)

The local laptop remains authoritative during a tournament. The cloud provides hosted
authentication for online roles, public pages, and a durable copy of confirmed results.

> Status: the Postgres schema and RLS were applied and tested against Postgres 16 locally
> (see README). The steps below were **not** executed against a live Vercel/Supabase project
> in this workspace, because no project credentials were available.

## 1. Create the Supabase project

1. Create a project at supabase.com and note the URL, anon key and service-role key.
2. Apply the schema with the Supabase CLI:
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
   Or paste `supabase/migrations/0001_init.sql` into the SQL editor.
3. Confirm tables and RLS:
   ```sql
   select count(*) from pg_tables where schemaname = 'public';   -- 24
   select count(*) from pg_policies where schemaname = 'public'; -- 40
   ```

## 2. Configure the local server for sync

Create `.env` on Laptop A:

```
LOCAL_DB_PATH=./data/local.sqlite
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service-role key>   # server-only, never NEXT_PUBLIC_*
SYNC_ENABLED=true
```

Restart the server. **Dashboard → Sync** should now say the cloud is configured.

Never commit `.env`, and never place the service-role key in client code. The push
endpoint is server-only and requires the `sync.manage` permission.

## 3. Vercel

Only do this if you want hosted public pages and a hosted dashboard. The local server is
still required for scoring.

1. Push the repository to GitHub and import it in Vercel (framework: Next.js).
2. Environment variables (Production):
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`
   - `COOKIE_SECURE=true`
   - Do **not** copy `LOCAL_DB_PATH` or the service-role key to a shared deployment unless
     you intend the deployment to push (it should not; the laptop pushes).
3. Deploy.

### Important architectural caveat

This app's pages read from the local SQLite store. A Vercel deployment has no such file,
so hosted public pages require a cloud reader (read published tournaments, games, results
and clock from Supabase) that is **not implemented yet**. Options:

- Run the public pages from the venue server only (works today, LAN or via a tunnel), or
- Add a `CloudRepository` that implements the same read functions against Supabase.

Do not claim the hosted public site works until that reader exists and is tested.

## 4. Cloud authentication

Supabase Auth is not wired into the UI. The schema has `profiles` (linked to `auth.users`)
and membership roles for a future hosted login. Today, accounts are local to the laptop
and work offline. If you enable Supabase Auth later:

- map `auth.uid()` to `profiles.id`,
- create `organization_members` rows server-side only,
- keep all writes that affect official results behind the local server.

## 5. Operational limits

- Vercel functions are stateless and time-limited; do not attempt to run scoring there.
- Supabase free tiers have row and storage limits; long tournaments produce many events.
  Check your plan before a multi-week league.
- Local machine has no public address. Cloud sync must be initiated from the laptop
  (`Sync now`), never by the cloud reaching into the venue.

## 6. Go-live checklist

- [ ] `npm run build` passes; `npm test` passes (70 tests).
- [ ] `npm run db:backup` taken and copied off the laptop.
- [ ] Migrations applied; `/api/health` reports the expected schema version.
- [ ] Hotspot, firewall and projector verified on the actual hardware.
- [ ] Roles assigned; at least two people can approve results.
- [ ] Roster locked after lineups are final.
- [ ] Sync tested once with a throwaway game before the real tournament.
- [ ] Paper backup timer available.
