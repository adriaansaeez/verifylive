import { NextResponse } from "next/server";
import { finishSession, pendingWork } from "@/lib/orchestrator";
import { getSession } from "@/lib/db/repo";
import { protectMutation } from "@/app/api/_security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const denied = protectMutation(request, { scope: "sessions:finish", sessionId: id });
  if (denied) return denied;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: "sesión no encontrada" }, { status: 404 });

  // Drain in the background: Clef calls can take up to 50s each and the SSE
  // stream tells the UI exactly when the session leaves "finishing".
  void finishSession(id).catch(() => undefined);

  return NextResponse.json({ session: getSession(id), pending: pendingWork(id) }, { status: 202 });
}
