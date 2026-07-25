import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import OSS from "ali-oss";
import { sendOperationalAlert } from "./alerts";

const METADATA_BASE_URL = "http://100.100.100.200/latest";
const BACKUP_NAME = /^miaomiao-\d{8}-\d{6}\.dump$/;

type EcsRoleCredentials = {
  AccessKeyId: string;
  AccessKeySecret: string;
  SecurityToken: string;
  Expiration: string;
  Code?: string;
};

export type OssBackupConfig = {
  bucket: string;
  endpoint: string;
  roleName: string;
  prefix: string;
  localRetentionDays: number;
};

export type BackupStorageConfig = {
  mode: "local" | "oss";
  localRetentionDays: number;
};

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
}

export function loadBackupStorageConfig(): BackupStorageConfig {
  const mode = (process.env.BACKUP_STORAGE_MODE?.trim().toLowerCase() || "local") as BackupStorageConfig["mode"];
  const localRetentionDays = Number(process.env.LOCAL_BACKUP_RETENTION_DAYS ?? 7);
  if (mode !== "local" && mode !== "oss") throw new Error("BACKUP_STORAGE_MODE 必须是 local 或 oss");
  if (!Number.isInteger(localRetentionDays) || localRetentionDays < 1 || localRetentionDays > 90) {
    throw new Error("LOCAL_BACKUP_RETENTION_DAYS 必须是 1 到 90 的整数");
  }
  return { mode, localRetentionDays };
}

export function loadOssBackupConfig(): OssBackupConfig {
  const storage = loadBackupStorageConfig();
  if (storage.mode !== "oss") throw new Error("BACKUP_STORAGE_MODE 必须为 oss 才能使用 OSS");
  const bucket = requiredEnvironment("OSS_BUCKET");
  const endpoint = requiredEnvironment("OSS_ENDPOINT");
  const roleName = requiredEnvironment("OSS_ECS_ROLE_NAME");
  const prefix = (process.env.OSS_PREFIX?.trim() || "miaomiao/production").replace(/^\/+|\/+$/g, "");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("OSS_BUCKET 格式无效");
  const endpointUrl = new URL(endpoint);
  if (endpointUrl.protocol !== "https:" || !endpointUrl.hostname.endsWith(".aliyuncs.com")) {
    throw new Error("OSS_ENDPOINT 必须是阿里云 HTTPS OSS 地址");
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(roleName)) throw new Error("OSS_ECS_ROLE_NAME 格式无效");
  if (!/^[A-Za-z0-9/_-]{1,240}$/.test(prefix) || prefix.includes("..")) throw new Error("OSS_PREFIX 格式无效");
  return { bucket, endpoint: endpointUrl.origin, roleName, prefix, localRetentionDays: storage.localRetentionDays };
}

export function assertOssEndpointRegion(endpoint: string, regionId: string) {
  const hostname = new URL(endpoint).hostname.toLowerCase();
  const allowed = new Set([
    `oss-${regionId}.aliyuncs.com`,
    `oss-${regionId}-internal.aliyuncs.com`,
  ]);
  if (!allowed.has(hostname)) throw new Error(`OSS_ENDPOINT 与 ECS 地域 ${regionId} 不一致`);
}

async function metadataFetch(pathname: string, token: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${METADATA_BASE_URL}/${pathname}`, {
      ...init,
      headers: { ...init?.headers, "X-aliyun-ecs-metadata-token": token },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`ECS 元数据请求失败：${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function readEcsMetadata(roleName: string) {
  const tokenController = new AbortController();
  const timer = setTimeout(() => tokenController.abort(), 5_000);
  let token: string;
  try {
    const response = await fetch(`${METADATA_BASE_URL}/api/token`, {
      method: "PUT",
      headers: { "X-aliyun-ecs-metadata-token-ttl-seconds": "1800" },
      signal: tokenController.signal,
    });
    if (!response.ok) throw new Error(`ECS IMDSv2 Token 获取失败：${response.status}`);
    token = await response.text();
  } finally {
    clearTimeout(timer);
  }
  const [regionId, credentialText] = await Promise.all([
    metadataFetch("meta-data/region-id", token),
    metadataFetch(`meta-data/ram/security-credentials/${encodeURIComponent(roleName)}`, token),
  ]);
  const credentials = JSON.parse(credentialText) as EcsRoleCredentials;
  if (credentials.Code && credentials.Code !== "Success") throw new Error("ECS RAM 角色凭据获取失败");
  if (!credentials.AccessKeyId || !credentials.AccessKeySecret || !credentials.SecurityToken) {
    throw new Error("ECS RAM 角色返回的临时凭据不完整");
  }
  return { regionId: regionId.trim(), credentials };
}

export async function createOssBackupClient(config = loadOssBackupConfig()) {
  const loadCredentials = async () => {
    const metadata = await readEcsMetadata(config.roleName);
    return {
      regionId: metadata.regionId,
      accessKeyId: metadata.credentials.AccessKeyId,
      accessKeySecret: metadata.credentials.AccessKeySecret,
      stsToken: metadata.credentials.SecurityToken,
    };
  };
  const initial = await loadCredentials();
  assertOssEndpointRegion(config.endpoint, initial.regionId);
  const client = new OSS({
    bucket: config.bucket,
    endpoint: config.endpoint,
    region: `oss-${initial.regionId}`,
    accessKeyId: initial.accessKeyId,
    accessKeySecret: initial.accessKeySecret,
    stsToken: initial.stsToken,
    secure: true,
    authorizationV4: true,
    timeout: 120_000,
    refreshSTSTokenInterval: 10 * 60_000,
    refreshSTSToken: async () => {
      const next = await loadCredentials();
      return {
        accessKeyId: next.accessKeyId,
        accessKeySecret: next.accessKeySecret,
        stsToken: next.stsToken,
      };
    },
  });
  return { client, regionId: initial.regionId };
}

export async function sha256File(filePath: string) {
  const hash = crypto.createHash("sha256");
  const handle = await fs.open(filePath, "r");
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk);
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

export function parseChecksumFile(content: string, expectedFileName: string) {
  const match = content.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
  if (!match || path.basename(match[2]) !== expectedFileName) throw new Error("备份校验文件格式无效");
  return match[1].toLowerCase();
}

export function buildBackupObjectKey(prefix: string, fileName: string) {
  if (!BACKUP_NAME.test(fileName)) throw new Error("备份文件名无效");
  const date = fileName.slice("miaomiao-".length, "miaomiao-".length + 8);
  return `${prefix}/${date.slice(0, 4)}/${date.slice(4, 6)}/${fileName}`;
}

export async function pruneLocalBackups(directory: string, retentionDays: number, now = Date.now()) {
  const cutoff = now - retentionDays * 86_400_000;
  const removed: string[] = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || (!BACKUP_NAME.test(entry.name) && !entry.name.endsWith(".dump.sha256"))) continue;
    const filePath = path.join(directory, entry.name);
    const stat = await fs.stat(filePath);
    if (stat.mtimeMs >= cutoff) continue;
    await fs.unlink(filePath);
    removed.push(entry.name);
  }
  return removed;
}

