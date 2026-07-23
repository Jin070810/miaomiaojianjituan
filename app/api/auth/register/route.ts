import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertSameOrigin, encryptPhone, getClientIp, rateLimitResponse, hashPassword } from "@/lib/security";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSession } from "@/lib/auth";

const schema = z.object({
  kuaishouId: z.string().trim().min(2).max(80),
  nickname: z.string().trim().min(1).max(80),
  password: z.string().min(8).max(128),
  guildStatus: z.string().trim().max(30).optional(),
  boundPhone: z.string().trim().regex(/^1\d{10}$/).optional(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = schema.parse(await request.json());
    await enforceRateLimit(`register:${getClientIp(request)}`, 5, 3600);
    if (input.guildStatus === "未绑定" && !input.boundPhone) {
      return NextResponse.json({ error: "未绑定公会时需要填写绑定手机号" }, { status: 400 });
    }
    const user = await db.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({ where: { kuaishouId: { equals: input.kuaishouId, mode: "insensitive" } } });
      if (existing) throw new Error("该快手ID已注册");
      const created = await tx.user.create({
        data: {
          kuaishouId: input.kuaishouId,
          nickname: input.nickname,
          passwordHash: await hashPassword(input.password),
          guildStatus: input.guildStatus,
          boundPhoneEnc: input.boundPhone ? encryptPhone(input.boundPhone) : null,
          account: { create: { balance: 0 } },
        },
      });
      await tx.guildStatusHistory.create({
        data: { userId: created.id, status: input.guildStatus ?? "未设置", reason: "注册" },
      });
      return created;
    });
    await createSession(user.id);
    return NextResponse.json({ user: { id: user.id, kuaishouId: user.kuaishouId, nickname: user.nickname } }, { status: 201 });
  } catch (error) {
    const limited = rateLimitResponse(error);
    if (limited) return limited;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "该快手ID已注册" }, { status: 409 });
    }
    const message = error instanceof z.ZodError ? "注册信息格式不正确" : error instanceof Error ? error.message : "注册失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
