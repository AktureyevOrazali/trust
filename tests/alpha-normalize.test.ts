import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAlphaRecords,
  type StoredAlphaRecord,
} from "../lib/analytics/alpha-normalize.ts";
import { calculateGroupMetrics } from "../lib/analytics/spreadsheet-parity.ts";

const fetchedAt = Date.parse("2026-08-18T08:00:00Z");

function record(
  entityType: string,
  externalId: string,
  payload: Record<string, unknown>,
  scope = "b1",
): StoredAlphaRecord {
  return { scope, entityType, externalId, payload, fetchedAt };
}

const records: StoredAlphaRecord[] = [
  record("branch", "b1", { id: "b1", name: "Центр" }, "account"),
  record("study_status", "s1", { id: "s1", name: "Активен" }),
  record("study_status", "s2", { id: "s2", name: "Заморозка" }),
  record("teacher", "t1", { id: "t1", name: "Учитель 1", hour_rate: "2500" }),
  record("teacher", "t2", { id: "t2", name: "Учитель 2", rate: { value: 3000 } }),
  record("group", "g1", { id: "g1", name: "Группа 1", teacher_ids: ["t1"] }),
  record("group", "g2", { id: "g2", name: "Группа 2", teacher_id: "t2" }),
  record("tariff", "tr1", { id: "tr1", name: "Стандарт", price: "30 000" }),
  record("customer", "c1", {
    id: "c1",
    name: "Одинаковое имя",
    is_study: 1,
    study_status_id: "s1",
    created_at: "2026-04-01 09:15:00",
    paid_lesson_count: 7,
    teacher_ids: ["t2"],
    phone: "+70000000000",
  }),
  record("customer", "c2", {
    id: "c2",
    name: "Одинаковое имя",
    is_study: "1",
    study_status_id: "s2",
    created_at: "2026-06-22 12:35:29",
  }),
  record("customer", "lead", { id: "lead", name: "Лид", is_study: 0 }),
  record("group_customer", "m1", {
    id: "m1",
    customer_id: "c1",
    group_id: "g1",
    date_from: "01.04.2026",
    date_to: "01.09.2026",
  }),
  record("group_customer", "m2", {
    id: "m2",
    customer_id: "c1",
    group_id: "g2",
  }),
  record("group_customer", "m3", {
    id: "m3",
    customer_id: "c2",
    group_id: "g1",
  }),
  record("customer_tariff", "ct1", {
    id: "ct1",
    customer_id: "c1",
    tariff_id: "tr1",
    b_date: "01.04.2026",
    e_date: "01.09.2026",
    lessons_left: 2,
  }),
  record("pay", "p1", { id: "p1", customer_id: "c1", income: "100 000", is_confirmed: 1 }),
  record("pay", "p2", { id: "p2", customer_id: "c1", income: 50_000, is_confirmed: 0 }),
  record("pay", "p3", { id: "p3", customer_id: "c2", income: 200_000 }),
  record("lesson", "l1", {
    id: "l1",
    status: 3,
    date: "2026-08-17",
    time_from: "2026-08-17 10:00:00",
    time_to: "2026-08-17 11:30:00",
    group_ids: ["g1"],
    details: [
      { customer_id: "c1", is_attend: 1 },
      { customer_id: "c2", is_attend: 0 },
    ],
  }),
  record("lesson", "l2", {
    id: "l2",
    status: "Проведено",
    date: "17.08.2026",
    duration_minutes: 60,
    group_id: "g2",
    details: [{ customer_id: "c1", is_attend: true }],
  }),
];

test("normalizes AlphaCRM records using IDs and exact spreadsheet inputs", () => {
  const normalized = normalizeAlphaRecords(records, new Date("2026-08-18T12:00:00Z"));

  assert.equal(normalized.students.length, 2);
  assert.equal(normalized.groupStudents.length, 3);
  const first = normalized.students.find((student) => student.id === "b1:c1");
  const second = normalized.students.find((student) => student.id === "b1:c2");
  assert.ok(first);
  assert.ok(second);
  assert.deepEqual(first.groups, ["Группа 1", "Группа 2"]);
  assert.equal(first.teacher, "Учитель 1");
  assert.equal(first.status, "Активен");
  assert.equal(first.attendedLessons, 2);
  assert.equal(first.paymentCount, 1);
  assert.equal(first.ltv, 100_000);
  assert.equal(first.subscriptionAmount, 30_000);
  assert.equal(first.months, 4);
  assert.equal(first.renewals, 3);
  assert.equal(first.activeTariff, "Стандарт");
  assert.equal(first.lessonBalance, 7);
  assert.equal(second.status, "Заморозка");
  assert.equal(second.ltv, 200_000);
  assert.equal(second.attendedLessons, 0);
  assert.equal(second.months, 1);
  assert.equal(normalized.groupHours.get("Группа 1"), 1.5);
  assert.equal(normalized.groupHours.get("Группа 2"), 1);
  assert.equal(normalized.teacherRates.get("Учитель 1"), 2500);
  assert.equal(normalized.teacherRates.get("Учитель 2"), 3000);
  assert.equal(normalized.freshness.status, "stored");
  assert.doesNotMatch(JSON.stringify(normalized.students), /\+70000000000/);
});

