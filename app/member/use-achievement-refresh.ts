"use client";

import { useEffect, useRef } from "react";

// Briefly follow a pending projection while its card/page is mounted. Back off
// and stop after three attempts; a stopped Worker must not create endless polls.
export function useAchievementRefresh(data: { projection?: { state: "pending" | "ready" } } | null, loading: boolean, error: string, retry: () => void) {
  const attempts = useRef(0);
  const latestRetry = useRef(retry);
  useEffect(() => { latestRetry.current = retry; }, [retry]);
  useEffect(() => {
    if (data?.projection?.state !== "pending") { attempts.current = 0; return; }
    if (loading || error || attempts.current >= 3) return;
    const timer = setTimeout(() => {
      if (document.visibilityState === "hidden") return;
      attempts.current += 1;
      latestRetry.current();
    }, 5_000 * 2 ** attempts.current);
    return () => clearTimeout(timer);
  }, [data, loading, error]);
}
