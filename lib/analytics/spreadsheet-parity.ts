import type {
  GroupHours,
  GroupMetricRow,
  GroupMetrics,
  StudentFormulaRow,
  StudentMetrics,
  TeacherRate,
} from "./types.ts";

function average(values: number[]): number {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function countStatus(rows: StudentFormulaRow[], status: string): number {
  return rows.filter((row) => row.status === status).length;
}

function dateReached(value: string | null, today: Date): boolean {
  if (!value) return false;
  const timestamp = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(timestamp) && timestamp <= today.getTime();
}

export function rowRenewals(months: number): number | null {
  return months <= 0 ? null : months - 1;
}

export function calculateStudentMetrics(
  input: StudentFormulaRow[],
  today = new Date(),
): StudentMetrics {
  const rows = [...input].sort(
    (left, right) =>
      right.ltv - left.ltv || left.name.localeCompare(right.name, "ru"),
  );
  const total = rows.length;
  const active = countStatus(rows, "Активен");
  const frozen = countStatus(rows, "Заморозка");
  const finished = countStatus(rows, "Закончил");
  const booking = countStatus(rows, "Бронь");
  const renewals = rows.flatMap((row) =>
    row.renewals == null ? [] : [row.renewals],
  );
  const renewalSum = renewals.reduce((sum, value) => sum + value, 0);
  const finishedOpportunities = rows.filter(
    (row) =>
      row.status === "Закончил" &&
      row.months > 0 &&
      dateReached(row.endDate, today),
  ).length;
  const opportunityCount = renewalSum + finishedOpportunities;
  const renewalRate = opportunityCount > 0
    ? renewalSum / opportunityCount
    : 0;

  // The workbook calculates LTV from E6:E, which excludes the first three
  // data rows after the deterministic descending-LTV compatibility order.
  const ltvCompatibilityRange = rows.slice(3);
  const positiveLifetimes = rows
    .filter((row) => row.months > 0)
    .map((row) => row.months);

  return {
    total,
    active,
    frozen,
    finished,
    booking,
    activeShare: total > 0 ? active / total : 0,
    frozenShare: total > 0 ? frozen / total : 0,
    finishedShare: total > 0 ? finished / total : 0,
    bookingShare: total > 0 ? booking / total : 0,
    renewalRate,
    churnRate: 1 - renewalRate,
    averageLifetime: average(positiveLifetimes),
    maximumLifetime: Math.max(0, ...rows.map((row) => row.months)),
    averageRenewals: average(renewals),
    maximumRenewals: Math.max(0, ...renewals),
    averageLtv: average(ltvCompatibilityRange.map((row) => row.ltv)),
    maximumLtv: Math.max(0, ...ltvCompatibilityRange.map((row) => row.ltv)),
  };
}

export function calculateGroupMetrics(
  students: StudentFormulaRow[],
  groupHours: GroupHours[],
  teacherRates: TeacherRate[],
): GroupMetrics {
  const orderedStudents = [...students].sort(
    (left, right) =>
      right.ltv - left.ltv ||
      left.name.localeCompare(right.name, "ru") ||
      left.id.localeCompare(right.id),
  );
  const hoursByGroup = new Map(
    groupHours.map((entry) => [entry.group, entry.hours]),
  );
  const rateByTeacher = new Map(
    teacherRates.map((entry) => [entry.teacher, entry.rate]),
  );
  const uniqueGroups = [...new Set(
    orderedStudents
      .map((student) => student.group)
      .filter((group) => group !== "" && group !== "ИНД"),
  )];
  // The UNIQUE formula starts in Groups!A1, while B:G calculations start on
  // row 2. Preserve the workbook's resulting exclusion of the first group.
  const groups = uniqueGroups.slice(1);

  const rows: GroupMetricRow[] = groups.map((group) => {
    const members = orderedStudents.filter((student) => student.group === group);
    const teacher = members[0]?.teacher ?? "";
    const hours = hoursByGroup.get(group) ?? 0;
    const hasRate = rateByTeacher.has(teacher);
    const rate = rateByTeacher.get(teacher) ?? 0;
    const revenue = members
      .filter((student) => student.status === "Активен")
      .reduce((sum, student) => sum + student.subscriptionAmount, 0);
    const expense = hasRate ? hours * rate : 0;

    return {
      group,
      teacher,
      studentCount: members.length,
      revenue,
      hours,
      expense,
      grossProfit: revenue - expense,
      comment: hasRate ? "" : "Ставка учителя не найдена",
    };
  });

  return {
    rows,
    averageRevenue: average(rows.map((row) => row.revenue)),
    maximumRevenue: Math.max(0, ...rows.map((row) => row.revenue)),
    averageGrossProfit: average(rows.map((row) => row.grossProfit)),
    maximumGrossProfit: Math.max(0, ...rows.map((row) => row.grossProfit)),
  };
}
