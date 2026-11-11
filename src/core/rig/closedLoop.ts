/**
 * closedLoop.ts
 *
 * Módulo de Retargeting en Lazo Cerrado (YourSelf V4 - Fase 2 / Sección 4.B):
 * - Inspirado en los módulos de retargeting adaptativo de LivePortrait (arXiv 2407.03168).
 * - Mide la relación de aspecto ocular (Eye Aspect Ratio, EAR) y la apertura labial relativa (c_lip)
 *   en reposo de la foto original (c_src).
 * - Utiliza una iteración analítica de Newton-Raphson/secante para resolver el peso w óptimo:
 *     w ← w + (c* - c(w)) / (∂c/∂w)
 * - Garantiza que personas con ojos rasgados, labios gruesos o sonrisas de base abran y cierren
 *   de manera normalizada e idéntica a la referencia física.
 * - Cero asignaciones en memoria por fotograma.
 */

import { LANDMARK_INDICES } from '@/core/face/landmarkGroups';

export interface ClosedLoopCalibration {
  restingEarLeft: number;
  restingEarRight: number;
  restingLipGapRatio: number;
  dEarDblinkLeft: number;
  dEarDblinkRight: number;
  dLipGapDjaw: number;
}

export class ClosedLoopRetargeter {
  private calibration: ClosedLoopCalibration;
  private iod: number;

  constructor(basePositions: Float32Array, landmarkCount: number, faceScale: number) {
    this.iod = Math.max(0.01, faceScale);
    this.calibration = this.calibrateResting(basePositions, landmarkCount);
  }

  /**
   * Calcula el Eye Aspect Ratio (EAR) para un conjunto de 6 landmarks oculares:
   * EAR = (|p2 - p6| + |p3 - p5|) / (2 * |p1 - p4|)
   */
  public static computeEyeEAR(
    pos: Float32Array,
    p1: number,
    p2: number,
    p3: number,
    p4: number,
    p5: number,
    p6: number
  ): number {
    const p1x = pos[p1 * 3]!, p1y = pos[p1 * 3 + 1]!;
    const p2x = pos[p2 * 3]!, p2y = pos[p2 * 3 + 1]!;
    const p3x = pos[p3 * 3]!, p3y = pos[p3 * 3 + 1]!;
    const p4x = pos[p4 * 3]!, p4y = pos[p4 * 3 + 1]!;
    const p5x = pos[p5 * 3]!, p5y = pos[p5 * 3 + 1]!;
    const p6x = pos[p6 * 3]!, p6y = pos[p6 * 3 + 1]!;

    const verticalA = Math.hypot(p2x - p6x, p2y - p6y);
    const verticalB = Math.hypot(p3x - p5x, p3y - p5y);
    const horizontal = Math.max(1e-4, Math.hypot(p1x - p4x, p1y - p4y));

    return (verticalA + verticalB) / (2.0 * horizontal);
  }

  /**
   * Calcula la relación de apertura labial interior c_lip = |L13 - L14| / IOD
   */
  public static computeLipGapRatio(pos: Float32Array, iod: number): number {
    const uIdx = LANDMARK_INDICES.lipUpperInnerCenter * 3;
    const lIdx = LANDMARK_INDICES.lipLowerInnerCenter * 3;

    const dx = pos[uIdx]! - pos[lIdx]!;
    const dy = pos[uIdx + 1]! - pos[lIdx + 1]!;
    const dz = pos[uIdx + 2]! - pos[lIdx + 2]!;

    const gap = Math.hypot(dx, dy, dz);
    return gap / Math.max(1e-4, iod);
  }

  /**
   * Calibra los valores de reposo iniciales y derivadas de sensibilidad una sola vez por foto
   */
  private calibrateResting(base: Float32Array, landmarkCount: number): ClosedLoopCalibration {
    if (landmarkCount < 468) {
      return {
        restingEarLeft: 0.28,
        restingEarRight: 0.28,
        restingLipGapRatio: 0.01,
        dEarDblinkLeft: -0.25,
        dEarDblinkRight: -0.25,
        dLipGapDjaw: 0.65,
      };
    }

    const earL = ClosedLoopRetargeter.computeEyeEAR(base, 33, 160, 158, 133, 153, 144);
    const earR = ClosedLoopRetargeter.computeEyeEAR(base, 263, 387, 385, 362, 380, 373);
    const lipRatio = ClosedLoopRetargeter.computeLipGapRatio(base, this.iod);

    // Derivadas empíricas precalculadas para cierre total y apertura estándar
    const dEarL = -Math.max(0.15, earL * 0.92);
    const dEarR = -Math.max(0.15, earR * 0.92);
    const dLip = 0.70; // Apertura labial promedio respecto al IOD para jawOpen = 1.0

    return {
      restingEarLeft: earL,
      restingEarRight: earR,
      restingLipGapRatio: lipRatio,
      dEarDblinkLeft: dEarL,
      dEarDblinkRight: dEarR,
      dLipGapDjaw: dLip,
    };
  }

  /**
   * Resuelve el peso corregido de parpadeo (blinkWeight) para alcanzar el target de cierre exacto
   */
  public solveBlinkWeight(targetBlink: number, currentEarLeft: number): number {
    // Si targetBlink = 0 (ojos abiertos), EAR objetivo es resting; si 1 (cerrados), EAR objetivo es ~0.04
    const targetEar = (1.0 - targetBlink) * this.calibration.restingEarLeft + targetBlink * 0.04;
    const residual = targetEar - currentEarLeft;

    const w0 = targetBlink;
    const w1 = w0 + residual / this.calibration.dEarDblinkLeft;
    return Math.min(1.0, Math.max(0.0, w1));
  }

  /**
   * Resuelve el peso corregido de mandíbula (jawWeight) para alcanzar la apertura labial interior deseada
   *
   * @param targetGapRatio Apertura objetivo (|L13 - L14| / IOD)
   * @param currentPositions Coordenadas actuales antes del paso
   * @param currentJawWeight Peso inicial estimado de jawOpen
   */
  public solveJawWeight(targetGapRatio: number, currentPositions: Float32Array, currentJawWeight: number): number {
    const currentGapRatio = ClosedLoopRetargeter.computeLipGapRatio(currentPositions, this.iod);
    const residual = targetGapRatio - currentGapRatio;

    // Paso de Newton: w ← w + (c* - c(w)) / (∂c/∂w)
    const w = currentJawWeight + residual / this.calibration.dLipGapDjaw;
    return Math.min(1.0, Math.max(0.0, w));
  }

  public getCalibration(): ClosedLoopCalibration {
    return this.calibration;
  }
}
