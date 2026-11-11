/**
 * dynamics.ts
 *
 * Sistema de dinámica física de segundo orden mediante resortes críticamente amortiguados (ζ = 1):
 * - Reemplaza los filtros exponenciales de primer orden por dinámica newtoniana con inercia, masa y aceleración.
 * - Sin sobreoscilación ni oscilaciones indeseadas (amortiguamiento crítico exacto).
 * - Constantes naturales ω (rad/s) diferenciadas por canal motor:
 *   - Mandíbula y visemas de habla: 32–38 rad/s (alta agilidad sin picos)
 *   - Mirada (sacadas): 35–45 rad/s (movimiento balístico veloz)
 *   - Expresiones (sonrisa, cejas): 8–12 rad/s (cambios graduales de ánimo)
 *   - Postura cefálica (yaw, pitch, roll): 3–5 rad/s (inercia craneal realista)
 * - Límites de velocidad y aceleración para estabilidad numérica y ausencia de saltos.
 */

import { PoseValues } from './animationState';

export interface SpringConfig {
  omega: number;          // Frecuencia angular natural (rad/s)
  maxVelocity?: number;   // Límite de velocidad (unidades/s)
  maxAcceleration?: number; // Límite de aceleración (unidades/s²)
}

export class CriticallyDampedSpring {
  public x: number;
  public v = 0;
  public target: number;
  public omega: number;
  public maxVelocity: number;
  public maxAcceleration: number;

  constructor(initial = 0, config: SpringConfig) {
    this.x = initial;
    this.target = initial;
    this.omega = config.omega;
    this.maxVelocity = config.maxVelocity ?? 50.0;
    this.maxAcceleration = config.maxAcceleration ?? 1200.0;
  }

  /**
   * Avanza un paso de tiempo con integración semi-implícita Euler.
   * Sin asignaciones de memoria.
   */
  public step(dt: number): number {
    const clampedDt = Math.max(0.0001, Math.min(0.1, dt));

    // Si el paso de tiempo es grande (> 30 ms), sub-dividir en 2 pasos para estabilidad
    const steps = clampedDt > 0.03 ? 2 : 1;
    const subDt = clampedDt / steps;

    for (let s = 0; s < steps; s++) {
      // Ecuación armónica críticamente amortiguada: a = ω²(target - x) - 2ωv
      let a = this.omega * this.omega * (this.target - this.x) - 2.0 * this.omega * this.v;

      // Clamping de aceleración
      if (a > this.maxAcceleration) a = this.maxAcceleration;
      else if (a < -this.maxAcceleration) a = -this.maxAcceleration;

      this.v += a * subDt;

      // Clamping de velocidad
      if (this.v > this.maxVelocity) this.v = this.maxVelocity;
      else if (this.v < -this.maxVelocity) this.v = -this.maxVelocity;

      this.x += this.v * subDt;
    }

    // Umbral de reposo para evitar cálculos residuales infinitesimales
    if (Math.abs(this.target - this.x) < 1e-5 && Math.abs(this.v) < 1e-4) {
      this.x = this.target;
      this.v = 0;
    }

    return this.x;
  }

  public reset(value = 0): void {
    this.x = value;
    this.target = value;
    this.v = 0;
  }
}

// Configuración de constantes ω por canal motor (Sección 7.6)
export const DEFAULT_SPRING_CONFIGS: Record<keyof PoseValues, SpringConfig> = {
  // Mandíbula y habla: rápida, ágil y precisa
  jawOpen: { omega: 34.0, maxVelocity: 35.0 },
  mouthRound: { omega: 30.0, maxVelocity: 30.0 },
  mouthWide: { omega: 30.0, maxVelocity: 30.0 },

  // Mirada: sacadas rápidas
  gazeX: { omega: 38.0, maxVelocity: 40.0 },
  gazeY: { omega: 38.0, maxVelocity: 40.0 },

  // Párpados (en caso de utilizar resorte como fallback)
  blink: { omega: 45.0, maxVelocity: 60.0 },
  blinkLeft: { omega: 45.0, maxVelocity: 60.0 },
  blinkRight: { omega: 45.0, maxVelocity: 60.0 },

  // Expresiones faciales: cadencia humana media
  smile: { omega: 9.0, maxVelocity: 12.0 },
  browRaise: { omega: 11.0, maxVelocity: 14.0 },

  // Postura cefálica: masa e inercia craneal lenta y suave
  headYaw: { omega: 4.5, maxVelocity: 8.0 },
  headPitch: { omega: 4.5, maxVelocity: 8.0 },
  headRoll: { omega: 3.8, maxVelocity: 6.0 },

  // Respiración
  breath: { omega: 3.5, maxVelocity: 5.0 },
};

export class DynamicsController {
  private springs: Record<keyof PoseValues, CriticallyDampedSpring>;

  constructor(customConfigs?: Partial<Record<keyof PoseValues, SpringConfig>>) {
    const keys = Object.keys(DEFAULT_SPRING_CONFIGS) as Array<keyof PoseValues>;
    const springs = {} as Record<keyof PoseValues, CriticallyDampedSpring>;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      const config = customConfigs?.[key] ?? DEFAULT_SPRING_CONFIGS[key]!;
      springs[key] = new CriticallyDampedSpring(0, config);
    }

    this.springs = springs;
  }

  public setTarget<K extends keyof PoseValues>(key: K, value: number): void {
    this.springs[key].target = value;
  }

  public getTarget<K extends keyof PoseValues>(key: K): number {
    return this.springs[key].target;
  }

  public getValue<K extends keyof PoseValues>(key: K): number {
    return this.springs[key].x;
  }

  public setValue<K extends keyof PoseValues>(key: K, value: number): void {
    this.springs[key].x = value;
    this.springs[key].v = 0;
  }

  public update(deltaSeconds: number, out: PoseValues): void {
    const keys = Object.keys(this.springs) as Array<keyof PoseValues>;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      out[key] = this.springs[key].step(deltaSeconds);
    }
  }

  public resetAll(out: PoseValues): void {
    const keys = Object.keys(this.springs) as Array<keyof PoseValues>;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      this.springs[key].reset(0);
      out[key] = 0;
    }
  }
}
