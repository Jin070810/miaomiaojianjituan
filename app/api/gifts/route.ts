import { observeApi } from "@/lib/observe-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPublicGiftCatalog } from "@/lib/gift-catalog";

async function handleGET(request: Request) {
  try {
    return NextResponse.json(await getPublicGiftCatalog(new URL(request.url)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "礼品分页或筛选参数不正确" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    throw error;
  }
}

export const GET = observeApi("gifts_get", handleGET);
