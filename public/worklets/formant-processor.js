/**
 * formant-processor.js
 *
 * AudioWorkletProcessor para análisis acústico LPC en tiempo real (YourSelf v4 - Algoritmo E):
 * - Ejecutado en el hilo de audio (cero carga en el render loop de Three.js).
 * - Ventana de 25 ms con salto de 10 ms (100 Hz de tasa de control) a 24 kHz.
 * - Levinson-Durbin orden 12 + Durand-Kerner para estimación de F1 y F2.
 */

class FormantProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sampleRate = 24000;
    this.windowSize = 600; // 25 ms a 24 kHz
    this.hopSize = 240;    // 10 ms a 24 kHz

    this.buffer = new Float32Array(this.windowSize);
    this.bufferIndex = 0;
    this.order = 12;

    this.hammingWindow = new Float32Array(this.windowSize);
    for (let i = 0; i < this.windowSize; i++) {
      this.hammingWindow[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (this.windowSize - 1));
    }

    this.r = new Float64Array(this.order + 1);
    this.a = new Float64Array(this.order + 1);
    this.aPrev = new Float64Array(this.order + 1);
    this.rootsReal = new Float64Array(this.order);
    this.rootsImag = new Float64Array(this.order);
    this.newRootsReal = new Float64Array(this.order);
    this.newRootsImag = new Float64Array(this.order);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];

    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.bufferIndex++] = channel[i];

      if (this.bufferIndex >= this.windowSize) {
        this.analyzeAndPost();

        // Desplazamiento por salto (hopSize = 240)
        this.buffer.copyWithin(0, this.hopSize, this.windowSize);
        this.bufferIndex = this.windowSize - this.hopSize;
      }
    }

    return true;
  }

  analyzeAndPost() {
    let sumSq = 0;
    let zeroCrossings = 0;
    const N = this.windowSize;

    for (let i = 0; i < N; i++) {
      const s = this.buffer[i];
      sumSq += s * s;
      if (i > 0 && ((s >= 0 && this.buffer[i - 1] < 0) || (s < 0 && this.buffer[i - 1] >= 0))) {
        zeroCrossings++;
      }
    }

    const rms = Math.sqrt(sumSq / N);
    const zcr = zeroCrossings / N;

    if (rms < 0.005) {
      this.port.postMessage({ f1: 500, f2: 1500, f3: 2500, rms, zcr, spectralCentroid: 0, isSilent: true });
      return;
    }

    // Pre-énfasis + Ventanado Hamming
    const preemph = new Float32Array(N);
    preemph[0] = this.buffer[0];
    for (let i = 1; i < N; i++) {
      preemph[i] = (this.buffer[i] - 0.97 * this.buffer[i - 1]) * this.hammingWindow[i];
    }

    // Autocorrelación
    const p = this.order;
    for (let k = 0; k <= p; k++) {
      let rk = 0;
      for (let n = 0; n < N - k; n++) {
        rk += preemph[n] * preemph[n + k];
      }
      this.r[k] = rk;
    }

    // Levinson-Durbin
    let E = this.r[0];
    if (E <= 1e-10) return;

    this.a[0] = 1.0;
    for (let i = 1; i <= p; i++) this.a[i] = 0.0;

    for (let i = 1; i <= p; i++) {
      let lambda = 0;
      for (let j = 0; j < i; j++) lambda -= this.a[j] * this.r[i - j];
      const k = lambda / E;

      for (let j = 0; j <= i; j++) this.aPrev[j] = this.a[j];
      this.a[i] = k;
      for (let j = 1; j < i; j++) this.a[j] = this.aPrev[j] + k * this.aPrev[i - j];

      E *= 1.0 - k * k;
      if (E <= 1e-12) break;
    }

    // Raíces por Durand-Kerner
    for (let i = 0; i < p; i++) {
      const angle = (2 * Math.PI * i) / p + 0.35;
      this.rootsReal[i] = 0.95 * Math.cos(angle);
      this.rootsImag[i] = 0.95 * Math.sin(angle);
    }

    for (let iter = 0; iter < 8; iter++) {
      for (let i = 0; i < p; i++) {
        const zr = this.rootsReal[i];
        const zi = this.rootsImag[i];

        let p_re = 1.0;
        let p_im = 0.0;
        for (let j = 1; j <= p; j++) {
          const next_re = p_re * zr - p_im * zi + this.a[j];
          const next_im = p_re * zi + p_im * zr;
          p_re = next_re;
          p_im = next_im;
        }

        let den_re = 1.0;
        let den_im = 0.0;
        for (let j = 0; j < p; j++) {
          if (j === i) continue;
          const dz_re = zr - this.rootsReal[j];
          const dz_im = zi - this.rootsImag[j];
          const n_re = den_re * dz_re - den_im * dz_im;
          const n_im = den_re * dz_im + den_im * dz_re;
          den_re = n_re;
          den_im = n_im;
        }

        const denMagSq = den_re * den_re + den_im * den_im;
        if (denMagSq > 1e-14) {
          this.newRootsReal[i] = zr - (p_re * den_re + p_im * den_im) / denMagSq;
          this.newRootsImag[i] = zi - (p_im * den_re - p_re * den_im) / denMagSq;
        } else {
          this.newRootsReal[i] = zr;
          this.newRootsImag[i] = zi;
        }
      }

      for (let i = 0; i < p; i++) {
        this.rootsReal[i] = this.newRootsReal[i];
        this.rootsImag[i] = this.newRootsImag[i];
      }
    }

    // Formantes
    const candidateFreqs = [];
    for (let i = 0; i < p; i++) {
      const re = this.rootsReal[i];
      const im = this.rootsImag[i];
      if (im > 0.01) {
        const r = Math.sqrt(re * re + im * im);
        if (r > 0.65 && r < 0.999) {
          const theta = Math.atan2(im, re);
          const freq = (theta * this.sampleRate) / (2 * Math.PI);
          const bw = (-this.sampleRate / Math.PI) * Math.log(r);
          if (freq >= 180 && freq <= this.sampleRate / 2 && bw < 450) {
            candidateFreqs.push(freq);
          }
        }
      }
    }
    candidateFreqs.sort((a, b) => a - b);

    const f1 = candidateFreqs[0] || 500;
    const f2 = candidateFreqs[1] || 1500;
    const f3 = candidateFreqs[2] || 2500;

    this.port.postMessage({ f1, f2, f3, rms, zcr, spectralCentroid: zcr * (this.sampleRate / 2), isSilent: false });
  }
}

registerProcessor('formant-processor', FormantProcessor);
