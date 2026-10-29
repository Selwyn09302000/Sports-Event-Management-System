import { z } from "zod";
import { clientKey, jsonError, jsonOk, readJson, assertSameOrigin } from "@/lib/api/http";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, listUserOrganizations } from "@/lib/auth/session";
import { one } from "@/lib/db/sql";
import { AppError } from "@/lib/domain/errors";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    enforceRateLimit(`login:${clientKey(request)}`, { limit: 10, windowMs: 5 * 60_000 });

    const body = schema.parse(await readJson(request));
    const user = one<{ id: string; name: string; password_hash: string }>(
      "SELECT id, name, password_hash FROM users WHERE email = ?",
      [body.email],
    );

    // Constant-ish response regardless of which half failed.
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      throw new AppError("unauthorized", "Email or password is incorrect.");
    }

    const organizations = listUserOrganizations(user.id);
    await createSession(user.id, organizations[0]?.id ?? null);

    return jsonOk({
      ok: true,
      redirectTo: organizations.length > 0 ? "/dashboard" : "/dashboard/organizations",
      user: { name: user.name },
    });
  } catch (error) {
    return jsonError(error);
  }
}
