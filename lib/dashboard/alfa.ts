import { env } from "cloudflare:workers";
import { RequestRateLimiter } from "@/lib/integrations/rate-limit";
import type { SourceStatus } from "./amo";
import { type DashboardRange } from "./period";

const RAW_CACHE_TTL_MS = 120_000;

export interface AlfaDashboardData {
  connected: boolean;
  sourceStatus: SourceStatus;
  statusMessage: string;
  cash: number;
  activations: number;
  payments: number;
  customers: number;
  activeStudents: number;
  daily: AlfaDailySnapshot[];
  sales: AlfaSale[];
  updatedAt: string;
}

export interface AlfaDailySnapshot {
  dateKey: string;
  date: string;
  cash: number;
  newCash: number;
  repeatCash: number;
  firstChineseCash: number;
  repeatChineseCash: number;
  bookingCash: number;
  payments: number;
  activations: number;
  firstSales: number;
  repeatSales: number;
}

export interface AlfaSale {
  id: number;
  dateKey: string;
  date: string;
  customer: string;
  amount: number;
  saleType: "Первая" | "Повторная" | "Бронь" | "Не указано";
  paymentMethod: string;
  category: string;
}

type AlfaRuntime = {
  DB?: D1Database;
  ALFA_BASE_URL?: string;
  ALFA_EMAIL?: string;
  ALFA_API_KEY?: string;
  ALFA_BRANCH_IDS?: string;
};

type AlfaPayment = {
  id: number;
  customer_id?: number;
  pay_account_id?: number;
  pay_item_id?: number;
  document_date?: string;
  created_at?: string;
  income?: number | string;
  payer_name?: string;
  pay_type_name?: string;
  is_confirmed?: boolean | number;
};

type AlfaCustomer = {
  id: number;
  name?: string;
  is_study?: boolean | number;
};

type AlfaDictionaryItem = {
  id: number;
  name?: string;
};

type AlfaRawData = {
  payments: AlfaPayment[];
  customers: AlfaCustomer[];
  paymentAccounts: AlfaDictionaryItem[];
  paymentItems: AlfaDictionaryItem[];
  fetchedAt: number;
};

const rawCache = new Map<string, { data: AlfaRawData; expiresAt: number }>();
const rawInFlight = new Map<string, Promise<AlfaRawData>>();

function rangeCacheKey(range: DashboardRange): string {
  return `${range.from}:${range.to}`;
}

function alfaDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

async function loadStoredAlfaData(db: D1Database): Promise<AlfaRawData | null> {
  const result = await db.prepare(
    `SELECT entity_type, payload, fetched_at
     FROM integration_records
     WHERE source = 'alfa'
       AND entity_type IN ('pay', 'customer', 'pay_account', 'pay_item')`,
  ).all();
  if (result.results.length === 0) return null;

  const data: AlfaRawData = {
    payments: [],
    customers: [],
    paymentAccounts: [],
    paymentItems: [],
    fetchedAt: 0,
  };
  for (const row of result.results as Array<{
    entity_type: string;
    payload: string;
    fetched_at: number;
  }>) {
    const payload = JSON.parse(row.payload);
    data.fetchedAt = Math.max(data.fetchedAt, Number(row.fetched_at));
    if (row.entity_type === "pay") data.payments.push(payload as AlfaPayment);
    else if (row.entity_type === "customer") data.customers.push(payload as AlfaCustomer);
    else if (row.entity_type === "pay_account") data.paymentAccounts.push(payload as AlfaDictionaryItem);
    else if (row.entity_type === "pay_item") data.paymentItems.push(payload as AlfaDictionaryItem);
  }
  return data;
}

function emptyAlfaData(message: string): AlfaDashboardData {
  return {
    connected: false,
    sourceStatus: "unavailable",
    statusMessage: message,
    cash: 0,
    activations: 0,
    payments: 0,
    customers: 0,
    activeStudents: 0,
    daily: [],
    sales: [],
    updatedAt: "нет данных",
  };
}

function tokenFrom(body: unknown): string | null {
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const value = record.token ?? record.access_token;
  return typeof value === "string" ? value : null;
}

