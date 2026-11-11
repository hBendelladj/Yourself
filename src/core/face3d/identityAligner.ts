/**
 * identityAligner.ts
 *
 * Alineador de Identidad y Ajuste Rígido Umeyama/Kabsch con SVD 3x3 Real (YourSelf V4 - Fase 1):
 * - Resuelve el problema de Procrustes ortogonal mediante descomposición en valores singulares (SVD).
 * - Desentrelaza de forma exacta la identidad estática (forma canónica individual β) de la pose cefálica.
 * - Utiliza puntos de anclaje óseos invariantes a la expresión (frente, puente nasal, cóndilos).
 * - Garantiza det(R) = +1 evitando reflexiones indebidas y eliminando derivas de identidad.
 */

import { CanonicalHeadModel, buildCanonicalHeadModel } from './canonicalMesh';
import { Metric3DFaceData } from './depthEstimator';

export interface IdentityAlignmentResult {
  frozenIdentityPositions: Float32Array; // 478 x 3 métrico congelado
  shapeResiduals: Float32Array;          // Delta de identidad respecto al modelo canónico (β)
  scale: number;
  rotationMatrix: Float32Array;         // 3x3
  translation: Float32Array;            // [tx, ty, tz]
  rmsError: number;
}

// Landmarks rígidos del cráneo invariantes a expresión (deep.py / literatura Procrustes)
const RIGID_LANDMARKS = [33, 133, 362, 263, 168, 6, 197, 195, 5, 4, 1, 234, 454, 10, 151, 9, 8, 193, 417];

/**
 * Descomposición en valores singulares (SVD) para matrices 3x3 utilizando el método de Jacobi unilateral (Hestenes).
 * Exactitud a precisión de máquina con convergencia garantizada en <= 30 barridos.
 */
function svd3x3(A: number[]): { U: number[][]; S: number[]; V: number[][] } {
  const V = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const B = [
    [A[0]!, A[1]!, A[2]!],
    [A[3]!, A[4]!, A[5]!],
    [A[6]!, A[7]!, A[8]!],
  ];

  for (let sweep = 0; sweep < 30; sweep++) {
    let maxOff = 0;
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        let a = 0;
        let b = 0;
        let c = 0;
        for (let k = 0; k < 3; k++) {
          a += B[k]![i]! * B[k]![i]!;
          b += B[k]![j]! * B[k]![j]!;
          c += B[k]![i]! * B[k]![j]!;
        }
        maxOff = Math.max(maxOff, Math.abs(c));
        if (Math.abs(c) < 1e-12) continue;

        const zeta = (b - a) / (2 * c);
        let t = Math.sign(zeta) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        if (!Number.isFinite(t)) t = 0;
        const cs = 1 / Math.sqrt(1 + t * t);
        const sn = cs * t;

        for (let k = 0; k < 3; k++) {
          const bi = B[k]![i]!;
          const bj = B[k]![j]!;
          B[k]![i] = cs * bi - sn * bj;
          B[k]![j] = sn * bi + cs * bj;

          const vi = V[k]![i]!;
          const vj = V[k]![j]!;
          V[k]![i] = cs * vi - sn * vj;
          V[k]![j] = sn * vi + cs * vj;
        }
      }
    }
    if (maxOff < 1e-10) break;
  }

  const S = [0, 0, 0];
  const U = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  for (let j = 0; j < 3; j++) {
    const norm = Math.hypot(B[0]![j]!, B[1]![j]!, B[2]![j]!);
    S[j] = norm;
    if (norm > 1e-12) {
      U[0]![j] = B[0]![j]! / norm;
      U[1]![j] = B[1]![j]! / norm;
      U[2]![j] = B[2]![j]! / norm;
    } else {
      U[j]![j] = 1;
    }
  }

  // Ordenar valores singulares y columnas de U y V en orden descendente (S0 >= S1 >= S2)
  // Requisito fundamental del lema de Umeyama (1991) para garantizar escala positiva estricta
  const order = [0, 1, 2].sort((a, b) => S[b]! - S[a]!);
  const sortedS = order.map((idx) => S[idx]!);
  const sortedU = [
    order.map((idx) => U[0]![idx]!),
    order.map((idx) => U[1]![idx]!),
    order.map((idx) => U[2]![idx]!),
  ];
  const sortedV = [
    order.map((idx) => V[0]![idx]!),
    order.map((idx) => V[1]![idx]!),
    order.map((idx) => V[2]![idx]!),
  ];

  return { U: sortedU, S: sortedS, V: sortedV };
}

function det3(M: number[][]): number {
  return (
    M[0]![0]! * (M[1]![1]! * M[2]![2]! - M[1]![2]! * M[2]![1]!) -
    M[0]![1]! * (M[1]![0]! * M[2]![2]! - M[1]![2]! * M[2]![0]!) +
    M[0]![2]! * (M[1]![0]! * M[2]![1]! - M[1]![1]! * M[2]![0]!)
  );
}

export class IdentityAligner {
  private canonicalModel: CanonicalHeadModel;

  constructor(model?: CanonicalHeadModel) {
    this.canonicalModel = model ?? buildCanonicalHeadModel();
  }

