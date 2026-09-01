import { LaborTrackerApp } from "../tracker/LaborTrackerApp";
import { requireInternalSession } from "../internal-auth";

export const dynamic = "force-dynamic";

export default async function EntitiesPage() {
  await requireInternalSession("/entities");

  return <LaborTrackerApp initialView="entities" />;
}