function dateKey(value: string | undefined): string {
  if (!value) return "";
  const ru = value.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (ru) return `${ru[3]}-${ru[2]}-${ru[1]}`;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : "";
}

function dateLabel(value: string | undefined): string {
  const key = dateKey(value);
  if (!key) return "—";
  const [, month, day] = key.split("-");
  return `${day}.${month}`;
}

function paymentArticle(name: string | undefined): "first" | "repeat" | "booking" | "other" {
  const normalized = (name ?? "").toLocaleLowerCase("ru");
  if (normalized.includes("перв китай")) return "first";
  if (normalized.includes("повт китай")) return "repeat";
  if (normalized.includes("бронь")) return "booking";
  return "other";
}

function saleTypeForArticle(article: ReturnType<typeof paymentArticle>): AlfaSale["saleType"] {
  if (article === "first") return "Первая";
  if (article === "repeat") return "Повторная";
  if (article === "booking") return "Бронь";
  return "Не указано";
}

function paymentCategory(
  payment: AlfaPayment,
  paymentItems: Map<number, string>,
): string {
  return payment.pay_item_id
    ? paymentItems.get(payment.pay_item_id) ?? "Не указано"
    : "Не указано";
}

function formatUpdatedAt(timestamp: number): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Qyzylorda",
  }).format(new Date(timestamp));
}

class AlfaDashboardClient {
  private token: string | null = null;
  private readonly limiter = new RequestRateLimiter(220);

  constructor(
    private readonly baseUrl: string,
    private readonly email: string,
    private readonly apiKey: string,
  ) {}

  private async login(): Promise<void> {
    await this.limiter.wait();
    const response = await fetch(`${this.baseUrl}/v2api/auth/login`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: this.email, api_key: this.apiKey }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`AlphaCRM auth HTTP ${response.status}`);

    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Некоторые установки AlphaCRM возвращают токен обычной строкой.
    }
    this.token = tokenFrom(body);
    if (!this.token) throw new Error("AlphaCRM token is missing");
  }

  private async post(
    path: string,
    page: number,
    filters: Record<string, unknown> = {},
  ): Promise<unknown> {
    if (!this.token) await this.login();
    let lastMessage = `AlphaCRM request failed for ${path}`;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.limiter.wait();
      let response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "X-ALFACRM-TOKEN": this.token ?? "",
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...filters, page }),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });

      if (response.status === 401 && attempt === 0) {
        await this.login();
        await this.limiter.wait();
        response = await fetch(`${this.baseUrl}${path}`, {
          method: "POST",
          headers: {
            "X-ALFACRM-TOKEN": this.token ?? "",
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...filters, page }),
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        });
      }

      if (response.ok) return response.json();
      const body = await response.text();
      lastMessage = `AlphaCRM HTTP ${response.status} for ${path}: ${body.slice(0, 180)}`;
      if ((response.status !== 429 && response.status < 500) || attempt === 2) {
        throw new Error(lastMessage);
      }
      await new Promise((resolve) => setTimeout(resolve, 450 * 2 ** attempt));
    }
    throw new Error(lastMessage);
  }

  async collection<T>(
    path: string,
    filters: Record<string, unknown> = {},
  ): Promise<T[]> {
    const items: T[] = [];
    for (let page = 0; page < 200; page += 1) {
      const body = (await this.post(path, page, filters)) as
        | { items?: T[]; total?: number; count?: number }
        | T[];
      const pageItems = Array.isArray(body) ? body : body.items ?? [];
      items.push(...pageItems);
      const total = Array.isArray(body) ? undefined : body.total;
      if (
        pageItems.length === 0 ||
        (typeof total === "number" && items.length >= total) ||
        (typeof total !== "number" && pageItems.length < 50)
      ) {
        break;
      }
    }
    return items;
  }
}

