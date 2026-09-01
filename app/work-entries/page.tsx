import { LaborTrackerApp } from "../tracker/LaborTrackerApp";
import { requireInternalSession } from "../internal-auth";

export const dynamic = "force-dynamic";

export default async function WorkEntriesPage() {
  await requireInternalSession("/work-entries");

  return <LaborTrackerApp initialView="work-entries" />;
}
