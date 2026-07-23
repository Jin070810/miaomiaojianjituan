import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import "dotenv/config";
import { db } from "../lib/db";

const sourceRoot = path.resolve(process.cwd(), "output", "feishu");
const assetRoot = path.resolve(process.cwd(), "public", "gifts", "feishu");
const manifestPath = path.join(sourceRoot, "gift-assets-manifest.json");

type Attachment = { file_token?: string; name?: string; size?: number };
type GiftRow = { _recordId: string; name: unknown; attachments: Attachment[] };

function readGiftRows(): GiftRow[] {
  const payload = JSON.parse(fs.readFileSync(path.join(sourceRoot, "gifts.records.json"), "utf8")) as { data?: { data?: unknown[][]; field_id_list?: string[]; record_id_list?: string[] } };
  const fields = JSON.parse(fs.readFileSync(path.join(sourceRoot, "gifts.fields.json"), "utf8")) as { data?: { fields?: { id: string; name: string }[] } };
  const names = new Map((fields.data?.fields ?? []).map((field) => [field.id, field.name]));
  const columns = (payload.data?.field_id_list ?? []).map((id) => names.get(id) ?? id);
  return (payload.data?.data ?? []).map((row, index) => {
    const values = row as unknown[];
    const attachmentValue = values[columns.indexOf("商品图")];
    const attachments = Array.isArray(attachmentValue)
      ? attachmentValue.filter((item: unknown): item is Attachment => Boolean(item && typeof item === "object" && "file_token" in item))
      : [];
    return {
      _recordId: payload.data?.record_id_list?.[index] ?? `row-${index + 1}`,
      name: values[columns.indexOf("商品名")],
      attachments,
    };
  });
}

function extension(name: string) {
  const ext = path.extname(name).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext) ? ext : ".bin";
}

function cliCommand(args: string[], output: string) {
  if (process.platform !== "win32") return { command: "lark-cli", args: [...args, "-o", output] };
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const command = `& lark-cli ${args.map(quote).join(" ")} -o ${quote(output)}`;
  return { command: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command] };
}

function download(token: string, output: string) {
  const filename = path.basename(output);
  const invocation = cliCommand(["api", "GET", `/open-apis/drive/v1/medias/${token}/download`], filename);
  return new Promise<void>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, { windowsHide: true, cwd: assetRoot });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && fs.existsSync(output) && fs.statSync(output).size > 0) resolve();
      else reject(new Error(stderr.trim() || `lark-cli exited with ${code}`));
    });
  });
}

async function main() {
  fs.mkdirSync(assetRoot, { recursive: true });
  const rows = readGiftRows();
  const manifest: Record<string, { giftName: string; recordId: string; token: string; filename: string; sourceName: string }> = {};
  let downloaded = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const giftName = String(row.name ?? "").trim();
    const attachment = row.attachments[0];
    const token = attachment?.file_token;
    if (!giftName || !token) {
      skipped += 1;
      continue;
    }
    const filename = `${token}${extension(attachment.name ?? "")}`;
    const absolute = path.join(assetRoot, filename);
    if (!fs.existsSync(absolute) || fs.statSync(absolute).size === 0) {
      await download(token, absolute);
      downloaded += 1;
    }
    const publicUrl = `/gifts/feishu/${filename}`;
    const gift = await db.gift.findFirst({ where: { name: giftName }, orderBy: { createdAt: "asc" } });
    if (!gift) {
      skipped += 1;
      continue;
    }
    if (gift.imageUrl !== publicUrl) {
      await db.$transaction(async (tx) => {
        const before = await tx.gift.findUniqueOrThrow({ where: { id: gift.id } });
        await tx.gift.update({ where: { id: gift.id }, data: { imageUrl: publicUrl } });
        await tx.auditLog.create({
          data: {
            action: "FEISHU_GIFT_IMAGE_IMPORTED",
            entity: "Gift",
            entityId: gift.id,
            beforeValue: { imageUrl: before.imageUrl },
            afterValue: { imageUrl: publicUrl, sourceRecordId: row._recordId, sourceName: attachment.name ?? null },
            reason: "飞书商品图附件迁移",
          },
        });
      });
      updated += 1;
    }
    manifest[gift.id] = { giftName, recordId: row._recordId, token, filename, sourceName: attachment.name ?? "" };
  }
  fs.writeFileSync(manifestPath, JSON.stringify({ generatedAt: new Date().toISOString(), downloaded, updated, skipped, assets: manifest }, null, 2), "utf8");
  console.log(JSON.stringify({ downloaded, updated, skipped, manifestPath }, null, 2));
}

main().finally(() => db.$disconnect());
