/**
 * inpaint.worker.ts
 *
 * Algoritmo Push-Pull Inpainting Jerárquico en Worker (YourSelf V4 - Fase 3 / Sección 4.C):
 * - Rellena zonas descubiertas (fondo o bordes del cabello) generadas por la rotación 3D de la cabeza.
 * - Basado en la técnica clásica piramidal Push-Pull (Gortler, Cohen, Szeliski):
 *   1. Fase Push (Downsampling): reduce progresivamente a 64x64, 32x32, 16x16... promediando píxeles conocidos.
 *   2. Fase Pull (Upsampling): interpola bilinealmente el color hacia arriba en las regiones no observadas (huecos).
 * - Cero redes neuronales, 100% CPU en hilo secundario (Web Worker).
 */

export interface InpaintWorkerRequest {
  type: 'inpaint';
  pixels: Uint8ClampedArray;
  mask: Uint8Array; // 1 = conocido / visible, 0 = ocluido / hueco a rellenar
  width: number;
  height: number;
  id?: number;
}

export interface InpaintWorkerResponse {
  type: 'inpaint_result';
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  id?: number;
}

/**
 * Algoritmo Push-Pull en resolución optimizada para rendimiento en tiempo real
 */
export function pushPullInpaint(
  pixels: Uint8ClampedArray,
  mask: Uint8Array,
  w: number,
  h: number
): Uint8ClampedArray {
  let curW = w;
  let curH = h;
  let curImg = new Float32Array(w * h * 4);
  let curWgt = new Float32Array(w * h);

  for (let i = 0; i < w * h; i++) {
    curImg[i * 4] = pixels[i * 4]!;
    curImg[i * 4 + 1] = pixels[i * 4 + 1]!;
    curImg[i * 4 + 2] = pixels[i * 4 + 2]!;
    curImg[i * 4 + 3] = pixels[i * 4 + 3]!;
    curWgt[i] = mask[i]! > 0 ? 1.0 : 0.0;
  }

  const pyrImg: Float32Array[] = [curImg];
  const pyrWgt: Float32Array[] = [curWgt];
  const pyrDims: [number, number][] = [[curW, curH]];

  // 1. Fase Push (construir pirámide hacia abajo)
  while (curW > 4 && curH > 4) {
    const nW = Math.max(1, Math.floor(curW / 2));
    const nH = Math.max(1, Math.floor(curH / 2));
    const nImg = new Float32Array(nW * nH * 4);
    const nWgt = new Float32Array(nW * nH);

    for (let y = 0; y < nH; y++) {
      for (let x = 0; x < nW; x++) {
        let sumR = 0, sumG = 0, sumB = 0, sumA = 0, sumW = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const px = Math.min(curW - 1, x * 2 + dx);
            const py = Math.min(curH - 1, y * 2 + dy);
            const pIdx = py * curW + px;
            const wgt = curWgt[pIdx]!;
            if (wgt > 0) {
              sumR += curImg[pIdx * 4]! * wgt;
              sumG += curImg[pIdx * 4 + 1]! * wgt;
              sumB += curImg[pIdx * 4 + 2]! * wgt;
              sumA += curImg[pIdx * 4 + 3]! * wgt;
              sumW += wgt;
            }
          }
        }
        const outIdx = y * nW + x;
        if (sumW > 0) {
          nImg[outIdx * 4] = sumR / sumW;
          nImg[outIdx * 4 + 1] = sumG / sumW;
          nImg[outIdx * 4 + 2] = sumB / sumW;
          nImg[outIdx * 4 + 3] = sumA / sumW;
          nWgt[outIdx] = sumW / 4.0;
        }
      }
    }
    curW = nW;
    curH = nH;
    curImg = nImg;
    curWgt = nWgt;
    pyrImg.push(curImg);
    pyrWgt.push(curWgt);
    pyrDims.push([curW, curH]);
  }

  // 2. Fase Pull (difundir colores hacia arriba en los huecos)
  for (let l = pyrImg.length - 2; l >= 0; l--) {
    const [cW, cH] = pyrDims[l]!;
    const [pW, pH] = pyrDims[l + 1]!;
    const cImg = pyrImg[l]!;
    const cWgt = pyrWgt[l]!;
    const pImg = pyrImg[l + 1]!;

    for (let y = 0; y < cH; y++) {
      const py = Math.min(pH - 1, Math.floor(y / 2));
      for (let x = 0; x < cW; x++) {
        const px = Math.min(pW - 1, Math.floor(x / 2));
        const cIdx = y * cW + x;
        const pIdx = py * pW + px;
        const wgt = cWgt[cIdx]!;

        if (wgt < 1.0) {
          const alpha = 1.0 - wgt;
          cImg[cIdx * 4] = wgt * cImg[cIdx * 4]! + alpha * pImg[pIdx * 4]!;
          cImg[cIdx * 4 + 1] = wgt * cImg[cIdx * 4 + 1]! + alpha * pImg[pIdx * 4 + 1]!;
          cImg[cIdx * 4 + 2] = wgt * cImg[cIdx * 4 + 2]! + alpha * pImg[pIdx * 4 + 2]!;
          cImg[cIdx * 4 + 3] = 255;
          cWgt[cIdx] = 1.0;
        }
      }
    }
  }

  const out = new Uint8ClampedArray(w * h * 4);
  const baseImg = pyrImg[0]!;
  for (let i = 0; i < w * h * 4; i++) {
    out[i] = Math.min(255, Math.max(0, Math.round(baseImg[i]!)));
  }

  return out;
}

// Configuración opcional como Web Worker nativo en navegador
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.onmessage = (e: MessageEvent<InpaintWorkerRequest>) => {
    if (e.data.type === 'inpaint') {
      const { pixels, mask, width, height, id } = e.data;
      const res = pushPullInpaint(pixels, mask, width, height);
      self.postMessage(
        {
          type: 'inpaint_result',
          pixels: res,
          width,
          height,
          id,
        },
        [res.buffer] as unknown as StructuredSerializeOptions
      );
    }
  };
}
