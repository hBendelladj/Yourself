/**
 * shading.ts
 *
 * Pseudo-volumen procedural mediante sombreado por deformación de área (Sección 7.11):
 * - Evalúa por triángulo la variación de área respecto al reposo:
 *   - Compresión (pliegues de sonrisa, sellado labial, entrecejo) => oscurecimiento suave (factor < 1.0)
 *   - Estiramiento (apertura de mandíbula, extensión labial) => sutil aclarado (factor > 1.0)
 * - Acotado estrictamente a ±8% ([0.92, 1.08]) para evitar artefactos visuales.
 * - Restringido a regiones clave (labios, mentón, pliegue periorbitario) para mínimo coste CPU.
 * - Cero asignaciones en memoria en el bucle de renderizado.
 */

import * as THREE from 'three';
import { FaceMeshRegions } from '@/core/face/buildMesh';

export interface PseudoVolumeShadingOptions {
  basePositions: Float32Array;
  indices: Uint16Array;
  vertexCount: number;
  regions?: FaceMeshRegions;
}

export class PseudoVolumeShading {
  private vertexCount: number;
  public colors: Float32Array; // RGB por vértice [r0, g0, b0, ...]
  public colorAttribute: THREE.BufferAttribute;

  // Triángulos clave monitoreados
  private trackedTriangles: Uint16Array;
  private restAreas: Float32Array;
  private trackedCount = 0;

  // Acumuladores preasignados
  private vertexDeltas: Float32Array;
  private vertexCounts: Uint8Array;

  constructor(options: PseudoVolumeShadingOptions) {
    this.vertexCount = options.vertexCount;
    this.colors = new Float32Array(this.vertexCount * 3);
    this.colors.fill(1.0); // Blanco neutro (1.0 = color original de la textura)

    this.colorAttribute = new THREE.BufferAttribute(this.colors, 3);

    this.vertexDeltas = new Float32Array(this.vertexCount);
    this.vertexCounts = new Uint8Array(this.vertexCount);

    this.initTrackedTriangles(options.basePositions, options.indices, options.regions);
  }

  private initTrackedTriangles(
    base: Float32Array,
    indices: Uint16Array,
    regions?: FaceMeshRegions
  ): void {
    const totalTriangles = Math.floor(indices.length / 3);

    // Conjunto de vértices clave (boca, cejas, ojos, mentón)
    let keyVertices: Set<number> | null = null;
    if (regions) {
      keyVertices = new Set<number>([
        ...regions.mouth,
        ...regions.jaw,
        ...regions.leftEye,
        ...regions.rightEye,
        ...regions.brows,
      ]);
    }

    const trackedIndicesList: number[] = [];
    const restAreasList: number[] = [];

    for (let t = 0; t < totalTriangles; t++) {
      const i0 = indices[t * 3]!;
      const i1 = indices[t * 3 + 1]!;
      const i2 = indices[t * 3 + 2]!;

      // Si se especificaron regiones, solo incluir triángulos que pertenezcan a áreas deformables
      if (keyVertices) {
        if (!keyVertices.has(i0) && !keyVertices.has(i1) && !keyVertices.has(i2)) {
          continue;
        }
      }

      const ax = base[i0 * 3]!;
      const ay = base[i0 * 3 + 1]!;
      const az = base[i0 * 3 + 2]!;

      const bx = base[i1 * 3]!;
      const by = base[i1 * 3 + 1]!;
      const bz = base[i1 * 3 + 2]!;

      const cx = base[i2 * 3]!;
      const cy = base[i2 * 3 + 1]!;
      const cz = base[i2 * 3 + 2]!;

      // Producto vectorial (B - A) x (C - A)
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;

      const crossX = uy * vz - uz * vy;
      const crossY = uz * vx - ux * vz;
      const crossZ = ux * vy - uy * vx;

      const area = 0.5 * Math.hypot(crossX, crossY, crossZ);
      if (area > 1e-6) {
        trackedIndicesList.push(i0, i1, i2);
        restAreasList.push(area);
      }
    }

    this.trackedCount = restAreasList.length;
    this.trackedTriangles = new Uint16Array(trackedIndicesList);
    this.restAreas = new Float32Array(restAreasList);
  }

