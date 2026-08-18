import type { AnalyticsRepository } from "../../db/repositories/analytics.ts";
import { analyticsRepository } from "../../db/repositories/analytics.ts";
import { ensureTeacherRates } from "../../db/repositories/teacher-rates.ts";
import { normalizeAlphaRecords } from "./alpha-normalize.ts";
import { calculateGroupMetrics } from "./spreadsheet-parity.ts";
import { analyticsFilterOptions, matchesStudentFilters } from "./students.ts";
import type {
  AnalyticsFilters,
  GroupMetricRow,
  GroupsDashboardData,
  TeacherRollupRow,
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
];

function average(values: number[]): number {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function teacherRollups(rows: GroupMetricRow[]): TeacherRollupRow[] {
  const rollups = new Map<string, TeacherRollupRow>();
  for (const row of rows) {
    const teacher = row.teacher || "Не указан";
    const current = rollups.get(teacher) ?? {
      teacher,
      groups: 0,
      students: 0,
      hours: 0,
      revenue: 0,
      expense: 0,
      grossProfit: 0,
    };
    current.groups += 1;
    current.students += row.studentCount;
    current.hours += row.hours;
    current.revenue += row.revenue;
    current.expense += row.expense;
    current.grossProfit += row.grossProfit;
    rollups.set(teacher, current);
  }
  return [...rollups.values()].sort(
    (left, right) => right.grossProfit - left.grossProfit || left.teacher.localeCompare(right.teacher, "ru"),
  );
}

export async function getGroupsDashboard(
  filters: AnalyticsFilters,
  repository: AnalyticsRepository = analyticsRepository,
  today = new Date(),
): Promise<GroupsDashboardData> {
  const records = await repository.listAlphaRecords(ANALYTICS_ENTITIES);
  const normalized = normalizeAlphaRecords(records, today);
  const teacherRateSettings = await ensureTeacherRates(records);
  const teacherRates = new Map(
    teacherRateSettings.map((setting) => [setting.teacher, setting.rate]),
  );
  const selectedIds = new Set(
    normalized.students
      .filter((student) => matchesStudentFilters(student, {
        branch: filters.branch,
        status: filters.status,
      }))
      .map((student) => student.id),
  );
  const groupStudents = normalized.groupStudents.filter((student) =>
    selectedIds.has(student.id) &&
    (!filters.teacher || student.teacher === filters.teacher),
  );
  const calculated = calculateGroupMetrics(
    groupStudents,
    [...normalized.groupHours].map(([group, hours]) => ({ group, hours })),
    [...teacherRates].map(([teacher, rate]) => ({ teacher, rate })),
  );
  const rows = calculated.rows.filter((row) => !filters.group || row.group === filters.group);
  const metrics = {
    rows,
    averageRevenue: average(rows.map((row) => row.revenue)),
    maximumRevenue: Math.max(0, ...rows.map((row) => row.revenue)),
    averageGrossProfit: average(rows.map((row) => row.grossProfit)),
    maximumGrossProfit: Math.max(0, ...rows.map((row) => row.grossProfit)),
  };

  const missingRateCount = groupStudents.filter((student) =>
    student.teacher && !(teacherRates.get(student.teacher) ?? 0),
  ).length;
  const warnings = normalized.warnings.filter((warning) => warning.code !== "missingRate");
  if (missingRateCount > 0) {
    warnings.push({
      code: "missingRate",
      message: "У преподавателей не указана часовая ставка",
      count: missingRateCount,
    });
  }

  return {
    metrics,
    teacherRollups: teacherRollups(rows),
    teacherRates: teacherRateSettings,
    filters: analyticsFilterOptions(normalized.students, normalized.branches),
    warnings,
    freshness: normalized.freshness,
  };
}
