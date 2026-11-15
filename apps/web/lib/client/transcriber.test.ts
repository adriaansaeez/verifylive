import { afterEach, describe, expect, it, vi } from "vitest";

const browserWhisper = vi.hoisted(() => ({
  constructorOptions: [] as unknown[],
  downloadOptions: [] as unknown[],
  transcribeOptions: [] as unknown[],
  disposed: 0,
}));

vi.mock("browser-whisper", () => ({
  BrowserWhisper: class {
    constructor(options: unknown) {
      browserWhisper.constructorOptions.push(options);
    }

    async downloadModel(options: unknown) {
      browserWhisper.downloadOptions.push(options);
    }

    transcribePCM(_samples: Float32Array, options: unknown) {
      browserWhisper.transcribeOptions.push(options);
      return {
        async *[Symbol.asyncIterator]() {
          yield { text: " texto detectado " };
        },
      };
    }

    dispose() {
      browserWhisper.disposed += 1;
    }
  },
}));

import { chooseParakeetQuantization, createWhisperTranscriber } from "./transcriber";

afterEach(() => {
  vi.unstubAllGlobals();
  browserWhisper.constructorOptions.length = 0;
  browserWhisper.downloadOptions.length = 0;
  browserWhisper.transcribeOptions.length = 0;
  browserWhisper.disposed = 0;
});

describe("Parakeet browser transcription", () => {
  it("uses Parakeet TDT, fp16, and automatic language detection by default", async () => {
    vi.stubGlobal("navigator", {
      gpu: { requestAdapter: async () => ({ features: { has: () => true } }) },
    });
    const transcriber = createWhisperTranscriber();

    await transcriber.prepare(() => undefined);
    const text = await transcriber.transcribe(new Float32Array([0.1, 0.2]), 16_000);

    expect(browserWhisper.constructorOptions[0]).toEqual({
      model: "parakeet-tdt-0.6b-v3",
      quantization: "fp16",
    });
    expect(browserWhisper.downloadOptions[0]).toMatchObject({
      model: "parakeet-tdt-0.6b-v3",
      quantization: "fp16",
    });
    expect(browserWhisper.transcribeOptions[0]).toEqual({});
    expect(text).toBe("texto detectado");
  });

  it("falls back to q8 when shader-f16 is unavailable", async () => {
    vi.stubGlobal("navigator", {
      gpu: { requestAdapter: async () => ({ features: { has: () => false } }) },
    });
    await expect(chooseParakeetQuantization()).resolves.toBe("q8");
  });
});
