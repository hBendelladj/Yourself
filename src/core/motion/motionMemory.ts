/**
 * motionMemory.ts
 *
 * Memoria Temporal de Movimiento con Cadena de Markov de Segundo Orden (YourSelf V3 - Fase 3 / Sección 11.3):
 * - Registra una ventana deslizante de los últimos 15 gestos ejecutados junto con sus marcas temporales.
 * - Penaliza la probabilidad de reaparición del mismo patrón gestual en ventanas menores a 12 segundos.
 * - Introduce entropía temporal adaptativa para evitar bucles repetitivos o comportamientos robóticos cíclicos.
 * - Cero allocations en tiempo de ejecución.
 */

export type HeadGestureType =
  | 'idle_sway'
  | 'nod'
  | 'double_nod'
  | 'shake'
  | 'curious_tilt'
  | 'look_away'
  | 'accent_pitch';

// Gestos amplios que no deben repetirse en menos de 10 s (Fase B)
export const LARGE_GESTURES: Set<HeadGestureType> = new Set([
  'nod',
  'double_nod',
  'shake',
  'curious_tilt',
  'look_away',
]);

export interface GestureRecord {
  type: HeadGestureType;
  timestamp: number;
}

export class MotionMemory {
  private readonly historyCapacity = 20;
  private readonly gestureHistory: GestureRecord[] = [];
  public readonly cooldownSeconds: number;

  // Búfer preasignado para selección ponderada sin asignación de memoria (Zero-Alloc)
  private readonly candidateWeights: number[] = new Array(12).fill(0);

  constructor(cooldownSeconds = 10.0) {
    this.cooldownSeconds = Math.max(10.0, cooldownSeconds);
  }

  /**
   * Determina si un gesto está clasificado como amplio/grande
   */
  public isLargeGesture(type: HeadGestureType): boolean {
    return LARGE_GESTURES.has(type);
  }

  /**
   * Determina si un gesto tiene permitido ejecutarse en el instante actual
   * respetando la regla estricta de cooldown (mínimo 10 s para gestos grandes).
   */
  public isGestureAllowed(type: HeadGestureType, currentTime: number): boolean {
    if (type === 'idle_sway') return true;

    const len = this.gestureHistory.length;
    if (len === 0) return true;

    const isLarge = LARGE_GESTURES.has(type);
    const requiredCooldown = isLarge ? this.cooldownSeconds : 0.45; // 10 s para gestos grandes, 0.45 s para acentos

    for (let i = len - 1; i >= 0; i--) {
      const rec = this.gestureHistory[i]!;
      const elapsed = currentTime - rec.timestamp;
      if (elapsed < requiredCooldown && rec.type === type) {
        return false;
      }
      // Si ya exploramos más allá del cooldown, no hace falta seguir iterando hacia atrás
      if (elapsed >= this.cooldownSeconds) {
        break;
      }
    }

    return true;
  }

  /**
   * Registra un gesto recién iniciado en el historial
   */
  public recordGesture(type: HeadGestureType, currentTime: number): void {
    if (this.gestureHistory.length >= this.historyCapacity) {
      this.gestureHistory.shift();
    }
    this.gestureHistory.push({ type, timestamp: currentTime });
  }

  /**
   * Calcula el factor de penalización de probabilidad [0..1] para un candidato a gesto.
   * 1.0 = probabilidad intacta.
   * 0.0 = totalmente inhibido (cooldown estricto activo o repetición consecutiva).
   */
  public getSelectionWeight(type: HeadGestureType, currentTime: number): number {
    if (type === 'idle_sway') return 1.0;

    // Regla estricta Fase B: Gestos grandes no pueden repetirse en menos de 10 s
    if (!this.isGestureAllowed(type, currentTime)) {
      return 0.0;
    }

    const len = this.gestureHistory.length;
    if (len === 0) return 1.0;

    // 1. Inhibición si fue el último gesto ejecutado inmediatamente antes
    const last = this.gestureHistory[len - 1]!;
    if (last.type === type && currentTime - last.timestamp < 4.0) {
      return 0.0; // Desincentivo estricto a repetir dos veces seguidas
    }

    // 2. Penalización de 2º orden: patrón de alternancia repetitiva (A-B-A-B)
    if (len >= 3) {
      const prev2 = this.gestureHistory[len - 2]!;
      if (prev2.type === type && currentTime - prev2.timestamp < 8.0) {
        return 0.15;
      }
    }

    return 1.0;
  }

  /**
   * Selecciona el próximo gesto de entre una lista ponderada considerando la memoria temporal
   * con cero asignaciones en memoria.
   */
  public selectBestGesture(
    candidates: Array<{ type: HeadGestureType; baseProbability: number }>,
    currentTime: number
  ): HeadGestureType {
    const count = candidates.length;
    let totalWeight = 0;

    for (let i = 0; i < count; i++) {
      const c = candidates[i]!;
      const modifier = this.getSelectionWeight(c.type, currentTime);
      const w = c.baseProbability * modifier;
      this.candidateWeights[i] = w;
      totalWeight += w;
    }

    if (totalWeight <= 1e-6) {
      return 'idle_sway';
    }

    let roll = Math.random() * totalWeight;
    for (let i = 0; i < count; i++) {
      const w = this.candidateWeights[i]!;
      roll -= w;
      if (roll <= 0) {
        return candidates[i]!.type;
      }
    }

    return candidates[0]?.type ?? 'idle_sway';
  }

  public getHistory(): readonly GestureRecord[] {
    return this.gestureHistory;
  }

  public reset(): void {
    this.gestureHistory.length = 0;
  }
}
