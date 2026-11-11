/**
 * prosodyAnalyzer.ts
 *
 * Analizador de prosodia y tono fundamental (F0) en tiempo real (CPU):
 * - Extracción de frecuencia fundamental (F0) en rango de voz humana (80 Hz – 400 Hz)
 *   mediante autocorrelación normalizada sobre buffer de dominio temporal.
 * - Seguimiento de envolvente RMS, media de pitch, varianza de pitch (expresividad tonal)
 *   y pendiente de pitch (entonación interrogativa ascendente / descendente).
 * - Cero asignaciones dinámicas por fotograma (memoria contigua preasignada).
 */

export interface ProsodyFeatures {
  f0: number;            // Frecuencia fundamental actual en Hz (0 si sordo/silencio)
  isVoiced: boolean;     // Verdadero si se detecta sonoridad periódica
  energy: number;        // RMS en rango [0, 1]
  pitchMean: number;     // Media móvil de F0 (Hz)
  pitchVariance: number; // Desviación estándar / varianza de F0 (Hz)
  pitchSlope: number;    // Tendencia de entonación (Hz/s, positivo = entonación ascendente)
}

export class ProsodyAnalyzer {
  private sampleRate = 24000;
  private minLag = 60;   // 24000 / 400 Hz
  private maxLag = 300;  // 24000 / 80 Hz

  // Buffer normalizado para cálculo de autocorrelación (longitud típica 512)
  private normBuffer = new Float32Array(512);

  // Historial circular de F0 para cálculo de estadísticas temporales (~400 ms @ 60 fps)
  private readonly historyCapacity = 24;
  private f0History = new Float32Array(24);
  private voicedHistory = new Uint8Array(24);
  private historyIndex = 0;
  private historyCount = 0;

  // Umbrales
  private readonly energyThreshold = 0.015;   // Por debajo de esto es silencio
  private readonly voicingThreshold = 0.35;   // Autocorrelación mínima para considerar voz periódica

  // Salida preasignada para cero allocations
  private features: ProsodyFeatures = {
    f0: 0,
    isVoiced: false,
    energy: 0,
    pitchMean: 150,
    pitchVariance: 0,
    pitchSlope: 0,
  };

  constructor(sampleRate = 24000) {
    this.setSampleRate(sampleRate);
  }

  public setSampleRate(sampleRate: number): void {
    this.sampleRate = Math.max(8000, Math.min(96000, sampleRate));
    // Rango fisiológico vocal humano: 80 Hz a 400 Hz
    this.minLag = Math.max(4, Math.floor(this.sampleRate / 400));
    this.maxLag = Math.min(this.normBuffer.length - 1, Math.ceil(this.sampleRate / 80));
  }

