import { AppError, isAppError } from "../domain/errors";

export function jsonOk(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, { status: 200, ...init });
}

export function jsonError(error: unknown): Response {
  if (isAppError(error)) {
    return Response.json(
      { error: error.message, code: error.code, details: error.details ?? null },
      { status: error.status },
    );
  }
  console.error("[api] unhandled error", error);
  return Response.json({ error: "Something went wrong.", code: "internal" }, { status: 500 });
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") throw new AppError("validation", "Expected a JSON object body.");
    return body as T;
  } catch (error) {
    if (isAppError(error)) throw error;
    throw new AppError("validation", "Request body must be valid JSON.");
  }
}

/**
 * Cross-site request forgery guard for cookie-authenticated mutations.
 * Same-origin fetches from the app carry a matching Origin header; a hidden
 * button in another site does not.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return; // same-origin form posts may omit Origin
  const host = request.headers.get("host");
  try {
    if (host && new URL(origin).host !== host) {
      throw new AppError("forbidden", "Cross-origin requests are not allowed.");
    }
  } catch (error) {
    if (isAppError(error)) throw error;
    throw new AppError("forbidden", "Invalid request origin.");
  }
}

export function clientKey(request: Request, suffix = ""): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  return `${ip}${suffix ? `:${suffix}` : ""}`;
}
