import { AppError, invalid, notFound } from "../domain/errors";
import { newId, nowIso, slugify } from "../domain/ids";
import { all, one, run } from "../db/sql";
import { normalizeRoles, type Role } from "../auth/rbac";
import { recordAudit } from "./audit";

export type Organization = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  location: string | null;
  contactEmail: string | null;
  createdAt: string;
};

type OrgRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  location: string | null;
  contact_email: string | null;
  created_at: string;
};

function mapOrg(row: OrgRow): Organization {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    location: row.location,
    contactEmail: row.contact_email,
    createdAt: row.created_at,
  };
}

export function getOrganizationBySlug(slug: string): Organization | null {
  const row = one<OrgRow>("SELECT * FROM organizations WHERE slug = ?", [slug]);
  return row ? mapOrg(row) : null;
}

export function getOrganizationById(id: string): Organization | null {
  const row = one<OrgRow>("SELECT * FROM organizations WHERE id = ?", [id]);
  return row ? mapOrg(row) : null;
}

export function listPublicOrganizations(): (Organization & { tournamentCount: number })[] {
  const rows = all<OrgRow & { tournament_count: number }>(
    `SELECT o.*, COUNT(t.id) AS tournament_count
       FROM organizations o
       LEFT JOIN tournaments t ON t.organization_id = o.id AND t.status = 'published'
      GROUP BY o.id
      HAVING tournament_count > 0
      ORDER BY o.name`,
  );
  return rows.map((row) => ({ ...mapOrg(row), tournamentCount: row.tournament_count }));
}

export function createOrganization(input: {
  name: string;
  slug?: string;
  description?: string;
  location?: string;
  contactEmail?: string;
  ownerUserId: string;
  ownerName: string;
}): Organization {
  const name = input.name.trim();
  if (name.length < 2) throw invalid("Organization name is too short.");

  let slug = slugify(input.slug?.trim() || name);
  if (!slug) slug = `org-${Math.random().toString(36).slice(2, 8)}`;

  const existing = one<{ id: string }>("SELECT id FROM organizations WHERE slug = ?", [slug]);
  if (existing) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  const id = newId("org");
  const now = nowIso();

  run(
    `INSERT INTO organizations (id, slug, name, description, location, contact_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, slug, name, input.description ?? null, input.location ?? null, input.contactEmail ?? null, now, now],
  );

  run(
    `INSERT INTO organization_members (id, organization_id, user_id, roles, status, created_at)
     VALUES (?, ?, ?, ?, 'active', ?)`,
    [newId("mem"), id, input.ownerUserId, JSON.stringify(["org_admin"]), now],
  );

  recordAudit({
    organizationId: id,
    actorUserId: input.ownerUserId,
    actorName: input.ownerName,
    action: "organization.created",
    entityType: "organization",
    entityId: id,
    after: { name, slug },
  });

  return getOrganizationById(id)!;
}

export function updateOrganization(
  organizationId: string,
  input: { name?: string; description?: string | null; location?: string | null; contactEmail?: string | null },
  actor: { userId: string; name: string },
): void {
  const before = getOrganizationById(organizationId);
  if (!before) throw notFound("Organization");

  run(
    `UPDATE organizations SET name = ?, description = ?, location = ?, contact_email = ?, updated_at = ? WHERE id = ?`,
    [
      input.name?.trim() || before.name,
      input.description ?? before.description,
      input.location ?? before.location,
      input.contactEmail ?? before.contactEmail,
      nowIso(),
      organizationId,
    ],
  );

  recordAudit({
    organizationId,
    actorUserId: actor.userId,
    actorName: actor.name,
    action: "organization.updated",
    entityType: "organization",
    entityId: organizationId,
    before: { name: before.name, description: before.description, location: before.location },
    after: input,
  });
}

export type Member = {
  id: string;
  userId: string;
  name: string;
  email: string;
  roles: Role[];
  status: "active" | "suspended";
  createdAt: string;
};

export function listMembers(organizationId: string): Member[] {
  const rows = all<{
    id: string;
    user_id: string;
    name: string;
    email: string;
    roles: string;
    status: "active" | "suspended";
    created_at: string;
  }>(
    `SELECT m.id, m.user_id, u.name, u.email, m.roles, m.status, m.created_at
       FROM organization_members m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ? ORDER BY u.name`,
    [organizationId],
  );

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    roles: normalizeRoles(JSON.parse(row.roles)),
    status: row.status,
    createdAt: row.created_at,
  }));
}

export function addMember(input: {
  organizationId: string;
  email: string;
  roles: Role[];
  actor: { userId: string; name: string };
}): Member {
  const email = input.email.trim().toLowerCase();
  const user = one<{ id: string; name: string }>("SELECT id, name FROM users WHERE email = ?", [email]);
  if (!user) {
    throw new AppError(
      "not_found",
      "No account uses that email yet. Ask them to register first, then add them here.",
    );
  }

  const existing = one<{ id: string }>(
    "SELECT id FROM organization_members WHERE organization_id = ? AND user_id = ?",
    [input.organizationId, user.id],
  );
  if (existing) throw new AppError("conflict", "That person is already a member of this organization.");

  run(
    `INSERT INTO organization_members (id, organization_id, user_id, roles, status, created_at)
     VALUES (?, ?, ?, ?, 'active', ?)`,
    [newId("mem"), input.organizationId, user.id, JSON.stringify(normalizeRoles(input.roles)), nowIso()],
  );

  recordAudit({
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
    actorName: input.actor.name,
    action: "member.added",
    entityType: "organization_member",
    entityId: user.id,
    after: { email, roles: input.roles },
  });

  return listMembers(input.organizationId).find((member) => member.userId === user.id)!;
}

export function updateMemberRoles(input: {
  organizationId: string;
  memberId: string;
  roles: Role[];
  actor: { userId: string; name: string };
}): void {
  const member = one<{ user_id: string; roles: string }>(
    "SELECT user_id, roles FROM organization_members WHERE id = ? AND organization_id = ?",
    [input.memberId, input.organizationId],
  );
  if (!member) throw notFound("Member");

  const roles = normalizeRoles(input.roles);
  if (roles.length === 0) throw invalid("A member needs at least one role.");

  // Never allow the last administrator of an organization to be demoted.
  if (!roles.includes("org_admin")) {
    const admins = one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM organization_members
        WHERE organization_id = ? AND status = 'active' AND roles LIKE '%org_admin%' AND id <> ?`,
      [input.organizationId, input.memberId],
    );
    if (!admins || admins.n === 0) throw invalid("An organization must keep at least one administrator.");
  }

  run("UPDATE organization_members SET roles = ? WHERE id = ?", [JSON.stringify(roles), input.memberId]);

  recordAudit({
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
    actorName: input.actor.name,
    action: "member.roles_changed",
    entityType: "organization_member",
    entityId: input.memberId,
    before: { roles: JSON.parse(member.roles) },
    after: { roles },
  });
}

export function setMemberStatus(input: {
  organizationId: string;
  memberId: string;
  status: "active" | "suspended";
  actor: { userId: string; name: string };
}): void {
  const member = one<{ status: string }>(
    "SELECT status FROM organization_members WHERE id = ? AND organization_id = ?",
    [input.memberId, input.organizationId],
  );
  if (!member) throw notFound("Member");

  run("UPDATE organization_members SET status = ? WHERE id = ?", [input.status, input.memberId]);

  recordAudit({
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
    actorName: input.actor.name,
    action: "member.status_changed",
    entityType: "organization_member",
    entityId: input.memberId,
    before: { status: member.status },
    after: { status: input.status },
  });
}
