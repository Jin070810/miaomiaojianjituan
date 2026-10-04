import { validateRum } from "@/lib/performance-metric-model";
import { recordRum } from "@/lib/performance-store";
export const dynamic = "force-dynamic";
function empty(status: number) { return new Response(null, { status, headers: { "cache-control": "no-store" } }); }
async function boundedJson(request: Request) {
  if (!request.body) throw new Error("missing-body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 1024) throw new Error("oversize");
          chunks.push(value);
        }
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("body-timeout")), 500); }),
    ]);
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally { if (timer) clearTimeout(timer); void reader.cancel().catch(() => undefined); }
}
export async function POST(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host") || url.host;
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.slice(0, -1);
  if (request.headers.get("origin") !== protocol + "://" + host || request.headers.get("sec-fetch-site") === "cross-site") return empty(403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || Number(request.headers.get("content-length") || 0) > 1024) return empty(400);
  try {
    const input = validateRum(await boundedJson(request));
    if (!input) return empty(400);
    // Client numbers are untrusted samples, never security or financial signals.
    await recordRum(input);
    return empty(204);
  } catch { return empty(400); }
}
