/**
 * poses.ts
 *
 * Sistema de morphing y deformación para el avatar:
 * - Parpadeo (blink) realista: une párpados superior e inferior, desplaza iris/pupila hacia abajo
 *   y deforma los pliegues superiores con atenuación de distancia para un cierre natural.
 * - Mirada (gaze) con desplazamiento del iris.
 * - Elevación de cejas (browRaise).
 * - Expresión de sonrisa (smile).
 * - Habla y boca: jawOpen, mouthRound, mouthWide.
 * - Balanceo cefálico (headYaw, headPitch, headRoll) con caída suave hacia el perímetro.
 */

import { LANDMARK_INDICES } from '@/core/face/landmarkGroups';
import { PoseValues } from '@/core/animation/animationState';
import { FaceMeshRegions } from '@/core/face/buildMesh';
import { RigBasis } from '@/core/rig/basis';
import { Rig } from '@/core/rig/rig';
import { JawBone } from '@/core/rig/jawBone';
import { ClosedLoopRetargeter } from '@/core/rig/closedLoop';
import { HeadLayers } from '@/core/face3d/layers';

export interface PoseDeformerConfig {
  basePositions: Float32Array;
  landmarkCount: number; // 478
  vertexCount: number;   // 494 o 522 con anillos
  indices?: Uint16Array;
  faceScale?: number;
  rigVersion?: 'v1' | 'v2' | 'v3' | 'v4';
  regions?: FaceMeshRegions;
}

// Pares de párpados (Superior -> Inferior)
// Ojo derecho del rostro (izquierdo para el espectador)
const RIGHT_EYE_PAIRS: [number, number][] = [
  [160, 144],
  [159, 145], // Centro vertical
  [158, 153],
  [157, 154],
  [173, 155],
  [161, 163],
  [246, 7],
];

// Ojo izquierdo del rostro (derecho para el espectador)
const LEFT_EYE_PAIRS: [number, number][] = [
  [387, 373],
  [386, 374], // Centro vertical
  [385, 380],
  [384, 381],
  [398, 382],
  [388, 390],
  [466, 249],
];

// Pliegues y piel adyacente sobre el párpado superior que descienden con el parpadeo
const RIGHT_UPPER_CREASE = [27, 28, 29, 30, 247, 161, 160, 159, 158, 157, 173];
const LEFT_UPPER_CREASE = [257, 258, 259, 260, 467, 388, 387, 386, 385, 384, 398];

export class PoseDeformer {
  private basePositions: Float32Array;
  private landmarkCount: number;
  private vertexCount: number;
  private indices?: Uint16Array;
  private faceScale = 0.45;
  private rigVersion: 'v1' | 'v2' | 'v3' | 'v4' = 'v3';
  private regions?: FaceMeshRegions;
  private rig?: Rig;

  public jawBone?: JawBone;
  public closedLoop?: ClosedLoopRetargeter;
  public headLayers?: HeadLayers;

  // Centro de la cabeza de referencia (nariz / entrecejo)
  private headCenterX = 0;
  private headCenterY = 0;
  private headRadius = 0.5;

  // Ponderaciones precalculadas de caída por distancia para balanceo de cabeza y respiración
  private headSwayWeights: Float32Array;
  private neckBreathWeights: Float32Array;

  // Referencias para escalas de ojos y labios
  private eyeWidth = 0.1;
  private eyeHeight = 0.05;
  private mouthWidth = 0.15;
  private mouthHeight = 0.08;

  constructor(config: PoseDeformerConfig) {
    this.basePositions = config.basePositions;
    this.landmarkCount = config.landmarkCount;
    this.vertexCount = config.vertexCount;
    this.indices = config.indices;
    this.faceScale = config.faceScale ?? 0.45;
    this.rigVersion = config.rigVersion ?? 'v1';
    this.regions = config.regions;

    this.headSwayWeights = new Float32Array(this.vertexCount);
    this.neckBreathWeights = new Float32Array(this.vertexCount);
    this.initReferences();

    if (this.rigVersion === 'v2' || this.rigVersion === 'v3' || this.rigVersion === 'v4') {
      this.initV2Rig();
    }
  }

  public getRig(): Rig | undefined {
    return this.rig;
  }

  public setRigVersion(version: 'v1' | 'v2' | 'v3' | 'v4'): void {
    this.rigVersion = version;
    if ((version === 'v2' || version === 'v3' || version === 'v4') && !this.rig) {
      this.initV2Rig();
    } else if (this.rig) {
      this.rig.setRigVersion(version, this.indices);
      this.jawBone = this.rig.jawBone;
      this.closedLoop = this.rig.closedLoop;
      this.headLayers = this.rig.headLayers;
    }
  }

  public setFaceScale(scale: number): void {
    this.faceScale = Math.max(0.1, scale);
    this.initReferences();
    if (this.rig) {
      this.rig.setFaceScale(this.faceScale);
    }
  }

