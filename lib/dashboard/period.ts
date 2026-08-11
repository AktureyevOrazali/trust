export type DashboardPeriod = "week" | "month" | "custom";

export interface DashboardRange {
  period: DashboardPeriod;
  from: string;
  to: string;
}

const TIME_ZONE = "Asia/Qyzylorda";
const TIME_ZONE_OFFSET = "+05:00";
const MAX_RANGE_DAYS = 366;

function currentCalendarDate(): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDateKey(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || dateKey(date) !== value ? null : date;
}

export function dashboardRange(
  period: DashboardPeriod = "month",
  requestedFrom?: string | null,
  requestedTo?: string | null,
): DashboardRange {
  const today = currentCalendarDate();
  if (period !== "custom") {
    const start = new Date(today);
    if (period === "week") start.setUTCDate(start.getUTCDate() - 6);
    else start.setUTCDate(1);
    return { period, from: dateKey(start), to: dateKey(today) };
  }

  const from = requestedFrom ? parseDateKey(requestedFrom) : null;
  const to = requestedTo ? parseDateKey(requestedTo) : null;
  if (!from || !to) {
    throw new Error("Укажите корректные даты начала и окончания периода");
  }
  if (from > to) {
    throw new Error("Дата начала периода не может быть позже даты окончания");
  }
  const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new Error(`Период не может быть длиннее ${MAX_RANGE_DAYS} дней`);
  }

  return { period, from: requestedFrom!, to: requestedTo! };
}

export function periodStartKey(range: DashboardRange): string {
  return range.from;
}

export function periodEndKey(range: DashboardRange): string {
  return range.to;
}

export function periodStartSeconds(range: DashboardRange): number {
  return Math.floor(
    Date.parse(`${range.from}T00:00:00${TIME_ZONE_OFFSET}`) / 1000,
  );
}

export function periodEndSeconds(range: DashboardRange): number {
  return Math.floor(
    Date.parse(`${range.to}T23:59:59${TIME_ZONE_OFFSET}`) / 1000,
  );
}

export function periodDates(range: DashboardRange): Date[] {
  const start = parseDateKey(range.from)!;
  const end = parseDateKey(range.to)!;
  const dates: Date[] = [];
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(new Date(date));
  }
  return dates;
}
