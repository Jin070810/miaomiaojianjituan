export function parsePagination(url: URL, defaultTake = 50, maxTake = 100) {
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page") ?? 1) || 1));
  const take = Math.min(maxTake, Math.max(1, Math.floor(Number(url.searchParams.get("take") ?? defaultTake) || defaultTake)));
  return { page, take, skip: (page - 1) * take };
}

export function paginationResult(page: number, take: number, total: number) {
  return { page, take, total, pages: Math.max(1, Math.ceil(total / take)) };
}
