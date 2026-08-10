export type DashboardPeriod = "week" | "month";

const TIME_ZONE = "Asia/Qyzylorda";
const TIME_ZONE_OFFSET = "+05:00";

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

export function periodStartDate(period: DashboardPeriod): Date {
  const start = currentCalendarDate();
  if (period === "week") start.setUTCDate(start.getUTCDate() - 6);
  else start.setUTCDate(1);
  return start;
}

export function periodStartKey(period: DashboardPeriod): string {
  return periodStartDate(period).toISOString().slice(0, 10);
}

export function periodStartSeconds(period: DashboardPeriod): number {
  return Math.floor(
    Date.parse(`${periodStartKey(period)}T00:00:00${TIME_ZONE_OFFSET}`) / 1000,
  );
}

export function periodDates(period: DashboardPeriod): Date[] {
  const start = periodStartDate(period);
  const end = currentCalendarDate();
  const dates: Date[] = [];
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(new Date(date));
  }
  return dates;
}
