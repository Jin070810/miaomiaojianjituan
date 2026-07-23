import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const account = await db.pointAccount.findUnique({ where: { userId: user.id } });
  const ledger = account
    ? await db.pointLedger.findMany({ where: { accountId: account.id }, orderBy: { createdAt: "desc" }, take: 100 })
    : [];
  return NextResponse.json({ balance: account?.balance ?? 0, ledger });
}
