/**
 * rig.ts
 *
 * Ejecutor del Rig Facial V2:
 * - Aplica linealmente las bases precalculadas: out = base + Σ (w_i · basis_i)
 *   únicamente para formas activas (|w_i| > 0.001).
 * - Rotación 3D ortográfica coherente con profundidad sobre (x, y, z) para headYaw,
 *   headPitch y headRoll, produciendo paralaje anatómico natural a partir de la z real.
 * - Cero asignaciones en memoria por fotograma (pre-allocations).
 * - Preserva invariancia de escala respecto a `faceScale`.
 */

import { RigBasis } from './basis';
import { PoseValues } from '@/core/animation/animationState';
import { LANDMARK_INDICES } from '@/core/face/landmarkGroups';
import { JawBone } from './jawBone';
import { ClosedLoopRetargeter } from './closedLoop';
import { HeadLayers } from '@/core/face3d/layers';

export interface RigConfig {
  basePositions: Float32Array;
  vertexCount: number;
  landmarkCount: number;
  faceScale: number;
  basis: RigBasis;
  indices?: Uint16Array;
  rigVersion?: 'v1' | 'v2' | 'v3' | 'v4';
}

export class Rig {
  private basePositions: Float32Array;
  private vertexCount: number;
  private landmarkCount: number;
  private faceScale: number;
  private basis: RigBasis;
  private indices?: Uint16Array;
  private rigVersion: 'v1' | 'v2' | 'v3' | 'v4' = 'v2';

  public jawBone?: JawBone;
  public closedLoop?: ClosedLoopRetargeter;
  public headLayers?: HeadLayers;

  // Centro de rotación cefálica
  private headCenterX = 0;
  private headCenterY = 0;
  private headCenterZ = 0;
  private headRadius = 0.6;

  // Ponderaciones precalculadas de caída de balanceo hacia las anclas fijas
  private headWeights: Float32Array;

  constructor(config: RigConfig) {
    this.basePositions = config.basePositions;
    this.vertexCount = config.vertexCount;
    this.landmarkCount = config.landmarkCount;
    this.faceScale = Math.max(0.01, config.faceScale);
    this.basis = config.basis;
    this.indices = config.indices;
    this.rigVersion = config.rigVersion ?? 'v2';

    this.headWeights = new Float32Array(this.vertexCount);
    this.initHeadPivot();
    this.initV4Components();
  }

  private initV4Components(): void {
    if (this.rigVersion === 'v4' && !this.jawBone) {
      this.jawBone = new JawBone({
        basePositions: this.basePositions,
        landmarkCount: this.landmarkCount,
        vertexCount: this.vertexCount,
        indices: this.indices ?? new Uint16Array(0),
        faceScale: this.faceScale,
      });
      this.closedLoop = new ClosedLoopRetargeter(this.basePositions, this.landmarkCount, this.faceScale);
      this.headLayers = new HeadLayers({
        basePositions: this.basePositions,
        landmarkCount: this.landmarkCount,
        vertexCount: this.vertexCount,
        faceScale: this.faceScale,
        worldWidth: this.faceScale * 3.5,
        worldHeight: this.faceScale * 3.5,
      });
    }
  }

  public setRigVersion(version: 'v1' | 'v2' | 'v3' | 'v4', indices?: Uint16Array): void {
    this.rigVersion = version;
    if (indices) this.indices = indices;
    if (version === 'v4') {
      this.initV4Components();
    }
  }

