/**
 * eyelids.ts
 *
 * Overlay de párpados con piel de la propia foto (Fase 1):
 * - Soluciona el parpadeo antinatural: el iris y la esclera NO se aplastan ni deforman.
 * - Construye una malla dinámica sobre cada ojo que desciende como un velo de piel
 *   cubriendo la cuenca ocular durante el parpadeo.
 * - Mapea las coordenadas UV desde la franja de piel periocular situada inmediatamente
 *   encima del párpado (crease superior), logrando continuidad visual idéntica a la foto.
 * - Incorpora borde de pestañas sutil, elevación del párpado inferior (15%) y acoplamiento con la mirada.
 */

import * as THREE from 'three';

// Pares superior/inferior de landmarks para párpados (de esquina externa a interna)
export const RIGHT_EYE_LID_PAIRS: [number, number][] = [
  [33, 33],   // Esquina externa
  [246, 7],
  [161, 163],
  [160, 144],
  [159, 145], // Centro
  [158, 153],
  [157, 154],
  [173, 155],
  [133, 133], // Esquina interna
];

export const LEFT_EYE_LID_PAIRS: [number, number][] = [
  [263, 263], // Esquina externa
  [466, 249],
  [388, 390],
  [387, 373],
  [386, 374], // Centro
  [385, 380],
  [384, 381],
  [398, 382],
  [362, 362], // Esquina interna
];

export interface EyelidOverlayOptions {
  texture: THREE.Texture;
  faceScale?: number;
}

export class EyelidOverlay {
  public mesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  private material: THREE.MeshBasicMaterial;

  private positions: Float32Array;
  private uvs: Float32Array;
  private indices: Uint16Array;

  // 9 pares por ojo * 2 ojos = 18 pares = 36 vértices
  // Por cada ojo: 8 quads * 6 = 48 índices -> 96 índices en total
  private readonly pairsPerEye = 9;
  private readonly totalVertices = 9 * 2 * 2; // 36
  private readonly totalIndices = 8 * 6 * 2;   // 96

  constructor(options: EyelidOverlayOptions) {
    this.positions = new Float32Array(this.totalVertices * 3);
    this.uvs = new Float32Array(this.totalVertices * 2);
    this.indices = new Uint16Array(this.totalIndices);

    this.buildTopology();

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));

    this.material = new THREE.MeshBasicMaterial({
      map: options.texture,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 3; // Renderizado por encima de la cara y la boca
    this.mesh.position.set(0, 0, 0.0008); // Adelante en z
    this.mesh.visible = false;
  }

  private buildTopology(): void {
    let indexPtr = 0;

    // Generar índices para Ojo Derecho (offset vértice 0) y Ojo Izquierdo (offset vértice 18)
    for (let eye = 0; eye < 2; eye++) {
      const vOffset = eye * 18;
      const quadCount = this.pairsPerEye - 1; // 8 quads

      for (let i = 0; i < quadCount; i++) {
        const u0 = vOffset + i;
        const u1 = vOffset + i + 1;
        const l0 = vOffset + this.pairsPerEye + i;
        const l1 = vOffset + this.pairsPerEye + i + 1;

        // Triángulo 1
        this.indices[indexPtr++] = u0;
        this.indices[indexPtr++] = l0;
        this.indices[indexPtr++] = u1;

        // Triángulo 2
        this.indices[indexPtr++] = u1;
        this.indices[indexPtr++] = l0;
        this.indices[indexPtr++] = l1;
      }
    }
  }

  /**
   * Actualiza el overlay de párpados según el grado de parpadeo (izq / der) y la mirada
   */
  public update(
    currentPositions: Float32Array,
    baseUvs: Float32Array,
    blinkLeft: number,
    blinkRight: number,
    gazeY = 0,
    faceScale = 0.45
  ): void {
    const maxBlink = Math.max(blinkLeft, blinkRight);

    // Si los ojos están abiertos, ocultar completamente el overlay
    if (maxBlink < 0.01 && Math.abs(gazeY) < 0.3) {
      this.mesh.visible = false;
      this.material.opacity = 0;
      return;
    }

    this.mesh.visible = true;
    this.material.opacity = Math.min(1.0, maxBlink * 1.25);

    // Acoplamiento párpado-mirada: mirar abajo baja levemente el párpado superior (~18%)
    const gazeLidCoupling = Math.max(-0.25, Math.min(0.1, -gazeY * 0.18));

    // Procesar Ojo Derecho (espectador izq) y Ojo Izquierdo (espectador der)
    this.updateEyeLidMesh(
      0,
      RIGHT_EYE_LID_PAIRS,
      currentPositions,
      baseUvs,
      Math.min(1.0, Math.max(0, blinkRight + gazeLidCoupling)),
      faceScale
    );

    this.updateEyeLidMesh(
      1,
      LEFT_EYE_LID_PAIRS,
      currentPositions,
      baseUvs,
      Math.min(1.0, Math.max(0, blinkLeft + gazeLidCoupling)),
      faceScale
    );

    const posAttr = this.geometry.attributes.position;
    const uvAttr = this.geometry.attributes.uv;
    if (posAttr) posAttr.needsUpdate = true;
    if (uvAttr) uvAttr.needsUpdate = true;
  }

  private updateEyeLidMesh(
    eyeIndex: number,
    pairs: [number, number][],
    pos: Float32Array,
    baseUvs: Float32Array,
    blink: number,
    faceScale: number
  ): void {
    const vOffset = eyeIndex * 18;
    const uvShiftY = (faceScale * 0.08); // Desplazamiento de UV hacia la piel superior del párpado

    for (let i = 0; i < this.pairsPerEye; i++) {
      const [upperIdx, lowerIdx] = pairs[i]!;

      const ux = pos[upperIdx * 3]!;
      const uy = pos[upperIdx * 3 + 1]!;
      const uz = pos[upperIdx * 3 + 2]!;

      const lx = pos[lowerIdx * 3]!;
      const ly = pos[lowerIdx * 3 + 1]!;

      // Margen inferior que sube levemente (~15% de elevación)
      const lowerRise = (uy - ly) * 0.15 * blink;
      const effectiveLy = ly + lowerRise;

      // Margen móvil del párpado superior que desciende cubriendo el ojo
      // lerp(upper, lower, blink * 0.98)
      const movingY = uy + (effectiveLy - uy) * blink * 0.98;
      const movingX = ux + (lx - ux) * blink * 0.98;

      // Vértice superior fijo (borde superior del párpado)
      const topVIdx = vOffset + i;
      this.positions[topVIdx * 3] = ux;
      this.positions[topVIdx * 3 + 1] = uy;
      this.positions[topVIdx * 3 + 2] = uz + 0.0008;

      // Mapear UV superior desde la piel inmediatamente encima del ojo
      this.uvs[topVIdx * 2] = baseUvs[upperIdx * 2]!;
      this.uvs[topVIdx * 2 + 1] = Math.min(1.0, baseUvs[upperIdx * 2 + 1]! + uvShiftY);

      // Vértice inferior móvil (margen libre con línea de pestañas)
      const botVIdx = vOffset + this.pairsPerEye + i;
      this.positions[botVIdx * 3] = movingX;
      this.positions[botVIdx * 3 + 1] = movingY;
      this.positions[botVIdx * 3 + 2] = uz + 0.0008;

      // UV inferior mapeado con textura continua de piel
      this.uvs[botVIdx * 2] = baseUvs[upperIdx * 2]!;
      this.uvs[botVIdx * 2 + 1] = baseUvs[upperIdx * 2 + 1]!;
    }
  }

  public destroy(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
