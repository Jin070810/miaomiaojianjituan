import { describe, expect, it } from "vitest";
import { historicalAuthorIssues } from "@/lib/video-author-audit";

const video = { userId: "member", fetchedAuthorUid: "uid", authorEvidenceVersion: 1, verifiedBindingId: "binding" };
const binding = { id: "binding", userId: "member", platform: "kuaishou", authorUid: "uid", revokedAt: new Date() };

describe("historical video author audit", () => {
  it("preserves evidence for historical credit after binding revocation", () => {
    expect(historicalAuthorIssues(video, "kuaishou", "uid", binding)).toEqual([]);
  });
  it("reports missing historical evidence without inferring it from today's author", () => {
    expect(historicalAuthorIssues({ ...video, fetchedAuthorUid: null, verifiedBindingId: null }, "kuaishou", "uid", binding)).toEqual(["legacy-author-evidence-unavailable"]);
  });
  it("separates missing fetch evidence, changed author and mismatched stored binding", () => {
    expect(historicalAuthorIssues(video, "kuaishou", null, binding)).toEqual(["fetched-author-evidence-unavailable"]);
    expect(historicalAuthorIssues(video, "kuaishou", "other", binding)).toEqual(["fetched-author-uid-mismatch"]);
    expect(historicalAuthorIssues(video, "douyin", "uid", binding)).toEqual(["stored-author-binding-mismatch"]);
    expect(historicalAuthorIssues(video, "kuaishou", "uid", { ...binding, userId: "other" })).toEqual(["stored-author-binding-mismatch"]);
  });
});
