import { LaborTrackerApp } from "../../tracker/LaborTrackerApp";

type PropertyDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function PropertyDetailPage({
  params,
}: PropertyDetailPageProps) {
  const { id } = await params;

  return <LaborTrackerApp initialView="property-detail" propertyId={id} />;
}
