/**
 * buildMesh.ts
 *
 * Construye la geometría 2D/3D a partir de los 478 puntos de MediaPipe FaceLandmarker:
 * 1. Agrega 16 puntos de anclaje fijos en las esquinas y bordes perimetrales de la imagen.
 * 2. Triangula el conjunto completo de puntos mediante Delaunay (Delaunator).
 * 3. Genera las coordenadas UV basadas en la posición original sin distorsión.
 * 4. Mapea las coordenadas a espacio Three.js centrado en el origen preservando el aspect ratio.
 */

import Delaunator from 'delaunator';
import { FaceLandmarkPoint } from '@/lib/types';
import { LANDMARK_INDICES } from '@/core/face/landmarkGroups';

export interface FaceMeshRegions {
  leftEye: number[];
  rightEye: number[];
  brows: number[];
  nose: number[];
  mouth: number[];
  jaw: number[];
  oval: number[];
  anchors: number[];
}

export interface MeshGeometryData {
  basePositions: Float32Array;
  currentPositions: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
  vertexCount: number;
  landmarkCount: number;
  anchorCount: number;
  anchorStartIndex: number;
  aspectRatio: number;
  worldWidth: number;
  worldHeight: number;
  faceScale: number;
  landmarks: FaceLandmarkPoint[];
  regions: FaceMeshRegions;
}

// 16 puntos de anclaje perimetrales normalizados en [0, 1]
export const BORDER_ANCHORS: [number, number][] = [
  // 4 Esquinas
  [0.0, 0.0],
  [1.0, 0.0],
  [0.0, 1.0],
  [1.0, 1.0],

  // Borde superior
  [0.25, 0.0],
  [0.5, 0.0],
  [0.75, 0.0],

  // Borde inferior
  [0.25, 1.0],
  [0.5, 1.0],
  [0.75, 1.0],

  // Borde izquierdo
  [0.0, 0.25],
  [0.0, 0.5],
  [0.0, 0.75],

  // Borde derecho
  [1.0, 0.25],
  [1.0, 0.5],
  [1.0, 0.75],
];

// Conjuntos de landmarks superiores e inferiores de los labios (excluyendo comisuras 61, 78, 291, 308)
const UPPER_LIP_LANDMARKS = new Set<number>([
  185, 40, 39, 37, 0, 267, 269, 270, 409, // exteriores
  191, 80, 81, 82, 13, 312, 311, 310, 415, // interiores
]);

const LOWER_LIP_LANDMARKS = new Set<number>([
  146, 91, 181, 84, 17, 314, 405, 321, 375, // exteriores
  95, 88, 178, 87, 14, 317, 402, 318, 324, // interiores
]);

export interface BuildFaceMeshOptions {
  filterMouthHole?: boolean;
  includeAnchorRings?: boolean;
}

