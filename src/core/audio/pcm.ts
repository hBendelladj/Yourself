/**
 * pcm.ts
 *
 * Utilidades de audio PCM:
 * - Conversión entre Float32 [-1, 1] y PCM16 entero con signo [-32768, 32767].
 * - Conversión entre Int16Array y Base64 en little-endian.
 * - Remuestreo lineal entre frecuencias arbitrarias (ej. 48000 Hz <-> 16000 Hz / 24000 Hz).
 */

/**
 * Convierte un arreglo Float32Array [-1.0, 1.0] a Int16Array PCM16 lineal
 */
export function float32ToPcm16(float32: Float32Array): Int16Array {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1.0, Math.min(1.0, float32[i]!));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm16;
}

/**
 * Convierte un arreglo Int16Array PCM16 lineal a Float32Array [-1.0, 1.0]
 */
export function pcm16ToFloat32(pcm16: Int16Array): Float32Array {
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    const s = pcm16[i]!;
    float32[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return float32;
}

/**
 * Convierte un arreglo Int16Array en cadena Base64 (Little-Endian)
 */
export function pcm16ToBase64(pcm16: Int16Array): string {
  const uint8 = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
  let binary = '';
  const len = uint8.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8[i]!);
  }
  return btoa(binary);
}

/**
 * Decodifica una cadena Base64 a Int16Array PCM16 (Little-Endian)
 */
export function base64ToPcm16(base64: string): Int16Array {
  const binary = atob(base64);
  const len = binary.length;
  const uint8 = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    uint8[i] = binary.charCodeAt(i);
  }
  // Asegurar alineación de 2 bytes
  const alignedLength = Math.floor(len / 2);
  return new Int16Array(uint8.buffer, uint8.byteOffset, alignedLength);
}

/**
 * Remuestreo de audio lineal simple entre dos frecuencias de muestreo
 */
export function resampleAudio(
  input: Float32Array,
  inputRate: number,
  outputRate: number
): Float32Array {
  if (inputRate === outputRate || input.length === 0) {
    return new Float32Array(input);
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const fraction = srcIndex - i0;

    const s0 = input[i0] ?? 0;
    const s1 = input[i1] ?? 0;

    output[i] = s0 + fraction * (s1 - s0);
  }

  return output;
}
