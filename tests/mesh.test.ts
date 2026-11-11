import { describe, it, expect } from 'vitest';
import { buildFaceMesh, BORDER_ANCHORS } from '../src/core/face/buildMesh';
import { LANDMARK_INDICES, LIPS_INNER_SET, EYES_SET } from '../src/core/face/landmarkGroups';
import { FaceLandmarkPoint } from '../src/lib/types';

describe('Face Mesh Construction and Triangulation', () => {
  // Generar 478 landmarks faciales sintéticos normalizados dentro del rostro [0.2, 0.8]
  const mockLandmarks: FaceLandmarkPoint[] = Array.from({ length: 478 }, (_, i) => ({
    x: 0.2 + (i % 20) * 0.03,
    y: 0.2 + Math.floor(i / 20) * 0.025,
    z: (Math.sin(i) * 0.05),
  }));

  it('adds 16 fixed border anchors to the 478 face landmarks', () => {
    expect(BORDER_ANCHORS.length).toBe(16);

    const meshData = buildFaceMesh(mockLandmarks, 600, 600);
    expect(meshData.landmarkCount).toBe(478);
    expect(meshData.anchorCount).toBe(16);
    expect(meshData.vertexCount).toBe(494);
    expect(meshData.anchorStartIndex).toBe(478);
  });

  it('performs Delaunay triangulation returning valid triangles', () => {
    const meshData = buildFaceMesh(mockLandmarks, 800, 600);

    expect(meshData.indices.length).toBeGreaterThan(0);
    // Cada triángulo debe tener exactamente 3 índices
    expect(meshData.indices.length % 3).toBe(0);

    // Todos los índices deben estar dentro del rango [0, vertexCount - 1]
    for (let i = 0; i < meshData.indices.length; i++) {
      const idx = meshData.indices[i]!;
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(meshData.vertexCount);
    }
  });

  it('generates valid UV coordinates normalized in [0, 1]', () => {
    const meshData = buildFaceMesh(mockLandmarks, 512, 512);

    expect(meshData.uvs.length).toBe(meshData.vertexCount * 2);

    for (let i = 0; i < meshData.vertexCount; i++) {
      const u = meshData.uvs[i * 2]!;
      const v = meshData.uvs[i * 2 + 1]!;

      expect(u).toBeGreaterThanOrEqual(0.0);
      expect(u).toBeLessThanOrEqual(1.0);
      expect(v).toBeGreaterThanOrEqual(0.0);
      expect(v).toBeLessThanOrEqual(1.0);
    }
  });

  it('preserves aspect ratio in world coordinates', () => {
    const meshSquare = buildFaceMesh(mockLandmarks, 500, 500);
    expect(meshSquare.aspectRatio).toBeCloseTo(1.0);
    expect(meshSquare.worldWidth).toBeCloseTo(2.0);
    expect(meshSquare.worldHeight).toBeCloseTo(2.0);

    const meshLandscape = buildFaceMesh(mockLandmarks, 1000, 500);
    expect(meshLandscape.aspectRatio).toBeCloseTo(2.0);
    expect(meshLandscape.worldWidth).toBeCloseTo(2.0);
    expect(meshLandscape.worldHeight).toBeCloseTo(1.0);
  });

  it('contains valid canonical indices in landmarkGroups', () => {
    expect(LANDMARK_INDICES.chinBottom).toBe(152);
    expect(LANDMARK_INDICES.lipLeftCorner).toBe(61);
    expect(LANDMARK_INDICES.lipRightCorner).toBe(291);
    expect(LANDMARK_INDICES.lipUpperInnerCenter).toBe(13);
    expect(LANDMARK_INDICES.lipLowerInnerCenter).toBe(14);

    expect(LIPS_INNER_SET.has(13)).toBe(true);
    expect(LIPS_INNER_SET.has(14)).toBe(true);
    expect(EYES_SET.has(468)).toBe(true);
    expect(EYES_SET.has(473)).toBe(true);
  });
});
