import { describe, expect, it } from "vitest";
import { isAdult, sharedDates } from "./dates";

describe("sharedDates", () => {
  it("includes a shared boundary day", () => {
    expect(sharedDates({ start: "2026-10-01", end: "2026-10-05" }, { start: "2026-10-05", end: "2026-10-08" })).toEqual({
      start: "2026-10-05",
      end: "2026-10-05",
    });
  });

  it("returns null when ranges only touch on the following day", () => {
    expect(sharedDates({ start: "2026-10-01", end: "2026-10-05" }, { start: "2026-10-06", end: "2026-10-08" })).toBeNull();
  });

  it("returns the inner range when one trip contains the other", () => {
    expect(sharedDates({ start: "2026-10-01", end: "2026-10-20" }, { start: "2026-10-04", end: "2026-10-06" })).toEqual({
      start: "2026-10-04",
      end: "2026-10-06",
    });
  });
});

describe("isAdult", () => {
  it("treats the 18th birthday as eligible and the day before as ineligible", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    expect(isAdult("2008-10-08", now)).toBe(true);
    expect(isAdult("2008-10-09", now)).toBe(false);
  });
});