  private initHeadPivot(): void {
    const base = this.basePositions;
    // Centro anatómico de rotación cefálica: pivote cervical (C3/C4)
    // Desplazado hacia abajo y en profundidad (-Z) hacia la columna cervical
    const pLeft = 234;
    const pRight = 454;
    this.headCenterX = 0.5 * (base[pLeft * 3]! + base[pRight * 3]!);
    this.headCenterY = 0.5 * (base[pLeft * 3 + 1]! + base[pRight * 3 + 1]!) - 0.18 * this.faceScale;
    this.headCenterZ = 0.5 * (base[pLeft * 3 + 2]! + base[pRight * 3 + 2]!) - 0.22 * this.faceScale;
    this.headRadius = 1.65 * this.faceScale;

    // Precalcular pesos de caída hacia las anclas periféricas
    for (let i = 0; i < this.vertexCount; i++) {
      if (i >= this.landmarkCount) {
        // Puntos de borde o anclaje perimetral no se mueven
        this.headWeights[i] = 0;
        continue;
      }

      const vx = base[i * 3]!;
      const vy = base[i * 3 + 1]!;
      const dist = Math.hypot(vx - this.headCenterX, vy - this.headCenterY);
      const u = dist / this.headRadius;

      if (u >= 1.0) {
        this.headWeights[i] = 0.05;
      } else {
        // Smoothstep invertido
        this.headWeights[i] = 1.0 - u * u * (3.0 - 2.0 * u);
      }
    }
  }

  public setFaceScale(scale: number): void {
    this.faceScale = Math.max(0.01, scale);
    this.initHeadPivot();
  }

  /**
   * Aplica las formas de morphing y la rotación cefálica sobre el búfer `outPositions`.
   * Cero asignaciones de memoria.
   */
  public apply(
    poses: PoseValues,
    outPositions: Float32Array,
    extraWeights?: Record<string, number>
  ): void {
    // 1. Iniciar con posiciones base de reposo
    outPositions.set(this.basePositions);

    // 2. Mapear y aplicar formas a partir de poses y visemas
    if (this.rigVersion === 'v4' && this.jawBone) {
      this.jawBone.apply(poses.jawOpen, this.basePositions, outPositions);
    } else {
      this.applyShapeIfActive('jawOpen', poses.jawOpen, outPositions);
    }

    if (poses.mouthRound > 0.005) {
      this.applyShapeIfActive('mouthFunnel', poses.mouthRound * 0.7, outPositions);
      this.applyShapeIfActive('mouthPucker', poses.mouthRound * 0.5, outPositions);
    }

    if (poses.mouthWide > 0.005) {
      this.applyShapeIfActive('mouthStretchLeft', poses.mouthWide, outPositions);
      this.applyShapeIfActive('mouthStretchRight', poses.mouthWide, outPositions);
    }

    if (poses.smile > 0.005) {
      this.applyShapeIfActive('mouthSmileLeft', poses.smile, outPositions);
      this.applyShapeIfActive('mouthSmileRight', poses.smile, outPositions);
      this.applyShapeIfActive('eyeSquintLeft', poses.smile * 0.4, outPositions);
      this.applyShapeIfActive('eyeSquintRight', poses.smile * 0.4, outPositions);
    }

    if (poses.browRaise > 0.005) {
      this.applyShapeIfActive('browInnerUp', poses.browRaise, outPositions);
      this.applyShapeIfActive('browOuterUpLeft', poses.browRaise * 0.8, outPositions);
      this.applyShapeIfActive('browOuterUpRight', poses.browRaise * 0.8, outPositions);
    }

    // Formas individuales adicionales (desde acciones, keyframes o tests)
    if (extraWeights) {
      for (const name in extraWeights) {
        const w = extraWeights[name];
        if (w !== undefined && Math.abs(w) > 0.001) {
          this.applyShapeIfActive(name, w, outPositions);
        }
      }
    }

    // 3. Mirada (Gaze): desplazamiento del iris acotado
    const gx = poses.gazeX;
    const gy = poses.gazeY;
    if (Math.abs(gx) > 0.01 || Math.abs(gy) > 0.01) {
      this.applyGaze(outPositions, gx, gy);
    }

    // 4. Rotación cefálica ortográfica 3D coherente con profundidad (Yaw, Pitch, Roll)
    const yaw = poses.headYaw;
    const pitch = poses.headPitch;
    const roll = poses.headRoll;

    if (Math.abs(yaw) > 0.001 || Math.abs(pitch) > 0.001 || Math.abs(roll) > 0.001) {
      if (this.rigVersion === 'v4' && this.headLayers) {
        this.headLayers.applyLayeredRotation(outPositions, yaw, pitch, roll);
      } else {
        this.applyHeadRotation3D(outPositions, yaw, pitch, roll);
      }
    }

    // 5. Respiración: sutil modulación del torso / cuello inferior
    if (poses.breath > 0.005) {
      this.applyBreath(outPositions, poses.breath);
    }
  }

