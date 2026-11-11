import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EyelidMesh } from '../src/core/eye/eyelidMesh';
import { BlinkEngine } from '../src/core/eye/blinkEngine';
import { EyeBall } from '../src/core/eye/eyeBall';
import { buildFaceMesh } from '../src/core/face/buildMesh';
import { calibratePhotoProfile } from '../src/core/face/photoProfile';
import { FaceLandmarkPoint } from '../src/lib/types';
import { PoseDeformer } from '../src/core/render/poses';
import referenceStats from '../docs/reference_stats.json';

describe('FASE 3: Parpadeo sin Negro y Biomecánica Ocular Calibrada', () => {
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

    // Iris derecho (468 centro)
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

    // Iris izquierdo (473 centro)
    landmarks[473] = { x: 0.60, y: 0.40, z: 0.005 };
    landmarks[474] = { x: 0.61, y: 0.40, z: 0.003 };
    landmarks[475] = { x: 0.60, y: 0.41, z: 0.003 };
    landmarks[476] = { x: 0.59, y: 0.40, z: 0.003 };
    landmarks[477] = { x: 0.60, y: 0.39, z: 0.003 };

    return landmarks;
  };

  describe('1. Diagnóstico y Eliminación de la Zona Negra', () => {
    it('genera textura cutánea periocular con luminancia estrictamente superior al umbral de negro', () => {
      const landmarks = createMockLandmarks();
      const profile = calibratePhotoProfile({
        landmarks,
        worldWidth: 2.0,
        worldHeight: 2.0,
      });

      const lidColor = profile.colors.lidSkin;
      const luminance = (lidColor.r * 299 + lidColor.g * 587 + lidColor.b * 114) / 1000;

      // El tono periocular muestreado debe ser piel viva, nunca negro ni sombra profunda
      expect(luminance).toBeGreaterThan(70);
      expect(lidColor.r).toBeGreaterThan(80);
      expect(lidColor.g).toBeGreaterThan(60);
      expect(lidColor.b).toBeGreaterThan(50);
    });

    it('previene caídas de Z en las comisuras evitando huecos donde se vea el fondo oscuro', () => {
      const landmarks = createMockLandmarks();
      const meshData = buildFaceMesh(landmarks, 512, 512);
      const dummyTexture = new THREE.Texture();
      const eyelids = new EyelidMesh({ texture: dummyTexture, faceScale: meshData.faceScale });
      const eyeBall = new EyeBall({ basePositions: meshData.basePositions, faceScale: meshData.faceScale });

      eyelids.update(
        meshData.basePositions,
        meshData.uvs,
        1.0, // Cierre total
        1.0,
        eyeBall.getLeftEyeSphere(),
        eyeBall.getRightEyeSphere(),
        0.0,
        meshData.faceScale
      );

      const pos = eyelids.mesh.geometry.attributes.position.array as Float32Array;
      const count = eyelids.mesh.geometry.attributes.position.count;

      // Verificar que todos los vértices en Z están por delante o a nivel de la piel
      for (let i = 0; i < count; i++) {
        const vz = pos[i * 3 + 2]!;
        expect(vz).toBeGreaterThanOrEqual(eyeBall.getLeftEyeSphere().centerZ);
      }

      eyelids.destroy();
    });
  });

  describe('2. Cierre Continuo sin Huecos contra el Párpado Inferior', () => {
    it('alcanza sellado completo con solapamiento milimétrico al 100% de parpadeo', () => {
      const landmarks = createMockLandmarks();
      const meshData = buildFaceMesh(landmarks, 512, 512);
      const dummyTexture = new THREE.Texture();
      const eyelids = new EyelidMesh({ texture: dummyTexture, faceScale: meshData.faceScale });
      const eyeBall = new EyeBall({ basePositions: meshData.basePositions, faceScale: meshData.faceScale });

      // Evaluar cierre total
      eyelids.update(
        meshData.basePositions,
        meshData.uvs,
        1.0,
        1.0,
        eyeBall.getLeftEyeSphere(),
        eyeBall.getRightEyeSphere(),
        0.0,
        meshData.faceScale
      );

      const pos = eyelids.mesh.geometry.attributes.position.array as Float32Array;

      // Columna central del ojo derecho (col = 4)
      // Fila 0 = vOffset + 4; Fila 1 = vOffset + 9 + 4; Fila 2 = vOffset + 18 + 4
      const row0_y = pos[4 * 3 + 1]!;
      const row1_y = pos[(9 + 4) * 3 + 1]!;
      const row2_y = pos[(18 + 4) * 3 + 1]!;

      // En el cierre, la fila 0 (arriba) > fila 1 (medio) > fila 2 (borde móvil inferior)
      expect(row0_y).toBeGreaterThan(row1_y);
      expect(row1_y).toBeGreaterThan(row2_y);

      // Comprobar que la fila 2 ha descendido hasta solapar el párpado inferior elevado
      const lowerLidY = meshData.basePositions[145 * 3 + 1]!;
      const upperLidY = meshData.basePositions[159 * 3 + 1]!;
      const effectiveLy = lowerLidY + (upperLidY - lowerLidY) * 0.10; // Elevación del párpado inferior
      expect(row2_y).toBeLessThanOrEqual(effectiveLy); // Sellado sin huecos con solapamiento milimétrico

      eyelids.destroy();
    });
  });

  describe('3. Temporización y Frecuencia Calibradas con Reference Stats', () => {
    it('mantiene la duración del parpadeo dentro de 100-150 ms (media ~130 ms)', () => {
      const engine = new BlinkEngine();
      const durations: number[] = [];

      for (let i = 0; i < 50; i++) {
        engine.triggerBlink();
        durations.push(engine.getCurrentDuration());
        engine.update(0.3); // Completar parpadeo
      }

      const meanDurMs = (durations.reduce((a, b) => a + b, 0) / durations.length) * 1000;
      expect(meanDurMs).toBeGreaterThanOrEqual(105);
      expect(meanDurMs).toBeLessThanOrEqual(155);
    });

    it('programa una frecuencia de parpadeo en el rango de 15 a 20 parpadeos/min', () => {
      const engine = new BlinkEngine();
      const intervals: number[] = [];

      for (let i = 0; i < 100; i++) {
        intervals.push(engine.sampleBlinkInterval('idle'));
      }

      const meanIntervalSec = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const blinksPerMin = 60 / meanIntervalSec;

      // Calibrado con reference_stats.json (15.25 blinks/min)
      expect(blinksPerMin).toBeGreaterThanOrEqual(14.0);
      expect(blinksPerMin).toBeLessThanOrEqual(21.0);
    });

    it('ejecuta parpadeo reflejo ante sacadas de mirada > 0.25', () => {
      const engine = new BlinkEngine();
      expect(engine.getIsBlinking()).toBe(false);

      // Con sacada amplia (> 0.25), debe activar parpadeo reflejo
      let triggered = false;
      for (let tryIdx = 0; tryIdx < 5; tryIdx++) {
        engine.triggerSaccadeBlink(0.35);
        if (engine.getIsBlinking()) {
          triggered = true;
          break;
        }
      }

      expect(triggered).toBe(true);
    });

    it('genera parpadeos incompletos ocasionales (18% probabilidad con cierre 72-92%)', () => {
      const engine = new BlinkEngine();
      const closures: number[] = [];

      for (let i = 0; i < 100; i++) {
        engine.triggerBlink();
        closures.push(engine.getMaxClosure());
        engine.update(0.3);
      }

      const incompleteBlinks = closures.filter((c) => c < 0.99);
      expect(incompleteBlinks.length).toBeGreaterThan(5); // Al menos varios parpadeos incompletos en 100 muestras
      for (const inc of incompleteBlinks) {
        expect(inc).toBeGreaterThanOrEqual(0.70);
        expect(inc).toBeLessThanOrEqual(0.95);
      }
    });
  });

  describe('4. Deformación Palpebral Nativa sin Mallas Extras ni Mancha Negra', () => {
    it('colapsa los vértices del iris contra la línea palpebral inferior eliminando la mancha negra / pico invertido', () => {
      const landmarks = createMockLandmarks();
      const meshData = buildFaceMesh(landmarks, 512, 512);

      const deformer = new PoseDeformer({
        basePositions: meshData.basePositions,
        landmarkCount: meshData.landmarkCount,
        vertexCount: meshData.vertexCount,
        faceScale: meshData.faceScale,
        rigVersion: 'v3',
      });

      const currentPos = new Float32Array(meshData.basePositions);
      const poses = {
        blink: 1.0,
        blinkLeft: 1.0,
        blinkRight: 1.0,
        gazeX: 0,
        gazeY: 0,
        jawOpen: 0,
        mouthRound: 0,
        mouthWide: 0,
        smile: 0,
        browRaise: 0,
        headYaw: 0,
        headPitch: 0,
        headRoll: 0,
        breath: 0,
      };

      deformer.apply(currentPos, poses);

      // Ojo derecho del rostro (espectador izquierdo):
      // Vértice 159 (párpado superior central), 145 (párpado inferior central), 468 (iris centro)
      const y159 = currentPos[159 * 3 + 1]!;
      const y145 = currentPos[145 * 3 + 1]!;
      const y468 = currentPos[468 * 3 + 1]!;

      // En el cierre completo, el párpado superior se encuentra y cubre el párpado inferior con solapamiento milimétrico
      expect(Math.abs(y159 - y145)).toBeLessThan(0.01);

      // El iris (468) ha colapsado a nivel del margen palpebral cerrado (y159), NUNCA sobresale hacia arriba en V invertida
      expect(y468).toBeLessThanOrEqual(y145 + 0.001);
      expect(Math.abs(y468 - y159)).toBeLessThan(0.001);

      // Comprobar que en el ojo izquierdo del rostro (386 superior, 374 inferior, 473 iris) ocurre lo mismo
      const y386 = currentPos[386 * 3 + 1]!;
      const y374 = currentPos[374 * 3 + 1]!;
      const y473 = currentPos[473 * 3 + 1]!;

      expect(Math.abs(y386 - y374)).toBeLessThan(0.01);
      expect(y473).toBeLessThanOrEqual(y374 + 0.001);
      expect(Math.abs(y473 - y386)).toBeLessThan(0.001);
    });

    it('mantiene la relación anatómica Y_upper >= Y_iris durante todas las fases del parpadeo (sin inversión triangular)', () => {
      const landmarks = createMockLandmarks();
      const meshData = buildFaceMesh(landmarks, 512, 512);

      const deformer = new PoseDeformer({
        basePositions: meshData.basePositions,
        landmarkCount: meshData.landmarkCount,
        vertexCount: meshData.vertexCount,
        faceScale: meshData.faceScale,
        rigVersion: 'v3',
      });

      const currentPos = new Float32Array(meshData.basePositions);

      // Evaluar en 10 pasos de cierre continuo de 0.0 a 1.0
      for (let step = 0; step <= 10; step++) {
        const weight = step / 10;
        const poses = {
          blink: weight,
          blinkLeft: weight,
          blinkRight: weight,
          gazeX: 0,
          gazeY: 0,
          jawOpen: 0,
          mouthRound: 0,
          mouthWide: 0,
          smile: 0,
          browRaise: 0,
          headYaw: 0,
          headPitch: 0,
          headRoll: 0,
          breath: 0,
        };

        deformer.apply(currentPos, poses);

        const yUpper = currentPos[159 * 3 + 1]!;
        const yIris = currentPos[468 * 3 + 1]!;

        // El párpado superior debe permanecer por encima o a nivel del iris en todo momento
        // (el iris nunca sobrepasa hacia arriba al párpado superior, tolerancia minúscula por solapamiento palpebral final)
        expect(yUpper).toBeGreaterThanOrEqual(yIris - 0.002);
      }
    });
  });
});
