"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermissionSession } from "@/lib/auth/session";
import { invalid } from "@/lib/domain/errors";
import {
  addRosterEntry,
  createDivision,
  createPlayer,
  createTeam,
  createTournament,
  createVenue,
  registerTeam,
  setRosterLock,
  setTournamentStatus,
  updateRosterEntry,
  updateTournament,
} from "@/lib/repos/tournaments";
import { clearDivisionSchedule, generateDivisionSchedule } from "@/lib/repos/schedule";
import { runFormAction } from "./helpers";

const text = (value: FormDataEntryValue | null, max = 500) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const optional = (value: FormDataEntryValue | null) => {
  const result = text(value);
  return result.length > 0 ? result : null;
};

export async function createTournamentAction(formData: FormData) {
  const session = await requirePermissionSession("tournament.manage");
  return runFormAction(formData, "/dashboard/tournaments", async () => {
    const name = text(formData.get("name"));
    if (!name) throw invalid("Tournament name is required.");

    const format = z
      .enum(["round_robin", "double_round_robin", "single_elimination"])
      .parse(text(formData.get("format")) || "round_robin");

    const tournament = createTournament({
      organizationId: session.organizationId,
      name,
      format,
      sportKey: "basketball",
      location: optional(formData.get("location")),
      startsOn: optional(formData.get("startsOn")),
      endsOn: optional(formData.get("endsOn")),
      description: optional(formData.get("description")),
      ruleset: {
        periodCount: Number(formData.get("periodCount") ?? 4) || 4,
        periodSeconds: (Number(formData.get("periodMinutes") ?? 10) || 10) * 60,
      },
      actor: { userId: session.userId, name: session.userName },
    });

    revalidatePath("/dashboard/tournaments");
    return `Created ${tournament.name}.`;
  });
}

export async function updateTournamentAction(formData: FormData) {
  const session = await requirePermissionSession("tournament.manage");
  const tournamentId = text(formData.get("tournamentId"));
  return runFormAction(formData, `/dashboard/tournaments/${tournamentId}`, async () => {
    updateTournament({
      organizationId: session.organizationId,
      tournamentId,
      patch: {
        name: text(formData.get("name")),
        location: optional(formData.get("location")),
        startsOn: optional(formData.get("startsOn")),
        endsOn: optional(formData.get("endsOn")),
        format: z
          .enum(["round_robin", "double_round_robin", "single_elimination"])
          .optional()
          .parse(optional(formData.get("format")) ?? undefined),
        ruleset: {
          periodCount: Number(formData.get("periodCount") ?? 4) || 4,
          periodSeconds: (Number(formData.get("periodMinutes") ?? 10) || 10) * 60,
          maxPersonalFouls: Number(formData.get("maxPersonalFouls") ?? 5) || 5,
          maxTimeouts: Number(formData.get("maxTimeouts") ?? 5) || 5,
        },
      },
      actor: { userId: session.userId, name: session.userName },
    });
    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    return "Tournament settings updated.";
  });
}

export async function setTournamentStatusAction(formData: FormData) {
  const session = await requirePermissionSession("tournament.manage");
  const tournamentId = text(formData.get("tournamentId"));
  return runFormAction(formData, `/dashboard/tournaments/${tournamentId}`, async () => {
    const status = z.enum(["draft", "published", "archived"]).parse(text(formData.get("status")));
    setTournamentStatus({
      organizationId: session.organizationId,
      tournamentId,
      status,
      actor: { userId: session.userId, name: session.userName },
    });
    revalidatePath("/", "layout");
    return status === "published" ? "Tournament published." : `Tournament ${status}.`;
  });
}

export async function createDivisionAction(formData: FormData) {
  const session = await requirePermissionSession("tournament.manage");
  const tournamentId = text(formData.get("tournamentId"));
  return runFormAction(formData, `/dashboard/tournaments/${tournamentId}`, async () => {
    createDivision({
      organizationId: session.organizationId,
      tournamentId,
      name: text(formData.get("name")),
      ageGroup: optional(formData.get("ageGroup")),
    });
    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    return "Division added.";
  });
}

export async function createVenueAction(formData: FormData) {
  const session = await requirePermissionSession("tournament.manage");
  const tournamentId = text(formData.get("tournamentId"));
  return runFormAction(formData, `/dashboard/tournaments/${tournamentId}`, async () => {
    createVenue({
      organizationId: session.organizationId,
      tournamentId,
      name: text(formData.get("name")),
      address: optional(formData.get("address")),
    });
    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    return "Venue saved.";
  });
}

export async function createTeamAction(formData: FormData) {
  const session = await requirePermissionSession("roster.manage");
  return runFormAction(formData, "/dashboard/teams", async () => {
    createTeam({
      organizationId: session.organizationId,
      name: text(formData.get("name")),
      shortName: optional(formData.get("shortName")),
      color: optional(formData.get("color")),
      contactName: optional(formData.get("contactName")),
      contactPhone: optional(formData.get("contactPhone")),
    });
    revalidatePath("/dashboard/teams");
    return "Team created.";
  });
}

