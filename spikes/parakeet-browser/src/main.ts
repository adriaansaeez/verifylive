import type {
  BrowserWhisper,
  TranscriptSegment,
  TranscribePCMStream,
  TranscribeStream,
} from "browser-whisper";

import { mergeSegments, resampleLinear, RollingPcmBuffer } from "./audio";
import "./styles.css";

const MODEL = "parakeet-tdt-0.6b-v3" as const;
const LIVE_WINDOW_SECONDS = 12;
const LIVE_STEP_SECONDS = 4;
const LIVE_WARMUP_SECONDS = 6;

type QuantizationType = "fp32" | "fp16" | "q8" | "q4" | "hybrid";

type ExtendedPerformance = Performance & {
  memory?: { usedJSHeapSize?: number };
};

type GpuAdapterLike = {
  features: Set<string>;
  info?: Record<string, unknown>;
};

type NavigatorWithGpu = Navigator & {
  gpu?: { requestAdapter: () => Promise<GpuAdapterLike | null> };
  deviceMemory?: number;
};

type RunMetric = {
  mode: "file" | "live";
  startedAt: string;
  quantization: QuantizationType;
  wallMs: number;
  audioSeconds: number;
  realtimeFactor: number | null;
  firstSegmentMs: number | null;
  segments: number;
  text: string;
  memoryBeforeBytes: number | null;
  memoryAfterBytes: number | null;
};

type SpikeReport = {
  generatedAt: string;
  environment: Record<string, unknown>;
  model: {
    id: typeof MODEL;
    quantization: QuantizationType;
    downloadAndLoadMs: number | null;
    cached: boolean | null;
  };
  runs: RunMetric[];
  live: {
    skippedBusyWindows: number;
    capturedSeconds: number;
  };
  events: Array<{ at: string; message: string }>;
};

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element: ${selector}`);
  return found;
}

const readinessBadge = element<HTMLSpanElement>("#readiness-badge");
const diagnostics = element<HTMLDListElement>("#diagnostics");
const quantizationSelect = element<HTMLSelectElement>("#quantization");
const modelProgress = element<HTMLProgressElement>("#model-progress");
const modelProgressLabel = element<HTMLOutputElement>("#model-progress-label");
const downloadButton = element<HTMLButtonElement>("#download-model");
const cancelDownloadButton = element<HTMLButtonElement>("#cancel-download");
const clearCacheButton = element<HTMLButtonElement>("#clear-cache");
const fileInput = element<HTMLInputElement>("#media-file");
const transcribeFileButton = element<HTMLButtonElement>("#transcribe-file");
const cancelFileButton = element<HTMLButtonElement>("#cancel-file");
const startLiveButton = element<HTMLButtonElement>("#start-live");
const stopLiveButton = element<HTMLButtonElement>("#stop-live");
const liveBadge = element<HTMLSpanElement>("#live-badge");
const metricsContainer = element<HTMLDivElement>("#metrics");
const segmentsContainer = element<HTMLOListElement>("#segments");
const eventLog = element<HTMLPreElement>("#event-log");
const exportButton = element<HTMLButtonElement>("#export-results");

let transcriber: BrowserWhisper | null = null;
let modelReady = false;
let downloadAbort: AbortController | null = null;
let fileStream: TranscribeStream | null = null;
let livePcmStream: TranscribePCMStream | null = null;
let displayStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let captureNode: AudioWorkletNode | null = null;
let liveBuffer: RollingPcmBuffer | null = null;
let liveCapturedSeconds = 0;
let nextLiveInferenceAt = LIVE_WARMUP_SECONDS;
let liveInferenceBusy = false;
let liveSessionActive = false;

const report: SpikeReport = {
  generatedAt: new Date().toISOString(),
  environment: {},
  model: {
    id: MODEL,
    quantization: "q8",
    downloadAndLoadMs: null,
    cached: null,
  },
  runs: [],
  live: {
    skippedBusyWindows: 0,
    capturedSeconds: 0,
  },
  events: [],
};

// Deliberate test seam used by the Playwright benchmark scripts. It exposes metrics, never audio.
Object.assign(globalThis, {
  __VERIFYLIVE_SPIKE_REPORT__: () => JSON.parse(JSON.stringify(report)) as SpikeReport,
});

function nowIso(): string {
  return new Date().toISOString();
}

function selectedQuantization(): QuantizationType {
  return quantizationSelect.value as QuantizationType;
}

function log(message: string): void {
  const event = { at: nowIso(), message };
  report.events.push(event);
  eventLog.textContent += `${event.at.slice(11, 23)}  ${message}\n`;
  eventLog.scrollTop = eventLog.scrollHeight;
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "n/d";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds == null) return "n/d";
  return milliseconds < 1000
    ? `${Math.round(milliseconds)} ms`
    : `${(milliseconds / 1000).toFixed(2)} s`;
}

function formatTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(1).padStart(4, "0")}`;
}

