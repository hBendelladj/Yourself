/**
 * photoProfile.ts
 *
 * Calibración y caracterización del rostro a partir de la foto y los 478 landmarks:
 * - Calcula `faceScale` (distancia interocular en unidades de mundo) para normalizar
 *   todas las deformaciones faciales de manera invariante al tamaño de la foto.
 * - Determina `mouthMode` ('closed' | 'teethVisible' | 'openMouth') analizando la geometría y píxeles bucales.
 * - Mide `frontality` (simetría y rotación de la pose de la foto) para modular la amplitud de balanceo.
 * - Muestrea los tonos de piel, labios, esclera y párpados para teñir armoniosamente los overlays.
 */

import { FaceLandmarkPoint } from '@/lib/types';
import { LANDMARK_INDICES } from '@/core/face/landmarkGroups';

export interface RGB {
  r: number; // 0..255
  g: number;
  b: number;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PhotoProfile {
  faceScale: number; // distancia interocular en unidades de mundo Three.js (normalizador universal)
  faceHeight: number; // mentón (152) a frente (10) en unidades de mundo
  frontality: number; // 0..1 (1.0 = completamente frontal)
  neutral: {
    jawOpen: number;
    smile: number;
    browUp: number;
  };
  mouthMode: 'closed' | 'teethVisible' | 'openMouth';
  colors: {
    skin: RGB;
    lip: RGB;
    sclera: RGB;
    teeth: RGB;
    lidSkin: RGB;
  };
  eyeBoxes: {
    left: Box;
    right: Box;
  };
}

export interface PhotoProfileCalibrationOptions {
  landmarks: FaceLandmarkPoint[];
  worldWidth: number;
  worldHeight: number;
  imageElement?: HTMLImageElement | CanvasImageSource | null;
  blendshapes?: Record<string, number> | null;
}

/**
 * Convierte coordenadas normalizadas de landmark [0, 1] a coordenadas Three.js centradas
 */
function toWorldCoords(
  pt: { x: number; y: number },
  worldWidth: number,
  worldHeight: number
): { x: number; y: number } {
  return {
    x: (pt.x - 0.5) * worldWidth,
    y: (0.5 - pt.y) * worldHeight,
  };
}

/**
 * Muestrea el color RGB promedio en torno a una coordenada UV normalizada [0, 1]
 */
function sampleColorAt(
  ctx: CanvasRenderingContext2D | null,
  uvX: number,
  uvY: number,
  canvasWidth: number,
  canvasHeight: number,
  fallback: RGB,
  radius = 2
): RGB {
  if (!ctx || canvasWidth <= 0 || canvasHeight <= 0) return fallback;

  try {
    const px = Math.max(0, Math.min(canvasWidth - 1, Math.round(uvX * canvasWidth)));
    const py = Math.max(0, Math.min(canvasHeight - 1, Math.round(uvY * canvasHeight)));

    const startX = Math.max(0, px - radius);
    const startY = Math.max(0, py - radius);
    const w = Math.min(canvasWidth - startX, radius * 2 + 1);
    const h = Math.min(canvasHeight - startY, radius * 2 + 1);

    const imgData = ctx.getImageData(startX, startY, w, h).data;
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let count = 0;

    for (let i = 0; i < imgData.length; i += 4) {
      rSum += imgData[i]!;
      gSum += imgData[i + 1]!;
      bSum += imgData[i + 2]!;
      count++;
    }

    if (count === 0) return fallback;
    return {
      r: Math.round(rSum / count),
      g: Math.round(gSum / count),
      b: Math.round(bSum / count),
    };
  } catch {
    return fallback;
  }
}

/**
 * Calibra el PhotoProfile una única vez al subir la imagen
 */
export function calibratePhotoProfile(
  options: PhotoProfileCalibrationOptions
): PhotoProfile {
  const { landmarks, worldWidth, worldHeight, imageElement, blendshapes } = options;

  if (!landmarks || landmarks.length < 468) {
    throw new Error('Se requieren al menos 468 landmarks faciales para calibrar el perfil fotográfico.');
  }

  // 1. Calcular distancia interocular (faceScale) en unidades de mundo Three.js
  // MediaPipe: 468 = centro pupila/iris izq (derecha espectador), 473 = pupila der (izq espectador)
  // O esquinas interiores de ojos 133 y 362
  const leftPupil = landmarks[LANDMARK_INDICES.leftIrisCenter] || landmarks[133]!;
  const rightPupil = landmarks[LANDMARK_INDICES.rightIrisCenter] || landmarks[362]!;

  const leftPupilWorld = toWorldCoords(leftPupil, worldWidth, worldHeight);
  const rightPupilWorld = toWorldCoords(rightPupil, worldWidth, worldHeight);

  const faceScale = Math.max(
    0.1,
    Math.hypot(rightPupilWorld.x - leftPupilWorld.x, rightPupilWorld.y - leftPupilWorld.y)
  );

  // 2. Altura facial: mentón (152) a centro de frente (10)
  const chinPt = landmarks[LANDMARK_INDICES.chinBottom]!;
  const foreheadPt = landmarks[LANDMARK_INDICES.foreheadCenter]!;
  const chinWorld = toWorldCoords(chinPt, worldWidth, worldHeight);
  const foreheadWorld = toWorldCoords(foreheadPt, worldWidth, worldHeight);
  const faceHeight = Math.hypot(foreheadWorld.x - chinWorld.x, foreheadWorld.y - chinWorld.y);

  // 3. Estimar frontalidad a partir de simetría horizontal respecto a la nariz (1)
  const nosePt = landmarks[LANDMARK_INDICES.noseTip]!;
  const leftCheekPt = landmarks[LANDMARK_INDICES.leftCheek]!;
  const rightCheekPt = landmarks[LANDMARK_INDICES.rightCheek]!;

  const dLeft = Math.abs(leftCheekPt.x - nosePt.x);
  const dRight = Math.abs(nosePt.x - rightCheekPt.x);
  const maxD = Math.max(0.001, Math.max(dLeft, dRight));
  const minD = Math.min(dLeft, dRight);
  const symmetryRatio = minD / maxD; // 1.0 = simétrico, < 0.6 = ladeado o 3/4
  const frontality = Math.max(0.3, Math.min(1.0, symmetryRatio * 1.05));

  // 4. Muestreo de colores desde Canvas si está disponible
  let canvasCtx: CanvasRenderingContext2D | null = null;
  let canvasWidth = 0;
  let canvasHeight = 0;

  if (typeof document !== 'undefined' && imageElement) {
    try {
      const c = document.createElement('canvas');
      const w = ('naturalWidth' in imageElement ? imageElement.naturalWidth : imageElement.width) || 512;
      const h = ('naturalHeight' in imageElement ? imageElement.naturalHeight : imageElement.height) || 512;
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(imageElement as CanvasImageSource, 0, 0, w, h);
        canvasCtx = ctx;
        canvasWidth = w;
        canvasHeight = h;
      }
    } catch {
      // Ignorar restricciones de canvas cross-origin o sin DOM
    }
  }

