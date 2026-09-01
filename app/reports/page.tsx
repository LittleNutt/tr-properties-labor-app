import { LaborTrackerApp } from "../tracker/LaborTrackerApp";
import { requireInternalSession } from "../internal-auth";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  await requireInternalSession("/reports");

  return <LaborTrackerApp initialView="reports" />;
}
