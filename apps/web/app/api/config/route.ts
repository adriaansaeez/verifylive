import { NextResponse } from "next/server";
import { runtimeConfig } from "@/lib/config";
import { demoTranscript } from "@/lib/fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const config = runtimeConfig();
  return NextResponse.json(
    {
      config,
      demo: {
        id: demoTranscript().id,
        title: demoTranscript().title,
        durationMs: demoTranscript().durationMs,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
