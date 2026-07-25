import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return {
    sendMail,
    createTransport: vi.fn(() => ({ sendMail })),
  };
});
const { lookup } = vi.hoisted(() => ({
  lookup: vi.fn().mockResolvedValue([{ address: "203.0.113.10", family: 4 }]),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport },
}));
vi.mock("node:dns/promises", () => ({
  default: { lookup },
}));

import {
  operationalAlertConfigurationStatus,
  sendOperationalAlert,
} from "../lib/alerts";

const ALERT_ENV_KEYS = [
  "ALERT_WEBHOOK_URL",
  "ALERT_EMAIL_TO",
  "ALERT_EMAIL_FROM",
  "ALERT_SMTP_HOST",
  "ALERT_SMTP_PORT",
  "ALERT_SMTP_USER",
  "ALERT_SMTP_PASSWORD",
  "ALERT_SMTP_SECURE",
] as const;

function configureEmail() {
  process.env.ALERT_EMAIL_TO = "ops@example.com";
  process.env.ALERT_SMTP_HOST = "smtp.163.com";
  process.env.ALERT_SMTP_PORT = "465";
  process.env.ALERT_SMTP_USER = "sender@163.com";
  process.env.ALERT_SMTP_PASSWORD = "test-only-password";
  process.env.ALERT_SMTP_SECURE = "true";
}

describe("sendOperationalAlert", () => {
  beforeEach(() => {
    for (const key of ALERT_ENV_KEYS) delete process.env[key];
    sendMail.mockReset();
    createTransport.mockClear();
    lookup.mockReset();
    lookup.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    for (const key of ALERT_ENV_KEYS) delete process.env[key];
    vi.unstubAllGlobals();
  });

  it("reports not-configured when no alert channel exists", async () => {
    expect(operationalAlertConfigurationStatus()).toEqual({
      configured: false,
      reason: "not-configured",
    });
    await expect(sendOperationalAlert({
      source: "test",
      severity: "warning",
      message: "missing channel",
    })).resolves.toEqual({ sent: false, reason: "not-configured" });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("rejects a partially configured email channel", async () => {
    process.env.ALERT_EMAIL_TO = "ops@example.com";
    process.env.ALERT_SMTP_HOST = "smtp.163.com";

    await expect(sendOperationalAlert({
      source: "test",
      severity: "warning",
      message: "partial channel",
    })).resolves.toEqual({ sent: false, reason: "email-incomplete" });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("rejects invalid SMTP connection settings", async () => {
    configureEmail();
    process.env.ALERT_SMTP_PORT = "70000";

    await expect(sendOperationalAlert({
      source: "test",
      severity: "warning",
      message: "invalid port",
    })).resolves.toEqual({ sent: false, reason: "email-invalid-port" });

    process.env.ALERT_SMTP_PORT = "465";
    process.env.ALERT_SMTP_SECURE = "sometimes";
    await expect(sendOperationalAlert({
      source: "test",
      severity: "warning",
      message: "invalid secure flag",
    })).resolves.toEqual({ sent: false, reason: "email-invalid-secure" });
  });

  it("sends a UTF-8 email with redacted details", async () => {
    configureEmail();
    expect(operationalAlertConfigurationStatus()).toEqual({
      configured: true,
      channels: ["email"],
    });
    sendMail.mockResolvedValue({
      accepted: ["ops@example.com"],
      rejected: [],
      messageId: "message-1",
    });

    await expect(sendOperationalAlert({
      source: "weekly-challenge-shadow",
      severity: "info",
      message: "双周期影子运行通过",
      details: {
        periods: 2,
        token: "must-not-leak",
        nested: { phone: "18600000000" },
      },
    })).resolves.toEqual({ sent: true, channels: ["email"] });

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: "203.0.113.10",
      port: 465,
      secure: true,
      auth: {
        user: "sender@163.com",
        pass: "test-only-password",
      },
      tls: { servername: "smtp.163.com" },
    }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: "sender@163.com",
      to: "ops@example.com",
      subject: "[妙妙积分中心][INFO] 双周期影子运行通过",
      text: expect.stringContaining("\"token\": \"[已脱敏]\""),
    }));
    expect(sendMail.mock.calls[0][0].text).not.toContain("must-not-leak");
    expect(sendMail.mock.calls[0][0].text).not.toContain("18600000000");
    expect(sendMail.mock.calls[0][0].text).toContain("\"phone\": \"[已脱敏]\"");
  });

  it("fails when SMTP rejects every recipient", async () => {
    configureEmail();
    sendMail.mockResolvedValue({
      accepted: [],
      rejected: ["ops@example.com"],
      messageId: "message-2",
    });

    await expect(sendOperationalAlert({
      source: "test",
      severity: "critical",
      message: "recipient rejected",
    })).resolves.toEqual({ sent: false, reason: "email-rejected" });
  });

  it("retries another IPv4 address only for connection failures", async () => {
    configureEmail();
    lookup.mockResolvedValue([
      { address: "203.0.113.10", family: 4 },
      { address: "203.0.113.11", family: 4 },
    ]);
    sendMail
      .mockRejectedValueOnce(Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" }))
      .mockResolvedValueOnce({
        accepted: ["ops@example.com"],
        rejected: [],
        messageId: "message-3",
      });

    await expect(sendOperationalAlert({
      source: "test",
      severity: "critical",
      message: "retry connection",
    })).resolves.toEqual({ sent: true, channels: ["email"] });
    expect(createTransport).toHaveBeenCalledTimes(2);
  });

  it("does not retry authentication failures", async () => {
    configureEmail();
    lookup.mockResolvedValue([
      { address: "203.0.113.10", family: 4 },
      { address: "203.0.113.11", family: 4 },
    ]);
    sendMail.mockRejectedValue(Object.assign(new Error("Invalid login"), { code: "EAUTH" }));

    await expect(sendOperationalAlert({
      source: "test",
      severity: "critical",
      message: "invalid credentials",
    })).resolves.toEqual({ sent: false, reason: "email-EAUTH" });
    expect(createTransport).toHaveBeenCalledTimes(1);
  });

  it("keeps the existing webhook transport compatible", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://alerts.example.test/hook";
    expect(operationalAlertConfigurationStatus()).toEqual({
      configured: true,
      channels: ["webhook"],
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendOperationalAlert({
      source: "test",
      severity: "critical",
      message: "webhook works",
    })).resolves.toEqual({ sent: true, channels: ["webhook"] });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://alerts.example.test/hook",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("does not expose raw webhook errors", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://secret.example.test/hook";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(
      "fetch failed for https://secret.example.test/hook",
    )));

    await expect(sendOperationalAlert({
      source: "test",
      severity: "critical",
      message: "webhook failed",
    })).resolves.toEqual({ sent: false, reason: "webhook-request-failed" });
  });
});
