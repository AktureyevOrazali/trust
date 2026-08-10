import { env } from "cloudflare:workers";
import { periodDates, periodStartSeconds, type DashboardPeriod } from "./period";

const PIPELINE_ID = 10819798;
const CLOSED_STATUS_IDS = new Set([142, 143]);
const AMO_PAGE_LIMIT = 250;

export interface DashboardStage {
  id: number;
  name: string;
  count: number;
  amount: number;
  sort: number;
}

export interface ManagerSnapshot {
  id: number;
  name: string;
  total: number;
  stageCounts: Record<string, number>;
}

export interface TrendPoint {
  label: string;
  value: number;
  isToday: boolean;
}

export interface AmoDashboardData {
  connected: boolean;
  activeDeals: number;
  activeAmount: number;
  unsorted: number;
  stages: DashboardStage[];
  managers: ManagerSnapshot[];
  trend: TrendPoint[];
  updatedAt: string;
}

const FALLBACK_STAGES: DashboardStage[] = [
  { id: 85423126, name: "Новый лид", count: 2, amount: 0, sort: 20 },
  { id: 85172050, name: "Недозвон", count: 114, amount: 0, sort: 30 },
  { id: 85171898, name: "Контакт сделан", count: 63, amount: 0, sort: 40 },
  { id: 85342722, name: "Записан на ПУ", count: 98, amount: 0, sort: 50 },
  { id: 85172062, name: "КЭВ", count: 1, amount: 0, sort: 60 },
  {
    id: 87147494,
    name: "Принимает решение",
    count: 20,
    amount: 45000,
    sort: 70,
  },
  { id: 85172070, name: "Предоплата", count: 25, amount: 37500, sort: 80 },
  { id: 87147498, name: "Полная оплата", count: 12, amount: 0, sort: 90 },
];

const FALLBACK_TREND: TrendPoint[] = [
  { label: "30.07", value: 2, isToday: false },
  { label: "31.07", value: 1, isToday: false },
  { label: "01.08", value: 14, isToday: false },
  { label: "02.08", value: 0, isToday: false },
  { label: "03.08", value: 18, isToday: false },
  { label: "04.08", value: 17, isToday: false },
  { label: "05.08", value: 2, isToday: true },
];

function fallbackData(): AmoDashboardData {
  return {
    connected: false,
    activeDeals: 335,
    activeAmount: 82500,
    unsorted: 1,
    stages: FALLBACK_STAGES,
    managers: [
      {
        id: 1,
        name: "Даниял",
        total: 170,
        stageCounts: {
          "85423126": 1,
          "85172050": 54,
          "85171898": 32,
          "85342722": 52,
          "85172062": 1,
        },
      },
      {
        id: 2,
        name: "Бехұлтан",
        total: 165,
        stageCounts: {
          "85423126": 1,
          "85172050": 60,
          "85171898": 31,
          "85342722": 46,
          "85172062": 0,
        },
      },
    ],
    trend: FALLBACK_TREND,
    updatedAt: "сегодня, 12:18",
  };
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

function dateKey(timestamp: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Qyzylorda",
  }).format(new Date(timestamp * 1000));
}

function dateLabel(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Qyzylorda",
  }).format(date);
}

type AmoRuntime = {
  DB?: D1Database;
  AMO_BASE_URL?: string;
  AMO_ACCESS_TOKEN?: string;
};

type AmoLead = {
  id: number;
  pipeline_id: number;
  status_id: number;
  responsible_user_id: number;
  price?: number;
  created_at: number;
};

type AmoUnsorted = {
  created_at?: number;
};

