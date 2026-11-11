/**
 * mouthInterior.ts
 *
 * Cavidad bucal como Overlay geométrico (Fase 1):
 * - Principio fundamental: la malla de la cara no tiene hueco; la foto original se mantiene íntegra.
 * - La cavidad bucal se dibuja ENCIMA recortada exactamente por el contorno deformado del labio interior.
 * - Visibilidad puramente geométrica (gap / faceScale con smoothstep):
 *   Si los labios están cerrados (gap < g0), la cavidad bucal es 100% invisible y los labios son idénticos a la foto.
 * - Textura procedural adaptada al tono de piel/dientes de la foto (PhotoProfile).
 */

import * as THREE from 'three';
import { PhotoProfile } from '@/core/face/photoProfile';

// 11 pares correspondientes de los labios interiores (Superior, Inferior)
// Recorriendo de comisura izquierda (78) a comisura derecha (308)
export const INNER_LIP_PAIRS: [number, number][] = [
  [78, 78],     // Comisura izquierda interior
  [191, 95],
  [80, 88],
  [81, 178],
  [82, 87],
  [13, 14],     // Centro vertical interior
  [312, 317],
  [311, 402],
  [310, 318],
  [415, 324],
  [308, 308],   // Comisura derecha interior
];

export interface MouthInteriorOptions {
  profile?: PhotoProfile | null;
  mode?: 'procedural' | 'photo';
}

export class MouthInterior {
  public mesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  private material: THREE.MeshBasicMaterial;
  private texture: THREE.Texture;

  private positions: Float32Array;
  private uvs: Float32Array;
  private indices: Uint16Array;

  // Parámetros de visibilidad geométrica calibrados (alivia la zona muerta para aperturas pequeñas)
  private readonly g0 = 0.004; // Umbral de apertura mínima (reducido de 0.007)
  private readonly g1 = 0.026; // Umbral de apertura completa (calibrado con habla natural)

  private profile: PhotoProfile | null = null;
  public mode: 'procedural' | 'photo' = 'procedural';

  // Lengua procedural 3D como submalla
  public tongueMesh: THREE.Mesh;
  private tongueGeometry: THREE.PlaneGeometry;
  private tongueMaterial: THREE.MeshBasicMaterial;
  private tongueTexture: THREE.Texture;

  constructor(options?: MouthInteriorOptions) {
    this.profile = options?.profile ?? null;
    this.mode = options?.mode ?? (this.profile?.mouthMode !== 'closed' ? 'photo' : 'procedural');

    const pairCount = INNER_LIP_PAIRS.length; // 11
    const vertexCount = pairCount * 2;        // 22 (11 superiores, 11 inferiores)
    const quadCount = pairCount - 1;          // 10
    const indexCount = quadCount * 6;         // 60 (20 triángulos)

    this.positions = new Float32Array(vertexCount * 3);
    this.uvs = new Float32Array(vertexCount * 2);
    this.indices = new Uint16Array(indexCount);

    // Configurar UVs y topología de índices
    for (let i = 0; i < pairCount; i++) {
      const u = i / (pairCount - 1);
      // Vértice superior (i)
      this.uvs[i * 2] = u;
      this.uvs[i * 2 + 1] = 1.0;

      // Vértice inferior (pairCount + i)
      const lowerIdx = pairCount + i;
      this.uvs[lowerIdx * 2] = u;
      this.uvs[lowerIdx * 2 + 1] = 0.0;
    }

    let ptr = 0;
    for (let i = 0; i < quadCount; i++) {
      const u0 = i;
      const u1 = i + 1;
      const l0 = pairCount + i;
      const l1 = pairCount + i + 1;

      // Triángulo 1
      this.indices[ptr++] = u0;
      this.indices[ptr++] = l0;
      this.indices[ptr++] = u1;

      // Triángulo 2
      this.indices[ptr++] = u1;
      this.indices[ptr++] = l0;
      this.indices[ptr++] = l1;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));

    // Generar textura procedural con cavidad oral y dientes
    this.texture = this.createMouthTexture();

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false, // Dibuja por encima de la cara sin oclusión z errónea
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 2; // Mayor prioridad de render que la malla de la cara (renderOrder = 0 o 1)
    this.mesh.position.set(0, 0, 0.0006); // Ligeramente adelante en espacio z
    this.mesh.visible = false;

