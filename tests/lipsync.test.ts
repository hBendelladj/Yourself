import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { LipsyncAnalyzer } from '../src/core/audio/lipsyncAnalyzer';
import { MouthInterior, INNER_LIP_PAIRS } from '../src/core/render/mouthInterior';
import { buildFaceMesh } from '../src/core/face/buildMesh';
import { LANDMARK_INDICES } from '../src/core/face/landmarkGroups';
import { FaceLandmarkPoint } from '../src/lib/types';

describe('Phase 5: Lip-sync Analyzer and Mouth Interior', () => {
  describe('INNER_LIP_PAIRS topology', () => {
    it('has exactly 11 paired landmarks between upper and lower lips', () => {
      expect(INNER_LIP_PAIRS.length).toBe(11);
    });

    it('anchors left corner at 78 and right corner at 308', () => {
      const firstPair = INNER_LIP_PAIRS[0]!;
      const lastPair = INNER_LIP_PAIRS[INNER_LIP_PAIRS.length - 1]!;

      expect(firstPair[0]).toBe(78);
      expect(firstPair[1]).toBe(78);

      expect(lastPair[0]).toBe(308);
      expect(lastPair[1]).toBe(308);
    });

    it('has central inner lip landmarks [13, 14] at center pair', () => {
      const centerPair = INNER_LIP_PAIRS[5]!;
      expect(centerPair[0]).toBe(LANDMARK_INDICES.lipUpperInnerCenter); // 13
      expect(centerPair[1]).toBe(LANDMARK_INDICES.lipLowerInnerCenter); // 14
    });
  });

  describe('LipsyncAnalyzer', () => {
    it('initializes in rest state with all viseme weights zero or minimal', () => {
      const analyzer = new LipsyncAnalyzer(null);
      const values = analyzer.getValues();

      expect(values.jawOpen).toBe(0);
      expect(values.mouthRound).toBe(0);
      expect(values.mouthWide).toBe(0);
    });

    it('decays smoothly when update() is called without active audio', () => {
      const analyzer = new LipsyncAnalyzer(null);
      const initial = analyzer.update(0.016);

      expect(initial.jawOpen).toBe(0);
      expect(initial.mouthRound).toBe(0);
      expect(initial.mouthWide).toBe(0);
    });

    it('resets all smoothed values back to zero on reset()', () => {
      const analyzer = new LipsyncAnalyzer(null);
      analyzer.reset();
      const values = analyzer.getValues();

      expect(values.jawOpen).toBe(0);
      expect(values.mouthRound).toBe(0);
      expect(values.mouthWide).toBe(0);
    });

    it('processes synthetic AnalyserNode with RMS audio signals', () => {
      // Mock AnalyserNode
      const timeDataBuffer = new Uint8Array(512);
      // Simular onda senoidal fuerte centrada en 128
      for (let i = 0; i < timeDataBuffer.length; i++) {
        timeDataBuffer[i] = Math.round(128 + Math.sin(i * 0.2) * 90);
      }

      const freqDataBuffer = new Uint8Array(256);
      // Simular energía en frecuencias medias/bajas
      for (let i = 1; i < 40; i++) {
        freqDataBuffer[i] = 180;
      }

      const mockAnalyser = {
        fftSize: 512,
        frequencyBinCount: 256,
        smoothingTimeConstant: 0.15,
        context: { sampleRate: 24000 },
        getByteTimeDomainData: vi.fn((arr: Uint8Array) => {
          arr.set(timeDataBuffer);
        }),
        getByteFrequencyData: vi.fn((arr: Uint8Array) => {
          arr.set(freqDataBuffer);
        }),
      } as unknown as AnalyserNode;

      const analyzer = new LipsyncAnalyzer(mockAnalyser);

      // Simular varios fotogramas de ataque rápido (~35 ms)
      analyzer.update(0.016);
      analyzer.update(0.016);
      const weights = analyzer.update(0.016);

      expect(weights.jawOpen).toBeGreaterThan(0.05);
      expect(weights.jawOpen).toBeLessThanOrEqual(1.0);
    });
  });

  describe('MouthInterior 3D Mesh', () => {
    it('creates BufferGeometry with 22 vertices and 60 triangle indices', () => {
      const mouth = new MouthInterior();
      const geom = mouth.mesh.geometry;

      const posAttr = geom.getAttribute('position');
      const uvAttr = geom.getAttribute('uv');
      const indexAttr = geom.getIndex();

      // 11 pares * 2 = 22 vértices
      expect(posAttr.count).toBe(22);
      expect(uvAttr.count).toBe(22);
      // 10 quads * 6 = 60 índices (20 triángulos)
      expect(indexAttr?.count).toBe(60);

      mouth.destroy();
    });

    it('keeps mouth interior hidden when jawOpen < 0.015', () => {
      const mouth = new MouthInterior();
      const mockPositions = new Float32Array(500 * 3);

      mouth.update(mockPositions, 0.0);
      expect(mouth.mesh.visible).toBe(false);

      mouth.update(mockPositions, 0.01);
      expect(mouth.mesh.visible).toBe(false);

      mouth.destroy();
    });

    it('reveals mouth interior smoothly when jawOpen >= 0.015', () => {
      const mouth = new MouthInterior();
      const mockPositions = new Float32Array(500 * 3);

      mouth.update(mockPositions, 0.08);
      expect(mouth.mesh.visible).toBe(true);
      expect((mouth.mesh.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0.4);

      mouth.destroy();
    });
  });

  describe('buildFaceMesh mouth aperture filtering', () => {
    it('filters triangles that bridge upper and lower inner lips when filterMouthHole is true', () => {
      // Landmarks donde el labio superior e inferior están cerca
      const mockLandmarks: FaceLandmarkPoint[] = Array.from({ length: 478 }, (_, i) => ({
        x: 0.5 + ((i % 15) - 7) * 0.02,
        y: 0.5 + (Math.floor(i / 15) - 15) * 0.02,
        z: 0,
      }));

      // Posicionar labios explícitamente en el mock
      mockLandmarks[13] = { x: 0.5, y: 0.55, z: 0 }; // Labio superior interior
      mockLandmarks[14] = { x: 0.5, y: 0.56, z: 0 }; // Labio inferior interior

      const meshData = buildFaceMesh(mockLandmarks, 512, 512, { filterMouthHole: true });

      // Verificar que ningún triángulo resultante conecte directamente 13 con 14
      let foundBridgingTriangle = false;
      const upperSet = new Set([185, 40, 39, 37, 0, 267, 269, 270, 409, 191, 80, 81, 82, 13, 312, 311, 310, 415]);
      const lowerSet = new Set([146, 91, 181, 84, 17, 314, 405, 321, 375, 95, 88, 178, 87, 14, 317, 402, 318, 324]);

      for (let t = 0; t < meshData.indices.length; t += 3) {
        const i0 = meshData.indices[t]!;
        const i1 = meshData.indices[t + 1]!;
        const i2 = meshData.indices[t + 2]!;

        const hasUpper = upperSet.has(i0) || upperSet.has(i1) || upperSet.has(i2);
        const hasLower = lowerSet.has(i0) || lowerSet.has(i1) || lowerSet.has(i2);

        if (hasUpper && hasLower) {
          foundBridgingTriangle = true;
          break;
        }
      }

      expect(foundBridgingTriangle).toBe(false);
    });

    it('preserves mouth triangles in V2 (filterMouthHole: false) keeping original photo intact', () => {
      const mockLandmarks: FaceLandmarkPoint[] = Array.from({ length: 478 }, (_, i) => ({
        x: 0.5 + ((i % 15) - 7) * 0.02,
        y: 0.5 + (Math.floor(i / 15) - 15) * 0.02,
        z: 0,
      }));
      mockLandmarks[13] = { x: 0.5, y: 0.55, z: 0 };
      mockLandmarks[14] = { x: 0.5, y: 0.56, z: 0 };

      const meshData = buildFaceMesh(mockLandmarks, 512, 512); // default filterMouthHole: false
      expect(meshData.faceScale).toBeGreaterThan(0);
      expect(meshData.indices.length).toBeGreaterThan(0);
    });
  });
});
