import { analyticsRepository } from "@/db/repositories/analytics";
import {
  ensureTeacherRates,
  updateTeacherRate,
} from "@/db/repositories/teacher-rates";
import { serverEnv } from "@/lib/runtime/env";

export const dynamic = "force-dynamic";

function authorized(request: Request, secret: string | undefined): boolean {
  return Boolean(secret) && (
    request.headers.get("authorization") === `Bearer ${secret}` ||
    request.headers.get("x-sync-secret") === secret
  );
}

export async function GET() {
  const records = await analyticsRepository.listAlphaRecords(["teacher"]);
  return Response.json({ rates: await ensureTeacherRates(records) }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function PUT(request: Request) {
  if (!authorized(request, serverEnv().syncSecret)) {
    return Response.json({ error: "Неверный ключ администратора." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Некорректный JSON." }, { status: 400 });
  }
  const values = body && typeof body === "object" && "rates" in body
    ? (body as { rates?: unknown }).rates
    : undefined;
  if (!Array.isArray(values) || values.length === 0) {
    return Response.json({ error: "Передайте непустой массив rates." }, { status: 400 });
  }

  for (const value of values) {
    if (!value || typeof value !== "object") {
      return Response.json({ error: "Некорректная запись ставки." }, { status: 400 });
    }
    const item = value as Record<string, unknown>;
    const branchId = typeof item.branchId === "string" ? item.branchId.trim() : "";
    const teacherId = typeof item.teacherId === "string" ? item.teacherId.trim() : "";
    const rate = Number(item.rate);
    if (!branchId || !teacherId || !Number.isInteger(rate) || rate < 0 || rate > 1_000_000) {
      return Response.json({ error: "Ставка должна быть целым числом от 0 до 1 000 000." }, { status: 400 });
    }
    await updateTeacherRate({ branchId, teacherId, rate });
  }

  const records = await analyticsRepository.listAlphaRecords(["teacher"]);
  return Response.json({ rates: await ensureTeacherRates(records) });
}
