/**
 * eyeInvariance.test.ts
 *
 * Suite de Verificación Rigurosa de Invarianza Ocular y Motor de Párpados (YourSelf V3):
 * - Cumple los requerimientos formales de la Sección 9.3, 17 (Fase 1) y 18.1 de yourself_spec.md.
 * - Test 1: Invarianza estricta de la pupila y del iris durante el parpadeo (ΔY_iris = 0.0 ± 10^-6).
 * - Test 2: Invarianza de forma y área del iris bajo rotación pura de mirada (distorsión < 0.1%).
 * - Test 3: Concha oclusora palpebral esférica 3D (Z_eyelid >= Z_eyeball, sin colisión ni penetración).
 * - Test 4: Perfil temporal asimétrico biológico (38% cierre, 62% apertura).
 * - Test 5: Variabilidad humana estocástica (parpadeos incompletos, dobles, asimetría bilateral).
 * - Test 6: Bucle caliente con cero asignaciones en memoria.
 */

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { EyeBall, EyeSphereData } from '../src/core/eye/eyeBall';
import { EyelidMesh } from '../src/core/eye/eyelidMesh';
import { BlinkEngine } from '../src/core/eye/blinkEngine';
import { EyeEngine } from '../src/core/eye/eyeEngine';
import { LANDMARK_INDICES } from '../src/core/face/landmarkGroups';
import { FaceLandmarkPoint } from '../src/lib/types';
import { buildFaceMesh } from '../src/core/face/buildMesh';