  // Puntos clave de muestreo
  // Piel de mejilla (landmark 205 o 425)
  const skinColor = sampleColorAt(canvasCtx, landmarks[205]!.x, landmarks[205]!.y, canvasWidth, canvasHeight, {
    r: 218,
    g: 175,
    b: 148,
  });

  // Labio inferior central (landmark 14 o 17)
  const lipColor = sampleColorAt(canvasCtx, landmarks[17]!.x, landmarks[17]!.y, canvasWidth, canvasHeight, {
    r: 195,
    g: 95,
    b: 105,
  });

  // Esclera ojo (landmark 133 esquina interna)
  const scleraColor = sampleColorAt(canvasCtx, landmarks[133]!.x, landmarks[133]!.y, canvasWidth, canvasHeight, {
    r: 242,
    g: 242,
    b: 245,
  });

  // Piel periocular del párpado superior: muestreo robusto de mediana en 5 puntos (Fase 3)
  // para filtrar sombras de pestañas y vello de cejas garantizando tono cutáneo real
  const periocularCandidates: RGB[] = [
    sampleColorAt(canvasCtx, landmarks[159]!.x, Math.max(0.01, landmarks[159]!.y - 0.028), canvasWidth, canvasHeight, skinColor),
    sampleColorAt(canvasCtx, landmarks[160]!.x, Math.max(0.01, landmarks[160]!.y - 0.022), canvasWidth, canvasHeight, skinColor),
    sampleColorAt(canvasCtx, landmarks[158]!.x, Math.max(0.01, landmarks[158]!.y - 0.022), canvasWidth, canvasHeight, skinColor),
    sampleColorAt(canvasCtx, landmarks[386]!.x, Math.max(0.01, landmarks[386]!.y - 0.028), canvasWidth, canvasHeight, skinColor),
    sampleColorAt(canvasCtx, landmarks[387]!.x, Math.max(0.01, landmarks[387]!.y - 0.022), canvasWidth, canvasHeight, skinColor),
  ];

  const rSorted = periocularCandidates.map((c) => c.r).sort((a, b) => a - b);
  const gSorted = periocularCandidates.map((c) => c.g).sort((a, b) => a - b);
  const bSorted = periocularCandidates.map((c) => c.b).sort((a, b) => a - b);

