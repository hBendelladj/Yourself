/**
 * faseD_pulido_visual.test.ts
 *
 * Suite de Pruebas Unitarias para la FASE D: Pulido Visual (YourSelf V3).
 *
 * Criterios de aceptación verificados:
 * 1. Sombreado sutil que acompaña la rotación cefálica (yaw y pitch) sin alterar el tono de piel (RGB simétrico).
 * 2. Cierre hermético de labios en reposo neutral para fotos con boca abierta, entreabierta o sonrisa.
 * 3. Ausencia de deformaciones anómalas (pico en mentón o desgarros en comisuras):
 *    - Curvatura suave en arco en el descenso mandibular.
 *    - Desplazamiento distribuido en las comisuras y anillos adyacentes.
 * 4. Articulación conversacional procedimental automática al activar el modo 'Hablando' sin audio streaming.
 * 5. Control de calidad robusto con perfiles de fotos diversos:
 *    - Frontal, ligeramente girada, con sonrisa, con boca abierta y con gafas.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PseudoVolumeShading } from '../src/core/render/shading';
import { PoseDeformer } from '../src/core/render/poses';
import { MouthInterior, INNER_LIP_PAIRS } from '../src/core/render/mouthInterior';
import { closeRestingLips } from '../src/core/face/restingLips';
import { Director } from '../src/core/animation/director';
import { buildFaceMesh } from '../src/core/face/buildMesh';
import { LANDMARK_INDICES } from '../src/core/face/landmarkGroups';
import { FaceLandmarkPoint } from '../src/lib/types';

describe('FASE D: Pulido Visual y Robustez Geométrica', () => {
  const createMockLandmarks = (partedGap = 0.025, rotationYaw = 0.0): FaceLandmarkPoint[] => {
    return Array.from({ length: 478 }, (_, i) => {
      let x = 0.5 + ((i % 20) - 10) * 0.015;
      const y = 0.5 + (Math.floor(i / 20) - 12) * 0.015;
      let z = 0.0;

      // Simular leve giro de cabeza en yaw
      if (rotationYaw !== 0) {
        x += (x - 0.5) * rotationYaw;
        z = (x - 0.5) * Math.sin(rotationYaw);
      }

      return { x, y, z };
    });
  };

  const setupDiversePhoto = (mode: 'frontal' | 'parted' | 'tilted' | 'smile' | 'glasses') => {
    const partedGap = mode === 'parted' ? 0.035 : mode === 'smile' ? 0.020 : 0.010;
    const yaw = mode === 'tilted' ? 0.15 : 0.0;
    const landmarks = createMockLandmarks(partedGap, yaw);

    // Ojos y pupilas (para faceScale)
    landmarks[468] = { x: 0.35, y: 0.35, z: 0.0 };
    landmarks[473] = { x: 0.65, y: 0.35, z: 0.0 };
    landmarks[LANDMARK_INDICES.noseTip] = { x: 0.5, y: 0.45, z: -0.05 };
    landmarks[LANDMARK_INDICES.chinBottom] = { x: 0.5, y: 0.75, z: 0.02 };

    // Mejillas simétricas (izquierda y derecha)
    landmarks[LANDMARK_INDICES.leftCheek] = { x: 0.32, y: 0.48, z: 0.0 };
    landmarks[LANDMARK_INDICES.rightCheek] = { x: 0.68, y: 0.48, z: 0.0 };

    // Configuración peribucal de los 11 pares interiores según el modo
    const stomionY = 0.56;
    for (let p = 0; p < INNER_LIP_PAIRS.length; p++) {
      const [uIdx, lIdx] = INNER_LIP_PAIRS[p]!;
      const px = 0.42 + (p / (INNER_LIP_PAIRS.length - 1)) * 0.16;
      landmarks[uIdx] = { x: px, y: stomionY - partedGap * 0.5, z: 0 };
      landmarks[lIdx] = { x: px, y: stomionY + partedGap * 0.5, z: 0 };
    }

    if (mode === 'smile') {
      landmarks[LANDMARK_INDICES.lipLeftCorner] = { x: 0.40, y: stomionY - 0.015, z: 0 };
      landmarks[LANDMARK_INDICES.lipRightCorner] = { x: 0.60, y: stomionY - 0.015, z: 0 };
    } else {
      landmarks[LANDMARK_INDICES.lipLeftCorner] = { x: 0.42, y: stomionY, z: 0 };
      landmarks[LANDMARK_INDICES.lipRightCorner] = { x: 0.58, y: stomionY, z: 0 };
    }

    return buildFaceMesh(landmarks, 512, 512);
  };

  describe('1. Sombreado Sutil Guiado por Ángulo Cefálico (sin alterar tono de piel)', () => {
    it('modula la iluminación según yaw y pitch manteniéndose estrictamente en [0.92, 1.08]', () => {
      const mesh = setupDiversePhoto('frontal');
      const shading = new PseudoVolumeShading({
        basePositions: mesh.basePositions,
        indices: mesh.indices,
        vertexCount: mesh.vertexCount,
        regions: mesh.regions,
      });

      const currentPos = new Float32Array(mesh.basePositions);
      // Simular giro yaw de +15° (0.26 rad) y pitch de +8° (0.14 rad)
      shading.update(currentPos, 0.26, 0.14);

      const colors = shading.colors;
      for (let i = 0; i < mesh.vertexCount; i++) {
        const r = colors[i * 3]!;
        const g = colors[i * 3 + 1]!;
        const b = colors[i * 3 + 2]!;

        // 1. Conservación estricta de tono (R == G == B)
        expect(r).toBeCloseTo(g, 5);
        expect(g).toBeCloseTo(b, 5);

        // 2. Acotación estricta en el rango fisiológico
        expect(r).toBeGreaterThanOrEqual(0.919);
        expect(r).toBeLessThanOrEqual(1.081);
      }
    });

    it('genera contraste sutil izquierda/derecha al girar en yaw (luz direccional suave)', () => {
      const mesh = setupDiversePhoto('frontal');
      const shading = new PseudoVolumeShading({
        basePositions: mesh.basePositions,
        indices: mesh.indices,
        vertexCount: mesh.vertexCount,
        regions: mesh.regions,
      });

      const currentPos = new Float32Array(mesh.basePositions);
      shading.update(currentPos, 0.25, 0.0);

      // Comparar mejilla izquierda (positiva) vs mejilla derecha (negativa)
      const lCheek = LANDMARK_INDICES.leftCheek;
      const rCheek = LANDMARK_INDICES.rightCheek;

      const shadeL = shading.colors[lCheek * 3]!;
      const shadeR = shading.colors[rCheek * 3]!;

      expect(Math.abs(shadeL - shadeR)).toBeGreaterThan(0.005);
    });
  });

  describe('2. Reposo Neutral con Labios Sellados en Diversas Fotos', () => {
    const profiles: Array<'frontal' | 'parted' | 'tilted' | 'smile' | 'glasses'> = [
      'frontal',
      'parted',
      'tilted',
      'smile',
      'glasses',
    ];

    profiles.forEach((profile) => {
      it(`garantiza cierre hermético con gap < 0.001 en foto tipo: ${profile}`, () => {
        const mesh = setupDiversePhoto(profile);
        const result = closeRestingLips(mesh.basePositions, mesh.faceScale, { closureThreshold: 0.0005 });

        expect(result.closedGap).toBeLessThan(0.001);

        // Verificar que cada par interior coincida exactamente en Y
        for (let i = 0; i < INNER_LIP_PAIRS.length; i++) {
          const [uIdx, lIdx] = INNER_LIP_PAIRS[i]!;
          const uy = mesh.basePositions[uIdx * 3 + 1]!;
          const ly = mesh.basePositions[lIdx * 3 + 1]!;
          expect(Math.abs(uy - ly)).toBeLessThan(1e-5);
        }
      });
    });
  });

  describe('3. Curvatura Anatómica Mandibular y Labial (Sin Picos ni Desgarros)', () => {
    it('desciende el labio inferior en forma de arco parabólico suave (comisuras se mantienen elevadas)', () => {
      const mesh = setupDiversePhoto('frontal');
      const deformer = new PoseDeformer({
        basePositions: mesh.basePositions,
        landmarkCount: mesh.landmarkCount,
        vertexCount: mesh.vertexCount,
        faceScale: mesh.faceScale,
        rigVersion: 'v3',
      });

      const currentPos = new Float32Array(mesh.basePositions);
      deformer.apply(currentPos, {
        blink: 0, blinkLeft: 0, blinkRight: 0,
        gazeX: 0, gazeY: 0,
        jawOpen: 0.65,
        mouthRound: 0, mouthWide: 0, smile: 0,
        browRaise: 0, headYaw: 0, headPitch: 0, headRoll: 0, breath: 0,
      });

      // Comparar descenso del centro del labio inferior vs descenso de comisuras
      const centerIdx = LANDMARK_INDICES.lipLowerInnerCenter; // 14
      const cornerIdx = 78;

      const centerDrop = Math.abs(currentPos[centerIdx * 3 + 1]! - mesh.basePositions[centerIdx * 3 + 1]!);
      const cornerDrop = Math.abs(currentPos[cornerIdx * 3 + 1]! - mesh.basePositions[cornerIdx * 3 + 1]!);

      // El centro desciende significativamente más que las comisuras formando un arco natural
      expect(centerDrop).toBeGreaterThan(cornerDrop * 2.5);
    });

    it('distribuye el estiramiento de comisuras entre los vértices adyacentes evitando picos afilados', () => {
      const mesh = setupDiversePhoto('frontal');
      const deformer = new PoseDeformer({
        basePositions: mesh.basePositions,
        landmarkCount: mesh.landmarkCount,
        vertexCount: mesh.vertexCount,
        faceScale: mesh.faceScale,
        rigVersion: 'v3',
      });

      const currentPos = new Float32Array(mesh.basePositions);
      deformer.apply(currentPos, {
        blink: 0, blinkLeft: 0, blinkRight: 0,
        gazeX: 0, gazeY: 0,
        jawOpen: 0.25,
        mouthRound: 0, mouthWide: 0.85, smile: 0,
        browRaise: 0, headYaw: 0, headPitch: 0, headRoll: 0, breath: 0,
      });

      // Verificar que tanto la comisura (61) como el vértice vecino (185) se desplacen coordinadamente
      const c61Shift = Math.abs(currentPos[61 * 3]! - mesh.basePositions[61 * 3]!);
      const c185Shift = Math.abs(currentPos[185 * 3]! - mesh.basePositions[185 * 3]!);

      expect(c61Shift).toBeGreaterThan(0.01);
      expect(c185Shift).toBeGreaterThan(0.005);
      expect(c185Shift).toBeLessThan(c61Shift); // Falloff suave hacia el centro
    });
  });

  describe('4. Articulación Conversacional Procedimental en Modo Hablando', () => {
    it('genera cadencia conversacional continua cuando mood === speaking sin audio streaming', () => {
      const director = new Director();
      director.setMood('speaking');

      const jaws: number[] = [];
      const closes: number[] = [];

      // Muestrear 2 segundos a 60 fps
      for (let f = 0; f < 120; f++) {
        const out = director.update(0.016, 0.0, {
          jawOpen: 0,
          mouthRound: 0,
          mouthWide: 0,
          smile: 0,
        });
        jaws.push(out.poseTargets.jawOpen);
        closes.push(out.extraShapes.mouthClose);
      }

      // Debe haber movimiento articular visible (no estático)
      const maxJaw = Math.max(...jaws);
      const minJaw = Math.min(...jaws);
      expect(maxJaw - minJaw).toBeGreaterThan(0.10);

      // Debe incluir momentos de articulación abierta y momentos de cierre silábico
      expect(maxJaw).toBeGreaterThanOrEqual(0.18);
      expect(Math.max(...closes)).toBeGreaterThan(0.5);
    });
  });
});
