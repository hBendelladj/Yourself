/**
 * v4_phase3.test.ts
 *
 * Pruebas de aceptación Fase 3 (YourSelf V4):
 * Criterio 6: Rotación cefálica multicapa y conservación de malla:
 *   - Para yaw ±20° y pitch ±12°:
 *     1. Cero triángulos invertidos en el rostro (área signada > 0).
 *     2. Estiramiento máximo de bordes / textura <= 2.5x respecto al reposo.
 *     3. Relleno push-pull inpainting: elimina por completo los huecos sin cubrir (0 píxeles vacíos).
 *   - Ponderación multicapa: face 1.0, hair 0.95, neck 0.50, shoulders 0.15, background 0.0.
 */

import { describe, it, expect } from 'vitest';
import { buildFaceMesh } from '@/core/face/buildMesh';
import { HeadLayers, LAYER_ROTATION_WEIGHTS } from '@/core/face3d/layers';
import { pushPullInpaint } from '@/core/face3d/inpaint.worker';
import { FaceLandmarkPoint } from '@/lib/types';

describe('V4 Fase 3: Capas 3D del Cabello/Cuello/Fondo e Inpainting', () => {
  const createMockLandmarks = (): FaceLandmarkPoint[] => {
    return Array.from({ length: 478 }, (_, i) => {
      const x = 0.5 + ((i % 20) - 10) * 0.016;
      const y = 0.45 + (Math.floor(i / 20) - 12) * 0.020;
      return { x, y, z: i === 1 ? 0.03 : 0.0 };
    });
  };

  it('1. Asigna ponderaciones biomecánicas correctas a las capas anatómicas', () => {
    const landmarks = createMockLandmarks();
    const mesh = buildFaceMesh(landmarks, 512, 512);

    const layers = new HeadLayers({
      basePositions: mesh.basePositions,
      landmarkCount: mesh.landmarkCount,
      vertexCount: mesh.vertexCount,
      faceScale: mesh.faceScale,
      worldWidth: mesh.worldWidth,
      worldHeight: mesh.worldHeight,
    });

    expect(layers.layerWeights.length).toBe(mesh.vertexCount);

    // Vértices faciales centrales (nariz tip = 1) -> peso 1.0
    expect(layers.layerWeights[1]).toBe(LAYER_ROTATION_WEIGHTS.face);

    // Anclas periféricas exteriores del fondo -> peso 0.0
    const lastAnchor = mesh.vertexCount - 1;
    expect(layers.layerWeights[lastAnchor]).toBeLessThanOrEqual(LAYER_ROTATION_WEIGHTS.shoulders);
  });

  it('2. Criterio de Aceptación 6: Sin triángulos invertidos ni estiramiento > 2.5x en yaw ±20° y pitch ±12°', () => {
    const landmarks = createMockLandmarks();
    const mesh = buildFaceMesh(landmarks, 512, 512);

    const layers = new HeadLayers({
      basePositions: mesh.basePositions,
      landmarkCount: mesh.landmarkCount,
      vertexCount: mesh.vertexCount,
      faceScale: mesh.faceScale,
      worldWidth: mesh.worldWidth,
      worldHeight: mesh.worldHeight,
    });

    const testPoses = [
      { yaw: (20 * Math.PI) / 180, pitch: (12 * Math.PI) / 180 },
      { yaw: (-20 * Math.PI) / 180, pitch: (12 * Math.PI) / 180 },
      { yaw: (20 * Math.PI) / 180, pitch: (-12 * Math.PI) / 180 },
      { yaw: (-20 * Math.PI) / 180, pitch: (-12 * Math.PI) / 180 },
    ];

    for (const pose of testPoses) {
      const pos = new Float32Array(mesh.basePositions);
      layers.applyLayeredRotation(pos, pose.yaw, pose.pitch, 0.0);

      // 2.1 Verificar que no hay triángulos invertidos en la región facial (área signada 2D > 0)
      const indices = mesh.indices;
      let invertedTriangles = 0;
      let maxStretch = 1.0;

      for (let t = 0; t < indices.length; t += 3) {
        const i0 = indices[t]!;
        const i1 = indices[t + 1]!;
        const i2 = indices[t + 2]!;

        // Solo evaluar triángulos dentro de los landmarks faciales
        if (i0 >= mesh.landmarkCount || i1 >= mesh.landmarkCount || i2 >= mesh.landmarkCount) {
          continue;
        }

        // Área en reposo
        const bx0 = mesh.basePositions[i0 * 3]!, by0 = mesh.basePositions[i0 * 3 + 1]!;
        const bx1 = mesh.basePositions[i1 * 3]!, by1 = mesh.basePositions[i1 * 3 + 1]!;
        const bx2 = mesh.basePositions[i2 * 3]!, by2 = mesh.basePositions[i2 * 3 + 2]!;
        const baseArea = (bx1 - bx0) * (by2 - by0) - (by1 - by0) * (bx2 - bx0);

        // Área tras rotación
        const px0 = pos[i0 * 3]!, py0 = pos[i0 * 3 + 1]!;
        const px1 = pos[i1 * 3]!, py1 = pos[i1 * 3 + 1]!;
        const px2 = pos[i2 * 3]!, py2 = pos[i2 * 3 + 1]!;
        const rotatedArea = (px1 - px0) * (py2 - py0) - (py1 - py0) * (px2 - px0);

        // Si el triángulo original tenía orientación positiva, no debe invertirse
        if (baseArea > 1e-6 && rotatedArea < -1e-6) {
          invertedTriangles++;
        }

        // Medir estiramiento de aristas
        const baseEdge = Math.hypot(bx1 - bx0, by1 - by0);
        const rotEdge = Math.hypot(px1 - px0, py1 - py0);
        if (baseEdge > 1e-4) {
          const stretch = rotEdge / baseEdge;
          if (stretch > maxStretch) maxStretch = stretch;
        }
      }

      expect(invertedTriangles).toBe(0);
      expect(maxStretch).toBeLessThanOrEqual(2.5); // Criterio 6: estiramiento <= 2.5x
    }
  });

  it('3. Relleno de zonas descubiertas: Push-Pull inpainting elimina por completo los huecos', () => {
    const w = 32;
    const h = 32;
    const pixels = new Uint8ClampedArray(w * h * 4);
    const mask = new Uint8Array(w * h);

    // Fondo grisáceo conocido
    for (let i = 0; i < w * h; i++) {
      pixels[i * 4] = 120;
      pixels[i * 4 + 1] = 130;
      pixels[i * 4 + 2] = 140;
      pixels[i * 4 + 3] = 255;
      mask[i] = 1;
    }

    // Región descubierta / hueco en el cuadrante central (máscara = 0, alfa = 0)
    for (let y = 10; y < 22; y++) {
      for (let x = 10; x < 22; x++) {
        const idx = y * w + x;
        pixels[idx * 4] = 0;
        pixels[idx * 4 + 1] = 0;
        pixels[idx * 4 + 2] = 0;
        pixels[idx * 4 + 3] = 0;
        mask[idx] = 0;
      }
    }

    const filled = pushPullInpaint(pixels, mask, w, h);

    // Comprobar que en la región del hueco no quedan píxeles transparentes ni vacíos
    for (let y = 10; y < 22; y++) {
      for (let x = 10; x < 22; x++) {
        const idx = y * w + x;
        expect(filled[idx * 4 + 3]).toBe(255); // Alfa completo
        expect(filled[idx * 4]!).toBeGreaterThan(80); // Color coherente con el entorno
      }
    }
  });
});
