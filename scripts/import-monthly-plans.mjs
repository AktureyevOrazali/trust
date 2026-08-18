import { pathToFileURL } from "node:url";

const INTEGER_FIELDS = [
  "new_leads",
  "no_contact_percent",
  "contact_percent",
  "revenue",
  "new_sales",
  "repeat_revenue",
  "updated_at",
];

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function rowsFrom(value) {
  if (Array.isArray(value)) {
    const envelopes = value.map(object);
    if (
      value.length > 0 &&
      envelopes.every((entry) => entry && Array.isArray(entry.results))
    ) {
      return envelopes.flatMap((entry) => entry.results);
    }
    return value;
  }
  const envelope = object(value);
  if (envelope && Array.isArray(envelope.results)) return envelope.results;
  throw new Error("Ожидался массив строк или объект с полем results");
}

function validMonth(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5));
  return month >= 1 && month <= 12;
}

function integerField(row, field, index) {
  const value = row[field];
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Строка ${index + 1}: ${field} должен быть неотрицательным целым числом`);
  }
  return value;
}

export function parseMonthlyPlans(input) {
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("Входные данные не являются корректным JSON");
  }

  const months = new Set();
  return rowsFrom(parsed).map((value, index) => {
    const row = object(value);
    if (!row) throw new Error(`Строка ${index + 1}: ожидался объект`);
    if (!validMonth(row.month)) {
      throw new Error(`Строка ${index + 1}: month должен иметь формат YYYY-MM`);
    }
    if (months.has(row.month)) {
      throw new Error(`Строка ${index + 1}: месяц ${row.month} повторяется`);
    }
    months.add(row.month);
    const values = Object.fromEntries(
      INTEGER_FIELDS.map((field) => [field, integerField(row, field, index)]),
    );
    return {
      month: row.month,
      newLeads: values.new_leads,
      noContactPercent: values.no_contact_percent,
      contactPercent: values.contact_percent,
      revenue: values.revenue,
      newSales: values.new_sales,
      repeatRevenue: values.repeat_revenue,
      updatedAt: values.updated_at,
    };
  });
}

async function readStandardInput() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function savePlans(plans) {
  if (plans.length === 0) return;
  const connectionString = process.env.NETLIFY_DB_URL;
  if (!connectionString) {
    throw new Error("Не задана переменная NETLIFY_DB_URL");
  }
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString });
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    for (const plan of plans) {
      await client.query(
        `INSERT INTO monthly_plans (
          month, new_leads, no_contact_percent, contact_percent,
          revenue, new_sales, repeat_revenue, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (month) DO UPDATE SET
          new_leads = EXCLUDED.new_leads,
          no_contact_percent = EXCLUDED.no_contact_percent,
          contact_percent = EXCLUDED.contact_percent,
          revenue = EXCLUDED.revenue,
          new_sales = EXCLUDED.new_sales,
          repeat_revenue = EXCLUDED.repeat_revenue,
          updated_at = EXCLUDED.updated_at`,
        [
          plan.month,
          plan.newLeads,
          plan.noContactPercent,
          plan.contactPercent,
          plan.revenue,
          plan.newSales,
          plan.repeatRevenue,
          plan.updatedAt,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

async function main() {
  const plans = parseMonthlyPlans(await readStandardInput());
  await savePlans(plans);
  console.log(`Импортировано планов: ${plans.length}`);
}

function safeMessage(error) {
  const message = error instanceof Error ? error.message : "Неизвестная ошибка";
  const secret = process.env.NETLIFY_DB_URL;
  return secret ? message.replaceAll(secret, "[database]") : message;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    await main();
  } catch (error) {
    console.error(`Импорт не выполнен: ${safeMessage(error)}`);
    process.exitCode = 1;
  }
}
