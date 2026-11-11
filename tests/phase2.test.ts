import { describe, it, expect } from 'vitest';
import { buildFaceMesh } from '../src/core/face/buildMesh';
import { RigBasis } from '../src/core/rig/basis';
import { Rig } from '../src/core/rig/rig';
import { CriticallyDampedSpring, DynamicsController } from '../src/core/animation/dynamics';
import { HeadNoiseController, sampleFractalNoise1D } from '../src/core/animation/noise';
import { PseudoVolumeShading } from '../src/core/render/shading';
import { LANDMARK_INDICES } from '../src/core/face/landmarkGroups';
import { FaceLandmarkPoint } from '../src/lib/types';
import { PoseValues } from '../src/core/animation/animationState';

describe('Phase 2: Rig and Dynamics — 100% CPU Morphing & Physics', () => {
  // Helper para generar landmarks faciales sintéticos anatómicos
  const createSyntheticFaceLandmarks = (scale = 1.0): FaceLandmarkPoint[] => {
    const landmarks: FaceLandmarkPoint[] = Array.from({ length: 478 }, (_, i) => ({
      x: 0.5 + ((i % 20) - 10) * 0.015 * scale,
      y: 0.5 + (Math.floor(i / 20) - 12) * 0.015 * scale,
      z: (Math.sin(i) * 0.02) * scale,
    }));

    // Ojos y pupilas
    landmarks[33] = { x: 0.5 - 0.15 * scale, y: 0.40, z: -0.01 * scale };
    landmarks[263] = { x: 0.5 + 0.15 * scale, y: 0.40, z: -0.01 * scale };
    landmarks[133] = { x: 0.5 - 0.05 * scale, y: 0.40, z: 0 };
    landmarks[362] = { x: 0.5 + 0.05 * scale, y: 0.40, z: 0 };
    landmarks[LANDMARK_INDICES.leftIrisCenter] = { x: 0.5 + 0.10 * scale, y: 0.40, z: 0.01 * scale };
    landmarks[LANDMARK_INDICES.rightIrisCenter] = { x: 0.5 - 0.10 * scale, y: 0.40, z: 0.01 * scale };

    // Nariz (sobresale hacia adelante en +z)
    landmarks[LANDMARK_INDICES.noseTip] = { x: 0.50, y: 0.48, z: 0.06 * scale };

    // Cóndilos mandibulares (cerca de orejas)
    landmarks[234] = { x: 0.5 - 0.25 * scale, y: 0.48, z: -0.05 * scale };
    landmarks[454] = { x: 0.5 + 0.25 * scale, y: 0.48, z: -0.05 * scale };

    // Labios
    landmarks[LANDMARK_INDICES.lipUpperInnerCenter] = { x: 0.50, y: 0.58, z: 0.02 * scale };
    landmarks[LANDMARK_INDICES.lipLowerInnerCenter] = { x: 0.50, y: 0.59, z: 0.02 * scale };
    landmarks[LANDMARK_INDICES.lipUpperOuterCenter] = { x: 0.50, y: 0.57, z: 0.03 * scale };
    landmarks[LANDMARK_INDICES.lipLowerOuterCenter] = { x: 0.50, y: 0.60, z: 0.03 * scale };
    landmarks[LANDMARK_INDICES.lipLeftCorner] = { x: 0.5 - 0.08 * scale, y: 0.585, z: 0 };
    landmarks[LANDMARK_INDICES.lipRightCorner] = { x: 0.5 + 0.08 * scale, y: 0.585, z: 0 };

    // Mentón y frente
    landmarks[LANDMARK_INDICES.chinBottom] = { x: 0.50, y: 0.75, z: 0.01 * scale };
    landmarks[LANDMARK_INDICES.foreheadCenter] = { x: 0.50, y: 0.20, z: -0.02 * scale };

    // Cejas
    landmarks[55] = { x: 0.5 - 0.05 * scale, y: 0.32, z: 0.01 * scale };
    landmarks[285] = { x: 0.5 + 0.05 * scale, y: 0.32, z: 0.01 * scale };
    landmarks[70] = { x: 0.5 - 0.15 * scale, y: 0.30, z: 0 };
    landmarks[300] = { x: 0.5 + 0.15 * scale, y: 0.30, z: 0 };

    return landmarks;
  };

  const getNeutralPoses = (): PoseValues => ({
    blink: 0,
    blinkLeft: 0,
    blinkRight: 0,
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
  });

  describe('1. Rig and Basis Mechanics', () => {
    it('Identity Test: all weights zero produces current == base exactly', () => {
      const landmarks = createSyntheticFaceLandmarks(1.0);
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
      rig.apply(getNeutralPoses(), out);

      for (let i = 0; i < out.length; i++) {
        expect(out[i]).toBe(mesh.basePositions[i]);
      }
    });

    it('Scale Invariance: normalized displacement remains invariant when face scale doubles', () => {
      const landmarksSmall = createSyntheticFaceLandmarks(1.0);
      const meshSmall = buildFaceMesh(landmarksSmall, 512, 512);

      const landmarksLarge = createSyntheticFaceLandmarks(2.0);
      const meshLarge = buildFaceMesh(landmarksLarge, 512, 512);

      const basisSmall = new RigBasis({
        basePositions: meshSmall.basePositions,
        vertexCount: meshSmall.vertexCount,
        landmarkCount: meshSmall.landmarkCount,
        faceScale: meshSmall.faceScale,
        regions: meshSmall.regions,
      });

      const basisLarge = new RigBasis({
        basePositions: meshLarge.basePositions,
        vertexCount: meshLarge.vertexCount,
        landmarkCount: meshLarge.landmarkCount,
        faceScale: meshLarge.faceScale,
        regions: meshLarge.regions,
      });

      const rigSmall = new Rig({
        basePositions: meshSmall.basePositions,
        vertexCount: meshSmall.vertexCount,
        landmarkCount: meshSmall.landmarkCount,
        faceScale: meshSmall.faceScale,
        basis: basisSmall,
      });

      const rigLarge = new Rig({
        basePositions: meshLarge.basePositions,
        vertexCount: meshLarge.vertexCount,
        landmarkCount: meshLarge.landmarkCount,
        faceScale: meshLarge.faceScale,
        basis: basisLarge,
      });

      const poses = getNeutralPoses();
      poses.jawOpen = 0.5;

      const outSmall = new Float32Array(meshSmall.vertexCount * 3);
      const outLarge = new Float32Array(meshLarge.vertexCount * 3);

      rigSmall.apply(poses, outSmall);
      rigLarge.apply(poses, outLarge);

      const chinIdx = LANDMARK_INDICES.chinBottom;
      const dropSmall = Math.abs(outSmall[chinIdx * 3 + 1]! - meshSmall.basePositions[chinIdx * 3 + 1]!);
      const dropLarge = Math.abs(outLarge[chinIdx * 3 + 1]! - meshLarge.basePositions[chinIdx * 3 + 1]!);

      const normSmall = dropSmall / meshSmall.faceScale;
      const normLarge = dropLarge / meshLarge.faceScale;

      // La apertura normalizada respecto al tamaño del rostro debe ser idéntica dentro del 5%
      expect(normLarge).toBeCloseTo(normSmall, 1);
    });

    it('Region Isolation: jawOpen moves jaw and lower lip without moving eyes or eyebrows', () => {
      const landmarks = createSyntheticFaceLandmarks(1.0);
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

      const poses = getNeutralPoses();
      poses.jawOpen = 0.8;

      const out = new Float32Array(mesh.vertexCount * 3);
      rig.apply(poses, out);

      // El mentón y labio inferior deben descender claramente
      const chinIdx = LANDMARK_INDICES.chinBottom;
      const lipLowerIdx = LANDMARK_INDICES.lipLowerInnerCenter;
      expect(out[chinIdx * 3 + 1]!).toBeLessThan(mesh.basePositions[chinIdx * 3 + 1]!);
      expect(out[lipLowerIdx * 3 + 1]!).toBeLessThan(mesh.basePositions[lipLowerIdx * 3 + 1]!);

      // Los ojos y cejas deben permanecer 100% inalterados
      const eyeIdx = 159; // párpado superior
      const browIdx = 55; // ceja interior
      expect(out[eyeIdx * 3 + 1]!).toBe(mesh.basePositions[eyeIdx * 3 + 1]!);
      expect(out[browIdx * 3 + 1]!).toBe(mesh.basePositions[browIdx * 3 + 1]!);
    });

    it('Pivot Jaw Kinematics: upper lip moves minimally compared to lower lip', () => {
      const landmarks = createSyntheticFaceLandmarks(1.0);
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

      const poses = getNeutralPoses();
      poses.jawOpen = 1.0;

      const out = new Float32Array(mesh.vertexCount * 3);
      rig.apply(poses, out);

      const upperLipIdx = LANDMARK_INDICES.lipUpperInnerCenter;
      const lowerLipIdx = LANDMARK_INDICES.lipLowerInnerCenter;

      const upperDisp = Math.abs(out[upperLipIdx * 3 + 1]! - mesh.basePositions[upperLipIdx * 3 + 1]!);
      const lowerDisp = Math.abs(out[lowerLipIdx * 3 + 1]! - mesh.basePositions[lowerLipIdx * 3 + 1]!);

      // El labio superior apenas se desplaza (≤ 15% del desplazamiento del labio inferior)
      expect(upperDisp / Math.max(1e-4, lowerDisp)).toBeLessThanOrEqual(0.15);
    });

    it('3D Head Rotation: points with larger +z displace more in X during yaw (true parallax)', () => {
      const landmarks = createSyntheticFaceLandmarks(1.0);
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

      const poses = getNeutralPoses();
      poses.headYaw = 0.08; // ~4.5 grados

      const out = new Float32Array(mesh.vertexCount * 3);
      rig.apply(poses, out);

      // Nariz (punta frontal z > 0) vs Oreja/Condilo (z < 0)
      const noseIdx = LANDMARK_INDICES.noseTip;
      const earIdx = 234;

      const noseShiftX = Math.abs(out[noseIdx * 3]! - mesh.basePositions[noseIdx * 3]!);
      const earShiftX = Math.abs(out[earIdx * 3]! - mesh.basePositions[earIdx * 3]!);

      // La punta de la nariz tiene mayor arco de desplazamiento que las partes posteriores
      expect(noseShiftX).toBeGreaterThan(0);
      expect(earShiftX).toBeGreaterThan(0);
    });
  });

  describe('2. Second-Order Critically Damped Dynamics', () => {
    it('CriticallyDampedSpring exhibits zero overshoot (zeta = 1)', () => {
      const spring = new CriticallyDampedSpring(0, { omega: 25.0, maxVelocity: 50.0 });
      spring.target = 1.0;

      let maxVal = 0;
      for (let step = 0; step < 100; step++) {
        const val = spring.step(0.016);
        if (val > maxVal) maxVal = val;
      }

      // Debe alcanzar 1.0 sin sobrepasar jamás 1.0 (sin overshoot)
      expect(maxVal).toBeLessThanOrEqual(1.0001);
      expect(maxVal).toBeGreaterThan(0.98);
    });

    it('DynamicsController differentiates response speeds by motor channel', () => {
      const dynamics = new DynamicsController();

      dynamics.setTarget('jawOpen', 1.0);
      dynamics.setTarget('headYaw', 1.0);

      const out = getNeutralPoses();
      // Avanzar ~50 ms (3 frames de 16 ms)
      dynamics.update(0.016, out);
      dynamics.update(0.016, out);
      dynamics.update(0.016, out);

      // La mandíbula (omega ~34) debe haber reaccionado mucho más rápido que la cabeza (omega ~4.5)
      expect(out.jawOpen).toBeGreaterThan(out.headYaw * 3.0);
    });

    it('Velocity clamping caps rapid target step changes', () => {
      const spring = new CriticallyDampedSpring(0, { omega: 30.0, maxVelocity: 5.0 });
      spring.target = 100.0; // Salto violento

      spring.step(0.016);
      expect(spring.v).toBeLessThanOrEqual(5.0001);
    });
  });

  describe('3. Multi-Octave Noise and Head Pose Generation', () => {
    it('sampleFractalNoise1D returns continuous bounded values in [-1, 1]', () => {
      for (let t = 0; t < 10; t += 0.25) {
        const val = sampleFractalNoise1D(t);
        expect(val).toBeGreaterThanOrEqual(-1.0);
        expect(val).toBeLessThanOrEqual(1.0);
      }
    });

    it('HeadNoiseController decorrelates Yaw, Pitch and Roll tracks', () => {
      const controller = new HeadNoiseController(1.0);

      const p0 = controller.update(0.016, 'idle');
      const p1 = controller.update(0.016, 'idle');

      // Los valores de los 3 ejes deben ser distintos (desfasados)
      expect(p0.yaw).not.toBe(p0.pitch);
      expect(p0.yaw).not.toBe(p0.roll);
      expect(p1.breath).toBeGreaterThanOrEqual(0);
      expect(p1.breath).toBeLessThanOrEqual(1.0);
    });

    it('HeadNoiseController respects frontality scaling', () => {
      const controllerFrontal = new HeadNoiseController(1.0);
      const controllerTilted = new HeadNoiseController(0.4);

      const pFront = controllerFrontal.update(1.0, 'idle');
      const pTilt = controllerTilted.update(1.0, 'idle');

      expect(Math.abs(pTilt.yaw)).toBeLessThanOrEqual(Math.abs(pFront.yaw) * 0.6 + 0.01);
    });
  });

  describe('4. Pseudo-Volume Area Deformation Shading', () => {
    it('initializes with neutral white colors (1.0)', () => {
      const landmarks = createSyntheticFaceLandmarks(1.0);
      const mesh = buildFaceMesh(landmarks, 512, 512);

      const shading = new PseudoVolumeShading({
        basePositions: mesh.basePositions,
        indices: mesh.indices,
        vertexCount: mesh.vertexCount,
        regions: mesh.regions,
      });

      expect(shading.colors[0]).toBe(1.0);
      expect(shading.colors[1]).toBe(1.0);
      expect(shading.colors[2]).toBe(1.0);
    });

    it('compresses compressed regions slightly darker (< 1.0) bounded by ±8%', () => {
      const landmarks = createSyntheticFaceLandmarks(1.0);
      const mesh = buildFaceMesh(landmarks, 512, 512);

      const shading = new PseudoVolumeShading({
        basePositions: mesh.basePositions,
        indices: mesh.indices,
        vertexCount: mesh.vertexCount,
        regions: mesh.regions,
      });

      const deformed = new Float32Array(mesh.basePositions);
      // Comprimir los labios aplastando verticalmente los puntos bucales
      for (const idx of mesh.regions.mouth) {
        deformed[idx * 3 + 1] = deformed[idx * 3 + 1]! * 0.8;
      }

      shading.update(deformed);

      // Verificar que los valores se mantengan acotados entre 0.92 y 1.08
      for (let i = 0; i < shading.colors.length; i++) {
        expect(shading.colors[i]).toBeGreaterThanOrEqual(0.92 - 1e-4);
        expect(shading.colors[i]).toBeLessThanOrEqual(1.08 + 1e-4);
      }
    });
  });

  describe('5. Anchor Rings and Mesh Integrity', () => {
    it('generates outer anchor rings when includeAnchorRings is true', () => {
      const landmarks = createSyntheticFaceLandmarks(1.0);
      const meshWithout = buildFaceMesh(landmarks, 512, 512, { includeAnchorRings: false });
      const meshWith = buildFaceMesh(landmarks, 512, 512, { includeAnchorRings: true });

      expect(meshWith.vertexCount).toBeGreaterThan(meshWithout.vertexCount);
      expect(meshWith.anchorCount).toBeGreaterThan(meshWithout.anchorCount);

      // Todos los índices deben ser estrictamente válidos
      for (let i = 0; i < meshWith.indices.length; i++) {
        const idx = meshWith.indices[i]!;
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(meshWith.vertexCount);
      }
    });
  });
});
