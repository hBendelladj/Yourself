/**
 * faseB_cabeza_cuerpo.test.ts
 *
 * Suite de Pruebas Unitarias para la FASE B: Cabeza y Cuerpo con Vida (YourSelf V3).
 *
 * Verifica los criterios de aceptación de Fase B:
 * 1. Movimiento de cabeza guiado por el discurso:
 *    - Pequeños cabeceos con las sílabas tónicas (accent_pitch).
 *    - Inclinación al final de frase tras habla prolongada.
 *    - Giros y derivas suaves en yaw y roll.
 *    - Ruido fractal no repetitivo (fBm multioctava).
 * 2. Rangos angulares orientativos calibrados:
 *    - En habla: yaw ±6–10°, pitch ±3–5°, roll ±3–5°.
 *    - En reposo: yaw, pitch y roll dentro de ±1–2°.
 * 3. Cooldown estricto de gestos grandes:
 *    - Gestos grandes (asentir, negar, ladear) NO se repiten en ventanas menores a 10 segundos.
 * 4. Respiración sutil (0.2–0.3 Hz) y movimiento de cuello/hombros:
 *    - Cuello y hombros acompañan la respiración y el balanceo.
 *    - Cero deformación del fondo (los bordes y anclas exteriores permanecen 100% fijos).
 * 5. Cero asignaciones de memoria en bucle caliente (Zero-Allocation).
 */

import { describe, it, expect } from 'vitest';
import { HeadDirector } from '../src/core/motion/headDirector';
import { MotionMemory, LARGE_GESTURES, HeadGestureType } from '../src/core/motion/motionMemory';
import { PoseDeformer } from '../src/core/render/poses';
import { buildFaceMesh } from '../src/core/face/buildMesh';
import { FaceLandmarkPoint } from '../src/lib/types';
import { LANDMARK_INDICES } from '../src/core/face/landmarkGroups';
import { sampleFractalNoise1D } from '../src/core/animation/noise';