export function buildFaceMesh(
  landmarks: FaceLandmarkPoint[],
  imageWidth: number,
  imageHeight: number,
  options?: BuildFaceMeshOptions
): MeshGeometryData {
  const landmarkCount = landmarks.length;

  // Recopilar anclas adicionales (anillos de anclaje 1.25x y 1.6x + cuello) si están solicitadas
  const extraAnchors: [number, number][] = [];
  if (options?.includeAnchorRings && landmarkCount >= 468) {
    const nosePt = landmarks[LANDMARK_INDICES.noseTip] || { x: 0.5, y: 0.5, z: 0 };
    const cx = nosePt.x;
    const cy = nosePt.y;

    // Muestrear 12 puntos a lo largo del óvalo facial
    const oval = LANDMARK_INDICES.faceOval;
    for (let k = 0; k < 12; k++) {
      const ovalIdx = oval[Math.floor((k * oval.length) / 12)]!;
      const pt = landmarks[ovalIdx];
      if (!pt) continue;

      // Anillo 1: 1.25x del centro facial
      const r1x = Math.max(0.01, Math.min(0.99, cx + (pt.x - cx) * 1.25));
      const r1y = Math.max(0.01, Math.min(0.99, cy + (pt.y - cy) * 1.25));
      extraAnchors.push([r1x, r1y]);

      // Anillo 2: 1.60x del centro facial
      const r2x = Math.max(0.01, Math.min(0.99, cx + (pt.x - cx) * 1.60));
      const r2y = Math.max(0.01, Math.min(0.99, cy + (pt.y - cy) * 1.60));
      extraAnchors.push([r2x, r2y]);
    }

    // Puntos de cuello y hombros bajo el mentón
    const chinPt = landmarks[LANDMARK_INDICES.chinBottom] || { x: cx, y: 0.8, z: 0 };
    extraAnchors.push([Math.max(0.01, Math.min(0.99, cx - 0.22)), Math.max(0.01, Math.min(0.99, chinPt.y + 0.12))]);
    extraAnchors.push([Math.max(0.01, Math.min(0.99, cx - 0.08)), Math.max(0.01, Math.min(0.99, chinPt.y + 0.16))]);
    extraAnchors.push([Math.max(0.01, Math.min(0.99, cx + 0.08)), Math.max(0.01, Math.min(0.99, chinPt.y + 0.16))]);
    extraAnchors.push([Math.max(0.01, Math.min(0.99, cx + 0.22)), Math.max(0.01, Math.min(0.99, chinPt.y + 0.12))]);
  }

  const allAnchors = [...extraAnchors, ...BORDER_ANCHORS];
  const anchorCount = allAnchors.length;
  const vertexCount = landmarkCount + anchorCount;

  const aspectRatio = imageWidth / Math.max(1, imageHeight);
  // Normalizar el tamaño del mundo de modo que la dimensión mayor sea 2.0 (de -1 a 1)
  let worldWidth = 2.0;
  let worldHeight = 2.0;

  if (aspectRatio >= 1.0) {
    worldWidth = 2.0;
    worldHeight = 2.0 / aspectRatio;
  } else {
    worldWidth = 2.0 * aspectRatio;
    worldHeight = 2.0;
  }

  // 1. Recopilar coordenadas 2D para Delaunay: [x0, y0, x1, y1, ...]
  const coords2D = new Float64Array(vertexCount * 2);

  // Llenar landmarks faciales
  for (let i = 0; i < landmarkCount; i++) {
    const pt = landmarks[i]!;
    coords2D[i * 2] = Math.max(0.001, Math.min(0.999, pt.x));
    coords2D[i * 2 + 1] = Math.max(0.001, Math.min(0.999, pt.y));
  }

  // Llenar anclas (anillos + bordes fijos)
  for (let j = 0; j < anchorCount; j++) {
    const anchor = allAnchors[j]!;
    const idx = (landmarkCount + j) * 2;
    coords2D[idx] = anchor[0];
    coords2D[idx + 1] = anchor[1];
  }

  // 2. Triangulación con Delaunay
  const delaunay = new Delaunator(coords2D);
  const rawTriangles = delaunay.triangles;
  
  // Filtrar triángulos que conectan el labio superior y el inferior a través de la hendidura bucal
  // para permitir que la boca se abra naturalmente revelando la cavidad procedural detrás.
  const filteredIndices: number[] = [];
  for (let t = 0; t < rawTriangles.length; t += 3) {
    const i0 = rawTriangles[t]!;
    const i1 = rawTriangles[t + 1]!;
    const i2 = rawTriangles[t + 2]!;

    const hasUpper =
      UPPER_LIP_LANDMARKS.has(i0) ||
      UPPER_LIP_LANDMARKS.has(i1) ||
      UPPER_LIP_LANDMARKS.has(i2);
    const hasLower =
      LOWER_LIP_LANDMARKS.has(i0) ||
      LOWER_LIP_LANDMARKS.has(i1) ||
      LOWER_LIP_LANDMARKS.has(i2);

    // En V2 no se abre hueco en la malla: la foto se mantiene íntegra y la cavidad bucal
    // se dibuja como overlay encima. Solo si filterMouthHole está activado (legacy) se descartan.
    if (options?.filterMouthHole && hasUpper && hasLower) {
      continue;
    }

    filteredIndices.push(i0, i1, i2);
  }

  const indices = new Uint16Array(filteredIndices.length);
  for (let t = 0; t < filteredIndices.length; t++) {
    indices[t] = filteredIndices[t]!;
  }

  // 3. Generar posiciones 3D y coordenadas UV
  const basePositions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let i = 0; i < vertexCount; i++) {
    const nx = coords2D[i * 2]!;
    const ny = coords2D[i * 2 + 1]!;

    // Mapeo a espacio Three.js centrado en el origen:
    // nx: 0 -> -worldWidth/2, 1 -> +worldWidth/2
    // ny: 0 -> +worldHeight/2, 1 -> -worldHeight/2
    const wx = (nx - 0.5) * worldWidth;
    const wy = (0.5 - ny) * worldHeight;

    // Ligera elevación z para los landmarks faciales centrales (sutileza 3D)
    let wz = 0;
    if (i < landmarkCount) {
      const lpt = landmarks[i]!;
      wz = (lpt.z || 0) * -0.25; // invertir z para que la nariz esté hacia adelante
    }

    basePositions[i * 3] = wx;
    basePositions[i * 3 + 1] = wy;
    basePositions[i * 3 + 2] = wz;

    // UVs: en Three.js el eje V es 0 abajo y 1 arriba
    uvs[i * 2] = nx;
    uvs[i * 2 + 1] = 1.0 - ny;
  }

  const currentPositions = new Float32Array(basePositions);

  // 4. Calcular faceScale (distancia interocular en unidades de mundo)
  let faceScale = 0.45;
  if (landmarkCount >= 478) {
    const lx = basePositions[468 * 3]!;
    const ly = basePositions[468 * 3 + 1]!;
    const rx = basePositions[473 * 3]!;
    const ry = basePositions[473 * 3 + 1]!;
    faceScale = Math.max(0.1, Math.hypot(rx - lx, ry - ly));
  } else if (landmarkCount >= 363) {
    const lx = basePositions[133 * 3]!;
    const ly = basePositions[133 * 3 + 1]!;
    const rx = basePositions[362 * 3]!;
    const ry = basePositions[362 * 3 + 1]!;
    faceScale = Math.max(0.1, Math.hypot(rx - lx, ry - ly));
  }

  const regions: FaceMeshRegions = {
    leftEye: [...LANDMARK_INDICES.leftEyeUpper, ...LANDMARK_INDICES.leftEyeLower, ...LANDMARK_INDICES.leftIris],
    rightEye: [...LANDMARK_INDICES.rightEyeUpper, ...LANDMARK_INDICES.rightEyeLower, ...LANDMARK_INDICES.rightIris],
    brows: [...LANDMARK_INDICES.leftEyebrow, ...LANDMARK_INDICES.rightEyebrow],
    nose: [...LANDMARK_INDICES.noseBridge, LANDMARK_INDICES.noseTip],
    mouth: [...LANDMARK_INDICES.lipsOuterContour, ...LANDMARK_INDICES.lipsInnerContour],
    jaw: [...LANDMARK_INDICES.chinGroup],
    oval: [...LANDMARK_INDICES.faceOval],
    anchors: Array.from({ length: anchorCount }, (_, i) => landmarkCount + i),
  };

  return {
    basePositions,
    currentPositions,
    uvs,
    indices,
    vertexCount,
    landmarkCount,
    anchorCount,
    anchorStartIndex: landmarkCount,
    aspectRatio,
    worldWidth,
    worldHeight,
    faceScale,
    landmarks,
    regions,
  };
}
