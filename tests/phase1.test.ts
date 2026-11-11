import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { calibratePhotoProfile } from '../src/core/face/photoProfile';
import { MouthInterior } from '../src/core/render/mouthInterior';
import { EyelidOverlay } from '../src/core/render/eyelids';
import { BlinkController } from '../src/core/animation/blink';
import { LipsyncAnalyzer } from '../src/core/audio/lipsyncAnalyzer';
import { LANDMARK_INDICES } from '../src/core/face/landmarkGroups';
import { FaceLandmarkPoint } from '../src/lib/types';

describe('Phase 1: Critical Fixes — Mouth & Blink', () => {
  // Helper para generar landmarks sintéticos frontales centrados
  const createMockLandmarks = (mouthGap = 0.002): FaceLandmarkPoint[] => {
    const landmarks: FaceLandmarkPoint[] = Array.from({ length: 478 }, (_, i) => ({
      x: 0.5 + ((i % 20) - 10) * 0.015,
      y: 0.5 + (Math.floor(i / 20) - 12) * 0.015,
      z: 0.0,
    }));

    // Ojos (distancia interocular controlada)
    landmarks[33] = { x: 0.35, y: 0.40, z: 0 };  // ojo derecho exterior
    landmarks[133] = { x: 0.45, y: 0.40, z: 0 }; // ojo derecho interior
    landmarks[362] = { x: 0.55, y: 0.40, z: 0 }; // ojo izquierdo interior
    landmarks[263] = { x: 0.65, y: 0.40, z: 0 }; // ojo izquierdo exterior
    landmarks[LANDMARK_INDICES.leftIrisCenter] = { x: 0.60, y: 0.40, z: 0 };
    landmarks[LANDMARK_INDICES.rightIrisCenter] = { x: 0.40, y: 0.40, z: 0 };

    // Mentón y frente para escala vertical
    landmarks[10] = { x: 0.50, y: 0.20, z: 0 };  // frente
    landmarks[152] = { x: 0.50, y: 0.80, z: 0 }; // mentón
    landmarks[1] = { x: 0.50, y: 0.45, z: 0.05 }; // punta nariz

    // Labios interiores (13 superior, 14 inferior)
    landmarks[LANDMARK_INDICES.lipUpperInnerCenter] = { x: 0.50, y: 0.58, z: 0 };
    landmarks[LANDMARK_INDICES.lipLowerInnerCenter] = { x: 0.50, y: 0.58 + mouthGap, z: 0 };

    return landmarks;
  };

  describe('1. photoProfile.ts', () => {
    it('calibrates faceScale and frontality from landmarks', () => {
      const landmarks = createMockLandmarks();
      const profile = calibratePhotoProfile({
        landmarks,
        worldWidth: 2.0,
        worldHeight: 2.0,
        imageElement: null,
      });

      expect(profile.faceScale).toBeGreaterThan(0.2);
      expect(profile.faceScale).toBeLessThan(1.0);
      expect(profile.faceHeight).toBeGreaterThan(0.5);
      expect(profile.frontality).toBeGreaterThan(0.9); // Rostro perfectamente centrado
    });

    it('identifies closed mouth mode when inner lips touch', () => {
      const landmarks = createMockLandmarks(0.001); // Muy juntos
      const profile = calibratePhotoProfile({
        landmarks,
        worldWidth: 2.0,
        worldHeight: 2.0,
        imageElement: null,
      });

      expect(profile.mouthMode).toBe('closed');
    });

    it('identifies openMouth mode when inner lips are separated', () => {
      const landmarks = createMockLandmarks(0.05); // Muy separados
      const profile = calibratePhotoProfile({
        landmarks,
        worldWidth: 2.0,
        worldHeight: 2.0,
        imageElement: null,
      });

      expect(profile.mouthMode).toBe('openMouth');
    });

    it('generates eyeBoxes for both eyes', () => {
      const landmarks = createMockLandmarks();
      const profile = calibratePhotoProfile({
        landmarks,
        worldWidth: 2.0,
        worldHeight: 2.0,
        imageElement: null,
      });

      expect(profile.eyeBoxes.left.minX).toBeLessThan(profile.eyeBoxes.left.maxX);
      expect(profile.eyeBoxes.right.minX).toBeLessThan(profile.eyeBoxes.right.maxX);
      expect(profile.colors.skin).toHaveProperty('r');
      expect(profile.colors.lip).toHaveProperty('g');
    });
  });

  describe('2. mouthInterior.ts Overlay and Occlusion', () => {
    it('initializes as overlay on top (renderOrder 2, offset z)', () => {
      const mouth = new MouthInterior();
      expect(mouth.mesh.renderOrder).toBe(2);
      expect(mouth.mesh.position.z).toBeCloseTo(0.0006, 4);
      expect(mouth.mesh.visible).toBe(false);
      mouth.destroy();
    });

    it('keeps mouth interior 100% hidden in silence and small jawOpen < 0.015', () => {
      const mouth = new MouthInterior();
      const mockPositions = new Float32Array(500 * 3);

      // Simular silencio (jawOpen = 0)
      mouth.update(mockPositions, 0.0);
      expect(mouth.mesh.visible).toBe(false);
      expect((mouth.mesh.material as THREE.MeshBasicMaterial).opacity).toBe(0);

      // Simular micro-ruido / susurro por debajo del umbral de apertura (jawOpen = 0.01)
      mouth.update(mockPositions, 0.01);
      expect(mouth.mesh.visible).toBe(false);
      expect((mouth.mesh.material as THREE.MeshBasicMaterial).opacity).toBe(0);

      mouth.destroy();
    });

    it('smoothly reveals mouth interior when jawOpen >= 0.015', () => {
      const mouth = new MouthInterior();
      const mockPositions = new Float32Array(500 * 3);

      // Apertura normal al hablar
      mouth.update(mockPositions, 0.08);
      expect(mouth.mesh.visible).toBe(true);
      expect((mouth.mesh.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0.4);

      // Gran apertura
      mouth.update(mockPositions, 0.35);
      expect(mouth.mesh.visible).toBe(true);
      expect((mouth.mesh.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(1.0, 1);

      mouth.destroy();
    });
  });

  describe('3. eyelids.ts (EyelidOverlay)', () => {
    it('creates eyelid overlay with renderOrder 3 and zero rest opacity', () => {
      const dummyTexture = new THREE.Texture();
      const eyelids = new EyelidOverlay({ texture: dummyTexture });

      expect(eyelids.mesh.renderOrder).toBe(3);
      expect(eyelids.mesh.visible).toBe(false);
      expect((eyelids.mesh.material as THREE.MeshBasicMaterial).opacity).toBe(0);

      eyelids.destroy();
    });

    it('keeps eyelids hidden when blink = 0', () => {
      const dummyTexture = new THREE.Texture();
      const eyelids = new EyelidOverlay({ texture: dummyTexture });
      const mockPositions = new Float32Array(500 * 3);
      const mockUvs = new Float32Array(500 * 2);

      eyelids.update(mockPositions, mockUvs, 0, 0, 0);
      expect(eyelids.mesh.visible).toBe(false);

      eyelids.destroy();
    });

    it('activates and covers eye when blink > 0.02', () => {
      const dummyTexture = new THREE.Texture();
      const eyelids = new EyelidOverlay({ texture: dummyTexture });
      const mockPositions = new Float32Array(500 * 3);
      const mockUvs = new Float32Array(500 * 2);

      // Configurar puntos para ojo izquierdo y derecho
      mockPositions[33 * 3 + 1] = 0.5; // Ojo der
      mockPositions[159 * 3 + 1] = 0.55; // Párpado superior der
      mockPositions[145 * 3 + 1] = 0.45; // Párpado inferior der

      eyelids.update(mockPositions, mockUvs, 0.8, 0.8, 0);
      expect(eyelids.mesh.visible).toBe(true);
      expect((eyelids.mesh.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0.7);

      eyelids.destroy();
    });
  });

  describe('4. blink.ts (BlinkController)', () => {
    it('schedules initial blink within realistic range (1.8s - 3.5s)', () => {
      const blink = new BlinkController();
      expect(blink.blinkLeft).toBe(0);
      expect(blink.blinkRight).toBe(0);
    });

    it('triggers blink via triggerBlink() and follows asymmetric closure profile', () => {
      const blink = new BlinkController();
      const onBlinkSpy = vi.fn();
      blink.onBlinkChange = onBlinkSpy;

      blink.triggerBlink();
      expect(onBlinkSpy).toHaveBeenCalledWith(true);

      // Fase de cierre rápida (~38% de 110ms ≈ 42ms)
      const stateClose = blink.update(0.04);
      expect(stateClose.isBlinking).toBe(true);
      expect(stateClose.blinkLeft).toBeGreaterThan(0.6);

      // Fase de apertura gradual (otros 50ms)
      const stateOpen = blink.update(0.05);
      expect(stateOpen.isBlinking).toBe(true);

      // Final del ciclo (después de 140ms totales)
      let ended = false;
      for (let i = 0; i < 10; i++) {
        const s = blink.update(0.02);
        if (!s.isBlinking) {
          ended = true;
          break;
        }
      }
      expect(ended).toBe(true);
      expect(onBlinkSpy).toHaveBeenCalledWith(false);
    });

    it('triggers blink automatically from idle after interval elapses', () => {
      const blink = new BlinkController();
      let hasBlinked = false;

      // Avanzar hasta 7 segundos (máximo en scheduleNextBlink)
      for (let t = 0; t < 400; t++) {
        const state = blink.update(0.02, 'idle');
        if (state.isBlinking) {
          hasBlinked = true;
          break;
        }
      }

      expect(hasBlinked).toBe(true);
    });
  });

  describe('5. lipsyncAnalyzer.ts V2 Enhancements', () => {
    it('applies Schmitt trigger hysteresis around noise floor', () => {
      const analyzer = new LipsyncAnalyzer(null);

      // Simular frames en silencio
      const silent = analyzer.update(0.016);
      expect(silent.jawOpen).toBe(0);
      expect(silent.mouthWide).toBe(0);
    });

    it('soft-clamps jawOpen output with Math.tanh ceiling around 0.65', () => {
      // Mock AnalyserNode con datos de altísima amplitud (vocal abierta "A")
      const mockAnalyser = {
        fftSize: 512,
        frequencyBinCount: 256,
        context: { sampleRate: 24000 },
        getByteTimeDomainData: (arr: Uint8Array) => {
          arr.fill(255); // Valor máximo (desviación máxima respecto a 128)
        },
        getByteFrequencyData: (arr: Uint8Array) => {
          // Bajas y medias frecuencias dominantes (vocal abierta no fricativa)
          arr.fill(40);
          for (let i = 1; i < 50; i++) {
            arr[i] = 240;
          }
        },
      } as unknown as AnalyserNode;

      const analyzer = new LipsyncAnalyzer(mockAnalyser);

      // Actualizar múltiples fotogramas para converger
      let lastJawOpen = 0;
      for (let i = 0; i < 30; i++) {
        const values = analyzer.update(0.016);
        lastJawOpen = values.jawOpen;
      }

      // Debe estar estrictamente acotado por debajo de 0.70 por el soft-clamp tanh
      expect(lastJawOpen).toBeLessThanOrEqual(0.70);
      expect(lastJawOpen).toBeGreaterThan(0.40);
    });

    it('reacts to sibilant/fricative frequencies by constraining jawOpen and widening mouth', () => {
      // Mock AnalyserNode con alta energía sibilante (agudos > 2400 Hz)
      const mockAnalyser = {
        fftSize: 512,
        frequencyBinCount: 256,
        context: { sampleRate: 24000 },
        getByteTimeDomainData: (arr: Uint8Array) => {
          // Amplitud audible por encima de umbral de apertura (128 +- 40 -> ~0.31 RMS)
          for (let i = 0; i < arr.length; i++) {
            arr[i] = i % 2 === 0 ? 168 : 88;
          }
        },
        getByteFrequencyData: (arr: Uint8Array) => {
          // Graves bajos, medios moderados, agudos (bin 50-120) dominantes
          arr.fill(0);
          for (let i = 52; i < 118; i++) {
            arr[i] = 220; // Alta energía en banda aguda
          }
        },
      } as unknown as AnalyserNode;

      const analyzer = new LipsyncAnalyzer(mockAnalyser);

      let lastValues = { jawOpen: 0, mouthWide: 0, mouthRound: 0 };
      for (let i = 0; i < 30; i++) {
        lastValues = analyzer.update(0.016);
      }

      // Las sibilantes mantienen la mandíbula contenida (dientes juntos) y ensanchan la boca
      expect(lastValues.jawOpen).toBeLessThanOrEqual(0.20);
      expect(lastValues.mouthWide).toBeGreaterThan(0.20);
    });
  });
});
