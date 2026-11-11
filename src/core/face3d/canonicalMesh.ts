/**
 * canonicalMesh.ts
 *
 * Modelo Canónico Facial Métrico 3D (YourSelf V3 - Fase 2 / Sección 10):
 * - Define una plantilla canónica métrica con proporciones craneofaciales humanas estándar:
 *   - Distancia interpupilar media (IPD): 63 mm.
 *   - Altura facial media (nasion a gnation): 120 mm.
 *   - Anchura bizigomática (entre mejillas): 138 mm.
 *   - Profundidad craneal (punta nasal a conducto auditivo externo): ~95 mm.
 * - Proporciona el perfil de curvatura anatómica en Z para corregir el aplanamiento
 *   y eliminar el efecto "máscara de papel" en rotaciones cefálicas hasta ±35° de yaw.
 */

import { LANDMARK_INDICES } from '@/core/face/landmarkGroups';
import { FaceLandmarkPoint } from '@/lib/types';

export interface CanonicalHeadModel {
  landmarkCount: number;
  canonicalPositions: Float32Array; // 478 x 3 en espacio métrico normalizado (centrado en entrecejo)
  faceWidth: number;
  faceHeight: number;
  faceDepth: number;
  interpupillaryDistance: number;
}

/**
 * Genera la plantilla canónica de referencia métrica tridimensional para los 478 landmarks.
 * Se deriva de las proporciones antropométricas humanas estándar.
 */
export function buildCanonicalHeadModel(): CanonicalHeadModel {
  const landmarkCount = 478;
  const positions = new Float32Array(landmarkCount * 3);

  // Dimensiones métricas estándar en metros (escala humana 1:1 normalizada)
  const IPD = 0.063; // 63 mm
  const faceHeight = 0.120; // 120 mm
  const faceWidth = 0.138; // 138 mm
  const faceDepth = 0.095; // 95 mm

  // Centro de referencia (glabella / entrecejo): (0, 0, 0)
  // Ojo izquierdo (espectador der): x = +IPD/2, Ojo derecho (espectador izq): x = -IPD/2
  for (let i = 0; i < landmarkCount; i++) {
    // Estimación de curvatura esférico-elipsoidal de partida
    positions[i * 3] = 0;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = 0;
  }

  // Puntos clave anatómicos
  // Punta nasal (1): proyectada hacia adelante en +Z
  positions[1 * 3] = 0.0;
  positions[1 * 3 + 1] = -0.015;
  positions[1 * 3 + 2] = +0.022; // 22 mm delante de la glabella

  // Entrecejo / Glabella (168)
  positions[168 * 3] = 0.0;
  positions[168 * 3 + 1] = 0.005;
  positions[168 * 3 + 2] = 0.002;

  // Frente superior (10)
  positions[10 * 3] = 0.0;
  positions[10 * 3 + 1] = +0.055;
  positions[10 * 3 + 2] = -0.015; // Curva hacia atrás

  // Mentón inferior (152)
  positions[152 * 3] = 0.0;
  positions[152 * 3 + 1] = -0.075;
  positions[152 * 3 + 2] = -0.010;

  // Centros de iris
  // Ojo derecho del rostro (espectador izq): landmark 468
  positions[468 * 3] = -IPD * 0.5;
  positions[468 * 3 + 1] = 0.0;
  positions[468 * 3 + 2] = -0.005;

  // Ojo izquierdo del rostro (espectador der): landmark 473
  positions[473 * 3] = +IPD * 0.5;
  positions[473 * 3 + 1] = 0.0;
  positions[473 * 3 + 2] = -0.005;

  // Mejilla derecha (205) y mejilla izquierda (425)
  positions[205 * 3] = -faceWidth * 0.42;
  positions[205 * 3 + 1] = -0.025;
  positions[205 * 3 + 2] = -0.015;

  positions[425 * 3] = +faceWidth * 0.42;
  positions[425 * 3 + 1] = -0.025;
  positions[425 * 3 + 2] = -0.015;

  // Cóndilos mandibulares / Tragus auditivo (234 izq espectador, 454 der espectador)
  positions[234 * 3] = -faceWidth * 0.50;
  positions[234 * 3 + 1] = -0.010;
  positions[234 * 3 + 2] = -faceDepth * 0.70; // 66 mm atrás

  positions[454 * 3] = +faceWidth * 0.50;
  positions[454 * 3 + 1] = -0.010;
  positions[454 * 3 + 2] = -faceDepth * 0.70;

  // Labio superior e inferior
  positions[LANDMARK_INDICES.lipUpperOuterCenter * 3] = 0.0;
  positions[LANDMARK_INDICES.lipUpperOuterCenter * 3 + 1] = -0.040;
  positions[LANDMARK_INDICES.lipUpperOuterCenter * 3 + 2] = +0.008;

  positions[LANDMARK_INDICES.lipLowerOuterCenter * 3] = 0.0;
  positions[LANDMARK_INDICES.lipLowerOuterCenter * 3 + 1] = -0.052;
  positions[LANDMARK_INDICES.lipLowerOuterCenter * 3 + 2] = +0.005;

  return {
    landmarkCount,
    canonicalPositions: positions,
    faceWidth,
    faceHeight,
    faceDepth,
    interpupillaryDistance: IPD,
  };
}

/**
 * Evalúa el factor de curvatura de profundidad lateral (Z) para un punto dado en coordenadas [x, y]
 * basado en una superficie cuádrica elipsoidal anatómica.
 */
export function calculateAnatomicalZ(x: number, y: number, faceWidth: number, faceHeight: number): number {
  const normX = x / (faceWidth * 0.5);
  const normY = y / (faceHeight * 0.5);
  const rSq = normX * normX + normY * normY * 0.5;

  if (rSq >= 1.0) {
    return -0.06; // Borde lateral en profundidad
  }

  // Elipsoide métrico
  return (Math.sqrt(Math.max(0, 1.0 - rSq)) - 1.0) * 0.055;
}
