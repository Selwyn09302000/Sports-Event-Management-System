/**
 * Cloud push transport.
 *
 * The local SQLite database is authoritative. This transport only *sends*
 * confirmed facts to Supabase; it never pulls game state back over an
 * unsynchronized local record. Service-role credentials stay on the server.
 */

export type SyncPushItem = {
  operationId: string;
  entityType: string;
  entityId: string;
  operation: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
};

export type SyncPushOutcome = "synchronized" | "conflicted" | "rejected" | "pending";

export type SyncPushResult = {
  operationId: string;
  status: SyncPushOutcome;
  error?: string | null;
  confirmedAt?: string | null;
};

export interface SyncTransport {
  readonly name: string;
  readonly enabled: boolean;
  push(items: SyncPushItem[]): Promise<SyncPushResult[]>;
}

class DisabledTransport implements SyncTransport {
  readonly name = "disabled";
  readonly enabled = false;

  async push(items: SyncPushItem[]): Promise<SyncPushResult[]> {
    return items.map((item) => ({
      operationId: item.operationId,
      status: "pending",
      error: "Cloud sync is not configured. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SYNC_ENABLED=true.",
    }));
  }
}

type SupabaseConfig = { url: string; serviceRoleKey: string };

function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) return null;
  if (process.env.SYNC_ENABLED !== "true") return null;
  return { url: url.replace(/\/$/, ""), serviceRoleKey };
}

class SupabaseTransport implements SyncTransport {
  readonly name = "supabase";
  readonly enabled = true;

  constructor(private readonly config: SupabaseConfig) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.config.serviceRoleKey,
      Authorization: `Bearer ${this.config.serviceRoleKey}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  async push(items: SyncPushItem[]): Promise<SyncPushResult[]> {
    const results: SyncPushResult[] = [];
    for (const item of items) {
      results.push(await this.pushOne(item));
    }
    return results;
  }

  private async pushOne(item: SyncPushItem): Promise<SyncPushResult> {
    try {
      switch (item.entityType) {
        case "game_event":
          return await this.insertEvent(item);
        case "game_event_void":
          return await this.voidEvent(item);
        case "game_result":
          return await this.insertResult(item);
        default:
          return {
            operationId: item.operationId,
            status: "rejected",
            error: `Unsupported sync entity type: ${item.entityType}`,
          };
      }
    } catch (error) {
      // Network failures are retryable; do not mark them rejected.
      return {
        operationId: item.operationId,
        status: "pending",
        error: `Network error: ${(error as Error).message}`,
      };
    }
  }

  private async insertEvent(item: SyncPushItem): Promise<SyncPushResult> {
    const payload = item.payload;
    const body = {
      id: payload.eventId,
      organization_id: payload.organizationId,
      tournament_id: payload.tournamentId,
      game_id: payload.gameId,
      team_id: payload.teamId,
      player_id: payload.playerId,
      event_type: payload.eventType,
      period: payload.period,
      clock_seconds_remaining: payload.clockSecondsRemaining,
      occurred_at: payload.occurredAt,
      recorded_by: payload.recordedBy,
      device_id: payload.deviceId,
      payload: payload.payload,
      schema_version: payload.schemaVersion ?? 1,
      seq: payload.seq,
      sync_status: "synchronized",
    };

    const response = await fetch(`${this.config.url}/rest/v1/game_events`, {
      method: "POST",
      headers: this.headers({
        // The event id is the primary key: a retry cannot create a duplicate.
        Prefer: "resolution=ignore-duplicates,return=minimal",
      }),
      body: JSON.stringify(body),
    });

    if (response.ok) {
      return {
        operationId: item.operationId,
        status: "synchronized",
        confirmedAt: new Date().toISOString(),
      };
    }
    if (response.status === 409) {
      return { operationId: item.operationId, status: "conflicted", error: "Cloud already holds a different record for this event." };
    }
    if (response.status >= 500) {
      return { operationId: item.operationId, status: "pending", error: `Cloud returned ${response.status}.` };
    }
    return {
      operationId: item.operationId,
      status: "rejected",
      error: `Cloud rejected the event (${response.status}): ${truncate(await response.text())}`,
    };
  }

  private async voidEvent(item: SyncPushItem): Promise<SyncPushResult> {
    const payload = item.payload;
    const response = await fetch(
      `${this.config.url}/rest/v1/game_events?id=eq.${encodeURIComponent(String(payload.eventId))}`,
      {
        method: "PATCH",
        headers: this.headers({ Prefer: "return=minimal" }),
        body: JSON.stringify({
          voided_at: payload.voidedAt,
          voided_by: payload.voidedBy,
          void_reason: payload.reason,
          sync_status: "synchronized",
        }),
      },
    );

    if (response.ok) {
      return { operationId: item.operationId, status: "synchronized", confirmedAt: new Date().toISOString() };
    }
    if (response.status >= 500) {
      return { operationId: item.operationId, status: "pending", error: `Cloud returned ${response.status}.` };
    }
    return {
      operationId: item.operationId,
      status: "rejected",
      error: `Cloud rejected the void (${response.status}): ${truncate(await response.text())}`,
    };
  }

  private async insertResult(item: SyncPushItem): Promise<SyncPushResult> {
    const payload = item.payload;

    // Guard against a cloud record silently replacing a different result.
    const existing = await fetch(
      `${this.config.url}/rest/v1/game_results?game_id=eq.${encodeURIComponent(String(payload.gameId))}&status=eq.approved&select=home_score,away_score`,
      { headers: this.headers() },
    );

    if (existing.ok) {
      const rows = (await existing.json()) as { home_score: number; away_score: number }[];
      const conflict = rows.find(
        (row) => row.home_score !== payload.homeScore || row.away_score !== payload.awayScore,
      );
      if (conflict) {
        return {
          operationId: item.operationId,
          status: "conflicted",
          error: "The cloud already holds a different approved result for this game. Reconcile before retrying.",
        };
      }
    }

    const response = await fetch(`${this.config.url}/rest/v1/game_results`, {
      method: "POST",
      headers: this.headers({ Prefer: "resolution=ignore-duplicates,return=minimal" }),
      body: JSON.stringify({
        id: payload.resultId,
        organization_id: payload.organizationId,
        tournament_id: payload.tournamentId,
        game_id: payload.gameId,
        home_score: payload.homeScore,
        away_score: payload.awayScore,
        status: "approved",
        submitted_by: payload.submittedBy,
        submitted_at: payload.submittedAt,
        approved_by: payload.approvedBy,
        approved_at: payload.approvedAt,
      }),
    });

    if (response.ok) {
      return { operationId: item.operationId, status: "synchronized", confirmedAt: new Date().toISOString() };
    }
    if (response.status === 409) {
      return { operationId: item.operationId, status: "conflicted", error: "Duplicate approved result detected." };
    }
    return {
      operationId: item.operationId,
      status: "pending",
      error: `Cloud returned ${response.status}: ${truncate(await response.text())}`,
    };
  }
}

function truncate(value: string, max = 300): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function getSyncTransport(): SyncTransport {
  const config = supabaseConfig();
  return config ? new SupabaseTransport(config) : new DisabledTransport();
}

export function syncConfigured(): boolean {
  return supabaseConfig() !== null;
}
