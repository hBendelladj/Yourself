/**
 * eyeBall.ts
 *
 * Motor Biomecánico del Globo Ocular 3D Desacoplado (YourSelf V3 - Fase 1 / Sección 9.1):
 * - Modela ambos globos oculares como esferas rígidas 3D independientes ($R \approx 12$ mm equivalente).
 * - La textura del iris y pupila reside en la superficie corneal/esférica.
 * - La mirada voluntaria (gazeX, gazeY) aplica una ROTACIÓN ANGULAR PURA sobre el centro de rotación orbitario,
 *   preservando de forma estricta e invariable el radio, la distancia inter-vértices y el área del iris.
 * - Desacoplamiento total del parpadeo: el parpadeo JAMÁS desplaza, estira ni comprime los vértices del iris.
 * - Cero asignaciones en memoria dentro del bucle de actualización (Zero-Allocation).
 */

import { LANDMARK_INDICES } from '@/core/face/landmarkGroups';

export interface EyeBallConfig {
  basePositions: Float32Array;
  faceScale: number;
}

export interface EyeSphereData {
  centerX: number;
  centerY: number;
  centerZ: number;
  radius: number;
  irisIndices: readonly number[];
  irisCenterIndex: number;
  outerCornerIndex: number;
  innerCornerIndex: number;
  baseIrisOffsets: Float32Array; // [dx, dy, dz] por cada vértice del iris respecto al centro de rotación
}

export interface EyeMetrics {
  centroidX: number;
  centroidY: number;
  centroidZ: number;
  radius: number;
  area: number;
}

export class EyeBall {
  private faceScale: number;
  private leftEye: EyeSphereData;
  private rightEye: EyeSphereData;

  // Ángulos actuales de mirada
  private gazeYaw = 0;
  private gazePitch = 0;

  // Matrices de rotación pre-asignadas (Zero-Allocation)
  private cosYaw = 1;
  private sinYaw = 0;
  private cosPitch = 1;
  private sinPitch = 0;

  // Búferes pre-asignados para métricas
  private readonly leftMetrics: EyeMetrics = { centroidX: 0, centerY: 0, centroidZ: 0, radius: 0, area: 0 };
  private readonly rightMetrics: EyeMetrics = { centroidX: 0, centerY: 0, centroidZ: 0, radius: 0, area: 0 };

  constructor(config: EyeBallConfig) {
    this.faceScale = Math.max(0.01, config.faceScale);

    this.leftEye = this.initEyeSphere(
      config.basePositions,
      LANDMARK_INDICES.leftIris,
      LANDMARK_INDICES.leftIrisCenter,
      LANDMARK_INDICES.leftEyeCornerOuter,
      LANDMARK_INDICES.leftEyeCornerInner
    );

    this.rightEye = this.initEyeSphere(
      config.basePositions,
      LANDMARK_INDICES.rightIris,
      LANDMARK_INDICES.rightIrisCenter,
      LANDMARK_INDICES.rightEyeCornerOuter,
      LANDMARK_INDICES.rightEyeCornerInner
    );
  }

  /**
   * Inicializa la esfera rígida y los vectores de offset del iris respecto al centro de rotación
   */
  private initEyeSphere(
    base: Float32Array,
    irisIndices: readonly number[],
    irisCenterIndex: number,
    outerCornerIndex: number,
    innerCornerIndex: number
  ): EyeSphereData {
    const ox = base[outerCornerIndex * 3]!;
    const oy = base[outerCornerIndex * 3 + 1]!;
    const oz = base[outerCornerIndex * 3 + 2]!;

    const ix = base[innerCornerIndex * 3]!;
    const iy = base[innerCornerIndex * 3 + 1]!;
    const iz = base[innerCornerIndex * 3 + 2]!;

    // Fisura palpebral
    const fissureWidth = Math.hypot(ox - ix, oy - iy);
    // Radio anatómico de la esfera ocular (~58% de la anchura de la fisura palpebral)
    const radius = Math.max(0.01, fissureWidth * 0.58);

    // Centro de rotación situado en el punto medio de las comisuras y desplazado hacia el fondo (-Z)
    const centerX = 0.5 * (ox + ix);
    const centerY = 0.5 * (oy + iy);
    const centerZ = 0.5 * (oz + iz) - radius * 0.75;

    // Precalcular offsets relativos del iris respecto al centro de rotación
    const baseIrisOffsets = new Float32Array(irisIndices.length * 3);
    for (let i = 0; i < irisIndices.length; i++) {
      const idx = irisIndices[i]!;
      baseIrisOffsets[i * 3] = base[idx * 3]! - centerX;
      baseIrisOffsets[i * 3 + 1] = base[idx * 3 + 1]! - centerY;
      baseIrisOffsets[i * 3 + 2] = base[idx * 3 + 2]! - centerZ;
    }

    return {
      centerX,
      centerY,
      centerZ,
      radius,
      irisIndices,
      irisCenterIndex,
      outerCornerIndex,
      innerCornerIndex,
      baseIrisOffsets,
    };
  }

