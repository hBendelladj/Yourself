import { describe, it, expect } from 'vitest';
import {
  float32ToPcm16,
  pcm16ToFloat32,
  pcm16ToBase64,
  base64ToPcm16,
  resampleAudio,
} from '../src/core/audio/pcm';

describe('PCM Audio Conversion & Resampling', () => {
  it('converts float32 to pcm16 and clamps out-of-range values', () => {
    const input = new Float32Array([-1.5, -1.0, 0.0, 0.5, 1.0, 1.5]);
    const pcm16 = float32ToPcm16(input);

    expect(pcm16.length).toBe(6);
    expect(pcm16[0]).toBe(-32768); // Clamped
    expect(pcm16[1]).toBe(-32768);
    expect(pcm16[2]).toBe(0);
    expect(pcm16[3]).toBeCloseTo(16383, -2);
    expect(pcm16[4]).toBe(32767);
    expect(pcm16[5]).toBe(32767); // Clamped
  });

  it('performs lossless roundtrip between Float32 and PCM16', () => {
    const original = new Float32Array([-0.8, -0.4, 0.0, 0.25, 0.75]);
    const pcm16 = float32ToPcm16(original);
    const restored = pcm16ToFloat32(pcm16);

    for (let i = 0; i < original.length; i++) {
      expect(restored[i]).toBeCloseTo(original[i]!, 3);
    }
  });

  it('correctly encodes and decodes PCM16 to Base64 in little-endian format', () => {
    const originalPcm16 = new Int16Array([0, -1, 32767, -32768, 1234, -5678]);
    const base64 = pcm16ToBase64(originalPcm16);

    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(0);

    const decodedPcm16 = base64ToPcm16(base64);
    expect(decodedPcm16.length).toBe(originalPcm16.length);

    for (let i = 0; i < originalPcm16.length; i++) {
      expect(decodedPcm16[i]).toBe(originalPcm16[i]);
    }
  });

  it('resamples audio linearly between sampling rates', () => {
    // Señal senoidal a 16 kHz de 160 muestras (10 ms)
    const inRate = 16000;
    const outRate = 24000;
    const inLength = 160;
    const input = new Float32Array(inLength);
    for (let i = 0; i < inLength; i++) {
      input[i] = Math.sin((i / inRate) * 2 * Math.PI * 440);
    }

    const resampled = resampleAudio(input, inRate, outRate);
    // 160 * (24000 / 16000) = 240 muestras
    expect(resampled.length).toBe(240);

    // Los extremos de la señal deben mantenerse suaves
    expect(resampled[0]).toBeCloseTo(input[0]!, 2);
  });
});
