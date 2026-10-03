import { afterEach, describe, expect, it, vi } from "vitest";
const record = vi.hoisted(() => vi.fn());
vi.mock("../lib/performance-store", () => ({ recordPerformance: record }));
import { databaseMetricKey, observeDatabaseQuery } from "../lib/database-query-observer";
describe("query metrics omit SQL and parameters", () => {
  afterEach(() => vi.restoreAllMocks());
  it("reduces all statements to fixed operation labels", () => {
    expect(databaseMetricKey("SELECT private FROM users")).toBe("db_read");
    expect(databaseMetricKey(" update users set phone='sensitive'")).toBe("db_write");
    expect(databaseMetricKey("WITH private AS (SELECT 1) SELECT * FROM private")).toBe("db_other");
    expect(databaseMetricKey("BEGIN")).toBeNull();
  });
  it("samples independent of duration and exports numbers only", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.01);
    observeDatabaseQuery({ query: "SELECT 'private-phone-address-password'", duration: 15 });
    expect(record).toHaveBeenCalledWith("db_read", 15);
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    record.mockClear();
    observeDatabaseQuery({ query: "SELECT 'private'", duration: 5000 });
    expect(record).not.toHaveBeenCalled();
  });
});
