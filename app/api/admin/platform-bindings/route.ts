import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin, getClientIp, rateLimitResponse } from "@/lib/security";
import { enforceRateLimit } from "@/lib/rate-limit";
import { parsePagination, paginationResult } from "@/lib/pagination";
import { PlatformBindingError, reviewPlatformBindingRequest, revokePlatformBinding } from "@/lib/platform-bindings";

const noStore = { "Cache-Control": "private, no-store" };
const reviewSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), requestId: z.string().min(1).max(100), challenge: z.string().min(1).max(100), proofMethod: z.enum(["PLATFORM_MESSAGE", "PROFILE_CHALLENGE"]), proofNote: z.string().trim().min(20).max(1000), confirmedControl: z.literal(true) }).strict(),
  z.object({ action: z.literal("reject"), requestId: z.string().min(1).max(100), reason: z.string().trim().min(4).max(1000) }).strict(),
  z.object({ action: z.literal("revoke"), bindingId: z.string().min(1).max(100), reason: z.string().trim().min(4).max(1000) }).strict(),
]);

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "仅管理员可核验平台账号" }, { status: user ? 403 : 401, headers: noStore });
  const url = new URL(request.url);
  const { page, take, skip } = parsePagination(url, 20, 50);
  const status = url.searchParams.get("status") ?? "PENDING";
  if (!["PENDING", "APPROVED", "REJECTED"].includes(status)) return NextResponse.json({ error: "验证状态不正确" }, { status: 400, headers: noStore });
  const [requests, total] = await Promise.all([
    db.platformBindingRequest.findMany({ where: { status }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take, select: { id: true, platform: true, authorUid: true, videoId: true, photoId: true, status: true, expiresAt: true, createdAt: true, reviewedAt: true, reviewedById: true, proofMethod: true, proofNote: true, rejectionReason: true, user: { select: { id: true, kuaishouId: true, nickname: true, active: true } }, binding: { select: { id: true, revokedAt: true } } } }),
    db.platformBindingRequest.count({ where: { status } }),
  ]);
  // Challenge is intentionally not disclosed here: reviewers enter the code
  // actually received from the platform account, not one copied from this list.
  return NextResponse.json({ requests, pagination: paginationResult(page, take, total) }, { headers: noStore });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "仅管理员可核验平台账号" }, { status: user ? 403 : 401, headers: noStore });
    await enforceRateLimit(`platform-binding-review:${user.id}`, 60, 3600);
    const input = reviewSchema.parse(await request.json());
    const context = { actorId: user.id, ip: getClientIp(request) };
    if (input.action === "revoke") {
      const binding = await revokePlatformBinding({ ...input, ...context });
      return NextResponse.json({ binding: { id: binding.id, revokedAt: binding.revokedAt } }, { headers: noStore });
    }
    const updated = await reviewPlatformBindingRequest({ ...input, ...context });
    return NextResponse.json({ request: { id: updated.id, status: updated.status, reviewedAt: updated.reviewedAt } }, { headers: noStore });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof PlatformBindingError ? error.message : "请检查挑战码、控制权确认和证据说明后重试" }, { status: error instanceof PlatformBindingError ? error.status : 400, headers: noStore });
  }
}
