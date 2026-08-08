import { corsPreflight, serveGameFile } from "@/lib/serve";
import { STARTER_FILES } from "@/lib/template";

type Params = { params: Promise<{ path?: string[] }> };

/** The starter template, playable on the landing page before anything is published. */
export async function GET(req: Request, { params }: Params) {
  const { path } = await params;
  return serveGameFile(STARTER_FILES, path, req);
}

export const OPTIONS = () => corsPreflight();
