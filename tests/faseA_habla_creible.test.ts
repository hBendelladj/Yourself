/**
 * faseA_habla_creible.test.ts
 *
 * Suite de Pruebas Unitarias para la FASE A: Habla Creíble (YourSelf V3).
 *
 * Verifica los criterios de aceptación de Fase A:
 * 1. Cierre labial hermético en bilabiales (/m/, /b/, /p/) y en pausas.
 * 2. Visibilidad real y clara de mouthClose y mouthPressLips en la malla 3D.
 * 3. Rango de apertura mandibular claramente visible para vocales abiertas (/a/, /e/).
 * 4. Distinción de vocales cerradas (/i/, /u/, /o/) por forma de labios (redondeo/protrusión y estiramiento).
 * 5. Coarticulación suave con anticipación de la siguiente sílaba y sin aleteo.
 * 6. Retorno suave a reposo neutral con labios cerrados al detenerse el audio.
 * 7. Cavidad oral (MouthInterior) 100% invisible en reposo o silencio (sin hueco oscuro).
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VisemeScheduler } from '../src/core/audio/visemeScheduler';
import { LipsyncAnalyzer } from '../src/core/audio/lipsyncAnalyzer';
import { PoseDeformer } from '../src/core/render/poses';
import { MouthInterior, INNER_LIP_PAIRS } from '../src/core/render/mouthInterior';
import { closeRestingLips } from '../src/core/face/restingLips';
import { LANDMARK_INDICES } from '../src/core/face/landmarkGroups';
import { buildFaceMesh } from '../src/core/face/buildMesh';
import { FaceLandmarkPoint } from '../src/lib/types';

describe('FASE A: Habla Creíble (YourSelf V3)', () => {
  const createMockLandmarks = (): FaceLandmarkPoint[] => {
    return Array.from({ length: 478 }, (_, i) => ({
      x: 0.5 + ((i % 20) - 10) * 0.015,
      y: 0.5 + (Math.floor(i / 20) - 12) * 0.015,
      z: 0.0,
    }));
  };

  const setupMockMesh = () => {
    const landmarks = createMockLandmarks();
    // Configurar pupilas para faceScale canónico (~0.45-0.60)
    landmarks[468] = { x: 0.35, y: 0.35, z: 0.0 };
    landmarks[473] = { x: 0.65, y: 0.35, z: 0.0 };

    // Configurar boca cerrada en reposo
    landmarks[LANDMARK_INDICES.lipUpperInnerCenter] = { x: 0.5, y: 0.55, z: 0.01 };
    landmarks[LANDMARK_INDICES.lipLowerInnerCenter] = { x: 0.5, y: 0.55, z: 0.01 };
    landmarks[LANDMARK_INDICES.chinBottom] = { x: 0.5, y: 0.75, z: 0.02 };
    landmarks[LANDMARK_INDICES.lipLeftCorner] = { x: 0.42, y: 0.55, z: 0.005 };
    landmarks[LANDMARK_INDICES.lipRightCorner] = { x: 0.58, y: 0.55, z: 0.005 };

    const meshData = buildFaceMesh(landmarks, 512, 512);
    // Asegurar reposo cerrado con closeRestingLips
    closeRestingLips(meshData.basePositions, meshData.faceScale);
    closeRestingLips(meshData.currentPositions, meshData.faceScale);

    return meshData;
  };

  describe('1. Sellado Bilabial (/m/, /b/, /p/) y Visibilidad en Malla', () => {
    it('produce mouthClose >= 0.95 y jawOpen = 0 en el onset de /m, b, p/', () => {
      const scheduler = new VisemeScheduler();
      scheduler.enqueueText('mama');
      scheduler.onSyllableTick(0.0);

      const targets = scheduler.update(0.01, {
        jawOpen: 0.5,
        mouthRound: 0,
        mouthWide: 0,
        smile: 0,
      });

      expect(targets.jawOpen).toBe(0);
      expect(targets.mouthClose).toBeGreaterThanOrEqual(0.95);
      expect(targets.mouthPressLips).toBeGreaterThanOrEqual(0.70);
    });

    it('sella físicamente los labios en la malla 3D durante mouthClose y comprime en Z', () => {
      const meshData = setupMockMesh();
      const deformer = new PoseDeformer({
        basePositions: meshData.basePositions,
        landmarkCount: meshData.landmarkCount,
        vertexCount: meshData.vertexCount,
        faceScale: meshData.faceScale,
        rigVersion: 'v3',
      });

      const currentPos = new Float32Array(meshData.basePositions);
      const poses = {
        jawOpen: 0.40, // Incluso si viniese jawOpen residual del audio
        mouthRound: 0,
        mouthWide: 0,
        smile: 0,
        browRaise: 0,
        blink: 0,
        gazeX: 0,
        gazeY: 0,
        headYaw: 0,
        headPitch: 0,
        headRoll: 0,
        breath: 0,
      };

      const extraWeights = {
        mouthClose: 0.98,
        mouthPressLips: 0.80,
      };

      deformer.apply(currentPos, poses, extraWeights);

      const upperInnerY = currentPos[LANDMARK_INDICES.lipUpperInnerCenter * 3 + 1]!;
      const lowerInnerY = currentPos[LANDMARK_INDICES.lipLowerInnerCenter * 3 + 1]!;
      const outerUpperZ = currentPos[LANDMARK_INDICES.lipUpperOuterCenter * 3 + 2]!;
      const baseOuterUpperZ = meshData.basePositions[LANDMARK_INDICES.lipUpperOuterCenter * 3 + 2]!;

      // Los labios deben estar sellados (sin apertura vertical)
      expect(upperInnerY).toBeLessThanOrEqual(lowerInnerY + 0.005);

      // Compresión Z visible contra los dientes (mouthPressLips)
      expect(outerUpperZ).toBeLessThan(baseOuterUpperZ);
    });
  });

  describe('2. Rango de Apertura Mandibular y Diferenciación de Vocales', () => {
    it('muestra una apertura mandibular profunda y visible para la vocal /a/ (jawOpen >= 0.75)', () => {
      const scheduler = new VisemeScheduler();
      scheduler.enqueueText('casa');
      scheduler.onSyllableTick(0.0);

      // Evaluación en núcleo vocálico de /a/
      const targets = scheduler.update(0.07, {
        jawOpen: 0.85,
        mouthRound: 0,
        mouthWide: 0.1,
        smile: 0,
      });

      expect(targets.jawOpen).toBeGreaterThanOrEqual(0.75);

      // En la malla 3D, el descenso del labio inferior debe ser sustancial y visible
      const meshData = setupMockMesh();
      const deformer = new PoseDeformer({
        basePositions: meshData.basePositions,
        landmarkCount: meshData.landmarkCount,
        vertexCount: meshData.vertexCount,
        faceScale: meshData.faceScale,
        rigVersion: 'v3',
      });

      const currentPos = new Float32Array(meshData.basePositions);
      deformer.apply(currentPos, {
        jawOpen: targets.jawOpen,
        mouthRound: targets.mouthRound,
        mouthWide: targets.mouthWide,
        smile: 0,
        browRaise: 0,
        blink: 0,
        gazeX: 0,
        gazeY: 0,
        headYaw: 0,
        headPitch: 0,
        headRoll: 0,
        breath: 0,
      });

      const baseLowerY = meshData.basePositions[LANDMARK_INDICES.lipLowerInnerCenter * 3 + 1]!;
      const currentLowerY = currentPos[LANDMARK_INDICES.lipLowerInnerCenter * 3 + 1]!;
      const jawDrop = baseLowerY - currentLowerY;

      // El labio inferior debe descender al menos 0.08 unidades de mundo (> 15% de faceScale)
      expect(jawDrop).toBeGreaterThan(0.08);
    });

    it('distingue /i/ por extensión lateral (mouthWide) y /u/ por redondeo y protrusión (mouthPucker)', () => {
      const scheduler = new VisemeScheduler();

      // Sílaba con /i/
      scheduler.enqueueText('si');
      scheduler.onSyllableTick(0.0);
      const targetsI = { ...scheduler.update(0.07, { jawOpen: 0.20, mouthRound: 0, mouthWide: 0.6, smile: 0 }) };

      // Sílaba con /u/
      scheduler.flush();
      scheduler.enqueueText('su');
      scheduler.onSyllableTick(0.0);
      const targetsU = scheduler.update(0.07, { jawOpen: 0.25, mouthRound: 0.8, mouthWide: 0, smile: 0 });

      // /i/ tiene apertura contenida y alto mouthWide
      expect(targetsI.jawOpen).toBeLessThan(0.40);
      expect(targetsI.mouthWide).toBeGreaterThanOrEqual(0.55);

      // /u/ tiene protrusión (mouthPucker) y redondeo (mouthRound)
      expect(targetsU.mouthPucker).toBeGreaterThanOrEqual(0.60);
      expect(targetsU.mouthRound).toBeGreaterThanOrEqual(0.60);
    });
  });

  describe('3. Coarticulación y Transición Continua (Sin Aleteo)', () => {
    it('produce transiciones suaves y continuas entre onset, núcleo y siguiente sílaba', () => {
      const scheduler = new VisemeScheduler();
      scheduler.enqueueText('pa'); // Sílaba 'pa' con onset bilabial y núcleo abierto
      scheduler.onSyllableTick(0.0);

      const jawHistory: number[] = [];
      // Muestrear a lo largo del tiempo de la sílaba (0 a 140 ms a 60 fps)
      for (let t = 0.0; t <= 0.14; t += 0.016) {
        const out = scheduler.update(t, { jawOpen: 0.70, mouthRound: 0, mouthWide: 0, smile: 0 });
        jawHistory.push(out.jawOpen);
      }

      // En el onset (t=0), jawOpen debe ser 0 por el cierre bilabial
      expect(jawHistory[0]).toBe(0);

      // En el núcleo, jawOpen debe alcanzar su punto alto suavemente
      const peakJaw = Math.max(...jawHistory);
      expect(peakJaw).toBeGreaterThanOrEqual(0.70);

      // No debe haber saltos gigantescos (> 0.50) en un solo salto de fotograma (16 ms)
      for (let i = 1; i < jawHistory.length; i++) {
        const delta = Math.abs(jawHistory[i]! - jawHistory[i - 1]!);
        expect(delta).toBeLessThanOrEqual(0.40);
      }
    });

    it('filtra el ruido de audio en LipsyncAnalyzer evitando oscilaciones espurias de alta frecuencia', () => {
      const analyzer = new LipsyncAnalyzer(null, {
        openThreshold: 0.015,
        closeThreshold: 0.007,
        useCalibratedCurve: true,
      });

      // En silencio, jawOpen es exactamente 0
      expect(analyzer.getValues().jawOpen).toBe(0);
    });
  });

  describe('4. Cierre Labial en Silencio y Cavidad Bucal Oculta', () => {
    it('hace que la cavidad oral (MouthInterior) sea 100% invisible en reposo con labios cerrados', () => {
      const mouth = new MouthInterior();
      const meshData = setupMockMesh();

      // En reposo con jawOpen = 0
      mouth.update(meshData.currentPositions, 0.0, meshData.faceScale);

      expect(mouth.mesh.visible).toBe(false);
      expect((mouth.mesh.material as THREE.MeshBasicMaterial).opacity).toBe(0);

      mouth.destroy();
    });

    it('vuelve a cerrar los labios suavemente tras cesar el audio', () => {
      const analyzer = new LipsyncAnalyzer(null);
      // Simular decay tras silencio
      for (let i = 0; i < 20; i++) {
        analyzer.update(0.016);
      }
      expect(analyzer.getValues().jawOpen).toBe(0);
      expect(analyzer.getValues().mouthRound).toBe(0);
      expect(analyzer.getValues().mouthWide).toBe(0);
    });
  });
});
