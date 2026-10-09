export type DateRange = { start: string; end: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(value: string, label: string): void {
  if (!DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${label} must be an ISO date`);
  }
}

/** Inclusive overlap of destination-local dates. Equal boundary days count as overlap. */
export function sharedDates(left: DateRange, right: DateRange): DateRange | null {
  assertIsoDate(left.start, "start");
  assertIsoDate(left.end, "end");
  assertIsoDate(right.start, "start");
  assertIsoDate(right.end, "end");
  if (left.end < left.start || right.end < right.start) return null;
  const start = left.start > right.start ? left.start : right.start;
  const end = left.end < right.end ? left.end : right.end;
  if (start > end) return null;
  return { start, end };
}

export function isAdult(birthDate: string, now = new Date()): boolean {
  assertIsoDate(birthDate, "birthDate");
  const [year, month, day] = birthDate.split("-").map(Number) as [number, number, number];
  const adultYear = year + 18;
  const today = now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
  const adultOn = adultYear * 10000 + month * 100 + day;
  return today >= adultOn;
}

export function assertFutureInstant(startsAt: Date, now = new Date()): void {
  if (startsAt.getTime() <= now.getTime()) {
    throw new Error("past");
  }
}
