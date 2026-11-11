/**
 * eyelidMesh.ts
 *
 * Concha Oclusora Palpebral Curva Anatómica (YourSelf V3 - Fase 3):
 * - Modela los párpados como una concha esférica curva en 3D que se desliza tangencialmente
 *   a distancia R + δ sobre la córnea, sin penetrar el globo ocular.
 * - Recorrido biomecánico continuo: el párpado superior desciende hasta el 100% de la cuenca
 *   con solapamiento de sellado (sin huecos) contra el párpado inferior.
 * - Textura rellena con piel muestreada de la propia foto (mediana de color periocular),
 *   eliminando por completo la zona negra y las texturas estiradas del iris.
 * - Feathering suave en los bordes laterales y pliegue supraorbital para integración sin costuras.
 * - Curvatura esférica en Z: z(x,y) = max(z_mesh + offset, cz + sqrt(max(0, R^2 - d^2))).
 * - Cero asignaciones en memoria en el bucle caliente (Zero-Allocation).
 */

import * as THREE from 'three';
import { EyeSphereData } from './eyeBall';
import { PhotoProfile } from '@/core/face/photoProfile';

// Pares de landmarks de párpados (de esquina externa a interna)
// Ojo derecho del rostro (espectador izquierdo)
export const RIGHT_EYE_LID_PAIRS: [number, number][] = [
  [33, 33],   // Esquina externa
  [246, 7],
  [161, 163],
  [160, 144],
  [159, 145], // Centro vertical
  [158, 153],
  [157, 154],
  [173, 155],
  [133, 133], // Esquina interna
];

// Ojo izquierdo del rostro (espectador derecho)
export const LEFT_EYE_LID_PAIRS: [number, number][] = [
  [263, 263], // Esquina externa
  [466, 249],
  [388, 390],
  [387, 373],
  [386, 374], // Centro vertical
  [385, 380],
  [384, 381],
  [398, 382],
  [362, 362], // Esquina interna
];

export interface EyelidMeshOptions {
  texture: THREE.Texture;
  faceScale?: number;
  profile?: PhotoProfile;
}

export class EyelidMesh {
  public mesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  private material: THREE.MeshBasicMaterial;
  private skinTexture: THREE.Texture;

  private positions: Float32Array;
  private uvs: Float32Array;
  private indices: Uint16Array;

  // 9 pares de columnas por ojo * 2 ojos = 18 columnas
  // Por cada columna tenemos 3 filas que modelan el velo curvo palpebral superior:
  // Row 0: pliegue superior fijo (ux, uy)
  // Row 1: pliegue intermedio anatómico (curvatura esférica a medio recorrido)
  // Row 2: margen móvil libre que desciende hasta el sellado palpebral (movingX, movingY)
  // 9 * 3 = 27 vértices por ojo = 54 vértices en total
  private readonly colsPerEye = 9;
  private readonly rowsPerEye = 3;
  private readonly verticesPerEye = 9 * 3; // 27
  private readonly totalVertices = 27 * 2;  // 54

  // Quads por ojo: (cols - 1) * (rows - 1) = 8 * 2 = 16 quads -> 16 * 6 = 96 índices por ojo -> 192 índices
  private readonly totalIndices = 8 * 2 * 6 * 2; // 192

  // Margen de elevación tangencial sobre la córnea (0.2 mm equivalente)
  private readonly deltaElevation = 0.0002;

