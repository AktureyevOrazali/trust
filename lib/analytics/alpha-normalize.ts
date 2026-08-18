import { rowRenewals } from "./spreadsheet-parity.ts";
import type {
  DataFreshness,
  DataQualityWarning,
  StudentFormulaRow,
} from "./types.ts";

export interface StoredAlphaRecord {
  scope: string;
  entityType: string;
  externalId: string;
  payload: unknown;
  fetchedAt: number;
}

export interface NormalizedStudent extends StudentFormulaRow {
  branchId: string;
  branchName: string;
  groups: string[];
  teachers: string[];
  lessonBalance: number;
  lessonBalanceKnown: boolean;
  activeTariff: string;
  lastAttendance: string | null;
}

export interface NormalizedAlphaData {
  students: NormalizedStudent[];
  groupStudents: StudentFormulaRow[];
  groupHours: Map<string, number>;
  teacherRates: Map<string, number>;
  branches: Map<string, string>;
  freshness: DataFreshness;
  warnings: DataQualityWarning[];
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function text(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" || typeof value === "number") {
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
  }
  return "";
}

function numeric(...values: unknown[]): number {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = typeof value === "number"
      ? value
      : Number(String(value).replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function booleanValue(value: unknown): boolean | null {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLocaleLowerCase("ru");
  if (["1", "true", "yes", "да"].includes(normalized)) return true;
  if (["0", "false", "no", "нет"].includes(normalized)) return false;
  return null;
}

function ids(...values: unknown[]): string[] {
  const result: string[] = [];
  const append = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(append);
      return;
    }
    const record = object(value);
    const candidate = Object.keys(record).length > 0
      ? text(record.id, record.value)
      : text(value);
    if (candidate && !result.includes(candidate)) result.push(candidate);
  };
  values.forEach(append);
  return result;
}

function dateValue(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const source = String(value).trim();
    if (!source || source === "0000-00-00") continue;
    const russian = source.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (russian) {
      return `${russian[3]}-${russian[2].padStart(2, "0")}-${russian[1].padStart(2, "0")}`;
    }
    const iso = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) {
      return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    }
    const timestamp = Date.parse(source);
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString().slice(0, 10);
  }
  return null;
}