  /**
   * Actualiza los factores de color por vértice según la deformación local de área,
   * sombreado sutil dependiente del ángulo cefálico (Fase D) y desocclusión perimetral con degradación elegante.
   * Cero asignaciones de memoria.
   */
  public update(currentPositions: Float32Array, headYaw = 0, headPitch = 0): void {
    this.vertexDeltas.fill(0);
    this.vertexCounts.fill(0);

    const triangles = this.trackedTriangles;
    const areas = this.restAreas;
    const count = this.trackedCount;

    for (let t = 0; t < count; t++) {
      const i0 = triangles[t * 3]!;
      const i1 = triangles[t * 3 + 1]!;
      const i2 = triangles[t * 3 + 2]!;

      const ax = currentPositions[i0 * 3]!;
      const ay = currentPositions[i0 * 3 + 1]!;
      const az = currentPositions[i0 * 3 + 2]!;

      const bx = currentPositions[i1 * 3]!;
      const by = currentPositions[i1 * 3 + 1]!;
      const bz = currentPositions[i1 * 3 + 2]!;

      const cx = currentPositions[i2 * 3]!;
      const cy = currentPositions[i2 * 3 + 1]!;
      const cz = currentPositions[i2 * 3 + 2]!;

      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;

      const crossX = uy * vz - uz * vy;
      const crossY = uz * vx - ux * vz;
      const crossZ = ux * vy - uy * vx;

      const curArea = 0.5 * Math.hypot(crossX, crossY, crossZ);
      const restArea = areas[t]!;

      // Relación de área respecto al reposo
      const ratio = curArea / restArea;

      // Delta acotado a ±8% ([ -0.08, 0.08 ])
      let delta = (ratio - 1.0) * 0.22;
      if (delta > 0.08) delta = 0.08;
      else if (delta < -0.08) delta = -0.08;

      this.vertexDeltas[i0] += delta;
      this.vertexDeltas[i1] += delta;
      this.vertexDeltas[i2] += delta;

      this.vertexCounts[i0]++;
      this.vertexCounts[i1]++;
      this.vertexCounts[i2]++;
    }

    // Promediar y asignar a los canales RGB
    const colors = this.colors;
    const deltas = this.vertexDeltas;
    const vCounts = this.vertexCounts;
    const n = this.vertexCount;

    // Parámetros de atenuación para desocclusión a yaw alto (Fase 2)
    const absYaw = Math.abs(headYaw);
    const useYawFeather = absYaw > 0.20; // > ~11.5°
    const yawSign = Math.sign(headYaw);
    const yawFade = useYawFeather ? Math.min(1.0, (absYaw - 0.20) / 0.32) : 0;

    // Fase D: Sombreado dependiente del ángulo cefálico (luz virtual direccional acotada a ±3.5%)
    const lightYawAmp = Math.max(-0.035, Math.min(0.035, headYaw * 0.16));
    const lightPitchAmp = Math.max(-0.025, Math.min(0.025, headPitch * 0.14));

    for (let i = 0; i < n; i++) {
      const c = vCounts[i]!;
      let shade = c > 0 ? 1.0 + (deltas[i]! / c) : 1.0;

      const vx = currentPositions[i * 3]!;
      const vy = currentPositions[i * 3 + 1]!;

      // Iluminación direccional continua en función del giro cefálico
      if (Math.abs(headYaw) > 0.005 || Math.abs(headPitch) > 0.005) {
        shade += (vx * lightYawAmp - vy * lightPitchAmp);
      }

      // Feathering perimetral en la oreja/lateral recedente para evitar saltos o estiramientos
      if (useYawFeather) {
        if (-yawSign * vx > 0.45) {
          const edgeDist = Math.min(1.0, (Math.abs(vx) - 0.45) / 0.45);
          const feather = 1.0 - edgeDist * 0.35 * yawFade;
          shade *= feather;
        }
      }

      // Acotación estricta [0.92, 1.08] para preservar intacto el tono natural de la piel
      shade = Math.max(0.92, Math.min(1.08, shade));

      // Aplicar uniformemente a RGB para no alterar tonalidad cromática
      colors[i * 3] = shade;
      colors[i * 3 + 1] = shade;
      colors[i * 3 + 2] = shade;
    }

    this.colorAttribute.needsUpdate = true;
  }
}
