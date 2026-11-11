/**
 * voices.ts
 *
 * Mapeo de voces para la Gemini Live API.
 * Nota: La documentación oficial de Gemini describe estas voces por estilos y matices tímbricos,
 * no por género biológico formal. Las agrupamos aquí como guía auditiva inicial ('mujer' y 'hombre').
 * Puedes ajustar o reordenar de oído según la preferencia.
 * El primer elemento de cada arreglo es la voz predeterminada.
 */

import { VoiceGender } from '@/lib/types';

export interface VoiceMetadata {
  id: string;
  label: string;
  styleDescription: string;
}

export const VOICES_MAP: Record<VoiceGender, string[]> = {
  // Kore: Tono cálido, natural, femenino y expresivo
  // Aoede: Tono suave, melódico y claro
  mujer: ['Kore', 'Aoede'],

  // Puck: Tono juvenil, enérgico y dinámico
  // Charon: Tono profundo, sereno y pausado
  hombre: ['Puck', 'Charon'],
};

export const ALL_VOICES_METADATA: Record<string, VoiceMetadata> = {
  Kore: {
    id: 'Kore',
    label: 'Kore (Recomendada Mujer)',
    styleDescription: 'Cálida, expresiva, femenina y fluida',
  },
  Aoede: {
    id: 'Aoede',
    label: 'Aoede',
    styleDescription: 'Suave, melódica y modulada',
  },
  Puck: {
    id: 'Puck',
    label: 'Puck (Recomendada Hombre)',
    styleDescription: 'Juvenil, enérgica y articulada',
  },
  Charon: {
    id: 'Charon',
    label: 'Charon',
    styleDescription: 'Profunda, reflexiva y calmada',
  },
  Fenrir: {
    id: 'Fenrir',
    label: 'Fenrir',
    styleDescription: 'Firme, autoritaria y directa',
  },
  Zephyr: {
    id: 'Zephyr',
    label: 'Zephyr',
    styleDescription: 'Ligera, aireada y amable',
  },
};

export function getDefaultVoice(gender: VoiceGender): string {
  const list = VOICES_MAP[gender];
  return list[0] ?? (gender === 'mujer' ? 'Kore' : 'Puck');
}
