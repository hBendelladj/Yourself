/**
 * teethAtlas.ts
 *
 * Generador procedural puro de alta resolución para atlas de dientes (YourSelf v4):
 * - Banda continua de esmalte marfil sin huecos de alpha entre dientes.
 * - Separaciones interdentales como valles gaussianos suaves (8-15% oscurecimiento), nunca líneas negras.
 * - Anchos relativos anatómicos de 10 dientes (incisivos centrales más anchos y brillantes).
 * - Convexidad cilíndrica por diente y sombreado lateral en corredor bucal.
 * - Brillo especular húmedo en incisivos superiores y degradado translúcido en borde incisal.
 * - Corrección de color base garantizando marfil limpio incluso con fotos oscuras.
 */

export interface TeethAtlasOptions {
  teeth?: { r: number; g: number; b: number } | null;
  isUpper: boolean;
  width?: number; // default 1024
  height?: number; // default 256
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  if (max !== min) {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h, s, v];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
  }
  return [r * 255, g * 255, b * 255];
}

// Anchos relativos de 10 dientes (de izquierda a derecha):
// 2 premolares, 1 canino, 1 lateral, 2 centrales, 1 lateral, 1 canino, 2 premolares
const UPPER_REL_WIDTHS = [0.60, 0.68, 0.82, 0.78, 1.00, 1.00, 0.78, 0.82, 0.68, 0.60];
const LOWER_REL_WIDTHS = [0.55, 0.62, 0.72, 0.66, 0.62, 0.62, 0.66, 0.72, 0.62, 0.55];