function renderDiagnostics(values: Record<string, string>): void {
  diagnostics.replaceChildren(
    ...Object.entries(values).map(([name, value]) => {
      const wrapper = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = name;
      description.textContent = value;
      wrapper.append(term, description);
      return wrapper;
    }),
  );
}

function renderMetrics(): void {
  const latest = report.runs.at(-1);
  const values: Array<[string, string]> = [
    ["Carga del modelo", formatDuration(report.model.downloadAndLoadMs)],
    ["Última inferencia", latest ? formatDuration(latest.wallMs) : "n/d"],
    ["Audio procesado", latest ? `${latest.audioSeconds.toFixed(1)} s` : "n/d"],
    ["Velocidad", latest?.realtimeFactor ? `${latest.realtimeFactor.toFixed(2)}× realtime` : "n/d"],
    ["Primer segmento", latest ? formatDuration(latest.firstSegmentMs) : "n/d"],
    ["Ventanas omitidas", String(report.live.skippedBusyWindows)],
  ];

  metricsContainer.replaceChildren(
    ...values.map(([label, value]) => {
      const metric = document.createElement("div");
      metric.className = "metric";
      const caption = document.createElement("span");
      const strong = document.createElement("strong");
      caption.textContent = label;
      strong.textContent = value;
      metric.append(caption, strong);
      return metric;
    }),
  );
}

function appendSegment(segment: TranscriptSegment, offsetSeconds = 0, prefix = ""): void {
  const item = document.createElement("li");
  const time = document.createElement("time");
  time.textContent = `${prefix}${formatTimestamp(offsetSeconds + segment.start)}–${formatTimestamp(offsetSeconds + segment.end)}`;
  item.append(time, document.createTextNode(segment.text.trim()));
  segmentsContainer.append(item);
}

async function measureMemory(): Promise<number | null> {
  const extended = performance as ExtendedPerformance;
  return extended.memory?.usedJSHeapSize ?? null;
}

function updateControls(): void {
  const hasFile = Boolean(fileInput.files?.[0]);
  const anyTranscription = Boolean(fileStream || livePcmStream || liveSessionActive);
  transcribeFileButton.disabled = !modelReady || !hasFile || anyTranscription;
  startLiveButton.disabled = !modelReady || anyTranscription;
  quantizationSelect.disabled = Boolean(downloadAbort || anyTranscription);
  downloadButton.disabled = Boolean(downloadAbort || anyTranscription);
  clearCacheButton.disabled = Boolean(downloadAbort || anyTranscription);
}

