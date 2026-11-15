"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RuntimeConfig, Session, SessionEvent, SessionSnapshot } from "@/lib/types";
import {
  createSession,
  fetchConfig,
  fetchDemoFixture,
  finishSession,
  postSegment,
  type DemoFixture,
} from "./api";
import {
  requestMicStream,
  requestTabStream,
  startMicAudio,
  startTabAudio,
  type AudioChunk,
  type TabCapture,
} from "./audio";
import { createWhisperTranscriber, type LiveTranscriber, type ModelStatus } from "./transcriber";
import { finishCapture } from "./session-lifecycle";
import { transcriptDelta } from "./transcript-merge";

export type Phase = "setup" | "starting" | "live" | "finishing" | "done" | "error";

/**
 * ASR windows used to be cut every 6 s regardless of the audio, so no window
 * ever ended where the speaker did and the gate was permanently judging
 * fragments cut mid-sentence. Windows now close on a pause, between a minimum
 * and a maximum length, so a span usually contains a finished idea.
 */
const MIN_WINDOW_MS = 3_000;
const MAX_WINDOW_MS = 10_000;
const CHUNK_MS = 250;
/** Consecutive quiet chunks that count as a pause in speech. */
const SILENCE_CHUNKS = 2;
/** A pause is relative to how loud this source actually is, with a floor for
 * a silent track. */
const SILENCE_RATIO = 0.18;
const SILENCE_FLOOR = 0.004;
/** Audio kept after a cut: a lot when cutting mid-speech, little after a
 * pause, where there is no word to recover. */
const OVERLAP_MS = 2_000;
const OVERLAP_AFTER_PAUSE_MS = 500;

function applyEvent(prev: SessionSnapshot | null, event: SessionEvent): SessionSnapshot | null {
  if (event.type === "snapshot") return event.snapshot;
  if (!prev) return prev;

  switch (event.type) {
    case "session.updated":
      return { ...prev, session: event.session };
    case "queue.updated":
      return { ...prev, queue: event.queue };
    case "segment.final": {
      if (prev.segments.some((segment) => segment.id === event.segment.id)) return prev;
      return { ...prev, segments: [...prev.segments, event.segment] };
    }
    case "claim.detected": {
      if (prev.claims.some((claim) => claim.id === event.claim.id)) return prev;
      return {
        ...prev,
        claims: [...prev.claims, { ...event.claim, evidence: [], revisions: [] }],
      };
    }
    case "claim.updated":
      return {
        ...prev,
        claims: prev.claims.map((claim) =>
          claim.id === event.claim.id ? { ...claim, ...event.claim } : claim,
        ),
      };
    case "claim.failed":
      return {
        ...prev,
        claims: prev.claims.map((claim) =>
          claim.id === event.claim.id ? { ...claim, ...event.claim } : claim,
        ),
      };
    case "claim.resolved":
      return {
        ...prev,
        claims: prev.claims.map((claim) =>
          claim.id === event.claim.id
            ? {
                ...claim,
                ...event.claim,
                evidence: event.evidence,
                revisions: [...claim.revisions.filter((rev) => rev.id !== event.revision.id), event.revision],
              }
            : claim,
        ),
      };
    default:
      return prev;
  }
}

