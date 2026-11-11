import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Mouth3D, INNER_LIP_PAIRS } from '../src/core/render/mouth3d';
import { PoseDeformer } from '../src/core/render/poses';
import { LANDMARK_INDICES } from '../src/core/face/landmarkGroups';

describe('V4 Fase 4: Boca 3D con Stencil (Algoritmo D)', () => {
  it('instantiates Mouth3D with stencil buffer masking on all interior components', () => {
    const mouth = new Mouth3D();

    expect(mouth.rootGroup).toBeInstanceOf(THREE.Group);
    expect(mouth.stencilMaskMesh).toBeInstanceOf(THREE.Mesh);
    expect(mouth.cavityMesh).toBeInstanceOf(THREE.Mesh);
    expect(mouth.upperTeethMesh).toBeInstanceOf(THREE.Mesh);
    expect(mouth.lowerTeethMesh).toBeInstanceOf(THREE.Mesh);
    expect(mouth.tongueMesh).toBeInstanceOf(THREE.Mesh);

    // Stencil Mask Mesh: escribe 1 en stencil buffer, sin escribir color
    const maskMat = mouth.stencilMaskMesh.material as THREE.MeshBasicMaterial;
    expect(maskMat.stencilWrite).toBe(true);
    expect(maskMat.stencilRef).toBe(1);
    expect(maskMat.stencilFunc).toBe(THREE.AlwaysStencilFunc);
    expect(maskMat.stencilZPass).toBe(THREE.ReplaceStencilOp);
    expect(maskMat.colorWrite).toBe(false);

    // Componentes interiores: sólo se dibujan donde stencil == 1 (dentro de la boca abierta)
    const cavityMat = mouth.cavityMesh.material as THREE.MeshBasicMaterial;
    expect(cavityMat.stencilWrite).toBe(true);
    expect(cavityMat.stencilRef).toBe(1);
    expect(cavityMat.stencilFunc).toBe(THREE.EqualStencilFunc);

    const upperTeethMat = mouth.upperTeethMesh.material as THREE.MeshBasicMaterial;
    expect(upperTeethMat.stencilWrite).toBe(true);
    expect(upperTeethMat.stencilRef).toBe(1);
    expect(upperTeethMat.stencilFunc).toBe(THREE.EqualStencilFunc);

    const lowerTeethMat = mouth.lowerTeethMesh.material as THREE.MeshBasicMaterial;
    expect(lowerTeethMat.stencilWrite).toBe(true);
    expect(lowerTeethMat.stencilRef).toBe(1);
    expect(lowerTeethMat.stencilFunc).toBe(THREE.EqualStencilFunc);

    const tongueMat = mouth.tongueMesh.material as THREE.MeshBasicMaterial;
    expect(tongueMat.stencilWrite).toBe(true);
    expect(tongueMat.stencilRef).toBe(1);
    expect(tongueMat.stencilFunc).toBe(THREE.EqualStencilFunc);

    mouth.destroy();
  });

  it('keeps Mouth3D completely hidden when lips are resting/closed (effectiveGap < g0)', () => {
    const mouth = new Mouth3D();
    const positions = new Float32Array(500 * 3);

    // Posiciones con labios juntos (gap = 0)
    for (const [u, l] of INNER_LIP_PAIRS) {
      positions[u * 3 + 1] = 0.50;
      positions[l * 3 + 1] = 0.50;
    }

    mouth.update(positions, 0.0, 0.45, 0, 0);
    expect(mouth.rootGroup.visible).toBe(false);

    mouth.update(positions, 0.005, 0.45, 0, 0);
    expect(mouth.rootGroup.visible).toBe(false);

    mouth.destroy();
  });

  it('correctly tracks cranium for upper teeth, jaw bone for lower teeth, and 2 DOF for tongue', () => {
    const mouth = new Mouth3D();
    const positions = new Float32Array(500 * 3);
    const faceScale = 0.45;

    // Configurar boca abierta
    positions[78 * 3] = -0.08; // Comisura izq
    positions[308 * 3] = 0.08; // Comisura der
    positions[13 * 3 + 1] = 0.02; // Labio superior
    positions[14 * 3 + 1] = -0.04; // Labio inferior desciende

    // 1. Boca abierta con lengua en reposo
    mouth.update(positions, 0.25, faceScale, 0.0, 0.0);
    expect(mouth.rootGroup.visible).toBe(true);

    const baseTongueY = mouth.tongueMesh.position.y;
    const baseTongueZ = mouth.tongueMesh.position.z;

    // 2. Elevación lingual (/l, t, d, n/)
    mouth.update(positions, 0.25, faceScale, 0.85, 0.0);
    const elevatedY = mouth.tongueMesh.position.y;
    expect(elevatedY).toBeGreaterThan(baseTongueY);

    // 3. Protrusión lingual (/θ, s/)
    mouth.update(positions, 0.25, faceScale, 0.0, 0.60);
    const peekZ = mouth.tongueMesh.position.z;
    expect(peekZ).toBeGreaterThan(baseTongueZ);

    // 4. Verificación de anclaje de dientes
    const upperTeethGeom = mouth.upperTeethMesh.geometry;
    const upperPosAttr = upperTeethGeom.attributes.position;
    // Dientes superiores deben situarse cerca del labio superior (y ~ 0.02)
    expect(upperPosAttr.getY(0)).toBeCloseTo(0.02, 1);

    const lowerTeethGeom = mouth.lowerTeethMesh.geometry;
    const lowerPosAttr = lowerTeethGeom.attributes.position;
    // Dientes inferiores deben descender acompañando a L14 (y ~ -0.04)
    expect(lowerPosAttr.getY(lowerTeethGeom.attributes.position.count - 1)).toBeCloseTo(-0.04, 1);

    mouth.destroy();
  });

  it('Criterion 7: Protrusión en Z verificable al activar pucker=0.8 (+0.10–0.15·IOD)', () => {
    const basePositions = new Float32Array(500 * 3);
    const deformedPositions = new Float32Array(500 * 3);
    const faceScale = 0.45;

    // Inicializar posiciones base
    const uIdx = LANDMARK_INDICES.lipUpperOuterCenter;
    const lIdx = LANDMARK_INDICES.lipLowerOuterCenter;
    const uInnerIdx = LANDMARK_INDICES.lipUpperInnerCenter;
    const lInnerIdx = LANDMARK_INDICES.lipLowerInnerCenter;

    basePositions[uIdx * 3 + 2] = 0.0;
    basePositions[lIdx * 3 + 2] = 0.0;
    basePositions[uInnerIdx * 3 + 2] = 0.0;
    basePositions[lInnerIdx * 3 + 2] = 0.0;

    const deformer = new PoseDeformer({
      basePositions,
      landmarkCount: 478,
      vertexCount: 478,
      indices: new Uint16Array(0),
      faceScale,
      rigVersion: 'v4',
    });
    const defaultPoses = {
      jawOpen: 0.1,
      mouthWide: 0,
      mouthRound: 0,
      eyebrowRaise: 0,
      headYaw: 0,
      headPitch: 0,
      headRoll: 0,
    };

    // Aplicar pucker = 0.8
    deformer.apply(deformedPositions, defaultPoses, { mouthPucker: 0.8 });

    const deltaZOuter = deformedPositions[uIdx * 3 + 2]! - basePositions[uIdx * 3 + 2]!;
    const deltaZInner = deformedPositions[uInnerIdx * 3 + 2]! - basePositions[uInnerIdx * 3 + 2]!;

    // En unidades normalizadas respecto al scale (IOD):
    const ratioOuter = deltaZOuter / faceScale;
    const ratioInner = deltaZInner / faceScale;

    // Criterio 7: protrusión en Z en rango +0.10 – 0.15 · IOD
    expect(ratioOuter).toBeGreaterThanOrEqual(0.10);
    expect(ratioOuter).toBeLessThanOrEqual(0.15);
    expect(ratioInner).toBeGreaterThan(0.08);
  });
});
