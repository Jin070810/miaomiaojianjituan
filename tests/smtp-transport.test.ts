import { createServer, type Server, type Socket } from "node:net";
import nodemailer from "nodemailer";
import { afterEach, expect, it } from "vitest";

let server: Server;
const sockets = new Set<Socket>();
afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function smtpServer(rejectRecipient = false) {
  const messages: string[] = [];
  server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.setEncoding("utf8");
    socket.write("220 integration.local ESMTP\r\n");
    let buffer = "";
    let readingData = false;
    let message = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\r\n")) {
        const end = buffer.indexOf("\r\n");
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (readingData) {
          if (line === ".") {
            readingData = false;
            messages.push(message);
            socket.write("250 2.0.0 queued\r\n");
          } else message += line + "\r\n";
        } else if (/^EHLO|^HELO/.test(line)) socket.write("250-integration.local\r\n250 AUTH PLAIN\r\n");
        else if (/^AUTH PLAIN/.test(line)) socket.write("235 2.7.0 authenticated\r\n");
        else if (/^MAIL FROM:/.test(line)) socket.write("250 2.1.0 sender ok\r\n");
        else if (/^RCPT TO:/.test(line)) socket.write(rejectRecipient ? "550 5.1.1 recipient rejected\r\n" : "250 2.1.5 recipient ok\r\n");
        else if (line === "DATA") { readingData = true; socket.write("354 send message\r\n"); }
        else if (line === "QUIT") { socket.end("221 bye\r\n"); }
        else socket.write("250 ok\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing local SMTP port");
  const transport = nodemailer.createTransport({
    host: "127.0.0.1", port: address.port, secure: false, ignoreTLS: true,
    auth: { user: "integration-only", pass: "integration-only" },
    connectionTimeout: 1500, greetingTimeout: 1500, socketTimeout: 1500,
  });
  return { transport, messages };
}

it("sends an authenticated alert over a local SMTP transport after the security upgrade", async () => {
  const { transport, messages } = await smtpServer();
  try {
    const result = await transport.sendMail({
      from: "alerts@example.invalid", to: "ops@example.invalid", subject: "Worker recovery test", text: "Local integration only.",
    });
    expect(result.accepted).toEqual(["ops@example.invalid"]);
    expect(result.rejected).toEqual([]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Subject: Worker recovery test");
    expect(messages[0]).toContain("Local integration only.");
  } finally { transport.close(); }
});

it("reports an SMTP recipient refusal so operational alerts cannot silently count it as delivered", async () => {
  const { transport, messages } = await smtpServer(true);
  try {
    await expect(transport.sendMail({
      from: "alerts@example.invalid", to: "ops@example.invalid", subject: "Rejected test", text: "Local integration only.",
    })).rejects.toMatchObject({ code: "EENVELOPE", responseCode: 550 });
    expect(messages).toEqual([]);
  } finally { transport.close(); }
});
