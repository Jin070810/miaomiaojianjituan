// Bound the response without repeatedly queuing work behind a stuck dependency.
// A timeout cannot cancel an arbitrary driver promise: keep that one probe in
// flight until it settles, and immediately fail later callers in the meantime.
export function createHealthProbe<T>(read: () => Promise<T>, unavailable: T, timeoutMs = 2_000, cacheMs = 1_000) {
  let running: { result: Promise<T> } | null = null;
  let cached: { value: T; expiresAt: number } | null = null;
  return async (): Promise<T> => {
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (running) return running.result;
    let finish!: (value: T) => void;
    const run = { result: new Promise<T>((resolve) => { finish = resolve; }) };
    running = run;
    const timeout = setTimeout(() => finish(unavailable), timeoutMs);
    void Promise.resolve().then(read).catch(() => unavailable).then((value) => {
      clearTimeout(timeout);
      cached = { value, expiresAt: Date.now() + cacheMs };
      running = null;
      finish(value);
    });
    return run.result;
  };
}

export const healthHeaders = { "Cache-Control": "no-store, max-age=0" };

export function healthAppVersion() {
  return { commit: process.env.APP_COMMIT_SHA?.trim() || null, buildTime: process.env.APP_BUILD_TIME?.trim() || null };
}
