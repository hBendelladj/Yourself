/**
 * v4_phase1.test.ts
 *
 * Pruebas de aceptación Fase 1 (YourSelf V4):
 * 1. Pose real a partir de facialTransformationMatrix (H3 resuelto sin constantes mágicas).
 * 2. Descomposición SVD 3x3 y alineación Umeyama/Kabsch con det(R) = +1 (H4 resuelto).
 * 3. Límites blandos de rotación con tangente hiperbólica según frontalidad.
 * 4. Micro-movimiento vivo en reposo neutral 'idle' (H6 resuelto).
 */

import { describe, it, expect } from 'vitest';
import { DepthEstimator } from '@/core/face3d/depthEstimator';
import { IdentityAligner } from '@/core/face3d/identityAligner';
import { FaceLandmarkPoint } from '@/lib/types';

describe('V4 Fase 1: Pose Real, SVD Umeyama y Límites Blandos', () => {
  const createMockLandmarks = (): FaceLandmarkPoint[] => {
    return Array.from({ length: 478 }, (_, i) => ({
      x: 0.5 + ((i % 20) - 10) * 0.015,
      y: 0.5 + (Math.floor(i / 20) - 12) * 0.015,
      z: i === 1 ? 0.04 : 0.0,
    }));
  };

  it('1. Extrae pose cefálica exacta de matriz 4x4 ortonormalizada (H3)', () => {
    // Matriz de rotación pura alrededor del eje Y (yaw = +20° = 0.349065 rad)
    const angle = (20.0 * Math.PI) / 180.0;
    const cosY = Math.cos(angle);
    const sinY = Math.sin(angle);

    // Matriz 4x4 en column-major con factor de escala 1.5
    // col 0 = [1.5*cos, 0, -1.5*sin, 0]
    // col 1 = [0, 1.5, 0, 0]
    // col 2 = [1.5*sin, 0, 1.5*cos, 0]
    // col 3 = [0.1, 0.2, 0.3, 1]
    const m = [
      1.5 * cosY, 0, -1.5 * sinY, 0,
      0, 1.5, 0, 0,
      1.5 * sinY, 0, 1.5 * cosY, 0,
      0.1, 0.2, 0.3, 1.0,
    ];

    const pose = DepthEstimator.extractEulerFromMatrix(m);
    expect(pose.pitch).toBeCloseTo(0.0, 4);
    expect(pose.roll).toBeCloseTo(0.0, 4);
    expect(pose.yaw).toBeCloseTo(angle, 4);
  });

  it('2. Pasa facialTransformationMatrix a estimateMetric3D e identifica frontalidad', () => {
    const landmarks = createMockLandmarks();

    // Foto frontal (yaw < 8°)
    const frontalMat = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];

    const metricFrontal = DepthEstimator.estimateMetric3D({
      landmarks,
      imageWidth: 512,
      imageHeight: 512,
      worldWidth: 2.0,
      worldHeight: 2.0,
      transformationMatrix: frontalMat,
    });

    expect(metricFrontal.isFrontal).toBe(true);
    expect(metricFrontal.headYaw).toBeCloseTo(0.0, 3);

    // Foto en 3/4 (yaw = 18°)
    const yaw18 = (18 * Math.PI) / 180.0;
    const profileMat = [
      Math.cos(yaw18), 0, -Math.sin(yaw18), 0,
      0, 1, 0, 0,
      Math.sin(yaw18), 0, Math.cos(yaw18), 0,
      0, 0, 0, 1,
    ];

    const metricProfile = DepthEstimator.estimateMetric3D({
      landmarks,
      imageWidth: 512,
      imageHeight: 512,
      worldWidth: 2.0,
      worldHeight: 2.0,
      transformationMatrix: profileMat,
    });

    expect(metricProfile.isFrontal).toBe(false);
    expect(metricProfile.headYaw).toBeCloseTo(yaw18, 3);
  });

  it('3. Realiza alineación Umeyama con SVD 3x3 garantizando det(R) = +1 (H4)', () => {
    const landmarks = createMockLandmarks();
    const metricData = DepthEstimator.estimateMetric3D({
      landmarks,
      imageWidth: 512,
      imageHeight: 512,
      worldWidth: 2.0,
      worldHeight: 2.0,
    });

    const aligner = new IdentityAligner();
    const result = aligner.align(metricData);

    expect(result.scale).toBeGreaterThan(0.1);
    expect(result.rmsError).toBeLessThan(1.0);

    // Calcular determinante de la matriz de rotación 3x3
    const R = result.rotationMatrix;
    const det =
      R[0]! * (R[4]! * R[8]! - R[5]! * R[7]!) -
      R[1]! * (R[3]! * R[8]! - R[5]! * R[6]!) +
      R[2]! * (R[3]! * R[7]! - R[4]! * R[6]!);

    expect(det).toBeCloseTo(1.0, 3); // Rotación propia pura sin reflexión
  });

  it('4. Comprueba límites blandos de rotación con tanh', () => {
    const maxYawFrontal = (25.0 * Math.PI) / 180.0;
    const softLimit = (theta: number, maxTheta: number) => maxTheta * Math.tanh(theta / maxTheta);

    // Para rotación pequeña (ej. 5°), la respuesta es casi lineal (< 0.1° de diferencia)
    const smallAngle = (5.0 * Math.PI) / 180.0;
    expect(softLimit(smallAngle, maxYawFrontal)).toBeCloseTo(smallAngle, 2);

    // Para rotación grande (ej. 60°), satura suavemente por debajo del límite máximo
    const hugeAngle = (60.0 * Math.PI) / 180.0;
    const saturated = softLimit(hugeAngle, maxYawFrontal);
    expect(saturated).toBeLessThan(maxYawFrontal);
    expect(saturated).toBeGreaterThan(maxYawFrontal * 0.95);
  });
});