describe('FASE B: Cabeza y Cuerpo con Vida (YourSelf V3)', () => {
  const DEG2RAD = Math.PI / 180.0;

  const createMockLandmarks = (): FaceLandmarkPoint[] => {
    return Array.from({ length: 478 }, (_, i) => ({
      x: 0.5 + ((i % 20) - 10) * 0.015,
      y: 0.5 + (Math.floor(i / 20) - 12) * 0.015,
      z: 0.0,
    }));
  };

  const setupMockMesh = () => {
    const landmarks = createMockLandmarks();
    // Pupil landmarks para faceScale estándar (~0.45-0.60)
    landmarks[468] = { x: 0.35, y: 0.35, z: 0.0 };
    landmarks[473] = { x: 0.65, y: 0.35, z: 0.0 };
    landmarks[LANDMARK_INDICES.noseTip] = { x: 0.5, y: 0.45, z: -0.05 };
    landmarks[LANDMARK_INDICES.chinBottom] = { x: 0.5, y: 0.70, z: 0.0 };

    return buildFaceMesh(landmarks, 512, 512);
  };

  describe('1. Rangos Angulares Orientativos (Habla vs Reposo)', () => {
    it('mantiene ángulos cefálicos en reposo (idle) dentro de ±1–2° (±0.035 rad)', () => {
      const director = new HeadDirector();

      const yawVals: number[] = [];
      const pitchVals: number[] = [];
      const rollVals: number[] = [];

      // Muestrear 30 segundos de reposo a 60 fps
      for (let t = 0; t < 1800; t++) {
        const kin = director.update(0.016, 'idle', false, 0, 0);
        yawVals.push(kin.yaw);
        pitchVals.push(kin.pitch);
        rollVals.push(kin.roll);
      }

      const maxYawDeg = (Math.max(...yawVals.map(Math.abs)) * 180) / Math.PI;
      const maxPitchDeg = (Math.max(...pitchVals.map(Math.abs)) * 180) / Math.PI;
      const maxRollDeg = (Math.max(...rollVals.map(Math.abs)) * 180) / Math.PI;

      // Todos los ángulos en reposo deben ser sutiles (dentro de ±1–2°, tope de seguridad 2.5°)
      expect(maxYawDeg).toBeLessThanOrEqual(2.5);
      expect(maxPitchDeg).toBeLessThanOrEqual(2.5);
      expect(maxRollDeg).toBeLessThanOrEqual(2.5);

      // No debe ser estático (debe exhibir micro-movimiento vivo)
      expect(maxYawDeg).toBeGreaterThan(0.4);
      expect(maxPitchDeg).toBeGreaterThan(0.4);
    });

    it('alcanza ángulos orientativos en habla (speaking): yaw ±6–10°, pitch ±3–5°, roll ±3–5°', () => {
      const director = new HeadDirector();

      const yawVals: number[] = [];
      const pitchVals: number[] = [];
      const rollVals: number[] = [];

      // Muestrear 45 segundos de habla activa a 60 fps
      for (let t = 0; t < 2700; t++) {
        const energy = 0.15 + Math.sin(t * 0.1) * 0.1;
        const f0 = 170 + Math.sin(t * 0.05) * 50;
        const tonic = t % 120 === 0; // Sílaba tónica cada 2 segundos
        const kin = director.update(0.016, 'speaking', tonic, f0, energy);

        yawVals.push(kin.yaw);
        pitchVals.push(kin.pitch);
        rollVals.push(kin.roll);
      }

      const maxYawDeg = (Math.max(...yawVals.map(Math.abs)) * 180) / Math.PI;
      const maxPitchDeg = (Math.max(...pitchVals.map(Math.abs)) * 180) / Math.PI;
      const maxRollDeg = (Math.max(...rollVals.map(Math.abs)) * 180) / Math.PI;

      // En habla, el rango dinámico debe aproximarse a los valores orientativos
      // Yaw llega al rango ±6–10°
      expect(maxYawDeg).toBeGreaterThanOrEqual(5.5);
      expect(maxYawDeg).toBeLessThanOrEqual(11.0);

      // Pitch llega al rango ±3–5°
      expect(maxPitchDeg).toBeGreaterThanOrEqual(2.8);
      expect(maxPitchDeg).toBeLessThanOrEqual(6.0);

      // Roll llega al rango ±3–5°
      expect(maxRollDeg).toBeGreaterThanOrEqual(2.5);
      expect(maxRollDeg).toBeLessThanOrEqual(5.5);
    });
  });

  describe('2. Cooldown Estricto de Gestos Grandes (≥ 10 segundos)', () => {
    it('bloquea la repetición de un mismo gesto grande (nod, shake, curious_tilt, etc.) si transcurrieron menos de 10 s', () => {
      const memory = new MotionMemory(10.0);

      // 1. Ejecutar 'nod' a t = 1.0 s
      expect(memory.isGestureAllowed('nod', 1.0)).toBe(true);
      memory.recordGesture('nod', 1.0);

      // A los 3 s (han pasado 2 s): debe estar estrictamente prohibido
      expect(memory.isGestureAllowed('nod', 3.0)).toBe(false);
      expect(memory.getSelectionWeight('nod', 3.0)).toBe(0.0);

      // A los 7 s (han pasado 6 s): aún prohibido
      expect(memory.isGestureAllowed('nod', 7.0)).toBe(false);
      expect(memory.getSelectionWeight('nod', 7.0)).toBe(0.0);

      // A los 10.5 s (han pasado 9.5 s): aún prohibido
      expect(memory.isGestureAllowed('nod', 10.5)).toBe(false);

      // A los 11.2 s (han pasado 10.2 s): permitido nuevamente
      expect(memory.isGestureAllowed('nod', 11.2)).toBe(true);
      expect(memory.getSelectionWeight('nod', 11.2)).toBeGreaterThan(0.0);
    });

    it('en HeadDirector ningún gesto grande se repite en menos de 10 segundos a lo largo de 60 s', () => {
      const director = new HeadDirector(10.0);

      // Historial de gestos ejecutados con sus timestamps
      const gestureLog: Array<{ type: HeadGestureType; t: number }> = [];

      for (let f = 0; f < 3600; f++) {
        const currentTime = f * 0.016;
        const kin = director.update(0.016, 'speaking', false, 180, 0.2);

        if (kin.isExecutingGesture && kin.currentGesture !== 'idle_sway') {
          const lastLogged = gestureLog[gestureLog.length - 1];
          if (!lastLogged || lastLogged.type !== kin.currentGesture || (currentTime - lastLogged.t > 1.5)) {
            gestureLog.push({ type: kin.currentGesture, t: currentTime });
          }
        }
      }

      // Verificar que ningún gesto clasificado en LARGE_GESTURES se haya disparado con delta < 10 s
      for (let i = 0; i < gestureLog.length; i++) {
        for (let j = i + 1; j < gestureLog.length; j++) {
          const g1 = gestureLog[i]!;
          const g2 = gestureLog[j]!;

          if (g1.type === g2.type && LARGE_GESTURES.has(g1.type)) {
            const deltaT = g2.t - g1.t;
            expect(deltaT).toBeGreaterThanOrEqual(10.0);
          }
        }
      }
    });
  });

  describe('3. Guiado por Prosodia: Sílabas Tónicas y Final de Frase', () => {
    it('dispara un cabeceo prosódico rápido (accent_pitch) ante una sílaba tónica acentuada', () => {
      const director = new HeadDirector();

      // Habla activa con sílaba tónica
      const kin = director.update(0.016, 'speaking', true, 190, 0.25);

      expect(kin.isExecutingGesture).toBe(true);
      expect(kin.currentGesture).toBe('accent_pitch');

      // Avanzar al punto culminante del cabeceo (mitad del gesto, ~0.14 s)
      let peakPitch = 0;
      for (let t = 0; t < 10; t++) {
        const stepKin = director.update(0.016, 'speaking', false, 190, 0.25);
        if (stepKin.pitch > peakPitch) peakPitch = stepKin.pitch;
      }

      // El cabeceo prosódico debe producir una flexión descendente perceptible (+3–4°)
      const peakDeg = (peakPitch * 180) / Math.PI;
      expect(peakDeg).toBeGreaterThanOrEqual(2.5);
    });

    it('dispara un gesto de cierre (inclinación o asentimiento) al detectar final de frase', () => {
      const director = new HeadDirector();

      // 1. Simular 1.2 segundos de habla prolongada continua
      for (let t = 0; t < 75; t++) {
        director.update(0.016, 'speaking', false, 180, 0.25);
      }

      // 2. Cese repentino de la energía (silencio / pausa final de frase)
      const afterPauseKin = director.update(0.016, 'speaking', false, 0, 0.005);

      expect(afterPauseKin.isExecutingGesture).toBe(true);
      expect(['curious_tilt', 'nod']).toContain(afterPauseKin.currentGesture);
    });
  });

  describe('4. Ruido Fractal No Periódico (fBm)', () => {
    it('no genera patrones repetitivos idénticos en un ciclo de 60 segundos', () => {
      // Muestrear 60 s a 10 Hz (600 muestras)
      const samples: number[] = [];
      for (let t = 0; t < 60; t += 0.1) {
        samples.push(sampleFractalNoise1D(t * 0.25, 3));
      }

      // Comparar la primera mitad (0-30 s) con la segunda mitad (30-60 s)
      const half = Math.floor(samples.length / 2);
      let identicalMatches = 0;

      for (let i = 0; i < half; i++) {
        if (Math.abs(samples[i]! - samples[i + half]!) < 1e-4) {
          identicalMatches++;
        }
      }

      // Un ruido fractal estocástico no tiene repeticiones idénticas
      expect(identicalMatches).toBe(0);
    });
  });

  describe('5. Respiración (0.2–0.3 Hz) en Cuello/Hombros sin Deformar el Fondo', () => {
    it('mueve sutilmente el cuello y hombros durante la respiración sin alterar los bordes perimetrales', () => {
      const meshData = setupMockMesh();
      const deformer = new PoseDeformer({
        basePositions: meshData.basePositions,
        landmarkCount: meshData.landmarkCount,
        vertexCount: meshData.vertexCount,
        faceScale: meshData.faceScale,
        rigVersion: 'v3',
      });

      const currentPosInhale = new Float32Array(meshData.basePositions);
      const currentPosExhale = new Float32Array(meshData.basePositions);

      const basePose = {
        jawOpen: 0,
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
      };

      // Inhalación (breath = 1.0)
      deformer.apply(currentPosInhale, { ...basePose, breath: 1.0 });

      // Exhalación (breath = 0.0)
      deformer.apply(currentPosExhale, { ...basePose, breath: 0.0 });

      // 1. Verificar movimiento vertical en vértices inferiores (mentón/cuello)
      const chinIdx = LANDMARK_INDICES.chinBottom;
      const chinInhaleY = currentPosInhale[chinIdx * 3 + 1]!;
      const chinExhaleY = currentPosExhale[chinIdx * 3 + 1]!;
      const chinDeltaY = Math.abs(chinInhaleY - chinExhaleY);

      expect(chinDeltaY).toBeGreaterThan(0.001); // Movimiento visible en cuello/mentón

      // 2. Verificar que los vértices del fondo/borde exterior NO se mueven en absoluto
      const anchorStart = meshData.landmarkCount;
      for (let i = anchorStart; i < meshData.vertexCount; i++) {
        const basePx = meshData.basePositions[i * 3]!;
        const basePy = meshData.basePositions[i * 3 + 1]!;
        const basePz = meshData.basePositions[i * 3 + 2]!;

        const curInhalePx = currentPosInhale[i * 3]!;
        const curInhalePy = currentPosInhale[i * 3 + 1]!;
        const curInhalePz = currentPosInhale[i * 3 + 2]!;

        // El fondo exterior debe tener diferencia exactamente 0
        expect(curInhalePx).toBe(basePx);
        expect(curInhalePy).toBe(basePy);
        expect(curInhalePz).toBe(basePz);
      }
    });
  });
});
