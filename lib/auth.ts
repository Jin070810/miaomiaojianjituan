import crypto from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import { isPasswordResetApproverRole, isVideoReviewOperatorRole } from "./member-roles";

const COOKIE = "miaomiao_session";
const DAYS = 14;

// 生产环境默认 Secure；HTTPS 由 Nginx 终结、应用经 HTTP 反代访问的部署（如
// 生产构建的 e2e 走 http://127.0.0.1）可用 SESSION_COOKIE_SECURE=false 显式
// 关闭——WebKit 不把 http://127.0.0.1 视为可信来源，会直接丢弃 Secure Cookie。
function sessionCookieSecure() {
  const override = process.env.SESSION_COOKIE_SECURE?.trim().toLowerCase();
  if (override === "true") return true;
  if (override === "false") return false;
  return process.env.NODE_ENV === "production";
}

export async function createSession(userId: string) {
  const id = crypto.randomBytes(32).toString("base64url");
  await db.session.create({
    data: { id, userId, expiresAt: new Date(Date.now() + DAYS * 86400_000) },
  });
  const jar = await cookies();
  jar.set(COOKIE, id, {
    httpOnly: true,
    secure: sessionCookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: DAYS * 86400,
  });
  return id;
}

export async function destroySession() {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (id) await db.session.deleteMany({ where: { id } });
  jar.delete(COOKIE);
}

export async function currentUser() {
  const id = (await cookies()).get(COOKIE)?.value;
  if (!id) return null;
  const session = await db.session.findUnique({
    where: { id },
    include: { user: { include: { account: true } } },
  });
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;
  return session.user;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error("请先登录");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new Error("无权执行此操作");
  return user;
}

export async function requirePasswordResetApprover() {
  const user = await requireUser();
  if (!isPasswordResetApproverRole(user.role)) throw new Error("无权执行此操作");
  return user;
}

export async function requireRegistrationApprover() {
  const user = await requireUser();
  if (!isPasswordResetApproverRole(user.role)) throw new Error("无权执行此操作");
  return user;
}

export async function requireVideoReviewOperator() {
  const user = await requireUser();
  if (!isVideoReviewOperatorRole(user.role)) throw new Error("无权执行此操作");
  return user;
}