  private initV2Rig(): void {
    const defaultRegions: FaceMeshRegions = this.regions ?? {
      leftEye: [...LANDMARK_INDICES.leftEyeUpper, ...LANDMARK_INDICES.leftEyeLower, ...LANDMARK_INDICES.leftIris],
      rightEye: [...LANDMARK_INDICES.rightEyeUpper, ...LANDMARK_INDICES.rightEyeLower, ...LANDMARK_INDICES.rightIris],
      brows: [...LANDMARK_INDICES.leftEyebrow, ...LANDMARK_INDICES.rightEyebrow],
      nose: [...LANDMARK_INDICES.noseBridge, LANDMARK_INDICES.noseTip],
      mouth: [...LANDMARK_INDICES.lipsOuterContour, ...LANDMARK_INDICES.lipsInnerContour],
      jaw: [...LANDMARK_INDICES.chinGroup],
      oval: [...LANDMARK_INDICES.faceOval],
      anchors: [],
    };

    const basis = new RigBasis({
      basePositions: this.basePositions,
      vertexCount: this.vertexCount,
      landmarkCount: this.landmarkCount,
      faceScale: this.faceScale,
      regions: defaultRegions,
    });

    this.rig = new Rig({
      basePositions: this.basePositions,
      vertexCount: this.vertexCount,
      landmarkCount: this.landmarkCount,
      faceScale: this.faceScale,
      basis,
      indices: this.indices,
      rigVersion: this.rigVersion,
    });

    if (this.rigVersion === 'v4') {
      this.jawBone = this.rig.jawBone;
      this.closedLoop = this.rig.closedLoop;
      this.headLayers = this.rig.headLayers;
    }
  }

  private initReferences(): void {
    const base = this.basePositions;

    // Centro del rostro: Landmark de nariz tip (1)
    const noseIdx = LANDMARK_INDICES.noseTip;
    this.headCenterX = base[noseIdx * 3]!;
    this.headCenterY = base[noseIdx * 3 + 1]!;

    // Calcular radio aproximado del rostro a partir del mentón
    const chinIdx = LANDMARK_INDICES.chinBottom;
    const chinX = base[chinIdx * 3]!;
    const chinY = base[chinIdx * 3 + 1]!;
    const chinDist = Math.hypot(chinX - this.headCenterX, chinY - this.headCenterY);
    this.headRadius = Math.max(0.2, chinDist * 1.15);

    // Dimensiones de ojos
    const lOuter = LANDMARK_INDICES.leftEyeCornerOuter;
    const lInner = LANDMARK_INDICES.leftEyeCornerInner;
    this.eyeWidth = Math.hypot(
      base[lOuter * 3]! - base[lInner * 3]!,
      base[lOuter * 3 + 1]! - base[lInner * 3 + 1]!
    );
    this.eyeHeight = Math.max(0.02, this.eyeWidth * 0.45);

    // Dimensiones de boca
    const mLeft = LANDMARK_INDICES.lipLeftCorner;
    const mRight = LANDMARK_INDICES.lipRightCorner;
    this.mouthWidth = Math.hypot(
      base[mLeft * 3]! - base[mRight * 3]!,
      base[mLeft * 3 + 1]! - base[mRight * 3 + 1]!
    );
    const mTop = LANDMARK_INDICES.lipUpperInnerCenter;
    const mBottom = LANDMARK_INDICES.lipLowerInnerCenter;
    const rawMouthHeight = Math.abs(base[mTop * 3 + 1]! - base[mBottom * 3 + 1]!);
    if (this.rigVersion === 'v2' || this.rigVersion === 'v3') {
      // Normalizado por faceScale para fotos con boca cerrada o abierta
      this.mouthHeight = rawMouthHeight > 0.01 ? rawMouthHeight : this.faceScale * 0.28;
    } else {
      this.mouthHeight = Math.max(0.02, rawMouthHeight);
    }

    // Precalcular pesos de balanceo y respiración cervical/torácica
    for (let i = 0; i < this.vertexCount; i++) {
      if (i >= this.landmarkCount) {
        // Anclas de borde fijas: peso 0 absoluto (fondo 100% estático)
        this.headSwayWeights[i] = 0;
        this.neckBreathWeights[i] = 0;
        continue;
      }

      // Todos los 478 landmarks faciales pertenecen rígidamente al cráneo
      // para evitar que la nariz o partes internas se deslicen o deformen respecto al rostro
      this.headSwayWeights[i] = 1.0;

      // Ponderación de respiración corporal (únicamente cuello y hombros bajo la mandíbula)
      const vy = base[i * 3 + 1]!;
      const dyDown = (this.headCenterY - vy) / this.headRadius;
      if (dyDown > 0.40) {
        const breathFactor = Math.min(1.0, (dyDown - 0.40) * 1.5);
        this.neckBreathWeights[i] = breathFactor * breathFactor * (3.0 - 2.0 * breathFactor);
      } else {
        this.neckBreathWeights[i] = 0;
      }
    }
  }

