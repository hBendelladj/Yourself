/**
 * mouth3d.ts
 *
 * Cavidad Bucal 3D con Stencil Buffer (YourSelf v4 - Algoritmo D):
 * - Cavidad oscura 3D detrás de los labios (no un plano negro 2D), caja convexa con sombreado difuso y degradado hacia la garganta.
 * - Dientes superiores fijos al cráneo (permanecen con el labio superior).
 * - Dientes inferiores anclados al hueso de la mandíbula (bajan y rotan con el hueso condilar / L14).
 * - Lengua como elipsoide aplanado 3D con 2 DOF:
 *     1. Elevación (sube en /l, t, d, n/, baja en vocales abiertas como /a/)
 *     2. Avance (asoma entre dientes en /θ/ o /s/)
 * - Oclusión por Stencil Buffer: la máscara se deriva del contorno labial interior (20 landmarks).
 *   Los dientes y la lengua solo se dibujan dentro de la boca abierta, y los labios los ocluyen en perspectiva y perfil a cualquier ángulo (ej. 45°).
 * - Cero asignaciones en el bucle caliente (hot-loop zero allocations).
 */

import * as THREE from 'three';
import { PhotoProfile } from '@/core/face/photoProfile';
import { INNER_LIP_PAIRS } from '@/core/render/mouthInterior';
import { buildTeethAtlas } from '@/core/render/teethAtlas';

export { INNER_LIP_PAIRS };

// Contorno labial interior cerrado (20 landmarks MediaPipe)
export const INNER_LIP_LOOP: number[] = [
  13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78, 191, 80, 81, 82,
];

export interface Mouth3DOptions {
  profile?: PhotoProfile | null;
  maxAnisotropy?: number;
}

export class Mouth3D {
  public rootGroup: THREE.Group;
  public interiorGroup: THREE.Group;

  // 1. Portal / Máscara Stencil del contorno labial interior
  public stencilMaskMesh: THREE.Mesh;
  private stencilGeometry: THREE.BufferGeometry;
  private stencilMaterial: THREE.MeshBasicMaterial;
  private stencilPositions: Float32Array;

  // 2. Cavidad 3D convexa detrás de los labios
  public cavityMesh: THREE.Mesh;
  private cavityGeometry: THREE.BufferGeometry;
  private cavityMaterial: THREE.MeshBasicMaterial;
  private cavityPositions: Float32Array;
  private cavityTexture: THREE.Texture;

  // 3. Dientes superiores fijos al cráneo
  public upperTeethMesh: THREE.Mesh;
  private upperTeethGeometry: THREE.BufferGeometry;
  private upperTeethMaterial: THREE.MeshBasicMaterial;
  private upperTeethPositions: Float32Array;
  private teethTexture: THREE.Texture;

  // 4. Dientes inferiores anclados a la mandíbula
  public lowerTeethMesh: THREE.Mesh;
  private lowerTeethGeometry: THREE.BufferGeometry;
  private lowerTeethMaterial: THREE.MeshBasicMaterial;
  private lowerTeethPositions: Float32Array;
  private lowerTeethTexture: THREE.Texture;

  // 5. Lengua 3D elipsoide
  public tongueMesh: THREE.Mesh;
  private tongueGeometry: THREE.SphereGeometry;
  private tongueMaterial: THREE.MeshBasicMaterial;
  private tongueTexture: THREE.Texture;

  // Umbrales de visibilidad geométrica
  private readonly g0 = 0.004; // Umbral de apertura mínima
  private readonly g1 = 0.026; // Umbral de apertura completa

  private profile: PhotoProfile | null = null;
  private maxAnisotropy: number;
  private isTeethDebug: boolean;