test("maps AlphaCRM completion status to the unchanged sheet formula vocabulary", () => {
  const completedRecords = [
    record("study_status", "done", { id: "done", name: "Завершил" }),
    record("customer", "done-customer", {
      id: "done-customer",
      name: "Завершивший ученик",
      is_study: 1,
      study_status_id: "done",
      created_at: "2026-01-01 08:00:00",
      b_date: "2026-01-01",
      e_date: "2026-08-01",
    }),
    record("log", "completion", {
      id: "completion",
      entity: "Customer",
      entity_id: "done-customer",
      fields_old: { study_status_id: "active" },
      fields_new: { study_status_id: "done" },
      date_time: "2026-08-05 18:21:46",
    }),
  ];
  const normalized = normalizeAlphaRecords(completedRecords, new Date("2026-08-18T12:00:00Z"));

  assert.equal(normalized.students[0].status, "Закончил");
  assert.equal(normalized.students[0].startDate, "2026-01-01");
  assert.equal(normalized.students[0].endDate, "2026-08-05");
  assert.equal(normalized.students[0].tariffEndDate, "2026-08-01");
  assert.equal(normalized.students[0].months, 7);
  assert.equal(normalized.warnings.some((warning) => warning.code === "missingGroup"), false);
});

test("does not use tariff expiry as the study period end", () => {
  const activeRecords = [
    record("study_status", "active", { id: "active", name: "Активен" }),
    record("customer", "active-customer", {
      id: "active-customer",
      name: "Активный ученик",
      is_study: 1,
      study_status_id: "active",
      created_at: "2026-05-01 08:00:00",
    }),
    record("customer_tariff", "active-tariff", {
      id: "active-tariff",
      customer_id: "active-customer",
      b_date: "2026-05-01",
      e_date: "2027-04-30",
    }),
  ];
  const normalized = normalizeAlphaRecords(activeRecords, new Date("2026-08-21T12:00:00Z"));

  assert.equal(normalized.students[0].endDate, null);
  assert.equal(normalized.students[0].tariffEndDate, "2027-04-30");
});

test("counts only full months from AlphaCRM customer creation date through today", () => {
  const customerRecords = [
    record("study_status", "active", { id: "active", name: "Активен" }),
    record("customer", "before-anniversary", {
      id: "before-anniversary",
      name: "До полного месяца",
      is_study: 1,
      study_status_id: "active",
      created_at: "2026-06-22 12:35:29",
      b_date: "2026-06-22",
      e_date: "2030-12-31",
    }),
    record("customer", "on-anniversary", {
      id: "on-anniversary",
      name: "После полного месяца",
      is_study: 1,
      study_status_id: "active",
      created_at: "2026-05-01 08:00:00",
      b_date: "2026-05-01",
      e_date: "2030-12-31",
    }),
  ];
  const normalized = normalizeAlphaRecords(customerRecords, new Date("2026-08-21T12:00:00Z"));

  assert.equal(normalized.students.find((student) => student.id.endsWith("before-anniversary"))?.months, 1);
  assert.equal(normalized.students.find((student) => student.id.endsWith("on-anniversary"))?.months, 3);
  assert.equal(normalized.students.find((student) => student.id.endsWith("on-anniversary"))?.renewals, 2);
});

test("preserves the workbook group formula behavior after normalization", () => {
  const normalized = normalizeAlphaRecords(records, new Date("2026-08-18T12:00:00Z"));
  const metrics = calculateGroupMetrics(
    normalized.groupStudents,
    [...normalized.groupHours].map(([group, hours]) => ({ group, hours })),
    [...normalized.teacherRates].map(([teacher, rate]) => ({ teacher, rate })),
  );

  assert.deepEqual(metrics.rows.map((row) => row.group), ["Группа 2"]);
  assert.equal(metrics.rows[0].studentCount, 1);
  assert.equal(metrics.rows[0].revenue, 30_000);
  assert.equal(metrics.rows[0].expense, 3000);
  assert.equal(metrics.rows[0].grossProfit, 27_000);
});
