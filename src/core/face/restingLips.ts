/**
 * restingLips.ts
 *
 * Reposo neutral con labios cerrados (YourSelf V3):
 * Sea cual sea la foto (labios entreabiertos, boca abierta, sonrisa con dientes),
 * el avatar arranca con los labios perfectamente cerrados y neutrales.
 * Modifica las posiciones base de reposo de forma continua y suave, garantizando
 * que la cavidad oral (mouthInterior) permanezca 100% invisible en reposo (gap < g0)
 * y que al hablar la boca se abra de forma natural desde el reposo sellado.
 */

import { INNER_LIP_PAIRS } from '@/core/render/mouthInterior';
import { LANDMARK_INDICES } from '@/core/face/landmarkGroups';

export interface RestingLipsOptions {
  closureThreshold?: number;
  upperWeight?: number;
  lowerWeight?: number;
}

export interface RestingLipsResult {
  wasParted: boolean;
  originalGap: number;
  closedGap: number;
}

// Pares exteriores correspondientes de comisura izquierda (61) a derecha (291)
const OUTER_LIP_PAIRS: [number, number][] = [
  [61, 61],
  [185, 146],
  [40, 91],
  [39, 181],
  [37, 84],
  [0, 17],
  [267, 314],
  [269, 405],
  [270, 321],
  [409, 375],
  [291, 291],
];

// Vértices del bermellón y cuerpo del labio inferior que acompañan el cierre
const LOWER_LIP_BODY = [86, 179, 89, 96, 77, 146, 316, 403, 319, 325, 307, 85, 16, 315];

/**
 * Cierra suavemente los labios en el estado de reposo para cualquier foto.
 * @param positions Búfer de posiciones [x, y, z, ...] de la malla (basePositions o currentPositions)
 * @param faceScale Escala métrica del rostro (distancia interocular)
 * @param options Opciones de ponderación y umbral de cierre
 */
export function closeRestingLips(
  positions: Float32Array,
  faceScale: number,
  options?: RestingLipsOptions
): RestingLipsResult {
  const closureThreshold = options?.closureThreshold ?? 0.0012;
  const upperWeight = options?.upperWeight ?? 0.40;
  const lowerWeight = options?.lowerWeight ?? 0.60;
  const scale = Math.max(0.01, faceScale);

  const pairCount = INNER_LIP_PAIRS.length;

  // 1. Calcular distancia media vertical entre los labios interiores
  let totalGap = 0;
  let validPairs = 0;

  for (let i = 1; i < pairCount - 1; i++) {
    const [uIdx, lIdx] = INNER_LIP_PAIRS[i]!;
    const uy = positions[uIdx * 3 + 1]!;
    const ly = positions[lIdx * 3 + 1]!;
    const dy = uy - ly;
    if (dy > 0) {
      totalGap += dy;
      validPairs++;
    }
  }

  const originalGap = validPairs > 0 ? (totalGap / validPairs) / scale : 0;

  // Si los labios ya están cerrados por debajo del umbral, no alterar la foto
  if (originalGap <= closureThreshold) {
    return {
      wasParted: false,
      originalGap,
      closedGap: originalGap,
    };
  }

  // 2. Sellar herméticamente los pares de labios interiores en la línea de estomión anatómica
  const innerShiftsY = new Float32Array(pairCount);

  for (let i = 0; i < pairCount; i++) {
    const [uIdx, lIdx] = INNER_LIP_PAIRS[i]!;
    const uy = positions[uIdx * 3 + 1]!;
    const ly = positions[lIdx * 3 + 1]!;
    const dy = uy - ly;

    if (dy > 0) {
      // Línea de contacto stomion: 40% labio superior, 60% labio inferior (referencia anatómica humana)
      const stomionY = uy * (1 - lowerWeight) + ly * lowerWeight;
      positions[uIdx * 3 + 1] = stomionY;
      positions[lIdx * 3 + 1] = stomionY;

      // Unificar profundidad Z suavemente
      const uz = positions[uIdx * 3 + 2]!;
      const lz = positions[lIdx * 3 + 2]!;
      const stomionZ = uz * 0.5 + lz * 0.5;
      positions[uIdx * 3 + 2] = stomionZ;
      positions[lIdx * 3 + 2] = stomionZ;

      innerShiftsY[i] = dy;
    }
  }

  // 3. Ajuste sutil del bermellón interior inferior para acompañar el sellado sin deformar el contorno exterior
  // Preservamos intactos los bordes exteriores (0, 17, 61, 291) para mantener el volumen y forma natural de los labios
  const centerShift = innerShiftsY[5]! || (originalGap * scale);
  if (centerShift > 0) {
    const sulcusY = positions[LANDMARK_INDICES.chinBottom * 3 + 1]!;
    const lowerCenterY = positions[LANDMARK_INDICES.lipLowerInnerCenter * 3 + 1]!;
    const chinSpan = Math.max(0.01, Math.abs(lowerCenterY - sulcusY));

    // Vértices del cuerpo intermedio del labio inferior (excluyendo la línea de sellado interior y el contorno exterior)
    const LOWER_LIP_SUB_MUCOSA = [86, 179, 89, 96, 77, 316, 403, 319, 325, 307, 85, 16, 315];
    for (let k = 0; k < LOWER_LIP_SUB_MUCOSA.length; k++) {
      const idx = LOWER_LIP_SUB_MUCOSA[k]!;
      const vy = positions[idx * 3 + 1]!;
      const distFromCenter = Math.abs(vy - lowerCenterY) / chinSpan;
      const factor = Math.max(0, 1.0 - Math.min(1.0, distFromCenter));
      positions[idx * 3 + 1] += centerShift * 0.20 * factor;
    }
  }

  // 4. Medir gap residual final
  let closedTotalGap = 0;
  let closedValidPairs = 0;

  for (let i = 1; i < pairCount - 1; i++) {
    const [uIdx, lIdx] = INNER_LIP_PAIRS[i]!;
    const uy = positions[uIdx * 3 + 1]!;
    const ly = positions[lIdx * 3 + 1]!;
    const dy = Math.max(0, uy - ly);
    closedTotalGap += dy;
    closedValidPairs++;
  }

  const closedGap = closedValidPairs > 0 ? (closedTotalGap / closedValidPairs) / scale : 0;

  return {
    wasParted: true,
    originalGap,
    closedGap,
  };
}
