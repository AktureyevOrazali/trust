import { analyticsRepository } from "@/db/repositories/analytics";
import {
  runSynchronization,
  triggerBackgroundSync,
} from "@/lib/integrations/sync";

export const dynamic = "force-dynamic";

const AUTO_SYNC_INTERVAL = 60 * 60 * 1000;
const REQUEST_COOLDOWN = 10 * 60 * 1000;

let nextAutomaticRequestAt = 0;
let localSync: Promise<unknown> | null = null;

async function latestAlphaFetchedAt(): Promise<number> {
  const records = await analyticsRepository.listAlphaRecords(["customer"]);
  return Math.max(0, ...records.map((record) => record.fetchedAt));
}

function status(fetchedAt: number) {
  return {
    fetchedAt: fetchedAt || null,
    stale: fetchedAt === 0 || Date.now() - fetchedAt >= AUTO_SYNC_INTERVAL,
  };
}

export async function GET() {
  return Response.json(status(await latestAlphaFetchedAt()), {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST() {
  const fetchedAt = await latestAlphaFetchedAt();
  const current = status(fetchedAt);
  if (!current.stale) return Response.json({ ...current, sync: "fresh" });

  if (Date.now() < nextAutomaticRequestAt || localSync) {
    return Response.json({ ...current, sync: "already_requested" }, { status: 202 });
  }
  nextAutomaticRequestAt = Date.now() + REQUEST_COOLDOWN;

  try {
    if (process.env.NETLIFY_LOCAL === "true") {
      localSync = runSynchronization("alfa")
        .catch((error) => console.error("Automatic local AlphaCRM sync failed", error))
        .finally(() => {
          localSync = null;
        });
    } else {
      await triggerBackgroundSync("alfa");
    }
    return Response.json({ ...current, sync: "accepted" }, { status: 202 });
  } catch (error) {
    nextAutomaticRequestAt = 0;
    console.error("Automatic AlphaCRM sync trigger failed", error);
    return Response.json(
      { ...current, sync: "failed", error: "Не удалось запустить автоматическую синхронизацию." },
      { status: 503 },
    );
  }
}
