import { NextResponse } from "next/server";
import { ingestSegment } from "@/lib/orchestrator";
import { protectMutation } from "@/app/api/_security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT = 4_000;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const denied = protectMutation(request, { scope: "segments:create", sessionId: id });
  if (denied) return denied;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const body = (payload ?? {}) as { text?: unknown; startMs?: unknown; endMs?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const startMs = Number(body.startMs);
  const endMs = Number(body.endMs);

  if (!text) return NextResponse.json({ error: "texto vacío" }, { status: 400 });
  if (text.length > MAX_TEXT) return NextResponse.json({ error: "texto demasiado largo" }, { status: 413 });
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs < startMs) {
    return NextResponse.json({ error: "timestamps inválidos" }, { status: 400 });
  }

  const result = await ingestSegment({ sessionId: id, text, startMs, endMs });
  if (!result) {
    return NextResponse.json({ error: "sesión no encontrada o cerrada" }, { status: 409 });
  }

  return NextResponse.json(
    {
      segment: result.segment,
      claims: result.claims.map((claim) => ({
        id: claim.id,
        text: claim.text,
        startMs: claim.startMs,
        status: claim.status,
      })),
    },
    { status: 201 },
  );
}
