/**
 * gazeDirector.ts
 *
 * Planificador de Mirada, Sacadas Balísticas y Contacto Visual (YourSelf V3 - Fase 3 / Sección 11):
 * - Controla el contacto visual interactivo con el usuario (cámara) y sacadas balísticas naturales.
 * - Micro-derivas oculares biológicas (microsacadas y tremor fisiológico a 1-3 Hz) para evitar la mirada robótica congelada.
 * - Acoplamiento directo con `VORCoordinator` para compensar rotaciones craneales en tiempo real.
 * - Soporte para controles de alto nivel estilo VASA-1 (`gazeTarget` voluntario o programado).
 * - Cero asignaciones en memoria por fotograma.
 */

import { AvatarMood } from '@/lib/types';
import { VORCoordinator, VORState } from './vorCoordinator';

export interface GazeTarget {
  x: number; // [-1..1]
  y: number; // [-1..1]
}

export class GazeDirector {
  public readonly vor: VORCoordinator;

  // Estado instantáneo de la mirada
  private currentX = 0;
  private currentY = 0;

  // Meta intencional (volitiva)
  private targetX = 0;
  private targetY = 0;

  // Parámetro de anulación directa VASA-1 (null si es autónomo)
  private overrideTarget: GazeTarget | null = null;

  // Temporizadores de fijación
  private fixationTimer = 0;
  private nextSaccadeInterval = 2.2;
  private elapsedTime = 0;

  // Búfer reutilizable
  private readonly gazeResult: GazeTarget = { x: 0, y: 0 };

  constructor(vorCoordinator?: VORCoordinator) {
    this.vor = vorCoordinator ?? new VORCoordinator();
  }

  /**
   * Fija una meta de mirada arbitraria inspirada en VASA-1 (`gazeTarget`)
   */
  public setGazeTarget(target: GazeTarget | null): void {
    this.overrideTarget = target;
  }

  /**
   * Actualiza la mirada combinando la intención volitiva, microsacadas y reflejo VOR
   */
  public update(
    deltaSeconds: number,
    currentHeadYaw: number,
    currentHeadPitch: number,
    mood: AvatarMood = 'idle'
  ): GazeTarget {
    this.elapsedTime += deltaSeconds;
    this.fixationTimer += deltaSeconds;

    // 1. Determinar meta volitiva
    if (this.overrideTarget) {
      this.targetX = this.overrideTarget.x;
      this.targetY = this.overrideTarget.y;
    } else {
      // Planificación autónoma de sacadas
      if (this.fixationTimer >= this.nextSaccadeInterval) {
        this.fixationTimer = 0;
        this.nextSaccadeInterval = 1.5 + Math.random() * 2.5;

        // Deriva de atención según el estado
        if (mood === 'thinking') {
          // Mirar arriba y hacia un lado mientras piensa
          this.targetX = (Math.random() > 0.5 ? 1 : -1) * (0.20 + Math.random() * 0.25);
          this.targetY = 0.15 + Math.random() * 0.20;
        } else if (Math.random() < 0.75) {
          // Mirada directa al interlocutor / cámara (75% del tiempo)
          this.targetX = (Math.random() - 0.5) * 0.08;
          this.targetY = (Math.random() - 0.5) * 0.06;
        } else {
          // Breve distracción periférica (25% del tiempo)
          this.targetX = (Math.random() - 0.5) * 0.35;
          this.targetY = (Math.random() - 0.5) * 0.20;
        }
      }
    }

    // 2. Interpolación balística rápida hacia la meta (sacada rápida)
    const saccadeSpeed = 18.0; // rad/s
    this.currentX += (this.targetX - this.currentX) * Math.min(1.0, deltaSeconds * saccadeSpeed);
    this.currentY += (this.targetY - this.currentY) * Math.min(1.0, deltaSeconds * saccadeSpeed);

    // 3. Micro-tremor fisiológico sutil (~2 Hz, amplitud 0.005)
    const microTremorX = Math.sin(this.elapsedTime * 12.5) * 0.004;
    const microTremorY = Math.cos(this.elapsedTime * 14.2) * 0.003;

    const rawGazeX = this.currentX + microTremorX;
    const rawGazeY = this.currentY + microTremorY;

    // 4. Aplicar compensación del Reflejo Vestíbulo-Ocular (VOR)
    const vorState: VORState = this.vor.update(
      deltaSeconds,
      rawGazeX,
      rawGazeY,
      currentHeadYaw,
      currentHeadPitch
    );

    this.gazeResult.x = vorState.compensatedGazeX;
    this.gazeResult.y = vorState.compensatedGazeY;

    return this.gazeResult;
  }
}
