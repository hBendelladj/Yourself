/**
 * noise.ts
 *
 * Generador de Ruido 1D Multioctava para Dinámica Cefálica (Sección 7.10):
 * - Reemplaza los osciladores senoidales fijos y repetitivos por movimiento estocástico continuo.
 * - Interpolación quíntica suave de Perlin (s(t) = 6t⁵ - 15t⁴ + 10t³) para derivadas continuas
 *   de velocidad y aceleración (cero tirones ni sacudidas).
 * - Constantes temporales y frecuencias desacopladas por eje (Yaw, Pitch, Roll).
 * - Amplitud diferenciada entre reposo y habla, escalada por frontalidad.
 */

import { AvatarMood } from '@/lib/types';

/**
 * Hash pseudoaleatorio determinista para gradientes 1D
 */
function hash1D(n: number): number {
  let x = (n ^ 0x61) ^ (n >>> 16);
  x = Math.imul(x, 0x27d4eb2d);
  x = x ^ (x >>> 15);
  return ((x & 0x7fffffff) / 0x3fffffff) - 1.0; // [-1.0, 1.0]
}

/**
 * Muestrea ruido continuo 1D con interpolación quíntica de Hermite
 */
export function sampleGradientNoise1D(t: number): number {
  const i0 = Math.floor(t);
  const i1 = i0 + 1;
  const f = t - i0;

  // Curva S de Perlin (quíntica): 6t⁵ - 15t⁴ + 10t³
  const s = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

  const g0 = hash1D(i0);
  const g1 = hash1D(i1);

  // Contribución de distancia a los extremos
  const v0 = g0 * f;
  const v1 = g1 * (f - 1.0);

  return (v0 + (v1 - v0) * s) * 2.0; // normalizado a [-1.0, 1.0]
}

/**
 * Ruido multioctava (Fractal Brownian Motion 1D)
 */
export function sampleFractalNoise1D(
  t: number,
  octaves = 3,
  lacunarity = 2.0,
  persistence = 0.5
): number {
  let total = 0;
  let frequency = 1.0;
  let amplitude = 1.0;
  let maxAmp = 0;

  for (let i = 0; i < octaves; i++) {
    total += sampleGradientNoise1D(t * frequency) * amplitude;
    maxAmp += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return total / Math.max(0.001, maxAmp);
}

export interface HeadPoseTargets {
  yaw: number;   // radianes
  pitch: number;
  roll: number;
  breath: number;
}

export class HeadNoiseController {
  private elapsedSeconds = 0;
  public frontality = 1.0;

  // Desfases de semilla para desacoplar los 3 ejes
  private readonly seedYaw = 14.28;
  private readonly seedPitch = 83.71;
  private readonly seedRoll = 49.52;

  // Frecuencias base por eje (Hz)
  private readonly freqYaw = 0.28;
  private readonly freqPitch = 0.22;
  private readonly freqRoll = 0.16;

  // Grados a radianes
  private readonly DEG2RAD = Math.PI / 180.0;

  constructor(frontality = 1.0) {
    this.frontality = Math.max(0.3, Math.min(1.0, frontality));
  }

  /**
   * Genera los ángulos objetivo de cabeza y respiración para el fotograma actual
   */
  public update(deltaSeconds: number, mood: AvatarMood = 'idle'): HeadPoseTargets {
    this.elapsedSeconds += deltaSeconds;
    const t = this.elapsedSeconds;

    const isSpeaking = mood === 'speaking';

    // Amplitudes en grados (Sección 7.10)
    // Reposo: ±2.5° yaw, ±2.0° pitch, ±1.5° roll
    // Hablando: hasta ±5.0° yaw, ±4.0° pitch, ±3.0° roll
    const ampYawDeg = (isSpeaking ? 4.8 : 2.5) * this.frontality;
    const ampPitchDeg = (isSpeaking ? 3.8 : 2.0) * this.frontality;
    const ampRollDeg = (isSpeaking ? 2.8 : 1.5) * this.frontality;

    // Muestreo multioctava desacoplado
    const nYaw = sampleFractalNoise1D(t * this.freqYaw + this.seedYaw, 3);
    const nPitch = sampleFractalNoise1D(t * this.freqPitch + this.seedPitch, 3);
    const nRoll = sampleFractalNoise1D(t * this.freqRoll + this.seedRoll, 2);

    // Conversión a radianes y acotado estricto a topes absolutos
    // Topes absolutos: ±8° yaw, ±6° pitch, ±5° roll
    const maxYawRad = 8.0 * this.DEG2RAD * this.frontality;
    const maxPitchRad = 6.0 * this.DEG2RAD * this.frontality;
    const maxRollRad = 5.0 * this.DEG2RAD * this.frontality;

    const rawYaw = nYaw * ampYawDeg * this.DEG2RAD;
    const rawPitch = nPitch * ampPitchDeg * this.DEG2RAD;
    const rawRoll = nRoll * ampRollDeg * this.DEG2RAD;

    const yaw = Math.max(-maxYawRad, Math.min(maxYawRad, rawYaw));
    const pitch = Math.max(-maxPitchRad, Math.min(maxPitchRad, rawPitch));
    const roll = Math.max(-maxRollRad, Math.min(maxRollRad, rawRoll));

    // Respiración continua (ciclo suave de ~3.8 s)
    const breath = 0.5 + 0.5 * Math.sin(t * (Math.PI * 2 / 3.8));

    return { yaw, pitch, roll, breath };
  }
}
