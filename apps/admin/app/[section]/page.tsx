import { notFound } from "next/navigation";
const sections = [
  "analytics",
  "activity",
  "features",
  "users",
  "journal",
  "plans",
  "promotions",
  "subscription-history",
  "announcements",
  "notifications",
  "anime-notices",
  "catalog",
  "winter",
  "maintenance",
  "templates",
  "system",
  "admin-journal",
  "diagnostics",
];
export default async function Section({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!sections.includes(section)) notFound();
  return null;
}