  /**
   * Aplica las poses y morphing sobre currentPositions a partir de los valores de animación
   */
  public apply(
    currentPositions: Float32Array,
    poses: PoseValues,
    extraWeights?: Record<string, number>
  ): void {
    // Si estamos en Rig V2, delegar al Rig modular basado en base de formas y rotación 3D
    if (this.rigVersion === 'v2' && this.rig) {
      this.rig.apply(poses, currentPositions, extraWeights);
      return;
    }

    const base = this.basePositions;
    const n = this.vertexCount;

    // 1. Inicializar con posiciones base
    currentPositions.set(base);

    // 2. Mirada (Gaze) aplicada a los iris en reposo
    const gx = poses.gazeX;
    const gy = poses.gazeY;
    if (Math.abs(gx) > 0.01 || Math.abs(gy) > 0.01) {
      this.applyGaze(currentPositions, gx, gy);
    }

    // 3. Parpadeo (Blink) - cierre anatómico en malla nativa sin huecos ni mancha negra
    const weightRight = Math.max(0, Math.min(1, poses.blinkRight ?? poses.blink));
    const weightLeft = Math.max(0, Math.min(1, poses.blinkLeft ?? poses.blink));
    if (weightRight > 0.001 || weightLeft > 0.001) {
      this.applyBlink(currentPositions, weightRight, weightLeft);
    }

    // 4. Cejas (Brow Raise)
    if (poses.browRaise > 0.01) {
      this.applyBrowRaise(currentPositions, poses.browRaise);
    }

    // 5. Sonrisa (Smile)
    if (poses.smile > 0.01) {
      this.applySmile(currentPositions, poses.smile);
    }

    // 6. Apertura bucal (Jaw Open) modulada por sellado labial (mouthClose)
    const mouthCloseWeight = extraWeights?.['mouthClose'] ?? 0;
    const closeSup = Math.min(1.0, mouthCloseWeight * 1.6);
    const effectiveJaw = poses.jawOpen * (1.0 - closeSup);

    if (effectiveJaw > 0.005) {
      this.applyJawOpen(currentPositions, effectiveJaw);
    }

    // 7. Redondeo y extensión bucal (Mouth Round / Wide)
    const netRound = Math.max(poses.mouthRound, extraWeights?.['mouthRound'] ?? 0);
    const netWide = Math.max(poses.mouthWide, extraWeights?.['mouthWide'] ?? 0);
    if (netRound > 0.01 || netWide > 0.01) {
      this.applyMouthShape(currentPositions, netRound, netWide);
    }

    // 7.5 Formas articulatorias y blendshapes extras (mouthClose, mouthPressLips, lowerLipTuck, etc.)
    if (extraWeights) {
      this.applyExtraShapes(currentPositions, extraWeights);
    }

    // 8. Balanceo de cabeza y respiración (Head Sway & Breath)
    this.applyHeadSwayAndBreath(
      currentPositions,
      poses.headYaw,
      poses.headPitch,
      poses.headRoll,
      poses.breath,
      n
    );
  }

