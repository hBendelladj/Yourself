/**
 * jawBone.ts
 *
 * Articulación Mandibular Anatómica con Bisagra Condilar y Linear Blend Skinning (LBS) (YourSelf V4 - Fase 2):
 * - Sustituye los 4 handlers radiales heurísticos por cinemática articular ósea real.
 * - Eje de bisagra en los cóndilos mandibulares (ATM):
 *     c = 1/2(L234 + L454) + (0, +0.05·W, -0.10·W) con W = |L454 - L234|
 * - Radio de palanca: r = |L152 - c|
 * - Ángulo máximo de seguridad: θ_max = 20° (0.349 rad)
 * - Protrusión condilar: τ = (0, 0, +0.15·r·sin θ)
 * - Ponderación de piel w_j(v) con difusión de calor sobre la malla triangulada.
 * - Cero asignaciones en memoria en el bucle caliente (apply).
 */

import { LANDMARK_INDICES } from '@/core/face/landmarkGroups';

export interface JawBoneConfig {
  basePositions: Float32Array;
  landmarkCount: number;
  vertexCount: number;
  indices: Uint16Array;
  faceScale: number;
}

// Conjunto de landmarks del labio superior (fijados a peso 0)
const UPPER_LIP_LANDMARKS = new Set<number>([
  185, 40, 39, 37, 0, 267, 269, 270, 409,
  191, 80, 81, 82, 13, 312, 311, 310, 415,
]);

// Conjunto de landmarks del labio inferior (fijados a peso 1)
const LOWER_LIP_LANDMARKS = new Set<number>([
  146, 91, 181, 84, 17, 314, 405, 321, 375,
  95, 88, 178, 87, 14, 317, 402, 318, 324,
]);

export class JawBone {
  public readonly condyleCenter: [number, number, number];
  public readonly leverRadius: number;
  public readonly faceWidth: number;
  public readonly thetaMax = (20.0 * Math.PI) / 180.0; // 20° de techo de seguridad
  public readonly skinWeights: Float32Array;

  private landmarkCount: number;
  private vertexCount: number;

  constructor(config: JawBoneConfig) {
    const { basePositions, landmarkCount, vertexCount, indices } = config;
    this.landmarkCount = landmarkCount;
    this.vertexCount = vertexCount;

    // 1. Localizar los cóndilos (234 y 454)
    const pL = 234;
    const pR = 454;
    const lx = basePositions[pL * 3]!;
    const ly = basePositions[pL * 3 + 1]!;
    const lz = basePositions[pL * 3 + 2]!;

    const rx = basePositions[pR * 3]!;
    const ry = basePositions[pR * 3 + 1]!;
    const rz = basePositions[pR * 3 + 2]!;

    // Ancho facial W = |L454 - L234|
    const W = Math.hypot(rx - lx, ry - ly, rz - lz);
    this.faceWidth = Math.max(0.01, W);

    // Bisagra condilar: c = 1/2(L234 + L454) + (0, +0.05·W, -0.10·W)
    const cx = 0.5 * (lx + rx);
    const cy = 0.5 * (ly + ry) + 0.05 * this.faceWidth;
    const cz = 0.5 * (lz + rz) - 0.10 * this.faceWidth;
    this.condyleCenter = [cx, cy, cz];

    // Radio de palanca condilo-mentón (L152): r = |L152 - c|
    const chinX = basePositions[LANDMARK_INDICES.chinBottom * 3]!;
    const chinY = basePositions[LANDMARK_INDICES.chinBottom * 3 + 1]!;
    const chinZ = basePositions[LANDMARK_INDICES.chinBottom * 3 + 2]!;
    this.leverRadius = Math.max(0.01, Math.hypot(chinX - cx, chinY - cy, chinZ - cz));

    // 2. Precalcular pesos de piel w_j(v) con difusión de calor
    this.skinWeights = this.computeSkinWeights(basePositions, indices);
  }

