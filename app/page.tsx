import { DashboardShell } from "./dashboard/dashboard-shell";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await getDashboardData();
  return <DashboardShell salesData={data} />;
}
