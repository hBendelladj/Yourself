/**
 * blinkEngine.ts
 *
 * Motor de Parpadeo Biomecánico Especializado (YourSelf V3 - Fase 1 / Sección 9.2):
 * - Perfil asimétrico real: fase de cierre rápida (~38% del ciclo, ~40 ms) y fase de apertura lenta (~62%, ~70 ms).
 * - Distribución log-normal de intervalos inter-parpadeo dependiente del estado conversacional.
 * - Variabilidad biológica estocástica:
 *   - 18% parpadeos incompletos (cierre pico 0.70 - 0.92).
 *   - 12% parpadeos dobles (~110-150 ms entre ciclos).
 *   - Asimetría temporal bilateral entre ojo izquierdo y derecho (±15 ms).
 * - Disparador reflejo por sacadas oculares balísticas (> 0.35 de magnitud).
 * - Cero asignaciones en memoria dentro del bucle de actualización (Zero-Allocation).
 */

import { AvatarMood } from '@/lib/types';

export interface BlinkState {
  blinkLeft: number;
  blinkRight: number;
  isBlinking: boolean;
  closureRatio: number;
}

export interface BlinkEngineOptions {
  onBlinkChange?: (isBlinking: boolean) => void;
  minInterval?: number;
  maxInterval?: number;
}

export class BlinkEngine {
  public onBlinkChange?: (isBlinking: boolean) => void;

  // Temporizadores y duraciones
  private timeUntilNextBlink: number;
  private blinkProgressTimer = 0;
  private currentDuration = 0.11; // 110 ms promedio
  private isBlinking = false;
  private isDoubleBlinkQueued = false;

  // Parámetros dinámicos del parpadeo actual
  private maxClosure = 1.0;
  private eyeAsymmetryOffset = 0.0; // Desfase temporal entre ojo izquierdo y derecho (s)

  // Disfrecuencia / multiplicador de tasa de parpadeo (0.5 .. 2.0)
  public rateMultiplier = 1.0;

  // Búfer de estado reutilizable (Zero-Allocation)
  private readonly state: BlinkState = {
    blinkLeft: 0,
    blinkRight: 0,
    isBlinking: false,
    closureRatio: 0,
  };

  private readonly minInterval: number;
  private readonly maxInterval: number;

  constructor(options?: BlinkEngineOptions) {
    this.onBlinkChange = options?.onBlinkChange;
    this.minInterval = options?.minInterval ?? 1.2;
    this.maxInterval = options?.maxInterval ?? 6.8;

    // Primer parpadeo estocástico inicial entre 1.8 y 3.5 s
    this.timeUntilNextBlink = 1.8 + Math.random() * 1.7;
  }

  /**
   * Genera una variable aleatoria con distribución log-normal
   * utilizando la transformación Box-Muller.
   */
  private sampleLogNormal(mean: number, sigma = 0.32): number {
    const u1 = Math.max(1e-6, Math.random());
    const u2 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

    const mu = Math.log(mean) - (sigma * sigma) / 2.0;
    return Math.exp(mu + sigma * z0);
  }

  /**
   * Muestrea un intervalo inter-parpadeo biológico con distribución log-normal
   * Calibrado con reference_stats.json (15.25 blinks/min -> ~3.9 s intervalo promedio)
   */
  public sampleBlinkInterval(mood: AvatarMood = 'idle'): number {
    const meanInterval = (mood === 'speaking' ? 3.2 : 3.93) / this.rateMultiplier;
    const sampled = this.sampleLogNormal(meanInterval);
    const minI = this.minInterval / this.rateMultiplier;
    const maxI = this.maxInterval / this.rateMultiplier;
    return Math.max(minI, Math.min(maxI, sampled));
  }

  public setRateMultiplier(rate: number): void {
    this.rateMultiplier = Math.max(0.5, Math.min(2.0, rate));
  }

  public getRateMultiplier(): number {
    return this.rateMultiplier;
  }

  /**
   * Programa el próximo parpadeo según el estado conversacional
   */
  public scheduleNextBlink(mood: AvatarMood = 'idle'): void {
    this.timeUntilNextBlink = this.sampleBlinkInterval(mood);
  }