export function buildTeethAtlas(opts: TeethAtlasOptions): ImageData {
  const width = opts.width ?? 1024;
  const height = opts.height ?? 256;
  const isUpper = opts.isUpper;

  // 1. Color base robusto (Sección 3.1, regla 9):
  // Mezclar con marfil limpio (243, 238, 228) con peso 0.65
  const rawTeeth = opts.teeth ?? { r: 242, g: 238, b: 230 };
  let baseR = rawTeeth.r * 0.35 + 243 * 0.65;
  let baseG = rawTeeth.g * 0.35 + 238 * 0.65;
  let baseB = rawTeeth.b * 0.35 + 228 * 0.65;

  const [h, rawS, rawV] = rgbToHsv(baseR, baseG, baseB);
  let s = rawS;
  let v = rawV;
  if (s > 0.16) s = 0.16; // Limitar saturación a <= 0.16
  const minV = 222 / 255;  // Forzar luminancia mínima (~222/255 para garantizar marfil limpio y media >= 195)
  if (v < minV) v = minV;
  [baseR, baseG, baseB] = hsvToRgb(h, s, v);

  // Dientes inferiores ligeramente más pequeños y tenues (×0.93)
  if (!isUpper) {
    baseR *= 0.93;
    baseG *= 0.93;
    baseB *= 0.93;
  }

  // 2. Anchos y límites de dientes
  const relWidths = isUpper ? UPPER_REL_WIDTHS : LOWER_REL_WIDTHS;
  const toothCount = relWidths.length; // 10
  const totalRelWidth = relWidths.reduce((a, b) => a + b, 0);

  const lefts = new Float32Array(toothCount);
  const rights = new Float32Array(toothCount);
  const boundaries = new Float32Array(toothCount - 1); // 9 límites interiores

  let cumX = 0;
  for (let i = 0; i < toothCount; i++) {
    lefts[i] = (cumX / totalRelWidth) * width;
    cumX += relWidths[i]!;
    rights[i] = (cumX / totalRelWidth) * width;
    if (i < toothCount - 1) {
      boundaries[i] = rights[i]!;
    }
  }

  const sigma = 1.4 * (width / 1024);
  const data = new Uint8ClampedArray(width * height * 4);

  // Color de tinte incisal translúcido (gris-azulado suave: #DCE0E4)
  const incisalTintR = 220;
  const incisalTintG = 224;
  const incisalTintB = 228;

  // Color de encía suave en la zona gingival (#D4828E)
  const gingivaTintR = 212;
  const gingivaTintG = 130;
  const gingivaTintB = 142;

  for (let y = 0; y < height; y++) {
    // Coordenada normalizada hacia el borde incisal:
    // Para superiores: y = 0 es encía (incisalDist = 0), y = height - 1 es borde incisal (incisalDist = 1)
    // Para inferiores: y = height - 1 es encía (incisalDist = 0), y = 0 es borde incisal (incisalDist = 1)
    const incisalDist = isUpper
      ? y / (height - 1)
      : 1.0 - y / (height - 1);

    // Borde incisal anti-aliasing (1-2 px al extremo incisal)
    const incisalPxFromEdge = isUpper ? (height - 1 - y) : y;
    const alphaIncisal = smoothstep(0.0, 1.6, incisalPxFromEdge);

    // Sombra de contacto del labio en el ~15% gingival (hasta ×0.82)
    const lipShadow = 1.0 - 0.18 * smoothstep(0.18, 0.0, incisalDist);

    // Gradiente vertical de esmalte:
    // a) Tinte gingival rosado en el ~8% superior
    const gingivaWeight = isUpper
      ? smoothstep(0.09, 0.0, incisalDist) * 0.20
      : smoothstep(0.09, 0.0, incisalDist) * 0.16;

    // b) Tinte incisal gris-azulado en el ~25% incisal
    const incisalWeight = smoothstep(0.72, 1.0, incisalDist) * 0.22;

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      // 1. Diente al que pertenece el pixel x
      let toothIdx = 0;
      for (let t = 0; t < toothCount; t++) {
        if (x >= lefts[t]! && x <= rights[t]!) {
          toothIdx = t;
          break;
        }
      }

      // 2. Abombamiento cilíndrico por diente (Sección 3.1, regla 4)
      const toothW = rights[toothIdx]! - lefts[toothIdx]!;
      const localU = toothW > 0 ? (x - lefts[toothIdx]!) / toothW : 0.5;
      const toothShade = 0.95 + 0.05 * Math.cos(Math.PI * (localU - 0.5));

      // 3. Separación interdental gaussiana (Sección 3.1, regla 3)
      let minBoundaryDist = Infinity;
      let closestBoundaryIdx = 0;
      for (let b = 0; b < boundaries.length; b++) {
        const d = Math.abs(x - boundaries[b]!);
        if (d < minBoundaryDist) {
          minBoundaryDist = d;
          closestBoundaryIdx = b;
        }
      }

      let valley = 1.0;
      if (minBoundaryDist < 4.0 * sigma) {
        // Profundidad entre 0.08 (centrales) y 0.13 (laterales)
        const boundaryNorm = Math.abs((closestBoundaryIdx - 4) / 4);
        const depth = 0.08 + 0.05 * boundaryNorm;
        const g = Math.exp(-((minBoundaryDist / sigma) ** 2));
        const verticalFade = smoothstep(0.12, 0.50, incisalDist);
        valley = 1.0 - depth * g * verticalFade;
      }

      // 4. Corredor bucal: penumbra lateral suave hacia los extremos (regla 6)
      const normX = (x / (width - 1)) * 2.0 - 1.0; // [-1, 1]
      const absX = Math.abs(normX);
      const corridor = 1.0 - 0.42 * smoothstep(0.52, 1.0, absX);

      // 5. Highlight especular suave en tercio superior de los 2 incisivos centrales (regla 7)
      let specular = 0.0;
      if (isUpper && (toothIdx === 4 || toothIdx === 5)) {
        const centerX = width * 0.5;
        const dx = (x - centerX) / (0.07 * width);
        const dy = (incisalDist - 0.28) / 0.12;
        specular = Math.exp(-(dx * dx + dy * dy)) * 0.08;
      }

      // Combinar colores
      let r = baseR;
      let g = baseG;
      let b = baseB;

      // Aplicar degradado gingival
      if (gingivaWeight > 0) {
        r = r * (1 - gingivaWeight) + gingivaTintR * gingivaWeight;
        g = g * (1 - gingivaWeight) + gingivaTintG * gingivaWeight;
        b = b * (1 - gingivaWeight) + gingivaTintB * gingivaWeight;
      }

      // Aplicar tinte incisal
      if (incisalWeight > 0) {
        r = r * (1 - incisalWeight) + incisalTintR * incisalWeight;
        g = g * (1 - incisalWeight) + incisalTintG * incisalWeight;
        b = b * (1 - incisalWeight) + incisalTintB * incisalWeight;
      }

      // Modulaciones lumínicas
      const lightFactor = toothShade * valley * lipShadow * corridor * (1.0 + specular);
      r = clamp(r * lightFactor, 0, 255);
      g = clamp(g * lightFactor, 0, 255);
      b = clamp(b * lightFactor * (corridor < 0.9 ? 0.96 : 1.0), 0, 255);

      // 6. Alpha continuo (regla 2):
      // Fade lateral en el ~5% de cada extremo (0 a 0.05 y 0.95 a 1.0)
      const xNorm01 = x / (width - 1);
      const alphaLateral = smoothstep(0.0, 0.05, xNorm01) * smoothstep(1.0, 0.95, xNorm01);
      const alpha = Math.round(255 * alphaLateral * alphaIncisal);

      data[idx] = Math.round(r);
      data[idx + 1] = Math.round(g);
      data[idx + 2] = Math.round(b);
      data[idx + 3] = alpha;
    }
  }

  if (typeof ImageData !== 'undefined') {
    return new ImageData(data, width, height);
  }
  return {
    width,
    height,
    data,
    colorSpace: 'srgb',
  } as unknown as ImageData;
}
