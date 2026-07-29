import { describe, expect, it } from "vitest";
import { isMemberParticipantRole, isPasswordResetApproverRole, memberParticipantRoles } from "@/lib/member-roles";

describe("成员与审核员角色", () => {
  it("keeps reviewers in every member-participant audience", () => {
    expect(memberParticipantRoles).toEqual(["MEMBER", "REVIEWER"]);
    expect(isMemberParticipantRole("MEMBER")).toBe(true);
    expect(isMemberParticipantRole("REVIEWER")).toBe(true);
    expect(isMemberParticipantRole("ADMIN")).toBe(false);
  });

  it("limits password reset approval to reviewers and administrators", () => {
    expect(isPasswordResetApproverRole("MEMBER")).toBe(false);
    expect(isPasswordResetApproverRole("REVIEWER")).toBe(true);
    expect(isPasswordResetApproverRole("ADMIN")).toBe(true);
  });
});
