/**
 * lipsyncAnalyzer.ts
 *
 * Analizador de audio y visemas en tiempo real (Nivel 1 / Fase 1):
 * - Histéresis y zona muerta: umbral de apertura (0.022) y umbral de cierre (0.010) para evitar apertura espuria.
 * - Normalización adaptativa: rastrea el percentil 90 móvil del RMS para calibrar el volumen del hablante.
 * - Tope blando (soft-clamp) a ~0.65: el habla natural no abre la mandíbula al 100%.
 * - Detección de fricativas/sibilantes (visema SZ): energía concentrada en altas frecuencias limita la mandíbula
 *   a los dientes frontales y estira comisuras, eliminando la "boca de marioneta".
 * - Cierres labiales rápidos tras caídas de energía y silencios inter-sílabas.
 */

export interface VisemeWeights {
  jawOpen: number;   // 0.0 a 1.0 (típico 0.15 a 0.40, tope blando ~0.65)
  mouthRound: number;// 0.0 a 1.0 ("O", "U")
  mouthWide: number; // 0.0 a 1.0 ("E", "I", sibilantes)
  smile: number;     // 0.0 a 1.0
}

export interface LipsyncAnalyzerOptions {
  softMaxJaw?: number;
  openThreshold?: number;
  closeThreshold?: number;
  useCalibratedCurve?: boolean;
}

export class LipsyncAnalyzer {
  private analyser: AnalyserNode | null = null;
  private timeData: Uint8Array<ArrayBuffer>;
  private freqData: Uint8Array<ArrayBuffer>;

  // Valores suavizados actuales
  private smoothedJaw = 0;
  private smoothedRound = 0;
  private smoothedWide = 0;
  private smoothedSmile = 0;

  // Histéresis y zona muerta calibrada (alivia zona muerta para captar susurros y aperturas leves)
  private openThreshold = 0.015;  // Umbral de apertura (reducido de 0.020)
  private closeThreshold = 0.007; // Umbral de cierre (reducido de 0.009)
  private isMouthActive = false;

  // Normalización adaptativa de RMS y tope calibrado con la referencia
  private noiseFloor = 0.008;
  private p90Rms = 0.12; // Estimador móvil del percentil 90
  private softMaxJaw = 0.65; // Tope base de compatibilidad (V2: 0.65, V3: 0.92 calibrado)
  private useCalibratedCurve = false;
  private filteredVolume = 0;

  constructor(analyser?: AnalyserNode | null, options?: LipsyncAnalyzerOptions) {
    if (options?.softMaxJaw !== undefined) {
      this.softMaxJaw = options.softMaxJaw;
      this.useCalibratedCurve = options.softMaxJaw > 0.70;
    }
    if (options?.openThreshold !== undefined) this.openThreshold = options.openThreshold;
    if (options?.closeThreshold !== undefined) this.closeThreshold = options.closeThreshold;
    if (options?.useCalibratedCurve !== undefined) this.useCalibratedCurve = options.useCalibratedCurve;

    if (analyser) {
      this.setAnalyser(analyser);
    }
    const fftSize = analyser ? analyser.fftSize : 512;
    this.timeData = new Uint8Array(fftSize);
    this.freqData = new Uint8Array(fftSize / 2);
  }

  public setSoftMaxJaw(softMax: number, useCalibrated?: boolean): void {
    this.softMaxJaw = softMax;
    this.useCalibratedCurve = useCalibrated ?? (softMax > 0.70);
  }

  public setAnalyser(analyser: AnalyserNode): void {
    this.analyser = analyser;
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.12; // Respuesta más inmediata para anticipación
    this.timeData = new Uint8Array(this.analyser.fftSize);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
  }

