import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), resolveVideoAppeal: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/points", () => ({ resolveVideoAppeal: mocks.resolveVideoAppeal }));
vi.mock("@/lib/security", () => ({ assertSameOrigin: vi.fn(), getClientIp: () => "198.51.100.1" }));
import { POST } from "@/app/api/admin/video-appeals/[id]/route";

describe("申诉快照 API 边界", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.requireAdmin.mockResolvedValue({ id: "admin" }); mocks.resolveVideoAppeal.mockResolvedValue({ id: "appeal" }); });
  const post = (data: object) => POST(new Request("http://localhost/api/admin/video-appeals/appeal", { method: "POST", body: JSON.stringify(data), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id: "appeal" }) });

  it("不以旧的固定 5000 上限拦截已锁定的较高规则", async () => {
    const response = await post({ action: "approve", points: 5500, expectedRuleRevision: "a".repeat(64), expectedCalculatedPoints: 50 });
    expect(response.status).toBe(200);
    expect(mocks.resolveVideoAppeal).toHaveBeenCalledWith(expect.objectContaining({ points: 5500, expectedRuleRevision: "a".repeat(64), expectedCalculatedPoints: 50 }));
  });
  it("小数积分在到达事务和整数数据库列之前被拒绝", async () => {
    expect((await post({ action: "approve", points: 50.5 })).status).toBe(400);
    expect(mocks.resolveVideoAppeal).not.toHaveBeenCalled();
  });
  it("没有管理员身份不能处理申诉", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("无权执行此操作"));
    expect((await post({ action: "approve", points: 50 })).status).toBe(400);
    expect(mocks.resolveVideoAppeal).not.toHaveBeenCalled();
  });
  it("锁定上限或确认数据不符的事务错误不会返回成功", async () => {
    mocks.resolveVideoAppeal.mockRejectedValue(new Error("视频计算依据已变化，请刷新申诉列表后重新确认"));
    const response = await post({ action: "approve", expectedCalculatedPoints: 50 });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("刷新申诉列表") });
  });
});
