import { forbidden } from "../domain/errors";

export const ROLES = [
  "platform_admin",
  "org_admin",
  "tournament_manager",
  "registrar",
  "scorer",
  "statistician",
  "official",
  "team_manager",
  "viewer",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  platform_admin: "Platform Super Admin",
  org_admin: "Organization Administrator",
  tournament_manager: "Tournament Manager",
  registrar: "Registrar",
  scorer: "Scorer",
  statistician: "Statistics Recorder",
  official: "Approving Official",
  team_manager: "Team Manager",
  viewer: "Viewer",
};

export const PERMISSIONS = [
  "org.manage",
  "member.manage",
  "tournament.manage",
  "roster.manage",
  "game.score",
  "stats.record",
  "game.review",
  "result.approve",
  "sync.manage",
  "audit.read",
  "device.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ORG_ADMIN_PERMISSIONS: Permission[] = [...PERMISSIONS];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  platform_admin: [...PERMISSIONS],
  org_admin: ORG_ADMIN_PERMISSIONS,
  tournament_manager: ["tournament.manage", "roster.manage", "game.score", "stats.record", "audit.read"],
  registrar: ["roster.manage"],
  scorer: ["game.score", "stats.record"],
  statistician: ["stats.record"],
  official: ["game.review", "result.approve", "audit.read"],
  team_manager: ["roster.manage"],
  viewer: [],
};

export function permissionsFor(roles: Role[]): Set<Permission> {
  const result = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) result.add(permission);
  }
  return result;
}

export function hasPermission(roles: Role[], permission: Permission): boolean {
  return permissionsFor(roles).has(permission);
}

export function requirePermission(roles: Role[], permission: Permission): void {
  if (!hasPermission(roles, permission)) {
    throw forbidden(`Your role does not allow "${permission}".`);
  }
}

export function normalizeRoles(input: unknown): Role[] {
  if (!Array.isArray(input)) return [];
  const valid = new Set<string>(ROLES);
  return [...new Set(input.filter((role): role is Role => typeof role === "string" && valid.has(role)))];
}

/** Roles that may be granted by an organization administrator. */
export const ASSIGNABLE_ROLES: Role[] = ROLES.filter((role) => role !== "platform_admin");