  constructor(options?: Mouth3DOptions) {
    this.profile = options?.profile ?? null;
    this.maxAnisotropy = Math.min(8, options?.maxAnisotropy ?? 4);
    this.isTeethDebug =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('teethDebug') === '1';

    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'Mouth3D_Root';

    this.interiorGroup = new THREE.Group();
    this.interiorGroup.name = 'Mouth3D_Interior';

    const pairCount = INNER_LIP_PAIRS.length; // 11
    const vertexCount = pairCount * 2; // 22 (11 superiores, 11 inferiores)
    const quadCount = pairCount - 1; // 10
    const indexCount = quadCount * 6; // 60 (20 triángulos)

    // --- A. GEOMETRÍA Y MATERIAL DE LA MÁSCARA STENCIL ---
    this.stencilPositions = new Float32Array(vertexCount * 3);
    const stencilIndices = new Uint16Array(indexCount);
    let sPtr = 0;
    for (let i = 0; i < quadCount; i++) {
      const u0 = i;
      const u1 = i + 1;
      const l0 = pairCount + i;
      const l1 = pairCount + i + 1;

      // Triángulo 1
      stencilIndices[sPtr++] = u0;
      stencilIndices[sPtr++] = l0;
      stencilIndices[sPtr++] = u1;

      // Triángulo 2
      stencilIndices[sPtr++] = u1;
      stencilIndices[sPtr++] = l0;
      stencilIndices[sPtr++] = l1;
    }

    this.stencilGeometry = new THREE.BufferGeometry();
    this.stencilGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.stencilPositions, 3)
    );
    this.stencilGeometry.setIndex(new THREE.BufferAttribute(stencilIndices, 1));

    // Material stencil: no dibuja color ni depth, escribe 1 en stencil buffer
    this.stencilMaterial = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
      depthTest: false,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
      side: THREE.DoubleSide,
    });

    this.stencilMaskMesh = new THREE.Mesh(this.stencilGeometry, this.stencilMaterial);
    this.stencilMaskMesh.name = 'Mouth3D_StencilMask';
    this.stencilMaskMesh.renderOrder = 2; // Renders after face mesh (0 or 1), before mouth interior (3)
    this.rootGroup.add(this.stencilMaskMesh);

    // --- B. CAVIDAD 3D CONVEXA ---
    // Cavidad con 11 vértices frontales superiores, 11 frontales inferiores y anillo posterior profundo (22 vértices)
    const cavityVertCount = vertexCount * 2; // 44 vértices
    this.cavityPositions = new Float32Array(cavityVertCount * 3);
    const cavityIndices = new Uint16Array(quadCount * 12 + 60); // quads conectando frente y fondo
    let cPtr = 0;
    for (let i = 0; i < quadCount; i++) {
      const f_u0 = i;
      const f_u1 = i + 1;
      const b_u0 = vertexCount + i;
      const b_u1 = vertexCount + i + 1;

      // Techo cavidad
      cavityIndices[cPtr++] = f_u0;
      cavityIndices[cPtr++] = b_u0;
      cavityIndices[cPtr++] = f_u1;

      cavityIndices[cPtr++] = f_u1;
      cavityIndices[cPtr++] = b_u0;
      cavityIndices[cPtr++] = b_u1;

      const f_l0 = pairCount + i;
      const f_l1 = pairCount + i + 1;
      const b_l0 = vertexCount + pairCount + i;
      const b_l1 = vertexCount + pairCount + i + 1;

      // Piso cavidad
      cavityIndices[cPtr++] = f_l0;
      cavityIndices[cPtr++] = f_l1;
      cavityIndices[cPtr++] = b_l0;

      cavityIndices[cPtr++] = f_l1;
      cavityIndices[cPtr++] = b_l1;
      cavityIndices[cPtr++] = b_l0;
    }
    // Pared de fondo
    for (let i = 0; i < quadCount; i++) {
      const b_u0 = vertexCount + i;
      const b_u1 = vertexCount + i + 1;
      const b_l0 = vertexCount + pairCount + i;
      const b_l1 = vertexCount + pairCount + i + 1;

      cavityIndices[cPtr++] = b_u0;
      cavityIndices[cPtr++] = b_l0;
      cavityIndices[cPtr++] = b_u1;

      cavityIndices[cPtr++] = b_u1;
      cavityIndices[cPtr++] = b_l0;
      cavityIndices[cPtr++] = b_l1;
    }

    this.cavityGeometry = new THREE.BufferGeometry();
    this.cavityGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.cavityPositions, 3)
    );
    this.cavityGeometry.setIndex(new THREE.BufferAttribute(cavityIndices, 1));

    this.cavityTexture = this.createCavityTexture();
    this.cavityMaterial = new THREE.MeshBasicMaterial({
      map: this.cavityTexture,
      transparent: true,
      opacity: 1.0,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.EqualStencilFunc,
      stencilZPass: THREE.KeepStencilOp,
    });
    this.cavityMesh = new THREE.Mesh(this.cavityGeometry, this.cavityMaterial);
    this.cavityMesh.name = 'Mouth3D_Cavity';
    this.cavityMesh.renderOrder = 3;
    this.interiorGroup.add(this.cavityMesh);

    // --- C. DIENTES SUPERIORES 3D (REJILLA 25 COLUMNAS x 4 FILAS) ---
    const upperCols = 25;
    const upperRows = 4;
    const upperTeethVertCount = upperCols * upperRows; // 100
    this.upperTeethPositions = new Float32Array(upperTeethVertCount * 3);
    const upperTeethIndices = new Uint16Array((upperCols - 1) * (upperRows - 1) * 6); // 432
    const upperTeethUVs = new Float32Array(upperTeethVertCount * 2);

    for (let r = 0; r < upperRows; r++) {
      const v = 1.0 - r / (upperRows - 1); // r=0 encía (v=1), r=3 incisal (v=0)
      for (let c = 0; c < upperCols; c++) {
        const u = c / (upperCols - 1);
        const idx = r * upperCols + c;
        upperTeethUVs[idx * 2] = u;
        upperTeethUVs[idx * 2 + 1] = v;
      }
    }

    let tPtr = 0;
    for (let r = 0; r < upperRows - 1; r++) {
      for (let c = 0; c < upperCols - 1; c++) {
        const v00 = r * upperCols + c;
        const v10 = r * upperCols + c + 1;
        const v01 = (r + 1) * upperCols + c;
        const v11 = (r + 1) * upperCols + c + 1;

        upperTeethIndices[tPtr++] = v00;
        upperTeethIndices[tPtr++] = v01;
        upperTeethIndices[tPtr++] = v10;

        upperTeethIndices[tPtr++] = v10;
        upperTeethIndices[tPtr++] = v01;
        upperTeethIndices[tPtr++] = v11;
      }
    }

    this.upperTeethGeometry = new THREE.BufferGeometry();
    this.upperTeethGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.upperTeethPositions, 3)
    );
    this.upperTeethGeometry.setAttribute('uv', new THREE.BufferAttribute(upperTeethUVs, 2));
    this.upperTeethGeometry.setIndex(new THREE.BufferAttribute(upperTeethIndices, 1));

    this.teethTexture = this.createTeethTexture(true);
    this.upperTeethMaterial = new THREE.MeshBasicMaterial({
      map: this.teethTexture,
      transparent: true,
      opacity: 1.0,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.EqualStencilFunc,
      stencilZPass: THREE.KeepStencilOp,
    });
    this.upperTeethMesh = new THREE.Mesh(this.upperTeethGeometry, this.upperTeethMaterial);
    this.upperTeethMesh.name = 'Mouth3D_UpperTeeth';
    this.upperTeethMesh.renderOrder = 4;
    this.interiorGroup.add(this.upperTeethMesh);

    // --- D. DIENTES INFERIORES 3D (REJILLA 21 COLUMNAS x 4 FILAS) ---
    const lowerCols = 21;
    const lowerRows = 4;
    const lowerTeethVertCount = lowerCols * lowerRows; // 84
    this.lowerTeethPositions = new Float32Array(lowerTeethVertCount * 3);
    const lowerTeethIndices = new Uint16Array((lowerCols - 1) * (lowerRows - 1) * 6); // 360
    const lowerTeethUVs = new Float32Array(lowerTeethVertCount * 2);

    for (let r = 0; r < lowerRows; r++) {
      const v = 1.0 - r / (lowerRows - 1); // r=0 incisal (v=1), r=3 encía (v=0)
      for (let c = 0; c < lowerCols; c++) {
        const u = c / (lowerCols - 1);
        const idx = r * lowerCols + c;
        lowerTeethUVs[idx * 2] = u;
        lowerTeethUVs[idx * 2 + 1] = v;
      }
    }

    let ltPtr = 0;
    for (let r = 0; r < lowerRows - 1; r++) {
      for (let c = 0; c < lowerCols - 1; c++) {
        const v00 = r * lowerCols + c;
        const v10 = r * lowerCols + c + 1;
        const v01 = (r + 1) * lowerCols + c;
        const v11 = (r + 1) * lowerCols + c + 1;

        lowerTeethIndices[ltPtr++] = v00;
        lowerTeethIndices[ltPtr++] = v01;
        lowerTeethIndices[ltPtr++] = v10;

        lowerTeethIndices[ltPtr++] = v10;
        lowerTeethIndices[ltPtr++] = v01;
        lowerTeethIndices[ltPtr++] = v11;
      }
    }

    this.lowerTeethGeometry = new THREE.BufferGeometry();
    this.lowerTeethGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.lowerTeethPositions, 3)
    );
    this.lowerTeethGeometry.setAttribute('uv', new THREE.BufferAttribute(lowerTeethUVs, 2));
    this.lowerTeethGeometry.setIndex(new THREE.BufferAttribute(lowerTeethIndices, 1));

    this.lowerTeethTexture = this.createTeethTexture(false);
    this.lowerTeethMaterial = new THREE.MeshBasicMaterial({
      map: this.lowerTeethTexture,
      transparent: true,
      opacity: 1.0,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.EqualStencilFunc,
      stencilZPass: THREE.KeepStencilOp,
    });
    this.lowerTeethMesh = new THREE.Mesh(this.lowerTeethGeometry, this.lowerTeethMaterial);
    this.lowerTeethMesh.name = 'Mouth3D_LowerTeeth';
    this.lowerTeethMesh.renderOrder = 4;
    this.interiorGroup.add(this.lowerTeethMesh);

    // --- E. LENGUA 3D ELIPSOIDE (renderOrder 3.5: DETRÁS DE LOS DIENTES) ---
    this.tongueTexture = this.createTongueTexture();
    this.tongueGeometry = new THREE.SphereGeometry(1.0, 16, 12);
    this.tongueMaterial = new THREE.MeshBasicMaterial({
      map: this.tongueTexture,
      transparent: true,
      opacity: 1.0,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.EqualStencilFunc,
      stencilZPass: THREE.KeepStencilOp,
    });
    this.tongueMesh = new THREE.Mesh(this.tongueGeometry, this.tongueMaterial);
    this.tongueMesh.name = 'Mouth3D_Tongue';
    this.tongueMesh.renderOrder = 3.5;
    this.interiorGroup.add(this.tongueMesh);

    this.rootGroup.add(this.interiorGroup);
    this.rootGroup.visible = false;
  }

  /**
   * Genera la textura de la cavidad bucal profunda con degradado hacia la faringe
   */
  private createCavityTexture(): THREE.Texture {
    if (typeof document === 'undefined') {
      return new THREE.Texture();
    }
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    const lip = this.profile?.colors.lip ?? { r: 195, g: 95, b: 105 };

    ctx.clearRect(0, 0, 256, 256);
    const grad = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
    grad.addColorStop(0, '#0a0305');
    grad.addColorStop(0.5, '#120508');
    grad.addColorStop(0.85, `rgba(${Math.round(lip.r * 0.35)}, ${Math.round(lip.g * 0.15)}, ${Math.round(lip.b * 0.15)}, 0.95)`);
    grad.addColorStop(1.0, `rgba(${Math.round(lip.r * 0.25)}, ${Math.round(lip.g * 0.1)}, ${Math.round(lip.b * 0.1)}, 0.8)`);

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  /**
   * Genera el mapa de esmalte marfil para los dientes superiores o inferiores
   * utilizando el atlas procedural de alta fidelidad (buildTeethAtlas).
   */
  private createTeethTexture(isUpper: boolean): THREE.Texture {
    if (typeof document === 'undefined') {
      return new THREE.Texture();
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return new THREE.Texture();
    }

    const teethColor = this.profile?.colors.teeth ?? null;
    const imgData = buildTeethAtlas({
      teeth: teethColor,
      isUpper,
      width: 1024,
      height: 256,
    });

    ctx.putImageData(imgData, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = this.maxAnisotropy;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.premultiplyAlpha = true;
    return texture;
  }

  /**
   * Interpola linealmente la coordenada Y del labio en la coordenada X dada.
   * Utiliza los 11 puntos ya proyectados en stencilPositions. Cero asignaciones.
   */
  private interpolateLipY(x: number, isUpper: boolean): number {
    const pairCount = INNER_LIP_PAIRS.length; // 11
    const offset = isUpper ? 0 : pairCount * 3;

    const x0 = this.stencilPositions[offset]!;
    const xEnd = this.stencilPositions[offset + (pairCount - 1) * 3]!;
    const minX = Math.min(x0, xEnd);
    const maxX = Math.max(x0, xEnd);

    if (x <= minX) {
      return x0 <= xEnd
        ? this.stencilPositions[offset + 1]!
        : this.stencilPositions[offset + (pairCount - 1) * 3 + 1]!;
    }
    if (x >= maxX) {
      return x0 <= xEnd
        ? this.stencilPositions[offset + (pairCount - 1) * 3 + 1]!
        : this.stencilPositions[offset + 1]!;
    }

    for (let i = 0; i < pairCount - 1; i++) {
      const segX0 = this.stencilPositions[offset + i * 3]!;
      const segX1 = this.stencilPositions[offset + (i + 1) * 3]!;
      const sMin = Math.min(segX0, segX1);
      const sMax = Math.max(segX0, segX1);
      if (x >= sMin && x <= sMax) {
        const dx = segX1 - segX0;
        const t = Math.abs(dx) > 1e-6 ? (x - segX0) / dx : 0.5;
        const y0 = this.stencilPositions[offset + i * 3 + 1]!;
        const y1 = this.stencilPositions[offset + (i + 1) * 3 + 1]!;
        return y0 + (y1 - y0) * t;
      }
    }
    return this.stencilPositions[offset + 5 * 3 + 1]!;
  }

  /**
   * Interpola linealmente la coordenada Z del labio en la coordenada X dada.
   */
  private interpolateLipZ(x: number, isUpper: boolean): number {
    const pairCount = INNER_LIP_PAIRS.length; // 11
    const offset = isUpper ? 0 : pairCount * 3;

    const x0 = this.stencilPositions[offset]!;
    const xEnd = this.stencilPositions[offset + (pairCount - 1) * 3]!;
    const minX = Math.min(x0, xEnd);
    const maxX = Math.max(x0, xEnd);

    if (x <= minX) {
      return x0 <= xEnd
        ? this.stencilPositions[offset + 2]!
        : this.stencilPositions[offset + (pairCount - 1) * 3 + 2]!;
    }
    if (x >= maxX) {
      return x0 <= xEnd
        ? this.stencilPositions[offset + (pairCount - 1) * 3 + 2]!
        : this.stencilPositions[offset + 2]!;
    }

    for (let i = 0; i < pairCount - 1; i++) {
      const segX0 = this.stencilPositions[offset + i * 3]!;
      const segX1 = this.stencilPositions[offset + (i + 1) * 3]!;
      const sMin = Math.min(segX0, segX1);
      const sMax = Math.max(segX0, segX1);
      if (x >= sMin && x <= sMax) {
        const dx = segX1 - segX0;
        const t = Math.abs(dx) > 1e-6 ? (x - segX0) / dx : 0.5;
        const z0 = this.stencilPositions[offset + i * 3 + 2]!;
        const z1 = this.stencilPositions[offset + (i + 1) * 3 + 2]!;
        return z0 + (z1 - z0) * t;
      }
    }
    return this.stencilPositions[offset + 5 * 3 + 2]!;
  }

  /**
   * Genera la textura mucosal de la lengua 3D con surco medial
   */
  private createTongueTexture(): THREE.Texture {
    if (typeof document === 'undefined') {
      return new THREE.Texture();
    }
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    const lip = this.profile?.colors.lip ?? { r: 195, g: 95, b: 105 };

    ctx.clearRect(0, 0, 128, 128);
    const grad = ctx.createRadialGradient(64, 50, 10, 64, 64, 60);
    grad.addColorStop(0, `rgba(${Math.min(255, lip.r + 25)}, ${Math.max(25, lip.g - 10)}, ${Math.max(30, lip.b - 10)}, 0.95)`);
    grad.addColorStop(0.7, `rgba(${Math.max(120, lip.r - 25)}, ${Math.max(15, lip.g - 35)}, ${Math.max(20, lip.b - 30)}, 0.90)`);
    grad.addColorStop(1.0, `rgba(${Math.max(70, lip.r - 70)}, 15, 20, 0.75)`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(64, 64, 58, 54, 0, 0, Math.PI * 2);
    ctx.fill();

    // Surco medial (sulcus medianus)
    ctx.strokeStyle = `rgba(${Math.max(70, lip.r - 60)}, 10, 15, 0.45)`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(64, 25);
    ctx.lineTo(64, 95);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  public setProfile(profile: PhotoProfile | null): void {
    this.profile = profile;
    this.cavityTexture.dispose();
    this.teethTexture.dispose();
    this.lowerTeethTexture.dispose();
    this.tongueTexture.dispose();

    this.cavityTexture = this.createCavityTexture();
    this.teethTexture = this.createTeethTexture(true);
    this.lowerTeethTexture = this.createTeethTexture(false);
    this.tongueTexture = this.createTongueTexture();

    this.cavityMaterial.map = this.cavityTexture;
    this.upperTeethMaterial.map = this.teethTexture;
    this.lowerTeethMaterial.map = this.lowerTeethTexture;
    this.tongueMaterial.map = this.tongueTexture;

    this.cavityMaterial.needsUpdate = true;
    this.upperTeethMaterial.needsUpdate = true;
    this.lowerTeethMaterial.needsUpdate = true;
    this.tongueMaterial.needsUpdate = true;
  }

  /**
   * Actualiza la cavidad 3D, máscara stencil, arcos dentales y lengua cada fotograma.
   * Cero asignaciones en memoria (zero allocations in hot loop).
   */
  public update(
    currentPositions: Float32Array,
    jawOpenOrGap: number,
    faceScale = 0.45,
    tongueElevation = 0,
    tongueProtrusion = 0,
    _jawRotationAngle = 0
  ): void {
    const pairCount = INNER_LIP_PAIRS.length; // 11

    // 1. Apertura geométrica promedio entre los labios interiores
    let totalDist = 0;
    let validPairs = 0;
    for (let i = 1; i < pairCount - 1; i++) {
      const [upperIdx, lowerIdx] = INNER_LIP_PAIRS[i]!;
      const uy = currentPositions[upperIdx * 3 + 1]!;
      const ly = currentPositions[lowerIdx * 3 + 1]!;
      totalDist += Math.max(0, uy - ly);
      validPairs++;
    }
    const meanDist = validPairs > 0 ? totalDist / validPairs : 0;
    // Manejo de ?teethDebug=1 (Modo cíclico para verificación visual sin audio)
    let debugEffectiveGap = -1;
    if (this.isTeethDebug) {
      const sec =
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      const step = Math.floor(sec / 2.0) % 3;
      if (step === 0) debugEffectiveGap = 0.35 * this.g1; // pequeña
      else if (step === 1) debugEffectiveGap = 0.70 * this.g1; // media
      else debugEffectiveGap = 1.20 * this.g1; // grande
    }

    const geometricGap = meanDist / Math.max(0.01, faceScale);
    const jawGapFallback = jawOpenOrGap >= 0.015 ? jawOpenOrGap * 0.35 : 0;
    const effectiveGap =
      debugEffectiveGap >= 0 ? debugEffectiveGap : Math.max(geometricGap, jawGapFallback);

    // Silencio / Labios cerrados: ocultar completamente, 0 draw calls
    if (effectiveGap < this.g0) {
      this.rootGroup.visible = false;
      return;
    }

    this.rootGroup.visible = true;
    const t = Math.max(0, Math.min(1, (effectiveGap - this.g0) / (this.g1 - this.g0)));
    const smoothOpacity = t * t * (3.0 - 2.0 * t);

    // Transición progresiva de opacidad de dientes:
    const teethT = Math.max(0, Math.min(1, (effectiveGap - this.g0) / (this.g1 * 0.6 - this.g0)));
    const teethSmooth = teethT * teethT * (3.0 - 2.0 * teethT);
    this.upperTeethMaterial.opacity = smoothOpacity * teethSmooth;

    // Dientes inferiores: invisibles con apertura pequeña (< ~35% de g1), fade hasta 65% de g1
    const lowerT = Math.max(
      0,
      Math.min(1, (effectiveGap - this.g1 * 0.35) / (this.g1 * 0.65 - this.g1 * 0.35))
    );
    const lowerFade = lowerT * lowerT * (3.0 - 2.0 * lowerT);
    this.lowerTeethMaterial.opacity = smoothOpacity * teethSmooth * lowerFade;

    this.cavityMaterial.opacity = smoothOpacity;
    this.tongueMaterial.opacity = smoothOpacity;

    // 2. Actualizar máscara Stencil a partir del contorno labial interior 3D deformado
    for (let i = 0; i < pairCount; i++) {
      const [upperIdx, lowerIdx] = INNER_LIP_PAIRS[i]!;

      // Vértice superior
      const ux = currentPositions[upperIdx * 3]!;
      const uy = currentPositions[upperIdx * 3 + 1]!;
      const uz = currentPositions[upperIdx * 3 + 2]!;

      this.stencilPositions[i * 3] = ux;
      this.stencilPositions[i * 3 + 1] = uy;
      this.stencilPositions[i * 3 + 2] = uz;

      // Vértice inferior
      const lx = currentPositions[lowerIdx * 3]!;
      const ly = currentPositions[lowerIdx * 3 + 1]!;
      const lz = currentPositions[lowerIdx * 3 + 2]!;

      const lPosIdx = pairCount + i;
      this.stencilPositions[lPosIdx * 3] = lx;
      this.stencilPositions[lPosIdx * 3 + 1] = ly;
      this.stencilPositions[lPosIdx * 3 + 2] = lz;
    }
    const stencilPosAttr = this.stencilGeometry.attributes.position;
    if (stencilPosAttr) stencilPosAttr.needsUpdate = true;

    // Centro y métricas bucales
    const upperCenterIdx = INNER_LIP_PAIRS[5]![0]; // 13
    const lowerCenterIdx = INNER_LIP_PAIRS[5]![1]; // 14
    const leftCornerIdx = INNER_LIP_PAIRS[0]![0]; // 78
    const rightCornerIdx = INNER_LIP_PAIRS[pairCount - 1]![0]; // 308

    const ux = currentPositions[upperCenterIdx * 3]!;
    const uy = currentPositions[upperCenterIdx * 3 + 1]!;
    const uz = currentPositions[upperCenterIdx * 3 + 2]!;

    const lx = currentPositions[lowerCenterIdx * 3]!;
    const ly = currentPositions[lowerCenterIdx * 3 + 1]!;
    const lz = currentPositions[lowerCenterIdx * 3 + 2]!;

    const cx = 0.5 * (ux + lx);
    const cy = 0.5 * (uy + ly);
    const cz = 0.5 * (uz + lz);

    const leftX = currentPositions[leftCornerIdx * 3]!;
    const rightX = currentPositions[rightCornerIdx * 3]!;
    const mouthWidth = Math.max(0.01, Math.abs(rightX - leftX));
    const gapY =
      debugEffectiveGap >= 0
        ? debugEffectiveGap * faceScale
        : Math.max(0.001, uy - ly);

    // 3. Actualizar Cavidad 3D convexa detrás de los labios
    const cavityDepth = Math.max(0.015, faceScale * 0.12);
    const cVerts = pairCount * 2; // 22

    for (let i = 0; i < pairCount; i++) {
      // Frente superior
      const fx_u = this.stencilPositions[i * 3]!;
      const fy_u = this.stencilPositions[i * 3 + 1]!;
      const fz_u = this.stencilPositions[i * 3 + 2]!;
      this.cavityPositions[i * 3] = fx_u;
      this.cavityPositions[i * 3 + 1] = fy_u;
      this.cavityPositions[i * 3 + 2] = fz_u;

      // Frente inferior
      const lIdx = pairCount + i;
      const fx_l = this.stencilPositions[lIdx * 3]!;
      const fy_l = this.stencilPositions[lIdx * 3 + 1]!;
      const fz_l = this.stencilPositions[lIdx * 3 + 2]!;
      this.cavityPositions[lIdx * 3] = fx_l;
      this.cavityPositions[lIdx * 3 + 1] = fy_l;
      this.cavityPositions[lIdx * 3 + 2] = fz_l;

      // Fondo superior (recesado en -z y convergente hacia la faringe)
      const buIdx = cVerts + i;
      this.cavityPositions[buIdx * 3] = cx + (fx_u - cx) * 0.6;
      this.cavityPositions[buIdx * 3 + 1] = cy + (fy_u - cy) * 0.6;
      this.cavityPositions[buIdx * 3 + 2] = cz - cavityDepth;

      // Fondo inferior
      const blIdx = cVerts + pairCount + i;
      this.cavityPositions[blIdx * 3] = cx + (fx_l - cx) * 0.6;
      this.cavityPositions[blIdx * 3 + 1] = cy + (fy_l - cy) * 0.6;
      this.cavityPositions[blIdx * 3 + 2] = cz - cavityDepth;
    }
    const cavityPosAttr = this.cavityGeometry.attributes.position;
    if (cavityPosAttr) cavityPosAttr.needsUpdate = true;

    // 4. Actualizar Dientes Superiores (Rejilla 25 columnas x 4 filas)
    // Siguen la curvatura del contorno del labio superior e interpolan hU
    const upperCols = 25;
    const upperRows = 4;
    const upperArchHalfWidth = mouthWidth * 0.40;
    const hU = Math.min(0.024 * (faceScale / 0.45), gapY * 0.70);

    for (let c = 0; c < upperCols; c++) {
      const u = (c / (upperCols - 1)) * 2.0 - 1.0; // [-1, 1]
      const tx = cx + u * upperArchHalfWidth;
      const archFactor = 1.0 - 0.18 * (u * u); // 1.0 al centro, 0.82 en extremos
      const lipY = this.interpolateLipY(tx, true);
      const lipZ = this.interpolateLipZ(tx, true);
      const parabolicZ = -(Math.pow(Math.abs(u), 2.2)) * mouthWidth * 0.14;

      const yGing = lipY + 0.30 * hU;
      const yInc = lipY - hU * archFactor;
      const zBase = lipZ - 0.0035 + parabolicZ;

      for (let r = 0; r < upperRows; r++) {
        const frac = r / (upperRows - 1);
        const idx = (r * upperCols + c) * 3;
        this.upperTeethPositions[idx] = tx;
        this.upperTeethPositions[idx + 1] = yGing + (yInc - yGing) * frac;
        this.upperTeethPositions[idx + 2] = zBase;
      }
    }
    const upperPosAttr = this.upperTeethGeometry.attributes.position;
    if (upperPosAttr) upperPosAttr.needsUpdate = true;

    // 5. Actualizar Dientes Inferiores (Rejilla 21 columnas x 4 filas)
    // Anclados al contorno del labio inferior (L14)
    const lowerCols = 21;
    const lowerRows = 4;
    const lowerArchHalfWidth = mouthWidth * 0.34;
    const hL = Math.min(0.011 * (faceScale / 0.45), gapY * 0.28);

    for (let c = 0; c < lowerCols; c++) {
      const u = (c / (lowerCols - 1)) * 2.0 - 1.0; // [-1, 1]
      const tx = cx + u * lowerArchHalfWidth;
      const archFactor = 1.0 - 0.18 * (u * u);
      const lipY = this.interpolateLipY(tx, false);
      const lipZ = this.interpolateLipZ(tx, false);
      const parabolicZ = -(Math.pow(Math.abs(u), 2.2)) * mouthWidth * 0.12;

      const yInc = lipY + hL * archFactor;
      const yGing = lipY - 0.30 * hL;
      const zBase = lipZ - 0.0045 + parabolicZ;

      for (let r = 0; r < lowerRows; r++) {
        const frac = r / (lowerRows - 1);
        const idx = (r * lowerCols + c) * 3;
        this.lowerTeethPositions[idx] = tx;
        this.lowerTeethPositions[idx + 1] = yInc + (yGing - yInc) * frac;
        this.lowerTeethPositions[idx + 2] = zBase;
      }
    }
    const lowerPosAttr = this.lowerTeethGeometry.attributes.position;
    if (lowerPosAttr) lowerPosAttr.needsUpdate = true;
    if (lowerPosAttr) lowerPosAttr.needsUpdate = true;

    // 6. Actualizar Lengua 3D con 2 DOF (Elevación y Avance)
    // Elevación lingual: sube hacia los incisivos superiores en /l, t, d, n/
    const elevY = (tongueElevation - 0.2) * gapY * 0.55;
    // Avance lingual: avanza hacia afuera (+z) en /θ, s/
    const advanceZ = tongueProtrusion * (mouthWidth * 0.15);

    const tongueBaseY = ly + gapY * 0.25 + elevY;
    const tongueBaseZ = cz - 0.006 + advanceZ;

    this.tongueMesh.position.set(cx, tongueBaseY, tongueBaseZ);
    this.tongueMesh.scale.set(
      mouthWidth * 0.32,
      Math.max(0.003, gapY * 0.35),
      mouthWidth * 0.28
    );
  }

  public destroy(): void {
    this.stencilGeometry.dispose();
    this.stencilMaterial.dispose();
    this.cavityGeometry.dispose();
    this.cavityMaterial.dispose();
    this.cavityTexture.dispose();
    this.upperTeethGeometry.dispose();
    this.upperTeethMaterial.dispose();
    this.teethTexture.dispose();
    this.lowerTeethGeometry.dispose();
    this.lowerTeethMaterial.dispose();
    this.lowerTeethTexture.dispose();
    this.tongueGeometry.dispose();
    this.tongueMaterial.dispose();
    this.tongueTexture.dispose();
  }
}
