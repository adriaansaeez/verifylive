class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    const channel = input?.[0];
    if (channel?.length) {
      const copy = new Float32Array(channel);
      this.port.postMessage(copy, [copy.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