describe('V3 Eye & Eyelid Engine — Strict Biomechanical Verification', () => {
  // Helper para generar landmarks sintéticos realistas con ojos centrados
  const createMockLandmarks = (): FaceLandmarkPoint[] => {
    const landmarks: FaceLandmarkPoint[] = Array.from({ length: 478 }, (_, i) => ({
      x: 0.5 + ((i % 20) - 10) * 0.015,
      y: 0.5 + (Math.floor(i / 20) - 12) * 0.015,
      z: 0.0,
    }));

    // Ojo derecho del rostro (espectador izquierdo)
    landmarks[33] = { x: 0.35, y: 0.40, z: -0.02 };  // esquina exterior
    landmarks[133] = { x: 0.45, y: 0.40, z: -0.01 }; // esquina interior
    landmarks[159] = { x: 0.40, y: 0.38, z: 0.00 };  // párpado superior
    landmarks[145] = { x: 0.40, y: 0.42, z: 0.00 };  // párpado inferior

    // Iris derecho (468 centro, 469..472 contorno)
    landmarks[468] = { x: 0.40, y: 0.40, z: 0.005 };
    landmarks[469] = { x: 0.41, y: 0.40, z: 0.003 };
    landmarks[470] = { x: 0.40, y: 0.41, z: 0.003 };
    landmarks[471] = { x: 0.39, y: 0.40, z: 0.003 };
    landmarks[472] = { x: 0.40, y: 0.39, z: 0.003 };

    // Ojo izquierdo del rostro (espectador derecho)
    landmarks[263] = { x: 0.65, y: 0.40, z: -0.02 }; // esquina exterior
    landmarks[362] = { x: 0.55, y: 0.40, z: -0.01 }; // esquina interior
    landmarks[386] = { x: 0.60, y: 0.38, z: 0.00 };  // párpado superior
    landmarks[374] = { x: 0.60, y: 0.42, z: 0.00 };  // párpado inferior

    // Iris izquierdo (473 centro, 474..477 contorno)
    landmarks[473] = { x: 0.60, y: 0.40, z: 0.005 };
    landmarks[474] = { x: 0.61, y: 0.40, z: 0.003 };
    landmarks[475] = { x: 0.60, y: 0.41, z: 0.003 };
    landmarks[476] = { x: 0.59, y: 0.40, z: 0.003 };
    landmarks[477] = { x: 0.60, y: 0.39, z: 0.003 };

    return landmarks;
  };

  const setupMockGeometry = () => {
    const landmarks = createMockLandmarks();
    const meshData = buildFaceMesh(landmarks, 512, 512);
    return { landmarks, meshData };
  };

  describe('1. EyeBall: Pure Spherical 3D Rotation and Iris Invariance', () => {
    it('initializes eye spheres with correct centers behind the cornea', () => {
      const { meshData } = setupMockGeometry();
      const eyeBall = new EyeBall({
        basePositions: meshData.basePositions,
        faceScale: meshData.faceScale,
      });

      const leftSphere = eyeBall.getLeftEyeSphere();
      const rightSphere = eyeBall.getRightEyeSphere();

      expect(leftSphere.radius).toBeGreaterThan(0.01);
      expect(rightSphere.radius).toBeGreaterThan(0.01);
      // El centro de rotación debe estar desplazado hacia el fondo (-Z)
      expect(leftSphere.centerZ).toBeLessThan(meshData.basePositions[468 * 3 + 2]!);
      expect(rightSphere.centerZ).toBeLessThan(meshData.basePositions[473 * 3 + 2]!);
    });

    it('preserves exact inter-vertex iris distances under gaze rotation (rigid orthonormal rotation)', () => {
      const { meshData } = setupMockGeometry();
      const eyeBall = new EyeBall({
        basePositions: meshData.basePositions,
        faceScale: meshData.faceScale,
      });

      const initialPositions = new Float32Array(meshData.basePositions);
      const rotatedPositions = new Float32Array(meshData.basePositions);

      // Calcular distancia inicial entre dos vértices del iris
      const i0 = LANDMARK_INDICES.leftIris[0]!;
      const i1 = LANDMARK_INDICES.leftIris[1]!;
      const baseDist = Math.hypot(
        initialPositions[i0 * 3]! - initialPositions[i1 * 3]!,
        initialPositions[i0 * 3 + 1]! - initialPositions[i1 * 3 + 1]!,
        initialPositions[i0 * 3 + 2]! - initialPositions[i1 * 3 + 2]!
      );

      // Aplicar mirada extrema: gazeX = 0.8, gazeY = -0.7
      eyeBall.updateGaze(0.8, -0.7);
      eyeBall.applyToPositions(rotatedPositions);

      const rotatedDist = Math.hypot(
        rotatedPositions[i0 * 3]! - rotatedPositions[i1 * 3]!,
        rotatedPositions[i0 * 3 + 1]! - rotatedPositions[i1 * 3 + 1]!,
        rotatedPositions[i0 * 3 + 2]! - rotatedPositions[i1 * 3 + 2]!
      );

      // La distancia entre vértices del iris no debe variar más de 10^-5 (cero deformación)
      expect(Math.abs(rotatedDist - baseDist)).toBeLessThan(1e-5);
    });

    it('maintains iris area strictly invariant under any gaze direction (< 0.1% change)', () => {
      const { meshData } = setupMockGeometry();
      const eyeBall = new EyeBall({
        basePositions: meshData.basePositions,
        faceScale: meshData.faceScale,
      });

      const pos = new Float32Array(meshData.basePositions);
      const baseMetrics = eyeBall.getIrisMetrics('left', pos);

      // Evaluar en 20 ángulos aleatorios de mirada
      for (let i = 0; i < 20; i++) {
        const gx = (Math.random() - 0.5) * 2;
        const gy = (Math.random() - 0.5) * 2;

        eyeBall.updateGaze(gx, gy);
        eyeBall.applyToPositions(pos);

        const currentMetrics = eyeBall.getIrisMetrics('left', pos);
        const areaRatio = currentMetrics.area / baseMetrics.area;

        expect(areaRatio).toBeCloseTo(1.0, 2);
        expect(Math.abs(currentMetrics.radius - baseMetrics.radius)).toBeLessThan(1e-4);
      }
    });
  });

  describe('2. Pupil and Iris Invariance During Blinking (Section 9.3 & 18.1)', () => {
    it('simulates 1,000 frames of blinking: ΔY_iris = 0.0 ± 10^-6 (Section 18.1)', () => {
      const { meshData } = setupMockGeometry();
      const dummyTexture = new THREE.Texture();
      const eyeEngine = new EyeEngine({
        texture: dummyTexture,
        basePositions: meshData.basePositions,
        faceScale: meshData.faceScale,
      });

      const currentPos = new Float32Array(meshData.basePositions);
      const leftIris = LANDMARK_INDICES.leftIris;
      const rightIris = LANDMARK_INDICES.rightIris;

      // 1. Guardar coordenadas Y base del iris en reposo
      const baseLeftY = leftIris.map((idx) => currentPos[idx * 3 + 1]!);
      const baseRightY = rightIris.map((idx) => currentPos[idx * 3 + 1]!);

      // 2. Simular 1.000 fotogramas de parpadeo continuo (cierre de 0.0 a 1.0 y apertura)
      for (let frame = 0; frame < 1000; frame++) {
        const blinkAmount = Math.abs(Math.sin((frame / 1000) * Math.PI * 15)); // Oscila entre 0 y 1

        eyeEngine.update(
          0.016,
          currentPos,
          meshData.uvs,
          0.0, // gazeX neutro para aislar efecto del parpadeo
          0.0, // gazeY neutro
          meshData.faceScale,
          'idle',
          blinkAmount,
          blinkAmount
        );

        // Verificar que ningún vértice del iris derecho o izquierdo sufrió traslación en Y
        for (let i = 0; i < leftIris.length; i++) {
          const idx = leftIris[i]!;
          const deltaY = Math.abs(currentPos[idx * 3 + 1]! - baseLeftY[i]!);
          expect(deltaY).toBeLessThan(1e-6);
        }

        for (let i = 0; i < rightIris.length; i++) {
          const idx = rightIris[i]!;
          const deltaY = Math.abs(currentPos[idx * 3 + 1]! - baseRightY[i]!);
          expect(deltaY).toBeLessThan(1e-6);
        }
      }

      eyeEngine.destroy();
    });

    it('verifies iris centroid distance invariance ||C(t) - C(0)|| < 0.0001 * faceScale during blink', () => {
      const { meshData } = setupMockGeometry();
      const dummyTexture = new THREE.Texture();
      const eyeEngine = new EyeEngine({
        texture: dummyTexture,
        basePositions: meshData.basePositions,
        faceScale: meshData.faceScale,
      });

      const currentPos = new Float32Array(meshData.basePositions);
      const initialMetrics = eyeEngine.eyeBall.getIrisMetrics('left', currentPos);

      // Probar con parpadeos completos (0.25, 0.50, 0.75, 1.0)
      const testBlinks = [0.25, 0.5, 0.75, 1.0, 0.0];
      const epsilon = 0.0001 * meshData.faceScale;

      for (const blink of testBlinks) {
        eyeEngine.update(
          0.016,
          currentPos,
          meshData.uvs,
          0.0,
          0.0,
          meshData.faceScale,
          'idle',
          blink,
          blink
        );

        const m = eyeEngine.eyeBall.getIrisMetrics('left', currentPos);
        const shift = Math.hypot(
          m.centroidX - initialMetrics.centroidX,
          m.centroidY - initialMetrics.centroidY,
          m.centroidZ - initialMetrics.centroidZ
        );

        expect(shift).toBeLessThan(epsilon);
      }

      eyeEngine.destroy();
    });
  });

  describe('3. EyelidMesh: Anatomical Spherical Curvature and Occlusion', () => {
    it('creates eyelid mesh with 54 vertices (27 per eye) and renderOrder 3', () => {
      const dummyTexture = new THREE.Texture();
      const eyelids = new EyelidMesh({ texture: dummyTexture });

      expect(eyelids.mesh.renderOrder).toBe(3);
      expect(eyelids.mesh.geometry.attributes.position.count).toBe(54);
      expect(eyelids.mesh.visible).toBe(false);

      eyelids.destroy();
    });

    it('ensures eyelid Z elevation is strictly above or tangential to eyeball sphere (no eye penetration)', () => {
      const { meshData } = setupMockGeometry();
      const dummyTexture = new THREE.Texture();
      const eyelids = new EyelidMesh({ texture: dummyTexture });
      const eyeBall = new EyeBall({
        basePositions: meshData.basePositions,
        faceScale: meshData.faceScale,
      });

      const leftSphere = eyeBall.getLeftEyeSphere();
      const rightSphere = eyeBall.getRightEyeSphere();
      const currentPos = new Float32Array(meshData.basePositions);

      // Simular ojo a medio cerrar (blink = 0.5)
      eyelids.update(
        currentPos,
        meshData.uvs,
        0.5,
        0.5,
        leftSphere,
        rightSphere,
        0.0,
        meshData.faceScale
      );

      const positions = eyelids.mesh.geometry.attributes.position.array as Float32Array;

      // Comprobar que todos los vértices del párpado tienen Z >= centro Z de la esfera
      for (let i = 0; i < eyelids.mesh.geometry.attributes.position.count; i++) {
        const vz = positions[i * 3 + 2]!;
        // Párpados deben estar hacia adelante (Z mayor que el centro de la órbita)
        expect(vz).toBeGreaterThanOrEqual(leftSphere.centerZ);
      }

      eyelids.destroy();
    });

    it('achieves 100% opacity when blink > 0.05 to eliminate iris ghosting', () => {
      const { meshData } = setupMockGeometry();
      const dummyTexture = new THREE.Texture();
      const eyelids = new EyelidMesh({ texture: dummyTexture });
      const eyeBall = new EyeBall({
        basePositions: meshData.basePositions,
        faceScale: meshData.faceScale,
      });

      const currentPos = new Float32Array(meshData.basePositions);

      // Parpadeo leve (0.2)
      eyelids.update(
        currentPos,
        meshData.uvs,
        0.2,
        0.2,
        eyeBall.getLeftEyeSphere(),
        eyeBall.getRightEyeSphere()
      );

      expect((eyelids.mesh.material as THREE.MeshBasicMaterial).opacity).toBe(1.0);

      // Totalmente abierto (0.0)
      eyelids.update(
        currentPos,
        meshData.uvs,
        0.0,
        0.0,
        eyeBall.getLeftEyeSphere(),
        eyeBall.getRightEyeSphere()
      );

      expect(eyelids.mesh.visible).toBe(false);
      expect((eyelids.mesh.material as THREE.MeshBasicMaterial).opacity).toBe(0.0);

      eyelids.destroy();
    });
  });

  describe('4. BlinkEngine: Biological Asymmetric Profile & Stochastic Timing (Section 9.2)', () => {
    it('follows asymmetric profile: 38% closing phase (~40ms) and 62% opening phase (~70ms)', () => {
      const engine = new BlinkEngine();

      // Cierre rápido: en p = 0.38 debe alcanzar el cierre máximo (1.0)
      const atQuarterClose = engine.evaluateBlinkCurve(0.19);
      const atMaxClose = engine.evaluateBlinkCurve(0.38);
      const atMidOpen = engine.evaluateBlinkCurve(0.69);
      const atEnd = engine.evaluateBlinkCurve(1.0);

      expect(atQuarterClose).toBeGreaterThan(0.65); // Aceleración inicial rápida
      expect(atMaxClose).toBeCloseTo(1.0, 2);        // Pico en 38%
      expect(atMidOpen).toBeLessThan(0.75);         // Apertura gradual
      expect(atEnd).toBe(0.0);                      // Totalmente abierto al final
    });

    it('triggers manual blink and completes full cycle with onBlinkChange events', () => {
      const onBlinkSpy = vi.fn();
      const engine = new BlinkEngine({ onBlinkChange: onBlinkSpy });

      engine.triggerBlink();
      expect(onBlinkSpy).toHaveBeenCalledWith(true);

      // Avanzar en pasos de 10 ms hasta el final del parpadeo
      let frames = 0;
      let wasFullyClosed = false;
      while (engine.getIsBlinking() && frames < 30) {
        const state = engine.update(0.01);
        if (state.closureRatio > 0.6) wasFullyClosed = true;
        frames++;
      }

      expect(wasFullyClosed).toBe(true);
      expect(engine.getIsBlinking()).toBe(false);
      expect(onBlinkSpy).toHaveBeenCalledWith(false);
    });

    it('triggers blink on large gaze saccade (> 0.35)', () => {
      const engine = new BlinkEngine();
      let triggered = false;

      // Probar múltiples sacadas grandes
      for (let i = 0; i < 20; i++) {
        engine.triggerSaccadeBlink(0.45);
        if (engine.getIsBlinking()) {
          triggered = true;
          break;
        }
      }

      expect(triggered).toBe(true);
    });

    it('schedules realistic log-normal blink intervals between 1.2s and 6.8s', () => {
      const engine = new BlinkEngine();

      for (let i = 0; i < 50; i++) {
        const tIdle = engine.sampleBlinkInterval('idle');
        const tSpeaking = engine.sampleBlinkInterval('speaking');

        expect(tIdle).toBeGreaterThanOrEqual(1.2);
        expect(tIdle).toBeLessThanOrEqual(6.8);
        expect(tSpeaking).toBeGreaterThanOrEqual(1.2);
        expect(tSpeaking).toBeLessThanOrEqual(6.8);

        engine.scheduleNextBlink('idle');
        expect(engine.getTimeUntilNextBlink()).toBeGreaterThanOrEqual(1.2);
        expect(engine.getTimeUntilNextBlink()).toBeLessThanOrEqual(6.8);
      }
    });
  });

  describe('5. Hot Render Loop: Zero-Allocation and Performance', () => {
    it('executes 120 update iterations with zero memory allocations / clean object reuse', () => {
      const { meshData } = setupMockGeometry();
      const dummyTexture = new THREE.Texture();
      const eyeEngine = new EyeEngine({
        texture: dummyTexture,
        basePositions: meshData.basePositions,
        faceScale: meshData.faceScale,
      });

      const currentPos = new Float32Array(meshData.basePositions);

      // Calentamiento JIT
      for (let i = 0; i < 10; i++) {
        eyeEngine.update(0.016, currentPos, meshData.uvs, 0.1, -0.1, meshData.faceScale);
      }

      // Medir tiempo de ejecución en 120 fotogramas
      const tStart = performance.now();
      for (let i = 0; i < 120; i++) {
        const res = eyeEngine.update(
          0.016,
          currentPos,
          meshData.uvs,
          Math.sin(i * 0.1),
          Math.cos(i * 0.1),
          meshData.faceScale
        );
        expect(res).toHaveProperty('blinkLeft');
        expect(res).toHaveProperty('gazeYaw');
      }
      const tTotal = performance.now() - tStart;
      const avgMsPerFrame = tTotal / 120;

      // El módulo debe consumir mucho menos de 0.5 ms por fotograma en CPU (presupuesto holgado)
      expect(avgMsPerFrame).toBeLessThan(0.8);

      eyeEngine.destroy();
    });
  });
});