  let medR = rSorted[2]!;
  let medG = gSorted[2]!;
  let medB = bSorted[2]!;

  // Garantizar umbral fisiológico mínimo de luminancia (nunca negro ni sombra profunda)
  const periLuminance = (medR * 299 + medG * 587 + medB * 114) / 1000;
  if (periLuminance < 85) {
    medR = Math.max(medR, Math.round(skinColor.r * 0.95));
    medG = Math.max(medG, Math.round(skinColor.g * 0.93));
    medB = Math.max(medB, Math.round(skinColor.b * 0.92));
  }

  const lidSkinColor: RGB = {
    r: Math.max(85, Math.min(255, medR)),
    g: Math.max(65, Math.min(255, medG)),
    b: Math.max(55, Math.min(255, medB)),
  };

  // Muestreo de interior bucal para verificar modo de boca
  const lipUpperCenter = landmarks[LANDMARK_INDICES.lipUpperInnerCenter]!;
  const lipLowerCenter = landmarks[LANDMARK_INDICES.lipLowerInnerCenter]!;
  const restGapNorm = Math.abs(lipLowerCenter.y - lipUpperCenter.y);
  const midLipY = (lipUpperCenter.y + lipLowerCenter.y) / 2;
  const mouthInnerColor = sampleColorAt(canvasCtx, lipUpperCenter.x, midLipY, canvasWidth, canvasHeight, {
    r: 80,
    g: 20,
    b: 30,
  });

  // Determinar mouthMode
  let mouthMode: 'closed' | 'teethVisible' | 'openMouth' = 'closed';
  const luminance = (mouthInnerColor.r * 299 + mouthInnerColor.g * 587 + mouthInnerColor.b * 114) / 1000;

  if (restGapNorm > 0.035) {
    mouthMode = 'openMouth';
  } else if (restGapNorm > 0.012 && luminance > 140) {
    // Si hay separación y el brillo es alto, hay dientes visibles en la foto original
    mouthMode = 'teethVisible';
  }

  // Dientes teñidos acorde a iluminación o blanco cálido
  const teethColor: RGB =
    mouthMode === 'teethVisible'
      ? mouthInnerColor
      : {
          r: Math.min(255, Math.round(skinColor.r * 0.9 + 25)),
          g: Math.min(255, Math.round(skinColor.g * 0.9 + 25)),
          b: Math.min(255, Math.round(skinColor.b * 0.85 + 20)),
        };

  // 5. Cajas delimitadoras de ojos (eyeBoxes) para overlays
  const lEyeCornerIn = landmarks[LANDMARK_INDICES.leftEyeCornerInner]!;
  const lEyeCornerOut = landmarks[LANDMARK_INDICES.leftEyeCornerOuter]!;
  const rEyeCornerIn = landmarks[LANDMARK_INDICES.rightEyeCornerInner]!;
  const rEyeCornerOut = landmarks[LANDMARK_INDICES.rightEyeCornerOuter]!;

  const leftEyeBox: Box = {
    minX: Math.min(lEyeCornerIn.x, lEyeCornerOut.x) - 0.02,
    maxX: Math.max(lEyeCornerIn.x, lEyeCornerOut.x) + 0.02,
    minY: landmarks[159]!.y - 0.03,
    maxY: landmarks[145]!.y + 0.02,
  };

  const rightEyeBox: Box = {
    minX: Math.min(rEyeCornerIn.x, rEyeCornerOut.x) - 0.02,
    maxX: Math.max(rEyeCornerIn.x, rEyeCornerOut.x) + 0.02,
    minY: landmarks[386]!.y - 0.03,
    maxY: landmarks[374]!.y + 0.02,
  };

  // 6. Valores neutrales iniciales (siempre labios cerrados en reposo)
  const neutralJaw = blendshapes?.jawOpen ?? 0;
  const neutralSmile = blendshapes?.mouthSmileLeft ?? (blendshapes?.mouthSmileRight ?? 0.03);
  const neutralBrow = blendshapes?.browInnerUp ?? 0;

  return {
    faceScale,
    faceHeight,
    frontality,
    neutral: {
      jawOpen: neutralJaw,
      smile: neutralSmile,
      browUp: neutralBrow,
    },
    mouthMode,
    colors: {
      skin: skinColor,
      lip: lipColor,
      sclera: scleraColor,
      teeth: teethColor,
      lidSkin: lidSkinColor,
    },
    eyeBoxes: {
      left: leftEyeBox,
      right: rightEyeBox,
    },
  };
}