  /**
   * Ejecuta el análisis de Procrustes rígido Umeyama en 3D con SVD real
   */
  public align(metricData: Metric3DFaceData): IdentityAlignmentResult {
    const src = metricData.metricPositions;
    const can = this.canonicalModel.canonicalPositions;
    const count = Math.min(src.length / 3, can.length / 3);

    // 1. Filtrar puntos rígidos presentes
    const validRigid = RIGID_LANDMARKS.filter((idx) => idx < count);
    const n = validRigid.length > 0 ? validRigid.length : count;

    // 2. Calcular centroides sobre landmarks rígidos (alineando modelo canónico a la foto fuente)
    let muSx = 0, muSy = 0, muSz = 0;
    let muCx = 0, muCy = 0, muCz = 0;

    for (let i = 0; i < n; i++) {
      const idx = validRigid.length > 0 ? validRigid[i]! : i;
      muSx += src[idx * 3]!;
      muSy += src[idx * 3 + 1]!;
      muSz += src[idx * 3 + 2]!;

      muCx += can[idx * 3]!;
      muCy += can[idx * 3 + 1]!;
      muCz += can[idx * 3 + 2]!;
    }

    muSx /= n;
    muSy /= n;
    muSz /= n;
    muCx /= n;
    muCy /= n;
    muCz /= n;

    // 3. Matriz de covarianza H = (1/N) * Y^T * X, donde X = can, Y = src
    let varCan = 0;
    const H = [0, 0, 0, 0, 0, 0, 0, 0, 0];

    for (let i = 0; i < n; i++) {
      const idx = validRigid.length > 0 ? validRigid[i]! : i;
      const xc = can[idx * 3]! - muCx;
      const yc = can[idx * 3 + 1]! - muCy;
      const zc = can[idx * 3 + 2]! - muCz;

      const ys = src[idx * 3]! - muSx;
      const ys1 = src[idx * 3 + 1]! - muSy;
      const zs = src[idx * 3 + 2]! - muSz;

      varCan += (xc * xc + yc * yc + zc * zc) / n;

      H[0] += (ys * xc) / n;
      H[1] += (ys * yc) / n;
      H[2] += (ys * zc) / n;

      H[3] += (ys1 * xc) / n;
      H[4] += (ys1 * yc) / n;
      H[5] += (ys1 * zc) / n;

      H[6] += (zs * xc) / n;
      H[7] += (zs * yc) / n;
      H[8] += (zs * zc) / n;
    }

    // 4. SVD de H: H = U * S * V^T
    const { U, S, V } = svd3x3(H);
    const detUV = det3(U) * det3(V);
    const d2 = detUV < 0 ? -1 : 1;
    const D = [1, 1, d2];

    // R = U * diag(D) * V^T (orientación rígida de la cabeza)
    const rot = new Float32Array(9);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let k = 0; k < 3; k++) {
          sum += U[r]![k]! * D[k]! * V[c]![k]!;
        }
        rot[r * 3 + c] = sum;
      }
    }

    const scale = (S[0]! * D[0]! + S[1]! * D[1]! + S[2]! * D[2]!) / Math.max(1e-8, varCan);

    // Traslación: t = muSrc - scale * R * muCan
    const tx = muSx - scale * (rot[0]! * muCx + rot[1]! * muCy + rot[2]! * muCz);
    const ty = muSy - scale * (rot[3]! * muCx + rot[4]! * muCy + rot[5]! * muCz);
    const tz = muSz - scale * (rot[6]! * muCx + rot[7]! * muCy + rot[8]! * muCz);
    const translation = new Float32Array([tx, ty, tz]);

    // 5. Búferes congelados de identidad y residual de forma canónica β
    const frozen = new Float32Array(count * 3);
    const residuals = new Float32Array(count * 3);
    let errorSum = 0;

    for (let i = 0; i < count; i++) {
      const sx = src[i * 3]!;
      const sy = src[i * 3 + 1]!;
      const sz = src[i * 3 + 2]!;

      frozen[i * 3] = sx;
      frozen[i * 3 + 1] = sy;
      frozen[i * 3 + 2] = sz;

      // Transformar posición canónica al espacio del sujeto: C' = s*R*C + t
      const cx = can[i * 3]!;
      const cy = can[i * 3 + 1]!;
      const cz = can[i * 3 + 2]!;

      const fittedX = scale * (rot[0]! * cx + rot[1]! * cy + rot[2]! * cz) + tx;
      const fittedY = scale * (rot[3]! * cx + rot[4]! * cy + rot[5]! * cz) + ty;
      const fittedZ = scale * (rot[6]! * cx + rot[7]! * cy + rot[8]! * cz) + tz;

      const dx = sx - fittedX;
      const dy = sy - fittedY;
      const dz = sz - fittedZ;

      residuals[i * 3] = dx;
      residuals[i * 3 + 1] = dy;
      residuals[i * 3 + 2] = dz;

      errorSum += dx * dx + dy * dy + dz * dz;
    }

    const rmsError = Math.sqrt(errorSum / count);

    return {
      frozenIdentityPositions: frozen,
      shapeResiduals: residuals,
      scale,
      rotationMatrix: rot,
      translation,
      rmsError,
    };
  }
}
