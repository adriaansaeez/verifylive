import type {
  ClaimWithEvidence,
  RuntimeConfig,
  Session,
  SessionSnapshot,
  SourceType,
  TranscriptSegment,
} from "@/lib/types";

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchConfig(): Promise<{
  config: RuntimeConfig;
  demo: { id: string; title: string; durationMs: number };
}> {
  return json(await fetch("/api/config", { cache: "no-store" }));
}

export async function createSession(input: {
  sourceType: SourceType;
  fixtureId?: string;
}): Promise<Session> {
  const response = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await json<{ session: Session }>(response);
  return payload.session;
}

export async function postSegment(
  sessionId: string,
  segment: { startMs: number; endMs: number; text: string },
): Promise<{ segment: TranscriptSegment; claims: { id: string; text: string }[] }> {
  const response = await fetch(`/api/sessions/${sessionId}/segments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(segment),
  });
  return json(response);
}

export async function finishSession(sessionId: string): Promise<void> {
  const response = await fetch(`/api/sessions/${sessionId}/finish`, { method: "POST" });
  await json(response);
}

export async function fetchSnapshot(sessionId: string): Promise<SessionSnapshot> {
  return json(await fetch(`/api/sessions/${sessionId}`, { cache: "no-store" }));
}

export type DemoFixture = {
  id: string;
  title: string;
  language: string;
  durationMs: number;
  segments: { startMs: number; endMs: number; text: string }[];
};

export async function fetchDemoFixture(): Promise<DemoFixture> {
  return json(await fetch("/api/fixtures/demo", { cache: "no-store" }));
}

export type { ClaimWithEvidence };
