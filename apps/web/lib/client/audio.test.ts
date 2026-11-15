import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestTabStream, startTabAudio } from "./audio";

class FakeTrack extends EventTarget {
  stopped = 0;
  constructor(readonly kind: "audio" | "video") { super(); }
  stop() { this.stopped += 1; }
}

class FakeMediaStream {
  constructor(private readonly tracks: FakeTrack[] = []) {}
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === "audio"); }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === "video"); }
}

class FakeAudioContext {
  readonly sampleRate: number;
  readonly state = "running";
  readonly audioWorklet = { addModule: async () => undefined };
  constructor(options: { sampleRate: number }) { this.sampleRate = options.sampleRate; }
  createMediaStreamSource() { return { connect: () => undefined }; }
  async resume() { return undefined; }
  async close() { return undefined; }
}

class FakeAudioWorkletNode {
  readonly port: {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: (message: { type: string; id: number }) => void;
  };
  constructor() {
    this.port = {
      onmessage: null,
      postMessage: (message) => {
        if (message.type !== "flush") return;
        this.port.onmessage?.(new MessageEvent("message", { data: {
          type: "chunk",
          samples: new Float32Array(800),
          rms: 0.2,
          flushId: message.id,
        } }));
      },
    };
  }
  disconnect() { return undefined; }
}

beforeEach(() => {
  vi.stubGlobal("MediaStream", FakeMediaStream);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);
  vi.stubGlobal("URL", { createObjectURL: () => "blob:test", revokeObjectURL: () => undefined });
});

afterEach(() => vi.unstubAllGlobals());

describe("tab audio capture", () => {
  it("calls getDisplayMedia immediately and validates audio after selection", async () => {
    const audio = new FakeTrack("audio");
    const video = new FakeTrack("video");
    const getDisplayMedia = vi.fn(async () => new FakeMediaStream([audio, video]));
    vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia } });

    const pending = requestTabStream();
    expect(getDisplayMedia).toHaveBeenCalledOnce();
    await expect(pending).resolves.toBeInstanceOf(FakeMediaStream);
    expect(video.stopped).toBe(1);
  });

  it("delivers the worklet's final chunk before stop resolves", async () => {
    const events: string[] = [];
    const capture = await startTabAudio(
      () => { events.push("chunk"); },
      { sampleRate: 16_000 },
      new FakeMediaStream([new FakeTrack("audio")]) as unknown as MediaStream,
    );

    await capture.stop();
    events.push("stopped");
    expect(events).toEqual(["chunk", "stopped"]);
  });

  it("notifies once when Chrome ends sharing", async () => {
    const audio = new FakeTrack("audio");
    let resolveEnded: () => void = () => undefined;
    const ended = new Promise<void>((resolve) => { resolveEnded = resolve; });
    const onEnded = vi.fn(resolveEnded);
    await startTabAudio(
      () => undefined,
      { sampleRate: 16_000, onEnded },
      new FakeMediaStream([audio]) as unknown as MediaStream,
    );

    audio.dispatchEvent(new Event("ended"));
    audio.dispatchEvent(new Event("ended"));
    await ended;
    expect(onEnded).toHaveBeenCalledOnce();
  });
});
