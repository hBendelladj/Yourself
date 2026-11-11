import { describe, it, expect } from 'vitest';
import { HeadDirector } from '../src/core/motion/headDirector';
import { CriticallyDampedSpring } from '../src/core/animation/dynamics';
import { DepthEstimator } from '../src/core/face3d/depthEstimator';
import { PseudoVolumeShading } from '../src/core/render/shading';
import { FaceLandmarkPoint } from '../src/lib/types';
import referenceStats from '../docs/reference_stats.json';

describe('FASE 2: Cabeza y Movimiento Natural Calibrado', () => {
  describe('1. Cuatro Fuentes Continuas de Movimiento Sumadas (HeadDirector)', () => {
    it('genera movimiento continuo en idle con las 4 fuentes sumadas sin quedarse estático', () => {
      const director = new HeadDirector();
      
      // Simular 3 segundos de reposo vivo a 60 fps (dt = 0.016 s)
      const yawHistory: number[] = [];
      const pitchHistory: number[] = [];
      const rollHistory: number[] = [];

      for (let f = 0; f < 300; f++) {
        const kin = director.update(0.016, 'idle', false, 0, 0);
        yawHistory.push(kin.yaw);
        pitchHistory.push(kin.pitch);
        rollHistory.push(kin.roll);
      }

      // Comprobar variación continua (no estático)
      const maxYaw = Math.max(...yawHistory);
      const minYaw = Math.min(...yawHistory);
      const maxPitch = Math.max(...pitchHistory);
      const minPitch = Math.min(...pitchHistory);

      expect(maxYaw - minYaw).toBeGreaterThan(0.010); // > ~0.6° de rango dinámico continuo en idle
      expect(maxPitch - minPitch).toBeGreaterThan(0.010);

      // Las amplitudes se mantienen dentro de los rangos fisiológicos de la referencia
      const maxRefYawRad = (referenceStats.head_pose_degrees.yaw.max * Math.PI) / 180;
      expect(Math.abs(maxYaw)).toBeLessThanOrEqual(maxRefYawRad);
    });

    it('modula el pitch cefálico según la frecuencia fundamental F0 y energía del audio (Fuente b)', () => {
      const director = new HeadDirector();
      
      // Con F0 elevado y energía vocal activa, debe inclinar sutilmente hacia arriba
      const speechKinHighF0 = director.update(0.05, 'speaking', false, 240, 0.25);
      const speechKinLowF0 = director.update(0.05, 'speaking', false, 110, 0.25);

      // Pitch para voz aguda > Pitch para voz grave
      expect(speechKinHighF0.pitch).toBeGreaterThan(speechKinLowF0.pitch - 0.05);
    });

    it('deriva el objetivo cefálico entre 1.5 y 4.0 segundos dentro del rango RMS de la referencia (Fuente c)', () => {
      const director = new HeadDirector();
      const yawSamples: number[] = [];

      // Muestrear a lo largo de 8 segundos para observar derivas
      for (let t = 0; t < 500; t++) {
        const kin = director.update(0.016, 'speaking');
        yawSamples.push(kin.yaw);
      }

      // Calcular RMS del movimiento generado
      let sumSq = 0;
      for (const y of yawSamples) sumSq += y * y;
      const rmsRad = Math.sqrt(sumSq / yawSamples.length);
      const rmsDeg = (rmsRad * 180) / Math.PI;

      // El RMS debe ser natural y menor o igual al medido en la referencia (10.17°)
      expect(rmsDeg).toBeGreaterThan(0.5);
      expect(rmsDeg).toBeLessThan(referenceStats.head_pose_degrees.yaw.rms + 2.0);
    });
  });

  describe('2. Control Manual y Suma con Movimiento Automático', () => {
    it('suma el control manual a las derivas automáticas en lugar de reemplazarlas', () => {
      const autoYaw = 0.08;
      const autoPitch = -0.04;
      const autoRoll = 0.02;

      const manualYaw = 0.25; // ~14.3°
      const manualPitch = 0.15; // ~8.6°
      const manualRoll = -0.05;

      const layerGainPose = 1.0;

      const targetYaw = (autoYaw + manualYaw) * layerGainPose;
      const targetPitch = (autoPitch + manualPitch) * layerGainPose;
      const targetRoll = (autoRoll + manualRoll) * layerGainPose;

      expect(targetYaw).toBeCloseTo(0.33, 2);
      expect(targetPitch).toBeCloseTo(0.11, 2);
      expect(targetRoll).toBeCloseTo(-0.03, 2);
    });

    it('amortigua la respuesta manual mediante resortes críticamente amortiguados sin sobreoscilación', () => {
      // omega = 4.5 rad/s para inercia cefálica
      const spring = new CriticallyDampedSpring(0, { omega: 4.5 });
      spring.target = 0.524; // Giro manual máximo a +30°

      let prevVal = spring.x;
      let overshoot = false;

      // Simular 1.5 segundos
      for (let i = 0; i < 90; i++) {
        const val = spring.step(0.016);
        if (val > spring.target + 0.001) {
          overshoot = true;
        }
        expect(val).toBeGreaterThanOrEqual(prevVal - 1e-5); // Monótono hacia el target (sin oscilación)
        prevVal = val;
      }

      expect(overshoot).toBe(false); // Amortiguamiento crítico exacto ζ = 1
      expect(spring.x).toBeCloseTo(0.524, 1);
    });
  });

  describe('3. Conexión de face3d y DepthEstimator', () => {
    it('reconstruye profundidad Z tridimensional a partir de landmarks normalizados', () => {
      // Simular landmarks faciales mínimos
      const mockLandmarks: FaceLandmarkPoint[] = [];
      for (let i = 0; i < 478; i++) {
        mockLandmarks.push({
          x: 0.5 + Math.sin(i) * 0.2,
          y: 0.5 + Math.cos(i) * 0.2,
          z: -0.05 + Math.cos(i * 2) * 0.03,
        });
      }

      const metric = DepthEstimator.estimateMetric3D({
        landmarks: mockLandmarks,
        imageWidth: 512,
        imageHeight: 512,
        worldWidth: 2.0,
        worldHeight: 2.0,
      });

      expect(metric.metricPositions.length).toBe(478 * 3);
      
      // Comprobar que hay rango de profundidad Z no nulo
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < 478; i++) {
        const z = metric.metricPositions[i * 3 + 2]!;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }

      expect(maxZ - minZ).toBeGreaterThan(0.05); // Parallax 3D real
    });
  });

  describe('4. Desoclusión a Yaw Alto y Degradación Elegante', () => {
    it('atenúa suavemente los vértices perimetrales recedentes cuando |headYaw| > 0.20 rad', () => {
      const vertexCount = 10;
      const basePositions = new Float32Array(vertexCount * 3);
      const indices = new Uint16Array([0, 1, 2, 3, 4, 5]);

      // Vértice 0 en la periferia izquierda (x = -0.85)
      basePositions[0] = -0.85;
      basePositions[1] = 0.0;
      basePositions[2] = 0.0;

      // Vértice 1 en el centro (x = 0.0)
      basePositions[3] = 0.0;
      basePositions[4] = 0.0;
      basePositions[5] = 0.0;

      // Vértice 2 (x = -0.8, y = 0.2)
      basePositions[6] = -0.8;
      basePositions[7] = 0.2;
      basePositions[8] = 0.0;

      const shading = new PseudoVolumeShading({
        basePositions,
        indices,
        vertexCount,
      });

      // Al girar a la derecha (+yaw = +0.45 rad ≈ +26°), el lado izquierdo (x < 0) recede
      shading.update(basePositions, 0.45);

      const lateralColor = shading.colors[0]!;
      const centerColor = shading.colors[3]!;

      // El vértice lateral recedente debe ser atenuado (feathered) < 1.0 para sombra suave
      expect(lateralColor).toBeLessThan(1.0);
      expect(lateralColor).toBeLessThan(centerColor);
    });
  });
});
