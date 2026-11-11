/**
 * v4_phase2.test.ts
 *
 * Pruebas de aceptación Fase 2 (YourSelf V4):
 * Criterio 1: Bisagra mandibular: con jawOpen=1 (theta=theta_max) el mentón desciende r * sin(theta) ± 5%;
 *             con jawOpen=0 la foto queda idéntica (RMSE de posiciones = 0).
 * Criterio 2: Calibración: con jaw=0.3 la apertura interior / W se sitúa entre 0.07 y 0.10.
 * Retargeting en lazo cerrado: Newton-Raphson para EAR y c_lip.
 */

import { describe, it, expect } from 'vitest';
import { buildFaceMesh } from '@/core/face/buildMesh';
import { JawBone } from '@/core/rig/jawBone';
import { ClosedLoopRetargeter } from '@/core/rig/closedLoop';
import { LANDMARK_INDICES } from '@/core/face/landmarkGroups';
import { FaceLandmarkPoint } from '@/lib/types';

describe('V4 Fase 2: Mandíbula Hueso y Control en Lazo Cerrado', () => {
  const createMockLandmarks = (): FaceLandmarkPoint[] => {
    return Array.from({ length: 478 }, (_, i) => {
      // Coordenadas antropométricas sintéticas realistas
      let x = 0.5 + ((i % 20) - 10) * 0.018;
      let y = 0.45 + (Math.floor(i / 20) - 12) * 0.022;

      // Puntos anatómicos específicos
      if (i === 234) { x = 0.25; y = 0.50; } // Cóndilo izquierdo
      if (i === 454) { x = 0.75; y = 0.50; } // Cóndilo derecho
      if (i === LANDMARK_INDICES.chinBottom) { x = 0.50; y = 0.85; } // Mentón (152)
      if (i === LANDMARK_INDICES.lipUpperInnerCenter) { x = 0.50; y = 0.65; } // L13
      if (i === LANDMARK_INDICES.lipLowerInnerCenter) { x = 0.50; y = 0.652; } // L14
      if (i === LANDMARK_INDICES.lipLeftCorner) { x = 0.40; y = 0.65; } // L61
      if (i === LANDMARK_INDICES.lipRightCorner) { x = 0.60; y = 0.65; } // L291

      return { x, y, z: 0.0 };
    });
  };

  it('1. Criterio de Aceptación 1: Bisagra condilar a jawOpen=1 y reposo jawOpen=0', () => {
    const landmarks = createMockLandmarks();
    const mesh = buildFaceMesh(landmarks, 512, 512);

    const jawBone = new JawBone({
      basePositions: mesh.basePositions,
      landmarkCount: mesh.landmarkCount,
      vertexCount: mesh.vertexCount,
      indices: mesh.indices,
      faceScale: mesh.faceScale,
    });

    const outPositions = new Float32Array(mesh.basePositions);

    // 1.1 Con jawOpen = 0 -> foto idéntica (RMSE = 0)
    jawBone.apply(0.0, mesh.basePositions, outPositions);
    let diffSqSum = 0;
    for (let i = 0; i < outPositions.length; i++) {
      const d = outPositions[i]! - mesh.basePositions[i]!;
      diffSqSum += d * d;
    }
    const rmse = Math.sqrt(diffSqSum / outPositions.length);
    expect(rmse).toBe(0.0);

    // 1.2 Con jawOpen = 1.0 -> el mentón desciende r * sin(theta_max) ± 5%
    jawBone.apply(1.0, mesh.basePositions, outPositions);

    const chinIdx = LANDMARK_INDICES.chinBottom * 3;
    const initialChinY = mesh.basePositions[chinIdx + 1]!;
    const finalChinY = outPositions[chinIdx + 1]!;
    const chinDescent = initialChinY - finalChinY; // Descenso hacia abajo (en Three.js +Y es arriba)

    const expectedDescent = jawBone.leverRadius * Math.sin(jawBone.thetaMax);
    const relDiff = Math.abs(chinDescent - expectedDescent) / expectedDescent;

    expect(relDiff).toBeLessThanOrEqual(0.05); // ± 5% estricto
    expect(chinDescent).toBeGreaterThan(0.0);
  });

  it('2. Criterio de Aceptación 2: Calibración a jawOpen=0.3 (apertura interior / W en [0.07, 0.10])', () => {
    const landmarks = createMockLandmarks();
    const mesh = buildFaceMesh(landmarks, 512, 512);

    const jawBone = new JawBone({
      basePositions: mesh.basePositions,
      landmarkCount: mesh.landmarkCount,
      vertexCount: mesh.vertexCount,
      indices: mesh.indices,
      faceScale: mesh.faceScale,
    });

    const outPositions = new Float32Array(mesh.basePositions);
    jawBone.apply(0.3, mesh.basePositions, outPositions);

    const u13 = LANDMARK_INDICES.lipUpperInnerCenter * 3;
    const l14 = LANDMARK_INDICES.lipLowerInnerCenter * 3;

    const interiorGap = Math.hypot(
      outPositions[u13]! - outPositions[l14]!,
      outPositions[u13 + 1]! - outPositions[l14 + 1]!,
      outPositions[u13 + 2]! - outPositions[l14 + 2]!
    );

    const gapRatio = interiorGap / jawBone.faceWidth;

    // Criterio 2: gapRatio debe situarse entre 0.07 y 0.10
    expect(gapRatio).toBeGreaterThanOrEqual(0.07);
    expect(gapRatio).toBeLessThanOrEqual(0.10);
  });

  it('3. ClosedLoopRetargeter: resuelve iteración de Newton para parpadeo y apertura labial', () => {
    const landmarks = createMockLandmarks();
    const mesh = buildFaceMesh(landmarks, 512, 512);

    const retargeter = new ClosedLoopRetargeter(
      mesh.basePositions,
      mesh.landmarkCount,
      mesh.faceScale
    );

    const cal = retargeter.getCalibration();
    expect(cal.restingEarLeft).toBeGreaterThan(0.1);
    expect(cal.dEarDblinkLeft).toBeLessThan(0.0); // Al parpadear EAR disminuye
    expect(cal.dLipGapDjaw).toBeGreaterThan(0.0); // Al abrir mandíbula c_lip aumenta

    // Test de convergencia de Newton para objetivo de apertura labial
    const targetGap = 0.08;
    const solvedW = retargeter.solveJawWeight(targetGap, mesh.basePositions, 0.3);
    expect(solvedW).toBeGreaterThan(0.0);
    expect(solvedW).toBeLessThanOrEqual(1.0);
  });
});