    // Submalla de lengua procedural
    this.tongueTexture = this.createTongueTexture();
    this.tongueGeometry = new THREE.PlaneGeometry(1, 1);
    this.tongueMaterial = new THREE.MeshBasicMaterial({
      map: this.tongueTexture,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    this.tongueMesh = new THREE.Mesh(this.tongueGeometry, this.tongueMaterial);
    this.tongueMesh.renderOrder = 2.1;
    this.tongueMesh.visible = false;
    this.mesh.add(this.tongueMesh);
  }

  /**
   * Actualiza el perfil fotográfico para teñir la cavidad según la piel/iluminación real
   */
  public setProfile(profile: PhotoProfile | null): void {
    this.profile = profile;
    if (this.texture) {
      this.texture.dispose();
    }
    this.texture = this.createMouthTexture();
    this.material.map = this.texture;
    this.material.needsUpdate = true;
  }

  /**
   * Genera el lienzo procedural con cavidad oral oscura, arco dental marfil anatómico y lengua suave
   */
  private createMouthTexture(): THREE.Texture {
    if (typeof document === 'undefined') {
      return new THREE.Texture();
    }
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    const teeth = this.profile?.colors.teeth ?? { r: 242, g: 238, b: 230 };
    const lip = this.profile?.colors.lip ?? { r: 195, g: 95, b: 105 };

    // Limpiar fondo a transparencia total (cero cajas rectangulares)
    ctx.clearRect(0, 0, 512, 256);

    // 1. Sombra profunda de la cavidad bucal anatómica (umbra suave con tinte labial)
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(256, 128, 195, 95, 0, 0, Math.PI * 2);
    const cavityGrad = ctx.createRadialGradient(256, 128, 15, 256, 128, 190);
    cavityGrad.addColorStop(0, '#100507');
    cavityGrad.addColorStop(0.55, '#16080b');
    cavityGrad.addColorStop(0.85, 'rgba(22, 8, 12, 0.85)');
    cavityGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = cavityGrad;
    ctx.fill();
    ctx.restore();

    // 2. Base de mucosa lingual suave en el piso de la cavidad
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(256, 185, 145, 45, 0, 0, Math.PI * 2);
    const tongueGrad = ctx.createRadialGradient(256, 175, 10, 256, 185, 135);
    tongueGrad.addColorStop(0, `rgba(${Math.min(255, lip.r + 10)}, ${Math.max(20, lip.g - 15)}, ${Math.max(25, lip.b - 15)}, 0.85)`);
    tongueGrad.addColorStop(0.65, 'rgba(115, 38, 48, 0.70)');
    tongueGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = tongueGrad;
    ctx.fill();
    ctx.restore();

    // 3. Arco dental superior continuo y anatómico (marfil suave, sin bloques cuadrados)
    ctx.save();
    const toothCount = 8;
    const archStartX = 110;
    const archEndX = 402;
    const totalArchWidth = archEndX - archStartX;
    const toothWidth = totalArchWidth / toothCount;

    for (let t = 0; t < toothCount; t++) {
      const tx = archStartX + t * toothWidth;
      const centerDist = Math.abs(t + 0.5 - toothCount / 2) / (toothCount / 2);
      // Los incisivos centrales descienden suavemente en arco parabólico natural
      const archDrop = (1.0 - centerDist * centerDist) * 16;
      const toothTop = 32 - archDrop * 0.4;
      const toothHeight = 52 + archDrop * 0.6;

      const toothGrad = ctx.createLinearGradient(tx, toothTop, tx, toothTop + toothHeight);
      toothGrad.addColorStop(0, 'rgba(95, 25, 35, 0.6)'); // Encía sutil
      toothGrad.addColorStop(0.20, `rgba(${teeth.r}, ${teeth.g}, ${teeth.b}, 0.95)`); // Esmalte marfil
      toothGrad.addColorStop(0.85, `rgba(${Math.round(teeth.r * 0.95)}, ${Math.round(teeth.g * 0.94)}, ${Math.round(teeth.b * 0.90)}, 0.92)`);
      toothGrad.addColorStop(1.0, `rgba(${Math.round(teeth.r * 0.82)}, ${Math.round(teeth.g * 0.80)}, ${Math.round(teeth.b * 0.76)}, 0.85)`); // Borde incisal

      ctx.fillStyle = toothGrad;
      ctx.beginPath();
      // Borde incisal redondeado orgánico
      ctx.roundRect(tx + 1.5, toothTop, toothWidth - 3, toothHeight, [2, 2, 5, 5]);
      ctx.fill();

      // Sombra interdental sutil y tenue
      ctx.fillStyle = 'rgba(20, 6, 10, 0.35)';
      ctx.fillRect(tx + toothWidth - 1.5, toothTop + 8, 1.5, toothHeight - 8);
    }
    ctx.restore();

    // 4. Dientes inferiores sutiles en la penumbra
    ctx.save();
    const lowerToothCount = 6;
    const lowerStartX = 145;
    const lowerEndX = 367;
    const lowerWidth = (lowerEndX - lowerStartX) / lowerToothCount;
    for (let t = 0; t < lowerToothCount; t++) {
      const tx = lowerStartX + t * lowerWidth;
      const h = 26;
      const toothGrad = ctx.createLinearGradient(tx, 218 - h, tx, 218);
      toothGrad.addColorStop(0, `rgba(${Math.round(teeth.r * 0.85)}, ${Math.round(teeth.g * 0.82)}, ${Math.round(teeth.b * 0.78)}, 0.75)`);
      toothGrad.addColorStop(1.0, 'rgba(60, 15, 22, 0.5)');

      ctx.fillStyle = toothGrad;
      ctx.beginPath();
      ctx.roundRect(tx + 1.5, 218 - h, lowerWidth - 3, h, [4, 4, 1, 1]);
      ctx.fill();
    }
    ctx.restore();

    // 5. Máscara de desvanecimiento perimetral (feather) con destination-in
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    const maskGrad = ctx.createRadialGradient(256, 128, 110, 256, 128, 205);
    maskGrad.addColorStop(0, 'rgba(0, 0, 0, 1)');
    maskGrad.addColorStop(0.72, 'rgba(0, 0, 0, 0.95)');
    maskGrad.addColorStop(0.92, 'rgba(0, 0, 0, 0.40)');
    maskGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = maskGrad;
    ctx.fillRect(0, 0, 512, 256);
    ctx.restore();

    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  /**
   * Genera la textura mucosal de la lengua procedural con sombreado y borde difuminado
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

    // Fondo transparente
    ctx.clearRect(0, 0, 128, 128);

    // Forma elíptica de ápice lingual con degradado radial mucosal
    const tongueGrad = ctx.createRadialGradient(64, 48, 8, 64, 64, 60);
    tongueGrad.addColorStop(0, `rgba(${Math.min(255, lip.r + 25)}, ${Math.max(20, lip.g - 15)}, ${Math.max(25, lip.b - 15)}, 0.95)`);
    tongueGrad.addColorStop(0.65, `rgba(${Math.max(120, lip.r - 20)}, ${Math.max(10, lip.g - 40)}, ${Math.max(15, lip.b - 35)}, 0.90)`);
    tongueGrad.addColorStop(0.90, `rgba(${Math.max(60, lip.r - 80)}, 10, 15, 0.50)`);
    tongueGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = tongueGrad;
    ctx.beginPath();
    ctx.ellipse(64, 64, 56, 48, 0, 0, Math.PI * 2);
    ctx.fill();

    // Surco medial (sulcus medianus)
    ctx.strokeStyle = `rgba(${Math.max(80, lip.r - 50)}, 10, 15, 0.40)`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(64, 30);
    ctx.lineTo(64, 88);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  /**
   * Actualiza la geometría interior, lengua procedural y su opacidad cada fotograma.
   * Soporta tanto evaluación puramente geométrica (V2/V3) como compatibilidad por jawOpen (V1).
   * @param currentPositions búfer de posiciones de la malla facial
   * @param jawOpenOrGap apertura bucal calculada
   * @param faceScale escala métrica facial
   * @param tongueElevation elevación lingual (0 = piso bucal en /a/, 1 = paladar en /l, t, d, n/)
   * @param tongueProtrusion protrusión lingual (0 = retraída, 1 = asoma entre incisivos en /th, s/)
   */
  public update(
    currentPositions: Float32Array,
    jawOpenOrGap: number,
    faceScale = 0.45,
    tongueElevation = 0,
    tongueProtrusion = 0
  ): void {
    const pairCount = INNER_LIP_PAIRS.length; // 11

    // 1. Calcular distancia geométrica real entre los labios interiores
    let totalDist = 0;
    let validPairs = 0;

    for (let i = 1; i < pairCount - 1; i++) {
      const [upperIdx, lowerIdx] = INNER_LIP_PAIRS[i]!;
      const ux = currentPositions[upperIdx * 3]!;
      const uy = currentPositions[upperIdx * 3 + 1]!;
      const lx = currentPositions[lowerIdx * 3]!;
      const ly = currentPositions[lowerIdx * 3 + 1]!;
      totalDist += Math.max(0, uy - ly);
      validPairs++;
    }

    const meanDist = validPairs > 0 ? totalDist / validPairs : 0;
    const geometricGap = meanDist / Math.max(0.01, faceScale);

    // Integrar apertura geométrica con jawOpen (para compatibilidad con tests y manual visemes)
    // Solo contribuye si jawOpen supera el umbral de apertura (0.015)
    const jawGapFallback = jawOpenOrGap >= 0.015 ? jawOpenOrGap * 0.35 : 0;
    const effectiveGap = Math.max(geometricGap, jawGapFallback);

    // Control de visibilidad con zona muerta estricta:
    // Con labios cerrados o silencio (effectiveGap < g0), opacidad = 0 y mesh.visible = false
    if (effectiveGap < this.g0) {
      this.material.opacity = 0;
      this.mesh.visible = false;
      this.tongueMesh.visible = false;
      this.tongueMaterial.opacity = 0;
      return;
    }

    // Transición smoothstep monótona de opacidad entre g0 y g1
    const t = Math.max(0, Math.min(1, (effectiveGap - this.g0) / (this.g1 - this.g0)));
    const smoothOpacity = t * t * (3.0 - 2.0 * t);

    this.mesh.visible = true;
    this.material.opacity = smoothOpacity;

    // 2. Mapear posiciones de los vértices superiores e inferiores sobre el contorno del labio
    for (let i = 0; i < pairCount; i++) {
      const [upperIdx, lowerIdx] = INNER_LIP_PAIRS[i]!;

      // En comisuras extremas el tuck es 0; en el centro se ajusta a la apertura
      const isCorner = i === 0 || i === pairCount - 1;
      const tuck = isCorner ? 0 : 0.003 * Math.min(1.0, effectiveGap / this.g1);

      // Vértice superior
      this.positions[i * 3] = currentPositions[upperIdx * 3]!;
      this.positions[i * 3 + 1] = currentPositions[upperIdx * 3 + 1]! + tuck;
      this.positions[i * 3 + 2] = currentPositions[upperIdx * 3 + 2]! + 0.0006;

      // Vértice inferior
      const lPosIdx = pairCount + i;
      this.positions[lPosIdx * 3] = currentPositions[lowerIdx * 3]!;
      this.positions[lPosIdx * 3 + 1] = currentPositions[lowerIdx * 3 + 1]! - tuck;
      this.positions[lPosIdx * 3 + 2] = currentPositions[lowerIdx * 3 + 2]! + 0.0006;
    }

    const posAttr = this.geometry.attributes.position;
    if (posAttr) {
      posAttr.needsUpdate = true;
    }

    // 3. Cinemática de la lengua procedural (cero allocations por fotograma)
    // Sube en /l, t, d, n/, baja en /a/ y asoma levemente hacia adelante en /th, s/
    const upperCenterIdx = INNER_LIP_PAIRS[5]![0]; // 13
    const lowerCenterIdx = INNER_LIP_PAIRS[5]![1]; // 14
    const leftCornerIdx = INNER_LIP_PAIRS[0]![0];  // 78
    const rightCornerIdx = INNER_LIP_PAIRS[pairCount - 1]![0]; // 308

    const ux = currentPositions[upperCenterIdx * 3]!;
    const uy = currentPositions[upperCenterIdx * 3 + 1]!;
    const lx = currentPositions[lowerCenterIdx * 3]!;
    const ly = currentPositions[lowerCenterIdx * 3 + 1]!;
    const cx = 0.5 * (ux + lx);
    const cy = 0.5 * (uy + ly);
    const gapY = Math.max(0.002, uy - ly);

    const leftX = currentPositions[leftCornerIdx * 3]!;
    const rightX = currentPositions[rightCornerIdx * 3]!;
    const mouthWidth = Math.max(0.01, Math.abs(rightX - leftX));

    this.tongueMesh.visible = true;
    this.tongueMaterial.opacity = Math.min(0.85, smoothOpacity * 0.65);

    // Desplazamiento dinámico:
    // elevationOffset mueve el ápice arriba (hacia incisivos superiores)
    const elevationOffset = (tongueElevation - 0.25) * gapY * 0.35;
    const targetTongueY = cy - gapY * 0.15 + elevationOffset;
    const targetTongueZ = -0.0001 + tongueProtrusion * 0.0003;

    this.tongueMesh.position.set(cx, targetTongueY, targetTongueZ);
    this.tongueMesh.scale.set(mouthWidth * 0.36, gapY * 0.36, 1.0);
  }

  public destroy(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.tongueGeometry.dispose();
    this.tongueMaterial.dispose();
    this.tongueTexture.dispose();
  }
}
