"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { createSession, createUser, destroySession, getSession, switchOrganization } from "@/lib/auth/session";
import { one } from "@/lib/db/sql";
import { transaction } from "@/lib/db/client";
import { createOrganization } from "@/lib/repos/orgs";

const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(10, "Use at least 10 characters."),
  organizationName: z.string().trim().min(2, "Enter your organization name.").max(120),
  location: z.string().trim().max(160).optional(),
});

export async function registerAction(formData: FormData) {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    organizationName: formData.get("organizationName"),
    location: formData.get("location") || undefined,
  });

  if (!parsed.success) {
    redirect(`/register?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check your details.")}`);
  }

  const strength = validatePasswordStrength(parsed.data.password);
  if (strength) {
    redirect(`/register?error=${encodeURIComponent(strength)}`);
  }

  const existing = one<{ id: string }>("SELECT id FROM users WHERE email = ?", [parsed.data.email]);
  if (existing) {
    redirect(`/register?error=${encodeURIComponent("An account already uses that email. Sign in instead.")}`);
  }

  let userId: string;
  try {
    userId = transaction(() => {
      const id = createUser({
        email: parsed.data.email,
        name: parsed.data.name,
        passwordHash: hashPassword(parsed.data.password),
      });
      createOrganization({
        name: parsed.data.organizationName,
        location: parsed.data.location,
        ownerUserId: id,
        ownerName: parsed.data.name,
      });
      return id;
    });
  } catch (error) {
    console.error("[register] failed", error);
    redirect(`/register?error=${encodeURIComponent("Could not create the account. Try again.")}`);
  }

  const organization = one<{ id: string }>(
    `SELECT o.id FROM organizations o
       JOIN organization_members m ON m.organization_id = o.id
      WHERE m.user_id = ? ORDER BY o.created_at LIMIT 1`,
    [userId],
  );

  await createSession(userId, organization?.id ?? null);
  redirect("/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function switchOrganizationAction(formData: FormData) {
  const organizationId = String(formData.get("organizationId") ?? "");
  if (!organizationId) return;
  await switchOrganization(organizationId);
  redirect("/dashboard");
}

export async function requireSessionOrRedirect() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