  public getTimeData(): Uint8Array {
    return this.timeData;
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  /**
   * Procesa el fotograma actual y devuelve los pesos de visemas para animación
   * @param deltaSeconds tiempo transcurrido desde el último fotograma
   */
  public update(deltaSeconds: number = 0.016): VisemeWeights {
    if (!this.analyser) {
      this.decay(deltaSeconds);
      return this.getValues();
    }

    // 1. Obtener datos temporales y calcular RMS
    this.analyser.getByteTimeDomainData(this.timeData);
    let sumSquares = 0;
    const len = this.timeData.length;
    for (let i = 0; i < len; i++) {
      const sample = (this.timeData[i]! - 128) / 128.0;
      sumSquares += sample * sample;
    }
    const rawRms = Math.sqrt(sumSquares / len);

    // 2. Histéresis y zona muerta
    if (this.isMouthActive) {
      if (rawRms < this.closeThreshold) {
        this.isMouthActive = false;
      }
    } else {
      if (rawRms >= this.openThreshold) {
        this.isMouthActive = true;
      }
    }

    // Si la señal está en zona muerta / silencio, decaer velozmente a cierre total
    if (!this.isMouthActive) {
      this.decay(deltaSeconds);
      return this.getValues();
    }

    // 3. Normalización adaptativa de RMS
    if (rawRms > this.p90Rms) {
      this.p90Rms += (rawRms - this.p90Rms) * Math.min(1.0, 4.0 * deltaSeconds);
    } else {
      this.p90Rms = Math.max(0.04, this.p90Rms - 0.005 * deltaSeconds);
    }

    const effectiveRms = Math.max(0, rawRms - this.noiseFloor);
    const targetVolume = Math.min(1.5, effectiveRms / Math.max(0.03, this.p90Rms));
    // Filtro paso bajo para evitar aleteo por ruido ambiental manteniendo ataque rápido
    const volFilterCoeff = 1.0 - Math.exp(-32.0 * deltaSeconds);
    this.filteredVolume += (targetVolume - this.filteredVolume) * volFilterCoeff;
    const normalizedVolume = this.filteredVolume;

    // 4. Análisis espectral de frecuencias
    this.analyser.getByteFrequencyData(this.freqData);
    const binCount = this.freqData.length; // 256 bins
    const sampleRate = this.analyser.context.sampleRate || 24000;
    const binWidth = sampleRate / (binCount * 2);

    // Índices de bandas espectrales:
    // Graves (100 - 850 Hz): formantes de vocales O / U y fundamental
    const lowEndBin = Math.max(1, Math.floor(850 / binWidth));
    // Medios (850 - 2400 Hz): formantes de vocal A
    const midEndBin = Math.min(binCount - 1, Math.floor(2400 / binWidth));
    // Agudos (2400 - 5500 Hz): vocales E / I y consonantes sibilantes/fricativas (S, Z, C)
    const highEndBin = Math.min(binCount - 1, Math.floor(5500 / binWidth));

    let lowEnergy = 0;
    let midEnergy = 0;
    let highEnergy = 0;

    for (let i = 1; i < lowEndBin; i++) {
      lowEnergy += this.freqData[i]!;
    }
    for (let i = lowEndBin; i < midEndBin; i++) {
      midEnergy += this.freqData[i]!;
    }
    for (let i = midEndBin; i < highEndBin; i++) {
      highEnergy += this.freqData[i]!;
    }

    const totalEnergy = lowEnergy + midEnergy + highEnergy + 0.001;
    const lowRatio = lowEnergy / totalEnergy;
    const highRatio = highEnergy / totalEnergy;

    // 5. Detección de Fricativas / Sibilantes (evita apertura de mandíbula en "S" y "Z")
    const isFricative = highRatio > 0.42 && lowRatio < 0.22;

    let targetJaw = 0;
    let targetRound = 0;
    let targetWide = 0;

    if (isFricative) {
      // Dientes cerrados / muy próximos y labios extendidos (sibilantes S, Z)
      targetJaw = 0.06 * Math.min(1.0, normalizedVolume);
      targetWide = Math.min(0.70, 0.35 + highRatio * 0.45);
    } else if (this.useCalibratedCurve || this.softMaxJaw > 0.70) {
      // Curva calibrada con los percentiles de referencia de docs/reference_stats.json para V3:
      // - p50 medido = 0.026
      // - p95 medido = 0.312
      // - vocoide abierto acentuado (/a/) = 0.85–0.92
      const rawJawTarget = Math.pow(normalizedVolume, 0.88) * 0.95;
      targetJaw = rawJawTarget < 0.50
        ? rawJawTarget
        : 0.50 + (this.softMaxJaw - 0.50) * (1.0 - Math.exp(-(rawJawTarget - 0.50) / 0.30));

      if (lowRatio > 0.38) {
        // Redondeo y protrusión labial (O / U) - calibrado con mouthPucker p95=0.80 y mouthFunnel p95=0.13
        targetRound = Math.min(0.85, (lowRatio - 0.38) * 2.8 * normalizedVolume);
      }
      if (highRatio > 0.28) {
        // Extensión labial (E / I)
        targetWide = Math.min(0.80, (highRatio - 0.28) * 3.2 * normalizedVolume);
      }
    } else {
      // Curva legacy con soft-clamp tanh (V1 / V2 compatibilidad)
      const rawJawTarget = Math.pow(normalizedVolume, 0.88) * 0.52;
      targetJaw = this.softMaxJaw * Math.tanh(rawJawTarget / this.softMaxJaw);

      if (lowRatio > 0.42) {
        targetRound = Math.min(1.0, (lowRatio - 0.42) * 2.6 * normalizedVolume);
      }
      if (highRatio > 0.30) {
        targetWide = Math.min(1.0, (highRatio - 0.30) * 3.0 * normalizedVolume);
      }
    }

    // 6. Suavizado asimétrico con ataque rápido (~25 ms) y liberación natural (~80 ms)
    const attackCoeff = 1.0 - Math.exp(-38.0 * deltaSeconds);
    const releaseCoeff = 1.0 - Math.exp(-15.0 * deltaSeconds);

    this.smoothedJaw +=
      (targetJaw - this.smoothedJaw) *
      (targetJaw > this.smoothedJaw ? attackCoeff : releaseCoeff);

    this.smoothedRound +=
      (targetRound - this.smoothedRound) *
      (targetRound > this.smoothedRound ? attackCoeff : releaseCoeff);

    this.smoothedWide +=
      (targetWide - this.smoothedWide) *
      (targetWide > this.smoothedWide ? attackCoeff : releaseCoeff);

    const targetSmile = normalizedVolume > 0.1 ? 0.06 : 0.02;
    this.smoothedSmile += (targetSmile - this.smoothedSmile) * 0.1;

    return this.getValues();
  }

  private decay(deltaSeconds: number): void {
    // Liberación rápida hacia 0 cuando no hay voz
    const decayCoeff = 1.0 - Math.exp(-22.0 * deltaSeconds);
    this.smoothedJaw += (0 - this.smoothedJaw) * decayCoeff;
    this.smoothedRound += (0 - this.smoothedRound) * decayCoeff;
    this.smoothedWide += (0 - this.smoothedWide) * decayCoeff;
    this.smoothedSmile += (0.02 - this.smoothedSmile) * decayCoeff;
    this.filteredVolume += (0 - this.filteredVolume) * decayCoeff;

    if (this.smoothedJaw < 0.002) this.smoothedJaw = 0;
    if (this.smoothedRound < 0.002) this.smoothedRound = 0;
    if (this.smoothedWide < 0.002) this.smoothedWide = 0;
    if (this.filteredVolume < 0.002) this.filteredVolume = 0;
  }

  public getValues(): VisemeWeights {
    return {
      jawOpen: Math.max(0, Math.min(1, this.smoothedJaw)),
      mouthRound: Math.max(0, Math.min(1, this.smoothedRound)),
      mouthWide: Math.max(0, Math.min(1, this.smoothedWide)),
      smile: Math.max(0, Math.min(1, this.smoothedSmile)),
    };
  }

  public reset(): void {
    this.smoothedJaw = 0;
    this.smoothedRound = 0;
    this.smoothedWide = 0;
    this.smoothedSmile = 0;
    this.filteredVolume = 0;
    this.isMouthActive = false;
  }
}
