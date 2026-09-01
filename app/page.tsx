import { LaborTrackerApp } from "./tracker/LaborTrackerApp";
import { requireInternalSession } from "./internal-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireInternalSession("/");

  return <LaborTrackerApp initialView="dashboard" />;
}