function concatSamples(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

type Buffer = { chunks: Float32Array[]; startMs: number; endMs: number };

export function useSession() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [demoInfo, setDemoInfo] = useState<{ id: string; title: string; durationMs: number } | null>(null);
  const [phase, setPhase] = useState<Phase>("setup");
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [model, setModel] = useState<ModelStatus>({ stage: "idle", progress: 0, message: "" });
  const [asrBusy, setAsrBusy] = useState(false);
  const [source, setSource] = useState<"fixture" | "tab" | "mic" | null>(null);

  const streamRef = useRef<EventSource | null>(null);
  const tabRef = useRef<TabCapture | null>(null);
  const transcriberRef = useRef<LiveTranscriber | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const startRef = useRef(0);
  const bufferRef = useRef<Buffer | null>(null);
  const lastFlushedEndRef = useRef(0);
  const lastAsrTextRef = useRef("");
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stoppedRef = useRef(false);
  const stopPromiseRef = useRef<Promise<void> | null>(null);
  const stopActionRef = useRef<() => Promise<void>>(async () => undefined);
  const mountedRef = useRef(true);
  const peakRmsRef = useRef(0);
  const quietRunRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    void fetchConfig()
      .then((payload) => {
        if (!mountedRef.current) return;
        setConfig(payload.config);
        setDemoInfo(payload.demo);
      })
      .catch((cause: unknown) => {
        if (!mountedRef.current) return;
        setError(cause instanceof Error ? cause.message : "No se pudo leer la configuración");
      });
    return () => {
      mountedRef.current = false;
      streamRef.current?.close();
      void tabRef.current?.stop();
      transcriberRef.current?.dispose();
      for (const timer of timersRef.current) clearTimeout(timer);
    };
  }, []);

  const openStream = useCallback((sessionId: string) => {
    streamRef.current?.close();
    const stream = new EventSource(`/api/sessions/${sessionId}/stream`);
    streamRef.current = stream;
    stream.onmessage = (message) => {
      let event: SessionEvent;
      try {
        event = JSON.parse(message.data) as SessionEvent;
      } catch {
        return;
      }
      setSnapshot((prev) => applyEvent(prev, event));
      if (event.type === "session.updated") {
        if (event.session.status === "finished") {
          setPhase("done");
        }
        if (event.session.status === "failed") {
          setError(event.session.error ?? "La sesión falló");
          setPhase("error");
        }
      }
    };
  }, []);

  const sleep = useCallback((ms: number): Promise<void> => {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timersRef.current.push(timer);
    });
  }, []);

  const startDemo = useCallback(async () => {
    if (phase === "starting" || phase === "live") return;
    stoppedRef.current = false;
    stopPromiseRef.current = null;
    setPhase("starting");
    setError(null);
    setSnapshot(null);
    setSource("fixture");
    setModel({ stage: "ready", progress: 1, message: "Transcripción guionizada" });

    try {
      const fixture: DemoFixture = await fetchDemoFixture();
      const session = await createSession({ sourceType: "fixture", fixtureId: fixture.id });
      sessionRef.current = session;
      openStream(session.id);
      startRef.current = Date.now();
      setPhase("live");

      for (const segment of fixture.segments) {
        if (stoppedRef.current) break;
        const wait = segment.startMs - (Date.now() - startRef.current);
        if (wait > 0) await sleep(wait);
        if (stoppedRef.current) break;
        await postSegment(session.id, segment).catch((cause: unknown) => {
          if (!stoppedRef.current) {
            setError(cause instanceof Error ? cause.message : "No se pudo enviar el segmento");
          }
        });
      }

      if (!stoppedRef.current) await stop();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar la demo");
      setPhase("error");
    }
  }, [openStream, phase, sleep]);

  const flushAsr = useCallback((sessionId: string, atPause = false) => {
    const buffer = bufferRef.current;
    if (!buffer || buffer.chunks.length === 0) return;
    if (buffer.endMs <= lastFlushedEndRef.current) return;
    lastFlushedEndRef.current = buffer.endMs;
    quietRunRef.current = 0;

    const overlapMs = atPause ? OVERLAP_AFTER_PAUSE_MS : OVERLAP_MS;
    let retainedMs = 0;
    const retained: Float32Array[] = [];
    for (let index = buffer.chunks.length - 1; index >= 0 && retainedMs < overlapMs; index -= 1) {
      const chunk = buffer.chunks[index];
      if (!chunk) continue;
      retained.unshift(chunk);
      retainedMs += (chunk.length / 16_000) * 1000;
    }
    bufferRef.current = retained.length > 0
      ? { chunks: retained, startMs: buffer.endMs - retainedMs, endMs: buffer.endMs }
      : null;

    const transcriber = transcriberRef.current;
    if (!transcriber) return;
    const samples = concatSamples(buffer.chunks);
    const startMs = Math.max(0, buffer.startMs - startRef.current);
    const endMs = Math.max(startMs + 250, buffer.endMs - startRef.current);

    chainRef.current = chainRef.current.then(async () => {
      if (stoppedRef.current) return;
      setAsrBusy(true);
      try {
        const text = await transcriber.transcribe(samples, 16_000);
        const delta = transcriptDelta(lastAsrTextRef.current, text);
        lastAsrTextRef.current = text;
        if (delta.length < 3) return;
        const totalWords = Math.max(1, text.trim().split(/\s+/u).length);
        const deltaWords = Math.max(1, delta.trim().split(/\s+/u).length);
        const deltaStartMs = Math.max(startMs, endMs - (endMs - startMs) * (deltaWords / totalWords));
        await postSegment(sessionId, { startMs: Math.round(deltaStartMs), endMs, text: delta });
      } catch (cause) {
        setError(
          cause instanceof Error ? `Transcripción local: ${cause.message}` : "La transcripción local falló",
        );
      } finally {
        setAsrBusy(false);
      }
    });
  }, []);

  const onAudioChunk = useCallback(
    (sessionId: string, chunk: AudioChunk) => {
      if (stoppedRef.current) return;
      const normalized = Math.min(1, chunk.rms * 14);
      setLevel(normalized);
      const buffer = bufferRef.current;
      if (!buffer) {
        bufferRef.current = {
          chunks: [chunk.samples],
          startMs: chunk.capturedAt,
          endMs: chunk.capturedAt + (chunk.samples.length / chunk.sampleRate) * 1000,
        };
      } else {
        buffer.chunks.push(chunk.samples);
        buffer.endMs = chunk.capturedAt + (chunk.samples.length / chunk.sampleRate) * 1000;
      }
      const current = bufferRef.current;
      if (!current) return;
      const elapsed = current.endMs - current.startMs;

      peakRmsRef.current = Math.max(peakRmsRef.current * 0.995, chunk.rms);
      const quietBelow = Math.max(SILENCE_FLOOR, peakRmsRef.current * SILENCE_RATIO);
      quietRunRef.current = chunk.rms < quietBelow ? quietRunRef.current + 1 : 0;

      const pause = quietRunRef.current >= SILENCE_CHUNKS && elapsed >= MIN_WINDOW_MS;
      if (pause || elapsed >= MAX_WINDOW_MS) flushAsr(sessionId, pause);
    },
    [flushAsr],
  );

  const startCapture = useCallback(
    async (kind: "tab" | "mic", options: { preferCurrentTab?: boolean } = {}) => {
      if (phase === "starting" || phase === "live") return;
      stoppedRef.current = false;
      stopPromiseRef.current = null;
      setPhase("starting");
      setError(null);
      setSnapshot(null);
      setSource(kind);
      setLevel(0);
      sessionRef.current = null;
      lastFlushedEndRef.current = 0;
      lastAsrTextRef.current = "";
      peakRmsRef.current = 0;
      quietRunRef.current = 0;

      // getDisplayMedia/getUserMedia must run first: any earlier await drops the user gesture Chrome requires.
      let stream: MediaStream | null = null;
      let sharingEnded = false;
      try {
        stream = kind === "tab" ? await requestTabStream(options) : await requestMicStream();
        if (kind === "tab") {
          for (const track of stream.getAudioTracks()) {
            track.addEventListener("ended", () => {
              sharingEnded = true;
              // If session creation is still pending, the continuation below
              // closes it as soon as its id exists.
              if (sessionRef.current) void stopActionRef.current();
            }, { once: true });
          }
        }

        const session = await createSession({ sourceType: kind });
        sessionRef.current = session;
        openStream(session.id);
        if (sharingEnded) {
          await stopActionRef.current();
          return;
        }

        const transcriber = createWhisperTranscriber();
        transcriberRef.current = transcriber;
        await transcriber.prepare((status) => {
          if (mountedRef.current) setModel(status);
        });
        if (sharingEnded) {
          await stopActionRef.current();
          return;
        }

        const capture = await (kind === "tab"
          ? startTabAudio((chunk) => onAudioChunk(session.id, chunk), {
              chunkMs: CHUNK_MS,
              sampleRate: 16_000,
              onEnded: () => void stopActionRef.current(),
            }, stream)
          : startMicAudio((chunk) => onAudioChunk(session.id, chunk), { chunkMs: CHUNK_MS, sampleRate: 16_000 }, stream));
        if (sharingEnded) {
          await capture.stop();
          await stopActionRef.current();
          return;
        }
        tabRef.current = capture;
        startRef.current = capture.startedAt;
        setPhase("live");
      } catch (cause) {
        for (const track of stream?.getTracks() ?? []) track.stop();
        transcriberRef.current?.dispose();
        transcriberRef.current = null;
        if (sharingEnded) {
          await stopActionRef.current();
          return;
        }
        setError(cause instanceof Error ? cause.message : "No se pudo iniciar la captura");
        setPhase("error");
      }
    },
    [onAudioChunk, openStream, phase],
  );

  const startTab = useCallback(
    (options: { preferCurrentTab?: boolean } = {}) => startCapture("tab", options),
    [startCapture],
  );
  const startMic = useCallback(() => startCapture("mic"), [startCapture]);

  const stop = useCallback(async () => {
    if (stopPromiseRef.current) return stopPromiseRef.current;
    const stopping = (async () => {
      setPhase("finishing");
      for (const timer of timersRef.current) clearTimeout(timer);
      timersRef.current = [];

      const session = sessionRef.current;
      await finishCapture({
        // stop() awaits the worklet's final chunk. stoppedRef remains false so
        // onAudioChunk and queued ASR work can still consume it.
        stopCapture: async () => {
          await tabRef.current?.stop();
          tabRef.current = null;
        },
        flushFinalBuffer: () => {
          if (session) flushAsr(session.id);
        },
        waitForTranscription: () => chainRef.current.catch(() => undefined),
        activateStopGuard: () => {
          stoppedRef.current = true;
        },
        finishSession: async () => {
          if (!session) return;
          await finishSession(session.id).catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : "No se pudo cerrar la sesión");
          });
        },
        disposeModel: () => {
          transcriberRef.current?.dispose();
          transcriberRef.current = null;
        },
      });
      setLevel(0);
    })();
    stopPromiseRef.current = stopping;
    return stopping;
  }, [flushAsr]);
  stopActionRef.current = stop;

  const reset = useCallback(() => {
    stoppedRef.current = true;
    stopPromiseRef.current = null;
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current = [];
    streamRef.current?.close();
    streamRef.current = null;
    void tabRef.current?.stop();
    tabRef.current = null;
    transcriberRef.current?.dispose();
    transcriberRef.current = null;
    bufferRef.current = null;
    lastFlushedEndRef.current = 0;
    lastAsrTextRef.current = "";
    sessionRef.current = null;
    setSnapshot(null);
    setPhase("setup");
    setError(null);
    setLevel(0);
    setSource(null);
    setAsrBusy(false);
    setModel({ stage: "idle", progress: 0, message: "" });
  }, []);

  return {
    config,
    demoInfo,
    phase,
    snapshot,
    error,
    level,
    model,
    asrBusy,
    source,
    startDemo,
    startTab,
    startMic,
    stop,
    reset,
  };
}
