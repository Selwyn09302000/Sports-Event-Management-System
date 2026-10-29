"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganization, requirePermissionSession, requireSession } from "@/lib/auth/session";
import { normalizeRoles, type Role } from "@/lib/auth/rbac";
import { invalid } from "@/lib/domain/errors";
import { addMember, createOrganization, setMemberStatus, updateMemberRoles, updateOrganization } from "@/lib/repos/orgs";
import { runFormAction } from "./helpers";
import { redirect } from "next/navigation";

export async function updateOrganizationAction(formData: FormData) {
  const session = await requirePermissionSession("org.manage");
  return runFormAction(formData, "/dashboard/settings", async () => {
    updateOrganization(
      session.organizationId,
      {
        name: typeof formData.get("name") === "string" ? String(formData.get("name")) : undefined,
        description: formData.get("description") ? String(formData.get("description")) : null,
        location: formData.get("location") ? String(formData.get("location")) : null,
        contactEmail: formData.get("contactEmail") ? String(formData.get("contactEmail")) : null,
      },
      { userId: session.userId, name: session.userName },
    );
    revalidatePath("/", "layout");
    return "Organization profile updated.";
  });
}

export async function addMemberAction(formData: FormData) {
  const session = await requirePermissionSession("member.manage");
  const roles = normalizeRoles(formData.getAll("roles").map(String));
  return runFormAction(formData, "/dashboard/members", async () => {
    if (roles.length === 0) throw invalid("Pick at least one role.");
    addMember({
      organizationId: session.organizationId,
      email: String(formData.get("email") ?? ""),
      roles,
      actor: { userId: session.userId, name: session.userName },
    });
    revalidatePath("/dashboard/members");
    return "Member added.";
  });
}

export async function updateMemberRolesAction(formData: FormData) {
  const session = await requirePermissionSession("member.manage");
  return runFormAction(formData, "/dashboard/members", async () => {
    const roles = normalizeRoles(formData.getAll("roles").map(String)) as Role[];
    updateMemberRoles({
      organizationId: session.organizationId,
      memberId: String(formData.get("memberId") ?? ""),
      roles,
      actor: { userId: session.userId, name: session.userName },
    });
    revalidatePath("/dashboard/members");
    return "Roles updated.";
  });
}

export async function setMemberStatusAction(formData: FormData) {
  const session = await requirePermissionSession("member.manage");
  return runFormAction(formData, "/dashboard/members", async () => {
    const status = z.enum(["active", "suspended"]).parse(String(formData.get("status") ?? ""));
    setMemberStatus({
      organizationId: session.organizationId,
      memberId: String(formData.get("memberId") ?? ""),
      status,
      actor: { userId: session.userId, name: session.userName },
    });
    revalidatePath("/dashboard/members");
    return status === "active" ? "Member reactivated." : "Member suspended.";
  });
}

export async function createOrganizationForUserAction(formData: FormData) {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) redirect("/dashboard/organizations?error=Enter+an+organization+name");

  const organization = createOrganization({
    name,
    location: String(formData.get("location") ?? "") || undefined,
    ownerUserId: session.userId,
    ownerName: session.userName,
  });

  const { switchOrganization } = await import("@/lib/auth/session");
  await switchOrganization(organization.id);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function switchToOrganizationAction(formData: FormData) {
  await requireOrganization().catch(() => null);
  const { switchOrganization } = await import("@/lib/auth/session");
  const organizationId = String(formData.get("organizationId") ?? "");
  if (organizationId) await switchOrganization(organizationId);
  redirect("/dashboard");
}