  private applyBlink(pos: Float32Array, weightRight: number, weightLeft = weightRight): void {
    const base = this.basePositions;

    // 1. Ojo derecho del rostro (lado izquierdo para el espectador)
    if (weightRight > 0.001) {
      for (let k = 0; k < RIGHT_EYE_PAIRS.length; k++) {
        const [upper, lower] = RIGHT_EYE_PAIRS[k]!;
        // El párpado superior desciende completamente hasta encontrar y cubrir el inferior
        const dx = (base[lower * 3]! - base[upper * 3]!) * 1.02 * weightRight;
        const dy = (base[lower * 3 + 1]! - base[upper * 3 + 1]!) * 1.02 * weightRight;

        pos[upper * 3]! += dx;
        pos[upper * 3 + 1]! += dy;
        pos[upper * 3 + 2]! += 0.001 * this.faceScale * weightRight;

        // El párpado inferior se eleva sutilmente para el sellado palpebral
        pos[lower * 3]! -= dx * 0.05;
        pos[lower * 3 + 1]! -= dy * 0.05;
        pos[lower * 3 + 2]! -= 0.001 * this.faceScale * weightRight;
      }

      // Arrastrar suavemente la piel del pliegue superior hacia abajo (excluyendo el borde palpebral)
      const rCreaseDy = this.eyeHeight * 0.35 * weightRight;
      const rightCrease = [27, 28, 29, 30, 247];
      for (let i = 0; i < rightCrease.length; i++) {
        const idx = rightCrease[i]!;
        pos[idx * 3 + 1]! -= rCreaseDy;
      }

      // Colapsar los vértices del iris hacia la línea palpebral inferior/superior cerrada (landmark 159/145)
      // para eliminar por completo la mancha negra / pupil wedge en medio de las pestañas
      const targetX = pos[159 * 3]!;
      const targetY = Math.min(pos[145 * 3 + 1]!, pos[159 * 3 + 1]!);
      const targetZ = pos[159 * 3 + 2]! - 0.004 * this.faceScale;

      const rightIris = LANDMARK_INDICES.leftIris;
      for (let i = 0; i < rightIris.length; i++) {
        const idx = rightIris[i]!;
        pos[idx * 3]! += (targetX - pos[idx * 3]!) * weightRight;
        pos[idx * 3 + 1]! += (targetY - pos[idx * 3 + 1]!) * weightRight;
        pos[idx * 3 + 2]! += (targetZ - pos[idx * 3 + 2]!) * weightRight;
      }
    }

    // 2. Ojo izquierdo del rostro (lado derecho para el espectador)
    if (weightLeft > 0.001) {
      for (let k = 0; k < LEFT_EYE_PAIRS.length; k++) {
        const [upper, lower] = LEFT_EYE_PAIRS[k]!;
        const dx = (base[lower * 3]! - base[upper * 3]!) * 1.02 * weightLeft;
        const dy = (base[lower * 3 + 1]! - base[upper * 3 + 1]!) * 1.02 * weightLeft;

        pos[upper * 3]! += dx;
        pos[upper * 3 + 1]! += dy;
        pos[upper * 3 + 2]! += 0.001 * this.faceScale * weightLeft;

        pos[lower * 3]! -= dx * 0.05;
        pos[lower * 3 + 1]! -= dy * 0.05;
        pos[lower * 3 + 2]! -= 0.001 * this.faceScale * weightLeft;
      }

      // Arrastrar suavemente la piel del pliegue superior izquierdo hacia abajo
      const lCreaseDy = this.eyeHeight * 0.35 * weightLeft;
      const leftCrease = [257, 258, 259, 260, 467];
      for (let i = 0; i < leftCrease.length; i++) {
        const idx = leftCrease[i]!;
        pos[idx * 3 + 1]! -= lCreaseDy;
      }

      // Colapsar los vértices del iris hacia la línea palpebral inferior/superior cerrada (landmark 386/374)
      const targetLX = pos[386 * 3]!;
      const targetLY = Math.min(pos[374 * 3 + 1]!, pos[386 * 3 + 1]!);
      const targetLZ = pos[386 * 3 + 2]! - 0.004 * this.faceScale;

      const leftIris = LANDMARK_INDICES.rightIris;
      for (let i = 0; i < leftIris.length; i++) {
        const idx = leftIris[i]!;
        pos[idx * 3]! += (targetLX - pos[idx * 3]!) * weightLeft;
        pos[idx * 3 + 1]! += (targetLY - pos[idx * 3 + 1]!) * weightLeft;
        pos[idx * 3 + 2]! += (targetLZ - pos[idx * 3 + 2]!) * weightLeft;
      }
    }
  }

  private applyGaze(pos: Float32Array, gazeX: number, gazeY: number): void {
    const shiftX = gazeX * this.eyeWidth * 0.22;
    const shiftY = gazeY * this.eyeHeight * 0.25;

    const leftIris = LANDMARK_INDICES.leftIris;
    for (let i = 0; i < leftIris.length; i++) {
      const idx = leftIris[i]!;
      pos[idx * 3]! += shiftX;
      pos[idx * 3 + 1]! += shiftY;
    }

    const rightIris = LANDMARK_INDICES.rightIris;
    for (let i = 0; i < rightIris.length; i++) {
      const idx = rightIris[i]!;
      pos[idx * 3]! += shiftX;
      pos[idx * 3 + 1]! += shiftY;
    }
  }

  private applyBrowRaise(pos: Float32Array, weight: number): void {
    const dy = this.eyeHeight * 0.5 * weight;

    const lBrow = LANDMARK_INDICES.leftEyebrow;
    for (let i = 0; i < lBrow.length; i++) {
      const idx = lBrow[i]!;
      pos[idx * 3 + 1]! += dy;
    }

    const rBrow = LANDMARK_INDICES.rightEyebrow;
    for (let i = 0; i < rBrow.length; i++) {
      const idx = rBrow[i]!;
      pos[idx * 3 + 1]! += dy;
    }
  }

