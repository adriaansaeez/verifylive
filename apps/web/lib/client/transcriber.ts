import type { ASRModel } from "browser-whisper";

export type ModelStatus = {
  stage: "idle" | "loading" | "ready" | "error";
  progress: number;
  message: string;
};

export type LiveTranscriber = {
  label: string;
  prepare: (onProgress: (status: ModelStatus) => void) => Promise<void>;
  transcribe: (samples: Float32Array, sampleRate: number) => Promise<string>;
  dispose: () => void;
};

const TARGET_RATE = 16_000;
const DEFAULT_MODEL: ASRModel = "parakeet-tdt-0.6b-v3";
export type ModelQuantization = "fp16" | "q8";

type NavigatorWithGpu = Navigator & {
  gpu?: {
    requestAdapter: () => Promise<{ features: { has: (feature: string) => boolean } } | null>;
  };
};

/** Parakeet fp16 is fastest with shader-f16; q8 is its supported fallback. */
export async function chooseParakeetQuantization(): Promise<ModelQuantization> {
  try {
    const adapter = await (navigator as NavigatorWithGpu).gpu?.requestAdapter();
    return adapter?.features.has("shader-f16") ? "fp16" : "q8";
  } catch {
    return "q8";
  }
}

/** Linear resampling is enough for speech; Whisper sees 16 kHz mono PCM. */
export function resample(samples: Float32Array, from: number, to = TARGET_RATE): Float32Array {
  if (from === to) return samples;
  const ratio = from / to;
  const length = Math.max(1, Math.round(samples.length / ratio));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const weight = position - left;
    const a = samples[left] ?? 0;
    const b = samples[right] ?? a;
    output[index] = a + (b - a) * weight;
  }
  return output;
}

/**
 * Local ASR. The model runs in Web Workers via WebGPU (WASM fallback) and is
 * cached in OPFS, so audio never leaves the browser. The first load downloads
 * weights; the UI shows that download instead of hiding it.
 */
export function createWhisperTranscriber(options: {
  model?: ASRModel;
  language?: string;
  quantization?: ModelQuantization;
} = {}): LiveTranscriber {
  const model: ASRModel = options.model ?? DEFAULT_MODEL;
  const language = model === DEFAULT_MODEL
    ? undefined
    : options.language ?? process.env.NEXT_PUBLIC_WHISPER_LANGUAGE;
  let instance: import("browser-whisper").BrowserWhisper | null = null;
  let quantization: ModelQuantization | undefined = options.quantization;

  async function ensure(onProgress: (status: ModelStatus) => void): Promise<import("browser-whisper").BrowserWhisper> {
    if (instance) return instance;
    const { BrowserWhisper } = await import("browser-whisper");
    if (!quantization && model === DEFAULT_MODEL) quantization = await chooseParakeetQuantization();
    instance = new BrowserWhisper({ model, quantization, ...(language ? { language } : {}) });
    onProgress({ stage: "loading", progress: 0, message: `Descargando ${model} (una vez)` });
    await instance.downloadModel({
      model,
      quantization,
      onProgress: ({ stage, progress }: { stage: string; progress: number }) => {
        onProgress({
          stage: stage === "ready" ? "ready" : "loading",
          progress,
          message: stage === "ready" ? `${model} listo` : `Preparando ${model}`,
        });
      },
    });
    const detail = language ?? "idioma automático";
    onProgress({ stage: "ready", progress: 1, message: `${model} listo (${detail}, ${quantization ?? "hybrid"})` });
    return instance;
  }

  return {
    label: `${model} · local`,
    async prepare(onProgress) {
      try {
        await ensure(onProgress);
      } catch (error) {
        onProgress({
          stage: "error",
          progress: 0,
          message: error instanceof Error ? error.message : "No se pudo cargar el modelo",
        });
        throw error;
      }
    },
    async transcribe(samples, sampleRate) {
      const whisper = instance ?? (await ensure(() => undefined));
      const pcm = resample(samples, sampleRate);
      const stream = whisper.transcribePCM(pcm, language ? { language } : {});
      const parts: string[] = [];
      for await (const segment of stream) {
        const text = segment.text.trim();
        if (text) parts.push(text);
      }
      return parts.join(" ").replace(/\s+/gu, " ").trim();
    },
    dispose() {
      instance?.dispose();
      instance = null;
    },
  };
}
