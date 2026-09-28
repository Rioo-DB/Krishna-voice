// AudioWorklet: batches mic audio into ~100 ms chunks at the context's rate (24 kHz)
class PCMRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.length = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      this.chunks.push(new Float32Array(channel));
      this.length += channel.length;
      if (this.length >= 2400) { // 2400 samples at 24 kHz = 100 ms
        const out = new Float32Array(this.length);
        let offset = 0;
        for (const c of this.chunks) { out.set(c, offset); offset += c.length; }
        this.port.postMessage(out, [out.buffer]);
        this.chunks = [];
        this.length = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-recorder", PCMRecorder);
