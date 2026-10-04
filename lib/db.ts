import { PrismaClient } from "@prisma/client";
import { observeDatabaseQuery } from "./database-query-observer";

function createClient() {
  const client = new PrismaClient({
    log: [{ emit: "event", level: "query" }, { emit: "stdout", level: "error" }, ...(process.env.NODE_ENV === "development" ? [{ emit: "stdout", level: "warn" } as const] : [])],
  });
  client.$on("query", observeDatabaseQuery);
  return client;
}
const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createClient> };

export const db =
  globalForPrisma.prisma ??
  createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
