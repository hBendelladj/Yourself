/**
 * actions.ts
 *
 * Biblioteca de acciones y gestos por keyframes procedurales (Fase 4 / Sección 7.13 - LiveTalking):
 * - Acciones expresivas: `nod`, `nodDouble`, `tiltCurious`, `browFlash`, `smileSoft`,
 *   `smileBig`, `laughShort`, `thinkLookAway`, `surprise`, `emphaticBlink`.
 * - Curvas de interpolación suaves (sinusoides y cúbicas) sin discontinuidades.
 * - Mezcla aditiva con las capas base del rig.
 * - Sistema de prioridades y cancelación instantánea (`cancelAll` / `flush`) al interrumpir.
 * - Cero asignaciones dinámicas por fotograma mediante pool estático de acciones activas.
 */

export type ActionId =
  | 'nod'
  | 'nodDouble'
  | 'tiltCurious'
  | 'browFlash'
  | 'smileSoft'
  | 'smileBig'
  | 'laughShort'
  | 'thinkLookAway'
  | 'surprise'
  | 'emphaticBlink';

export interface ActionOffsets {
  headPitch: number;
  headYaw: number;
  headRoll: number;
  gazeX: number;
  gazeY: number;
  browRaise: number;
  smile: number;
  jawOpen: number;
  cheekRaise: number;
  eyeSquint: number;
  browInnerUp: number;
  browOuterUp: number;
  browDown: number;
  mouthDimple: number;
}

interface ActionSlot {
  active: boolean;
  id: ActionId;
  elapsed: number;
  duration: number;
  scale: number;
  priority: number;
}

const ACTION_DURATIONS: Record<ActionId, number> = {
  nod: 0.65,
  nodDouble: 0.95,
  tiltCurious: 1.20,
  browFlash: 0.40,
  smileSoft: 1.50,
  smileBig: 2.00,
  laughShort: 1.25,
  thinkLookAway: 1.80,
  surprise: 0.85,
  emphaticBlink: 0.20,
};

const ACTION_PRIORITIES: Record<ActionId, number> = {
  emphaticBlink: 5,
  surprise: 4,
  laughShort: 4,
  browFlash: 3,
  nodDouble: 3,
  nod: 2,
  tiltCurious: 2,
  thinkLookAway: 2,
  smileBig: 2,
  smileSoft: 1,
};

export class ActionController {
  private readonly maxActiveActions = 8;
  private slots: ActionSlot[];
  public onBlinkTrigger?: () => void;

  // Objeto de salida preasignado para cero allocations en el bucle
  public offsets: ActionOffsets = {
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
    gazeX: 0,
    gazeY: 0,
    browRaise: 0,
    smile: 0,
    jawOpen: 0,
    cheekRaise: 0,
    eyeSquint: 0,
    browInnerUp: 0,
    browOuterUp: 0,
    browDown: 0,
    mouthDimple: 0,
  };

  constructor() {
    this.slots = [];
    for (let i = 0; i < this.maxActiveActions; i++) {
      this.slots.push({
        active: false,
        id: 'nod',
        elapsed: 0,
        duration: 0.65,
        scale: 1.0,
        priority: 1,
      });
    }
  }

  /**
   * Dispara una acción por identificador con escala de intensidad opcional
   */
  public trigger(id: ActionId, scale = 1.0): void {
    if (id === 'emphaticBlink') {
      this.onBlinkTrigger?.();
      return;
    }

    const priority = ACTION_PRIORITIES[id];
    const duration = ACTION_DURATIONS[id];

    // Buscar una ranura libre o reemplazar una de menor prioridad
    let targetSlot: ActionSlot | null = null;
    let lowestPrioritySlot: ActionSlot | null = null;
    let lowestPriority = priority;

    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      if (!slot.active) {
        targetSlot = slot;
        break;
      }
      // Si la misma acción ya está activa, reiniciar su temporizador
      if (slot.id === id) {
        slot.elapsed = 0;
        slot.scale = Math.max(slot.scale, scale);
        return;
      }
      if (slot.priority < lowestPriority) {
        lowestPriority = slot.priority;
        lowestPrioritySlot = slot;
      }
    }

    if (!targetSlot && lowestPrioritySlot) {
      targetSlot = lowestPrioritySlot;
    }

