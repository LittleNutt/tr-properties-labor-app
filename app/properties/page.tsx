import { LaborTrackerApp } from "../tracker/LaborTrackerApp";
import { requireInternalSession } from "../internal-auth";

export const dynamic = "force-dynamic";

export default async function PropertiesPage() {
  await requireInternalSession("/properties");

  return <LaborTrackerApp initialView="properties" />;
}
