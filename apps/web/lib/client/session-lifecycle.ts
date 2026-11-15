export type FinishCaptureSteps = {
  stopCapture: () => Promise<void>;
  flushFinalBuffer: () => void;
  waitForTranscription: () => Promise<void>;
  activateStopGuard: () => void;
  finishSession: () => Promise<void>;
  disposeModel: () => void;
};

/**
 * Preserve the shutdown ordering: the worklet flush feeds the final buffer,
 * ASR consumes it, and only then may callers reject chunks or dispose ASR.
 */
export async function finishCapture(steps: FinishCaptureSteps): Promise<void> {
  await steps.stopCapture();
  steps.flushFinalBuffer();
  await steps.waitForTranscription();
  steps.activateStopGuard();
  await steps.finishSession();
  steps.disposeModel();
}
