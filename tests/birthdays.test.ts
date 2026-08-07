import { describe, expect, it } from "vitest";
import { birthdayDrawBand, birthdayOccurrence, birthdayVideoBonus, shanghaiDateParts } from "@/lib/birthdays";

describe("birthday rules", () => {
  it("maps every ticket to the published probability table", () => {
    const counts = new Map<string, number>();
    for (let ticket = 0; ticket < 100_000; ticket += 1) {
      const band = birthdayDrawBand(ticket);
      const key = band.kind === "POINTS" ? `points:${band.points}` : `gift:${band.minimumCost}-${band.maximumCost}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({
      "points:10": 12_000,
      "points:20": 14_000,
      "points:50": 20_000,
      "points:100": 22_000,
      "points:200": 16_000,
      "points:500": 7_000,
      "points:1000": 1_000,
      "gift:10-199": 4_000,
      "gift:200-499": 2_000,
      "gift:500-999": 1_500,
      "gift:1000-2000": 500,
    });
  });

  it("uses February 28 for leap-day birthdays in non-leap years", () => {
    expect(birthdayOccurrence(2027, 2, 29).toISOString()).toBe("2027-02-27T16:00:00.000Z");
    expect(birthdayOccurrence(2028, 2, 29).toISOString()).toBe("2028-02-28T16:00:00.000Z");
  });

  it("uses Shanghai day boundaries", () => {
    expect(shanghaiDateParts(new Date("2026-08-06T15:59:59.999Z"))).toEqual({ year: 2026, month: 8, day: 6 });
    expect(shanghaiDateParts(new Date("2026-08-06T16:00:00.000Z"))).toEqual({ year: 2026, month: 8, day: 7 });
  });

  it("floors video bonuses and enforces the annual cap", () => {
    expect(birthdayVideoBonus(4, 0)).toBe(0);
    expect(birthdayVideoBonus(99, 0)).toBe(19);
    expect(birthdayVideoBonus(100, 490)).toBe(10);
    expect(birthdayVideoBonus(100, 500)).toBe(0);
  });
});
