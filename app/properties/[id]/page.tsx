import { LaborTrackerApp } from "../../tracker/LaborTrackerApp";
import { requireInternalSession } from "../../internal-auth";

type PropertyDetailPageProps = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

export default async function PropertyDetailPage({
  params,
}: PropertyDetailPageProps) {
  const { id } = await params;
  await requireInternalSession(`/properties/${encodeURIComponent(id)}`);

  return <LaborTrackerApp initialView="property-detail" propertyId={id} />;
}
