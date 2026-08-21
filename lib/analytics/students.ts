import type {
  AnalyticsRepository,
  DailySnapshot,
} from "../../db/repositories/analytics.ts";
import { analyticsRepository } from "../../db/repositories/analytics.ts";
import { normalizeAlphaRecords, type NormalizedStudent } from "./alpha-normalize.ts";
import { calculateStudentMetrics } from "./spreadsheet-parity.ts";
import type {
  AnalyticsFilterOptions,
  AnalyticsFilters,
  StudentRegistryRow,
  StudentRiskRow,
  StudentsDashboardData,
  StudentTrendPoint,
} from "./types.ts";

const ANALYTICS_ENTITIES = [
  "branch",
  "customer",
  "group_customer",
  "group",
  "teacher",
  "study_status",
  "lesson",
  "pay",
  "tariff",
  "customer_tariff",
  "log",
];

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "ru"),
  );
}

export function matchesStudentFilters(
  student: NormalizedStudent,
  filters: AnalyticsFilters,
): boolean {
  return (
    (!filters.branch || student.branchId === filters.branch) &&
    (!filters.teacher || student.teachers.includes(filters.teacher)) &&
    (!filters.group || student.groups.includes(filters.group)) &&
    (!filters.status || student.status === filters.status)
  );
}

export function analyticsFilterOptions(
  students: NormalizedStudent[],
  branches: Map<string, string>,
): AnalyticsFilterOptions {
  const availableBranchIds = new Set(students.map((student) => student.branchId));
  return {
    branches: [...branches.entries()]
      .filter(([value]) => availableBranchIds.has(value))
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label, "ru")),
    teachers: unique(students.flatMap((student) => student.teachers)),
    groups: unique(students.flatMap((student) => student.groups)),
    statuses: unique(students.map((student) => student.status)),
  };
}

function registryRow(student: NormalizedStudent): StudentRegistryRow {
  return {
    id: student.id,
    name: student.name,
    attendedLessons: student.attendedLessons,
    paymentCount: student.paymentCount,
    ltv: student.ltv,
    group: student.group,
    teacher: student.teacher,
    startDate: student.startDate,
    endDate: student.endDate,
    status: student.status,
    months: student.months,
    renewals: student.renewals,
    subscriptionAmount: student.subscriptionAmount,
    lessonBalance: student.lessonBalance,
    activeTariff: student.activeTariff,
  };
}

function studentRisks(students: NormalizedStudent[], today: Date): StudentRiskRow[] {
  const todayTime = Date.parse(`${today.toISOString().slice(0, 10)}T12:00:00Z`);
  const day = 24 * 60 * 60 * 1000;
  return students.flatMap((student) => {
    if (student.status !== "Активен") return [];
    const reasons: string[] = [];
    if (student.tariffEndDate) {
      const daysUntilEnd = (Date.parse(`${student.tariffEndDate}T12:00:00Z`) - todayTime) / day;
      if (daysUntilEnd >= 0 && daysUntilEnd <= 14) reasons.push("Абонемент заканчивается в течение 14 дней");
    }
    if (student.lastAttendance) {
      const daysSinceAttendance = (todayTime - Date.parse(`${student.lastAttendance}T12:00:00Z`)) / day;
      if (daysSinceAttendance > 14) reasons.push("Нет посещений более 14 дней");
    } else if (student.attendedLessons === 0) {
      reasons.push("Нет зафиксированных посещений");
    }
    if (student.lessonBalanceKnown && student.lessonBalance <= 0) {
      reasons.push("Баланс занятий исчерпан");
    }
    return reasons.length > 0
      ? [{
          id: student.id,
          name: student.name,
          group: student.group,
          tariffEndDate: student.tariffEndDate,
          lessonBalance: student.lessonBalance,
          reasons,
        }]
      : [];
  });
}

function sixMonthsAgo(today: Date): string {
  return new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth() - 5,
    1,
  )).toISOString().slice(0, 10);
}

function trendPoints(
  snapshots: DailySnapshot[],
  branch: string | undefined,
): StudentTrendPoint[] {
  const totals = new Map<string, { active: number; total: number }>();
  for (const snapshot of snapshots) {
    if (branch && snapshot.branchId !== branch) continue;
    const current = totals.get(snapshot.snapshotDate) ?? { active: 0, total: 0 };
    current.active += snapshot.activeStudents;
    current.total += snapshot.totalStudents;
    totals.set(snapshot.snapshotDate, current);
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, values]) => ({ date, ...values }));
}

export async function getStudentsDashboard(
  filters: AnalyticsFilters,
  repository: AnalyticsRepository = analyticsRepository,
  today = new Date(),
): Promise<StudentsDashboardData> {
  const [records, snapshots] = await Promise.all([
    repository.listAlphaRecords(ANALYTICS_ENTITIES),
    repository.listDailySnapshots(sixMonthsAgo(today)),
  ]);
  const normalized = normalizeAlphaRecords(records, today);
  const selected = normalized.students.filter((student) =>
    matchesStudentFilters(student, filters),
  );

  return {
    metrics: calculateStudentMetrics(selected, today),
    trend: trendPoints(snapshots, filters.branch),
    risks: studentRisks(selected, today),
    filters: analyticsFilterOptions(normalized.students, normalized.branches),
    rows: selected
      .sort((left, right) => right.ltv - left.ltv || left.name.localeCompare(right.name, "ru"))
      .map(registryRow),
    warnings: normalized.warnings,
    freshness: normalized.freshness,
  };
}
