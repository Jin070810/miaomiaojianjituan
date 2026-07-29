import { describe, expect, it, vi } from "vitest";
import { fetchMemberJson, MEMBER_READ_TIMEOUT_MS, MemberFetchError } from "@/lib/member-fetch";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("member read fetch", () => {
  it("uses no-store and clears the timeout after a successful response", async () => {
    const fetcher = vi.fn(async () => response({ ok: true })) as unknown as typeof fetch;
    await expect(fetchMemberJson<{ ok: boolean }>("/api/member/home", "首页加载失败", fetcher)).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith("/api/member/home", expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
  });

  it("preserves API errors and status codes for authentication handling", async () => {
    const fetcher = vi.fn(async () => response({ error: "请先登录" }, 401)) as unknown as typeof fetch;
    await expect(fetchMemberJson("/api/member/home", "首页加载失败", fetcher)).rejects.toMatchObject({
      name: "MemberFetchError",
      message: "请先登录",
      status: 401,
    } satisfies Partial<MemberFetchError>);
  });

  it("turns an aborted slow request into a retryable timeout", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject({ name: "AbortError" }));
    })) as unknown as typeof fetch;
    const pending = fetchMemberJson("/api/member/home", "首页加载失败", fetcher);
    const assertion = expect(pending).rejects.toMatchObject({ message: "加载超时，请检查网络后重试" });
    await vi.advanceTimersByTimeAsync(MEMBER_READ_TIMEOUT_MS);
    await assertion;
    vi.useRealTimers();
  });

  it("turns a transport failure into a retryable network message", async () => {
    const fetcher = vi.fn(async () => { throw new TypeError("network down"); }) as unknown as typeof fetch;
    await expect(fetchMemberJson("/api/member/home", "首页加载失败", fetcher)).rejects.toMatchObject({ message: "网络连接暂时不可用，请稍后重试" });
  });
});
