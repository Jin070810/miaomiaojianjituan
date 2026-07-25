import { describe, expect, it, vi } from "vitest";
import { resolveBatchMemberIds } from "@/lib/points";

describe("batch point member selection", () => {
  it("keeps explicit cross-page selections unique and stable", async () => {
    const listAll = vi.fn(async () => [{ id: "unexpected" }]);
    await expect(resolveBatchMemberIds("EXPLICIT", ["member-b", "member-a", "member-b"], listAll))
      .resolves.toEqual(["member-a", "member-b"]);
    expect(listAll).not.toHaveBeenCalled();
  });

  it("resolves all active members on the server at transaction time", async () => {
    const listAll = vi.fn(async () => [{ id: "member-b" }, { id: "member-a" }]);
    await expect(resolveBatchMemberIds("ALL_ACTIVE_MEMBERS", ["stale-page-member"], listAll))
      .resolves.toEqual(["member-a", "member-b"]);
    expect(listAll).toHaveBeenCalledOnce();
  });
});