  /**
   * Procesa un bloque de datos temporales (Uint8Array o Float32Array)
   */
  public processTimeDomain(timeData: Uint8Array | Float32Array): ProsodyFeatures {
    const len = timeData.length;
    if (len < this.maxLag + 64) {
      this.features.f0 = 0;
      this.features.isVoiced = false;
      return this.features;
    }

    if (this.normBuffer.length !== len) {
      this.normBuffer = new Float32Array(len);
      this.maxLag = Math.min(len - 64, Math.ceil(this.sampleRate / 80));
    }

    // 1. Normalizar y calcular RMS
    let sumSq = 0;
    const isUint8 = timeData instanceof Uint8Array;
    for (let i = 0; i < len; i++) {
      const val = isUint8 ? (timeData[i]! - 128) / 128 : timeData[i]!;
      this.normBuffer[i] = val;
      sumSq += val * val;
    }

    const rms = Math.sqrt(sumSq / len);
    this.features.energy = rms;

    // Si la energía está por debajo del umbral, silenciar F0
    if (rms < this.energyThreshold) {
      this.features.f0 = 0;
      this.features.isVoiced = false;
      this.recordHistory(0, false);
      this.updateStatistics();
      return this.features;
    }

    // 2. Autocorrelación rápida sobre ventana centrada
    const windowSize = Math.min(256, len - this.maxLag);
    let bestCorrelation = -1;
    let bestLag = -1;

    // Calcular energía de la ventana base
    let baseEnergy = 0;
    for (let i = 0; i < windowSize; i++) {
      const v = this.normBuffer[i]!;
      baseEnergy += v * v;
    }

    if (baseEnergy > 1e-4) {
      for (let lag = this.minLag; lag <= this.maxLag; lag += 2) {
        let dot = 0;
        let lagEnergy = 0;
        for (let i = 0; i < windowSize; i++) {
          const a = this.normBuffer[i]!;
          const b = this.normBuffer[i + lag]!;
          dot += a * b;
          lagEnergy += b * b;
        }

        const norm = Math.sqrt(baseEnergy * lagEnergy);
        const corr = norm > 1e-4 ? dot / norm : 0;

        if (corr > bestCorrelation) {
          bestCorrelation = corr;
          bestLag = lag;
        }
      }

      // Refinamiento de paso 1 alrededor del mejor lag
      if (bestLag > this.minLag && bestLag < this.maxLag) {
        for (const testLag of [bestLag - 1, bestLag + 1]) {
          let dot = 0;
          let lagEnergy = 0;
          for (let i = 0; i < windowSize; i++) {
            const a = this.normBuffer[i]!;
            const b = this.normBuffer[i + testLag]!;
            dot += a * b;
            lagEnergy += b * b;
          }
          const norm = Math.sqrt(baseEnergy * lagEnergy);
          const corr = norm > 1e-4 ? dot / norm : 0;
          if (corr > bestCorrelation) {
            bestCorrelation = corr;
            bestLag = testLag;
          }
        }
      }
    }

    if (bestCorrelation >= this.voicingThreshold && bestLag > 0) {
      const rawF0 = this.sampleRate / bestLag;
      this.features.f0 = Math.max(80, Math.min(400, rawF0));
      this.features.isVoiced = true;
    } else {
      this.features.f0 = 0;
      this.features.isVoiced = false;
    }

    this.recordHistory(this.features.f0, this.features.isVoiced);
    this.updateStatistics();
    return this.features;
  }

  private recordHistory(f0: number, isVoiced: boolean): void {
    this.f0History[this.historyIndex] = f0;
    this.voicedHistory[this.historyIndex] = isVoiced ? 1 : 0;
    this.historyIndex = (this.historyIndex + 1) % this.historyCapacity;
    if (this.historyCount < this.historyCapacity) {
      this.historyCount++;
    }
  }

  private updateStatistics(): void {
    if (this.historyCount === 0) return;

    let sum = 0;
    let voicedCount = 0;

    for (let i = 0; i < this.historyCount; i++) {
      if (this.voicedHistory[i] === 1) {
        sum += this.f0History[i]!;
        voicedCount++;
      }
    }

    if (voicedCount >= 3) {
      const mean = sum / voicedCount;
      let varSum = 0;
      for (let i = 0; i < this.historyCount; i++) {
        if (this.voicedHistory[i] === 1) {
          const diff = this.f0History[i]! - mean;
          varSum += diff * diff;
        }
      }
      this.features.pitchMean = mean;
      this.features.pitchVariance = Math.sqrt(varSum / voicedCount);

      // Calcular pendiente sobre la mitad más reciente de la historia
      const half = Math.floor(this.historyCapacity / 2);
      const oldestIdx = (this.historyIndex - this.historyCount + this.historyCapacity) % this.historyCapacity;
      const midIdx = (oldestIdx + half) % this.historyCapacity;
      const latestIdx = (this.historyIndex - 1 + this.historyCapacity) % this.historyCapacity;

      if (this.voicedHistory[latestIdx] === 1 && this.voicedHistory[midIdx] === 1) {
        this.features.pitchSlope = (this.f0History[latestIdx]! - this.f0History[midIdx]!) * 15.0;
      } else {
        this.features.pitchSlope = 0;
      }
    } else {
      this.features.pitchVariance = 0;
      this.features.pitchSlope = 0;
    }
  }

  public getFeatures(): ProsodyFeatures {
    return this.features;
  }
}