async function diagnose(): Promise<void> {
  const nav = navigator as NavigatorWithGpu;
  const adapter = await nav.gpu?.requestAdapter();
  const storage = await navigator.storage?.estimate();
  const hasShaderF16 = adapter?.features.has("shader-f16") ?? false;
  quantizationSelect.value = hasShaderF16 ? "fp16" : "q8";
  report.model.quantization = selectedQuantization();
  report.environment = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    crossOriginIsolated,
    webGpu: Boolean(adapter),
    shaderF16: hasShaderF16,
    gpuInfo: adapter?.info ?? null,
    deviceMemoryGb: nav.deviceMemory ?? null,
    storageQuotaBytes: storage?.quota ?? null,
    storageUsageBytes: storage?.usage ?? null,
  };

  renderDiagnostics({
    "Contexto aislado": crossOriginIsolated ? "Sí" : "No",
    WebGPU: adapter ? "Disponible" : "No disponible",
    "shader-f16": hasShaderF16 ? "Disponible" : "No; usar q8",
    "Memoria declarada": nav.deviceMemory ? `${nav.deviceMemory} GB` : "No expuesta",
    "Caché usada": formatBytes(storage?.usage),
    "Cuota local": formatBytes(storage?.quota),
  });

  const ready = Boolean(adapter) && crossOriginIsolated;
  readinessBadge.textContent = ready ? "Listo para Parakeet" : "Bloqueado";
  readinessBadge.className = `badge ${ready ? "good" : "bad"}`;
  if (!ready) {
    log("Parakeet requiere WebGPU y aislamiento COOP/COEP; revisa el diagnóstico.");
  } else {
    log(`WebGPU listo; precisión recomendada: ${selectedQuantization()}.`);
  }
  renderMetrics();
}

async function freshTranscriber(): Promise<BrowserWhisper> {
  transcriber?.dispose();
  const { BrowserWhisper: BrowserWhisperConstructor } = await import("browser-whisper");
  transcriber = new BrowserWhisperConstructor({
    model: MODEL,
    quantization: selectedQuantization(),
  });
  return transcriber;
}

