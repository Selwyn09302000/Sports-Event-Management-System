-- ---------------------------------------------------------------------------
-- CourtSide — hosted (Supabase / Postgres) schema
--
-- This is the cloud mirror of the local SQLite store. The local tournament
-- laptop remains authoritative for official results; it pushes confirmed facts
-- here with the service-role key. RLS below protects any direct client access
-- (anon public pages, future Supabase-Auth dashboards).
--
-- Run with: supabase db push   (or psql -f)
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Reference / tenancy
-- ---------------------------------------------------------------------------

create table if not exists public.sports (
  key text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

insert into public.sports (key, name) values ('basketball', 'Basketball')
on conflict (key) do nothing;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  location text,
  contact_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  roles text[] not null default array['viewer']::text[],
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index if not exists organization_members_user_idx on public.organization_members (user_id);

-- ---------------------------------------------------------------------------
-- Helpers used by RLS policies
-- ---------------------------------------------------------------------------

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_platform_admin from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function public.is_org_member(org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
      or exists (
           select 1 from public.organization_members m
            where m.organization_id = org and m.user_id = auth.uid() and m.status = 'active'
         );
$$;

create or replace function public.has_org_role(org uuid, allowed text[])
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
      or exists (
           select 1 from public.organization_members m
            where m.organization_id = org
              and m.user_id = auth.uid()
              and m.status = 'active'
              and m.roles && allowed
         );
$$;

-- ---------------------------------------------------------------------------
-- Tournaments
-- ---------------------------------------------------------------------------

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  slug text not null unique,
  name text not null,
  description text,
  location text,
  starts_on date,
  ends_on date,
  sport_key text not null references public.sports (key) default 'basketball',
  format text not null default 'round_robin'
    check (format in ('round_robin', 'double_round_robin', 'single_elimination')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  ruleset jsonb not null default '{}'::jsonb,
  roster_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists tournaments_org_idx on public.tournaments (organization_id, status);

-- Defined after the table it reads (functions are checked at creation time).
create or replace function public.is_tournament_public(tournament uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tournaments t where t.id = tournament and t.status = 'published');
$$;

create table if not exists public.divisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  name text not null,
  age_group text,
  created_at timestamptz not null default now(),
  unique (tournament_id, name)
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  short_name text,
  color text,
  logo_url text,
  contact_name text,
  contact_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists teams_org_idx on public.teams (organization_id);

create table if not exists public.tournament_teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  division_id uuid not null references public.divisions (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  seed integer,
  status text not null default 'registered' check (status in ('registered', 'confirmed', 'withdrawn')),
  created_at timestamptz not null default now(),
  unique (tournament_id, team_id)
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  full_name text not null,
  birth_date date,
  guardian_name text,
  contact_phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists players_org_idx on public.players (organization_id);

create table if not exists public.roster_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  jersey_number integer not null check (jersey_number between 0 and 99),
  position text,
  status text not null default 'pending' check (status in ('pending', 'active', 'inactive')),
  eligible boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tournament_id, team_id, jersey_number),
  unique (tournament_id, player_id)
);
create index if not exists roster_team_idx on public.roster_entries (team_id);

create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  name text not null,
  address text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Games
-- ---------------------------------------------------------------------------

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  division_id uuid not null references public.divisions (id) on delete cascade,
  home_team_id uuid not null references public.teams (id),
  away_team_id uuid not null references public.teams (id),
  venue_id uuid references public.venues (id) on delete set null,
  scheduled_at timestamptz,
  status text not null default 'scheduled',
  stage text not null default 'group',
  round_number integer not null default 1,
  bracket_slot integer,
  home_score integer not null default 0,
  away_score integer not null default 0,
  current_period integer not null default 1,
  period_count integer not null default 4,
  period_seconds integer not null default 600,
  version integer not null default 1,
  last_event_seq integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint games_distinct_teams check (home_team_id <> away_team_id)
);
create index if not exists games_tournament_idx on public.games (tournament_id, scheduled_at);
create index if not exists games_org_status_idx on public.games (organization_id, status);

create table if not exists public.game_periods (
  game_id uuid not null references public.games (id) on delete cascade,
  period_number integer not null,
  duration_seconds integer not null,
  home_score integer not null default 0,
  away_score integer not null default 0,
  started_at timestamptz,
  ended_at timestamptz,
  primary key (game_id, period_number)
);

create table if not exists public.game_clock_states (
  game_id uuid primary key references public.games (id) on delete cascade,
  period integer not null,
  remaining_ms integer not null,
  running boolean not null default false,
  anchor_at timestamptz not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.game_events (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  team_id uuid,
  player_id uuid,
  event_type text not null,
  period integer not null,
  clock_seconds_remaining integer not null default 0,
  occurred_at timestamptz not null,
  recorded_by uuid,
  device_id text,
  payload jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  seq integer not null,
  sync_status text not null default 'synchronized'
    check (sync_status in ('pending', 'synchronized', 'conflicted', 'rejected', 'local_only')),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  corrects_event_id uuid,
  client_action_id text,
  created_at timestamptz not null default now(),
  unique (game_id, seq)
);
create index if not exists game_events_game_idx on public.game_events (game_id, seq);
create unique index if not exists game_events_client_action_idx
  on public.game_events (game_id, client_action_id) where client_action_id is not null;

create table if not exists public.player_game_statistics (
  game_id uuid not null references public.games (id) on delete cascade,
  organization_id uuid not null,
  team_id uuid not null,
  player_id uuid not null,
  points integer not null default 0,
  fgm2 integer not null default 0,
  fga2 integer not null default 0,
  fgm3 integer not null default 0,
  fga3 integer not null default 0,
  ftm integer not null default 0,
  fta integer not null default 0,
  fouls integer not null default 0,
  offensive_rebounds integer not null default 0,
  defensive_rebounds integer not null default 0,
  assists integer not null default 0,
  steals integer not null default 0,
  blocks integer not null default 0,
  turnovers integer not null default 0,
  substitutions integer not null default 0,
  seconds_played integer not null default 0,
  snapshot_at timestamptz not null default now(),
  primary key (game_id, player_id)
);

create table if not exists public.team_game_statistics (
  game_id uuid not null references public.games (id) on delete cascade,
  organization_id uuid not null,
  team_id uuid not null,
  points integer not null default 0,
  fouls integer not null default 0,
  timeouts_used integer not null default 0,
  snapshot_at timestamptz not null default now(),
  primary key (game_id, team_id)
);

create table if not exists public.game_results (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  home_score integer not null,
  away_score integer not null,
  status text not null check (status in ('submitted', 'approved', 'rejected', 'superseded')),
  submitted_by uuid,
  submitted_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  rejection_reason text,
  corrected_from_id uuid,
  final_event_seq integer,
  created_at timestamptz not null default now()
);
create index if not exists game_results_game_idx on public.game_results (game_id, created_at);

create table if not exists public.tournament_rounds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  division_id uuid not null,
  round_number integer not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (division_id, round_number)
);

create table if not exists public.bracket_advancements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  division_id uuid not null,
  round_number integer not null,
  slot integer not null,
  source_game_id uuid,
  winner_team_id uuid,
  created_at timestamptz not null default now(),
  unique (division_id, round_number, slot)
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  tournament_id uuid references public.tournaments (id) on delete cascade,
  title text not null,
  body text not null,
  published_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  device_key text not null unique,
  authorized boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Sync idempotency + audit
-- ---------------------------------------------------------------------------

create table if not exists public.sync_operations (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  operation text not null default 'upsert',
  payload jsonb not null,
  idempotency_key text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'pushed', 'synchronized', 'conflicted', 'rejected')),
  attempts integer not null default 0,
  last_error text,
  remote_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_user_id uuid,
  actor_name text,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_org_idx on public.audit_logs (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.tournaments enable row level security;
alter table public.divisions enable row level security;
alter table public.teams enable row level security;
alter table public.tournament_teams enable row level security;
alter table public.players enable row level security;
alter table public.roster_entries enable row level security;
alter table public.venues enable row level security;
alter table public.games enable row level security;
alter table public.game_periods enable row level security;
alter table public.game_clock_states enable row level security;
alter table public.game_events enable row level security;
alter table public.player_game_statistics enable row level security;
alter table public.team_game_statistics enable row level security;
alter table public.game_results enable row level security;
alter table public.tournament_rounds enable row level security;
alter table public.bracket_advancements enable row level security;
alter table public.announcements enable row level security;
alter table public.devices enable row level security;
alter table public.sync_operations enable row level security;
alter table public.audit_logs enable row level security;

-- Profiles: a user reads/updates only their own row; admins may read all.
create policy profiles_self_read on public.profiles
  for select using (id = auth.uid() or public.is_platform_admin());
create policy profiles_self_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Organizations: members, plus public read once a tournament is published.
create policy organizations_member_read on public.organizations
  for select using (
    public.is_org_member(id)
    or exists (select 1 from public.tournaments t where t.organization_id = organizations.id and t.status = 'published')
  );
create policy organizations_admin_write on public.organizations
  for update using (public.has_org_role(id, array['org_admin']))
  with check (public.has_org_role(id, array['org_admin']));
create policy organizations_owner_insert on public.organizations
  for insert with check (auth.uid() is not null);

-- Membership: a member can see their organization's members; only admins write.
create policy members_member_read on public.organization_members
  for select using (public.is_org_member(organization_id));
create policy members_admin_write on public.organization_members
  for all using (public.has_org_role(organization_id, array['org_admin']))
  with check (public.has_org_role(organization_id, array['org_admin']));

-- Tournaments / divisions / teams / venues / games: public when published.
create policy tournaments_public_read on public.tournaments
  for select using (status = 'published' or public.is_org_member(organization_id));
create policy tournaments_manager_write on public.tournaments
  for all using (public.has_org_role(organization_id, array['org_admin', 'tournament_manager']))
  with check (public.has_org_role(organization_id, array['org_admin', 'tournament_manager']));

create policy divisions_read on public.divisions
  for select using (public.is_org_member(organization_id) or public.is_tournament_public(tournament_id));
create policy divisions_write on public.divisions
  for all using (public.has_org_role(organization_id, array['org_admin', 'tournament_manager']))
  with check (public.has_org_role(organization_id, array['org_admin', 'tournament_manager']));

create policy teams_read on public.teams
  for select using (
    public.is_org_member(organization_id)
    or exists (
      select 1 from public.tournament_teams tt
        join public.tournaments t on t.id = tt.tournament_id
       where tt.team_id = teams.id and t.status = 'published'
    )
  );
create policy teams_write on public.teams
  for all using (public.has_org_role(organization_id, array['org_admin', 'tournament_manager', 'registrar']))
  with check (public.has_org_role(organization_id, array['org_admin', 'tournament_manager', 'registrar']));

create policy tournament_teams_read on public.tournament_teams
  for select using (public.is_org_member(organization_id) or public.is_tournament_public(tournament_id));
create policy tournament_teams_write on public.tournament_teams
  for all using (public.has_org_role(organization_id, array['org_admin', 'tournament_manager', 'registrar']))
  with check (public.has_org_role(organization_id, array['org_admin', 'tournament_manager', 'registrar']));

-- Venues: scheduling data, members only.
create policy venues_read on public.venues
  for select using (public.is_org_member(organization_id));
create policy venues_write on public.venues
  for all using (public.has_org_role(organization_id, array['org_admin', 'tournament_manager']))
  with check (public.has_org_role(organization_id, array['org_admin', 'tournament_manager']));

-- Games: public once published so the public scoreboard can read them.
create policy games_read on public.games
  for select using (public.is_org_member(organization_id) or public.is_tournament_public(tournament_id));
create policy games_write on public.games
  for all using (public.has_org_role(organization_id, array['org_admin', 'tournament_manager']))
  with check (public.has_org_role(organization_id, array['org_admin', 'tournament_manager']));

create policy game_periods_read on public.game_periods
  for select using (
    exists (
      select 1 from public.games g
       where g.id = game_periods.game_id
         and (public.is_org_member(g.organization_id) or public.is_tournament_public(g.tournament_id))
    )
  );

create policy game_clock_read on public.game_clock_states
  for select using (
    exists (
      select 1 from public.games g
       where g.id = game_clock_states.game_id
         and (public.is_org_member(g.organization_id) or public.is_tournament_public(g.tournament_id))
    )
  );

create policy game_results_read on public.game_results
  for select using (public.is_org_member(organization_id) or public.is_tournament_public(tournament_id));
create policy game_results_official_write on public.game_results
  for all using (public.has_org_role(organization_id, array['org_admin', 'official']))
  with check (public.has_org_role(organization_id, array['org_admin', 'official']));

-- Events and statistics are operational data: members only, never anon.
create policy game_events_member_read on public.game_events
  for select using (public.is_org_member(organization_id));
create policy game_events_scorer_write on public.game_events
  for all using (public.has_org_role(organization_id, array['org_admin', 'scorer', 'tournament_manager']))
  with check (public.has_org_role(organization_id, array['org_admin', 'scorer', 'tournament_manager']));

create policy player_stats_read on public.player_game_statistics
  for select using (public.is_org_member(organization_id));
create policy team_stats_read on public.team_game_statistics
  for select using (public.is_org_member(organization_id));

create policy rounds_read on public.tournament_rounds
  for select using (public.is_org_member(organization_id) or public.is_tournament_public(tournament_id));
create policy advancements_read on public.bracket_advancements
  for select using (public.is_org_member(organization_id) or public.is_tournament_public(tournament_id));

create policy announcements_read on public.announcements
  for select using (public.is_org_member(organization_id) or public.is_tournament_public(tournament_id));
create policy announcements_write on public.announcements
  for all using (public.has_org_role(organization_id, array['org_admin', 'tournament_manager']))
  with check (public.has_org_role(organization_id, array['org_admin', 'tournament_manager']));

-- Devices, sync queue and audit logs are administrative.
create policy devices_admin on public.devices
  for all using (public.has_org_role(organization_id, array['org_admin']))
  with check (public.has_org_role(organization_id, array['org_admin']));

create policy sync_operations_admin on public.sync_operations
  for all using (public.has_org_role(organization_id, array['org_admin']))
  with check (public.has_org_role(organization_id, array['org_admin']));

create policy audit_read on public.audit_logs
  for select using (public.has_org_role(organization_id, array['org_admin', 'official', 'tournament_manager']));

-- ---------------------------------------------------------------------------
-- Players / rosters: explicit read for members, and column-level grants so anon
-- can read only name + jersey for published tournaments (never birth dates,
-- guardians or contact numbers).
-- ---------------------------------------------------------------------------

create policy players_member_read on public.players
  for select using (public.is_org_member(organization_id));
create policy players_registrar_write on public.players
  for all using (public.has_org_role(organization_id, array['org_admin', 'registrar', 'tournament_manager']))
  with check (public.has_org_role(organization_id, array['org_admin', 'registrar', 'tournament_manager']));

create policy roster_member_read on public.roster_entries
  for select using (public.is_org_member(organization_id));
create policy roster_registrar_write on public.roster_entries
  for all using (public.has_org_role(organization_id, array['org_admin', 'registrar', 'tournament_manager']))
  with check (public.has_org_role(organization_id, array['org_admin', 'registrar', 'tournament_manager']));

-- Public box scores need names and numbers for published tournaments only.
create policy players_public_read on public.players
  for select using (
    exists (
      select 1 from public.roster_entries r
        join public.tournaments t on t.id = r.tournament_id
       where r.player_id = players.id and t.status = 'published'
    )
  );
create policy roster_public_read on public.roster_entries
  for select using (public.is_tournament_public(tournament_id));

-- Supabase provides the `anon` and `authenticated` roles. Guard the grants so
-- this migration also applies cleanly to a plain Postgres instance (CI/tests).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.players from anon;
    grant select (id, full_name) on public.players to anon;
    revoke all on public.roster_entries from anon;
    grant select (id, tournament_id, team_id, player_id, jersey_number, position, eligible)
      on public.roster_entries to anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on all tables in schema public to authenticated;
  end if;
end $$;
