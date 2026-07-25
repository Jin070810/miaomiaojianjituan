const developmentPlaceholders = new Set([
  "replace-with-a-long-random-secret",
  "local-dev-secret",
  "postgres",
]);

export function runtimeConfigIssues() {
  const issues: string[] = [];
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl) issues.push("DATABASE_URL未配置");
  if (process.env.NODE_ENV === "production") {
    try {
      if (new URL(databaseUrl).password === "postgres") issues.push("生产数据库密码不能使用默认值");
    } catch {
      issues.push("DATABASE_URL格式无效");
    }
  }
  const sessionSecret = process.env.SESSION_SECRET ?? "";
  if (sessionSecret.length < 32 || (process.env.NODE_ENV === "production" && (developmentPlaceholders.has(sessionSecret) || sessionSecret.startsWith("local-dev-")))) {
    issues.push("SESSION_SECRET不符合生产要求");
  }
  const phoneKey = process.env.PHONE_ENCRYPTION_KEY ?? "";
  const examplePhoneKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  if (!/^[0-9a-fA-F]{64}$/.test(phoneKey) || (process.env.NODE_ENV === "production" && phoneKey === examplePhoneKey)) {
    issues.push("PHONE_ENCRYPTION_KEY必须是64位十六进制");
  }
  if (process.env.NODE_ENV === "production" && !process.env.REDIS_URL) issues.push("生产环境必须配置REDIS_URL");
  if (process.env.NODE_ENV === "production" && !/^[0-9a-f]{40}$/i.test(process.env.APP_COMMIT_SHA?.trim() ?? "")) {
    issues.push("APP_COMMIT_SHA必须是完整的40位提交SHA");
  }
  const buildTime = process.env.APP_BUILD_TIME?.trim() ?? "";
  if (process.env.NODE_ENV === "production" && (!buildTime || Number.isNaN(Date.parse(buildTime)))) {
    issues.push("APP_BUILD_TIME必须是有效的ISO时间");
  }
  return issues;
}
