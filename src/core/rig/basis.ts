/**
 * basis.ts
 *
 * Precalcula la base vectorial de deformación para cada forma del Rig V2:
 * - Se ejecuta una sola vez al cargar la foto (cero coste por fotograma).
 * - Desplazamientos normalizados y escalados proporcionalmente por `faceScale`.
 * - Caída suave (quartic/gaussian falloff) acotada por máscaras de región anatómica
 *   para garantizar que las formas de boca no afecten ojos/cejas y viceversa.
 * - Cinemática de mandíbula anatómica con rotación sobre el cóndilo mandibular.
 */

import { MorphShapeDef, MORPH_SHAPES } from './shapes';
import { FaceMeshRegions } from '@/core/face/buildMesh';
import { LANDMARK_INDICES } from '@/core/face/landmarkGroups';

export interface PrecomputedBasisOptions {
  basePositions: Float32Array;
  vertexCount: number;
  landmarkCount: number;
  faceScale: number;
  regions: FaceMeshRegions;
  shapes?: MorphShapeDef[];
}

export class RigBasis {
  public bases: Map<string, Float32Array> = new Map();
  public shapeNames: string[] = [];
  public vertexCount: number;
  public faceScale: number;

  constructor(options: PrecomputedBasisOptions) {
    this.vertexCount = options.vertexCount;
    this.faceScale = Math.max(0.01, options.faceScale);

    const shapesToCompute = options.shapes ?? MORPH_SHAPES;
    this.computeAll(options.basePositions, options.landmarkCount, options.regions, shapesToCompute);
  }

  private computeAll(
    base: Float32Array,
    landmarkCount: number,
    regions: FaceMeshRegions,
    shapes: MorphShapeDef[]
  ): void {
    // Conjuntos de pertenencia rápida por región
    const mouthSet = new Set(regions.mouth);
    const eyesSet = new Set([...regions.leftEye, ...regions.rightEye]);
    const browsSet = new Set(regions.brows);
    const jawSet = new Set(regions.jaw);
    const noseSet = new Set(regions.nose);

    // Identificar eje horizontal del pivote mandibular (cóndilos cerca de orejas: landmarks 234 y 454)
    const pLeftIdx = 234;
    const pRightIdx = 454;
    const pivotX = 0.5 * (base[pLeftIdx * 3]! + base[pRightIdx * 3]!);

    // Nivel del labio interior superior para delimitar mandíbula
    const lipUpperCenterY = base[LANDMARK_INDICES.lipUpperInnerCenter * 3 + 1]!;

    for (let s = 0; s < shapes.length; s++) {
      const def = shapes[s]!;
      const basis = new Float32Array(this.vertexCount * 3);

      if (def.isPivotJaw) {
        // --- MANDÍBULA ANATÓMICA CON PIVOTE ATM ---
        // Rotación alrededor del cóndilo mandibular (10–14°, calibrado a 12°)
        // + traslación hacia abajo y atrás de 2–3% de faceScale
        for (let i = 0; i < landmarkCount; i++) {
          const vx = base[i * 3]!;
          const vy = base[i * 3 + 1]!;

          // Vértices superiores por encima de los labios no son afectados por la mandíbula
          if (vy > lipUpperCenterY + 0.02 * this.faceScale) {
            continue;
          }

          // Ponderación de influencia: mentón y labio inferior rígidos (1.0), caída suave en mejillas
          let weight = 0;
          if (mouthSet.has(i)) {
            // Labio superior no desciende (ligera elevación natural de volumen); labio inferior acompaña rígido
            const isUpper = vy > lipUpperCenterY - 0.005 * this.faceScale;
            weight = isUpper ? -0.04 : 1.0;
          } else if (jawSet.has(i)) {
            // Mentón y borde mandibular rígidos
            weight = 1.0;
          } else {
            // Mejillas y tejido blando peribucal: caída suave cúbica hacia los cóndilos
            const dropDist = (lipUpperCenterY - vy) / (0.45 * this.faceScale);
            const t = Math.max(0, Math.min(1, dropDist));
            const horizDist = Math.abs(vx - pivotX) / (0.55 * this.faceScale);
            const hFactor = Math.max(0, 1.0 - horizDist * horizDist);
            weight = t * t * (3.0 - 2.0 * t) * hFactor * 0.75;
          }

          if (weight !== 0) {
            // Rotación bisagra ATM de 12° (0.2094 rad) + traslación mandibular hacia abajo (2.5%) y atrás (2.0%)
            const theta = 0.2094 * weight;
            const rotDrop = Math.sin(theta) * 0.50 * this.faceScale;
            const rotRetract = (1.0 - Math.cos(theta)) * 0.35 * this.faceScale;
            const transY = 0.025 * this.faceScale * weight;
            const transZ = 0.020 * this.faceScale * weight;

            basis[i * 3 + 1] -= (rotDrop + transY);
            basis[i * 3 + 2] -= (rotRetract + transZ);
          }
        }
      } else {
        // Procesar manejadores declarativos de la forma para blendshapes no cinemáticos
        for (let h = 0; h < def.handlers.length; h++) {
          const handler = def.handlers[h]!;
          const hIdx = handler.landmarkIndex;
          if (hIdx >= landmarkCount) continue;

          const hx = base[hIdx * 3]!;
          const hy = base[hIdx * 3 + 1]!;
          const hz = base[hIdx * 3 + 2]!;
          const radius = handler.radius * this.faceScale;
          const radiusSq = radius * radius;

          const deltaX = handler.dx * this.faceScale;
          const deltaY = handler.dy * this.faceScale;
          const deltaZ = (handler.dz ?? 0) * this.faceScale;

          for (let i = 0; i < landmarkCount; i++) {
            // Filtrado estricto por región anatómica
            if (handler.region !== 'all') {
              if (handler.region === 'mouth' && !mouthSet.has(i) && !jawSet.has(i)) continue;
              if (handler.region === 'eyes' && !eyesSet.has(i)) continue;
              if (handler.region === 'brows' && !browsSet.has(i)) continue;
              if (handler.region === 'jaw' && !jawSet.has(i) && !mouthSet.has(i)) continue;
              if (handler.region === 'nose' && !noseSet.has(i)) continue;
            }

            const vx = base[i * 3]!;
            const vy = base[i * 3 + 1]!;
            const vz = base[i * 3 + 2]!;

            const distSq = (vx - hx) ** 2 + (vy - hy) ** 2 + (vz - hz) ** 2;
            if (distSq < radiusSq) {
              const u = Math.sqrt(distSq) / radius;
              // Caída suave cuártica: w(u) = (1 - u^2)^2
              const w = (1.0 - u * u) ** 2;

              basis[i * 3] += deltaX * w;
              basis[i * 3 + 1] += deltaY * w;
              basis[i * 3 + 2] += deltaZ * w;
            }
          }
        }
      }

      this.bases.set(def.name, basis);
      this.shapeNames.push(def.name);
    }
  }

  public getBasis(name: string): Float32Array | undefined {
    return this.bases.get(name);
  }
}
