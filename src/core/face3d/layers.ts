/**
 * layers.ts
 *
 * Motor de Capas Anatómicas 3D con Profundidad y Rotación Escalonada (YourSelf V4 - Fase 3 / Sección 4.C):
 * - Sustituye el smoothstep local `headWeights` (H2) que causaba el efecto de "máscara deslizante".
 * - Estructura la cabeza en 4 capas biomecánicas coherentes:
 *     1. Rostro (face): peso 1.0 (malla Delaunay con curvatura facial)
 *     2. Cabello (hair): peso 0.95 (envolvente elipsoidal del cráneo z = z0 + k·√(1 - (x/a)² - (y/b)²))
 *     3. Cuello (neck): peso 0.50 (cilindro cervical corto)
 *     4. Hombros (shoulders): peso 0.15 (plano con micro-rotación)
 *     5. Fondo (background): peso 0.0 (estático)
 * - Aplica rotación tridimensional unificada alrededor del pivote cervical C3/C4 con cero asignaciones.
 */

import { LANDMARK_INDICES } from '@/core/face/landmarkGroups';

export type HeadLayerId = 'face' | 'hair' | 'neck' | 'shoulders' | 'background';

export const LAYER_ROTATION_WEIGHTS: Record<HeadLayerId, number> = {
  face: 1.0,
  hair: 0.95,
  neck: 0.50,
  shoulders: 0.15,
  background: 0.0,
};

export interface HeadLayersConfig {
  basePositions: Float32Array;
  landmarkCount: number;
  vertexCount: number;
  faceScale: number;
  worldWidth: number;
  worldHeight: number;
}

export class HeadLayers {
  public readonly layerWeights: Float32Array; // Peso de rotación efectivo por vértice [0.0 - 1.0]
  public readonly layerClassification: Uint8Array; // 0=bg, 1=shoulders, 2=neck, 3=hair, 4=face

  private basePositions: Float32Array;
  private landmarkCount: number;
  private vertexCount: number;
  private faceScale: number;

  // Pivote cervical (C3/C4)
  public readonly pivotX: number;
  public readonly pivotY: number;
  public readonly pivotZ: number;

  constructor(config: HeadLayersConfig) {
    const { basePositions, landmarkCount, vertexCount, faceScale, worldWidth, worldHeight } = config;
    this.basePositions = basePositions;
    this.landmarkCount = landmarkCount;
    this.vertexCount = vertexCount;
    this.faceScale = Math.max(0.01, faceScale);

    this.layerWeights = new Float32Array(this.vertexCount);
    this.layerClassification = new Uint8Array(this.vertexCount);

    // Pivote cervical anatómico C3/C4
    const pLeft = 234;
    const pRight = 454;
    this.pivotX = 0.5 * (basePositions[pLeft * 3]! + basePositions[pRight * 3]!);
    this.pivotY = 0.5 * (basePositions[pLeft * 3 + 1]! + basePositions[pRight * 3 + 1]!) - 0.20 * this.faceScale;
    this.pivotZ = 0.5 * (basePositions[pLeft * 3 + 2]! + basePositions[pRight * 3 + 2]!) - 0.25 * this.faceScale;

    this.initLayers(worldWidth, worldHeight);
  }

