import type { Role } from "@prisma/client";

export const memberParticipantRoles: Role[] = ["MEMBER", "REVIEWER"];

export function isMemberParticipantRole(role: Role | string) {
  return role === "MEMBER" || role === "REVIEWER";
}

export function isPasswordResetApproverRole(role: Role | string) {
  return role === "REVIEWER" || role === "ADMIN";
}

export function isVideoReviewOperatorRole(role: Role | string) {
  return role === "REVIEWER" || role === "ADMIN";
}
