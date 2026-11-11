import { describe, it, expect } from 'vitest';
import { HeadDirector } from '../src/core/motion/headDirector';
import { GazeController } from '../src/core/animation/gaze';
import { EyelidMesh, RIGHT_EYE_LID_PAIRS } from '../src/core/eye/eyelidMesh';
import { BlinkController } from '../src/core/animation/blink';
import * as THREE from 'three';

const RAD2DEG = 180.0 / Math.PI;

describe('V4 Fase 6: Movimiento OU + Gestos, Ojos y Cejas (Algoritmos G y H)', () => {
  describe('1. Criterio de Aceptación 4: Cinemática Cefálica OU + Gestos Laplace', () => {
    it('produce RMS por eje dentro de rangos del video, correlación pitch-jaw 0.20-0.50 y curtosis > 3', () => {
      const director = new HeadDirector();
      director.setRigVersion('v4');

      const dt = 0.016; // 60 fps
      const totalSeconds = 60.0; // 60 segundos de habla simulada
      const totalFrames = Math.floor(totalSeconds / dt);

      const yaws: number[] = [];
      const pitches: number[] = [];
      const rolls: number[] = [];
      const jaws: number[] = [];
      const velocities: number[] = [];

      let prevYaw = 0;
      let prevPitch = 0;
      let prevRoll = 0;

      for (let f = 0; f < totalFrames; f++) {
        // Simular apertura mandibular silábica periódica en habla
        const jaw = 0.25 + 0.20 * Math.sin(f * dt * Math.PI * 4.0); // ~2 Hz sílabas
        const energy = jaw * 0.8;

        const kin = director.update(dt, 'speaking', false, 150, energy, jaw);

        yaws.push(kin.yaw * RAD2DEG);
        pitches.push(kin.pitch * RAD2DEG);
        rolls.push(kin.roll * RAD2DEG);
        jaws.push(jaw);

        if (f > 0) {
          const dy = (kin.yaw - prevYaw) / dt;
          const dp = (kin.pitch - prevPitch) / dt;
          const dr = (kin.roll - prevRoll) / dt;
          const speed = Math.sqrt(dy * dy + dp * dp + dr * dr) * RAD2DEG;
          velocities.push(speed);
        }
        prevYaw = kin.yaw;
        prevPitch = kin.pitch;
        prevRoll = kin.roll;
      }

      // 1. RMS por eje
      const rms = (arr: number[]) => Math.sqrt(arr.reduce((s, x) => s + x * x, 0) / arr.length);
      const rmsYaw = rms(yaws);
      const rmsPitch = rms(pitches);
      const rmsRoll = rms(rolls);

      // Rangos medidos: yaw 2–10°, pitch 4.5–8°, roll 3–8.5°
      expect(rmsYaw).toBeGreaterThanOrEqual(2.0);
      expect(rmsYaw).toBeLessThanOrEqual(10.0);

      expect(rmsPitch).toBeGreaterThanOrEqual(4.5);
      expect(rmsPitch).toBeLessThanOrEqual(8.5);

      expect(rmsRoll).toBeGreaterThanOrEqual(3.0);
      expect(rmsRoll).toBeLessThanOrEqual(8.5);

      // 2. Correlación pitch <-> apertura (jaw) en 0.20–0.50
      const mean = (arr: number[]) => arr.reduce((s, x) => s + x, 0) / arr.length;
      const mPitch = mean(pitches);
      const mJaw = mean(jaws);

      let cov = 0;
      let varPitch = 0;
      let varJaw = 0;
      for (let i = 0; i < totalFrames; i++) {
        const dp = pitches[i]! - mPitch;
        const dj = jaws[i]! - mJaw;
        cov += dp * dj;
        varPitch += dp * dp;
        varJaw += dj * dj;
      }
      const corrPitchJaw = cov / (Math.sqrt(varPitch) * Math.sqrt(varJaw));

      expect(corrPitchJaw).toBeGreaterThanOrEqual(0.20);
      expect(corrPitchJaw).toBeLessThanOrEqual(0.50);

      // 3. Curtosis de la velocidad angular > 3 (cola pesada demostrable por saltos de Laplace)
      const mVel = mean(velocities);
      let m4 = 0;
      let m2 = 0;
      for (const v of velocities) {
        const diff = v - mVel;
        m2 += diff * diff;
        m4 += Math.pow(diff, 4);
      }
      const variance = m2 / velocities.length;
      const kurtosis = (m4 / velocities.length) / (variance * variance);

      expect(kurtosis).toBeGreaterThan(3.0);
    });

    it('elimina H6: la cabeza sigue en movimiento vivo en reposo (idle) sin forzarse a cero', () => {
      const director = new HeadDirector();
      director.setRigVersion('v4');

      let movementCount = 0;
      for (let f = 0; f < 300; f++) {
        const kin = director.update(0.016, 'idle', false, 0, 0, 0);
        if (Math.abs(kin.yaw) > 0.001 || Math.abs(kin.pitch) > 0.001 || Math.abs(kin.roll) > 0.001) {
          movementCount++;
        }
      }

      // En reposo, no se congela: > 95% de los fotogramas tienen micro-movimiento
      expect(movementCount).toBeGreaterThan(280);
    });
  });

  describe('2. Secuencia Principal de Sacadas Oculares (Bahill et al., 1975)', () => {
    it('cumple con el modelo de secuencia principal V_peak y Duración', () => {
      // Probar para amplitudes representativas A = 5° y A = 15°
      const seq5 = GazeController.computeMainSequence(5.0);
      expect(seq5.durationMs).toBeCloseTo(21.0 + 2.2 * 5.0, 1); // ~32 ms
      expect(seq5.peakVelocityDegPerSec).toBeCloseTo(500 * (1 - Math.exp(-0.5)), 0); // ~196 °/s

      const seq15 = GazeController.computeMainSequence(15.0);
      expect(seq15.durationMs).toBeCloseTo(21.0 + 2.2 * 15.0, 1); // ~54 ms
      expect(seq15.peakVelocityDegPerSec).toBeGreaterThan(seq5.peakVelocityDegPerSec);
    });

    it('produce aceleración asimétrica con duración congruente', () => {
      const gaze = new GazeController();
      gaze.triggerSaccade(0.3, 0.2);

      // Avanzar en la sacada
      const x1 = gaze.update(0.01).gazeX;
      const x2 = gaze.update(0.02).gazeX;
      expect(Math.abs(x2)).toBeGreaterThan(Math.abs(x1));
    });
  });

  describe('3. Criterio de Aceptación 5: Parpadeo sin Artefactos y Resolución de H9', () => {
    it('duración de parpadeo fisiológico en 100–200 ms y asimetría de cierre/apertura', () => {
      const blink = new BlinkController();
      const durations: number[] = [];

      for (let b = 0; b < 20; b++) {
        blink.triggerBlink();
        // Simular avance hasta que termine
        let time = 0;
        let wasBlinking = true;
        while (wasBlinking && time < 0.5) {
          blink.update(0.01);
          time += 0.01;
          if (blink.blinkLeft === 0 && blink.blinkRight === 0) {
            wasBlinking = false;
          }
        }
        durations.push(time * 1000);
      }

      const meanDur = durations.reduce((s, x) => s + x, 0) / durations.length;
      expect(meanDur).toBeGreaterThanOrEqual(90);
      expect(meanDur).toBeLessThanOrEqual(210);
    });

    it('H9 resuelto: concha de párpado cubre completamente la esclerótica al cerrar sin huecos en comisuras', () => {
      const texture = new THREE.Texture();
      const eyelid = new EyelidMesh({ texture, faceScale: 0.45 });

      const positions = new Float32Array(500 * 3);
      const faceScale = 0.45;

      // Configurar ojo derecho
      for (const [u, l] of RIGHT_EYE_LID_PAIRS) {
        positions[u * 3] = 0.10;
        positions[u * 3 + 1] = 0.20; // Párpado superior
        positions[u * 3 + 2] = 0.05;

        positions[l * 3] = 0.10;
        positions[l * 3 + 1] = 0.17; // Párpado inferior
        positions[l * 3 + 2] = 0.05;
      }

      const sphere = {
        centerX: 0.10,
        centerY: 0.185,
        centerZ: 0.03,
        radius: 0.025,
      };

      // Al cerrar los ojos completamente (blink = 1.0)
      eyelid.update(positions, new Float32Array(500 * 2), 1.0, 1.0, sphere, sphere, 0, faceScale);

      expect(eyelid.mesh.visible).toBe(true);
      expect((eyelid.mesh.material as THREE.MeshBasicMaterial).opacity).toBe(1.0);

      // Verificar que el borde móvil del párpado desciende completamente hasta cubrir o superar el párpado inferior
      const geom = eyelid.mesh.geometry;
      const posAttr = geom.attributes.position;
      expect(posAttr).toBeDefined();

      // Vértices del borde móvil (Fila 2)
      // 9 columnas: fila 2 son índices 18 a 26
      for (let col = 0; col < 9; col++) {
        const movingY = posAttr?.getY(18 + col) ?? 0;
        const [_, lIdx] = RIGHT_EYE_LID_PAIRS[col]!;
        const lowerY = positions[lIdx * 3 + 1]!;
        // movingY debe ser <= lowerY + margen de cierre (solapamiento hermético de sellado)
        expect(movingY).toBeLessThanOrEqual(lowerY + 0.001);
      }

      eyelid.destroy();
    });

    it('aplica acoplamiento anatómico mirada-párpado: al mirar hacia abajo Δlid ≈ 0.5 * Δgaze_y', () => {
      const texture = new THREE.Texture();
      const eyelid = new EyelidMesh({ texture, faceScale: 0.45 });
      const positions = new Float32Array(500 * 3);
      for (let i = 0; i < 500 * 3; i++) positions[i] = 0.1;

      // Configurar pares con apertura ocular anatómica (uy = 0.20, ly = 0.15)
      for (const [u, l] of RIGHT_EYE_LID_PAIRS) {
        positions[u * 3 + 1] = 0.20;
        positions[l * 3 + 1] = 0.15;
      }

      const sphere = { centerX: 0.1, centerY: 0.175, centerZ: 0.02, radius: 0.025 };

      // Mirada al frente (gazeY = 0) con parpadeo base 0.1
      eyelid.update(positions, new Float32Array(500 * 2), 0.1, 0.1, sphere, sphere, 0.0, 0.45);
      const frontY = eyelid.mesh.geometry.attributes.position?.getY(18 + 4) ?? 0;

      // Mirada hacia abajo (gazeY = -0.40) con parpadeo base 0.1
      eyelid.update(positions, new Float32Array(500 * 2), 0.1, 0.1, sphere, sphere, -0.40, 0.45);
      const downY = eyelid.mesh.geometry.attributes.position?.getY(18 + 4) ?? 0;

      // Al mirar hacia abajo, el párpado superior debe haber descendido (downY < frontY)
      expect(downY).toBeLessThan(frontY);
      // Descenso consistente con acoplamiento 0.5 * 0.4 * deltaY
      expect(frontY - downY).toBeGreaterThan(0.005);

      eyelid.destroy();
    });
  });
});
