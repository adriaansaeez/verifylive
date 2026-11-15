import { describe, expect, it } from "vitest";

import { mergeSegments, resampleLinear, RollingPcmBuffer } from "./audio";

describe("resampleLinear", () => {
  it("keeps duration when converting 48 kHz to 16 kHz", () => {
    const input = new Float32Array(48_000).map((_, index) => index / 48_000);
    const output = resampleLinear(input, 48_000, 16_000);

    expect(output).toHaveLength(16_000);
    expect(output[8_000]).toBeCloseTo(0.5, 3);
  });

  it("rejects invalid sample rates", () => {
    expect(() => resampleLinear(new Float32Array(2), 0)).toThrow(RangeError);
  });
});

describe("RollingPcmBuffer", () => {
  it("keeps only the configured tail", () => {
    const buffer = new RollingPcmBuffer(4, 2);
    buffer.push(Float32Array.from([1, 2, 3, 4, 5, 6]));
    buffer.push(Float32Array.from([7, 8, 9, 10]));

    expect(Array.from(buffer.latest(2))).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(buffer.durationSeconds).toBe(2);
  });
});

describe("mergeSegments", () => {
  it("normalizes whitespace and ignores empty segments", () => {
    expect(
      mergeSegments([
        { text: " Hola ", start: 0, end: 1 },
        { text: "", start: 1, end: 2 },
        { text: "  mundo.", start: 2, end: 3 },
      ]),
    ).toBe("Hola mundo.");
  });
});
