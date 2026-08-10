import { AMO_ENTITY_CATALOG } from "@/lib/integrations/amo";
import { ALFA_ENTITY_CATALOG } from "@/lib/integrations/alfa";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    amo: {
      entities: AMO_ENTITY_CATALOG,
      requiredEnvironment: ["AMO_BASE_URL", "AMO_ACCESS_TOKEN"],
    },
    alfa: {
      entities: ALFA_ENTITY_CATALOG,
      requiredEnvironment: ["ALFA_BASE_URL", "ALFA_EMAIL", "ALFA_API_KEY"],
      optionalEnvironment: ["ALFA_BRANCH_IDS"],
    },
  });
}