  /**
   * Inicia un nuevo ciclo de parpadeo configurando los parámetros estocásticos (Fase 3):
   * - Duración fisiológica: 110–150 ms (media ~130 ms)
   * - Parpadeos incompletos ocasionales (18% prob, 72–92% cierre)
   * - Asimetría temporal bilateral leve (±12 ms)
   */
  private startBlink(): void {
    this.isBlinking = true;
    this.blinkProgressTimer = 0;

    // Duración calibrada con la especificación (100–150 ms, media ~130 ms)
    this.currentDuration = 0.11 + Math.random() * 0.04;

    // 18% de probabilidad de parpadeo incompleto biológico (cierre entre 72% y 92%)
    if (Math.random() < 0.18) {
      this.maxClosure = 0.72 + Math.random() * 0.20;
    } else {
      this.maxClosure = 1.0;
    }

    // Asimetría ocular bilateral leve: entre -12 ms y +12 ms
    this.eyeAsymmetryOffset = (Math.random() - 0.5) * 0.024;

    // 12% de probabilidad de parpadeo doble
    this.isDoubleBlinkQueued = Math.random() < 0.12;

    this.onBlinkChange?.(true);
  }

  /**
   * Disparo manual de parpadeo
   */
  public triggerBlink(): void {
    if (!this.isBlinking) {
      this.startBlink();
    }
  }

  /**
   * Disparo reflejo ante sacadas oculares o cambios de dirección de mirada (Fase 3 & Fase C)
   */
  public triggerSaccadeBlink(saccadeMagnitude: number): void {
    if (saccadeMagnitude > 0.18 && !this.isBlinking && Math.random() < 0.75) {
      this.startBlink();
    }
  }

  /**
   * Evalúa la curva de velocidad palpebral asimétrica (Sección 9.2):
   * - Fase de cierre rápida: primeros 38% del tiempo (~35-45 ms).
   * - Fase de apertura lenta: últimos 62% del tiempo (~70-90 ms).
   */
  public evaluateBlinkCurve(progress: number): number {
    if (progress <= 0 || progress >= 1.0) return 0;

    const closeRatio = 0.38;
    if (progress < closeRatio) {
      // Fase de cierre con aceleración rápida
      const p = progress / closeRatio;
      return Math.sin((p * Math.PI) / 2.0);
    }

    // Fase de apertura gradual con relajación viscoelástica
    const p = (progress - closeRatio) / (1.0 - closeRatio);
    return Math.cos((p * Math.PI) / 2.0);
  }

  /**
   * Actualiza el estado del parpadeo en cada fotograma.
   * Cero asignaciones en memoria: actualiza y devuelve el objeto `this.state` interno.
   */
  public update(deltaSeconds: number, mood: AvatarMood = 'idle'): BlinkState {
    if (!this.isBlinking) {
      this.timeUntilNextBlink -= deltaSeconds;

      if (this.timeUntilNextBlink <= 0) {
        this.startBlink();
      }

      this.state.blinkLeft = 0;
      this.state.blinkRight = 0;
      this.state.isBlinking = false;
      this.state.closureRatio = 0;
      return this.state;
    }

    this.blinkProgressTimer += deltaSeconds;
    const baseProgress = this.blinkProgressTimer / this.currentDuration;

    // Calcular progreso para cada ojo considerando el desfase temporal bilateral
    const progressLeft = (this.blinkProgressTimer + this.eyeAsymmetryOffset * 0.5) / this.currentDuration;
    const progressRight = (this.blinkProgressTimer - this.eyeAsymmetryOffset * 0.5) / this.currentDuration;

    const rawLeft = this.evaluateBlinkCurve(progressLeft) * this.maxClosure;
    const rawRight = this.evaluateBlinkCurve(progressRight) * this.maxClosure;

    const blinkLeft = Math.max(0, Math.min(1.0, rawLeft));
    const blinkRight = Math.max(0, Math.min(1.0, rawRight));

    this.state.blinkLeft = blinkLeft;
    this.state.blinkRight = blinkRight;
    this.state.closureRatio = Math.max(blinkLeft, blinkRight);
    this.state.isBlinking = true;

    // Finalización del ciclo de parpadeo
    if (baseProgress >= 1.0 && blinkLeft < 0.01 && blinkRight < 0.01) {
      this.isBlinking = false;
      this.state.isBlinking = false;
      this.state.blinkLeft = 0;
      this.state.blinkRight = 0;
      this.state.closureRatio = 0;
      this.onBlinkChange?.(false);

      if (this.isDoubleBlinkQueued) {
        this.isDoubleBlinkQueued = false;
        // El segundo parpadeo ocurre rápidamente (~110-150 ms después)
        this.timeUntilNextBlink = 0.11 + Math.random() * 0.04;
      } else {
        this.scheduleNextBlink(mood);
      }
    }

    return this.state;
  }

  public getIsBlinking(): boolean {
    return this.isBlinking;
  }

  public getCurrentDuration(): number {
    return this.currentDuration;
  }

  public getMaxClosure(): number {
    return this.maxClosure;
  }

  public getEyeAsymmetryOffset(): number {
    return this.eyeAsymmetryOffset;
  }

  public getTimeUntilNextBlink(): number {
    return this.timeUntilNextBlink;
  }
}