  /**
   * Clasifica cada vértice en su capa anatómica y calcula la profundidad Z y pesos de rotación
   */
  private initLayers(worldWidth: number, worldHeight: number): void {
    const base = this.basePositions;
    const chinY = base[LANDMARK_INDICES.chinBottom * 3 + 1]!;
    const foreheadY = base[10 * 3 + 1]!;
    const noseY = base[LANDMARK_INDICES.noseTip * 3 + 1]!;
    const earY = 0.5 * (base[234 * 3 + 1]! + base[454 * 3 + 1]!);

    // Conjunto de índices del óvalo facial interior
    const faceOvalSet = new Set(LANDMARK_INDICES.faceOval);

    // Parámetros de la envolvente elipsoidal del cráneo (cabello)
    const a = this.faceScale * 1.5;
    const b = this.faceScale * 1.8;
    const k = 0.15 * worldWidth;
    const z0 = -0.05 * worldWidth;

    for (let i = 0; i < this.vertexCount; i++) {
      const vx = base[i * 3]!;
      const vy = base[i * 3 + 1]!;
      const vz = base[i * 3 + 2]!;

      // 1. Vértices periféricos de borde (anclas externas) -> Fondo
      if (i >= this.landmarkCount) {
        // Si el vértice está en el tercio inferior central, clasificarlo como hombros/cuello
        if (vy < chinY - 0.25 * this.faceScale) {
          if (Math.abs(vx - this.pivotX) < this.faceScale * 1.2) {
            this.layerClassification[i] = 1; // Hombros
            this.layerWeights[i] = LAYER_ROTATION_WEIGHTS.shoulders;
          } else {
            this.layerClassification[i] = 0; // Fondo
            this.layerWeights[i] = LAYER_ROTATION_WEIGHTS.background;
          }
        } else {
          this.layerClassification[i] = 0; // Fondo
          this.layerWeights[i] = LAYER_ROTATION_WEIGHTS.background;
        }
        continue;
      }

      // 2. Rostro central (face): dentro de los landmarks faciales
      if (vy >= chinY && vy <= foreheadY) {
        this.layerClassification[i] = 4; // Rostro
        this.layerWeights[i] = LAYER_ROTATION_WEIGHTS.face;
        continue;
      }

      // 3. Cuello (neck): debajo del mentón, centrado
      if (vy < chinY && Math.abs(vx - this.pivotX) < 0.65 * this.faceScale) {
        this.layerClassification[i] = 2; // Cuello
        this.layerWeights[i] = LAYER_ROTATION_WEIGHTS.neck;

        // Cilindro cervical en Z
        const cylRadius = 0.50 * this.faceScale;
        const dx = Math.abs(vx - this.pivotX);
        if (dx < cylRadius) {
          const cylZ = -Math.sqrt(cylRadius * cylRadius - dx * dx) * 0.3;
          base[i * 3 + 2] = Math.min(vz, cylZ);
        }
        continue;
      }

      // 4. Cabello y cráneo (hair): por encima de la frente o laterales exteriores
      if (vy > foreheadY - 0.05 * this.faceScale || Math.abs(vx - this.pivotX) > this.faceScale * 0.9) {
        this.layerClassification[i] = 3; // Cabello
        this.layerWeights[i] = LAYER_ROTATION_WEIGHTS.hair;

        // Envolvente elipsoidal en Z para el cráneo / cabello
        const nx = (vx - this.pivotX) / a;
        const ny = (vy - noseY) / b;
        const radSq = nx * nx + ny * ny;
        if (radSq < 1.0) {
          const ellipsoidZ = z0 + k * Math.sqrt(1.0 - radSq);
          base[i * 3 + 2] = Math.max(vz, ellipsoidZ);
        }
        continue;
      }

      // 5. Por defecto: transición facial suave
      this.layerClassification[i] = 4;
      this.layerWeights[i] = LAYER_ROTATION_WEIGHTS.face;
    }
  }

  /**
   * Aplica rotación 3D escalonada por capa alrededor del pivote cervical.
   * Cero asignaciones de memoria en tiempo de ejecución.
   */
  public applyLayeredRotation(
    outPositions: Float32Array,
    yaw: number,
    pitch: number,
    roll: number
  ): void {
    if (Math.abs(yaw) <= 0.0001 && Math.abs(pitch) <= 0.0001 && Math.abs(roll) <= 0.0001) {
      return;
    }

    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const cosR = Math.cos(roll);
    const sinR = Math.sin(roll);

    const px = this.pivotX;
    const py = this.pivotY;
    const pz = this.pivotZ;

    const count = this.vertexCount;

    for (let i = 0; i < count; i++) {
      const w = this.layerWeights[i]!;
      if (w <= 0.001) continue;

      const idx = i * 3;
      const x0 = outPositions[idx]! - px;
      const y0 = outPositions[idx + 1]! - py;
      const z0 = outPositions[idx + 2]! - pz;

      // 1. Yaw (rotación en Y)
      const x1 = cosY * x0 + sinY * z0;
      const y1 = y0;
      const z1 = -sinY * x0 + cosY * z0;

      // 2. Pitch (rotación en X)
      const x2 = x1;
      const y2 = cosP * y1 - sinP * z1;
      const z2 = sinP * y1 + cosP * z1;

      // 3. Roll (rotación en Z)
      const x3 = cosR * x2 - sinR * y2;
      const y3 = sinR * x2 + cosR * y2;
      const z3 = z2;

      // Desplazamiento rígido respecto a la posición inicial
      const targetX = px + x3;
      const targetY = py + y3;
      const targetZ = pz + z3;

      // Interpolar por peso de capa: (1 - w)*p + w*p_rot
      outPositions[idx]! += (targetX - outPositions[idx]!) * w;
      outPositions[idx + 1]! += (targetY - outPositions[idx + 1]!) * w;
      outPositions[idx + 2]! += (targetZ - outPositions[idx + 2]!) * w;
    }
  }
}