  /**
   * Precalcula ponderaciones de piel (Linear Blend Skinning) mediante difusión geodésica
   */
  private computeSkinWeights(base: Float32Array, indices: Uint16Array): Float32Array {
    const weights = new Float32Array(this.vertexCount);
    const pinned = new Uint8Array(this.vertexCount);

    const chinY = base[LANDMARK_INDICES.chinBottom * 3 + 1]!;
    const lipCornersY =
      0.5 *
      (base[LANDMARK_INDICES.lipLeftCorner * 3 + 1]! + base[LANDMARK_INDICES.lipRightCorner * 3 + 1]!);

    // Puntos fijos de contorno (Boundary Conditions)
    for (let i = 0; i < this.vertexCount; i++) {
      if (i >= this.landmarkCount) {
        // Anclas periféricas
        weights[i] = 0;
        pinned[i] = 1;
        continue;
      }

      const vy = base[i * 3 + 1]!;

      // Mentón y labio inferior interior/exterior -> 1.0
      if (
        i === LANDMARK_INDICES.chinBottom ||
        LANDMARK_INDICES.chinGroup.includes(i) ||
        LOWER_LIP_LANDMARKS.has(i)
      ) {
        weights[i] = 1.0;
        pinned[i] = 1;
        continue;
      }

      // Labio superior, nariz y tercio medio/superior de la cara -> 0.0
      if (
        UPPER_LIP_LANDMARKS.has(i) ||
        vy > lipCornersY + 0.02 * this.faceWidth ||
        LANDMARK_INDICES.noseBridge.includes(i) ||
        i === LANDMARK_INDICES.noseTip
      ) {
        weights[i] = 0.0;
        pinned[i] = 1;
        continue;
      }

      // Comisuras bucales -> ~0.5
      if (
        i === LANDMARK_INDICES.lipLeftCorner ||
        i === LANDMARK_INDICES.lipRightCorner ||
        i === 78 ||
        i === 308
      ) {
        weights[i] = 0.5;
        pinned[i] = 1;
        continue;
      }

      // Semilla inicial proporcional a la altura respecto al plano comisural
      if (vy < lipCornersY) {
        const u = Math.min(1.0, Math.max(0, (lipCornersY - vy) / Math.max(1e-4, lipCornersY - chinY)));
        weights[i] = u * 0.9;
      } else {
        weights[i] = 0.0;
      }
    }

    // Construir lista de adyacencia a partir de los triángulos Delaunay
    const neighbors: number[][] = Array.from({ length: this.vertexCount }, () => []);
    for (let t = 0; t < indices.length; t += 3) {
      const i0 = indices[t]!;
      const i1 = indices[t + 1]!;
      const i2 = indices[t + 2]!;

      neighbors[i0]!.push(i1, i2);
      neighbors[i1]!.push(i0, i2);
      neighbors[i2]!.push(i0, i1);
    }

    // Difusión de calor (3 iteraciones de suavizado laplaciano sobre vértices libres)
    const nextWeights = new Float32Array(weights);
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < this.vertexCount; i++) {
        if (pinned[i] === 1) continue;

        const nbrs = neighbors[i]!;
        if (nbrs.length === 0) continue;

        let sum = 0;
        for (let k = 0; k < nbrs.length; k++) {
          sum += weights[nbrs[k]!]!;
        }
        nextWeights[i] = 0.3 * weights[i]! + 0.7 * (sum / nbrs.length);
      }
      weights.set(nextWeights);
    }

    return weights;
  }

  /**
   * Aplica la cinemática de bisagra condilar directamente sobre `outPositions`.
   * Cero asignaciones de memoria.
   *
   * @param jawOpen Factor de apertura de mandíbula en [0, 1]
   * @param basePositions Vértices base en reposo
   * @param outPositions Búfer de salida donde acumular o deformar
   */
  public apply(jawOpen: number, basePositions: Float32Array, outPositions: Float32Array): void {
    if (jawOpen <= 0.0001) {
      return; // A jawOpen = 0 la foto queda idéntica (RMSE de posiciones = 0)
    }

    const clampedOpen = Math.min(1.0, Math.max(0, jawOpen));
    const theta = clampedOpen * this.thetaMax;
    const sinT = Math.sin(theta);

    const [, cy] = this.condyleCenter;
    const r = this.leverRadius;

    // Descenso canónico en el mentón (L152): -r * sin θ
    const maxDescent = -r * sinT;
    const maxTauZ = 0.15 * r * sinT;

    const chinY = basePositions[LANDMARK_INDICES.chinBottom * 3 + 1]!;
    const jawHeight = Math.max(1e-4, cy - chinY);

    const n = Math.min(this.vertexCount, outPositions.length / 3);

    for (let i = 0; i < n; i++) {
      const w = this.skinWeights[i]!;
      if (w <= 0.001) continue;

      const idx = i * 3;
      const by = basePositions[idx + 1]!;

      // Factor de palanca: el mentón (152) desciende con palanca 1.0 (r * sin θ)
      // El labio inferior interior/exterior (14) modula la apertura bucal interior para calibración acústica (0.07 - 0.10 W)
      let leverFrac: number;
      if (i === LANDMARK_INDICES.chinBottom) {
        leverFrac = 1.0;
      } else if (LOWER_LIP_LANDMARKS.has(i)) {
        leverFrac = 0.85 * (this.faceWidth / r);
      } else {
        leverFrac = Math.min(1.0, Math.max(0, (cy - by) / jawHeight));
      }

      const deltaY = maxDescent * leverFrac;
      const deltaZ = maxTauZ * leverFrac;

      outPositions[idx + 1] += w * deltaY;
      outPositions[idx + 2] += w * deltaZ;
    }
  }
}
