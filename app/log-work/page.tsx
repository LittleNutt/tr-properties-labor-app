import { LaborTrackerApp } from "../tracker/LaborTrackerApp";
import { requireInternalSession } from "../internal-auth";

export const dynamic = "force-dynamic";

export default async function LogWorkPage() {
  await requireInternalSession("/log-work");

  return <LaborTrackerApp initialView="log-work" />;
}
