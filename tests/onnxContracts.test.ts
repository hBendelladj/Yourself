/**
 * onnxContracts.test.ts
 *
 * Test de Contratos ONNX, ARKit 52 y Puente Asíncrono (YourSelf V3 - Fases 4 & 5 / Sección 18.5):
 * - Valida formalmente las especificaciones de tensores de Audio2Motion (52 blendshapes + 6 pose).
 * - Valida el catálogo de los 52 blendshapes universales ARKit y el evaluador ATM mandibular.
 * - Valida la ranura de intercambio LastWinsSlot y la interpolación temporal Hermite a 60 FPS.
 * - Valida el motor afectivo continuo (Valence/Arousal) y la coarticulación Duchenne.
 */

import { describe, it, expect } from 'vitest';
import { ARKIT_SHAPE_NAMES, ARKIT_SHAPES_METADATA, ARKitVector } from '../src/core/rig/arkitShapes';
import { RigEvaluator } from '../src/core/rig/rigEvaluator';
import { ModelContractGuard, AUDIO2MOTION_CONTRACT } from '../src/core/neural/modelContracts';
import { NeuralBridge, LastWinsSlot } from '../src/core/neural/neuralBridge';
import { MotionWorkerProcessor } from '../src/core/neural/motionWorker';
import { EmotionEngine } from '../src/core/motion/emotionEngine';

