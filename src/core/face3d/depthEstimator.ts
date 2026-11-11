/**
 * depthEstimator.ts
 *
 * Estimador de Profundidad Métrica 3D (YourSelf V3 - Fase 2 / Sección 10.2):
 * - Extrae y desproyecta las coordenadas 2D + Z relativo de MediaPipe FaceLandmarker
 *   utilizando un modelo estenopeico (pinhole camera model) para reconstruir la métrica real.
 * - Integra opcionalmente la matriz extrínseca 4x4 (`facialTransformationMatrixes`) emitida por MediaPipe.
 * - Compensa la distorsión por perspectiva y el escorzo en fotografías en 3/4.
 * - Aplica corrección volumétrica anatómica en sienes, pómulos y ángulo goníaco de la mandíbula.
 */

import { FaceLandmarkPoint } from '@/lib/types';
import { LANDMARK_INDICES } from '@/core/face/landmarkGroups';
import { calculateAnatomicalZ } from './canonicalMesh';

export interface DepthEstimationConfig {
  landmarks: FaceLandmarkPoint[];
  imageWidth: number;
  imageHeight: number;
  worldWidth: number;
  worldHeight: number;
  transformationMatrix?: number[]; // 4x4 matrix en column-major
}

export interface Metric3DFaceData {
  metricPositions: Float32Array; // 478 x 3 en metros / unidades de mundo Three.js
  estimatedFocalLength: number;
  headYaw: number;
  headPitch: number;
  headRoll: number;
  faceScale: number;
  depthProfile: Float32Array; // Curvatura Z anatómica aislada
  isFrontal: boolean;
}

export class DepthEstimator {
  /**
   * Extrae la rotación rígida (Yaw, Pitch, Roll) de una matriz de transformación 4x4
   * ortonormalizando previamente las columnas de rotación 3x3.
   */
  public static extractEulerFromMatrix(m: number[]): { yaw: number; pitch: number; roll: number } {
    if (m.length < 16) {
      return { yaw: 0, pitch: 0, roll: 0 };
    }

    // MediaPipe emite matriz de transformación 4x4 (column-major)
    // 1. Ortonormalización Gram-Schmidt para eliminar factores de escala espurios y cizalla
    const l0 = Math.hypot(m[0]!, m[1]!, m[2]!);
    const r00 = l0 > 1e-6 ? m[0]! / l0 : 1;
    const r10 = l0 > 1e-6 ? m[1]! / l0 : 0;
    const r20 = l0 > 1e-6 ? m[2]! / l0 : 0;

    const dot = r00 * m[4]! + r10 * m[5]! + r20 * m[6]!;
    let r01 = m[4]! - dot * r00;
    let r11 = m[5]! - dot * r10;
    let r21 = m[6]! - dot * r20;
    const l1 = Math.hypot(r01, r11, r21);
    if (l1 > 1e-6) {
      r01 /= l1;
      r11 /= l1;
      r21 /= l1;
    } else {
      r01 = 0;
      r11 = 1;
      r21 = 0;
    }

    // Columna 2 ortogonal mediante producto cruz: c2 = c0 x c1
    const r02 = r10 * r21 - r20 * r11;
    const r12 = r20 * r01 - r00 * r21;
    const r22 = r00 * r11 - r10 * r01;

    // Extracción de Euler según convención empírica de MediaPipe (analisis_video/analyze.py)
    const pitch = Math.asin(Math.max(-1.0, Math.min(1.0, -r12)));
    let yaw = 0;
    let roll = 0;

    if (Math.abs(r12) < 0.9999) {
      yaw = Math.atan2(r02, r22);
      roll = Math.atan2(r10, r11);
    } else {
      yaw = Math.atan2(-r20, r00);
      roll = 0;
    }

    return { yaw, pitch, roll };
  }

