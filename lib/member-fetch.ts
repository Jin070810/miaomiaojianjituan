export const MEMBER_READ_TIMEOUT_MS = 10_000;

export class MemberFetchError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "MemberFetchError";
  }
}

export async function fetchMemberJson<T>(
  input: RequestInfo | URL,
  fallbackMessage: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = MEMBER_READ_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(input, { cache: "no-store", signal: controller.signal });
    const result = await response.json().catch(() => ({})) as { error?: string } & T;
    if (!response.ok) throw new MemberFetchError(result.error ?? fallbackMessage, response.status);
    return result;
  } catch (error) {
    if (error instanceof MemberFetchError) throw error;
    if ((error instanceof DOMException && error.name === "AbortError") || (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")) {
      throw new MemberFetchError("加载超时，请检查网络后重试");
    }
    throw new MemberFetchError("网络连接暂时不可用，请稍后重试");
  } finally {
    globalThis.clearTimeout(timer);
  }
}
