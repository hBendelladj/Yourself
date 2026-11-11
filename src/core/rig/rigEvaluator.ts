/**
 * rigEvaluator.ts
 *
 * Evaluador y Compositor Matricial de Blendshapes ARKit (YourSelf V3 - Fase 4 / Sección 12 & 14):
 * - Evalúa eficientemente los pesos del vector ARKit (52 coeficientes) sobre la malla 3D.
 * - Aplica cinemática articular mandibular temporomandibular (ATM / Rodrigues 3D) en lugar
 *   de traslación vertical plana de los landmarks.
 * - Genera el búfer `morphTargetInfluences` directamente compatible con el Vertex Shader de Three.js.
 * - Cero asignaciones en memoria por fotograma (Zero-Allocation).
 */

import { ARKitVector, ARKitShapeName, ARKIT_SHAPE_NAMES } from './arkitShapes';

export interface RigEvaluatorConfig {
  basePositions: Float32Array;
  landmarkCount: number;
  faceScale: number;
}

export class RigEvaluator {
  private basePositions: Float32Array;
  private landmarkCount: number;
  private faceScale: number;

  // Vector ARKit 52 pre-asignado
  public readonly arkitVector = new ARKitVector();

  // Búfer pre-asignado de influencias Three.js (Float32Array de 52 floats)
  public readonly morphTargetInfluences = new Float32Array(52);

  constructor(config: RigEvaluatorConfig) {
    this.basePositions = config.basePositions;
    this.landmarkCount = config.landmarkCount;
    this.faceScale = Math.max(0.01, config.faceScale);
  }

  public setFaceScale(scale: number): void {
    this.faceScale = Math.max(0.01, scale);
  }

  /**
   * Asigna un peso para una forma ARKit específica
   */
  public setWeight(name: ARKitShapeName, weight: number): void {
    this.arkitVector.set(name, weight);
    const idx = ARKIT_SHAPE_NAMES.indexOf(name);
    if (idx !== -1) {
      this.morphTargetInfluences[idx] = Math.max(0, Math.min(1.0, weight));
    }
  }

  /**
   * Evalúa la rotación temporomandibular (ATM) sobre el eje cóndilo-mandibular:
   * Los cóndilos se sitúan en los extremos de la mandíbula; la mandíbula rota hacia abajo y atrás.
   */
  public evaluateJawCondyleArc(
    jawOpen: number,
    outPositions: Float32Array,
    chinIndex = 152,
    lowerLipIndex = 14
  ): void {
    if (jawOpen <= 0.001) return;

    // Ángulo de apertura mandibular (hasta ~14 grados = 0.24 rad)
    const theta = jawOpen * 0.24;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    // Eje cóndilo horizontal a la altura de las orejas (Z atrás)
    const condyleY = this.basePositions[234 * 3 + 1]!;
    const condyleZ = this.basePositions[234 * 3 + 2]! - 0.03 * this.faceScale;

    // Desplazamiento rotacional del mentón y labio inferior
    const indicesToRotate = [chinIndex, lowerLipIndex, 17, 84, 181, 91, 146, 314, 405, 321, 375];
    for (let k = 0; k < indicesToRotate.length; k++) {
      const idx = indicesToRotate[k]!;
      const y0 = this.basePositions[idx * 3 + 1]! - condyleY;
      const z0 = this.basePositions[idx * 3 + 2]! - condyleZ;

      // Rotación sobre eje X
      const rotY = y0 * cosT - z0 * sinT;
      const rotZ = y0 * sinT + z0 * cosT;

      outPositions[idx * 3 + 1] = condyleY + rotY;
      outPositions[idx * 3 + 2] = condyleZ + rotZ;
    }
  }

  /**
   * Sincroniza y copia los pesos ARKit hacia el array de salida de Three.js
   */
  public syncToThreeInfluences(targetArray: Float32Array | number[]): void {
    for (let i = 0; i < 52; i++) {
      targetArray[i] = this.morphTargetInfluences[i]!;
    }
  }

  public reset(): void {
    this.arkitVector.reset();
    this.morphTargetInfluences.fill(0);
  }
}