  private applySmile(pos: Float32Array, weight: number): void {
    const base = this.basePositions;
    const dy = this.mouthHeight * 0.55 * weight;
    const dx = this.mouthWidth * 0.18 * weight;

    // Comisura izquierda: sube y se abre hacia la izquierda (-dx)
    const leftCorner = LANDMARK_INDICES.lipLeftCorner;
    pos[leftCorner * 3]! -= dx;
    pos[leftCorner * 3 + 1]! += dy;

    // Comisura derecha: sube y se abre hacia la derecha (+dx)
    const rightCorner = LANDMARK_INDICES.lipRightCorner;
    pos[rightCorner * 3]! += dx;
    pos[rightCorner * 3 + 1]! += dy;

    // Mejillas suben levemente
    pos[LANDMARK_INDICES.leftCheek * 3 + 1]! += dy * 0.4;
    pos[LANDMARK_INDICES.rightCheek * 3 + 1]! += dy * 0.4;

    // Puntos vecinos de labios exteriores
    const outerLips = LANDMARK_INDICES.lipsOuterContour;
    for (let i = 0; i < outerLips.length; i++) {
      const idx = outerLips[i]!;
      if (idx === leftCorner || idx === rightCorner) continue;
      const vx = base[idx * 3]!;
      const distLeft = Math.abs(vx - base[leftCorner * 3]!);
      const distRight = Math.abs(vx - base[rightCorner * 3]!);
      const factor = Math.max(0, 1.0 - Math.min(distLeft, distRight) / (this.mouthWidth * 0.6));
      pos[idx * 3 + 1]! += dy * 0.55 * factor;
    }
  }

  private applyJawOpen(pos: Float32Array, weight: number): void {
    const clampedWeight = Math.min(1.0, Math.max(0, weight));
    if (this.rigVersion === 'v4' && this.jawBone) {
      this.jawBone.apply(clampedWeight, this.basePositions, pos);
      return;
    }
    const isV1 = this.rigVersion === 'v1';
    const maxDrop = isV1
      ? this.mouthHeight * 3.5 * clampedWeight
      : this.faceScale * 0.25 * clampedWeight;

    // Labio inferior central y contorno con curvatura anatómica en arco (seno)
    const lowerInner = LANDMARK_INDICES.lipsLowerInner; // 11 vértices de 78 a 308
    const innerLen = lowerInner.length;
    for (let i = 0; i < innerLen; i++) {
      const idx = lowerInner[i]!;
      // En las comisuras extremas (i=0, i=10) el descenso es mínimo (0.15), en el centro (i=5) es máximo (1.0)
      const arch = Math.sin((i / (innerLen - 1)) * Math.PI);
      const dropFactor = 0.15 + 0.85 * arch;
      pos[idx * 3 + 1]! -= maxDrop * dropFactor;
      pos[idx * 3 + 2]! -= maxDrop * 0.08 * arch;
    }

    const lowerOuter = LANDMARK_INDICES.lipsLowerOuter; // 11 vértices de 61 a 291
    const outerLen = lowerOuter.length;
    for (let i = 0; i < outerLen; i++) {
      const idx = lowerOuter[i]!;
      const arch = Math.sin((i / (outerLen - 1)) * Math.PI);
      const dropFactor = 0.12 + 0.78 * arch;
      pos[idx * 3 + 1]! -= maxDrop * dropFactor;
      pos[idx * 3 + 2]! -= maxDrop * 0.06 * arch;
    }

    // Mentón y mandíbula inferior: descenso armónico con amortiguamiento radial desde chinBottom (152)
    // eliminando por completo cualquier deformación en pico poligonal
    const chinIdx = LANDMARK_INDICES.chinBottom;
    const chinX = pos[chinIdx * 3]!;
    const chinY = pos[chinIdx * 3 + 1]!;
    const chinRadius = Math.max(0.05, this.faceScale * 0.55);
    const chinDrop = isV1 ? maxDrop * 0.85 : maxDrop * 0.40;

    const chinGroup = LANDMARK_INDICES.chinGroup;
    for (let i = 0; i < chinGroup.length; i++) {
      const idx = chinGroup[i]!;
      const vx = pos[idx * 3]!;
      const vy = pos[idx * 3 + 1]!;
      const dist = Math.hypot(vx - chinX, vy - chinY);
      const factor = Math.max(0, 1.0 - dist / chinRadius);
      const smoothFactor = factor * factor * (3.0 - 2.0 * factor);
      pos[idx * 3 + 1]! -= chinDrop * smoothFactor;
      pos[idx * 3 + 2]! -= chinDrop * 0.05 * smoothFactor;
    }

    // Labio superior se eleva muy sutilmente para dar volumen
    pos[LANDMARK_INDICES.lipUpperInnerCenter * 3 + 1]! += maxDrop * 0.06;
    pos[LANDMARK_INDICES.lipUpperOuterCenter * 3 + 1]! += maxDrop * 0.04;
  }