export async function uploadAndVerifyBackup(backupPath: string) {
  const config = loadOssBackupConfig();
  const absolutePath = path.resolve(backupPath);
  const fileName = path.basename(absolutePath);
  const checksumPath = `${absolutePath}.sha256`;
  if (!BACKUP_NAME.test(fileName)) throw new Error("只允许上传标准命名的数据库备份");
  const expectedChecksum = parseChecksumFile(await fs.readFile(checksumPath, "utf8"), fileName);
  const localChecksum = await sha256File(absolutePath);
  if (localChecksum !== expectedChecksum) throw new Error("本地数据库备份 SHA-256 校验失败");
  const objectKey = buildBackupObjectKey(config.prefix, fileName);
  const checksumObjectKey = `${objectKey}.sha256`;
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "miaomiao-oss-verify-"));
  const downloadedPath = path.join(tempDirectory, fileName);
  try {
    const { client, regionId } = await createOssBackupClient(config);
    const uploadOptions = { headers: { "x-oss-server-side-encryption": "AES256" } };
    await client.put(objectKey, absolutePath, uploadOptions);
    await client.put(checksumObjectKey, checksumPath, uploadOptions);
    await client.get(objectKey, downloadedPath);
    const remoteChecksum = await sha256File(downloadedPath);
    if (remoteChecksum !== expectedChecksum) throw new Error("OSS 回下载 SHA-256 校验失败");
    const marker = {
      verifiedAt: new Date().toISOString(),
      bucket: config.bucket,
      regionId,
      objectKey,
      sha256: expectedChecksum,
    };
    await fs.writeFile(path.join(path.dirname(absolutePath), "last-oss-success.json"), `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
    const removedLocalFiles = await pruneLocalBackups(path.dirname(absolutePath), config.localRetentionDays);
    return { ...marker, removedLocalFiles };
  } catch (error) {
    await sendOperationalAlert({
      source: "production-backup",
      severity: "critical",
      message: "OSS 数据库备份上传或校验失败",
      details: { error: error instanceof Error ? error.message : "unknown", fileName },
    });
    throw error;
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}

export async function downloadLatestBackup(outputDirectory: string) {
  const config = loadOssBackupConfig();
  const { client, regionId } = await createOssBackupClient(config);
  const listed = await client.list({ prefix: `${config.prefix}/`, "max-keys": 1000 }, {});
  const latest = (listed.objects ?? [])
    .filter((row) => BACKUP_NAME.test(path.basename(row.name)))
    .sort((left, right) => Date.parse(right.lastModified) - Date.parse(left.lastModified))[0];
  if (!latest) throw new Error("OSS 中没有可恢复的数据库备份");
  await fs.mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const fileName = path.basename(latest.name);
  const backupPath = path.join(outputDirectory, fileName);
  const checksumPath = `${backupPath}.sha256`;
  await client.get(latest.name, backupPath);
  await client.get(`${latest.name}.sha256`, checksumPath);
  const expected = parseChecksumFile(await fs.readFile(checksumPath, "utf8"), fileName);
  const actual = await sha256File(backupPath);
  if (actual !== expected) throw new Error("OSS 恢复文件 SHA-256 校验失败");
  return { backupPath, checksumPath, objectKey: latest.name, regionId, sha256: actual };
}
