import { mkdirSync, writeFileSync, copyFileSync, chmodSync } from "node:fs";
import path from "node:path";

// The request is data, never shell source. Secrets travel through stdin in a
// mode-0600 temporary bundle; they are neither argv nor uploaded evidence.
const e = process.env;
const required = key => {
  if (!e[key]) throw new Error(`缺少 ${key}`);
  return e[key];
};
const check = (ok, message) => { if (!ok) throw new Error(message); };
const sha = required("RELEASE_COMMIT");
check(/^[a-f0-9]{40}$/.test(sha), "release SHA 无效");
const version = required("RELEASE_VERSION");
check(/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(version), "正式版本 tag 无效");
const id = `${required("GITHUB_RUN_ID")}-${required("GITHUB_RUN_ATTEMPT")}`;
check(/^[1-9][0-9]*-[1-9][0-9]*$/.test(id), "发布 ID 无效");
const domain = required("PRODUCTION_DOMAIN");
check(/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(domain), "生产域名无效");
const keys = ["DEEPSEEK_BASE_URL", "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL", "ALERT_WEBHOOK_URL",
  "ALERT_EMAIL_TO", "ALERT_EMAIL_FROM", "ALERT_SMTP_HOST", "ALERT_SMTP_PORT", "ALERT_SMTP_USER",
  "ALERT_SMTP_PASSWORD", "ALERT_SMTP_SECURE", "ALERTS_DEFERRED", "BACKUP_STORAGE_MODE",
  "OSS_BUCKET", "OSS_ENDPOINT", "OSS_ECS_ROLE_NAME", "OSS_PREFIX", "LOCAL_BACKUP_RETENTION_DAYS"];
const config = Object.fromEntries(keys.map(key => [key, e[key] ?? ""]));
config.BACKUP_STORAGE_MODE ||= "local";
config.OSS_PREFIX ||= "miaomiao/production";
config.LOCAL_BACKUP_RETENTION_DAYS ||= "7";
for (const [key, value] of Object.entries(config)) {
  check(!/[\r\n\0']/.test(value), `${key} 包含环境文件不支持的字符`);
}
const bootstrap = e.BOOTSTRAP_ADMIN === "true";
if (bootstrap) {
  required("ADMIN_KUAISHOU_IDS");
  check(required("ADMIN_PASSWORD").length >= 8, "管理员密码过短");
}
const request = {
  schemaVersion: 1, id, commit: sha, version, actor: required("GITHUB_ACTOR"),
  repository: required("GITHUB_REPOSITORY"), domain,
  recover: e.RECOVER_FROM_FAILED_RELEASE === "true", bootstrap, config,
  migrationCompatibilityNote: e.MIGRATION_COMPATIBILITY_NOTE || "",
  token: required("GHCR_TOKEN"),
  admin: bootstrap ? { ids: e.ADMIN_KUAISHOU_IDS, password: e.ADMIN_PASSWORD,
    nickname: e.ADMIN_NICKNAME || "管理员" } : null,
};
const destination = process.argv[2];
check(Boolean(destination), "缺少临时目录");
mkdirSync(destination, { recursive: true, mode: 0o700 });
writeFileSync(path.join(destination, "request.json"), JSON.stringify(request), { mode: 0o600 });
copyFileSync("output/release/deploy-candidate.json", path.join(destination, "manifest.json"));
copyFileSync("output/release/deploy-candidate.sigstore.json", path.join(destination, "attestation.json"));
for (const file of ["production-lock.sh", "production-release.sh", "production-preflight.sh",
  "pull-release-images.sh", "backup-db.sh", "verify-release-health.sh", "release-lifecycle.sh",
  "nginx-release.conf", "verify-web-candidate.mjs"]) {
  const target = path.join(destination, file);
  copyFileSync(path.join("scripts", file), target);
  chmodSync(target, 0o600);
}
