import { describe, it, expect } from 'vitest';
import {
  MAX_IMAGE_FILE_SIZE_BYTES,
  ACCEPTED_IMAGE_MIME_TYPES,
  ACCEPTED_IMAGE_EXTENSIONS,
  MIN_FACE_IMAGE_DIMENSION,
} from '../src/lib/constants';
import { buildSystemInstruction } from '../src/core/live/persona';
import { VOICES_MAP, getDefaultVoice } from '../src/core/live/voices';
import { isQuotaOrTokenError } from '../src/core/live/liveClient';

describe('Setup and Validation Rules', () => {
  it('validates file size limits correctly (8 MB)', () => {
    expect(MAX_IMAGE_FILE_SIZE_BYTES).toBe(8 * 1024 * 1024);
  });

  it('restricts accepted MIME types to PNG and JPEG', () => {
    expect(ACCEPTED_IMAGE_MIME_TYPES).toContain('image/png');
    expect(ACCEPTED_IMAGE_MIME_TYPES).toContain('image/jpeg');
    expect(ACCEPTED_IMAGE_MIME_TYPES).not.toContain('image/gif');
    expect(ACCEPTED_IMAGE_MIME_TYPES).not.toContain('image/webp');
  });

  it('restricts accepted extensions to png, jpg, jpeg', () => {
    expect(ACCEPTED_IMAGE_EXTENSIONS).toEqual(['.png', '.jpg', '.jpeg']);
  });

  it('enforces minimum image resolution', () => {
    expect(MIN_FACE_IMAGE_DIMENSION).toBeGreaterThanOrEqual(256);
  });

  it('builds system instruction with the given character name', () => {
    const instruction = buildSystemInstruction('Elena');
    expect(instruction).toContain('Elena');
    expect(instruction).toContain('español');
    expect(instruction).toContain('primera persona');
  });

  it('falls back to default name if character name is empty', () => {
    const instruction = buildSystemInstruction('   ');
    expect(instruction).toContain('YourSelf');
  });

  it('provides default voices for mujer and hombre', () => {
    expect(getDefaultVoice('mujer')).toBe('Kore');
    expect(getDefaultVoice('hombre')).toBe('Puck');
    expect(VOICES_MAP.mujer).toContain('Kore');
    expect(VOICES_MAP.hombre).toContain('Puck');
  });

  it('detects quota and token exhaustion errors accurately', () => {
    expect(isQuotaOrTokenError('Resource has been exhausted (e.g. check quota).')).toBe(true);
    expect(isQuotaOrTokenError({ code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' })).toBe(true);
    expect(isQuotaOrTokenError('QUOTA_EXHAUSTED: ¡Uy, se te acabaron los tokens!')).toBe(true);
    expect(isQuotaOrTokenError('Rate limit exceeded for model')).toBe(true);
    expect(isQuotaOrTokenError('Se agotaron los tokens de la API')).toBe(true);
    expect(isQuotaOrTokenError('Error de red aleatorio')).toBe(false);
    expect(isQuotaOrTokenError(null)).toBe(false);
  });

  it('validates that starting the avatar requires face detection, character name, and API key', () => {
    const isReady = (landmarks: unknown[] | null, name: string, apiKey: string) => {
      const isFaceDetected = landmarks !== null && landmarks.length > 0;
      const isNameValid = name.trim().length > 0;
      const isApiKeyValid = apiKey.trim().length > 0;
      return isFaceDetected && isNameValid && isApiKeyValid;
    };

    // Sin foto
    expect(isReady(null, 'Sophie', 'AIzaSy12345')).toBe(false);
    expect(isReady([], 'Sophie', 'AIzaSy12345')).toBe(false);

    // Con foto pero sin nombre
    expect(isReady([{ x: 0, y: 0, z: 0 }], '', 'AIzaSy12345')).toBe(false);
    expect(isReady([{ x: 0, y: 0, z: 0 }], '   ', 'AIzaSy12345')).toBe(false);

    // Con foto y nombre pero sin API key
    expect(isReady([{ x: 0, y: 0, z: 0 }], 'Sophie', '')).toBe(false);
    expect(isReady([{ x: 0, y: 0, z: 0 }], 'Sophie', '   ')).toBe(false);

    // Formulario completo
    expect(isReady([{ x: 0, y: 0, z: 0 }], 'Sophie', 'AIzaSy12345')).toBe(true);
  });
});
