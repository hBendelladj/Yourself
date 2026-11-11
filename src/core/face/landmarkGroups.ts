/**
 * landmarkGroups.ts
 *
 * Grupos canónicos de índices de los 478 puntos de MediaPipe FaceLandmarker.
 * Incluye contornos para labios exteriores e interiores, párpados, cejas, óvalo facial,
 * mentón y puntos clave de deformación.
 */

export const LANDMARK_INDICES = {
  // Labios exteriores
  lipsUpperOuter: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291],
  lipsLowerOuter: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291],
  lipsOuterContour: [
    61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291,
    375, 321, 405, 314, 17, 84, 181, 91, 146, 61,
  ],

  // Labios interiores (clave para cavidad bucal procedural y apertura)
  lipsUpperInner: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308],
  lipsLowerInner: [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308],
  lipsInnerContour: [
    78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308,
    324, 318, 402, 317, 14, 87, 178, 88, 95, 78,
  ],

  // Puntos clave de labios
  lipLeftCorner: 61,     // Comisura izquierda
  lipRightCorner: 291,   // Comisura derecha
  lipUpperInnerCenter: 13, // Labio superior interior
  lipLowerInnerCenter: 14, // Labio inferior interior
  lipUpperOuterCenter: 0,
  lipLowerOuterCenter: 17,

  // Ojo izquierdo (lado izquierdo de la pantalla/espejo del rostro según convención MediaPipe)
  leftEyeUpper: [246, 161, 160, 159, 158, 157, 173],
  leftEyeLower: [33, 7, 163, 144, 145, 153, 154, 155, 133],
  leftEyeCornerOuter: 33,
  leftEyeCornerInner: 133,
  leftIris: [468, 469, 470, 471, 472],
  leftIrisCenter: 468,

  // Ojo derecho
  rightEyeUpper: [466, 388, 387, 386, 385, 384, 398],
  rightEyeLower: [263, 249, 390, 373, 374, 380, 381, 382, 362],
  rightEyeCornerOuter: 263,
  rightEyeCornerInner: 362,
  rightIris: [473, 474, 475, 476, 477],
  rightIrisCenter: 473,

  // Cejas
  leftEyebrow: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
  rightEyebrow: [300, 293, 334, 296, 336, 285, 295, 282, 283, 276],

  // Mentón y mandíbula inferior
  chinBottom: 152,
  chinGroup: [152, 377, 400, 378, 379, 365, 176, 148, 150, 136, 172, 175, 199, 200],

  // Nariz y frente
  noseTip: 1,
  noseBridge: [168, 6, 197, 195, 5, 4],
  foreheadCenter: 10,

  // Mejillas
  leftCheek: 205,
  rightCheek: 425,

  // Óvalo facial
  faceOval: [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365,
    379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93,
    234, 127, 162, 21, 54, 103, 67, 109, 10,
  ],
} as const;

// Conjunto para verificación rápida de pertenencia
export const LIPS_INNER_SET = new Set<number>(LANDMARK_INDICES.lipsInnerContour);
export const LIPS_OUTER_SET = new Set<number>(LANDMARK_INDICES.lipsOuterContour);
export const EYES_SET = new Set<number>([
  ...LANDMARK_INDICES.leftEyeUpper,
  ...LANDMARK_INDICES.leftEyeLower,
  ...LANDMARK_INDICES.rightEyeUpper,
  ...LANDMARK_INDICES.rightEyeLower,
  ...LANDMARK_INDICES.leftIris,
  ...LANDMARK_INDICES.rightIris,
]);
export const BROWS_SET = new Set<number>([
  ...LANDMARK_INDICES.leftEyebrow,
  ...LANDMARK_INDICES.rightEyebrow,
]);
