import { and, asc, eq } from "drizzle-orm";

import type { StoredAlphaRecord } from "../../lib/analytics/alpha-normalize.ts";
import { ensureLocalDatabaseSchema } from "../ensure-schema.ts";
import { db } from "../index.ts";
import { teacherRates } from "../schema.ts";

export interface TeacherRateSetting {
  branchId: string;
  teacherId: string;
  teacher: string;
  rate: number;
  source: "sheet_seed" | "manual";
}

const SHEET_RATES = new Map<string, number>([
  ["amina", 3000],
  ["амина", 3000],
  ["zuhra", 2500],
  ["зухра", 2500],
  ["sevinch", 2000],
  ["севинч", 2000],
  ["vladislav", 2000],
  ["владислав", 2000],
  ["guzel", 3000],
  ["гузель", 3000],
  ["ayazhan", 3000],
  ["аяжан", 3000],
  ["asylzat", 2500],
  ["асылзат", 2500],
]);

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function teacherIdentity(record: StoredAlphaRecord) {
  const payload = object(record.payload);
  const teacherId = text(payload.id) || record.externalId;
  const teacher = text(payload.name) || text(payload.title) || teacherId;
  return { branchId: record.scope, teacherId, teacher };
}

function sheetRate(name: string): number {
  return SHEET_RATES.get(name.trim().toLocaleLowerCase("ru")) ?? 0;
}

export async function ensureTeacherRates(
  records: StoredAlphaRecord[],
): Promise<TeacherRateSetting[]> {
  await ensureLocalDatabaseSchema();
  const teachers = records
    .filter((record) => record.entityType === "teacher")
    .map(teacherIdentity)
    .filter((teacher) => teacher.branchId && teacher.teacherId && teacher.teacher);

  if (teachers.length > 0) {
    await db.insert(teacherRates).values(teachers.map((teacher) => {
      const rate = sheetRate(teacher.teacher);
      return {
        ...teacher,
        teacherName: teacher.teacher,
        hourlyRate: rate,
        source: rate > 0 ? "sheet_seed" : "manual",
        updatedAt: Date.now(),
      };
    })).onConflictDoNothing();
  }

  return listTeacherRates();
}

export async function listTeacherRates(): Promise<TeacherRateSetting[]> {
  await ensureLocalDatabaseSchema();
  const rows = await db.select().from(teacherRates).orderBy(
    asc(teacherRates.teacherName),
    asc(teacherRates.branchId),
  );
  return rows.map((row) => ({
    branchId: row.branchId,
    teacherId: row.teacherId,
    teacher: row.teacherName,
    rate: row.hourlyRate,
    source: row.source === "sheet_seed" ? "sheet_seed" : "manual",
  }));
}

export async function updateTeacherRate(input: {
  branchId: string;
  teacherId: string;
  rate: number;
}): Promise<void> {
  await ensureLocalDatabaseSchema();
  await db.update(teacherRates).set({
    hourlyRate: input.rate,
    source: "manual",
    updatedAt: Date.now(),
  }).where(and(
    eq(teacherRates.branchId, input.branchId),
    eq(teacherRates.teacherId, input.teacherId),
  ));
}