  private applyMouthShape(pos: Float32Array, round: number, wide: number): void {
    const roundDx = this.faceScale * 0.055 * Math.min(1.0, round);
    const wideDx = this.faceScale * 0.065 * Math.min(1.0, wide);
    const netDx = wideDx - roundDx;

    // Distribuir el estiramiento/redondeo suavemente en las comisuras y anillos vecinos
    // para evitar roturas o costuras afiladas en las mejillas
    // Comisuras izquierdas (exterior 61, interior 78) y vecinos
    pos[61 * 3]! -= netDx;
    pos[78 * 3]! -= netDx;
    pos[185 * 3]! -= netDx * 0.55;
    pos[146 * 3]! -= netDx * 0.55;
    pos[191 * 3]! -= netDx * 0.45;
    pos[95 * 3]! -= netDx * 0.45;
    pos[40 * 3]! -= netDx * 0.25;
    pos[91 * 3]! -= netDx * 0.25;

    // Comisuras derechas (exterior 291, interior 308) y vecinos
    pos[291 * 3]! += netDx;
    pos[308 * 3]! += netDx;
    pos[409 * 3]! += netDx * 0.55;
    pos[375 * 3]! += netDx * 0.55;
    pos[415 * 3]! += netDx * 0.45;
    pos[324 * 3]! += netDx * 0.45;
    pos[270 * 3]! += netDx * 0.25;
    pos[321 * 3]! += netDx * 0.25;
  }

