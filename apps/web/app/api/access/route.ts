import { NextResponse } from "next/server";
import { createAccessCookie } from "@/app/api/_security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const token = typeof (payload as { token?: unknown } | null)?.token === "string"
    ? (payload as { token: string }).token.trim()
    : "";
  return createAccessCookie(request, token);
}
