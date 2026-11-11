/**
 * constants.ts
 * Constantes de configuración, validaciones y modelos.
 */

export const DEFAULT_LIVE_MODEL =
  (import.meta.env.VITE_GEMINI_LIVE_MODEL as string | undefined) ||
  'gemini-2.5-flash-native-audio-latest';

export const SUPPORTED_MODELS = [
  'gemini-2.5-flash-native-audio-latest',
  'gemini-live-2.5-flash-preview',
  'gemini-2.5-flash-native-audio-preview-12-2025',
  'gemini-2.5-flash-preview-native-audio-dialog',
  'gemini-2.5-flash',
  'gemini-2.0-flash-exp',
] as const;

export const MAX_IMAGE_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB

export const ACCEPTED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
];

export const ACCEPTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg'];

export const MIN_FACE_IMAGE_DIMENSION = 256; // pixels
