import { getSession } from "@/lib/auth/session";
import { one } from "@/lib/db/sql";
import { isGamePublic } from "@/lib/repos/games";
import { buildScoreboardView } from "@/lib/repos/scoreboard";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events feed for the projector and public live page.
 *
 * Deliberately one-way and local: the projector laptop only needs TCP to the
 * scoring laptop, never the internet. Sends a fresh projection every second so
 * the displayed clock is derived from the server's persisted anchor.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const session = await getSession();
  let organizationId: string | null = null;
  if (session?.organizationId) {
    const owned = one<{ id: string }>("SELECT id FROM games WHERE id = ? AND organization_id = ?", [
      id,
      session.organizationId,
    ]);
    if (owned) organizationId = session.organizationId;
  }

  if (!organizationId && !isGamePublic(id)) {
    return new Response("Not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  let closed = false;
  let interval: ReturnType<typeof setInterval> | null = null;
  let lastPayload = "";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        if (interval) clearInterval(interval);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      send("retry: 2000\n\n");
      send(": connected\n\n");

      const tick = () => {
        if (closed) return;
        try {
          const view = buildScoreboardView({ gameId: id, organizationId });
          const payload = JSON.stringify(view);
          lastPayload = payload;
          send(`data: ${payload}\n\n`);
        } catch {
          close();
        }
      };

      tick();
      interval = setInterval(() => {
        tick();
        // Heartbeat keeps proxies and sleeping laptops from dropping the stream.
        send(`: ping ${lastPayload.length}\n\n`);
      }, 1000);

      request.signal.addEventListener("abort", close);
    },
    cancel() {
      closed = true;
      if (interval) clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
