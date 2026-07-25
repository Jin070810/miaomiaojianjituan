import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertOssEndpointRegion, buildBackupObjectKey, loadOssBackupConfig, parseChecksumFile, pruneLocalBackups, sha256File } from "@/lib/oss-backup";

const originalEnvironment = { ...process.env };
const temporaryDirectories: string[] = [];

afterEach(async () => {
  process.env = { ...originalEnvironment };
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("OSS backup helpers", () => {
  it("validates secretless ECS role configuration", () => {
    process.env.OSS_BUCKET = "miaomiao-points-prod-backup-123-cn-hangzhou";
    process.env.OSS_ENDPOINT = "https://oss-cn-hangzhou.aliyuncs.com";
    process.env.OSS_ECS_ROLE_NAME = "miaomiao-points-backup-role";
    process.env.OSS_PREFIX = "miaomiao/production";
    process.env.LOCAL_BACKUP_RETENTION_DAYS = "7";
    expect(loadOssBackupConfig()).toEqual({
      bucket: process.env.OSS_BUCKET,
      endpoint: process.env.OSS_ENDPOINT,
      roleName: process.env.OSS_ECS_ROLE_NAME,
      prefix: process.env.OSS_PREFIX,
      localRetentionDays: 7,
    });
  });

  it("rejects non-Aliyun endpoints and traversal prefixes", () => {
    process.env.OSS_BUCKET = "miaomiao-backup-test";
    process.env.OSS_ENDPOINT = "https://example.com";
    process.env.OSS_ECS_ROLE_NAME = "backup-role";
    process.env.OSS_PREFIX = "../production";
    expect(() => loadOssBackupConfig()).toThrow("OSS_ENDPOINT");
    process.env.OSS_ENDPOINT = "https://oss-cn-hangzhou.aliyuncs.com";
    expect(() => loadOssBackupConfig()).toThrow("OSS_PREFIX");
  });

  it("requires the OSS endpoint to match the ECS region", () => {
    expect(() => assertOssEndpointRegion("https://oss-cn-hangzhou.aliyuncs.com", "cn-hangzhou")).not.toThrow();
    expect(() => assertOssEndpointRegion("https://oss-cn-hangzhou-internal.aliyuncs.com", "cn-hangzhou")).not.toThrow();
    expect(() => assertOssEndpointRegion("https://oss-cn-shanghai.aliyuncs.com", "cn-hangzhou")).toThrow("地域");
  });

  it("builds dated object keys and parses checksum sidecars", () => {
    const fileName = "miaomiao-20260725-181500.dump";
    const checksum = "a".repeat(64);
    expect(buildBackupObjectKey("miaomiao/production", fileName)).toBe("miaomiao/production/2026/07/miaomiao-20260725-181500.dump");
    expect(parseChecksumFile(`${checksum}  ${fileName}\n`, fileName)).toBe(checksum);
    expect(() => parseChecksumFile(`${checksum}  other.dump`, fileName)).toThrow("格式无效");
  });

  it("hashes files and removes only expired backup artifacts", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oss-backup-test-"));
    temporaryDirectories.push(directory);
    const oldDump = path.join(directory, "miaomiao-20260701-010101.dump");
    const oldChecksum = `${oldDump}.sha256`;
    const recentDump = path.join(directory, "miaomiao-20260725-010101.dump");
    const unrelated = path.join(directory, "keep.txt");
    await Promise.all([
      fs.writeFile(oldDump, "old"),
      fs.writeFile(oldChecksum, "checksum"),
      fs.writeFile(recentDump, "recent"),
      fs.writeFile(unrelated, "keep"),
    ]);
    const oldTime = new Date("2026-07-01T00:00:00Z");
    await Promise.all([fs.utimes(oldDump, oldTime, oldTime), fs.utimes(oldChecksum, oldTime, oldTime)]);
    expect(await sha256File(recentDump)).toBe("034a7e52c5c9534b709dc1dba403868399b0949f7c1933a67325c22077ffc221");
    const removed = await pruneLocalBackups(directory, 7, Date.parse("2026-07-25T00:00:00Z"));
    expect(removed.sort()).toEqual([path.basename(oldChecksum), path.basename(oldDump)].sort());
    await expect(fs.stat(recentDump)).resolves.toBeTruthy();
    await expect(fs.stat(unrelated)).resolves.toBeTruthy();
  });
});
