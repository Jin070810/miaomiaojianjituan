import dns from "node:dns/promises";
import net from "node:net";
import nodemailer from "nodemailer";

type AlertSeverity = "info" | "warning" | "critical";

function safeDetails(details: Record<string, unknown> | undefined) {
  if (!details) return undefined;
  const seen = new WeakSet<object>();
  const redact = (value: unknown, key?: string): unknown => {
    if (key && /(password|secret|session|phone|address|qrcode|cashqr|token|api.?key|authorization|cookie)/i.test(key)) {
      return "[已脱敏]";
    }
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map((item) => redact(item));
    if (value && typeof value === "object") {
      if (seen.has(value)) return "[无法序列化]";
      seen.add(value);
      return Object.fromEntries(
        Object.entries(value).map(([nestedKey, nestedValue]) => [
          nestedKey,
          redact(nestedValue, nestedKey),
        ]),
      );
    }
    return value;
  };
  return redact(details) as Record<string, unknown>;
}

type AlertPayload = {
  source: string;
  severity: AlertSeverity;
  message: string;
  details?: Record<string, unknown>;
  occurredAt: string;
};

type EmailConfiguration =
  | { state: "absent" }
  | {
    state: "invalid";
    reason: "email-incomplete" | "email-invalid-port" | "email-invalid-secure";
  }
  | {
    state: "valid";
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    from: string;
    to: string;
  };

function transportErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = String(error.code);
  return /^[A-Z0-9_-]{1,32}$/i.test(code) ? code : null;
}

function emailConfiguration(): EmailConfiguration {
  const values = {
    to: process.env.ALERT_EMAIL_TO?.trim() ?? "",
    host: process.env.ALERT_SMTP_HOST?.trim() ?? "",
    port: process.env.ALERT_SMTP_PORT?.trim() ?? "",
    user: process.env.ALERT_SMTP_USER?.trim() ?? "",
    password: process.env.ALERT_SMTP_PASSWORD?.trim() ?? "",
  };
  if (!Object.values(values).some(Boolean)) return { state: "absent" };
  if (!values.to || !values.host || !values.user || !values.password) {
    return { state: "invalid", reason: "email-incomplete" };
  }
  const port = values.port ? Number(values.port) : 465;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return { state: "invalid", reason: "email-invalid-port" };
  }
  const secureSetting = process.env.ALERT_SMTP_SECURE?.trim().toLowerCase();
  if (secureSetting && secureSetting !== "true" && secureSetting !== "false") {
    return { state: "invalid", reason: "email-invalid-secure" };
  }
  const secure = secureSetting ? secureSetting === "true" : port === 465;
  return {
    state: "valid",
    host: values.host,
    port,
    secure,
    user: values.user,
    password: values.password,
    from: process.env.ALERT_EMAIL_FROM?.trim() || values.user,
    to: values.to,
  };
}

export function operationalAlertConfigurationStatus() {
  const webhook = process.env.ALERT_WEBHOOK_URL?.trim() ?? "";
  const email = emailConfiguration();
  if (webhook && !webhook.startsWith("https://")) {
    return { configured: false, reason: "webhook-invalid" as const };
  }
  if (email.state === "invalid") {
    return { configured: false, reason: email.reason };
  }
  const channels = [
    ...(webhook ? ["webhook" as const] : []),
    ...(email.state === "valid" ? ["email" as const] : []),
  ];
  return channels.length
    ? { configured: true as const, channels }
    : { configured: false as const, reason: "not-configured" as const };
}

async function sendWebhook(payload: AlertPayload, webhook: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return response.ok ? null : `webhook-http-${response.status}`;
  } catch (error) {
    const code = transportErrorCode(error);
    return code ? `webhook-${code}` : "webhook-request-failed";
  } finally {
    clearTimeout(timer);
  }
}

async function sendEmail(payload: AlertPayload, config: Extract<EmailConfiguration, { state: "valid" }>) {
  const hosts = net.isIP(config.host)
    ? [config.host]
    : await dns.lookup(config.host, { all: true, family: 4 })
      .then((addresses) => addresses.map(({ address }) => address))
      .catch(() => [config.host]);
  const uniqueHosts = [...new Set(hosts.length ? hosts : [config.host])];
  for (const [index, host] of uniqueHosts.entries()) {
    try {
      const transport = nodemailer.createTransport({
        host,
        port: config.port,
        secure: config.secure,
        auth: {
          user: config.user,
          pass: config.password,
        },
        connectionTimeout: 10_000,
        greetingTimeout: 5_000,
        socketTimeout: 15_000,
        tls: host === config.host ? undefined : { servername: config.host },
      });
      const info = await transport.sendMail({
        from: config.from,
        to: config.to,
        subject: `[妙妙积分中心][${payload.severity.toUpperCase()}] ${payload.message}`,
        text: [
          `来源：${payload.source}`,
          `级别：${payload.severity}`,
          `时间：${payload.occurredAt}`,
          `消息：${payload.message}`,
          "",
          "详情：",
          JSON.stringify(payload.details ?? {}, null, 2),
        ].join("\n"),
      });
      if (!info.accepted?.length || info.rejected?.length) return "email-rejected";
      return null;
    } catch (error) {
      const code = transportErrorCode(error) ?? "";
      const retryable = ["ECONNECTION", "ETIMEDOUT", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "EDNS", "ESOCKET"]
        .includes(code);
      if (!retryable || index === uniqueHosts.length - 1) {
        return code ? `email-${code}` : "email-send-failed";
      }
    }
  }
  return "email-send-failed";
}

export async function sendOperationalAlert(input: {
  source: string;
  severity: AlertSeverity;
  message: string;
  details?: Record<string, unknown>;
}) {
  const webhook = process.env.ALERT_WEBHOOK_URL?.trim();
  const email = emailConfiguration();
  if (email.state === "invalid") return { sent: false, reason: email.reason };
  if (!webhook && email.state === "absent") {
    return { sent: false, reason: "not-configured" as const };
  }
  const payload: AlertPayload = {
    source: input.source,
    severity: input.severity,
    message: input.message,
    details: safeDetails(input.details),
    occurredAt: new Date().toISOString(),
  };
  const channels: Array<"webhook" | "email"> = [];
  const deliveries: Array<Promise<string | null>> = [];
  if (webhook) {
    channels.push("webhook");
    deliveries.push(sendWebhook(payload, webhook));
  }
  if (email.state === "valid") {
    channels.push("email");
    deliveries.push(sendEmail(payload, email));
  }
  const failures = (await Promise.all(deliveries)).filter((reason): reason is string => Boolean(reason));
  return failures.length
    ? { sent: false, reason: failures.join(",") }
    : { sent: true as const, channels };
}
