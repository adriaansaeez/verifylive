import { NextResponse } from "next/server";
import { demoTranscript } from "@/lib/fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return NextResponse.json(demoTranscript(), {
    headers: { "Cache-Control": "no-store" },
  });
}
