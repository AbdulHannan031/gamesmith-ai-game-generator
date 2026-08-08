import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { loadHistory } from "@/lib/agent";
import { getFiles, getOwnedGame } from "@/lib/games";
import { systemPrompt } from "@/lib/prompt";
import { estimateTokens } from "@/lib/tokens";
import { toTranscript } from "@/lib/transcript";
import { EditorShell } from "@/components/EditorShell";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params) {
  const user = await getCurrentUser();
  if (!user) return { title: "Editor" };
  const game = getOwnedGame((await params).id, user.id);
  return { title: game ? `${game.title} — editing` : "Editor" };
}

export default async function EditorPage({ params }: Params) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login`);

  const game = getOwnedGame(id, user.id);
  if (!game) notFound();

  const files = getFiles(id);
  const all = loadHistory(id, true);
  const live = all.filter((m) => m.compacted === 0);

  const contextTokens =
    live.reduce((n, m) => n + m.tokens, 0) + estimateTokens(systemPrompt(game, files));

  return (
    <Suspense fallback={null}>
      <EditorShell
        game={game}
        initialFiles={files}
        initialItems={toTranscript(all)}
        initialContextTokens={contextTokens}
      />
    </Suspense>
  );
}
