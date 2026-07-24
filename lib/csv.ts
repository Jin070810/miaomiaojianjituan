export function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = typeof value === "string" && /^[=+\-@]/.test(value) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>) {
  const bom = "\uFEFF";
  return bom + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function maskedIp(value: string | null | undefined) {
  if (!value) return "";
  if (value.includes(":")) {
    const parts = value.split(":");
    return `${parts.slice(0, 2).join(":")}:****`;
  }
  const parts = value.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.***.***` : "***";
}