  /**
   * Actualiza los ángulos de mirada (gazeX, gazeY normalizados en [-1, 1])
   * Límite anatómico: ±24° en yaw y ±18° en pitch.
   */
  public updateGaze(gazeX: number, gazeY: number): void {
    const maxYawRad = 0.4189;   // ~24 grados
    const maxPitchRad = 0.3142; // ~18 grados

    const clampedX = Math.max(-1.0, Math.min(1.0, gazeX));
    const clampedY = Math.max(-1.0, Math.min(1.0, gazeY));

    this.gazeYaw = clampedX * maxYawRad;
    this.gazePitch = clampedY * maxPitchRad;

    this.cosYaw = Math.cos(this.gazeYaw);
    this.sinYaw = Math.sin(this.gazeYaw);
    this.cosPitch = Math.cos(this.gazePitch);
    this.sinPitch = Math.sin(this.gazePitch);
  }

  /**
   * Aplica la rotación angular pura del globo ocular a los vértices del iris
   * en el búfer de salida `positions`.
   * Cero asignaciones en memoria.
   */
  public applyToPositions(positions: Float32Array): void {
    this.rotateEyeIris(this.leftEye, positions);
    this.rotateEyeIris(this.rightEye, positions);
  }

  private rotateEyeIris(eye: EyeSphereData, positions: Float32Array): void {
    const cx = eye.centerX;
    const cy = eye.centerY;
    const cz = eye.centerZ;

    const cyaw = this.cosYaw;
    const syaw = this.sinYaw;
    const cpitch = this.cosPitch;
    const spitch = this.sinPitch;

    const len = eye.irisIndices.length;
    for (let i = 0; i < len; i++) {
      const idx = eye.irisIndices[i]!;

      // Offset relativo no rotado
      const x0 = eye.baseIrisOffsets[i * 3]!;
      const y0 = eye.baseIrisOffsets[i * 3 + 1]!;
      const z0 = eye.baseIrisOffsets[i * 3 + 2]!;

      // Rotación combinada R = Ry(yaw) * Rx(pitch)
      // 1. Rx(pitch)
      const x1 = x0;
      const y1 = y0 * cpitch - z0 * spitch;
      const z1 = y0 * spitch + z0 * cpitch;

      // 2. Ry(yaw)
      const x2 = x1 * cyaw + z1 * syaw;
      const y2 = y1;
      const z2 = -x1 * syaw + z1 * cyaw;

      // Asignar posición 3D rotada rígidamente
      positions[idx * 3] = cx + x2;
      positions[idx * 3 + 1] = cy + y2;
      positions[idx * 3 + 2] = cz + z2;
    }
  }

  /**
   * Calcula el centroide, radio medio y área del iris actual para verificación geométrica
   */
  public getIrisMetrics(eyeSide: 'left' | 'right', positions: Float32Array): EyeMetrics {
    const eye = eyeSide === 'left' ? this.leftEye : this.rightEye;
    const metrics = eyeSide === 'left' ? this.leftMetrics : this.rightMetrics;

    const len = eye.irisIndices.length;
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;

    for (let i = 0; i < len; i++) {
      const idx = eye.irisIndices[i]!;
      sumX += positions[idx * 3]!;
      sumY += positions[idx * 3 + 1]!;
      sumZ += positions[idx * 3 + 2]!;
    }

    const cx = sumX / len;
    const cy = sumY / len;
    const cz = sumZ / len;

    metrics.centroidX = cx;
    metrics.centroidY = cy;
    metrics.centroidZ = cz;

    // Calcular radio medio de los puntos perimetrales respecto al centroide
    let sumR = 0;
    let countR = 0;
    for (let i = 0; i < len; i++) {
      const idx = eye.irisIndices[i]!;
      if (idx !== eye.irisCenterIndex) {
        const dx = positions[idx * 3]! - cx;
        const dy = positions[idx * 3 + 1]! - cy;
        const dz = positions[idx * 3 + 2]! - cz;
        sumR += Math.hypot(dx, dy, dz);
        countR++;
      }
    }
    const avgR = countR > 0 ? sumR / countR : eye.radius * 0.2;
    metrics.radius = avgR;

    // Área equivalente aproximada de la superficie del iris: π * r^2
    metrics.area = Math.PI * avgR * avgR;

    return metrics;
  }

  public getLeftEyeSphere(): Readonly<EyeSphereData> {
    return this.leftEye;
  }

  public getRightEyeSphere(): Readonly<EyeSphereData> {
    return this.rightEye;
  }

  public getGazeAngles(): { yaw: number; pitch: number } {
    return { yaw: this.gazeYaw, pitch: this.gazePitch };
  }
}
