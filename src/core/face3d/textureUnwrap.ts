/**
 * textureUnwrap.ts
 *
 * Desenrollador y Proyector de Textura Canónica UV (YourSelf V3 - Fase 2 / Sección 10.2):
 * - Proyecta las coordenadas de la fotografía sobre la carta UV canónica estandarizada.
 * - Evalúa los vectores normales locales de la superficie n y su producto escalar con el vector de vista
 *   de la cámara (n · v_cam) para detectar zonas con escorzo severo u oclusión lateral (n · v < 0.15).
 * - Aplica simetría bilateral anatómica plausible para completar áreas ocluidas en fotos con giro 3/4.
 * - Cero allocations en tiempo de ejecución (se ejecuta una única vez en inicialización).
 */

export interface TextureUnwrapConfig {
  metricPositions: Float32Array;
  indices: Uint16Array;
  landmarkCount: number;
  imageWidth: number;
  imageHeight: number;
}

export interface TextureUnwrapResult {
  uvs: Float32Array; // vertexCount x 2
  occlusionMask: Float32Array; // [0..1] grado de visibilidad (1: completamente visible, 0: ocluido)
  bilateralSymmetryApplied: boolean;
}

export class TextureUnwrapper {
  /**
   * Genera el mapa de coordenadas UV y la máscara de oclusión a partir de la geometría métrica 3D
   */
  public static unwrap(config: TextureUnwrapConfig): TextureUnwrapResult {
    const { metricPositions, indices, landmarkCount } = config;
    const vertexCount = metricPositions.length / 3;
    const uvs = new Float32Array(vertexCount * 2);
    const occlusionMask = new Float32Array(vertexCount);
    occlusionMask.fill(1.0);

    // Vector de vista de la cámara frontal: apuntando hacia -Z
    const camVx = 0, camVy = 0, camVz = 1.0;

    // 1. Proyección ortográfica inicial normalizada
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (let i = 0; i < landmarkCount; i++) {
      const x = metricPositions[i * 3]!;
      const y = metricPositions[i * 3 + 1]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const spanX = Math.max(1e-4, maxX - minX);
    const spanY = Math.max(1e-4, maxY - minY);

    for (let i = 0; i < vertexCount; i++) {
      const x = metricPositions[i * 3]!;
      const y = metricPositions[i * 3 + 1]!;

      // Normalizado [0, 1]
      const u = (x - minX) / spanX;
      const v = (y - minY) / spanY;

      uvs[i * 2] = Math.max(0, Math.min(1.0, u));
      uvs[i * 2 + 1] = Math.max(0, Math.min(1.0, v));
    }

    // 2. Cálculo de normales por triángulo y detección de oclusión (n · v < 0.15)
    let occludedCount = 0;
    const triCount = indices.length / 3;

    for (let t = 0; t < triCount; t++) {
      const i0 = indices[t * 3]!;
      const i1 = indices[t * 3 + 1]!;
      const i2 = indices[t * 3 + 2]!;

      if (i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) continue;

      const p0x = metricPositions[i0 * 3]!, p0y = metricPositions[i0 * 3 + 1]!, p0z = metricPositions[i0 * 3 + 2]!;
      const p1x = metricPositions[i1 * 3]!, p1y = metricPositions[i1 * 3 + 1]!, p1z = metricPositions[i1 * 3 + 2]!;
      const p2x = metricPositions[i2 * 3]!, p2y = metricPositions[i2 * 3 + 1]!, p2z = metricPositions[i2 * 3 + 2]!;

      // Vector arista 1 y 2
      const e1x = p1x - p0x, e1y = p1y - p0y, e1z = p1z - p0z;
      const e2x = p2x - p0x, e2y = p2y - p0y, e2z = p2z - p0z;

      // Producto vectorial (normal de superficie)
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;

      const len = Math.hypot(nx, ny, nz);
      if (len > 1e-6) {
        nx /= len;
        ny /= len;
        nz /= len;
      }

      // Producto escalar con el vector de vista
      const dot = nx * camVx + ny * camVy + nz * camVz;

      if (dot < 0.15) {
        occlusionMask[i0] = Math.min(occlusionMask[i0]!, Math.max(0, dot));
        occlusionMask[i1] = Math.min(occlusionMask[i1]!, Math.max(0, dot));
        occlusionMask[i2] = Math.min(occlusionMask[i2]!, Math.max(0, dot));
        occludedCount++;
      }
    }

    // 3. Simetría bilateral para vértices altamente ocluidos en caras no frontales
    let bilateralApplied = false;
    const midX = 0.5 * (minX + maxX);

    for (let i = 0; i < landmarkCount; i++) {
      if (occlusionMask[i]! < 0.15) {
        // Encontrar punto simétrico complementario respecto al plano sagital medio
        const vx = metricPositions[i * 3]!;
        const mirroredX = midX - (vx - midX);

        // Mapear UV simétrico complementario
        const mirroredU = (mirroredX - minX) / spanX;
        uvs[i * 2] = Math.max(0, Math.min(1.0, mirroredU));
        bilateralApplied = true;
      }
    }

    return {
      uvs,
      occlusionMask,
      bilateralSymmetryApplied: bilateralApplied,
    };
  }
}
