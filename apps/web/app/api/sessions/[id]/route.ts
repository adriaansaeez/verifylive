import { NextResponse } from "next/server";
import { snapshot } from "@/lib/db/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const data = snapshot(id);
  if (!data) return NextResponse.json({ error: "sesión no encontrada" }, { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
