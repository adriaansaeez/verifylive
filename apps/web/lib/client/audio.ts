export type AudioChunk = {
  samples: Float32Array;
  sampleRate: number;
  rms: number;
  capturedAt: number;
};

export type TabCapture = {
  stop: () => Promise<void>;
  sampleRate: number;
  startedAt: number;
};

export type CaptureOptions = {
  chunkMs?: number;
  sampleRate?: number;
  onEnded?: () => void;
};

const WORKLET_SOURCE = `
class VeritasChunker extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frames = (options && options.processorOptions && options.processorOptions.frames) || 16000;
    this.buffer = new Float32Array(this.frames);
    this.offset = 0;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === "flush") {
        if (this.offset > 0) this.flush(event.data.id);
        else this.port.postMessage({ type: "flushed", id: event.data.id });
      }
    };
  }
  flush(flushId) {
    const chunk = this.buffer.slice(0, this.offset);
    let sum = 0;
    for (let i = 0; i < chunk.length; i += 1) sum += chunk[i] * chunk[i];
    const rms = chunk.length ? Math.sqrt(sum / chunk.length) : 0;
    this.port.postMessage({ type: "chunk", samples: chunk, rms, flushId }, [chunk.buffer]);
    this.buffer = new Float32Array(this.frames);
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (input) {
      let read = 0;
      while (read < input.length) {
        const room = this.frames - this.offset;
        const take = Math.min(room, input.length - read);
        this.buffer.set(input.subarray(read, read + take), this.offset);
        this.offset += take;
        read += take;
        if (this.offset === this.frames) this.flush();
      }
    }
    return true;
  }
}
registerProcessor("veritas-chunker", VeritasChunker);
`;

/**
 * Must be the FIRST await in a click handler: Chrome requires a live user
 * activation for getDisplayMedia, and any prior await (model download, session
 * POST) consumes it → "getDisplayMedia must be called from a user gesture handler".
 */
export type TabStreamOptions = {
  /**
   * Ofrece directamente esta pestaña en el selector. Es lo que hace falta
   * cuando el vídeo va incrustado aquí: con varias pestañas de título parecido
   * es fácil compartir la equivocada y entonces no llega ni un sonido.
   */
  preferCurrentTab?: boolean;
};

export async function requestTabStream(options: TabStreamOptions = {}): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Tu navegador no soporta getDisplayMedia. Usa Chrome o Edge.");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      // Propiedad de Chrome, aún fuera del tipado estándar.
      ...(options.preferCurrentTab ? { preferCurrentTab: true } : {}),
    } as DisplayMediaStreamOptions);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "NotAllowedError") {
      throw new Error("Compartir pestaña cancelado. Elige la pestaña y marca «Compartir audio».");
    }
    throw cause;
  }

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    for (const track of stream.getTracks()) track.stop();
    throw new Error(
      "El navegador no compartió audio. Elige una pestaña (no una ventana ni la pantalla) y marca «Compartir audio de la pestaña»; si tu navegador no ofrece esa casilla, usa el micrófono.",
    );
  }
  for (const track of stream.getVideoTracks()) track.stop();
  return stream;
}

/**
 * Captures tab audio (shared system audio also works when the user shares a
 * tab). Pass `stream` from requestTabStream() when the gesture-sensitive call
 * already happened; otherwise this requests it here and must be called directly
 * from the handler.
 */
export async function startTabAudio(
  onChunk: (chunk: AudioChunk) => void,
  options: CaptureOptions = {},
  stream?: MediaStream,
): Promise<TabCapture> {
  return attachStream(stream ?? (await requestTabStream()), onChunk, options);
}

/**
 * Fallback when the browser does not offer tab audio (window sharing, Safari,
 * Brave without the flag, Linux/Wayland). Plays the source out loud and picks
 * it up with the microphone.
 */
export async function requestMicStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Tu navegador no permite capturar micrófono. Usa Chrome o Edge.");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "NotAllowedError") {
      throw new Error("Permiso de micrófono denegado. Actívalo en el candado de la barra de direcciones.");
    }
    throw cause;
  }
}

export async function startMicAudio(
  onChunk: (chunk: AudioChunk) => void,
  options: CaptureOptions = {},
  stream?: MediaStream,
): Promise<TabCapture> {
  return attachStream(stream ?? (await requestMicStream()), onChunk, options);
}

async function attachStream(
  media: MediaStream,
  onChunk: (chunk: AudioChunk) => void,
  options: CaptureOptions = {},
): Promise<TabCapture> {
  const audioTracks = media.getAudioTracks();

  const sampleRate = options.sampleRate ?? 16_000;
  const chunkMs = options.chunkMs ?? 1_000;
  const context = new AudioContext({ sampleRate, latencyHint: "interactive" });
  const source = context.createMediaStreamSource(new MediaStream(audioTracks));

  const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
  await context.audioWorklet.addModule(workletUrl);

  const node = new AudioWorkletNode(context, "veritas-chunker", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    processorOptions: { frames: Math.round((sampleRate * chunkMs) / 1000) },
  });
  // Keep the node alive without routing processed audio to the speakers.
  let resolveFlush: ((id: number) => void) | null = null;
  node.port.onmessage = (event: MessageEvent<{
    type: "chunk" | "flushed";
    samples?: Float32Array;
    rms?: number;
    flushId?: number;
    id?: number;
  }>) => {
    if (event.data.type === "flushed") {
      resolveFlush?.(event.data.id ?? 0);
      return;
    }
    if (!event.data.samples) return;
    const durationMs = (event.data.samples.length / context.sampleRate) * 1000;
    onChunk({
      samples: event.data.samples,
      sampleRate: context.sampleRate,
      rms: event.data.rms ?? 0,
      capturedAt: Math.max(startedAt, Date.now() - durationMs),
    });
    if (event.data.flushId !== undefined) resolveFlush?.(event.data.flushId);
  };

  const startedAt = Date.now();
  source.connect(node);

  if (context.state === "suspended") await context.resume();

  let closePromise: Promise<void> | null = null;
  let nextFlushId = 1;
  const close = (notifyEnded: boolean): Promise<void> => {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      const flushId = nextFlushId++;
      await new Promise<void>((resolve) => {
        resolveFlush = (receivedId) => {
          if (receivedId !== flushId) return;
          resolveFlush = null;
          resolve();
        };
        try {
          node.port.postMessage({ type: "flush", id: flushId });
        } catch {
          resolveFlush = null;
          resolve();
        }
      });
      for (const track of audioTracks) track.stop();
      try {
        node.disconnect();
      } catch {
        // already disconnected
      }
      await context.close().catch(() => undefined);
      URL.revokeObjectURL(workletUrl);
      if (notifyEnded) options.onEnded?.();
    })();
    return closePromise;
  };

  const stop = (): Promise<void> => close(false);

  for (const track of audioTracks) {
    track.addEventListener("ended", () => {
      void close(true);
    }, { once: true });
  }

  return { stop, sampleRate: context.sampleRate, startedAt };
}