async function amoRequest<T>(
  baseUrl: string,
  token: string,
  path: string,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`amoCRM returned HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function amoCollection<T>(
  baseUrl: string,
  token: string,
  path: string,
  embeddedKey: string,
): Promise<T[]> {
  const items: T[] = [];

  for (let page = 1; page <= 50; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const body = await amoRequest<{
      _embedded?: Record<string, unknown>;
      _links?: { next?: { href?: string } };
    }>(
      baseUrl,
      token,
      `${path}${separator}limit=${AMO_PAGE_LIMIT}&page=${page}`,
    );
    const pageItems = body._embedded?.[embeddedKey];
    const list = Array.isArray(pageItems) ? (pageItems as T[]) : [];
    items.push(...list);

    if (!body._links?.next?.href || list.length === 0) break;
  }

  return items;
}

function buildTrend(
  leads: AmoLead[],
  period: DashboardPeriod,
  unsorted: AmoUnsorted[] = [],
): TrendPoint[] {
  const now = new Date();
  const dayStarts = periodDates(period);
  const countsByDate = new Map<string, number>();

  for (const lead of leads) {
    if (!lead.created_at) continue;
    const key = dateKey(lead.created_at);
    countsByDate.set(key, (countsByDate.get(key) ?? 0) + 1);
  }
  for (const item of unsorted) {
    if (!item.created_at) continue;
    const key = dateKey(item.created_at);
    countsByDate.set(key, (countsByDate.get(key) ?? 0) + 1);
  }

  const todayKey = dateKey(Math.floor(now.getTime() / 1000));
  return dayStarts.map((date) => {
    const key = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "Asia/Qyzylorda",
    }).format(date);
    return {
      label: dateLabel(date),
      value: countsByDate.get(key) ?? 0,
      isToday: key === todayKey,
    };
  });
}

async function getLiveAmoDashboardData(
  baseUrlValue: string,
  token: string,
  period: DashboardPeriod,
): Promise<AmoDashboardData> {
  const baseUrl = baseUrlValue.trim().replace(/\/+$/, "");
  const [allLeads, pipeline, users, unsorted] = await Promise.all([
    amoCollection<AmoLead>(
      baseUrl,
      token,
      "/api/v4/leads",
      "leads",
    ),
    amoRequest<{
      _embedded?: {
        statuses?: Array<{ id: number; name: string; sort: number }>;
      };
    }>(baseUrl, token, `/api/v4/leads/pipelines/${PIPELINE_ID}`),
    amoCollection<{ id: number; name: string }>(
      baseUrl,
      token,
      "/api/v4/users",
      "users",
    ),
    amoCollection<AmoUnsorted>(
      baseUrl,
      token,
      `/api/v4/leads/unsorted?filter[pipeline_id]=${PIPELINE_ID}`,
      "unsorted",
    ),
  ]);

  const pipelineLeads = allLeads.filter(
    (lead) => lead.pipeline_id === PIPELINE_ID && lead.created_at >= periodStartSeconds(period),
  );
  const activeLeads = pipelineLeads.filter(
    (lead) => !CLOSED_STATUS_IDS.has(lead.status_id),
  );
  const currentUnsorted = unsorted.filter(
    (item) => Number(item.created_at ?? 0) >= periodStartSeconds(period),
  );
  const statusDefinitions = pipeline._embedded?.statuses ?? [];

  const stages = statusDefinitions
    .filter((status) => !CLOSED_STATUS_IDS.has(status.id))
    .map((status) => {
      const leads = activeLeads.filter((lead) => lead.status_id === status.id);
      return {
        id: status.id,
        name: status.name,
        count: leads.length,
        amount: leads.reduce((sum, lead) => sum + Number(lead.price ?? 0), 0),
        sort: status.sort,
      };
    })
    .sort((a, b) => a.sort - b.sort);

  const userNames = new Map(users.map((user) => [user.id, user.name]));
  const managerMap = new Map<number, ManagerSnapshot>();
  for (const lead of activeLeads) {
    const manager = managerMap.get(lead.responsible_user_id) ?? {
      id: lead.responsible_user_id,
      name:
        userNames.get(lead.responsible_user_id) ??
        `Менеджер ${lead.responsible_user_id}`,
      total: 0,
      stageCounts: {},
    };
    manager.total += 1;
    manager.stageCounts[String(lead.status_id)] =
      (manager.stageCounts[String(lead.status_id)] ?? 0) + 1;
    managerMap.set(lead.responsible_user_id, manager);
  }

  return {
    connected: true,
    activeDeals: activeLeads.length,
    activeAmount: activeLeads.reduce(
      (sum, lead) => sum + Number(lead.price ?? 0),
      0,
    ),
    unsorted: currentUnsorted.length,
    stages,
    managers: [...managerMap.values()].sort((a, b) => b.total - a.total),
    // Match the amoCRM pipeline view: only deals that remain open are included.
    trend: buildTrend(activeLeads, period, currentUnsorted),
    updatedAt: formatUpdatedAt(Date.now()),
  };
}

export async function getAmoDashboardData(
  period: DashboardPeriod = "month",
): Promise<AmoDashboardData> {
  const runtime = env as unknown as AmoRuntime;

  if (runtime.AMO_BASE_URL && runtime.AMO_ACCESS_TOKEN) {
    try {
      return await getLiveAmoDashboardData(
        runtime.AMO_BASE_URL,
        runtime.AMO_ACCESS_TOKEN,
        period,
      );
    } catch (error) {
      console.error(
        "amoCRM dashboard request failed:",
        error instanceof Error ? error.message : "Unknown error",
      );
      // If amoCRM is temporarily unavailable, keep the dashboard usable
      // with the latest locally stored snapshot.
    }
  }

  if (!runtime.DB) return fallbackData();

  try {
    const periodStart = periodStartSeconds(period);
    const [stageResult, statusResult, managerResult, userResult, createdResult, run, unsortedResult] =
      await Promise.all([
        runtime.DB.prepare(
          `SELECT
             CAST(json_extract(payload, '$.status_id') AS INTEGER) AS status_id,
             COUNT(*) AS count,
             COALESCE(SUM(CAST(json_extract(payload, '$.price') AS INTEGER)), 0) AS amount
           FROM integration_records
           WHERE source = 'amo'
             AND entity_type = 'leads'
             AND CAST(json_extract(payload, '$.pipeline_id') AS INTEGER) = ?
             AND CAST(json_extract(payload, '$.created_at') AS INTEGER) >= ?
           GROUP BY status_id`,
        )
          .bind(PIPELINE_ID, periodStart)
          .all(),
        runtime.DB.prepare(
          `SELECT payload
           FROM integration_records
           WHERE source = 'amo'
             AND entity_type = 'pipeline_statuses'
             AND scope = ?`,
        )
          .bind(String(PIPELINE_ID))
          .all(),
        runtime.DB.prepare(
          `SELECT
             CAST(json_extract(payload, '$.responsible_user_id') AS INTEGER) AS user_id,
             CAST(json_extract(payload, '$.status_id') AS INTEGER) AS status_id,
             COUNT(*) AS count
           FROM integration_records
           WHERE source = 'amo'
             AND entity_type = 'leads'
             AND CAST(json_extract(payload, '$.pipeline_id') AS INTEGER) = ?
             AND CAST(json_extract(payload, '$.created_at') AS INTEGER) >= ?
           GROUP BY user_id, status_id`,
        )
          .bind(PIPELINE_ID, periodStart)
          .all(),
        runtime.DB.prepare(
          `SELECT payload
           FROM integration_records
           WHERE source = 'amo' AND entity_type = 'users'`,
        ).all(),
        runtime.DB.prepare(
          `SELECT CAST(json_extract(payload, '$.created_at') AS INTEGER) AS created_at
           FROM integration_records
           WHERE source = 'amo'
             AND entity_type = 'leads'
             AND CAST(json_extract(payload, '$.pipeline_id') AS INTEGER) = ?
             AND CAST(json_extract(payload, '$.created_at') AS INTEGER) >= ?
             AND CAST(json_extract(payload, '$.status_id') AS INTEGER) NOT IN (142, 143)`,
        )
          .bind(PIPELINE_ID, periodStart)
          .all(),
        runtime.DB.prepare(
          `SELECT completed_at
           FROM integration_sync_runs
           WHERE source = 'amo' AND status IN ('completed', 'completed_with_errors')
           ORDER BY started_at DESC
           LIMIT 1`,
        ).first<{ completed_at: number | null }>(),
        runtime.DB.prepare(
          `SELECT CAST(json_extract(payload, '$.created_at') AS INTEGER) AS created_at
           FROM integration_records
           WHERE source = 'amo'
             AND entity_type = 'unsorted'
             AND CAST(json_extract(payload, '$.pipeline_id') AS INTEGER) = ?
             AND CAST(json_extract(payload, '$.created_at') AS INTEGER) >= ?`,
        )
          .bind(PIPELINE_ID, periodStart)
          .all(),
      ]);

    const statusMap = new Map<number, { name: string; sort: number }>();
    for (const row of statusResult.results as Array<{ payload: string }>) {
      const status = JSON.parse(row.payload) as {
        id: number;
        name: string;
        sort: number;
      };
      statusMap.set(status.id, { name: status.name, sort: status.sort });
    }

    const stages = (
      stageResult.results as Array<{
        status_id: number;
        count: number;
        amount: number;
      }>
    )
      .filter((row) => !CLOSED_STATUS_IDS.has(row.status_id))
      .map((row) => ({
        id: row.status_id,
        name: statusMap.get(row.status_id)?.name ?? `Этап ${row.status_id}`,
        count: Number(row.count),
        amount: Number(row.amount),
        sort: statusMap.get(row.status_id)?.sort ?? 999,
      }))
      .sort((a, b) => a.sort - b.sort);

    const users = new Map<number, string>();
    for (const row of userResult.results as Array<{ payload: string }>) {
      const user = JSON.parse(row.payload) as { id: number; name: string };
      users.set(user.id, user.name);
    }

    const managerMap = new Map<number, ManagerSnapshot>();
    for (const row of managerResult.results as Array<{
      user_id: number;
      status_id: number;
      count: number;
    }>) {
      if (CLOSED_STATUS_IDS.has(row.status_id)) continue;
      const manager = managerMap.get(row.user_id) ?? {
        id: row.user_id,
        name: users.get(row.user_id) ?? `Менеджер ${row.user_id}`,
        total: 0,
        stageCounts: {},
      };
      manager.total += Number(row.count);
      manager.stageCounts[String(row.status_id)] = Number(row.count);
      managerMap.set(row.user_id, manager);
    }

    const now = new Date();
    const dayStarts = periodDates(period);
    const countsByDate = new Map<string, number>();
    for (const row of createdResult.results as Array<{ created_at: number }>) {
      if (!row.created_at) continue;
      const key = dateKey(Number(row.created_at));
      countsByDate.set(key, (countsByDate.get(key) ?? 0) + 1);
    }
    for (const row of unsortedResult.results as Array<{ created_at: number }>) {
      if (!row.created_at) continue;
      const key = dateKey(Number(row.created_at));
      countsByDate.set(key, (countsByDate.get(key) ?? 0) + 1);
    }
    const todayKey = dateKey(Math.floor(now.getTime() / 1000));
    const trend = dayStarts.map((date) => {
      const key = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: "Asia/Qyzylorda",
      }).format(date);
      return {
        label: dateLabel(date),
        value: countsByDate.get(key) ?? 0,
        isToday: key === todayKey,
      };
    });

    const activeDeals = stages.reduce((sum, stage) => sum + stage.count, 0);
    const activeAmount = stages.reduce((sum, stage) => sum + stage.amount, 0);

    return {
      connected: true,
      activeDeals,
      activeAmount,
      unsorted: unsortedResult.results.length,
      stages,
      managers: [...managerMap.values()].sort((a, b) => b.total - a.total),
      trend,
      updatedAt: run?.completed_at
        ? formatUpdatedAt(run.completed_at)
        : "нет данных",
    };
  } catch {
    return fallbackData();
  }
}
