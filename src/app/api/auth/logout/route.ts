import { destroySession } from "@/lib/auth/session";
import { assertSameOrigin, jsonError, jsonOk } from "@/lib/api/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await destroySession();
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
