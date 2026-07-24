type AlertSeverity = "info" | "warning" | "critical";

function safeDetails(details: Record<string, unknown> | undefined) {
  if (!details) return undefined;
  return Object.fromEntries(Object.entries(details).map(([key, value]) => [
    key,
    /(password|secret|session|phone|address|qrcode|cashqr|token)/i.test(key) ? "[已脱敏]" : value,
  ]));
}

export async function sendOperationalAlert(input: {
  source: string;
  severity: AlertSeverity;
  message: string;
  details?: Record<string, unknown>;
}) {
  const webhook = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!webhook) return { sent: false, reason: "not-configured" as const };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: input.source,
        severity: input.severity,
        message: input.message,
        details: safeDetails(input.details),
        occurredAt: new Date().toISOString(),
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { sent: false, reason: `http-${response.status}` as const };
    return { sent: true as const };
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : "request-failed" };
  } finally {
    clearTimeout(timer);
  }
}
