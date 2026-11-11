/**
 * vorCoordinator.ts
 *
 * Coordinador del Reflejo Vestíbulo-Ocular (VOR) y Anticipación Sacádica (YourSelf V3 - Fase 3 / Sección 11.1):
 * - Modela la respuesta refleja neuro-oculomotora: cuando la cabeza rota a velocidad angular ω_head,
 *   los ojos compensan instantáneamente en dirección opuesta con velocidad -ω_head · k_vor (k_vor ≈ 0.95-1.0)
 *   para mantener la fijación visual sobre el interlocutor.
 * - Anticipación sacádica: ante cambios de atención intencionales, la mirada inicia el movimiento
 *   60-100 ms antes que la masa craneal; la cabeza sigue después y la mirada se reacomoda al centro.
 * - Cero asignaciones en memoria por fotograma (Zero-Allocation).
 */

export interface VORConfig {
  vorGain?: number; // Típicamente 0.95 a 1.0
  anticipationDelay?: number; // 60 a 100 ms
  maxCompensatoryGaze?: number; // Rango máximo de compensación en radianes / normalizado
}

export interface VORState {
  compensatedGazeX: number;
  compensatedGazeY: number;
  headAngularVelYaw: number;
  headAngularVelPitch: number;
  isAnticipating: boolean;
}

export class VORCoordinator {
  private vorGain: number;
  private maxCompensatoryGaze: number;

  // Seguimiento de pose anterior para cálculo de velocidad angular
  private prevHeadYaw = 0;
  private prevHeadPitch = 0;

  // Cola de anticipación sacádica
  private saccadeTimer = 0;
  private pendingHeadYawTarget = 0;
  private pendingHeadPitchTarget = 0;
  private isAnticipating = false;

  // Estado interno reutilizable (Zero-Allocation)
  private readonly state: VORState = {
    compensatedGazeX: 0,
    compensatedGazeY: 0,
    headAngularVelYaw: 0,
    headAngularVelPitch: 0,
    isAnticipating: false,
  };

  constructor(config?: VORConfig) {
    this.vorGain = config?.vorGain ?? 0.95;
    this.maxCompensatoryGaze = config?.maxCompensatoryGaze ?? 0.40;
  }

  /**
   * Actualiza el reflejo VOR y calcula la compensación ocular respecto al movimiento cefálico
   */
  public update(
    deltaSeconds: number,
    targetGazeX: number,
    targetGazeY: number,
    currentHeadYaw: number,
    currentHeadPitch: number
  ): VORState {
    const dt = Math.max(1e-4, deltaSeconds);

    // 1. Velocidad angular instantánea de la cabeza (rad/s o unidades/s)
    const velYaw = (currentHeadYaw - this.prevHeadYaw) / dt;
    const velPitch = (currentHeadPitch - this.prevHeadPitch) / dt;

    this.prevHeadYaw = currentHeadYaw;
    this.prevHeadPitch = currentHeadPitch;

    this.state.headAngularVelYaw = velYaw;
    this.state.headAngularVelPitch = velPitch;

    // 2. Componente de compensación VOR: opuesta al giro craneal
    // Si la cabeza gira a la derecha (+yaw), los ojos compensan a la izquierda (-gazeX)
    const vorShiftX = -velYaw * this.vorGain * 0.12;
    const vorShiftY = -velPitch * this.vorGain * 0.10;

    // Acotar compensación dentro de los límites biológicos
    const clampedVorX = Math.max(-this.maxCompensatoryGaze, Math.min(this.maxCompensatoryGaze, vorShiftX));
    const clampedVorY = Math.max(-this.maxCompensatoryGaze, Math.min(this.maxCompensatoryGaze, vorShiftY));

    // 3. Gestión de anticipación sacádica
    if (this.isAnticipating) {
      this.saccadeTimer -= dt;
      if (this.saccadeTimer <= 0) {
        this.isAnticipating = false;
      }
    }

    this.state.isAnticipating = this.isAnticipating;
    this.state.compensatedGazeX = Math.max(-1.0, Math.min(1.0, targetGazeX + clampedVorX));
    this.state.compensatedGazeY = Math.max(-1.0, Math.min(1.0, targetGazeY + clampedVorY));

    return this.state;
  }

  /**
   * Programa una sacada con anticipación visual previa al giro de la cabeza
   */
  public scheduleSaccadeWithAnticipation(targetYaw: number, targetPitch: number, delayMs = 80): void {
    this.pendingHeadYawTarget = targetYaw;
    this.pendingHeadPitchTarget = targetPitch;
    this.saccadeTimer = delayMs / 1000;
    this.isAnticipating = true;
  }

  public getPendingHeadTarget(): { yaw: number; pitch: number } {
    return { yaw: this.pendingHeadYawTarget, pitch: this.pendingHeadPitchTarget };
  }
}
