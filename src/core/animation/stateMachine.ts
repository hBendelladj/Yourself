/**
 * stateMachine.ts
 *
 * Máquina de estados para el comportamiento y expresividad del avatar:
 * - idle: Reposo, respiración sutil, parpadeos aleatorios y mirada natural.
 * - listening: Leve inclinación de cabeza atenta, cejas ligeramente alzadas, mirada centrada.
 * - thinking: Mirada desviada hacia arriba/lateral, leve ladeo meditativo de cabeza.
 * - speaking: Lip-sync dinámico activo, micro-expresiones faciales y modulación rítmica.
 */

import { AvatarMood } from '@/lib/types';

export type StateChangeCallback = (newMood: AvatarMood, previousMood: AvatarMood) => void;

export class AvatarStateMachine {
  private currentMood: AvatarMood = 'idle';
  private listeners: Set<StateChangeCallback> = new Set();

  constructor(initialMood: AvatarMood = 'idle') {
    this.currentMood = initialMood;
  }

  public getMood(): AvatarMood {
    return this.currentMood;
  }

  public transitionTo(newMood: AvatarMood): boolean {
    if (this.currentMood === newMood) return false;

    const prev = this.currentMood;
    this.currentMood = newMood;

    this.listeners.forEach((listener) => {
      try {
        listener(newMood, prev);
      } catch (err) {
        console.error('Error en listener de AvatarStateMachine:', err);
      }
    });

    return true;
  }

  public onStateChange(callback: StateChangeCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }
}
