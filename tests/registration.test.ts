import { describe, expect, it } from "vitest";
import { POST as register } from "@/app/api/auth/register/route";
import { registrationInternals, createOpaqueToken, hashOpaqueToken } from "@/lib/registration";

describe("受控入团申请基础安全规则", () => {
  it("生成高熵 token 并只通过哈希保存", () => {
    const token = createOpaqueToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(hashOpaqueToken(token)).toHaveLength(64);
    expect(hashOpaqueToken(token)).not.toBe(token);
  });

  it("拒绝已停用或过期的链接", () => {
    expect(registrationInternals.isLinkAvailable({ active: false, expiresAt: null })).toBe(false);
    expect(registrationInternals.isLinkAvailable({ active: true, expiresAt: new Date(Date.now() - 1_000) })).toBe(false);
    expect(registrationInternals.isLinkAvailable({ active: true, expiresAt: null })).toBe(true);
  });

  it("限制链接最长有效期", () => {
    expect(() => registrationInternals.validateExpiresAt(new Date(Date.now() + 366 * 86_400_000))).toThrow("365 天");
  });

  it("旧公开注册接口不再创建账号", async () => {
    const response = await register(new Request("https://miaoyi.site/api/auth/register", { method: "POST", body: "{}" }));
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "公开注册已关闭，请使用专属入团链接申请" });
  });
});
