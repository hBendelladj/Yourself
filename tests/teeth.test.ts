import { describe, it, expect } from 'vitest';
import { buildTeethAtlas } from '../src/core/render/teethAtlas';
import { Mouth3D } from '../src/core/render/mouth3d';

describe('Dientes Realistas v4 (teethAtlas & mouth3d)', () => {
  it('buildTeethAtlas devuelve ImageData del tamaño pedido (default y personalizado)', () => {
    const defaultAtlas = buildTeethAtlas({ isUpper: true });
    expect(defaultAtlas.width).toBe(1024);
    expect(defaultAtlas.height).toBe(256);
    expect(defaultAtlas.data.length).toBe(1024 * 256 * 4);

    const customAtlas = buildTeethAtlas({ isUpper: false, width: 512, height: 128 });
    expect(customAtlas.width).toBe(512);
    expect(customAtlas.height).toBe(128);
    expect(customAtlas.data.length).toBe(512 * 128 * 4);
  });

  it('cero huecos entre dientes: ninguna columna del cuerpo tiene alpha < 250 entre 6% y 94% del ancho', () => {
    const atlas = buildTeethAtlas({ isUpper: true, width: 1024, height: 256 });
    const width = 1024;
    const startX = Math.floor(width * 0.06);
    const endX = Math.floor(width * 0.94);

    // Muestrear en el tercio medio de la altura dental (y = 50 a 180)
    for (let x = startX; x <= endX; x++) {
      let maxAlphaInColumn = 0;
      for (let y = 60; y < 180; y++) {
        const a = atlas.data[(y * width + x) * 4 + 3]!;
        if (a > maxAlphaInColumn) maxAlphaInColumn = a;
      }
      expect(maxAlphaInColumn).toBeGreaterThanOrEqual(250);
    }
  });

  it('separaciones suaves: la luminancia mínima del valle interdental es >= 80% de la del centro del diente', () => {
    const atlas = buildTeethAtlas({ isUpper: true, width: 1024, height: 256 });
    const width = 1024;
    const yMid = Math.floor(256 * 0.5);

    // Luminancia sRGB relativa aproximada: 0.299 R + 0.587 G + 0.114 B
    function getLuma(x: number, y: number): number {
      const idx = (y * width + x) * 4;
      return (
        0.299 * atlas.data[idx]! +
        0.587 * atlas.data[idx + 1]! +
        0.114 * atlas.data[idx + 2]!
      );
    }

    // El centro de los incisivos centrales está en torno a x = 512
    const toothCenterLuma = getLuma(Math.floor(width * 0.45), yMid);

    // Buscar el valle interdental central entre el incisivo izquierdo y derecho (x ~ 512)
    let minValleyLuma = Infinity;
    for (let x = Math.floor(width * 0.48); x <= Math.floor(width * 0.52); x++) {
      const luma = getLuma(x, yMid);
      if (luma < minValleyLuma) minValleyLuma = luma;
    }

    const ratio = minValleyLuma / toothCenterLuma;
    // La separación debe ser un sombreado sutil (entre 8% y 15% de oscurecimiento, valle >= 80%)
    expect(ratio).toBeGreaterThanOrEqual(0.80);
    expect(ratio).toBeLessThan(1.0); // Debe existir el valle sombreado
  });

  it('luminancia media >= 195/255 aun con color base oscuro teeth = {r:60, g:50, b:45}', () => {
    const darkBaseAtlas = buildTeethAtlas({
      isUpper: true,
      teeth: { r: 60, g: 50, b: 45 },
      width: 512,
      height: 128,
    });

    let sumLuma = 0;
    let sampleCount = 0;

    // Medir en el cuerpo dental (descartando los extremos con fade lateral y encía profunda)
    const minX = Math.floor(darkBaseAtlas.width * 0.1);
    const maxX = Math.floor(darkBaseAtlas.width * 0.9);
    const minY = Math.floor(darkBaseAtlas.height * 0.15);
    const maxY = Math.floor(darkBaseAtlas.height * 0.85);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = (y * darkBaseAtlas.width + x) * 4;
        const luma =
          0.299 * darkBaseAtlas.data[idx]! +
          0.587 * darkBaseAtlas.data[idx + 1]! +
          0.114 * darkBaseAtlas.data[idx + 2]!;
        sumLuma += luma;
        sampleCount++;
      }
    }

    const meanLuma = sumLuma / sampleCount;
    expect(meanLuma).toBeGreaterThanOrEqual(195);
  });

  it('los dientes inferiores son ligeramente más oscuros que los superiores', () => {
    const upperAtlas = buildTeethAtlas({ isUpper: true, width: 512, height: 128 });
    const lowerAtlas = buildTeethAtlas({ isUpper: false, width: 512, height: 128 });

    const xCenter = Math.floor(512 * 0.5);
    const yCenter = Math.floor(128 * 0.5);
    const idx = (yCenter * 512 + xCenter) * 4;

    const upperLuma =
      0.299 * upperAtlas.data[idx]! +
      0.587 * upperAtlas.data[idx + 1]! +
      0.114 * upperAtlas.data[idx + 2]!;

    const lowerLuma =
      0.299 * lowerAtlas.data[idx]! +
      0.587 * lowerAtlas.data[idx + 1]! +
      0.114 * lowerAtlas.data[idx + 2]!;

    expect(lowerLuma).toBeLessThan(upperLuma);
    expect(lowerLuma / upperLuma).toBeCloseTo(0.93, 1);
  });

  it('mouth3d crea mallas de alta resolución (25x4 superiores, 21x4 inferiores) y orden correcto', () => {
    const mouth = new Mouth3D();

    const upperGeom = mouth.upperTeethMesh.geometry;
    const lowerGeom = mouth.lowerTeethMesh.geometry;

    // 25 x 4 = 100 vértices superiores
    expect(upperGeom.attributes.position!.count).toBe(100);
    expect(upperGeom.index!.count).toBe(24 * 3 * 6); // 432 índices

    // 21 x 4 = 84 vértices inferiores
    expect(lowerGeom.attributes.position!.count).toBe(84);
    expect(lowerGeom.index!.count).toBe(20 * 3 * 6); // 360 índices

    // Orden de renderizado: Stencil (2) -> Cavidad (3) -> Lengua (3.5) -> Dientes (4)
    expect(mouth.stencilMaskMesh.renderOrder).toBe(2);
    expect(mouth.cavityMesh.renderOrder).toBe(3);
    expect(mouth.tongueMesh.renderOrder).toBe(3.5);
    expect(mouth.upperTeethMesh.renderOrder).toBe(4);
    expect(mouth.lowerTeethMesh.renderOrder).toBe(4);

    mouth.destroy();
  });
});
