/**
 * syllableClock.ts
 *
 * Detector de Núcleos Silábicos basado en Envolvente de Energía (Fase 3 / Sección 7.8):
 * - En el habla humana (y específicamente en español), las sílabas presentan una modulación
 *   característica de envolvente de amplitud entre 3 y 8 Hz (aproximadamente 5–7 sílabas/segundo).
 * - Detecta picos de energía locales con umbral adaptativo de prominencia y distancia mínima (≥ 95 ms).
 * - Cada pico de energía representa el núcleo vocálico de una sílaba y emite un evento `onSyllable`.
 * - Cero asignaciones en memoria en el bucle caliente.
 */

export interface SyllableClockOptions {
  minPeakDistance?: number;    // Distancia mínima entre sílabas en segundos (~0.095 s = 95 ms)
  minProminence?: number;      // Prominencia mínima del pico sobre el valle previo
  noiseFloor?: number;         // Umbral mínimo de audio audible
  onSyllable?: (timestamp: number, energy: number) => void;
}

export class SyllableClock {
  private minPeakDistance: number;
  private minProminence: number;
  private noiseFloor: number;
  public onSyllable?: (timestamp: number, energy: number) => void;

  // Seguimiento de envolvente suavizada
  private smoothedEnvelope = 0;
  private prevEnvelope = 0;
  private prevSlope = 0;

  // Detección de picos y valles
  private lastPeakTime = -1.0;
  private currentTrough = 1.0;
  private peakCandidateTime = 0;
  private peakCandidateEnergy = 0;
  private isHuntingPeak = false;

  constructor(options?: SyllableClockOptions) {
    this.minPeakDistance = options?.minPeakDistance ?? 0.095; // 95 ms
    this.minProminence = options?.minProminence ?? 0.016;
    this.noiseFloor = options?.noiseFloor ?? 0.012;
    this.onSyllable = options?.onSyllable;
  }

  /**
   * Procesa un valor de energía instantánea (RMS) en el tiempo `audioTime`
   */
  public processSample(rawRms: number, audioTime: number): boolean {
    // 1. Filtrado pasabajos de la envolvente (filtro IIR asimétrico)
    // Ataque rápido (~12 ms) y relajación media (~35 ms) para capturar la modulación de 3-8 Hz
    const attack = 0.35;
    const release = 0.14;
    const alpha = rawRms > this.smoothedEnvelope ? attack : release;
    this.smoothedEnvelope += (rawRms - this.smoothedEnvelope) * alpha;

    const env = this.smoothedEnvelope;
    const slope = env - this.prevEnvelope;
    let detectedSyllable = false;

    // 2. Si la pendiente cambia de positiva a negativa, tenemos una cresta (pico local)
    if (this.prevSlope > 0 && slope <= 0 && env > this.noiseFloor) {
      const timeSinceLastPeak = audioTime - this.lastPeakTime;
      const prominence = env - this.currentTrough;

      if (timeSinceLastPeak >= this.minPeakDistance && prominence >= this.minProminence) {
        this.lastPeakTime = audioTime;
        this.currentTrough = env; // Reiniciar seguimiento de valle
        this.onSyllable?.(audioTime, env);
        detectedSyllable = true;
      }
    }

    // 3. Si la pendiente cambia de negativa a positiva, actualizamos el valle más reciente
    if (this.prevSlope < 0 && slope >= 0) {
      if (env < this.currentTrough) {
        this.currentTrough = env;
      }
    }

    if (env < this.noiseFloor) {
      this.currentTrough = 0;
    }

    this.prevSlope = slope;
    this.prevEnvelope = env;

    return detectedSyllable;
  }

  /**
   * Procesa un búfer Float32Array completo (útil para pruebas y análisis fuera de línea)
   */
  public processBuffer(
    samples: Float32Array,
    sampleRate: number,
    startAudioTime = 0,
    windowSize = 256
  ): number[] {
    const detectedPeakTimes: number[] = [];
    const step = windowSize;
    const len = samples.length;

    for (let i = 0; i < len; i += step) {
      // Calcular RMS del fragmento
      let sum = 0;
      const end = Math.min(len, i + step);
      const count = end - i;
      for (let j = i; j < end; j++) {
        sum += samples[j]! * samples[j]!;
      }
      const rms = Math.sqrt(sum / count);
      const time = startAudioTime + i / sampleRate;

      if (this.processSample(rms, time)) {
        detectedPeakTimes.push(time);
      }
    }

    return detectedPeakTimes;
  }

  /**
   * Resetea el reloj ante interrupciones o fin de turno
   */
  public reset(): void {
    this.smoothedEnvelope = 0;
    this.prevEnvelope = 0;
    this.prevSlope = 0;
    this.lastPeakTime = -1.0;
    this.currentTrough = 1.0;
    this.isHuntingPeak = false;
  }
}