describe('V3 Phases 4 & 5: ARKit 52 Catalog, ONNX Contracts and Async Neural Bridge', () => {
  describe('1. ARKit 52 Blendshape Catalog & ATM Condyle Arc Evaluator', () => {
    it('defines exactly 52 formal ARKit blendshapes with comprehensive FACS metadata', () => {
      expect(ARKIT_SHAPE_NAMES.length).toBe(52);

      // Verificar que cada una de las 52 formas tenga metadatos definidos
      for (const shape of ARKIT_SHAPE_NAMES) {
        const meta = ARKIT_SHAPES_METADATA[shape];
        expect(meta).toBeDefined();
        expect(meta.name).toBe(shape);
        expect(meta.description.length).toBeGreaterThan(5);
      }
    });

    it('manages ARKitVector and updates morphTargetInfluences for Three.js without allocations', () => {
      const basePos = new Float32Array(478 * 3);
      // Simular cóndilos en orejas (234, 454)
      basePos[234 * 3 + 1] = 0.0;
      basePos[234 * 3 + 2] = -0.05;

      const evaluator = new RigEvaluator({
        basePositions: basePos,
        landmarkCount: 478,
        faceScale: 0.45,
      });

      evaluator.setWeight('jawOpen', 0.85);
      evaluator.setWeight('mouthSmileLeft', 0.70);
      evaluator.setWeight('mouthSmileRight', 0.70);

      expect(evaluator.arkitVector.get('jawOpen')).toBeCloseTo(0.85);
      expect(evaluator.arkitVector.get('mouthSmileLeft')).toBeCloseTo(0.70);
      expect(evaluator.arkitVector.get('eyeBlinkLeft')).toBe(0.0);

      const targetInfluences = new Float32Array(52);
      evaluator.syncToThreeInfluences(targetInfluences);

      expect(targetInfluences[0]).toBeCloseTo(0.85); // jawOpen
      expect(targetInfluences[7]).toBeCloseTo(0.70); // mouthSmileLeft
    });

    it('evaluates temporomandibular (ATM) rotational arc descending and retracting in Z', () => {
      const basePos = new Float32Array(478 * 3);
      basePos[234 * 3 + 1] = 0.0;
      basePos[234 * 3 + 2] = -0.05;

      // Mentón en posición neutral
      basePos[152 * 3 + 1] = -0.20;
      basePos[152 * 3 + 2] = 0.01;

      const evaluator = new RigEvaluator({
        basePositions: basePos,
        landmarkCount: 478,
        faceScale: 0.45,
      });

      const outPos = new Float32Array(basePos);
      evaluator.evaluateJawCondyleArc(1.0, outPos);

      // Al abrir la mandíbula: el mentón debe descender (Y disminuye) y retraerse hacia atrás en Z
      expect(outPos[152 * 3 + 1]!).toBeLessThan(basePos[152 * 3 + 1]!);
      expect(outPos[152 * 3 + 2]!).toBeLessThan(basePos[152 * 3 + 2]!);
    });
  });

  describe('2. ONNX Tensor Contracts and Validation Guard (Section 18.5)', () => {
    it('validates compliant audio input and motion output buffers without error', () => {
      const validBlendshapes = new Float32Array(52);
      validBlendshapes.fill(0.25);
      validBlendshapes[0] = 0.80; // jawOpen

      const check = ModelContractGuard.validateBuffer(
        validBlendshapes,
        AUDIO2MOTION_CONTRACT.outputBlendshapes
      );
      expect(check.isValid).toBe(true);
      expect(check.error).toBeUndefined();
    });

    it('detects dimension violations when buffer size differs from contract specification', () => {
      const invalidBuffer = new Float32Array(24); // Solo 24 elementos en vez de 52

      const check = ModelContractGuard.validateBuffer(
        invalidBuffer,
        AUDIO2MOTION_CONTRACT.outputBlendshapes
      );
      expect(check.isValid).toBe(false);
      expect(check.error).toContain('Violación de dimensión');
    });

    it('detects numerical violations (NaN, Infinito o valores fuera del rango [0..1])', () => {
      const nanBuffer = new Float32Array(52);
      nanBuffer[10] = NaN;

      const checkNaN = ModelContractGuard.validateBuffer(
        nanBuffer,
        AUDIO2MOTION_CONTRACT.outputBlendshapes
      );
      expect(checkNaN.isValid).toBe(false);
      expect(checkNaN.error).toContain('NaN');

      const outOfRange = new Float32Array(52);
      outOfRange[0] = 1.85; // Excede 1.0

      const checkRange = ModelContractGuard.validateBuffer(
        outOfRange,
        AUDIO2MOTION_CONTRACT.outputBlendshapes
      );
      expect(checkRange.isValid).toBe(false);
      expect(checkRange.error).toContain('fuera del rango');
    });
  });

  describe('3. Asynchronous Neural Bridge and LastWinsSlot Concurrency', () => {
    it('implements non-blocking drop-on-full slot (LastWinsSlot)', () => {
      const slot = new LastWinsSlot<number>();

      expect(slot.hasFresh()).toBe(false);

      // Productor inserta elemento 1
      slot.put(100);
      expect(slot.hasFresh()).toBe(true);

      // Productor sobreescribe elemento 2 antes de que sea leído (drop-on-full)
      slot.put(200);
      expect(slot.hasFresh()).toBe(true);

      // Consumidor lee el elemento más fresco
      const val = slot.take();
      expect(val).toBe(200);
      expect(slot.hasFresh()).toBe(false);
    });

    it('interpolates 30 Hz worker states to 60 FPS smoothly using cubic Hermite filtering', () => {
      const bridge = new NeuralBridge();

      const packet1 = {
        blendshapes: new Float32Array(52),
        headPose: new Float32Array(6),
        timestamp: 0.0,
      };
      packet1.blendshapes[0] = 0.0; // jawOpen = 0.0

      const packet2 = {
        blendshapes: new Float32Array(52),
        headPose: new Float32Array(6),
        timestamp: 0.033,
      };
      packet2.blendshapes[0] = 1.0; // jawOpen = 1.0

      bridge.onWorkerPacket(packet1);
      bridge.update(0.016);

      bridge.onWorkerPacket(packet2);

      // Interpolar a medio camino (~16.6 ms de los 33.3 ms = 50%)
      const mid = bridge.update(0.016);
      expect(mid.blendshapes[0]).toBeGreaterThan(0.35);
      expect(mid.blendshapes[0]).toBeLessThan(0.65);

      // Completar los 33.3 ms (segundo paso de 16.6 ms)
      const end = bridge.update(0.018);
      expect(end.blendshapes[0]).toBeCloseTo(1.0, 1);
    });

    it('processes audio chunk in MotionWorkerProcessor and enforces contract compliance', () => {
      const processor = new MotionWorkerProcessor();
      const mockAudio = new Float32Array(800);

      // Señal sinusoidal audible
      for (let i = 0; i < mockAudio.length; i++) {
        mockAudio[i] = Math.sin((i / 800) * Math.PI * 16) * 0.25;
      }

      const packet = processor.processAudioChunk(mockAudio, 24000, 1.0);
      expect(packet.blendshapes.length).toBe(52);
      expect(packet.headPose.length).toBe(6);
      expect(packet.blendshapes[0]!).toBeGreaterThan(0.1); // Mandíbula responde a la energía
    });
  });

  describe('4. Continuous Affective Emotion Engine & VASA-1 Controls', () => {
    it('coarticulates genuine Duchenne smile (AU12 + AU6) for positive valence', () => {
      const emotion = new EmotionEngine();

      emotion.setBaseAffect({ valence: 0.8, arousal: 0.3 });

      // Avanzar suavizado temporal
      let targets = emotion.update(0.5);
      targets = emotion.update(0.5);

      // Sonrisa genuina: Zygomaticus (AU12) y Orbicularis Oculi (AU6) activados conjuntamente
      expect(targets.mouthSmileLeft).toBeGreaterThan(0.5);
      expect(targets.mouthSmileRight).toBeGreaterThan(0.5);
      expect(targets.eyeSquintLeft).toBeGreaterThan(0.3);
      expect(targets.eyeSquintRight).toBeGreaterThan(0.3);
      expect(targets.mouthFrownLeft).toBe(0);
    });

    it('coarticulates brow lowerer (AU4) and frown (AU15) for negative valence', () => {
      const emotion = new EmotionEngine();

      emotion.setBaseAffect({ valence: -0.8, arousal: 0.1 });

      let targets = emotion.update(0.5);
      targets = emotion.update(0.5);

      expect(targets.mouthFrownLeft).toBeGreaterThan(0.3);
      expect(targets.browDownLeft).toBeGreaterThan(0.2);
      expect(targets.mouthSmileLeft).toBe(0);
    });

    it('applies VASA-1 high-level controls (emotionOffset and headDistance)', () => {
      const emotion = new EmotionEngine();

      emotion.setVASA1Controls({
        emotionOffset: { valence: 0.5, arousal: 0.2 },
        headDistance: 1.15,
        gazeTarget: { x: -0.25, y: 0.15 },
      });

      const controls = emotion.getVASA1Controls();
      expect(controls.headDistance).toBe(1.15);
      expect(controls.gazeTarget?.x).toBe(-0.25);
      expect(controls.emotionOffset.valence).toBe(0.5);
    });
  });
});
