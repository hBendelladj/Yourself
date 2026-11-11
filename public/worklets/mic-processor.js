/**
 * mic-processor.js
 * AudioWorkletProcessor that downsamples incoming microphone audio
 * to 16 kHz mono 16-bit linear PCM and posts buffers to the main thread.
 */
class MicProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = (options && options.processorOptions && options.processorOptions.targetSampleRate) || 16000;
    this.inputSampleRate = sampleRate; // Global AudioWorklet sampleRate
    this.buffer = [];
    this.chunkDurationMs = 25; // ~25ms chunks for low latency
    this.chunkSize = Math.floor((this.targetSampleRate * this.chunkDurationMs) / 1000); // 400 samples at 16kHz
    this.resampleRatio = this.inputSampleRate / this.targetSampleRate;
    this.resampleIndex = 0;
  }

  process(inputs, _outputs, _parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // Use first channel (mono)
    const channelData = input[0];
    if (!channelData || channelData.length === 0) return true;

    // Linear downsampling / resampling
    if (this.inputSampleRate === this.targetSampleRate) {
      for (let i = 0; i < channelData.length; i++) {
        this.buffer.push(channelData[i]);
      }
    } else {
      while (this.resampleIndex < channelData.length) {
        const indexFloor = Math.floor(this.resampleIndex);
        const indexCeil = Math.min(indexFloor + 1, channelData.length - 1);
        const fraction = this.resampleIndex - indexFloor;
        const s0 = channelData[indexFloor];
        const s1 = channelData[indexCeil];
        const interpolated = s0 + fraction * (s1 - s0);
        this.buffer.push(interpolated);
        this.resampleIndex += this.resampleRatio;
      }
      this.resampleIndex -= channelData.length;
    }

    // Emit chunks when sufficient samples are buffered
    while (this.buffer.length >= this.chunkSize) {
      const chunkSamples = this.buffer.splice(0, this.chunkSize);
      const pcm16 = new Int16Array(chunkSamples.length);
      for (let i = 0; i < chunkSamples.length; i++) {
        // Clamp float between -1.0 and 1.0, scale to 16-bit signed integer
        const s = Math.max(-1, Math.min(1, chunkSamples[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }

    return true;
  }
}

registerProcessor('mic-processor', MicProcessor);
