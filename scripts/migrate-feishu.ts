import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import crypto from "node:crypto";
import { db } from "../lib/db";
import { encryptPhone, hashPassword } from "../lib/security";

const root = path.resolve(process.cwd(), "output", "feishu");
const apply = process.argv.includes("--apply");
const allowConflicts = process.argv.includes("--allow-conflicts");
const adminIds = new Set((process.env.ADMIN_KUAISHOU_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean));

type Payload = { data?: { data?: unknown[][]; field_id_list?: string[]; record_id_list?: string[] } };
type Field = { id: string; name: string };

function table(name: string) {
  const recordFiles = [`${name}.records.json`, ...fs.readdirSync(root).filter((file) => file.startsWith(`${name}.page`) && file.endsWith(".json")).sort()];
  const payloads = recordFiles.map((file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) as Payload);
  const record: Payload = {
    data: {
      data: payloads.flatMap((payload) => payload.data?.data ?? []),
      field_id_list: payloads[0].data?.field_id_list,
      record_id_list: payloads.flatMap((payload) => payload.data?.record_id_list ?? []),
    },
  };
  const fieldPayload = JSON.parse(fs.readFileSync(path.join(root, `${name}.fields.json`), "utf8")) as { data?: { fields?: Field[] } };
  const definitions = new Map((fieldPayload.data?.fields ?? []).map((field) => [field.id, field.name]));
  const ids = record.data?.field_id_list ?? [];
  const names = ids.map((id) => definitions.get(id) ?? id);
  return (record.data?.data ?? []).map((row, index) => {
    const item: Record<string, unknown> = { _recordId: record.data?.record_id_list?.[index] ?? `row-${index + 1}` };
    names.forEach((name, column) => { item[name] = row[column]; });
    return item;
  });
}

function text(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("、");
  return value === null || value === undefined ? "" : String(value);
}

