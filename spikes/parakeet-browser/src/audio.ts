export type PcmChunk = {
  samples: Float32Array;
  sampleRate: number;
};

export function resampleLinear(
  input: Float32Array,
  sourceRate: number,
  targetRate = 16_000,
): Float32Array {
  if (sourceRate <= 0 || targetRate <= 0) {
    throw new RangeError("Sample rates must be positive");
  }
  if (input.length === 0 || sourceRate === targetRate) {
    return input.slice();
  }

  const outputLength = Math.max(1, Math.round((input.length * targetRate) / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;

  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.min(Math.floor(position), input.length - 1);
    const right = Math.min(left + 1, input.length - 1);
    const fraction = position - left;
    const leftValue = input[left] ?? 0;
    const rightValue = input[right] ?? leftValue;
    output[index] = leftValue + (rightValue - leftValue) * fraction;
  }

  return output;
}

export class RollingPcmBuffer {
  private readonly chunks: Float32Array[] = [];
  private sampleCount = 0;

  constructor(
    readonly sampleRate: number,
    readonly maxSeconds: number,
  ) {
    if (sampleRate <= 0 || maxSeconds <= 0) {
      throw new RangeError("Buffer limits must be positive");
    }
  }

  get durationSeconds(): number {
    return this.sampleCount / this.sampleRate;
  }

  push(samples: Float32Array): void {
    if (samples.length === 0) return;
    this.chunks.push(samples.slice());
    this.sampleCount += samples.length;
    this.trim();
  }

  latest(seconds: number): Float32Array {
    const wanted = Math.min(this.sampleCount, Math.max(0, Math.round(seconds * this.sampleRate)));
    const output = new Float32Array(wanted);
    let writeAt = wanted;

    for (let index = this.chunks.length - 1; index >= 0 && writeAt > 0; index -= 1) {
      const chunk = this.chunks[index];
      if (!chunk) continue;
      const take = Math.min(writeAt, chunk.length);
      writeAt -= take;
      output.set(chunk.subarray(chunk.length - take), writeAt);
    }

    return output;
  }

  clear(): void {
    this.chunks.length = 0;
    this.sampleCount = 0;
  }

  private trim(): void {
    const maximum = Math.round(this.maxSeconds * this.sampleRate);
    while (this.sampleCount > maximum && this.chunks.length > 0) {
      const first = this.chunks[0];
      if (!first) break;
      const overflow = this.sampleCount - maximum;
      if (overflow >= first.length) {
        this.chunks.shift();
        this.sampleCount -= first.length;
        continue;
      }
      this.chunks[0] = first.slice(overflow);
      this.sampleCount -= overflow;
    }
  }
}

export function mergeSegments(
  segments: Array<{ text: string; start: number; end: number }>,
): string {
  return segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
