import { RequestRateLimiter } from "./rate-limit.ts";
import {
  type DiscoveryResult,
  externalIdOf,
  safeErrorMessage,
  updatedAtOf,
} from "./types.ts";

export const ALFA_ENTITY_CATALOG = [
  "branch",
  "location",
  "room",
  "customer",
  "customer_reject",
  "lead_reject",
  "group",
  "lesson",
  "group_customer",
  "subject",
  "study_status",
  "lead_status",
  "lead_source",
  "pay",
  "pay_account",
  "pay_item",
  "sms_message",
  "mail_message",
  "phone_call",
  "customer_tariff",
  "discount",
  "log",
  "regular_lesson",
  "tariff",
  "task",
  "user",
  "teacher",
] as const;

type AlfaEntityDefinition = {
  entityType: string;
  controller: string;
  suffix?: string;
};

const BRANCH_ENTITIES: AlfaEntityDefinition[] = [
  { entityType: "location", controller: "location" },
  { entityType: "room", controller: "room" },
  { entityType: "customer", controller: "customer" },
  { entityType: "customer_reject", controller: "customer-reject" },
  { entityType: "lead_reject", controller: "lead-reject" },
  { entityType: "group", controller: "group" },
  { entityType: "lesson", controller: "lesson" },
  { entityType: "group_customer", controller: "cgi" },
  { entityType: "subject", controller: "subject" },
  { entityType: "study_status", controller: "study-status" },
  { entityType: "lead_status", controller: "lead-status" },
  { entityType: "lead_source", controller: "lead-source" },
  { entityType: "pay", controller: "pay" },
  { entityType: "pay_account", controller: "pay-account" },
  { entityType: "pay_item", controller: "pay-item" },
  { entityType: "sms_message", controller: "sms-message", suffix: "" },
  { entityType: "mail_message", controller: "mail-message", suffix: "" },
  { entityType: "phone_call", controller: "phone-call", suffix: "" },
  { entityType: "discount", controller: "discount" },
  { entityType: "log", controller: "log" },
  { entityType: "regular_lesson", controller: "regular-lesson" },
  { entityType: "tariff", controller: "tariff" },
  { entityType: "task", controller: "task" },
  { entityType: "user", controller: "user" },
  { entityType: "teacher", controller: "teacher" },
];

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function tokenFrom(body: unknown): string | null {
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const value = record.token ?? record.access_token;
  return typeof value === "string" ? value : null;
}

export class AlfaClient {
  private readonly baseUrl: string;
  private readonly limiter = new RequestRateLimiter(220);
  private token: string | null = null;

  constructor(
    baseUrl: string,
    private readonly email: string,
    private readonly apiKey: string,
    private readonly configuredBranchIds: string[] = [],
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  private async login(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v2api/auth/login`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: this.email, api_key: this.apiKey }),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `AlfaCRM auth ${response.status}: ${text.slice(0, 300)}`,
      );
    }

    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Some installations may return the token as plain text.
    }

    const token = tokenFrom(body);
    if (!token) throw new Error("AlfaCRM auth response did not contain a token");
    this.token = token;
    return token;
  }

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    if (!this.token) await this.login();
    await this.limiter.wait();

    const send = () =>
      fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "X-ALFACRM-TOKEN": this.token ?? "",
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

    let response = await send();
    if (response.status === 401) {
      await this.login();
      response = await send();
    }

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `AlfaCRM ${response.status} for ${path}: ${text.slice(0, 300)}`,
      );
    }

    if (!text) return null;
    return JSON.parse(text);
  }

  private async collection(path: string): Promise<unknown[]> {
    const items: unknown[] = [];
    let page = 0;

    while (true) {
      const body = (await this.post(path, { page })) as
        | {
            items?: unknown[];
            total?: number;
            count?: number;
          }
        | unknown[];
      const pageItems = Array.isArray(body)
        ? body
        : Array.isArray(body?.items)
          ? body.items
          : [];
      items.push(...pageItems);

      const total = Array.isArray(body) ? undefined : body?.total;
      if (
        pageItems.length === 0 ||
        (typeof total === "number" && items.length >= total) ||
        (typeof total !== "number" && pageItems.length < 50)
      ) {
        break;
      }
      page += 1;
    }

    return items;
  }

  async discoverAll(): Promise<DiscoveryResult> {
    const result: DiscoveryResult = { records: [], errors: [] };
    const addRecords = (
      entityType: string,
      payloads: unknown[],
      scope: string,
    ) => {
      payloads.forEach((payload, index) => {
        result.records.push({
          source: "alfa",
          scope,
          entityType,
          externalId: externalIdOf(payload, `${entityType}-${index}`),
          payload,
          sourceUpdatedAt: updatedAtOf(payload),
        });
      });
    };

    let branches: unknown[] = [];
    try {
      branches = await this.collection("/v2api/branch/index");
      addRecords("branch", branches, "account");
    } catch (error) {
      result.errors.push({
        source: "alfa",
        scope: "account",
        entityType: "branch",
        message: safeErrorMessage(error),
      });
    }

    const branchIds =
      this.configuredBranchIds.length > 0
        ? this.configuredBranchIds
        : branches
            .map((branch) => externalIdOf(branch, ""))
            .filter(Boolean);

    for (const branchId of branchIds) {
      let customers: unknown[] = [];

      for (const definition of BRANCH_ENTITIES) {
        const suffix =
          definition.suffix === undefined ? "/index" : definition.suffix;
        const path = `/v2api/${branchId}/${definition.controller}${suffix}`;
        try {
          const payloads = await this.collection(path);
          addRecords(definition.entityType, payloads, branchId);
          if (definition.entityType === "customer") customers = payloads;
        } catch (error) {
          result.errors.push({
            source: "alfa",
            scope: branchId,
            entityType: definition.entityType,
            message: safeErrorMessage(error),
          });
        }
      }

      for (const customer of customers) {
        const customerId = externalIdOf(customer, "");
        if (!customerId) continue;
        try {
          const tariffs = await this.collection(
            `/v2api/${branchId}/customer-tariff/index?customer_id=${encodeURIComponent(customerId)}`,
          );
          addRecords("customer_tariff", tariffs, branchId);
        } catch (error) {
          result.errors.push({
            source: "alfa",
            scope: branchId,
            entityType: "customer_tariff",
            message: `customer ${customerId}: ${safeErrorMessage(error)}`,
          });
        }
      }
    }

    return result;
  }
}