function number(value: unknown) {
  const parsed = Number(text(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.floor(parsed) : 0;
}

function linkedId(value: unknown) {
  const item = Array.isArray(value) ? value[0] : value;
  if (item && typeof item === "object" && "id" in item) return String((item as { id: unknown }).id);
  const raw = text(value);
  try {
    const parsed = JSON.parse(raw);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    return first && typeof first === "object" && "id" in first ? String(first.id) : raw;
  } catch {
    return raw;
  }
}

function date(value: unknown) {
  const parsed = new Date(typeof value === "number" ? value : text(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

const members = table("members");
const gifts = table("gifts");
const videos = table("videos");
const redemptions = table("redemptions");
const transfers = table("transfers");
const report: Record<string, unknown> = { apply, imported: {}, conflicts: [] };
const conflicts = report.conflicts as unknown[];
const usersByKuaishouId = new Map<string, string>();
const importedLegacy = new Set<string>();

function duplicateValues(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count > 1);
}

const duplicateMemberIds = duplicateValues(members.map((row) => text(row["快手ID"])));
const duplicateVideoIds = duplicateValues(videos.map((row) => text(row["视频ID"])));
if (apply && !allowConflicts && (duplicateMemberIds || duplicateVideoIds)) {
  throw new Error("检测到重复快手 ID 或视频 ID。请先审阅 inspect-report.json，确认保留记录后使用 --allow-conflicts 执行迁移。");
}

async function legacy(sourceTable: string, sourceId: string, rawValue: unknown) {
  const key = `${sourceTable}:${sourceId}`;
  if (importedLegacy.has(key)) return;
  importedLegacy.add(key);
  if (apply) await db.legacyImport.upsert({
    where: { sourceTable_sourceId: { sourceTable, sourceId } },
    create: { sourceTable, sourceId, rawValue: rawValue as object },
    update: {},
  });
}

async function main() {
  for (const row of members) {
    const kuaishouId = text(row["快手ID"]).trim();
    if (!kuaishouId) continue;
    const existing = usersByKuaishouId.get(kuaishouId) ?? (apply ? (await db.user.findUnique({ where: { kuaishouId } }))?.id : undefined);
    if (existing) {
      conflicts.push({ table: "members", recordId: row._recordId, type: "duplicate-kuaishou-id", kuaishouId });
      usersByKuaishouId.set(kuaishouId, existing);
      await legacy("members", String(row._recordId), row);
      continue;
    }
    const password = text(row["密码"]) || crypto.randomBytes(12).toString("base64url");
    const boundPhone = text(row["快手绑定的手机号"]).trim();
    const data = {
      kuaishouId,
      nickname: text(row["快手昵称"]).trim() || kuaishouId,
      passwordHash: await hashPassword(password),
      role: adminIds.has(kuaishouId) ? "ADMIN" as const : "MEMBER" as const,
      guildStatus: text(row["公会情况"]).trim() || null,
      boundPhoneEnc: apply && boundPhone ? encryptPhone(boundPhone) : null,
      invited: text(row["是否邀请"]).includes("已"),
      account: { create: { balance: number(row["积分数量"]) } },
    };
    if (apply) {
      const user = await db.user.create({ data, include: { account: true } });
      usersByKuaishouId.set(kuaishouId, user.id);
      if (user.account && user.account.balance !== 0) {
        await db.pointLedger.create({
          data: {
            accountId: user.account.id,
            type: "ADMIN_ADJUSTMENT",
            amount: user.account.balance,
            balanceAfter: user.account.balance,
            note: "飞书迁移期初余额",
            idempotencyKey: `feishu-opening-balance-${row._recordId}`,
          },
        });
      }
      await db.guildStatusHistory.create({ data: { userId: user.id, status: data.guildStatus ?? "未设置", reason: "飞书迁移" } });
    } else {
      usersByKuaishouId.set(kuaishouId, `dry-${row._recordId}`);
    }
    await legacy("members", String(row._recordId), row);
  }
  report.imported = { members: members.length, gifts: gifts.length, videos: videos.length, redemptions: redemptions.length, transfers: transfers.length };
  if (apply) {
    const giftByName = new Map<string, string>();
    const giftByLegacyId = new Map<string, string>();
    for (const row of gifts) {
      const name = text(row["商品名"]).trim();
      if (!name) continue;
      const gift = await db.gift.create({ data: { name, pointsCost: number(row["所需积分"]), stock: number(row["库存"]), imageUrl: text(row["商品图"]) || null } });
      giftByName.set(name, gift.id);
      giftByLegacyId.set(String(row._recordId), gift.id);
      await legacy("gifts", String(row._recordId), { ...row, importedId: gift.id });
    }
    for (const row of videos) {
      const kuaishouId = text(row["快手ID"]).trim();
      const userId = usersByKuaishouId.get(kuaishouId);
      if (!userId || userId.startsWith("dry-")) {
        conflicts.push({ table: "videos", recordId: row._recordId, type: "missing-user", kuaishouId });
        continue;
      }
      const sourceUrl = text(row["视频链接"]).trim() || "https://invalid.local/legacy";
      const submittedAt = date(row["提交日期"]) ?? new Date();
      const status = text(row["申请状态"]).includes("通过") ? "APPROVED" : text(row["申请状态"]).includes("驳回") ? "REJECTED" : "PENDING_REVIEW";
      const photoId = text(row["视频ID"]).trim();
      const taken = photoId ? await db.videoSubmission.findFirst({ where: { photoId, status: { in: ["PROCESSING", "PENDING_REVIEW", "APPROVED"] } } }) : null;
      const video = await db.videoSubmission.create({
        data: {
          userId, sourceUrl, requestUrl: sourceUrl, sourceKind: "legacy", status,
          photoId: taken ? null : (photoId || null),
          likes: number(row["视频点赞量"]) || null,
          points: number(row["可兑换积分"]),
          submittedNickname: text(row["快手昵称"]).trim() || kuaishouId,
          submittedAt, processedAt: submittedAt, reviewedAt: submittedAt,
          reviewReason: text(row["备注"]) || null,
          idempotencyKey: `feishu-video-${row._recordId}`,
          rawPayload: row as object,
        },
      });
      await legacy("videos", String(row._recordId), { ...row, importedId: video.id });
    }
    for (const row of redemptions) {
      const kuaishouId = text(row["快手ID"]).trim();
      const userId = usersByKuaishouId.get(kuaishouId);
      const giftName = text(row["选择商品"]).trim();
      const linkedGiftId = linkedId(row["选择商品"]);
      const giftId = giftByLegacyId.get(linkedGiftId) ?? giftByName.get(giftName) ?? [...giftByName.entries()].find(([name]) => giftName.includes(name))?.[1];
      if (!userId || !giftId) {
        conflicts.push({ table: "redemptions", recordId: row._recordId, type: "missing-user-or-gift", kuaishouId, giftName });
        continue;
      }
      const cost = number(row["所需积分"]);
      const statusText = text(row["审核状态"]);
      const status = statusText.includes("拒") || statusText.includes("驳") ? "REJECTED" : statusText.includes("完成") ? "FULFILLED" : statusText.includes("通过") ? "APPROVED" : "PENDING";
      const order = await db.redemptionOrder.create({
        data: {
          userId, giftId, quantity: 1, unitCost: cost, totalCost: cost, status,
          shippingInfo: text(row["收货信息"]) || null, note: text(row["备注"]) || null,
          idempotencyKey: `feishu-redemption-${row._recordId}`,
        },
      });
      await legacy("redemptions", String(row._recordId), { ...row, importedId: order.id });
    }
    for (const row of transfers) {
      const senderId = usersByKuaishouId.get(text(row["快手ID"]).trim());
      const receiverId = usersByKuaishouId.get(text(row["转入ID"]).trim());
      if (!senderId || !receiverId || senderId.startsWith("dry-") || receiverId.startsWith("dry-")) {
        conflicts.push({ table: "transfers", recordId: row._recordId, type: "missing-user" });
        continue;
      }
      const transfer = await db.transfer.create({
        data: {
          senderId, receiverId, amount: number(row["转入数量"]),
          status: text(row["处理状态"]).includes("拒") ? "REJECTED" : "COMPLETED",
          note: text(row["对方昵称"]) || null,
          idempotencyKey: `feishu-transfer-${row._recordId}`,
          createdAt: date(row["提交时间"]) ?? new Date(),
        },
      });
      await legacy("transfers", String(row._recordId), { ...row, importedId: transfer.id });
    }
  }
  fs.writeFileSync(path.join(root, "migration-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().finally(() => db.$disconnect());