  private applyExtraShapes(pos: Float32Array, extraWeights: Record<string, number>): void {
    const scale = this.faceScale;

    // 1. Cierre hermético de labios (/m/, /b/, /p/)
    const mouthClose = extraWeights['mouthClose'] ?? 0;
    if (mouthClose > 0.005) {
      const uShift = 0.085 * scale * mouthClose;
      const lShift = 0.085 * scale * mouthClose;

      const upperInner = LANDMARK_INDICES.lipsUpperInner;
      for (let i = 0; i < upperInner.length; i++) {
        pos[upperInner[i]! * 3 + 1] -= uShift;
      }
      const upperOuter = LANDMARK_INDICES.lipsUpperOuter;
      for (let i = 0; i < upperOuter.length; i++) {
        pos[upperOuter[i]! * 3 + 1] -= uShift * 0.75;
      }

      const lowerInner = LANDMARK_INDICES.lipsLowerInner;
      for (let i = 0; i < lowerInner.length; i++) {
        pos[lowerInner[i]! * 3 + 1] += lShift;
      }
      const lowerOuter = LANDMARK_INDICES.lipsLowerOuter;
      for (let i = 0; i < lowerOuter.length; i++) {
        pos[lowerOuter[i]! * 3 + 1] += lShift * 0.75;
      }
    }

    // 2. Compresión de labios hacia adentro contra los dientes (mouthPressLips)
    const press = extraWeights['mouthPressLips'] ?? 0;
    if (press > 0.005) {
      const zPress = 0.08 * scale * press;
      const upperOuter = LANDMARK_INDICES.lipsUpperOuter;
      for (let i = 0; i < upperOuter.length; i++) {
        pos[upperOuter[i]! * 3 + 2] -= zPress;
      }
      const lowerOuter = LANDMARK_INDICES.lipsLowerOuter;
      for (let i = 0; i < lowerOuter.length; i++) {
        pos[lowerOuter[i]! * 3 + 2] -= zPress;
      }
    }

    // 3. Repliegue labiodental (/f/, /v/ - lowerLipTuck)
    const tuck = extraWeights['lowerLipTuck'] ?? 0;
    if (tuck > 0.005) {
      const tuckY = 0.14 * scale * tuck;
      const tuckZ = 0.12 * scale * tuck;
      const lowerInner = LANDMARK_INDICES.lipsLowerInner;
      for (let i = 0; i < lowerInner.length; i++) {
        pos[lowerInner[i]! * 3 + 1] += tuckY;
        pos[lowerInner[i]! * 3 + 2] -= tuckZ;
      }
      const lowerOuter = LANDMARK_INDICES.lipsLowerOuter;
      for (let i = 0; i < lowerOuter.length; i++) {
        pos[lowerOuter[i]! * 3 + 1] += tuckY * 0.65;
        pos[lowerOuter[i]! * 3 + 2] -= tuckZ * 0.75;
      }
    }

    // 4. Redondeo en embudo (mouthFunnel) y protrusión (mouthPucker) para /o/ y /u/
    const funnel = extraWeights['mouthFunnel'] ?? 0;
    const pucker = extraWeights['mouthPucker'] ?? 0;
    if (funnel > 0.005 || pucker > 0.005) {
      const inwardX = (funnel * 0.10 + pucker * 0.16) * scale;
      pos[LANDMARK_INDICES.lipLeftCorner * 3] += inwardX;
      pos[LANDMARK_INDICES.lipRightCorner * 3] -= inwardX;

      const protZ = (funnel * 0.08 + pucker * 0.15) * scale;
      pos[LANDMARK_INDICES.lipUpperOuterCenter * 3 + 2] += protZ;
      pos[LANDMARK_INDICES.lipLowerOuterCenter * 3 + 2] += protZ;
      pos[LANDMARK_INDICES.lipUpperInnerCenter * 3 + 2] += protZ * 0.85;
      pos[LANDMARK_INDICES.lipLowerInnerCenter * 3 + 2] += protZ * 0.85;

      const uIn = LANDMARK_INDICES.lipsUpperInner;
      for (let i = 0; i < uIn.length; i++) {
        const falloff = Math.sin((i / (uIn.length - 1)) * Math.PI);
        pos[uIn[i]! * 3 + 2] += protZ * 0.85 * falloff;
      }
      const lIn = LANDMARK_INDICES.lipsLowerInner;
      for (let i = 0; i < lIn.length; i++) {
        const falloff = Math.sin((i / (lIn.length - 1)) * Math.PI);
        pos[lIn[i]! * 3 + 2] += protZ * 0.85 * falloff;
      }
    }

    // 5. Estiramiento lateral de comisuras (mouthStretchLeft / Right) para /e/ e /i/
    const stretchL = extraWeights['mouthStretchLeft'] ?? 0;
    const stretchR = extraWeights['mouthStretchRight'] ?? 0;
    if (stretchL > 0.005) {
      const sDx = stretchL * 0.065 * scale;
      pos[LANDMARK_INDICES.lipLeftCorner * 3] -= sDx;
      pos[78 * 3] -= sDx;
      pos[185 * 3] -= sDx * 0.5;
      pos[146 * 3] -= sDx * 0.5;
    }
    if (stretchR > 0.005) {
      const sDx = stretchR * 0.065 * scale;
      pos[LANDMARK_INDICES.lipRightCorner * 3] += sDx;
      pos[308 * 3] += sDx;
      pos[409 * 3] += sDx * 0.5;
      pos[375 * 3] += sDx * 0.5;
    }

    // 6. Sonrisas asimétricas
    const smileL = extraWeights['mouthSmileLeft'] ?? 0;
    const smileR = extraWeights['mouthSmileRight'] ?? 0;
    if (smileL > 0.005) {
      pos[LANDMARK_INDICES.lipLeftCorner * 3] -= smileL * 0.12 * scale;
      pos[LANDMARK_INDICES.lipLeftCorner * 3 + 1] += smileL * 0.15 * scale;
      pos[LANDMARK_INDICES.leftCheek * 3 + 1] += smileL * 0.08 * scale;
    }
    if (smileR > 0.005) {
      pos[LANDMARK_INDICES.lipRightCorner * 3] += smileR * 0.12 * scale;
      pos[LANDMARK_INDICES.lipRightCorner * 3 + 1] += smileR * 0.15 * scale;
      pos[LANDMARK_INDICES.rightCheek * 3 + 1] += smileR * 0.08 * scale;
    }

    // 7. Cejas individuales y expresivas (asombro, preguntas, énfasis, fruncido al pensar)
    const biUp = extraWeights['browInnerUp'] ?? 0;
    if (biUp > 0.005) {
      const dy = biUp * 0.18 * scale;
      // Arco medial de cejas (55, 65, 52 a la izquierda; 285, 295, 282 a la derecha)
      pos[55 * 3 + 1] += dy;
      pos[65 * 3 + 1] += dy * 0.75;
      pos[52 * 3 + 1] += dy * 0.55;
      pos[285 * 3 + 1] += dy;
      pos[295 * 3 + 1] += dy * 0.75;
      pos[282 * 3 + 1] += dy * 0.55;
    }
    const boUpL = extraWeights['browOuterUpLeft'] ?? 0;
    if (boUpL > 0.005) {
      pos[70 * 3 + 1] += boUpL * 0.16 * scale;
      pos[63 * 3 + 1] += boUpL * 0.10 * scale;
    }
    const boUpR = extraWeights['browOuterUpRight'] ?? 0;
    if (boUpR > 0.005) {
      pos[300 * 3 + 1] += boUpR * 0.16 * scale;
      pos[293 * 3 + 1] += boUpR * 0.10 * scale;
    }
    const bdL = extraWeights['browDownLeft'] ?? 0;
    if (bdL > 0.005) {
      // Fruncido corrugador al pensar: ceja baja y se contrae hacia el entrecejo (+X medial)
      pos[65 * 3 + 1] -= bdL * 0.14 * scale;
      pos[55 * 3 + 1] -= bdL * 0.12 * scale;
      pos[65 * 3] += bdL * 0.05 * scale;
      pos[55 * 3] += bdL * 0.04 * scale;
    }
    const bdR = extraWeights['browDownRight'] ?? 0;
    if (bdR > 0.005) {
      // Fruncido corrugador al pensar: ceja baja y se contrae hacia el entrecejo (-X medial)
      pos[295 * 3 + 1] -= bdR * 0.14 * scale;
      pos[285 * 3 + 1] -= bdR * 0.12 * scale;
      pos[295 * 3] -= bdR * 0.05 * scale;
      pos[285 * 3] -= bdR * 0.04 * scale;
    }

    // 8. Duchenne squint (elevación de párpado inferior en sonrisa) y elevación de mejillas
    const sqL = extraWeights['eyeSquintLeft'] ?? 0;
    if (sqL > 0.005) {
      pos[145 * 3 + 1] += sqL * 0.07 * scale;
      pos[153 * 3 + 1] += sqL * 0.05 * scale;
    }
    const sqR = extraWeights['eyeSquintRight'] ?? 0;
    if (sqR > 0.005) {
      pos[374 * 3 + 1] += sqR * 0.07 * scale;
      pos[380 * 3 + 1] += sqR * 0.05 * scale;
    }

    const chkL = extraWeights['cheekRaiseLeft'] ?? 0;
    if (chkL > 0.005) {
      pos[LANDMARK_INDICES.leftCheek * 3 + 1] += chkL * 0.10 * scale;
      pos[117 * 3 + 1] += chkL * 0.06 * scale;
    }
    const chkR = extraWeights['cheekRaiseRight'] ?? 0;
    if (chkR > 0.005) {
      pos[LANDMARK_INDICES.rightCheek * 3 + 1] += chkR * 0.10 * scale;
      pos[346 * 3 + 1] += chkR * 0.06 * scale;
    }

    // 9. Comisuras tristes (mouthFrown) y hoyuelos (mouthDimple)
    const frnL = extraWeights['mouthFrownLeft'] ?? 0;
    if (frnL > 0.005) {
      pos[LANDMARK_INDICES.lipLeftCorner * 3 + 1] -= frnL * 0.12 * scale;
    }
    const frnR = extraWeights['mouthFrownRight'] ?? 0;
    if (frnR > 0.005) {
      pos[LANDMARK_INDICES.lipRightCorner * 3 + 1] -= frnR * 0.12 * scale;
    }

    const dmpL = extraWeights['mouthDimpleLeft'] ?? 0;
    if (dmpL > 0.005) {
      pos[LANDMARK_INDICES.lipLeftCorner * 3] += dmpL * 0.06 * scale;
    }
    const dmpR = extraWeights['mouthDimpleRight'] ?? 0;
    if (dmpR > 0.005) {
      pos[LANDMARK_INDICES.lipRightCorner * 3] -= dmpR * 0.06 * scale;
    }
  }

