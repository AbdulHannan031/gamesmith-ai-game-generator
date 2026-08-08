import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasUnpublishedChanges, listUserGames } from "@/lib/games";
import { DashboardGames } from "@/components/DashboardGames";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata = { title: "Your games" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const games = listUserGames(user.id).map((g) => ({
    ...g,
    drifted: g.visibility === "public" && hasUnpublishedChanges(g),
  }));

  return (
    <>
      <SiteHeader active="dashboard" />
      <main className="mx-auto max-w-[1400px] px-4 py-9 sm:px-6">
        <DashboardGames games={games} />
      </main>
    </>
  );
}
