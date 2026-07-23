import { describe, expect, it } from "vitest";
import { parsePagination, paginationResult } from "../lib/pagination";

describe("pagination", () => {
  it("uses bounded defaults and ignores invalid values", () => {
    const result = parsePagination(new URL("https://example.test/api/items?page=nope&take=9999"), 50, 100);
    expect(result).toEqual({ page: 1, take: 100, skip: 0 });
  });

  it("calculates a stable offset for later pages", () => {
    expect(parsePagination(new URL("https://example.test/api/items?page=3&take=25"), 50, 100)).toEqual({
      page: 3,
      take: 25,
      skip: 50,
    });
    expect(paginationResult(3, 25, 51)).toEqual({ page: 3, take: 25, total: 51, pages: 3 });
  });
});
