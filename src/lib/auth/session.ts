import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { AppError } from "../domain/errors";
import { newId, nowIso } from "../domain/ids";
import { getDb } from "../db/client";
import { one, run } from "../db/sql";
import { normalizeRoles, requirePermission, type Permission, type Role } from "./rbac";

export const SESSION_COOKIE = "sem_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export type SessionContext = {
  userId: string;
  userName: string;
  email: string;
  organizationId: string | null;
  organizationSlug: string | null;
  organizationName: string | null;
  roles: Role[];
};

type SessionRow = {
  user_id: string;
  name: string;
  email: string;
  active_organization_id: string | null;
  expires_at: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieSecure(): boolean {
  // The gym deployment is plain HTTP on the LAN, where a Secure cookie would
  // be dropped by the browser. Enable COOKIE_SECURE=true for HTTPS hosting.
  return process.env.COOKIE_SECURE === "true";
}

export async function createSession(userId: string, organizationId: string | null): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);

  run(
    `INSERT INTO sessions (token_hash, user_id, active_organization_id, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [hashToken(token), userId, organizationId, now.toISOString(), now.toISOString(), expires.toISOString()],
  );

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    expires,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) run("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);
  store.delete(SESSION_COOKIE);
}

function loadContext(token: string): SessionContext | null {
  const session = one<SessionRow>(
    `SELECT s.user_id, u.name, u.email, s.active_organization_id, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    [hashToken(token)],
  );
  if (!session) return null;

  if (Date.parse(session.expires_at) < Date.now()) {
    run("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);
    return null;
  }

  run("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", [nowIso(), hashToken(token)]);

  if (!session.active_organization_id) {
    return {
      userId: session.user_id,
      userName: session.name,
      email: session.email,
      organizationId: null,
      organizationSlug: null,
      organizationName: null,
      roles: [],
    };
  }

  const membership = one<{ roles: string; slug: string; name: string; status: string }>(
    `SELECT m.roles, o.slug, o.name, m.status
       FROM organization_members m JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ? AND m.organization_id = ?`,
    [session.user_id, session.active_organization_id],
  );

  // A revoked or suspended membership must not keep working.
  if (!membership || membership.status !== "active") return null;

  return {
    userId: session.user_id,
    userName: session.name,
    email: session.email,
    organizationId: session.active_organization_id,
    organizationSlug: membership.slug,
    organizationName: membership.name,
    roles: normalizeRoles(JSON.parse(membership.roles)),
  };
}

export async function getSession(): Promise<SessionContext | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return loadContext(token);
}

export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) throw new AppError("unauthorized", "Sign in to continue.");
  return session;
}

export type OrgSession = SessionContext & { organizationId: string; organizationSlug: string };

export async function requireOrganization(): Promise<OrgSession> {
  const session = await requireSession();
  if (!session.organizationId || !session.organizationSlug) {
    throw new AppError("forbidden", "Select an organization first.");
  }
  return session as OrgSession;
}

export async function requirePermissionSession(permission: Permission): Promise<OrgSession> {
  const session = await requireOrganization();
  requirePermission(session.roles, permission);
  return session;
}

export async function switchOrganization(organizationId: string): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) throw new AppError("unauthorized", "Sign in to continue.");

  const session = loadContext(token);
  if (!session) throw new AppError("unauthorized", "Your session has expired.");

  const membership = one<{ id: string }>(
    "SELECT id FROM organization_members WHERE user_id = ? AND organization_id = ? AND status = 'active'",
    [session.userId, organizationId],
  );
  if (!membership) throw new AppError("forbidden", "You are not a member of that organization.");

  run("UPDATE sessions SET active_organization_id = ? WHERE token_hash = ?", [
    organizationId,
    hashToken(token),
  ]);
}

export function listUserOrganizations(userId: string): { id: string; slug: string; name: string }[] {
  return getDb()
    .prepare(
      `SELECT o.id, o.slug, o.name FROM organization_members m
         JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = ? AND m.status = 'active' ORDER BY o.name`,
    )
    .all(userId) as { id: string; slug: string; name: string }[];
}

export function createUser(input: { email: string; name: string; passwordHash: string }): string {
  const id = newId("usr");
  const now = nowIso();
  run("INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [
    id,
    input.email.trim().toLowerCase(),
    input.name.trim(),
    input.passwordHash,
    now,
    now,
  ]);
  return id;
}
