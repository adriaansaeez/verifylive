import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { closeStaleSessions, createSession } from "@/lib/db/repo";
import { fixtureTranscript } from "@/lib/fixtures";
import type { SourceType } from "@/lib/types";
import { protectMutation } from "@/app/api/_security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE_TYPES = new Set<SourceType>(["tab", "mic", "local_file", "fixture"]);

export async function POST(request: Request): Promise<Response> {
  const denied = protectMutation(request, { scope: "sessions:create" });
  if (denied) return denied;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const body = (payload ?? {}) as { sourceType?: unknown; fixtureId?: unknown };
  const sourceType = typeof body.sourceType === "string" ? body.sourceType : "";
  if (!SOURCE_TYPES.has(sourceType as SourceType)) {
    return NextResponse.json({ error: "sourceType inválido" }, { status: 400 });
  }
  const fixtureId = typeof body.fixtureId === "string" ? body.fixtureId : null;
  if (sourceType === "fixture" && (!fixtureId || !fixtureTranscript(fixtureId))) {
    return NextResponse.json({ error: "fixtureId desconocido" }, { status: 400 });
  }

  // Starting a capture is the natural moment to tidy up the ones that were
  // abandoned without a stop.
  closeStaleSessions();

  const session = createSession({
    id: `ses_${randomUUID()}`,
    sourceType: sourceType as SourceType,
    fixtureId,
  });

  return NextResponse.json({ session }, { status: 201 });
}
