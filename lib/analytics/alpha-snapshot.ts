import type { DailySnapshotInput } from "../../db/repositories/analytics.ts";

export interface StoredAlphaRecord {
  scope: string;
  entityType: string;
  externalId: string;
  payload: unknown;
  fetchedAt: number;
}

function objectPayload(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function trueValue(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "да"].includes(value.trim().toLowerCase());
}

function statusText(payload: Record<string, unknown>): string {
  return String(
    payload.study_status_name ??
    payload.status_name ??
    payload.status ??
    "",
  ).trim().toLocaleLowerCase("ru");
}

function confirmedPayment(payload: Record<string, unknown>): boolean {
  const income = numberValue(payload.income);
  if (income <= 0) return false;
  if (payload.is_confirmed === undefined || payload.is_confirmed === null) {
    return true;
  }
  return trueValue(payload.is_confirmed);
}

function activeGroup(payload: Record<string, unknown>): boolean {
  const explicit = payload.is_active ?? payload.is_study;
  if (explicit !== undefined && explicit !== null) return trueValue(explicit);
  const status = statusText(payload);
  return !status.includes("неактив") && !status.includes("закрыт");
}

export function buildAlphaDailySnapshots(
  records: StoredAlphaRecord[],
  snapshotDate: string,
  syncRunId: string,
): DailySnapshotInput[] {
  const branchIds = [...new Set(
    records
      .map((record) => record.scope)
      .filter((scope) => scope && scope !== "account"),
  )].sort();

  return branchIds.map((branchId) => {
    const branchRecords = records.filter((record) => record.scope === branchId);
    const customers = branchRecords.filter(
      (record) => record.entityType === "customer",
    );
    const payments = branchRecords.filter(
      (record) => record.entityType === "pay",
    );
    const groups = branchRecords.filter(
      (record) => record.entityType === "group",
    );

    const customerStatuses = customers.map((record) => {
      const payload = objectPayload(record.payload);
      return { payload, status: statusText(payload) };
    });
    const validPayments = payments
      .map((record) => objectPayload(record.payload))
      .filter(confirmedPayment);

    return {
      snapshotDate,
      branchId,
      totalStudents: new Set(customers.map((record) => record.externalId)).size,
      activeStudents: customerStatuses.filter(({ payload, status }) =>
        trueValue(payload.is_study) || status.includes("актив"),
      ).length,
      frozenStudents: customerStatuses.filter(({ status }) =>
        status.includes("замороз"),
      ).length,
      finishedStudents: customerStatuses.filter(({ status }) =>
        status.includes("закончил") ||
        status.includes("заверш") ||
        status.includes("отчисл") ||
        status.includes("неактив"),
      ).length,
      bookingStudents: customerStatuses.filter(({ status }) =>
        status.includes("брон"),
      ).length,
      revenue: Math.round(
        validPayments.reduce(
          (sum, payment) => sum + numberValue(payment.income),
          0,
        ),
      ),
      paymentCount: validPayments.length,
      activeGroupCount: groups.filter((record) =>
        activeGroup(objectPayload(record.payload)),
      ).length,
      syncRunId,
    };
  });
}

function currentDateInQyzylorda(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Qyzylorda",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function writeAlphaDailySnapshots(runId: string): Promise<void> {
  const [{ integrationRepository }, { analyticsRepository }] = await Promise.all([
    import("../../db/repositories/integrations.ts"),
    import("../../db/repositories/analytics.ts"),
  ]);
  const records = await integrationRepository.listPayloads("alfa", [
    "customer",
    "pay",
    "group",
  ]);
  const snapshots = buildAlphaDailySnapshots(
    records,
    currentDateInQyzylorda(),
    runId,
  );
  for (const snapshot of snapshots) {
    await analyticsRepository.saveDailySnapshot(snapshot);
  }
}