async function loadRawAlfaData(
  runtime: Required<Pick<AlfaRuntime, "ALFA_BASE_URL" | "ALFA_EMAIL" | "ALFA_API_KEY">> & AlfaRuntime,
  range: DashboardRange,
  forceRefresh: boolean,
): Promise<AlfaRawData> {
  const key = rangeCacheKey(range);
  const cached = rawCache.get(key);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.data;
  const pending = rawInFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    const client = new AlfaDashboardClient(
      runtime.ALFA_BASE_URL.trim().replace(/\/+$/, ""),
      runtime.ALFA_EMAIL,
      runtime.ALFA_API_KEY,
    );
    let branchIds = (runtime.ALFA_BRANCH_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (branchIds.length === 0) {
      const branches = await client.collection<{ id: number }>(
        "/v2api/branch/index",
      );
      branchIds = branches.map((branch) => String(branch.id));
    }

    const branchData = await Promise.all(
      branchIds.map(async (branchId) => {
        const [payments, paymentAccounts, paymentItems] =
          await Promise.all([
            client.collection<AlfaPayment>(`/v2api/${branchId}/pay/index`, {
              created_at_from: alfaDate(range.from),
              created_at_to: alfaDate(range.to),
            }),
            client.collection<AlfaDictionaryItem>(
              `/v2api/${branchId}/pay-account/index`,
            ),
            client.collection<AlfaDictionaryItem>(
              `/v2api/${branchId}/pay-item/index`,
            ),
          ]);
        return { payments, paymentAccounts, paymentItems };
      }),
    );
    const data = {
      payments: branchData.flatMap((item) => item.payments),
      customers: [],
      paymentAccounts: branchData.flatMap((item) => item.paymentAccounts),
      paymentItems: branchData.flatMap((item) => item.paymentItems),
      fetchedAt: Date.now(),
    };
    rawCache.set(key, { data, expiresAt: Date.now() + RAW_CACHE_TTL_MS });
    return data;
  })();
  rawInFlight.set(key, request);

  try {
    return await request;
  } finally {
    rawInFlight.delete(key);
  }
}

