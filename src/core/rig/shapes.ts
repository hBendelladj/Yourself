/**
 * shapes.ts
 *
 * Definición declarativa de las formas de deformación (blendshapes) del Rig V2:
 * - Cada forma define sus manejadores (landmarks de control), vectores de desplazamiento
 *   relativos a `faceScale`, radios de influencia y regiones anatómicas permitidas.
 * - Incluye cinemática de mandíbula anatómica con pivote mandibular (`isPivotJaw`).
 * - Nomenclatura compatible con MediaPipe y ARKit blendshapes.
 */

import { LANDMARK_INDICES } from '@/core/face/landmarkGroups';

export type ShapeRegion = 'mouth' | 'eyes' | 'brows' | 'jaw' | 'nose' | 'all';

export interface ShapeHandler {
  landmarkIndex: number;
  dx: number; // en múltiplos de faceScale
  dy: number;
  dz?: number;
  radius: number; // radio de influencia en múltiplos de faceScale
  region: ShapeRegion;
}

export interface MorphShapeDef {
  name: string;
  category: 'mouth' | 'eyes' | 'brows' | 'jaw' | 'nose';
  handlers: ShapeHandler[];
  isPivotJaw?: boolean;
}

export const MORPH_SHAPES: MorphShapeDef[] = [
  // --- MANDÍBULA Y HABLA ---
  {
    name: 'jawOpen',
    category: 'jaw',
    isPivotJaw: true,
    handlers: [
      { landmarkIndex: LANDMARK_INDICES.lipLowerInnerCenter, dx: 0, dy: -0.85, dz: -0.10, radius: 0.35, region: 'mouth' },
      { landmarkIndex: LANDMARK_INDICES.lipLowerOuterCenter, dx: 0, dy: -0.75, dz: -0.08, radius: 0.40, region: 'mouth' },
      { landmarkIndex: LANDMARK_INDICES.chinBottom, dx: 0, dy: -0.65, dz: -0.05, radius: 0.50, region: 'jaw' },
      // Ligera elevación del labio superior para dar volumen natural
      { landmarkIndex: LANDMARK_INDICES.lipUpperInnerCenter, dx: 0, dy: 0.08, dz: 0.04, radius: 0.20, region: 'mouth' },
    ],
  },
  {
    name: 'mouthClose',
    category: 'mouth',
    handlers: [
      // Sella fuertemente los labios (para /m/, /b/, /p/)
      { landmarkIndex: LANDMARK_INDICES.lipUpperInnerCenter, dx: 0, dy: -0.08, dz: -0.02, radius: 0.25, region: 'mouth' },
      { landmarkIndex: LANDMARK_INDICES.lipLowerInnerCenter, dx: 0, dy: 0.08, dz: -0.02, radius: 0.25, region: 'mouth' },
      { landmarkIndex: LANDMARK_INDICES.lipUpperOuterCenter, dx: 0, dy: -0.06, dz: 0, radius: 0.25, region: 'mouth' },
      { landmarkIndex: LANDMARK_INDICES.lipLowerOuterCenter, dx: 0, dy: 0.06, dz: 0, radius: 0.25, region: 'mouth' },
    ],
  },
  {
    name: 'mouthPressLips',
    category: 'mouth',
    handlers: [
      // Comprime los labios hacia adentro contra los dientes
      { landmarkIndex: LANDMARK_INDICES.lipUpperOuterCenter, dx: 0, dy: 0, dz: -0.09, radius: 0.28, region: 'mouth' },
      { landmarkIndex: LANDMARK_INDICES.lipLowerOuterCenter, dx: 0, dy: 0, dz: -0.09, radius: 0.28, region: 'mouth' },
    ],
  },
  {
    name: 'mouthFunnel',
    category: 'mouth',
    handlers: [
      // Redondeo abierto en embudo ("O" abierta)
      { landmarkIndex: LANDMARK_INDICES.lipLeftCorner, dx: 0.12, dy: 0, dz: 0.05, radius: 0.25, region: 'mouth' },
      { landmarkIndex: LANDMARK_INDICES.lipRightCorner, dx: -0.12, dy: 0, dz: 0.05, radius: 0.25, region: 'mouth' },
      { landmarkIndex: LANDMARK_INDICES.lipUpperOuterCenter, dx: 0, dy: 0.12, dz: 0.12, radius: 0.30, region: 'mouth' },
      { landmarkIndex: LANDMARK_INDICES.lipLowerOuterCenter, dx: 0, dy: -0.15, dz: 0.12, radius: 0.30, region: 'mouth' },
    ],
  },
  {
    name: 'mouthPucker',
    category: 'mouth',
    handlers: [
      // Labios protruidos en beso ("U")
      { landmarkIndex: LANDMARK_INDICES.lipLeftCorner, dx: 0.18, dy: 0, dz: 0.08, radius: 0.30, region: 'mouth' },
      { landmarkIndex: LANDMARK_INDICES.lipRightCorner, dx: -0.18, dy: 0, dz: 0.08, radius: 0.30, region: 'mouth' },
      { landmarkIndex: LANDMARK_INDICES.lipUpperOuterCenter, dx: 0, dy: 0.05, dz: 0.20, radius: 0.28, region: 'mouth' },
      { landmarkIndex: LANDMARK_INDICES.lipLowerOuterCenter, dx: 0, dy: -0.05, dz: 0.20, radius: 0.28, region: 'mouth' },
    ],
  },
  {
    name: 'mouthStretchLeft',
    category: 'mouth',
    handlers: [
      { landmarkIndex: LANDMARK_INDICES.lipLeftCorner, dx: -0.22, dy: 0.03, dz: 0, radius: 0.30, region: 'mouth' },
    ],
  },
  {
    name: 'mouthStretchRight',
    category: 'mouth',
    handlers: [
      { landmarkIndex: LANDMARK_INDICES.lipRightCorner, dx: 0.22, dy: 0.03, dz: 0, radius: 0.30, region: 'mouth' },
    ],
  },
  {
    name: 'mouthSmileLeft',
    category: 'mouth',
    handlers: [
      { landmarkIndex: LANDMARK_INDICES.lipLeftCorner, dx: -0.16, dy: 0.18, dz: 0.02, radius: 0.30, region: 'mouth' },
      { landmarkIndex: LANDMARK_INDICES.leftCheek, dx: -0.05, dy: 0.12, dz: 0.05, radius: 0.35, region: 'jaw' },
    ],
  },
  {
    name: 'mouthSmileRight',
    category: 'mouth',
    handlers: [
      { landmarkIndex: LANDMARK_INDICES.lipRightCorner, dx: 0.16, dy: 0.18, dz: 0.02, radius: 0.30, region: 'mouth' },
      { landmarkIndex: LANDMARK_INDICES.rightCheek, dx: 0.05, dy: 0.12, dz: 0.05, radius: 0.35, region: 'jaw' },
    ],
  },
  {
    name: 'mouthDimpleLeft',
    category: 'mouth',
    handlers: [
      { landmarkIndex: LANDMARK_INDICES.lipLeftCorner, dx: -0.10, dy: 0, dz: -0.08, radius: 0.25, region: 'mouth' },
    ],
  },
  {
    name: 'mouthDimpleRight',
    category: 'mouth',
    handlers: [
      { landmarkIndex: LANDMARK_INDICES.lipRightCorner, dx: 0.10, dy: 0, dz: -0.08, radius: 0.25, region: 'mouth' },
    ],
  },
  {
    name: 'mouthFrownLeft',
    category: 'mouth',
    handlers: [
      { landmarkIndex: LANDMARK_INDICES.lipLeftCorner, dx: -0.05, dy: -0.18, dz: 0, radius: 0.28, region: 'mouth' },
    ],
  },
  {
    name: 'mouthFrownRight',
    category: 'mouth',
    handlers: [
      { landmarkIndex: LANDMARK_INDICES.lipRightCorner, dx: 0.05, dy: -0.18, dz: 0, radius: 0.28, region: 'mouth' },
    ],
  },
  {
    name: 'lowerLipTuck',
    category: 'mouth',
    handlers: [
      // Labio inferior metido bajo los dientes superiores (/f/, /v/)
      { landmarkIndex: LANDMARK_INDICES.lipLowerInnerCenter, dx: 0, dy: 0.16, dz: -0.14, radius: 0.25, region: 'mouth' },
      { landmarkIndex: LANDMARK_INDICES.lipLowerOuterCenter, dx: 0, dy: 0.12, dz: -0.12, radius: 0.28, region: 'mouth' },
    ],
  },

  // --- CEJAS ---
  {
    name: 'browInnerUp',
    category: 'brows',
    handlers: [
      { landmarkIndex: 55, dx: 0, dy: 0.22, dz: 0.02, radius: 0.30, region: 'brows' },
      { landmarkIndex: 285, dx: 0, dy: 0.22, dz: 0.02, radius: 0.30, region: 'brows' },
    ],
  },
  {
    name: 'browOuterUpLeft',
    category: 'brows',
    handlers: [
      { landmarkIndex: 70, dx: 0, dy: 0.20, dz: 0, radius: 0.28, region: 'brows' },
      { landmarkIndex: 63, dx: 0, dy: 0.15, dz: 0, radius: 0.25, region: 'brows' },
    ],
  },
  {
    name: 'browOuterUpRight',
    category: 'brows',
    handlers: [
      { landmarkIndex: 300, dx: 0, dy: 0.20, dz: 0, radius: 0.28, region: 'brows' },
      { landmarkIndex: 293, dx: 0, dy: 0.15, dz: 0, radius: 0.25, region: 'brows' },
    ],
  },
  {
    name: 'browDownLeft',
    category: 'brows',
    handlers: [
      { landmarkIndex: 65, dx: 0.06, dy: -0.16, dz: 0.03, radius: 0.28, region: 'brows' },
      { landmarkIndex: 52, dx: 0.04, dy: -0.12, dz: 0.02, radius: 0.25, region: 'brows' },
    ],
  },
  {
    name: 'browDownRight',
    category: 'brows',
    handlers: [
      { landmarkIndex: 295, dx: -0.06, dy: -0.16, dz: 0.03, radius: 0.28, region: 'brows' },
      { landmarkIndex: 282, dx: -0.04, dy: -0.12, dz: 0.02, radius: 0.25, region: 'brows' },
    ],
  },

  // --- OJOS Y MEJILLAS ---
  {
    name: 'eyeSquintLeft',
    category: 'eyes',
    handlers: [
      // Párpado inferior se eleva (sonrisa de Duchenne)
      { landmarkIndex: 145, dx: 0, dy: 0.12, dz: 0.02, radius: 0.22, region: 'eyes' },
      { landmarkIndex: 153, dx: 0, dy: 0.10, dz: 0.02, radius: 0.20, region: 'eyes' },
    ],
  },
  {
    name: 'eyeSquintRight',
    category: 'eyes',
    handlers: [
      { landmarkIndex: 374, dx: 0, dy: 0.12, dz: 0.02, radius: 0.22, region: 'eyes' },
      { landmarkIndex: 380, dx: 0, dy: 0.10, dz: 0.02, radius: 0.20, region: 'eyes' },
    ],
  },
  {
    name: 'cheekRaiseLeft',
    category: 'mouth',
    handlers: [
      { landmarkIndex: LANDMARK_INDICES.leftCheek, dx: -0.02, dy: 0.18, dz: 0.06, radius: 0.35, region: 'jaw' },
    ],
  },
  {
    name: 'cheekRaiseRight',
    category: 'mouth',
    handlers: [
      { landmarkIndex: LANDMARK_INDICES.rightCheek, dx: 0.02, dy: 0.18, dz: 0.06, radius: 0.35, region: 'jaw' },
    ],
  },
  {
    name: 'noseSneerLeft',
    category: 'nose',
    handlers: [
      { landmarkIndex: 198, dx: 0, dy: 0.14, dz: 0.05, radius: 0.22, region: 'nose' },
    ],
  },
  {
    name: 'noseSneerRight',
    category: 'nose',
    handlers: [
      { landmarkIndex: 420, dx: 0, dy: 0.14, dz: 0.05, radius: 0.22, region: 'nose' },
    ],
  },
];
