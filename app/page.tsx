import { DashboardClient } from "./dashboard-client";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await getDashboardData();
  return <DashboardClient data={data} />;
}