  private applyShapeIfActive(name: string, weight: number, out: Float32Array): void {
    if (Math.abs(weight) <= 0.001) return;

    const basis = this.basis.getBasis(name);
    if (!basis) return;

    const len = this.landmarkCount * 3;
    for (let i = 0; i < len; i++) {
      const delta = basis[i]!;
      if (delta !== 0) {
        out[i] += delta * weight;
      }
    }
  }

  private applyGaze(out: Float32Array, gx: number, gy: number): void {
    const eyeScale = 0.035 * this.faceScale;
    const shiftX = Math.max(-1, Math.min(1, gx)) * eyeScale;
    const shiftY = Math.max(-1, Math.min(1, gy)) * eyeScale * 0.75;

    const leftIris = LANDMARK_INDICES.leftIris;
    for (let i = 0; i < leftIris.length; i++) {
      const idx = leftIris[i]!;
      out[idx * 3] += shiftX;
      out[idx * 3 + 1] += shiftY;
    }

    const rightIris = LANDMARK_INDICES.rightIris;
    for (let i = 0; i < rightIris.length; i++) {
      const idx = rightIris[i]!;
      out[idx * 3] += shiftX;
      out[idx * 3 + 1] += shiftY;
    }
  }

  /**
   * Rotación 3D ortográfica coherente con profundidad.
   * Parallax generado naturalmente a partir de la coordenada Z real de los landmarks.
   */
  private applyHeadRotation3D(out: Float32Array, yaw: number, pitch: number, roll: number): void {
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const cosR = Math.cos(roll);
    const sinR = Math.sin(roll);

    const cx = this.headCenterX;
    const cy = this.headCenterY;
    const cz = this.headCenterZ;

    const len = this.landmarkCount;
    for (let i = 0; i < len; i++) {
      const w = this.headWeights[i]!;
      if (w <= 0.001) continue;

      // Coordenadas relativas al pivote cefálico
      const x0 = out[i * 3]! - cx;
      const y0 = out[i * 3 + 1]! - cy;
      const z0 = out[i * 3 + 2]! - cz;

      // Rotación Yaw (alrededor de eje Y vertical): x' = x*cos + z*sin, z' = -x*sin + z*cos
      const x1 = x0 * cosY + z0 * sinY;
      const y1 = y0;
      const z1 = -x0 * sinY + z0 * cosY;

      // Rotación Pitch (alrededor de eje X horizontal): y' = y*cos - z*sin, z' = y*sin + z*cos
      const x2 = x1;
      const y2 = y1 * cosP - z1 * sinP;
      const z2 = y1 * sinP + z1 * cosP;

      // Rotación Roll (alrededor de eje Z sagital): x' = x*cos - y*sin, y' = x*sin + y*cos
      const x3 = x2 * cosR - y2 * sinR;
      const y3 = x2 * sinR + y2 * cosR;
      const z3 = z2;

      // Aplicar desplazamiento ponderado por caída hacia el cuello / anillos de anclaje
      out[i * 3] += (x3 - x0) * w;
      out[i * 3 + 1] += (y3 - y0) * w;
      out[i * 3 + 2] += (z3 - z0) * w;
    }
  }

  private applyBreath(out: Float32Array, breath: number): void {
    const breathShift = Math.sin(breath * Math.PI * 2) * 0.008 * this.faceScale;

    // Afecta sutilmente los puntos inferiores de cuello y mentón
    const chinGroup = LANDMARK_INDICES.chinGroup;
    for (let i = 0; i < chinGroup.length; i++) {
      const idx = chinGroup[i]!;
      out[idx * 3 + 1] += breathShift * 0.3;
    }
  }
}