  private applyHeadSwayAndBreath(
    pos: Float32Array,
    yaw: number,
    pitch: number,
    roll: number,
    breath: number,
    count: number
  ): void {
    if (this.rigVersion === 'v4' && this.headLayers) {
      this.headLayers.applyLayeredRotation(pos, yaw, pitch, roll);
      return;
    }
    const base = this.basePositions;
    const cx = this.headCenterX;
    const cy = this.headCenterY;

    const cosRoll = Math.cos(roll);
    const sinRoll = Math.sin(roll);

    // Amplitudes de respiración escaladas por la distancia interocular (faceScale)
    const breathNorm = breath - 0.5; // [-0.5, 0.5]
    const bodyBreathDy = breathNorm * 0.024 * this.faceScale;
    const bodyBreathDx = breathNorm * 0.007 * this.faceScale;

    for (let i = 0; i < count; i++) {
      const w = this.headSwayWeights[i]!;
      const bw = this.neckBreathWeights[i]!;
      if (w <= 0.0001 && bw <= 0.0001) continue;

      let px = pos[i * 3]!;
      let py = pos[i * 3 + 1]!;

      // 1. Roll: rotación centrada uniforme
      if (Math.abs(roll) > 0.001 && w > 0.001) {
        const dx = px - cx;
        const dy = py - cy;
        const rx = cosRoll * dx - sinRoll * dy + cx;
        const ry = sinRoll * dx + cosRoll * dy + cy;
        px = px + (rx - px) * w;
        py = py + (ry - py) * w;
      }

      // 2. Yaw: giro horizontal unificado (cráneo rígido sin deformación ni deslizamiento de nariz)
      if (Math.abs(yaw) > 0.001 && w > 0.001) {
        px += yaw * this.headRadius * 0.55 * w;
      }

      // 3. Pitch: cabeceo vertical unificado
      if (Math.abs(pitch) > 0.001 && w > 0.001) {
        py += pitch * this.headRadius * 0.45 * w;
      }

      // 4. Respiración acoplada (únicamente cuello y hombros bajo el mentón)
      if (bw > 0.001) {
        const signX = (base[i * 3]! - cx) >= 0 ? 1 : -1;
        py += bodyBreathDy * bw;
        px += bodyBreathDx * signX * bw;
      }

      pos[i * 3] = px;
      pos[i * 3 + 1] = py;
    }
  }
}