    if (targetSlot) {
      targetSlot.active = true;
      targetSlot.id = id;
      targetSlot.elapsed = 0;
      targetSlot.duration = duration;
      targetSlot.scale = scale;
      targetSlot.priority = priority;
    }
  }

  /**
   * Cancela inmediatamente todas las acciones en curso (ej. evento `interrupted`)
   */
  public cancelAll(): void {
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i]!.active = false;
    }
    this.clearOffsets();
  }

  public hasActiveActions(): boolean {
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i]!.active) return true;
    }
    return false;
  }

  private clearOffsets(): void {
    this.offsets.headPitch = 0;
    this.offsets.headYaw = 0;
    this.offsets.headRoll = 0;
    this.offsets.gazeX = 0;
    this.offsets.gazeY = 0;
    this.offsets.browRaise = 0;
    this.offsets.smile = 0;
    this.offsets.jawOpen = 0;
    this.offsets.cheekRaise = 0;
    this.offsets.eyeSquint = 0;
    this.offsets.browInnerUp = 0;
    this.offsets.browOuterUp = 0;
    this.offsets.browDown = 0;
    this.offsets.mouthDimple = 0;
  }

  /**
   * Actualiza el progreso de todas las acciones activas y computa los offsets acumulados
   */
  public update(deltaSeconds: number): ActionOffsets {
    this.clearOffsets();

    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      if (!slot.active) continue;

      slot.elapsed += deltaSeconds;
      const progress = slot.elapsed / slot.duration;

      if (progress >= 1.0) {
        slot.active = false;
        continue;
      }

      this.evaluateAction(slot.id, progress, slot.scale);
    }

    return this.offsets;
  }

  /**
   * Evalúa las curvas de keyframes paramétricas para cada acción
   */
  private evaluateAction(id: ActionId, t: number, scale: number): void {
    // t en [0, 1]
    switch (id) {
      case 'nod': {
        // Asentimiento simple: cabeza baja y sube suavemente (sinusoidal negativa)
        const curve = -Math.sin(t * Math.PI) * 0.08 * scale;
        this.offsets.headPitch += curve;
        break;
      }

      case 'nodDouble': {
        // Doble cabeceo: dos pulsos senoidales descendentes
        const curve = -Math.sin(t * 2.0 * Math.PI) * 0.065 * (1.0 - t * 0.3) * scale;
        this.offsets.headPitch += curve;
        break;
      }

      case 'tiltCurious': {
        // Ladeo curioso: cabeza gira lateralmente (roll) con ceja sutil
        const rollCurve = Math.sin(t * Math.PI) * 0.07 * scale;
        const browCurve = Math.sin(t * Math.PI) * 0.18 * scale;
        this.offsets.headRoll += rollCurve;
        this.offsets.headPitch += rollCurve * -0.3;
        this.offsets.browRaise += browCurve;
        this.offsets.browOuterUp += browCurve * 0.8;
        break;
      }

      case 'browFlash': {
        // Parpadeo rápido de cejas: subida y bajada ágil (~400 ms)
        const curve = Math.sin(t * Math.PI) * 0.38 * scale;
        this.offsets.browRaise += curve;
        this.offsets.browInnerUp += curve * 0.7;
        this.offsets.browOuterUp += curve * 0.9;
        break;
      }

      case 'smileSoft': {
        // Sonrisa suave: campana de Gauss/seno suave
        const curve = Math.sin(t * Math.PI) * 0.32 * scale;
        this.offsets.smile += curve;
        this.offsets.cheekRaise += curve * 0.5;
        this.offsets.mouthDimple += curve * 0.4;
        break;
      }

      case 'smileBig': {
        // Sonrisa amplia: mayor apertura y elevación de mejillas
        const curve = Math.sin(t * Math.PI) * 0.65 * scale;
        this.offsets.smile += curve;
        this.offsets.cheekRaise += curve * 0.65;
        this.offsets.eyeSquint += curve * 0.35;
        this.offsets.mouthDimple += curve * 0.5;
        break;
      }

      case 'laughShort': {
        // Risa breve: oscilación rítmica en mandíbula y mejillas
        const envelope = Math.sin(t * Math.PI);
        const chuckle = Math.max(0, Math.sin(t * 5.0 * Math.PI)) * 0.12 * envelope * scale;
        this.offsets.jawOpen += chuckle;
        this.offsets.smile += 0.55 * envelope * scale;
        this.offsets.cheekRaise += 0.45 * envelope * scale;
        this.offsets.eyeSquint += 0.30 * envelope * scale;
        this.offsets.headPitch += chuckle * -0.2;
        break;
      }

      case 'thinkLookAway': {
        // Mirada reflexiva: ojos y cabeza van hacia un lado y arriba
        const curve = Math.sin(t * Math.PI) * scale;
        this.offsets.gazeX += 0.35 * curve;
        this.offsets.gazeY += 0.25 * curve;
        this.offsets.headYaw += 0.05 * curve;
        this.offsets.headPitch += -0.04 * curve;
        this.offsets.browDown += 0.20 * curve;
        break;
      }

      case 'surprise': {
        // Sorpresa: cejas arriba, mandíbula ligeramente caída, ojos abiertos
        const curve = Math.sin(t * Math.PI) * scale;
        this.offsets.browRaise += 0.50 * curve;
        this.offsets.browInnerUp += 0.55 * curve;
        this.offsets.browOuterUp += 0.60 * curve;
        this.offsets.jawOpen += 0.10 * curve;
        this.offsets.headPitch += -0.05 * curve;
        break;
      }
    }
  }
}