export async function createPlayerAction(formData: FormData) {
  const session = await requirePermissionSession("roster.manage");
  return runFormAction(formData, "/dashboard/teams", async () => {
    createPlayer({
      organizationId: session.organizationId,
      fullName: text(formData.get("fullName")),
      birthDate: optional(formData.get("birthDate")),
      guardianName: optional(formData.get("guardianName")),
      notes: optional(formData.get("notes")),
      actor: { userId: session.userId, name: session.userName },
    });
    revalidatePath("/dashboard/teams");
    return "Player registered.";
  });
}

export async function registerTeamAction(formData: FormData) {
  const session = await requirePermissionSession("roster.manage");
  const tournamentId = text(formData.get("tournamentId"));
  return runFormAction(formData, `/dashboard/tournaments/${tournamentId}`, async () => {
    const divisionId = text(formData.get("divisionId"));
    let teamId = text(formData.get("teamId"));

    // Allow creating a team inline while registering it.
    const newTeamName = text(formData.get("newTeamName"));
    if (!teamId && newTeamName) {
      const team = createTeam({
        organizationId: session.organizationId,
        name: newTeamName,
        shortName: optional(formData.get("newTeamShortName")),
      });
      teamId = team.id;
    }
    if (!teamId) throw invalid("Choose a team or name a new one.");

    registerTeam({
      organizationId: session.organizationId,
      tournamentId,
      divisionId,
      teamId,
      seed: formData.get("seed") ? Number(formData.get("seed")) : null,
    });

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    return "Team registered.";
  });
}

export async function addRosterAction(formData: FormData) {
  const session = await requirePermissionSession("roster.manage");
  const tournamentId = text(formData.get("tournamentId"));
  return runFormAction(formData, `/dashboard/tournaments/${tournamentId}`, async () => {
    let playerId = text(formData.get("playerId"));
    const newPlayerName = text(formData.get("newPlayerName"));

    if (!playerId && newPlayerName) {
      const player = createPlayer({
        organizationId: session.organizationId,
        fullName: newPlayerName,
        actor: { userId: session.userId, name: session.userName },
      });
      playerId = player.id;
    }
    if (!playerId) throw invalid("Choose a player or enter a new one.");

    addRosterEntry({
      organizationId: session.organizationId,
      tournamentId,
      teamId: text(formData.get("teamId")),
      playerId,
      jerseyNumber: Number(formData.get("jerseyNumber")),
      position: optional(formData.get("position")),
      actor: { userId: session.userId, name: session.userName },
    });

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    return "Player added to the roster.";
  });
}

export async function updateRosterEntryAction(formData: FormData) {
  const session = await requirePermissionSession("roster.manage");
  const tournamentId = text(formData.get("tournamentId"));
  return runFormAction(formData, `/dashboard/tournaments/${tournamentId}`, async () => {
    updateRosterEntry({
      organizationId: session.organizationId,
      entryId: text(formData.get("entryId")),
      patch: {
        jerseyNumber: formData.get("jerseyNumber") ? Number(formData.get("jerseyNumber")) : undefined,
        status: formData.get("status")
          ? z.enum(["pending", "active", "inactive"]).parse(text(formData.get("status")))
          : undefined,
        eligible: formData.get("eligible") ? formData.get("eligible") === "1" : undefined,
      },
      actor: { userId: session.userId, name: session.userName },
    });
    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    return "Roster updated.";
  });
}

export async function setRosterLockAction(formData: FormData) {
  const session = await requirePermissionSession("tournament.manage");
  const tournamentId = text(formData.get("tournamentId"));
  return runFormAction(formData, `/dashboard/tournaments/${tournamentId}`, async () => {
    setRosterLock({
      organizationId: session.organizationId,
      tournamentId,
      locked: text(formData.get("locked")) === "1",
      reason: optional(formData.get("reason")) ?? undefined,
      actor: { userId: session.userId, name: session.userName },
    });
    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    return text(formData.get("locked")) === "1" ? "Roster locked." : "Roster unlocked.";
  });
}

export async function generateScheduleAction(formData: FormData) {
  const session = await requirePermissionSession("tournament.manage");
  const tournamentId = text(formData.get("tournamentId"));
  return runFormAction(formData, `/dashboard/tournaments/${tournamentId}`, async () => {
    const result = generateDivisionSchedule({
      organizationId: session.organizationId,
      tournamentId,
      divisionId: text(formData.get("divisionId")),
      startAt: optional(formData.get("startAt")),
      intervalMinutes: Number(formData.get("intervalMinutes") ?? 60) || 60,
      venueId: optional(formData.get("venueId")),
      actor: { userId: session.userId, name: session.userName },
    });

    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    const suffix = result.conflicts.length
      ? ` ${result.conflicts.length} scheduling conflict(s) flagged.`
      : "";
    return `Scheduled ${result.created} game(s)${result.byes ? `, ${result.byes} bye(s)` : ""}.${suffix}`;
  });
}

export async function clearScheduleAction(formData: FormData) {
  const session = await requirePermissionSession("tournament.manage");
  const tournamentId = text(formData.get("tournamentId"));
  return runFormAction(formData, `/dashboard/tournaments/${tournamentId}`, async () => {
    const removed = clearDivisionSchedule({
      organizationId: session.organizationId,
      divisionId: text(formData.get("divisionId")),
      actor: { userId: session.userId, name: session.userName },
    });
    revalidatePath(`/dashboard/tournaments/${tournamentId}`);
    return `Cleared ${removed} scheduled game(s).`;
  });
}
