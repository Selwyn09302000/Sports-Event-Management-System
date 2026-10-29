import { redirect } from "next/navigation";

export default async function GameRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/games/${id}/live`);
}
