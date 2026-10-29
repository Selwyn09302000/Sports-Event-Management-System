import { redirect } from "next/navigation";
import { isAppError } from "@/lib/domain/errors";

/** Only allow internal redirects, never an attacker-supplied absolute URL. */
export function safeReturnTo(value: FormDataEntryValue | null, fallback: string): string {
  const raw = typeof value === "string" ? value : "";
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}

function withQuery(path: string, key: string, message: string): string {
  const [base, existing] = path.split("?");
  const params = new URLSearchParams(existing ?? "");
  params.set(key, message);
  return `${base}?${params.toString()}`;
}

/**
 * Runs an admin action and redirects with a human-readable result. Redirects
 * happen outside the try block so Next's internal redirect signal is never
 * swallowed.
 */
export async function runFormAction(
  formData: FormData,
  fallback: string,
  action: () => Promise<string | void> | string | void,
): Promise<never> {
  const returnTo = safeReturnTo(formData.get("returnTo"), fallback);
  let error: string | null = null;
  let notice: string | null = null;

  try {
    const result = await action();
    notice = typeof result === "string" ? result : "Saved.";
  } catch (caught) {
    if (isAppError(caught)) {
      error = caught.message;
    } else {
      console.error("[action] failed", caught);
      error = (caught as Error).message ?? "Something went wrong.";
    }
  }

  if (error) redirect(withQuery(returnTo, "error", error));
  redirect(withQuery(returnTo, "notice", notice ?? "Saved."));
}
