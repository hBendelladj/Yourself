/**
 * restingLips.test.ts
 *
 * Pruebas unitarias para el cierre de labios en reposo neutral (YourSelf V3).
 */

import { describe, it, expect } from 'vitest';
import { closeRestingLips } from '../src/core/face/restingLips';
import { INNER_LIP_PAIRS } from '../src/core/render/mouthInterior';
import { LANDMARK_INDICES } from '../src/core/face/landmarkGroups';

describe('closeRestingLips: Reposo Neutral con Labios Cerrados', () => {
  const faceScale = 0.45;

  const createMockPositions = (partedGap = 0.035): Float32Array => {
    const pos = new Float32Array(500 * 3);
    // Configurar coordenadas base sintéticas
    for (let i = 0; i < 500; i++) {
      pos[i * 3] = ((i % 20) - 10) * 0.02;
      pos[i * 3 + 1] = (Math.floor(i / 20) - 12) * 0.02;
      pos[i * 3 + 2] = 0.0;
    }

    // Configurar mentón
    pos[LANDMARK_INDICES.chinBottom * 3 + 1] = -0.35;

    // Configurar labios interiores con separación partedGap
    const stomionY = -0.05;
    for (let i = 0; i < INNER_LIP_PAIRS.length; i++) {
      const [uIdx, lIdx] = INNER_LIP_PAIRS[i]!;
      const x = ((i - 5) / 5) * 0.08;
      pos[uIdx * 3] = x;
      pos[lIdx * 3] = x;

      // Labio superior arriba, labio inferior abajo
      pos[uIdx * 3 + 1] = stomionY + (partedGap * faceScale * 0.5);
      pos[lIdx * 3 + 1] = stomionY - (partedGap * faceScale * 0.5);

      pos[uIdx * 3 + 2] = 0.02;
      pos[lIdx * 3 + 2] = 0.015;
    }

    return pos;
  };

  it('preserva las posiciones intactas cuando los labios ya están cerrados', () => {
    const pos = createMockPositions(0.001); // gap inferior a 0.004
    const clone = new Float32Array(pos);

    const result = closeRestingLips(pos, faceScale);
    expect(result.wasParted).toBe(false);
    expect(result.closedGap).toBeLessThanOrEqual(0.004);

    for (let i = 0; i < pos.length; i++) {
      expect(pos[i]).toBe(clone[i]);
    }
  });

  it('cierra completamente los labios cuando la foto viene con boca abierta o entreabierta', () => {
    const initialGap = 0.040;
    const pos = createMockPositions(initialGap);

    const result = closeRestingLips(pos, faceScale);
    expect(result.wasParted).toBe(true);
    expect(result.originalGap).toBeCloseTo(initialGap, 2);
    expect(result.closedGap).toBeLessThan(0.001);

    // Verificar que cada par de labios interiores ahora coincida exactamente en Y
    for (let i = 0; i < INNER_LIP_PAIRS.length; i++) {
      const [uIdx, lIdx] = INNER_LIP_PAIRS[i]!;
      const uy = pos[uIdx * 3 + 1]!;
      const ly = pos[lIdx * 3 + 1]!;
      expect(Math.abs(uy - ly)).toBeLessThan(1e-5);
    }
  });

  it('garantiza que el gap resultante esté por debajo del umbral deadband g0 (0.004)', () => {
    const pos = createMockPositions(0.060);
    const result = closeRestingLips(pos, faceScale);

    expect(result.closedGap).toBeLessThan(0.004);
  });

  it('es estrictamente idempotente: una segunda llamada no produce cambios', () => {
    const pos = createMockPositions(0.035);
    closeRestingLips(pos, faceScale);

    const firstPass = new Float32Array(pos);
    const secondResult = closeRestingLips(pos, faceScale);

    expect(secondResult.wasParted).toBe(false);
    for (let i = 0; i < pos.length; i++) {
      expect(pos[i]).toBe(firstPass[i]);
    }
  });

  it('no altera vértices fuera de la región peribucal (ojos, nariz, frente)', () => {
    const pos = createMockPositions(0.045);
    const eyeVertex = LANDMARK_INDICES.leftEyeCornerOuter;
    const noseVertex = LANDMARK_INDICES.noseTip;
    const foreheadVertex = LANDMARK_INDICES.foreheadCenter;

    const initialEyeY = pos[eyeVertex * 3 + 1]!;
    const initialNoseY = pos[noseVertex * 3 + 1]!;
    const initialForeheadY = pos[foreheadVertex * 3 + 1]!;

    closeRestingLips(pos, faceScale);

    expect(pos[eyeVertex * 3 + 1]).toBe(initialEyeY);
    expect(pos[noseVertex * 3 + 1]).toBe(initialNoseY);
    expect(pos[foreheadVertex * 3 + 1]).toBe(initialForeheadY);
  });
});
