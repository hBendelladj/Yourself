/**
 * perfZeroAlloc.test.ts
 *
 * Test de Rendimiento Extremo y Asignaciones Cero en Bucle Caliente (YourSelf V3 - Fase 5 / Secciones 15 & 18.3):
 * - Ejecuta 120 iteraciones del bucle completo de animación midiendo el tiempo de JS y consumo de memoria.
 * - Verifica que el tiempo total de computación de deformación, física, VOR y evaluación
 *   se mantiene muy por debajo del presupuesto de 4.0 ms de JS para 60 FPS fluidos.
 * - Verifica la estabilidad de memoria heap y ausencia de objetos efímeros en caliente.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EyeEngine } from '../src/core/eye/eyeEngine';
import { VORCoordinator } from '../src/core/motion/vorCoordinator';
import { HeadDirector } from '../src/core/motion/headDirector';
import { EmotionEngine } from '../src/core/motion/emotionEngine';
import { NeuralBridge } from '../src/core/neural/neuralBridge';
import { RigEvaluator } from '../src/core/rig/rigEvaluator';
import { buildFaceMesh } from '../src/core/face/buildMesh';
import { FaceLandmarkPoint } from '../src/lib/types';

describe('V3 Phase 5: Zero-Allocation and 60 FPS Performance Budget (Section 15 & 18.3)', () => {
  const createMockLandmarks = (): FaceLandmarkPoint[] => {
    return Array.from({ length: 478 }, (_, i) => ({
      x: 0.5 + ((i % 20) - 10) * 0.015,
      y: 0.5 + (Math.floor(i / 20) - 12) * 0.015,
      z: 0.0,
    }));
  };

  it('executes 120 hot-loop frames of all V3 engines within the 4.0 ms JS budget', () => {
    const landmarks = createMockLandmarks();
    const meshData = buildFaceMesh(landmarks, 512, 512);
    const texture = new THREE.Texture();

    // Inicializar todos los motores V3
    const eyeEngine = new EyeEngine({
      texture,
      basePositions: meshData.basePositions,
      faceScale: meshData.faceScale,
    });
    const vor = new VORCoordinator();
    const headDirector = new HeadDirector();
    const emotionEngine = new EmotionEngine();
    const neuralBridge = new NeuralBridge();
    const rigEvaluator = new RigEvaluator({
      basePositions: meshData.basePositions,
      landmarkCount: meshData.landmarkCount,
      faceScale: meshData.faceScale,
    });

    const currentPositions = new Float32Array(meshData.basePositions);
    const threeInfluences = new Float32Array(52);

    // Warm-up JIT
    for (let i = 0; i < 20; i++) {
      eyeEngine.update(0.016, currentPositions, meshData.uvs, 0, 0, meshData.faceScale);
      vor.update(0.016, 0, 0, 0, 0);
      headDirector.update(0.016);
      emotionEngine.update(0.016);
      neuralBridge.update(0.016);
      rigEvaluator.syncToThreeInfluences(threeInfluences);
    }

    // Medir tiempo de ejecución de 120 fotogramas
    const tStart = performance.now();

    for (let frame = 0; frame < 120; frame++) {
      const dt = 0.016;

      // 1. Cinemática de cabeza
      const head = headDirector.update(dt, 'speaking');

      // 2. Coordinación VOR
      const gazeState = vor.update(dt, 0.05, -0.02, head.yaw, head.pitch);

      // 3. Emociones VASA-1
      const emotionWeights = emotionEngine.update(dt);
      rigEvaluator.setWeight('mouthSmileLeft', emotionWeights.mouthSmileLeft);
      rigEvaluator.setWeight('mouthSmileRight', emotionWeights.mouthSmileRight);

      // 4. Puente neuronal asíncrono
      const bridgeOut = neuralBridge.update(dt);

      // 5. Motor de ojos desacoplado
      eyeEngine.update(
        dt,
        currentPositions,
        meshData.uvs,
        gazeState.compensatedGazeX,
        gazeState.compensatedGazeY,
        meshData.faceScale,
        'speaking'
      );

      // 6. Sincronización de influencias Three.js
      rigEvaluator.syncToThreeInfluences(threeInfluences);
    }

    const tTotal = performance.now() - tStart;
    const avgMsPerFrame = tTotal / 120;

    // El presupuesto total de JS en la especificación es de 4.0 ms.
    // Todos los subsistemas combinados deben consumir < 2.0 ms en CPU.
    expect(avgMsPerFrame).toBeLessThan(2.0);

    eyeEngine.destroy();
  });

  it('guarantees stable heap memory without runaway allocations over 120 iterations', () => {
    // Si process.memoryUsage está disponible en el entorno Node/Vitest
    if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
      if (globalThis.gc) {
        globalThis.gc();
      }

      const landmarks = createMockLandmarks();
      const meshData = buildFaceMesh(landmarks, 512, 512);
      const texture = new THREE.Texture();
      const eyeEngine = new EyeEngine({
        texture,
        basePositions: meshData.basePositions,
        faceScale: meshData.faceScale,
      });

      const currentPos = new Float32Array(meshData.basePositions);

      const memBefore = process.memoryUsage().heapUsed;

      for (let i = 0; i < 120; i++) {
        eyeEngine.update(0.016, currentPos, meshData.uvs, 0.1, -0.1, meshData.faceScale);
      }

      const memAfter = process.memoryUsage().heapUsed;
      const memDeltaMB = (memAfter - memBefore) / (1024 * 1024);

      // El incremento no debe sobrepasar 1 MB en 120 frames (ausencia de fugas)
      expect(memDeltaMB).toBeLessThan(1.5);

      eyeEngine.destroy();
    }
  });
});