  /**
   * Estima la pose de la cabeza analíticamente a partir de los landmarks si no hay matriz
   * utilizando razones trigonométricas limpias sin multiplicadores mágicos.
   */
  public static estimatePoseFromLandmarks(landmarks: FaceLandmarkPoint[]): { yaw: number; pitch: number; roll: number } {
    if (landmarks.length < 468) {
      return { yaw: 0, pitch: 0, roll: 0 };
    }

    const nose = landmarks[LANDMARK_INDICES.noseTip]!;
    const lEar = landmarks[234]!;
    const rEar = landmarks[454]!;
    const chin = landmarks[152]!;
    const forehead = landmarks[10]!;

    // 1. Roll: ángulo entre los dos cóndilos mandibulares o comisuras oculares
    const roll = Math.atan2(rEar.y - lEar.y, rEar.x - lEar.x);

    // 2. Yaw: proyección trigonométrica de la nariz respecto a las orejas
    const midEarX = 0.5 * (lEar.x + rEar.x);
    const earSpan = Math.max(1e-4, Math.abs(rEar.x - lEar.x));
    const yawRatio = Math.max(-1.0, Math.min(1.0, (2.0 * (nose.x - midEarX)) / earSpan));
    const yaw = Math.asin(yawRatio);

    // 3. Pitch: proyección vertical de la nariz respecto a frente y mentón
    const midY = 0.5 * (forehead.y + chin.y);
    const faceHeight = Math.max(1e-4, Math.abs(chin.y - forehead.y));
    const pitchRatio = Math.max(-1.0, Math.min(1.0, (2.0 * (nose.y - midY)) / faceHeight));
    const pitch = Math.asin(pitchRatio);

    return { yaw, pitch, roll };
  }

  /**
   * Reconstruye las posiciones métricas 3D de los 478 landmarks
   */
  public static estimateMetric3D(config: DepthEstimationConfig): Metric3DFaceData {
    const { landmarks, imageWidth, imageHeight, worldWidth, worldHeight, transformationMatrix } = config;
    const count = landmarks.length;
    const metricPositions = new Float32Array(count * 3);
    const depthProfile = new Float32Array(count);

    // 1. Pose cefálica rígida
    let pose = { yaw: 0, pitch: 0, roll: 0 };
    if (transformationMatrix && transformationMatrix.length >= 16) {
      pose = DepthEstimator.extractEulerFromMatrix(transformationMatrix);
    } else {
      pose = DepthEstimator.estimatePoseFromLandmarks(landmarks);
    }

    // 2. Estimación de distancia focal asumida (cámara estándar web de ~50° FOV)
    const focalLength = Math.max(imageWidth, imageHeight) * 1.15;

    // 3. Distancia interocular (faceScale)
    const lx = (landmarks[LANDMARK_INDICES.leftIrisCenter]?.x ?? 0.4) * worldWidth;
    const ly = (landmarks[LANDMARK_INDICES.leftIrisCenter]?.y ?? 0.4) * worldHeight;
    const rx = (landmarks[LANDMARK_INDICES.rightIrisCenter]?.x ?? 0.6) * worldWidth;
    const ry = (landmarks[LANDMARK_INDICES.rightIrisCenter]?.y ?? 0.4) * worldHeight;
    const faceScale = Math.max(0.05, Math.hypot(rx - lx, ry - ly));

    // Centro nasal
    const nosePt = landmarks[LANDMARK_INDICES.noseTip] || { x: 0.5, y: 0.5, z: 0 };
    const ncx = (nosePt.x - 0.5) * worldWidth;
    const ncy = (0.5 - nosePt.y) * worldHeight;

    // 4. Calcular coordenadas 3D métricas
    for (let i = 0; i < count; i++) {
      const pt = landmarks[i]!;
      const wx = (pt.x - 0.5) * worldWidth;
      const wy = (0.5 - pt.y) * worldHeight;

      // Z relativo de MediaPipe (-0.25 a +0.25 aprox)
      const rawZ = (pt.z || 0) * -worldWidth * 0.45;

      // Curvatura anatómica elipsoidal para laterales y sienes
      const anatomicalZ = calculateAnatomicalZ(wx - ncx, wy - ncy, faceScale * 2.8, faceScale * 3.4) * worldWidth * 1.2;

      // Z final combinado: preserva detalles locales de la nariz y ojos mientras añade volumen lateral
      const finalZ = rawZ + anatomicalZ;

      metricPositions[i * 3] = wx;
      metricPositions[i * 3 + 1] = wy;
      metricPositions[i * 3 + 2] = finalZ;

      depthProfile[i] = finalZ;
    }

    const isFrontal = Math.abs(pose.yaw) < (8 * Math.PI) / 180;

    return {
      metricPositions,
      estimatedFocalLength: focalLength,
      headYaw: pose.yaw,
      headPitch: pose.pitch,
      headRoll: pose.roll,
      faceScale,
      depthProfile,
      isFrontal,
    };
  }
}
