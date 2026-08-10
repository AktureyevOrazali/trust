import { env } from "cloudflare:workers";
import { periodStartKey, type DashboardPeriod } from "./period";

export interface AlfaDashboardData {
  connected: boolean;
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
  date: string;
  customer: string;
  amount: number;
  saleType: "Первая" | "Повторная" | "Бронь" | "Не указано";
  paymentMethod: string;
  category: string;
}

type AlfaRuntime = {
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

function emptyAlfaData(): AlfaDashboardData {
  return {
    connected: false,
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

function monthKey(value: string | undefined): string {
  if (!value) return "";
  const ru = value.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (ru) return `${ru[3]}-${ru[2]}`;
  const iso = value.match(/^(\d{4})-(\d{2})-\d{2}/);
  return iso ? `${iso[1]}-${iso[2]}` : "";
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

function formatUpdatedAt(): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Qyzylorda",
  }).format(new Date());
}

class AlfaDashboardClient {
  private token: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly email: string,
    private readonly apiKey: string,
  ) {}

  private async login(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v2api/auth/login`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: this.email, api_key: this.apiKey }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`AlphaCRM auth HTTP ${response.status}`);

    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Some AlphaCRM installations return the token as plain text.
    }
    this.token = tokenFrom(body);
    if (!this.token) throw new Error("AlphaCRM token is missing");
  }

  private async post(path: string, page: number): Promise<unknown> {
    if (!this.token) await this.login();
    const send = () =>
      fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "X-ALFACRM-TOKEN": this.token ?? "",
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ page }),
        cache: "no-store",
      });

    let response = await send();
    if (response.status === 401) {
      await this.login();
      response = await send();
    }
    if (!response.ok) {
      throw new Error(`AlphaCRM HTTP ${response.status} for ${path}`);
    }
    return response.json();
  }

  async collection<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    for (let page = 0; page < 100; page += 1) {
      const body = (await this.post(path, page)) as
        | { items?: T[]; total?: number }
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

export async function getAlfaDashboardData(
  period: DashboardPeriod = "month",
): Promise<AlfaDashboardData> {
  const runtime = env as unknown as AlfaRuntime;
  if (
    !runtime.ALFA_BASE_URL ||
    !runtime.ALFA_EMAIL ||
    !runtime.ALFA_API_KEY
  ) {
    return emptyAlfaData();
  }

  try {
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
        const [payments, customers, paymentAccounts, paymentItems] =
          await Promise.all([
          client.collection<AlfaPayment>(`/v2api/${branchId}/pay/index`),
          client.collection<AlfaCustomer>(`/v2api/${branchId}/customer/index`),
          client.collection<AlfaDictionaryItem>(
            `/v2api/${branchId}/pay-account/index`,
          ),
          client.collection<AlfaDictionaryItem>(
            `/v2api/${branchId}/pay-item/index`,
          ),
        ]);
        return { payments, customers, paymentAccounts, paymentItems };
      }),
    );

    const payments = branchData.flatMap((item) => item.payments);
    const customers = branchData.flatMap((item) => item.customers);
    const paymentAccounts = new Map(
      branchData
        .flatMap((item) => item.paymentAccounts)
        .map((item) => [item.id, item.name ?? `Счёт ${item.id}`]),
    );
    const paymentItems = new Map(
      branchData
        .flatMap((item) => item.paymentItems)
        .map((item) => [item.id, item.name ?? `Статья ${item.id}`]),
    );
    const customerNames = new Map(
      customers.map((customer) => [
        customer.id,
        customer.name ?? `Клиент ${customer.id}`,
      ]),
    );
    const startKey = periodStartKey(period);
    const confirmedIncomePayments = payments.filter((payment) => {
      const isIncome =
        Number(payment.income ?? 0) > 0 &&
        (payment.pay_type_name ?? "")
          .toLocaleLowerCase("ru")
          .includes("доход");
      const isConfirmed =
        payment.is_confirmed === undefined ||
        Boolean(Number(payment.is_confirmed)) ||
        payment.is_confirmed === true;
      return isIncome && isConfirmed;
    });
    const incomePayments = confirmedIncomePayments.filter((payment) =>
      dateKey(payment.document_date ?? payment.created_at) >= startKey,
    );

    const sales: AlfaSale[] = [...incomePayments]
      .sort((a, b) => {
        const dateCompare = dateKey(
          b.document_date ?? b.created_at,
        ).localeCompare(dateKey(a.document_date ?? a.created_at));
        return dateCompare || b.id - a.id;
      })
      .map((payment) => {
        const category = paymentCategory(payment, paymentItems);
        return {
          id: payment.id,
          date: dateLabel(payment.document_date ?? payment.created_at),
          customer: payment.customer_id
            ? customerNames.get(payment.customer_id) ??
              `Клиент ${payment.customer_id}`
            : "Клиент не указан",
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
      const date = dateLabel(payment.document_date ?? payment.created_at);
      const row = dailyMap.get(date) ?? {
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
      } else if (article === "repeat") {
        row.repeatSales += 1;
        row.repeatCash += amount;
      }
      if (article === "first") row.firstChineseCash += amount;
      if (article === "repeat") row.repeatChineseCash += amount;
      if (article === "booking") row.bookingCash += amount;
      dailyMap.set(date, row);
    }

    for (const row of dailyMap.values()) {
      row.activations = new Set(
        incomePayments
          .filter(
            (payment) =>
              dateLabel(payment.document_date ?? payment.created_at) ===
              row.date,
          )
          .map((payment) => payment.customer_id)
          .filter(Boolean),
      ).size;
    }

    return {
      connected: true,
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
      customers: new Set(customers.map((customer) => customer.id)).size,
      activeStudents: customers.filter((customer) => Boolean(customer.is_study))
        .length,
      daily: [...dailyMap.values()].sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
      sales,
      updatedAt: formatUpdatedAt(),
    };
  } catch {
    return emptyAlfaData();
  }
}