function buildAlfaDashboardData(
  raw: AlfaRawData,
  range: DashboardRange,
  sourceStatus: SourceStatus,
  statusMessage: string,
): AlfaDashboardData {
  const paymentAccounts = new Map(
    raw.paymentAccounts.map((item) => [item.id, item.name ?? `Счёт ${item.id}`]),
  );
  const paymentItems = new Map(
    raw.paymentItems.map((item) => [item.id, item.name ?? `Статья ${item.id}`]),
  );
  const customerNames = new Map(
    raw.customers.map((customer) => [
      customer.id,
      customer.name ?? `Клиент ${customer.id}`,
    ]),
  );

  const confirmedIncomePayments = raw.payments.filter((payment) => {
    const isIncome =
      Number(payment.income ?? 0) > 0 &&
      (payment.pay_type_name ?? "").toLocaleLowerCase("ru").includes("доход");
    const isConfirmed =
      payment.is_confirmed === undefined ||
      Boolean(Number(payment.is_confirmed)) ||
      payment.is_confirmed === true;
    return isIncome && isConfirmed;
  });
  const incomePayments = confirmedIncomePayments.filter((payment) => {
    const key = dateKey(payment.document_date ?? payment.created_at);
    return key >= range.from && key <= range.to;
  });

  const sales: AlfaSale[] = [...incomePayments]
    .sort((a, b) => {
      const dateCompare = dateKey(b.document_date ?? b.created_at).localeCompare(
        dateKey(a.document_date ?? a.created_at),
      );
      return dateCompare || b.id - a.id;
    })
    .map((payment) => {
      const category = paymentCategory(payment, paymentItems);
      return {
        id: payment.id,
        dateKey: dateKey(payment.document_date ?? payment.created_at),
        date: dateLabel(payment.document_date ?? payment.created_at),
        customer:
          payment.payer_name?.trim() ||
          (payment.customer_id
            ? customerNames.get(payment.customer_id) ?? `Клиент ${payment.customer_id}`
            : "Клиент не указан"),
        amount: Number(payment.income ?? 0),
        saleType: saleTypeForArticle(paymentArticle(category)),
        paymentMethod: payment.pay_account_id
          ? paymentAccounts.get(payment.pay_account_id) ?? "Не указано"
          : "Не указано",
        category,
      };
    });

  const dailyMap = new Map<string, AlfaDailySnapshot>();
  for (const payment of incomePayments) {
    const paymentDateKey = dateKey(payment.document_date ?? payment.created_at);
    const date = dateLabel(payment.document_date ?? payment.created_at);
    const row = dailyMap.get(paymentDateKey) ?? {
      dateKey: paymentDateKey,
      date,
      cash: 0,
      newCash: 0,
      repeatCash: 0,
      firstChineseCash: 0,
      repeatChineseCash: 0,
      bookingCash: 0,
      payments: 0,
      activations: 0,
      firstSales: 0,
      repeatSales: 0,
    };
    const amount = Number(payment.income ?? 0);
    const article = paymentArticle(paymentCategory(payment, paymentItems));
    row.cash += amount;
    row.payments += 1;
    if (article === "first") {
      row.firstSales += 1;
      row.newCash += amount;
      row.firstChineseCash += amount;
    } else if (article === "repeat") {
      row.repeatSales += 1;
      row.repeatCash += amount;
      row.repeatChineseCash += amount;
    } else if (article === "booking") {
      row.bookingCash += amount;
    }
    dailyMap.set(paymentDateKey, row);
  }

  for (const row of dailyMap.values()) {
    row.activations = new Set(
      incomePayments
        .filter(
          (payment) =>
            dateKey(payment.document_date ?? payment.created_at) === row.dateKey,
        )
        .map((payment) => payment.customer_id)
        .filter(Boolean),
    ).size;
  }

  return {
    connected: true,
    sourceStatus,
    statusMessage,
    cash: incomePayments.reduce(
      (sum, payment) => sum + Number(payment.income ?? 0),
      0,
    ),
    activations: new Set(
      incomePayments
        .map((payment) => payment.customer_id)
        .filter((id): id is number => Boolean(id)),
    ).size,
    payments: incomePayments.length,
    customers: new Set(raw.customers.map((customer) => customer.id)).size,
    activeStudents: raw.customers.filter((customer) => Boolean(customer.is_study)).length,
    daily: [...dailyMap.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
    sales,
    updatedAt: formatUpdatedAt(raw.fetchedAt),
  };
}

export async function getAlfaDashboardData(
  range: DashboardRange,
  forceRefresh = false,
): Promise<AlfaDashboardData> {
  const runtime = env as unknown as AlfaRuntime;
  if (!runtime.ALFA_BASE_URL || !runtime.ALFA_EMAIL || !runtime.ALFA_API_KEY) {
    if (runtime.DB) {
      try {
        const stored = await loadStoredAlfaData(runtime.DB);
        if (stored) {
          return buildAlfaDashboardData(
            stored,
            range,
            "stored",
            "Показана последняя сохранённая копия AlphaCRM",
          );
        }
      } catch {
        // Ни live-подключение, ни сохранённый снимок недоступны.
      }
    }
    return emptyAlfaData("Подключение AlphaCRM не настроено");
  }

  try {
    const raw = await loadRawAlfaData(
      runtime as Required<Pick<AlfaRuntime, "ALFA_BASE_URL" | "ALFA_EMAIL" | "ALFA_API_KEY">> & AlfaRuntime,
      range,
      forceRefresh,
    );
    return buildAlfaDashboardData(raw, range, "live", "Данные обновлены");
  } catch (error) {
    console.error(
      "AlphaCRM dashboard request failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    const cached = rawCache.get(rangeCacheKey(range));
    if (cached) {
      return buildAlfaDashboardData(
        cached.data,
        range,
        "cached",
        "AlphaCRM временно недоступна — показаны последние данные",
      );
    }
    if (runtime.DB) {
      try {
        const stored = await loadStoredAlfaData(runtime.DB);
        if (stored) {
          return buildAlfaDashboardData(
            stored,
            range,
            "stored",
            "Показана последняя сохранённая копия AlphaCRM",
          );
        }
      } catch (storedError) {
        console.error(
          "AlphaCRM stored dashboard request failed:",
          storedError instanceof Error ? storedError.message : "Unknown error",
        );
      }
    }
    return emptyAlfaData("Не удалось получить данные AlphaCRM");
  }
}