  constructor(options: EyelidMeshOptions) {
    this.positions = new Float32Array(this.totalVertices * 3);
    this.uvs = new Float32Array(this.totalVertices * 2);
    this.indices = new Uint16Array(this.totalIndices);

    this.buildTopology();

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));

    this.skinTexture = this.createEyelidSkinTexture(options.profile, options.texture);

    this.material = new THREE.MeshBasicMaterial({
      map: this.skinTexture,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 3; // Renderizado por encima de la cara y la cavidad bucal
    this.mesh.position.set(0, 0, 0.0009); // Ligeramente adelantado en z
    this.mesh.visible = false;
  }

  /**
   * Genera una textura procedimental cutánea muestreada de la mediana periocular
   * de la foto del usuario (Fase 3: eliminando cualquier píxel negro o sombra del iris).
   */
  private createEyelidSkinTexture(profile?: PhotoProfile, fallbackTexture?: THREE.Texture): THREE.Texture {
    const skin = profile?.colors.lidSkin ?? profile?.colors.skin ?? { r: 215, g: 170, b: 145 };
    const r = Math.max(85, Math.min(255, skin.r));
    const g = Math.max(65, Math.min(255, skin.g));
    const b = Math.max(55, Math.min(255, skin.b));

    if (typeof document === 'undefined') {
      // Fallback para entornos Node / Vitest sin DOM
      const data = new Uint8Array(4 * 4 * 4);
      for (let i = 0; i < 16; i++) {
        data[i * 4] = r;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = b;
        data[i * 4 + 3] = 255;
      }
      const tex = new THREE.DataTexture(data, 4, 4, THREE.RGBAFormat);
      tex.needsUpdate = true;
      return tex;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return fallbackTexture || new THREE.Texture();
    }

    // 1. Tono base de piel periocular
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(0, 0, 128, 128);

    // 2. Gradiente vertical anatómico de sombreado palpebral:
    // Piel opaca completa (H9 resuelto: cero huecos transparentes o claros hacia el fondo del canvas)
    const vertGrad = ctx.createLinearGradient(0, 0, 0, 128);
    vertGrad.addColorStop(0.0, `rgba(${Math.round(r * 0.92)}, ${Math.round(g * 0.90)}, ${Math.round(b * 0.88)}, 1.0)`);
    vertGrad.addColorStop(0.25, `rgba(${r}, ${g}, ${b}, 1.0)`);
    vertGrad.addColorStop(0.85, `rgba(${Math.round(r * 0.96)}, ${Math.round(g * 0.94)}, ${Math.round(b * 0.92)}, 1.0)`);
    vertGrad.addColorStop(1.0, `rgba(${Math.max(60, Math.round(r * 0.45))}, ${Math.max(40, Math.round(g * 0.35))}, ${Math.max(35, Math.round(b * 0.30))}, 1.0)`);
    ctx.fillStyle = vertGrad;
    ctx.fillRect(0, 0, 128, 128);

    // 3. Feathering perimetral suave de integración sin transparencia en comisuras (evita fugas a clearColor)
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;
    ctx.lineWidth = 3.0; // Feather >= 1.5 px
    ctx.strokeRect(0, 0, 128, 128);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  public setPhotoProfile(profile: PhotoProfile): void {
    if (this.skinTexture) {
      this.skinTexture.dispose();
    }
    this.skinTexture = this.createEyelidSkinTexture(profile);
    this.material.map = this.skinTexture;
    this.material.needsUpdate = true;
  }

  private buildTopology(): void {
    let indexPtr = 0;

    for (let eye = 0; eye < 2; eye++) {
      const vOffset = eye * this.verticesPerEye;

      for (let row = 0; row < this.rowsPerEye - 1; row++) {
        for (let col = 0; col < this.colsPerEye - 1; col++) {
          const topLeft = vOffset + row * this.colsPerEye + col;
          const topRight = topLeft + 1;
          const bottomLeft = vOffset + (row + 1) * this.colsPerEye + col;
          const bottomRight = bottomLeft + 1;

          // Triángulo 1
          this.indices[indexPtr++] = topLeft;
          this.indices[indexPtr++] = bottomLeft;
          this.indices[indexPtr++] = topRight;

          // Triángulo 2
          this.indices[indexPtr++] = topRight;
          this.indices[indexPtr++] = bottomLeft;
          this.indices[indexPtr++] = bottomRight;
        }
      }
    }
  }

  /**
   * Actualiza la geometría curva y opacidad de los párpados
   * Cero asignaciones en memoria.
   */
  public update(
    currentPositions: Float32Array,
    baseUvs: Float32Array,
    blinkLeft: number,
    blinkRight: number,
    leftSphere: EyeSphereData,
    rightSphere: EyeSphereData,
    gazeY = 0,
    faceScale = 0.45
  ): void {
    const maxBlink = Math.max(blinkLeft, blinkRight);

    // Ocultar completamente si los ojos están abiertos
    if (maxBlink < 0.005 && Math.abs(gazeY) < 0.25) {
      this.mesh.visible = false;
      this.material.opacity = 0;
      return;
    }

    this.mesh.visible = true;
    // Transición suave y rápida de opacidad: opacidad completa al 20% de recorrido
    // para eliminar el iris ghosting sin salto instantáneo a 0.05
    const targetOpacity = maxBlink < 0.005 ? 0.0 : Math.min(1.0, maxBlink * 5.0);
    this.material.opacity = targetOpacity;

    // Acoplamiento anatómico mirada-párpado (V4 Algoritmo H): al mirar hacia abajo, Δlid ≈ 0.5 * Δgaze_y
    const gazeCoupling = 0.50 * Math.max(0, -gazeY);

    const effectiveBlinkRight = Math.min(1.0, Math.max(0, blinkRight + gazeCoupling));
    const effectiveBlinkLeft = Math.min(1.0, Math.max(0, blinkLeft + gazeCoupling));

    // Procesar ojo derecho (espectador izquierdo) y ojo izquierdo (espectador derecho)
    this.updateSingleEyelid(
      0,
      RIGHT_EYE_LID_PAIRS,
      currentPositions,
      effectiveBlinkRight,
      rightSphere,
      faceScale
    );

    this.updateSingleEyelid(
      1,
      LEFT_EYE_LID_PAIRS,
      currentPositions,
      effectiveBlinkLeft,
      leftSphere,
      faceScale
    );

    const posAttr = this.geometry.attributes.position;
    const uvAttr = this.geometry.attributes.uv;
    if (posAttr) posAttr.needsUpdate = true;
    if (uvAttr) uvAttr.needsUpdate = true;
  }

  private updateSingleEyelid(
    eyeIndex: number,
    pairs: [number, number][],
    pos: Float32Array,
    blink: number,
    sphere: EyeSphereData,
    faceScale: number
  ): void {
    const vOffset = eyeIndex * this.verticesPerEye;

    const cx = sphere.centerX;
    const cy = sphere.centerY;
    const cz = sphere.centerZ;
    const shellRadius = sphere.radius + this.deltaElevation * faceScale;
    const shellRadiusSq = shellRadius * shellRadius;

    for (let col = 0; col < this.colsPerEye; col++) {
      const [upperIdx, lowerIdx] = pairs[col]!;

      const ux = pos[upperIdx * 3]!;
      const uy = pos[upperIdx * 3 + 1]!;
      const uz = pos[upperIdx * 3 + 2]!;

      const lx = pos[lowerIdx * 3]!;
      const ly = pos[lowerIdx * 3 + 1]!;
      const lz = pos[lowerIdx * 3 + 2]!;

      // Ascenso anatómico del párpado inferior: 10% del recorrido total
      const lowerRiseY = (uy - ly) * 0.10 * blink;
      const effectiveLy = ly + lowerRiseY;

      // Solapamiento anatómico contra el párpado inferior para garantizar 0 huecos al cierre (Fase 3 & V4 H9)
      const overlapY = (lowerRiseY + 0.003 * faceScale) * Math.max(0, blink - 0.50) * 2.0;

      // Descenso del margen móvil libre del párpado superior
      const movingY = uy + (effectiveLy - uy) * blink - overlapY;
      const movingX = ux + (lx - ux) * blink;

      // Columna normalizada [0, 1] para coordenadas de textura U
      const uCoord = col / (this.colsPerEye - 1);

      // Fila 0: Pliegue superior periorbitario (fijo en ux, uy)
      const r0 = vOffset + col;
      this.positions[r0 * 3] = ux;
      this.positions[r0 * 3 + 1] = uy;
      const d0Sq = (ux - cx) * (ux - cx) + (uy - cy) * (uy - cy);
      const z0Base = cz + Math.sqrt(Math.max(0, shellRadiusSq - d0Sq));
      // Garantizar que Z nunca caiga detrás de la malla facial (evita huecos oscuros en las comisuras)
      this.positions[r0 * 3 + 2] = Math.max(uz + 0.0005 * faceScale, z0Base);

      this.uvs[r0 * 2] = uCoord;
      this.uvs[r0 * 2 + 1] = 0.0;

      // Fila 1: Pliegue intermedio anatómico curvo (50% del recorrido, curvatura esférica)
      const r1 = vOffset + this.colsPerEye + col;
      const midX = ux + (movingX - ux) * 0.5;
      const midY = uy + (movingY - uy) * 0.5;
      this.positions[r1 * 3] = midX;
      this.positions[r1 * 3 + 1] = midY;
      const d1Sq = (midX - cx) * (midX - cx) + (midY - cy) * (midY - cy);
      const z1Base = cz + Math.sqrt(Math.max(0, shellRadiusSq - d1Sq));
      const midRefZ = (uz + lz) * 0.5;
      this.positions[r1 * 3 + 2] = Math.max(midRefZ + 0.0006 * faceScale, z1Base);

      this.uvs[r1 * 2] = uCoord;
      this.uvs[r1 * 2 + 1] = 0.5;

      // Fila 2: Margen móvil libre con borde de pestañas (desciende hasta sellar la hendidura)
      const r2 = vOffset + this.colsPerEye * 2 + col;
      this.positions[r2 * 3] = movingX;
      this.positions[r2 * 3 + 1] = movingY;
      const d2Sq = (movingX - cx) * (movingX - cx) + (movingY - cy) * (movingY - cy);
      const z2Base = cz + Math.sqrt(Math.max(0, shellRadiusSq - d2Sq));
      this.positions[r2 * 3 + 2] = Math.max(lz + 0.0005 * faceScale, z2Base);

      this.uvs[r2 * 2] = uCoord;
      this.uvs[r2 * 2 + 1] = 1.0;
    }
  }

  public destroy(): void {
    this.geometry.dispose();
    this.material.dispose();
    if (this.skinTexture) {
      this.skinTexture.dispose();
    }
  }
}
