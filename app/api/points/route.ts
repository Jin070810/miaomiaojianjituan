import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parsePagination, paginationResult } from "@/lib/pagination";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const account = await db.pointAccount.findUnique({ where: { userId: user.id } });
  const { page, take, skip } = parsePagination(new URL(request.url), 50, 100);
  const total = account ? await db.pointLedger.count({ where: { accountId: account.id } }) : 0;
  const ledger = account
    ? await db.pointLedger.findMany({ where: { accountId: account.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take })
    : [];
  return NextResponse.json({ balance: account?.balance ?? 0, ledger, pagination: paginationResult(page, take, total) });
}
