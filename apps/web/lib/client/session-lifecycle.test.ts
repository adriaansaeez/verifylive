import { describe, expect, it, vi } from "vitest";
import { finishCapture } from "./session-lifecycle";

describe("finishCapture", () => {
  it("processes the final worklet buffer before guarding and disposing", async () => {
    const calls: string[] = [];

    await finishCapture({
      stopCapture: async () => { calls.push("worklet-flushed"); },
      flushFinalBuffer: () => { calls.push("buffer-enqueued"); },
      waitForTranscription: async () => { calls.push("asr-uploaded"); },
      activateStopGuard: () => { calls.push("guard-active"); },
      finishSession: async () => { calls.push("session-finished"); },
      disposeModel: () => { calls.push("model-disposed"); },
    });

    expect(calls).toEqual([
      "worklet-flushed",
      "buffer-enqueued",
      "asr-uploaded",
      "guard-active",
      "session-finished",
      "model-disposed",
    ]);
  });

  it("does not dispose the model before an outstanding transcription resolves", async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const dispose = vi.fn();
    const finishing = finishCapture({
      stopCapture: async () => undefined,
      flushFinalBuffer: () => undefined,
      waitForTranscription: () => pending,
      activateStopGuard: () => undefined,
      finishSession: async () => undefined,
      disposeModel: dispose,
    });

    await Promise.resolve();
    expect(dispose).not.toHaveBeenCalled();
    release();
    await finishing;
    expect(dispose).toHaveBeenCalledOnce();
  });
});
