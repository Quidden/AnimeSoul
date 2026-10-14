import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PostDetail } from "../../../components/ContentPanels";
export const metadata: Metadata = { title: "Публикация", robots: { index: false, follow: false } };
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return (
    <div className="account-page community-page">
      <h1>Публикация</h1>
      <PostDetail id={id} />
    </div>
  );
}
