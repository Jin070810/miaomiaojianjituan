/** Platform-internal opaque identifiers are never derived from a nickname or a URL query. */
export function stableAuthorUid(value: unknown) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== "string") return null;
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function balancedJson(text: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const character = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{" || character === "[") depth += 1;
    else if (character === "}" || character === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function jsonDocuments(html: string) {
  const documents: unknown[] = [];
  let assignmentCount = 0;
  const add = (text: string | null) => {
    if (!text || documents.length >= 64) return;
    try { documents.push(JSON.parse(text)); } catch { /* Unsupported JS is never evaluated. */ }
  };
  add(html.trim());
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const body = match[1].trim();
    add(body);
    for (const assignment of body.matchAll(/(?:\bwindow\s*\.\s*)?(?:INIT_STATE|__INITIAL_STATE__|__NEXT_DATA__|__NUXT__)\s*=\s*(?=[{[])/g)) {
      if (++assignmentCount > 64) throw new Error("快手页面初始化数据过多，无法确认作品");
      add(balancedJson(body, assignment.index! + assignment[0].length));
    }
  }
  return documents;
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function text(value: unknown) { return typeof value === "string" ? value.trim() || null : null; }

function imageUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
}

function parseWork(data: RecordValue, parent: RecordValue | null) {
  const photoId = typeof data.photoId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(data.photoId) ? data.photoId : null;
  const likes = integer(data.likeCount);
  const timestamp = integer(data.timestamp);
  if (!photoId || likes === null || timestamp === null) return null;
  const publishedAt = new Date(timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp);
  if (Number.isNaN(publishedAt.getTime())) return null;
  // Only an explicit photo.author relationship, or a sibling whose UID matches
  // photo.userId, can supply author fields. Page-level viewer/comment data cannot.
  const directUid = stableAuthorUid(data.userId);
  const embeddedAuthor = record(data.author) ?? (parent?.photo === data ? record(parent.author) : null);
  const siblingUser = parent?.photo === data ? record(parent.user) ?? record(parent.userInfo) : null;
  const siblingUid = stableAuthorUid(siblingUser?.userId ?? siblingUser?.id);
  const author = embeddedAuthor ?? (directUid && directUid === siblingUid ? siblingUser : null);
  const embeddedUid = stableAuthorUid(author?.userId ?? author?.id ?? author?.uid);
  const authorUid = directUid && embeddedUid && directUid !== embeddedUid ? null : directUid ?? embeddedUid;
  const owner = text(data.userName) ?? text(author?.userName) ?? text(author?.name) ?? text(author?.nickname);
  if (!owner) return null;
  return {
    photoId, likes, publishedAt, owner, authorUid,
    views: integer(data.viewCount),
    commentCount: integer(data.commentCount),
    caption: text(data.caption),
    coverUrl: imageUrl(data.coverUrl ?? data.cover),
  };
}

/** Read bounded JSON, never execute scripts or combine independent regex matches. */
export function parseStructuredKuaishouWork(html: string, expectedPhotoId?: string | null) {
  if (Buffer.byteLength(html, "utf8") > 5_000_000) throw new Error("快手页面响应过大，已停止处理");
  const stack = jsonDocuments(html).map((value) => ({ value, parent: null as RecordValue | null }));
  const works: NonNullable<ReturnType<typeof parseWork>>[] = [];
  let visited = 0;
  while (stack.length) {
    if (++visited > 30_000) throw new Error("快手页面结构过大，无法确认作品数据");
    const { value, parent } = stack.pop()!;
    if (Array.isArray(value)) {
      for (const child of value) stack.push({ value: child, parent: null });
      continue;
    }
    const data = record(value);
    if (!data) continue;
    const work = parseWork(data, parent);
    if (work) works.push(work);
    for (const child of Object.values(data)) {
      if (child && typeof child === "object") stack.push({ value: child, parent: data });
    }
  }
  if (!works.length) throw new Error("快手页面未返回同一作品的完整数据，请稍后重试");
  const matches = expectedPhotoId ? works.filter((work) => work.photoId === expectedPhotoId) : works;
  if (!matches.length) throw new Error("快手页面没有返回目标作品的数据，请稍后重试");
  if (new Set(matches.map((work) => work.photoId)).size !== 1) throw new Error("无法确认页面中唯一的目标作品，请使用作品长链接");
  if (new Set(matches.map((work) => JSON.stringify(work))).size !== 1) throw new Error("同一作品的数据不一致，请稍后重试");
  return matches[0];
}
