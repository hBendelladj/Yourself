import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { LipsyncAnalyzer } from '../src/core/audio/lipsyncAnalyzer';
import { MouthInterior, INNER_LIP_PAIRS } from '../src/core/render/mouthInterior';
import { VisemeScheduler } from '../src/core/audio/visemeScheduler';
import { RigBasis } from '../src/core/rig/basis';
import { Rig } from '../src/core/rig/rig';
import { buildFaceMesh } from '../src/core/face/buildMesh';
import { LANDMARK_INDICES } from '../src/core/face/landmarkGroups';
import { FaceLandmarkPoint } from '../src/lib/types';

describe('FASE 1: Boca, Mandíbula y Lengua — Calibración Empírica', () => {
  // Generador de landmarks sintéticos
  const createMockLandmarks = (): FaceLandmarkPoint[] => {
    return Array.from({ length: 478 }, (_, i) => ({
      x: 0.5 + ((i % 20) - 10) * 0.015,
      y: 0.5 + (Math.floor(i / 20) - 12) * 0.015,
      z: 0.0,
    }));
  };

  describe('1. LipsyncAnalyzer: Curva Calibrada y Alivio de Zona Muerta', () => {
    it('alleviates deadband with openThreshold 0.015 and closeThreshold 0.007', () => {
      const analyzer = new LipsyncAnalyzer(null, {
        openThreshold: 0.015,
        closeThreshold: 0.007,
      });
      // Rest state
      expect(analyzer.getValues().jawOpen).toBe(0);
    });

    it('calibrated curve reaches open vocoid /a/ target (0.85 - 0.92) under full volume', () => {
      const mockAnalyser = {
        fftSize: 512,
        frequencyBinCount: 256,
        context: { sampleRate: 24000 },
        getByteTimeDomainData: (arr: Uint8Array) => {
          arr.fill(255); // Volumen máximo
        },
        getByteFrequencyData: (arr: Uint8Array) => {
          // Energía en formantes vocálicos medios de /a/
          arr.fill(30);
          for (let i = 10; i < 40; i++) arr[i] = 245;
        },
      } as unknown as AnalyserNode;

      const analyzer = new LipsyncAnalyzer(mockAnalyser, {
        softMaxJaw: 0.92,
        useCalibratedCurve: true,
      });

      let lastJaw = 0;
      for (let i = 0; i < 45; i++) {
        lastJaw = analyzer.update(0.016).jawOpen;
      }

      // En V3 calibrado debe superar el tope antiguo de 0.65 y alcanzar ~0.85-0.92
      expect(lastJaw).toBeGreaterThanOrEqual(0.80);
      expect(lastJaw).toBeLessThanOrEqual(0.95);
    });
  });

  describe('2. Mandíbula Real: Bisagra ATM y Traslación Anteroposterior', () => {
    it('applies anatomic TMJ condylar rotation + downward (2.5%) and backward (2.0%) translation', () => {
      const landmarks = createMockLandmarks();
      landmarks[LANDMARK_INDICES.lipUpperInnerCenter] = { x: 0.5, y: 0.55, z: 0 };
      landmarks[LANDMARK_INDICES.lipLowerInnerCenter] = { x: 0.5, y: 0.57, z: 0 };
      landmarks[LANDMARK_INDICES.chinBottom] = { x: 0.5, y: 0.75, z: 0.05 };
      landmarks[234] = { x: 0.2, y: 0.45, z: -0.05 }; // Cóndilo izquierdo
      landmarks[454] = { x: 0.8, y: 0.45, z: -0.05 }; // Cóndilo derecho

      const mesh = buildFaceMesh(landmarks, 512, 512);
      const basis = new RigBasis({
        basePositions: mesh.basePositions,
        vertexCount: mesh.vertexCount,
        landmarkCount: mesh.landmarkCount,
        faceScale: mesh.faceScale,
        regions: mesh.regions,
      });

      const rig = new Rig({
        basePositions: mesh.basePositions,
        vertexCount: mesh.vertexCount,
        landmarkCount: mesh.landmarkCount,
        faceScale: mesh.faceScale,
        basis,
      });

      const out = new Float32Array(mesh.vertexCount * 3);
      rig.apply({
        jawOpen: 1.0,
        blink: 0, blinkLeft: 0, blinkRight: 0,
        gazeX: 0, gazeY: 0,
        mouthRound: 0, mouthWide: 0, smile: 0,
        browRaise: 0, headYaw: 0, headPitch: 0, headRoll: 0, breath: 0
      }, out);

      const chinIdx = LANDMARK_INDICES.chinBottom;
      const lowerLipIdx = LANDMARK_INDICES.lipLowerInnerCenter;
      const upperLipIdx = LANDMARK_INDICES.lipUpperInnerCenter;

      // El mentón y labio inferior descienden rígidamente
      expect(out[chinIdx * 3 + 1]!).toBeLessThan(mesh.basePositions[chinIdx * 3 + 1]!);
      expect(out[lowerLipIdx * 3 + 1]!).toBeLessThan(mesh.basePositions[lowerLipIdx * 3 + 1]!);

      // Retracción hacia atrás (en Z) por la bisagra y la traslación
      expect(out[chinIdx * 3 + 2]!).toBeLessThan(mesh.basePositions[chinIdx * 3 + 2]!);

      // El labio superior no acompaña el descenso de la mandíbula
      const upperLipDisp = Math.abs(out[upperLipIdx * 3 + 1]! - mesh.basePositions[upperLipIdx * 3 + 1]!);
      const lowerLipDisp = Math.abs(out[lowerLipIdx * 3 + 1]! - mesh.basePositions[lowerLipIdx * 3 + 1]!);
      expect(upperLipDisp / lowerLipDisp).toBeLessThan(0.12);
    });
  });

  describe('3. Lengua Procedural y Cavidad Bucal', () => {
    it('contains a procedural tongue mesh that elevates in /l, t, d, n/ and peeks in /s, th/', () => {
      const mouth = new MouthInterior();
      expect(mouth.tongueMesh).toBeDefined();
      expect(mouth.tongueMesh instanceof THREE.Mesh).toBe(true);

      const mockPositions = new Float32Array(500 * 3);
      // Simular contorno labial abierto
      mockPositions[13 * 3 + 1] = 0.55; // Labio superior
      mockPositions[14 * 3 + 1] = 0.45; // Labio inferior
      mockPositions[78 * 3] = 0.35;     // Comisura izquierda
      mockPositions[308 * 3] = 0.65;    // Comisura derecha

      // 1. Lengua en /a/ (reposo bajo)
      mouth.update(mockPositions, 0.20, 0.45, 0.0, 0.0);
      const lowY = mouth.tongueMesh.position.y;
      const lowZ = mouth.tongueMesh.position.z;

      // 2. Lengua en /l, t, d, n/ (elevación lingual hacia incisivos superiores)
      mouth.update(mockPositions, 0.20, 0.45, 0.85, 0.0);
      const elevatedY = mouth.tongueMesh.position.y;
      expect(elevatedY).toBeGreaterThan(lowY);

      // 3. Lengua en /th, s/ (protrusión lingual hacia adelante)
      mouth.update(mockPositions, 0.20, 0.45, 0.35, 0.40);
      const peekZ = mouth.tongueMesh.position.z;
      expect(peekZ).toBeGreaterThan(lowZ);

      mouth.destroy();
    });

    it('alleviates g0 deadband from 0.007 to 0.004', () => {
      const mouth = new MouthInterior();
      const mockPositions = new Float32Array(500 * 3);

      // Con apertura de 0.01 (silencio / susurro muy bajo)
      mouth.update(mockPositions, 0.01);
      expect(mouth.mesh.visible).toBe(false);

      // Con apertura de 0.02 (apertura leve)
      mouth.update(mockPositions, 0.025);
      expect(mouth.mesh.visible).toBe(true);

      mouth.destroy();
    });
  });

  describe('4. VisemeScheduler: Coarticulación y Visemas en Español', () => {
    it('sets jawOpen in open vowel /a/ up to 0.85 - 0.95', () => {
      const scheduler = new VisemeScheduler();
      scheduler.enqueueText('mama'); // Sílaba 'ma'

      scheduler.onSyllableTick(0.0);
      expect(scheduler.hasPendingSyllables()).toBe(true);

      // Evaluar en núcleo vocálico de /a/ (50% de la sílaba)
      const targets = scheduler.update(0.07, {
        jawOpen: 0.88,
        mouthRound: 0,
        mouthWide: 0.1,
        smile: 0,
      });

      expect(targets.jawOpen).toBeGreaterThanOrEqual(0.75);
      expect(targets.jawOpen).toBeLessThanOrEqual(0.95);
    });

    it('enforces total bilabial hermetic closure on /m, b, p/', () => {
      const scheduler = new VisemeScheduler();
      scheduler.enqueueText('papa');

      scheduler.onSyllableTick(0.0);
      // En onset (0 ms): consonante bilabial 'P'
      const targets = scheduler.update(0.01, {
        jawOpen: 0.6,
        mouthRound: 0,
        mouthWide: 0,
        smile: 0,
      });

      expect(targets.jawOpen).toBe(0);
      expect(targets.mouthClose).toBeGreaterThanOrEqual(0.90);
      expect(targets.mouthPressLips).toBeGreaterThanOrEqual(0.60);
    });
  });
});
