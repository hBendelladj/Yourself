/**
 * vorCoordination.test.ts
 *
 * Test de Coordinación VOR, Biomecánica Cefálica y Memoria Temporal (YourSelf V3 - Fase 3 / Sección 18.4):
 * - Aplica un giro de cabeza en Yaw de +10°; comprueba que la mirada (gazeX) genera una respuesta compensatoria
 *   en dirección contraria (Reflejo Vestíbulo-Ocular con ganancia k_vor ≈ 0.95).
 * - Verifica la memoria temporal antirrepetición en ventanas menores a 12 segundos (Markov de 2º orden).
 * - Verifica el repertorio gestual de cabeza (nod, double nod, shake, curious tilt).
 */

import { describe, it, expect } from 'vitest';
import { VORCoordinator } from '../src/core/motion/vorCoordinator';
import { MotionMemory } from '../src/core/motion/motionMemory';
import { HeadDirector } from '../src/core/motion/headDirector';
import { GazeDirector } from '../src/core/motion/gazeDirector';

describe('V3 Phase 3: VOR Coordination, Head Biomechanics and Motion Memory', () => {
  describe('1. Vestibulo-Ocular Reflex (VOR) Coordination (Section 18.4)', () => {
    it('produces compensatory opposite gaze response when head rotates in yaw', () => {
      const vor = new VORCoordinator({ vorGain: 0.95 });

      // Fotograma 0: reposo (cabeza a 0 rad)
      vor.update(0.016, 0.0, 0.0, 0.0, 0.0);

      // Fotograma 1: giro rápido de cabeza hacia la derecha (+10 grados ≈ +0.1745 rad en 50 ms)
      // Velocidad angular ω = 0.1745 / 0.05 ≈ +3.49 rad/s
      const state = vor.update(0.05, 0.0, 0.0, 0.1745, 0.0);

      // La compensación de mirada debe ser negativa (hacia la izquierda)
      expect(state.headAngularVelYaw).toBeGreaterThan(3.0);
      expect(state.compensatedGazeX).toBeLessThan(-0.02);
    });

    it('schedules saccade with anticipation delay prior to head movement', () => {
      const vor = new VORCoordinator();

      vor.scheduleSaccadeWithAnticipation(0.20, 0.10, 80);
      const pending = vor.getPendingHeadTarget();

      expect(pending.yaw).toBeCloseTo(0.20);
      expect(pending.pitch).toBeCloseTo(0.10);

      // En el primer fotograma (16 ms) debe estar aún en fase de anticipación
      const state1 = vor.update(0.016, 0.0, 0.0, 0.0, 0.0);
      expect(state1.isAnticipating).toBe(true);

      // Tras 100 ms debe haber concluido la anticipación
      const state2 = vor.update(0.10, 0.0, 0.0, 0.0, 0.0);
      expect(state2.isAnticipating).toBe(false);
    });
  });

  describe('2. MotionMemory: 2nd-Order Markov Chain and Temporal Entropy', () => {
    it('penalizes immediate repetition of the same gesture (cooldown < 3s)', () => {
      const memory = new MotionMemory(12.0);

      // Registrado en t = 1.0 s
      memory.recordGesture('nod', 1.0);

      // En t = 1.5 s, la probabilidad de repetir 'nod' debe estar severamente penalizada
      const weightImmediate = memory.getSelectionWeight('nod', 1.5);
      expect(weightImmediate).toBeLessThanOrEqual(0.10);

      // Para otro gesto no registrado ('shake'), el peso debe permanecer intacto (1.0)
      const weightOther = memory.getSelectionWeight('shake', 1.5);
      expect(weightOther).toBeCloseTo(1.0);
    });

    it('penalizes alternating repetitive loops (A-B-A-B pattern)', () => {
      const memory = new MotionMemory(12.0);

      // Simular patrón alternante: nod (0s) -> shake (2s) -> nod (4s)
      memory.recordGesture('nod', 0.0);
      memory.recordGesture('shake', 2.0);
      memory.recordGesture('nod', 4.0);

      // En t = 5s, el peso de 'shake' (segundo orden) debe estar penalizado
      const weightShake = memory.getSelectionWeight('shake', 5.0);
      expect(weightShake).toBeLessThan(0.30);
    });

    it('restores full selection probability after 12 seconds have elapsed', () => {
      const memory = new MotionMemory(12.0);

      memory.recordGesture('curious_tilt', 0.0);

      // A los 13 segundos (superado el cooldown), debe recuperar peso 1.0
      const weightAfterCooldown = memory.getSelectionWeight('curious_tilt', 13.0);
      expect(weightAfterCooldown).toBeCloseTo(1.0);
    });
  });

  describe('3. HeadDirector and Gestural Dynamics', () => {
    it('executes nod trajectory with smooth pitch descent and return', () => {
      const director = new HeadDirector();

      director.triggerGesture('nod', 0.60);

      // A medio camino (0.30 s / 50% de progreso): pico de pitch positivo
      const mid = director.update(0.30);
      expect(mid.pitch).toBeGreaterThan(0.04);
      expect(mid.isExecutingGesture).toBe(true);

      // Al final (otros 0.35 s): retorno a reposo
      const end = director.update(0.35);
      expect(end.isExecutingGesture).toBe(false);
      expect(end.pitch).toBeCloseTo(0.0, 2);
    });

    it('executes head shake trajectory with yaw oscillation', () => {
      const director = new HeadDirector();

      director.triggerGesture('shake', 0.80);

      // Al primer octavo (0.10 s = pico de la primera oscilación): oscilación hacia un lado en yaw
      const q1 = director.update(0.10);
      expect(Math.abs(q1.yaw)).toBeGreaterThan(0.04);

      // Avanzar al siguiente semiciclo
      const q2 = director.update(0.20);
      expect(director.kinematics.currentGesture).toBe('shake');
    });

    it('executes curious tilt with coordinated roll and yaw', () => {
      const director = new HeadDirector();

      director.triggerGesture('curious_tilt', 1.0);

      const mid = director.update(0.50);
      expect(mid.roll).toBeGreaterThan(0.02);
      expect(mid.yaw).toBeLessThan(0.0); // Yaw opuesto al roll
    });
  });

  describe('4. GazeDirector with VOR Integration', () => {
    it('combines fixation, microtremor and VOR smoothly without jumps', () => {
      const gaze = new GazeDirector();

      // Fotograma con cabeza estática
      const g0 = gaze.update(0.016, 0.0, 0.0, 'idle');
      expect(Math.abs(g0.x)).toBeLessThan(0.5);
      expect(Math.abs(g0.y)).toBeLessThan(0.5);

      // VASA-1 override
      gaze.setGazeTarget({ x: 0.30, y: -0.20 });
      for (let i = 0; i < 15; i++) {
        gaze.update(0.016, 0.0, 0.0, 'idle');
      }

      const finalGaze = gaze.update(0.016, 0.0, 0.0, 'idle');
      expect(finalGaze.x).toBeCloseTo(0.30, 1);
      expect(finalGaze.y).toBeCloseTo(-0.20, 1);
    });
  });
});