function fullMonths(start: string | null, end: string | null, today: Date): number {
  if (!start) return 0;
  const startDate = new Date(`${start}T12:00:00Z`);
  const endDate = end ? new Date(`${end}T12:00:00Z`) : today;
  if (!Number.isFinite(startDate.getTime()) || endDate < startDate) return 0;
  let months =
    (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
    endDate.getUTCMonth() - startDate.getUTCMonth();
  if (endDate.getUTCDate() < startDate.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

function entityId(payload: JsonObject, fallback = ""): string {
  return text(payload.id, payload.customer_id, payload.group_id, fallback);
}

function customerId(payload: JsonObject): string {
  return text(payload.customer_id, payload.client_id, object(payload.customer).id);
}

function groupIds(payload: JsonObject): string[] {
  return ids(
    payload.group_ids,
    payload.group_id,
    payload.groups,
    object(payload.group).id,
  );
}

function teacherIds(payload: JsonObject): string[] {
  return ids(
    payload.teacher_ids,
    payload.teacher_id,
    payload.teachers,
    object(payload.teacher).id,
  );
}

function isConducted(payload: JsonObject): boolean {
  const status = text(payload.status, payload.status_id).toLocaleLowerCase("ru");
  return status === "3" || status.includes("провед") || status === "conducted";
}

function isConfirmedIncome(payload: JsonObject): boolean {
  if (numeric(payload.income) <= 0) return false;
  const confirmed = booleanValue(payload.is_confirmed ?? payload.confirmed);
  return confirmed !== false;
}

function lessonDuration(payload: JsonObject): number {
  const explicit = numeric(payload.duration_hours, payload.hours);
  if (explicit > 0) return explicit;
  const minutes = numeric(payload.duration, payload.duration_minutes);
  if (minutes > 0) return minutes / 60;
  const from = text(payload.time_from, payload.start_time);
  const to = text(payload.time_to, payload.end_time);
  const parseTime = (value: string) => {
    const match = value.match(/(?:T|\s|^)(\d{1,2}):(\d{2})(?::\d{2})?$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const fromMinutes = parseTime(from);
  const toMinutes = parseTime(to);
  if (fromMinutes == null || toMinutes == null || toMinutes <= fromMinutes) return 0;
  return (toMinutes - fromMinutes) / 60;
}

function details(payload: JsonObject): JsonObject[] {
  const value = payload.details ?? payload.lesson_details;
  return Array.isArray(value) ? value.map(object) : [];
}

function currentMembership(payload: JsonObject, today: string): boolean {
  const active = booleanValue(payload.is_active ?? payload.active);
  if (active === false) return false;
  const end = dateValue(
    payload.e_date,
    payload.end_date,
    payload.date_to,
    payload.finish_date,
    payload.paid_till,
  );
  return !end || end >= today;
}

function formulaStatus(value: string): string {
  const normalized = value.toLocaleLowerCase("ru");
  if (normalized === "завершил" || normalized === "завершила") return "Закончил";
  return value;
}

function warningList(counts: Map<string, number>): DataQualityWarning[] {
  const labels: Record<string, string> = {
    missingStatus: "У клиентов не указан распознаваемый учебный статус",
    missingGroup: "У активных клиентов не найдена текущая группа",
    missingTeacher: "У групп не найден преподаватель",
    missingRate: "У преподавателей не найдена часовая ставка",
    orphanPayment: "Оплаты не удалось связать с клиентом по Alpha ID",
    orphanTariff: "Абонементы не удалось связать с клиентом по Alpha ID",
  };
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([code, count]) => ({ code, message: labels[code] ?? code, count }));
}

function bump(counts: Map<string, number>, code: string, amount = 1): void {
  counts.set(code, (counts.get(code) ?? 0) + amount);
}

function freshness(records: StoredAlphaRecord[], now: Date): DataFreshness {
  const fetchedAt = Math.max(0, ...records.map((record) => record.fetchedAt));
  if (fetchedAt === 0) return { fetchedAt: null, status: "unavailable" };
  return {
    fetchedAt,
    status: now.getTime() - fetchedAt > 36 * 60 * 60 * 1000 ? "stale" : "stored",
  };
}

export function normalizeAlphaRecords(
  records: StoredAlphaRecord[],
  now = new Date(),
): NormalizedAlphaData {
  const warnings = new Map<string, number>();
  const today = now.toISOString().slice(0, 10);
  const byType = (type: string) => records.filter((record) => record.entityType === type);
  const scopedKey = (scope: string, id: string) => `${scope}:${id}`;

  const branches = new Map<string, string>();
  for (const record of byType("branch")) {
    const payload = object(record.payload);
    const id = entityId(payload, record.externalId);
    if (id) branches.set(id, text(payload.name, payload.title, id));
  }
  for (const record of records) {
    if (record.scope !== "account" && !branches.has(record.scope)) {
      branches.set(record.scope, record.scope);
    }
  }

  const studyStatuses = new Map<string, string>();
  const teachers = new Map<string, string>();
  const teacherRates = new Map<string, number>();
  const groups = new Map<string, { name: string; teachers: string[] }>();
  const tariffs = new Map<string, { name: string; price: number }>();

  for (const record of byType("study_status")) {
    const payload = object(record.payload);
    const id = entityId(payload, record.externalId);
    if (id) studyStatuses.set(scopedKey(record.scope, id), text(payload.name, payload.title));
  }
  for (const record of byType("teacher")) {
    const payload = object(record.payload);
    const id = entityId(payload, record.externalId);
    const name = text(payload.name, payload.title, id);
    if (!id) continue;
    teachers.set(scopedKey(record.scope, id), name);
    const ratePayload = object(payload.rate);
    const rate = numeric(
      payload.hour_rate,
      payload.teacher_rate,
      payload.lesson_rate,
      ratePayload.hour,
      ratePayload.value,
    );
    if (name && rate > 0) teacherRates.set(name, rate);
  }
  for (const record of byType("group")) {
    const payload = object(record.payload);
    const id = entityId(payload, record.externalId);
    if (!id) continue;
    groups.set(scopedKey(record.scope, id), {
      name: text(payload.name, payload.title, id),
      teachers: teacherIds(payload),
    });
  }
  for (const record of byType("tariff")) {
    const payload = object(record.payload);
    const id = entityId(payload, record.externalId);
    if (!id) continue;
    tariffs.set(scopedKey(record.scope, id), {
      name: text(payload.name, payload.title, id),
      price: numeric(payload.price, payload.amount, payload.cost),
    });
  }

  const memberships = new Map<string, Array<{
    groupId: string;
    start: string | null;
    end: string | null;
    current: boolean;
  }>>();
  for (const record of byType("group_customer")) {
    const payload = object(record.payload);
    const customer = customerId(payload);
    const membershipGroups = groupIds(payload);
    if (!customer || membershipGroups.length === 0) continue;
    const key = scopedKey(record.scope, customer);
    const target = memberships.get(key) ?? [];
    for (const groupId of membershipGroups) {
      if (!target.some((membership) => membership.groupId === groupId)) {
        target.push({
          groupId,
          start: dateValue(payload.b_date, payload.start_date, payload.date_from, payload.begin_date),
          end: dateValue(payload.e_date, payload.end_date, payload.date_to, payload.finish_date),
          current: currentMembership(payload, today),
        });
      }
    }
    memberships.set(key, target);
  }

  const customerTariffs = new Map<string, JsonObject[]>();
  for (const record of byType("customer_tariff")) {
    const payload = object(record.payload);
    const customer = customerId(payload);
    if (!customer) {
      bump(warnings, "orphanTariff");
      continue;
    }
    const key = scopedKey(record.scope, customer);
    customerTariffs.set(key, [...(customerTariffs.get(key) ?? []), payload]);
  }

  const paymentTotals = new Map<string, { count: number; total: number }>();
  for (const record of byType("pay")) {
    const payload = object(record.payload);
    if (!isConfirmedIncome(payload)) continue;
    const customer = customerId(payload);
    if (!customer) {
      bump(warnings, "orphanPayment");
      continue;
    }
    const key = scopedKey(record.scope, customer);
    const current = paymentTotals.get(key) ?? { count: 0, total: 0 };
    current.count += 1;
    current.total += numeric(payload.income);
    paymentTotals.set(key, current);
  }

  const attendance = new Map<string, { count: number; last: string | null }>();
  const groupHours = new Map<string, number>();
  for (const record of byType("lesson")) {
    const payload = object(record.payload);
    if (!isConducted(payload)) continue;
    const lessonDate = dateValue(payload.date, payload.start_at, payload.datetime);
    for (const detail of details(payload)) {
      if (booleanValue(detail.is_attend ?? detail.attended) !== true) continue;
      const customer = customerId(detail);
      if (!customer) continue;
      const key = scopedKey(record.scope, customer);
      const current = attendance.get(key) ?? { count: 0, last: null };
      current.count += 1;
      if (lessonDate && (!current.last || lessonDate > current.last)) current.last = lessonDate;
      attendance.set(key, current);
    }
    const duration = lessonDuration(payload);
    for (const groupId of groupIds(payload)) {
      const group = groups.get(scopedKey(record.scope, groupId));
      if (group?.name && duration > 0) {
        groupHours.set(group.name, (groupHours.get(group.name) ?? 0) + duration);
      }
    }
  }

  const students: NormalizedStudent[] = [];
  const groupStudents: StudentFormulaRow[] = [];
  for (const record of byType("customer")) {
    const payload = object(record.payload);
    if (booleanValue(payload.is_study) !== true) continue;
    const customer = entityId(payload, record.externalId);
    if (!customer) continue;
    const key = scopedKey(record.scope, customer);
    const storedMemberships = memberships.get(key) ?? [];
    const currentMemberships = storedMemberships.filter((membership) => membership.current);
    const memberRows = currentMemberships.length > 0
      ? currentMemberships
      : [...storedMemberships]
          .sort((left, right) => text(right.end, right.start).localeCompare(text(left.end, left.start)))
          .slice(0, 1);
    const directGroups = groupIds(payload).map((groupId) => ({
      groupId,
      start: null,
      end: null,
      current: true,
    }));
    const allMemberships = [...memberRows];
    for (const direct of directGroups) {
      if (!allMemberships.some((membership) => membership.groupId === direct.groupId)) {
        allMemberships.push(direct);
      }
    }
    const groupEntries = allMemberships.flatMap((membership) => {
      const group = groups.get(scopedKey(record.scope, membership.groupId));
      return group ? [{ ...membership, ...group }] : [];
    });
    const groupNames = groupEntries.map((entry) => entry.name);
    const groupTeacherNames = groupEntries.flatMap((entry) =>
      entry.teachers.map((teacherId) => teachers.get(scopedKey(record.scope, teacherId)) ?? ""),
    ).filter(Boolean);
    const directTeacherNames = teacherIds(payload)
      .map((teacherId) => teachers.get(scopedKey(record.scope, teacherId)) ?? "")
      .filter(Boolean);
    const teacherNames = [...new Set([...groupTeacherNames, ...directTeacherNames])];
    if (groupNames.length === 0) bump(warnings, "missingGroup");
    if (groupEntries.some((entry) => entry.teachers.length === 0) || (groupNames.length > 0 && teacherNames.length === 0)) {
      bump(warnings, "missingTeacher");
    }

    const statusId = text(payload.study_status_id, payload.status_id, object(payload.study_status).id);
    const status = formulaStatus(text(
      payload.study_status_name,
      object(payload.study_status).name,
      statusId ? studyStatuses.get(scopedKey(record.scope, statusId)) : "",
      payload.status_name,
    ));
    if (!status) bump(warnings, "missingStatus");

    const tariffsForCustomer = customerTariffs.get(key) ?? [];
    const sortedTariffs = [...tariffsForCustomer].sort((left, right) =>
      text(right.e_date, right.end_date, right.date_to, right.paid_till, right.b_date, right.start_date, right.date_from)
        .localeCompare(text(left.e_date, left.end_date, left.date_to, left.paid_till, left.b_date, left.start_date, left.date_from)),
    );
    const currentTariff = sortedTariffs.find((tariff) => currentMembership(tariff, today)) ?? sortedTariffs[0] ?? {};
    const tariffId = text(currentTariff.tariff_id, object(currentTariff.tariff).id);
    const tariffDefinition = tariffId ? tariffs.get(scopedKey(record.scope, tariffId)) : undefined;
    const startDate = dateValue(
      currentTariff.b_date,
      currentTariff.start_date,
      currentTariff.date_from,
      payload.b_date,
      payload.study_start_date,
      groupEntries[0]?.start,
    );
    const endDate = dateValue(
      currentTariff.e_date,
      currentTariff.end_date,
      currentTariff.date_to,
      currentTariff.paid_till,
      payload.e_date,
      payload.study_end_date,
      groupEntries[0]?.end,
    );
    const months = fullMonths(startDate, endDate, now);
    const payments = paymentTotals.get(key) ?? { count: 0, total: 0 };
    const attended = attendance.get(key) ?? { count: 0, last: null };
    const subscriptionAmount = numeric(
      currentTariff.price,
      currentTariff.amount,
      currentTariff.cost,
      tariffDefinition?.price,
    );
    const firstGroup = groupEntries[0];
    const firstTeacher = firstGroup?.teachers
      .map((teacherId) => teachers.get(scopedKey(record.scope, teacherId)) ?? "")
      .find(Boolean) ?? directTeacherNames[0] ?? "";
    const formulaRow: StudentFormulaRow = {
      id: key,
      name: text(payload.name, customer),
      attendedLessons: attended.count,
      paymentCount: payments.count,
      ltv: payments.total,
      group: firstGroup?.name ?? "",
      teacher: firstTeacher,
      startDate,
      endDate,
      status,
      months,
      renewals: rowRenewals(months),
      subscriptionAmount,
    };
    students.push({
      ...formulaRow,
      branchId: record.scope,
      branchName: branches.get(record.scope) ?? record.scope,
      groups: groupNames,
      teachers: [...new Set(teacherNames)],
      lessonBalance: numeric(
        payload.paid_lesson_count,
        currentTariff.paid_lesson_count,
        currentTariff.lesson_balance,
        currentTariff.lessons_left,
        currentTariff.balance,
      ),
      lessonBalanceKnown: [
        payload.paid_lesson_count,
        currentTariff.paid_lesson_count,
        currentTariff.lesson_balance,
        currentTariff.lessons_left,
        currentTariff.balance,
      ].some((value) => value !== null && value !== undefined && value !== ""),
      activeTariff: text(
        currentTariff.tariff_name,
        object(currentTariff.tariff).name,
        tariffDefinition?.name,
      ),
      lastAttendance: attended.last,
    });
    for (const groupEntry of groupEntries) {
      const teacher = groupEntry.teachers
        .map((teacherId) => teachers.get(scopedKey(record.scope, teacherId)) ?? "")
        .find(Boolean) ?? "";
      groupStudents.push({ ...formulaRow, group: groupEntry.name, teacher });
    }
  }

  return {
    students,
    groupStudents,
    groupHours,
    teacherRates,
    branches,
    freshness: freshness(records, now),
    warnings: warningList(warnings),
  };
}
