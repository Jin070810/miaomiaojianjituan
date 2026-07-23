import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "output", "feishu");
const tables = ["members", "gifts", "redemptions", "videos", "transfers"] as const;

type Exported = {
  data?: {
    data?: unknown[][];
    fields?: { name: string; id: string }[];
    field_id_list?: string[];
    record_id_list?: string[];
  };
};

function read(name: string) {
  const files = [`${name}.records.json`, ...fs.readdirSync(root).filter((file) => file.startsWith(`${name}.page`) && file.endsWith(".json")).sort()];
  const payloads = files.map((file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) as Exported);
  const first = payloads[0];
  return {
    data: {
      data: payloads.flatMap((payload) => payload.data?.data ?? []),
      field_id_list: first.data?.field_id_list,
      record_id_list: payloads.flatMap((payload) => payload.data?.record_id_list ?? []),
    },
  } as Exported;
}

function fields(name: string) {
  return (JSON.parse(fs.readFileSync(path.join(root, `${name}.fields.json`), "utf8")) as Exported).data?.fields ?? [];
}

function normalizeCell(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === "string") return value[0];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value.join("、");
  return value;
}

function rows(name: string) {
  const payload = read(name).data;
  const definitions = new Map(fields(name).map((field) => [field.id, field.name]));
  const names = (payload?.field_id_list ?? []).map((fieldId) => definitions.get(fieldId) ?? fieldId);
  const values = payload?.data ?? [];
  const ids = payload?.record_id_list ?? [];
  return values.map((row, index) => {
    const item: Record<string, unknown> = { _recordId: ids[index] ?? `row-${index + 1}` };
    names.forEach((fieldName, fieldIndex) => {
      item[fieldName] = normalizeCell(row[fieldIndex]);
    });
    return item;
  });
}

const all = Object.fromEntries(tables.map((name) => [name, rows(name)]));
const memberRows = all.members as Record<string, unknown>[];
const videoRows = all.videos as Record<string, unknown>[];
const memberIds = memberRows.map((row) => String(row["快手ID"] ?? "").trim()).filter(Boolean);
const videoIds = videoRows.map((row) => String(row["视频ID"] ?? "").trim()).filter(Boolean);

function duplicates(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
}

const report = {
  generatedAt: new Date().toISOString(),
  counts: Object.fromEntries(tables.map((name) => [name, (all[name] as unknown[]).length])),
  members: {
    missingKuaishouId: memberRows.filter((row) => !String(row["快手ID"] ?? "").trim()).map((row) => row._recordId),
    duplicateKuaishouId: duplicates(memberIds),
    guildStatuses: [...new Set(memberRows.map((row) => String(row["公会情况"] ?? "未设置")))],
  },
  videos: {
    missingVideoId: videoRows.filter((row) => !String(row["视频ID"] ?? "").trim()).map((row) => row._recordId),
    duplicateVideoId: duplicates(videoIds),
    statuses: [...new Set(videoRows.map((row) => String(row["申请状态"] ?? "未设置")))],
    missingLink: videoRows.filter((row) => !String(row["视频链接"] ?? "").trim()).map((row) => row._recordId),
  },
  note: "该报告只做迁移前检查；历史视频的点赞与审核状态不自动重算。",
};

fs.writeFileSync(path.join(root, "inspect-report.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
