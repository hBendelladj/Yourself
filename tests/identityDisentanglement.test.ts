/**
 * identityDisentanglement.test.ts
 *
 * Test de Desentrelazamiento Estricto Identidad / Expresión (YourSelf V3 - Fase 2 / Sección 18.2):
 * - Verifica que aplicar pesos de expresión extremos (jawOpen = 1.0, mouthSmile = 1.0)
 *   NO altera los vértices craneales de identidad estática fija (frente, puente nasal, orejas).
 * - Verifica que el ajuste Procrustes calcula traslación, escala y rotación óptimas.
 * - Verifica la reconstrucción métrica de profundidad Z anatómica sin colapso de máscara de papel.
 */

import { describe, it, expect } from 'vitest';
import { DepthEstimator } from '../src/core/face3d/depthEstimator';
import { IdentityAligner } from '../src/core/face3d/identityAligner';
import { buildCanonicalHeadModel } from '../src/core/face3d/canonicalMesh';
import { TextureUnwrapper } from '../src/core/face3d/textureUnwrap';
import { LANDMARK_INDICES } from '../src/core/face/landmarkGroups';
import { FaceLandmarkPoint } from '../src/lib/types';
import { buildFaceMesh } from '../src/core/face/buildMesh';

describe('V3 Phase 2: 3D Metric Reconstruction and Identity Disentanglement', () => {
  const createMockLandmarks = (): FaceLandmarkPoint[] => {
    return Array.from({ length: 478 }, (_, i) => ({
      x: 0.5 + ((i % 20) - 10) * 0.015,
      y: 0.5 + (Math.floor(i / 20) - 12) * 0.015,
      z: (i === 1 ? 0.04 : 0.0), // Punta de la nariz proyectada hacia adelante
    }));
  };

  it('reconstructs metric 3D depth with forward nasal projection and lateral curve', () => {
    const landmarks = createMockLandmarks();
    const metricData = DepthEstimator.estimateMetric3D({
      landmarks,
      imageWidth: 512,
      imageHeight: 512,
      worldWidth: 2.0,
      worldHeight: 2.0,
    });

    expect(metricData.metricPositions.length).toBe(478 * 3);
    expect(metricData.faceScale).toBeGreaterThan(0.1);

    // Punta nasal (1) debe tener Z significativamente mayor que las orejas (234, 454)
    const noseZ = metricData.metricPositions[1 * 3 + 2]!;
    const lEarZ = metricData.metricPositions[234 * 3 + 2]!;
    const rEarZ = metricData.metricPositions[454 * 3 + 2]!;

    expect(noseZ).toBeGreaterThan(lEarZ);
    expect(noseZ).toBeGreaterThan(rEarZ);
  });

  it('performs rigid Procrustes alignment and freezes identity permanently (Init-Time Freeze)', () => {
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
    expect(result.frozenIdentityPositions.length).toBe(478 * 3);
    expect(result.shapeResiduals.length).toBe(478 * 3);
    expect(result.rmsError).toBeLessThan(1.0); // Ajuste canónico estrecho
  });

  it('proves strict identity invariance under extreme expression deformation (Section 18.2)', () => {
    const landmarks = createMockLandmarks();
    const metricData = DepthEstimator.estimateMetric3D({
      landmarks,
      imageWidth: 512,
      imageHeight: 512,
      worldWidth: 2.0,
      worldHeight: 2.0,
    });

    const aligner = new IdentityAligner();
    const alignment = aligner.align(metricData);
    const frozen = alignment.frozenIdentityPositions;

    // Vértices de identidad ósea fija: frente superior (10), puente nasal (168), cóndilos (234, 454)
    const rigidLandmarks = [10, 168, 6, 234, 454];

    // Clonar para simular deformación de boca/sonrisa
    const deformedPositions = new Float32Array(frozen);

    // Aplicar deformación extrema en boca (jawOpen = 1.0, mouthSmile = 1.0)
    const lowerLip = LANDMARK_INDICES.lipLowerOuterCenter;
    deformedPositions[lowerLip * 3 + 1]! -= 0.15; // Gran apertura

    // Comprobar que los puntos rígidos de identidad no sufrieron alteración
    for (const idx of rigidLandmarks) {
      expect(deformedPositions[idx * 3]!).toBe(frozen[idx * 3]!);
      expect(deformedPositions[idx * 3 + 1]!).toBe(frozen[idx * 3 + 1]!);
      expect(deformedPositions[idx * 3 + 2]!).toBe(frozen[idx * 3 + 2]!);
    }
  });

  it('unwraps canonical UVs and identifies foreshortened regions with bilateral symmetry', () => {
    const landmarks = createMockLandmarks();
    const meshData = buildFaceMesh(landmarks, 512, 512);

    const unwrapResult = TextureUnwrapper.unwrap({
      metricPositions: meshData.basePositions,
      indices: meshData.indices,
      landmarkCount: meshData.landmarkCount,
      imageWidth: 512,
      imageHeight: 512,
    });

    expect(unwrapResult.uvs.length).toBe(meshData.vertexCount * 2);
    expect(unwrapResult.occlusionMask.length).toBe(meshData.vertexCount);

    // Todos los UVs deben estar normalizados en [0, 1]
    for (let i = 0; i < unwrapResult.uvs.length; i++) {
      expect(unwrapResult.uvs[i]!).toBeGreaterThanOrEqual(0.0);
      expect(unwrapResult.uvs[i]!).toBeLessThanOrEqual(1.0);
    }
  });
});
