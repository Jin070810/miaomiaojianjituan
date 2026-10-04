import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin, getClientIp, rateLimitResponse } from "@/lib/security";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createPlatformBindingRequest, PlatformBindingError } from "@/lib/platform-bindings";

const requestSelect = { id: true, platform: true, authorUid: true, videoId: true, photoId: true, challenge: true, status: true, expiresAt: true, createdAt: true, reviewedAt: true, rejectionReason: true } as const;
const noStore = { "Cache-Control": "private, no-store" };

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401, headers: noStore });
  const [bindings, requests, videos] = await Promise.all([
    db.platformAccountBinding.findMany({ where: { userId: user.id }, orderBy: { verifiedAt: "desc" }, take: 100, select: { id: true, platform: true, authorUid: true, verifiedAt: true, revokedAt: true } }),
    db.platformBindingRequest.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20, select: requestSelect }),
    db.videoSubmission.findMany({ where: { userId: user.id, authorEvidenceVersion: 1, fetchedAuthorUid: { not: null }, photoId: { not: null } }, orderBy: { metadataFetchedAt: "desc" }, take: 50, select: { id: true, sourceKind: true, photoId: true, fetchedAuthorUid: true, fetchedOwner: true, metadataFetchedAt: true } }),
  ]);
  return NextResponse.json({ bindings, requests, videos }, { headers: noStore });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401, headers: noStore });
    await enforceRateLimit(`platform-binding-request:${user.id}`, 10, 3600);
    const input = z.object({ videoId: z.string().min(1).max(100) }).strict().parse(await request.json());
    const created = await createPlatformBindingRequest({ userId: user.id, videoId: input.videoId, ip: getClientIp(request) });
    const safe = await db.platformBindingRequest.findUniqueOrThrow({ where: { id: created.id }, select: requestSelect });
    return NextResponse.json({ request: safe }, { status: 201, headers: noStore });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    return NextResponse.json({ error: error instanceof PlatformBindingError ? error.message : "无法创建验证申请，请检查作品并重试" }, { status: error instanceof PlatformBindingError ? error.status : 400, headers: noStore });
  }
}
