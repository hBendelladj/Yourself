/**
 * audioClock.ts
 *
 * Reloj Maestro de Audio para Sincronía Precisa (Fase 3 / Sección 7.12):
 * - Evalúa la línea de tiempo de animación referenciada estrictamente al reloj del AudioContext
 *   en lugar de performance.now(), eliminando derivas temporales en intervenciones prolongadas (≥ 60 s).
 * - Compensa latencias de hardware del sistema operativo mediante `outputLatency` y `baseLatency`.
 * - Proporciona fallback transparente a reloj de alta resolución si el AudioContext aún no ha iniciado.
 */

export class AudioClock {
  private context: AudioContext | null = null;
  private fallbackStartTime = 0;
  private isAudioRunning = false;

  constructor(context?: AudioContext | null) {
    if (context) {
      this.setContext(context);
    } else {
      this.fallbackStartTime = performance.now() * 0.001;
    }
  }

  public setContext(context: AudioContext): void {
    this.context = context;
    this.isAudioRunning = context.state === 'running';
  }

  /**
   * Devuelve el tiempo de reproducción actual en segundos compensando latencia del hardware
   */
  public getAudioTime(): number {
    if (this.context && this.context.state === 'running') {
      const now = this.context.currentTime;
      const ctxAny = this.context as unknown as { outputLatency?: number; baseLatency?: number };
      const outputLatency = ctxAny.outputLatency || 0;
      const baseLatency = ctxAny.baseLatency || 0;
      return Math.max(0, now - outputLatency - baseLatency);
    }

    // Fallback relativo si AudioContext aún está suspendido
    return performance.now() * 0.001 - this.fallbackStartTime;
  }

  /**
   * Resetea la referencia temporal ante interrupciones
   */
  public reset(): void {
    this.fallbackStartTime = performance.now() * 0.001;
  }
}
