/**
 * blink.ts
 *
 * Modelo de Parpadeo V2 (Fase 1 / Sección 7.9):
 * - Intervalos biológicamente realistas con distribución log-normal (media ~3.5s reposo / ~2.8s hablando).
 * - Trayectoria asimétrica y fisiológica: cierre rápido (~40ms, ~38%) y apertura gradual (~70ms, ~62%).
 * - Variabilidad humana: 18% parpadeos incompletos (cierre 0.70-0.90), 12% parpadeos dobles,
 *   y asimetría natural entre ojo izquierdo y derecho (±15 ms).
 * - Disparadores contextuales para sacadas oculares grandes y énfasis.
 */

import { AvatarMood } from '@/lib/types';

export interface BlinkState {
  blinkLeft: number;  // 0 (abierto) a 1 (cerrado)
  blinkRight: number;
  isBlinking: boolean;
}

export class BlinkController {
  public onBlinkChange?: (isBlinking: boolean) => void;

  // Temporizadores
  private timeUntilNextBlink: number;
  private blinkProgressTimer = 0;
  private currentDuration = 0.11; // ~110 ms
  private isBlinking = false;
  private isDoubleBlinkQueued = false;

  // Parámetros del parpadeo en curso
  private maxClosure = 1.0;
  private eyeAsymmetryOffset = 0.0; // Desfase temporal entre ojo izq y der en segundos
  public rateMultiplier = 1.0;

  // Valores instantáneos calculados
  public blinkLeft = 0;
  public blinkRight = 0;

  constructor() {
    // Primer parpadeo aleatorio entre 1.8 y 3.5 s (elimina el segundo fijo artificial de V1)
    this.timeUntilNextBlink = 1.8 + Math.random() * 1.7;
  }

  /**
   * Genera una variable aleatoria con distribución log-normal
   */
  private sampleLogNormal(mean: number, sigma = 0.32): number {
    // Box-Muller transform para normal estándar
    const u1 = Math.max(1e-6, Math.random());
    const u2 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

    const mu = Math.log(mean) - (sigma * sigma) / 2.0;
    return Math.exp(mu + sigma * z0);
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
  private scheduleNextBlink(mood: AvatarMood = 'idle'): void {
    const meanInterval = (mood === 'speaking' ? 2.8 : 3.5) / this.rateMultiplier;
    const minI = 1.2 / this.rateMultiplier;
    const maxI = 6.8 / this.rateMultiplier;
    // Acotar el intervalo para garantizar dinamismo natural
    this.timeUntilNextBlink = Math.max(minI, Math.min(maxI, this.sampleLogNormal(meanInterval)));
  }

  /**
   * Inicia un nuevo parpadeo calculando sus propiedades estocásticas
   */
  private startBlink(): void {
    this.isBlinking = true;
    this.blinkProgressTimer = 0;

    // Duración total entre 95 y 135 ms
    this.currentDuration = 0.095 + Math.random() * 0.04;

    // 18% de probabilidad de parpadeo incompleto (cierre entre 70% y 92%)
    if (Math.random() < 0.18) {
      this.maxClosure = 0.70 + Math.random() * 0.22;
    } else {
      this.maxClosure = 1.0;
    }

    // Asimetría ocular entre -15 ms y +15 ms
    this.eyeAsymmetryOffset = (Math.random() - 0.5) * 0.03;

    // 12% de probabilidad de doble parpadeo posterior
    this.isDoubleBlinkQueued = Math.random() < 0.12;

    this.onBlinkChange?.(true);
  }

  /**
   * Dispara un parpadeo manual o por eventos
   */
  public triggerBlink(): void {
    if (!this.isBlinking) {
      this.startBlink();
    }
  }

  /**
   * Disparador condicional tras sacadas de mirada (~65% probabilidad)
   */
  public triggerSaccadeBlink(saccadeMagnitude: number): void {
    if (saccadeMagnitude > 0.18 && !this.isBlinking && Math.random() < 0.70) {
      this.startBlink();
    }
  }

  /**
   * Evalúa la curva de parpadeo asimétrica para un progreso dado [0..1]
   */
  private evaluateBlinkCurve(progress: number): number {
    if (progress <= 0 || progress >= 1.0) return 0;

    // Fase de cierre rápida: primeros 38% del tiempo (~40 ms)
    const closeRatio = 0.38;
    if (progress < closeRatio) {
      const p = progress / closeRatio;
      // Cúbica suave con aceleración rápida
      return Math.sin((p * Math.PI) / 2.0);
    }

    // Fase de apertura gradual: últimos 62% del tiempo (~70 ms)
    const p = (progress - closeRatio) / (1.0 - closeRatio);
    // Coseno suave con desaceleración natural
    return Math.cos((p * Math.PI) / 2.0);
  }

  /**
   * Actualiza el parpadeo en cada fotograma
   */
  public update(deltaSeconds: number, mood: AvatarMood = 'idle'): BlinkState {
    if (!this.isBlinking) {
      this.timeUntilNextBlink -= deltaSeconds;

      if (this.timeUntilNextBlink <= 0) {
        this.startBlink();
      }
      this.blinkLeft = 0;
      this.blinkRight = 0;
    } else {
      this.blinkProgressTimer += deltaSeconds;

      const baseProgress = this.blinkProgressTimer / this.currentDuration;

      // Calcular progreso con desfase asimétrico entre ambos ojos
      const progressLeft = (this.blinkProgressTimer + this.eyeAsymmetryOffset * 0.5) / this.currentDuration;
      const progressRight = (this.blinkProgressTimer - this.eyeAsymmetryOffset * 0.5) / this.currentDuration;

      this.blinkLeft = Math.max(0, Math.min(1, this.evaluateBlinkCurve(progressLeft) * this.maxClosure));
      this.blinkRight = Math.max(0, Math.min(1, this.evaluateBlinkCurve(progressRight) * this.maxClosure));

      // Final del ciclo
      if (baseProgress >= 1.0 && this.blinkLeft < 0.01 && this.blinkRight < 0.01) {
        this.isBlinking = false;
        this.blinkLeft = 0;
        this.blinkRight = 0;
        this.onBlinkChange?.(false);

        if (this.isDoubleBlinkQueued) {
          this.isDoubleBlinkQueued = false;
          // El segundo parpadeo ocurre rápidamente (~110-150 ms después)
          this.timeUntilNextBlink = 0.11 + Math.random() * 0.04;
        } else {
          this.scheduleNextBlink(mood);
        }
      }
    }

    return {
      blinkLeft: this.blinkLeft,
      blinkRight: this.blinkRight,
      isBlinking: this.isBlinking,
    };
  }
}
