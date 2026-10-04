import { NextResponse } from "next/server";
import { requireVideoReviewOperator } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/security";
import { SECONDARY_REVIEW_RETIRED_MESSAGE } from "@/lib/video-review-policy";

// Keep the old endpoint explicit for already-open tabs and old clients. It must
// never process a historical pending task, regardless of the operator's role.
export async function POST(request: Request, _context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    await requireVideoReviewOperator();
    return NextResponse.json({ error: SECONDARY_REVIEW_RETIRED_MESSAGE, code: "SECONDARY_REVIEW_RETIRED" }, { status: 410 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无权访问" }, { status: 403 });
  }
}
