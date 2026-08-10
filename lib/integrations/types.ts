export type IntegrationSource = "amo" | "alfa";

export interface RawIntegrationRecord {
  source: IntegrationSource;
  scope: string;
  entityType: string;
  externalId: string;
  payload: unknown;
  sourceUpdatedAt?: string | number | null;
}

export interface IntegrationEntityError {
  source: IntegrationSource;
  scope: string;
  entityType: string;
  message: string;
}

export interface DiscoveryResult {
  records: RawIntegrationRecord[];
  errors: IntegrationEntityError[];
}

export function externalIdOf(
  payload: unknown,
  fallback: string,
): string {
  if (!payload || typeof payload !== "object") return fallback;

  const record = payload as Record<string, unknown>;
  for (const key of ["id", "uuid", "code", "key"]) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }

  return fallback;
}

export function updatedAtOf(payload: unknown): string | number | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const value =
    record.updated_at ??
    record.modified_at ??
    record.created_at ??
    record.date_time ??
    null;

  return typeof value === "string" || typeof value === "number"
    ? value
    : null;
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