async function prepareModel(): Promise<void> {
  downloadAbort = new AbortController();
  cancelDownloadButton.disabled = false;
  modelReady = false;
  modelProgress.value = 0;
  modelProgressLabel.value = "Preparando descarga…";
  report.model.quantization = selectedQuantization();
  updateControls();
  const started = performance.now();
  log(`Preparando ${MODEL} (${selectedQuantization()}).`);

  try {
    const instance = await freshTranscriber();
    await instance.downloadModel({
      model: MODEL,
      quantization: selectedQuantization(),
      signal: downloadAbort.signal,
      onProgress: ({ stage, progress }) => {
        modelProgress.value = progress;
        modelProgressLabel.value = `${stage} · ${(progress * 100).toFixed(0)} %`;
      },
    });
    const elapsed = performance.now() - started;
    report.model.downloadAndLoadMs = elapsed;
    report.model.cached = elapsed < 5_000;
    modelReady = true;
    modelProgress.value = 1;
    modelProgressLabel.value = `Listo · ${formatDuration(elapsed)}`;
    log(`Modelo listo en ${formatDuration(elapsed)}.`);
  } catch (error) {
    modelProgressLabel.value = error instanceof DOMException && error.name === "AbortError" ? "Cancelado" : "Error";
    log(`No se pudo preparar el modelo: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    downloadAbort = null;
    cancelDownloadButton.disabled = true;
    updateControls();
    renderMetrics();
  }
}

async function runFileTranscription(): Promise<void> {
  const file = fileInput.files?.[0];
  if (!file || !transcriber || !modelReady) return;
  segmentsContainer.replaceChildren();
  cancelFileButton.disabled = false;
  const memoryBefore = await measureMemory();
  const started = performance.now();
  let firstSegmentMs: number | null = null;
  const segments: TranscriptSegment[] = [];
  log(`Transcribiendo ${file.name} (${formatBytes(file.size)}).`);

  try {
    fileStream = transcriber.transcribe(file, {
      model: MODEL,
      quantization: selectedQuantization(),
      onProgress: ({ stage, progress }) => {
        modelProgressLabel.value = `${stage} · ${(progress * 100).toFixed(0)} %`;
      },
      onSegment: (segment) => {
        if (firstSegmentMs == null) firstSegmentMs = performance.now() - started;
        segments.push(segment);
        appendSegment(segment);
      },
    });
    await fileStream.collect();
    const wallMs = performance.now() - started;
    const audioSeconds = Math.max(0, ...segments.map((segment) => segment.end));
    const memoryAfter = await measureMemory();
    report.runs.push({
      mode: "file",
      startedAt: new Date(Date.now() - wallMs).toISOString(),
      quantization: selectedQuantization(),
      wallMs,
      audioSeconds,
      realtimeFactor: wallMs > 0 ? audioSeconds / (wallMs / 1000) : null,
      firstSegmentMs,
      segments: segments.length,
      text: mergeSegments(segments),
      memoryBeforeBytes: memoryBefore,
      memoryAfterBytes: memoryAfter,
    });
    log(`Archivo completado: ${segments.length} segmentos en ${formatDuration(wallMs)}.`);
  } catch (error) {
    log(`Transcripción interrumpida: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    fileStream = null;
    cancelFileButton.disabled = true;
    modelProgressLabel.value = modelReady ? "Modelo listo" : "Sin descargar";
    updateControls();
    renderMetrics();
  }
}

async function inferLiveWindow(): Promise<void> {
  if (!liveBuffer || !transcriber || !liveSessionActive || liveInferenceBusy) return;
  liveInferenceBusy = true;
  const sourcePcm = liveBuffer.latest(LIVE_WINDOW_SECONDS);
  const actualWindowSeconds = sourcePcm.length / liveBuffer.sampleRate;
  const windowOffset = Math.max(0, liveCapturedSeconds - actualWindowSeconds);
  const pcm16 = resampleLinear(sourcePcm, liveBuffer.sampleRate);
  const memoryBefore = await measureMemory();
  const started = performance.now();
  let firstSegmentMs: number | null = null;
  const segments: TranscriptSegment[] = [];
  log(`Ventana live ${formatTimestamp(windowOffset)} +${actualWindowSeconds.toFixed(1)} s.`);

  try {
    livePcmStream = transcriber.transcribePCM(pcm16, {
      model: MODEL,
      quantization: selectedQuantization(),
      onSegment: (segment) => {
        if (firstSegmentMs == null) firstSegmentMs = performance.now() - started;
        segments.push(segment);
        appendSegment(segment, windowOffset, "LIVE ");
      },
    });
    await livePcmStream.collect();
    const wallMs = performance.now() - started;
    const memoryAfter = await measureMemory();
    report.runs.push({
      mode: "live",
      startedAt: new Date(Date.now() - wallMs).toISOString(),
      quantization: selectedQuantization(),
      wallMs,
      audioSeconds: actualWindowSeconds,
      realtimeFactor: wallMs > 0 ? actualWindowSeconds / (wallMs / 1000) : null,
      firstSegmentMs,
      segments: segments.length,
      text: mergeSegments(segments),
      memoryBeforeBytes: memoryBefore,
      memoryAfterBytes: memoryAfter,
    });
    log(`Ventana live completada en ${formatDuration(wallMs)}.`);
  } catch (error) {
    log(`Ventana live falló: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    livePcmStream = null;
    liveInferenceBusy = false;
    renderMetrics();
    updateControls();
  }
}

function acceptLiveSamples(samples: Float32Array): void {
  if (!liveBuffer || !liveSessionActive) return;
  liveBuffer.push(samples);
  liveCapturedSeconds += samples.length / liveBuffer.sampleRate;
  report.live.capturedSeconds = liveCapturedSeconds;

  if (liveCapturedSeconds < nextLiveInferenceAt) return;
  nextLiveInferenceAt += LIVE_STEP_SECONDS;
  if (liveInferenceBusy) {
    report.live.skippedBusyWindows += 1;
    log("Ventana omitida: la inferencia anterior sigue activa.");
    renderMetrics();
    return;
  }
  void inferLiveWindow();
}

async function startLiveCapture(): Promise<void> {
  if (!transcriber || !modelReady) return;
  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        suppressLocalAudioPlayback: false,
      } as MediaTrackConstraints & { suppressLocalAudioPlayback: boolean },
    });
    const audioTrack = displayStream.getAudioTracks()[0];
    if (!audioTrack) {
      displayStream.getTracks().forEach((track) => track.stop());
      throw new Error("La fuente elegida no compartió audio. Activa ‘Compartir audio’. ");
    }

    audioContext = new AudioContext();
    await audioContext.audioWorklet.addModule("/pcm-capture-worklet.js");
    const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
    captureNode = new AudioWorkletNode(audioContext, "pcm-capture");
    const silent = audioContext.createGain();
    silent.gain.value = 0;
    captureNode.port.onmessage = (event: MessageEvent<Float32Array>) => acceptLiveSamples(event.data);
    source.connect(captureNode).connect(silent).connect(audioContext.destination);

    liveBuffer = new RollingPcmBuffer(audioContext.sampleRate, 20);
    liveCapturedSeconds = 0;
    nextLiveInferenceAt = LIVE_WARMUP_SECONDS;
    report.live.skippedBusyWindows = 0;
    report.live.capturedSeconds = 0;
    liveSessionActive = true;
    segmentsContainer.replaceChildren();
    liveBadge.textContent = "Escuchando";
    liveBadge.className = "badge good";
    stopLiveButton.disabled = false;
    audioTrack.addEventListener("ended", () => void stopLiveCapture());
    log(`Captura iniciada a ${audioContext.sampleRate} Hz.`);
    updateControls();
  } catch (error) {
    log(`No se pudo iniciar la captura: ${error instanceof Error ? error.message : String(error)}`);
    await stopLiveCapture();
  }
}

async function stopLiveCapture(): Promise<void> {
  liveSessionActive = false;
  livePcmStream?.cancel();
  livePcmStream = null;
  captureNode?.disconnect();
  captureNode = null;
  displayStream?.getTracks().forEach((track) => track.stop());
  displayStream = null;
  if (audioContext && audioContext.state !== "closed") await audioContext.close();
  audioContext = null;
  liveBuffer?.clear();
  liveBuffer = null;
  liveInferenceBusy = false;
  liveBadge.textContent = "Detenido";
  liveBadge.className = "badge";
  stopLiveButton.disabled = true;
  log("Captura detenida y recursos de audio liberados.");
  updateControls();
}

async function clearModelCache(): Promise<void> {
  if (!confirm("¿Eliminar los modelos guardados por este spike?")) return;
  transcriber?.dispose();
  transcriber = null;
  modelReady = false;
  const { BrowserWhisper: BrowserWhisperConstructor } = await import("browser-whisper");
  await BrowserWhisperConstructor.clearCache();
  modelProgress.value = 0;
  modelProgressLabel.value = "Caché eliminada";
  log("Caché local eliminada.");
  updateControls();
}

function exportReport(): void {
  report.generatedAt = nowIso();
  report.model.quantization = selectedQuantization();
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `parakeet-spike-${new Date().toISOString().replaceAll(":", "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

downloadButton.addEventListener("click", () => void prepareModel());
cancelDownloadButton.addEventListener("click", () => downloadAbort?.abort());
clearCacheButton.addEventListener("click", () => void clearModelCache());
fileInput.addEventListener("change", updateControls);
transcribeFileButton.addEventListener("click", () => void runFileTranscription());
cancelFileButton.addEventListener("click", () => fileStream?.cancel());
startLiveButton.addEventListener("click", () => void startLiveCapture());
stopLiveButton.addEventListener("click", () => void stopLiveCapture());
exportButton.addEventListener("click", exportReport);
quantizationSelect.addEventListener("change", () => {
  if (modelReady && !confirm("Cambiar la precisión requiere volver a cargar el modelo. ¿Continuar?")) {
    quantizationSelect.value = report.model.quantization;
    return;
  }
  transcriber?.dispose();
  transcriber = null;
  modelReady = false;
  report.model.quantization = selectedQuantization();
  modelProgress.value = 0;
  modelProgressLabel.value = "Carga requerida";
  updateControls();
});
window.addEventListener("beforeunload", () => {
  displayStream?.getTracks().forEach((track) => track.stop());
  transcriber?.dispose();
});

updateControls();
void diagnose();
