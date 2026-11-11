/**
 * gaze.ts
 *
 * Controlador de fijación de mirada, sacadas oculares y acoplamiento cabeza-ojos (Fase 4 / Sección 7.10):
 * - Períodos de fijación de 200–1000 ms con sacadas balísticas ágiles.
 * - ~65% del tiempo orientado hacia la cámara / `gazeTarget`.
 * - Comportamiento diferenciado por estado (deriva activa en `thinking`, aversión breve al iniciar habla,
 *   enfoque estable en `listening`).
 * - Acoplamiento cinemático ojo-cabeza: una sacada grande (> 0.22) dispara un giro cefálico en la
 *   misma dirección (35%–50% de la sacada) tras un retraso fisiológico de 80–150 ms.
 * - Disparador de parpadeo por sacada grande (~60% probabilidad).
 * - Cero asignaciones dinámicas por fotograma.
 */

import { AvatarMood } from '@/lib/types';
import { BlinkController } from './blink';

export interface GazeTargets {
  gazeX: number;
  gazeY: number;
  coupledHeadYaw: number;
  coupledHeadPitch: number;
}

interface DelayedHeadTurn {
  active: boolean;
  delayRemaining: number;
  yawDelta: number;
  pitchDelta: number;
}

export class GazeController {
  // Parámetros de control VASA-1
  public gazeTarget: [number, number] = [0, 0];

  // Estado instantáneo
  private currentGazeX = 0;
  private currentGazeY = 0;
  private targetGazeX = 0;
  private targetGazeY = 0;

  // Giros de cabeza acoplados
  private coupledYaw = 0;
  private coupledPitch = 0;
  private delayedTurn: DelayedHeadTurn = {
    active: false,
    delayRemaining: 0,
    yawDelta: 0,
    pitchDelta: 0,
  };

  // Temporizadores
  private fixationTimer = 0;
  private currentFixationDuration = 0.8;
  private previousMood: AvatarMood = 'idle';

  // Objeto de salida preasignado
  public targets: GazeTargets = {
    gazeX: 0,
    gazeY: 0,
    coupledHeadYaw: 0,
    coupledHeadPitch: 0,
  };

  // Parámetros de la Secuencia Principal de Bahill et al. (1975)
  private isSaccading = false;
  private saccadeTimer = 0;
  private saccadeDuration = 0.04; // s
  private saccadeStartX = 0;
  private saccadeStartY = 0;

  public onSaccade?: (magnitude: number) => void;
  private blinkController?: BlinkController;

  /**
   * Modelo de Secuencia Principal de Bahill et al. (1975) para sacadas oculares:
   * V_peak = V_max * (1 - exp(-A / C)) con V_max = 500 °/s, C = 10°
   * D = 21 + 2.2 * A (ms)
   */
  public static computeMainSequence(amplitudeDeg: number): { durationMs: number; peakVelocityDegPerSec: number } {
    const A = Math.max(0.5, Math.min(30.0, amplitudeDeg));
    const Vmax = 500.0;
    const C = 10.0;
    const peakVelocityDegPerSec = Vmax * (1.0 - Math.exp(-A / C));
    const durationMs = 21.0 + 2.2 * A;
    return { durationMs, peakVelocityDegPerSec };
  }

  constructor(blinkController?: BlinkController) {
    this.blinkController = blinkController;
    this.scheduleNextFixation('idle');
  }

  public setBlinkController(controller: BlinkController): void {
    this.blinkController = controller;
  }

  /**
   * Programa la siguiente fijación ocular según el estado conversacional
   */
  private scheduleNextFixation(mood: AvatarMood): void {
    this.fixationTimer = 0;

    if (mood === 'thinking') {
      // En thinking la duración es más larga y vaga
      this.currentFixationDuration = 0.6 + Math.random() * 0.9;
      // Deriva hacia cuadrante superior lateral con variación
      const side = Math.random() < 0.65 ? 1 : -1;
      this.targetGazeX = side * (0.25 + Math.random() * 0.20);
      this.targetGazeY = 0.18 + Math.random() * 0.22;
      return;
    }

    if (mood === 'listening') {
      // En listening: 80% del tiempo a la cámara, 20% aversiones breves
      if (Math.random() < 0.80) {
        this.currentFixationDuration = 0.8 + Math.random() * 1.4;
        this.targetGazeX = this.gazeTarget[0] + (Math.random() - 0.5) * 0.06;
        this.targetGazeY = this.gazeTarget[1] + (Math.random() - 0.5) * 0.05;
      } else {
        // Breve mirada a un lado
        this.currentFixationDuration = 0.25 + Math.random() * 0.35;
        this.targetGazeX = (Math.random() - 0.5) * 0.22;
        this.targetGazeY = (Math.random() - 0.5) * 0.14;
      }
      return;
    }

    // Modo idle / speaking
    this.currentFixationDuration = 0.35 + Math.random() * 0.9;

    // ~65% del tiempo hacia la cámara/gazeTarget
    if (Math.random() < 0.65) {
      this.targetGazeX = this.gazeTarget[0] + (Math.random() - 0.5) * 0.08;
      this.targetGazeY = this.gazeTarget[1] + (Math.random() - 0.5) * 0.06;
    } else {
      // Sacada exploratoria más amplia
      this.targetGazeX = (Math.random() - 0.5) * 0.45;
      this.targetGazeY = (Math.random() - 0.5) * 0.30;
    }

    // Evaluar acoplamiento ojo-cabeza ante sacadas grandes
    const deltaX = this.targetGazeX - this.currentGazeX;
    const deltaY = this.targetGazeY - this.currentGazeY;
    const magnitude = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    this.saccadeStartX = this.currentGazeX;
    this.saccadeStartY = this.currentGazeY;
    const ampDeg = magnitude * 40.0;
    const ms = GazeController.computeMainSequence(ampDeg);
    this.saccadeDuration = Math.max(0.025, ms.durationMs / 1000.0);
    this.saccadeTimer = 0;
    this.isSaccading = true;

    if (magnitude > 0.18) {
      // Retraso biológico de 80 a 150 ms antes de que la cabeza acompañe
      this.delayedTurn.active = true;
      this.delayedTurn.delayRemaining = 0.08 + Math.random() * 0.07;
      // Giro de cabeza del 35% al 45% de la sacada
      this.delayedTurn.yawDelta = deltaX * 0.40;
      this.delayedTurn.pitchDelta = deltaY * 0.35;

      // Disparador de parpadeo asociado a sacada
      this.onSaccade?.(magnitude);
      this.blinkController?.triggerSaccadeBlink(magnitude);
    }
  }

  /**
   * Fuerza explícitamente una sacada ocular hacia un punto dado
   */
  public triggerSaccade(targetX: number, targetY: number): void {
    const deltaX = targetX - this.currentGazeX;
    const deltaY = targetY - this.currentGazeY;
    const magnitude = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    this.targetGazeX = targetX;
    this.targetGazeY = targetY;
    this.fixationTimer = 0;
    this.currentFixationDuration = 0.6;

    this.saccadeStartX = this.currentGazeX;
    this.saccadeStartY = this.currentGazeY;
    const ampDeg = magnitude * 40.0;
    const ms = GazeController.computeMainSequence(ampDeg);
    this.saccadeDuration = Math.max(0.025, ms.durationMs / 1000.0);
    this.saccadeTimer = 0;
    this.isSaccading = true;

    if (magnitude > 0.18) {
      this.delayedTurn.active = true;
      this.delayedTurn.delayRemaining = 0.08;
      this.delayedTurn.yawDelta = deltaX * 0.40;
      this.delayedTurn.pitchDelta = deltaY * 0.35;
      this.onSaccade?.(magnitude);
      this.blinkController?.triggerSaccadeBlink(magnitude);
    }
  }

  /**
   * Actualiza el estado de la mirada en cada fotograma
   */
  public update(deltaSeconds: number, mood: AvatarMood = 'idle'): GazeTargets {
    // Detectar retorno desde 'thinking' al interlocutor (cámara) con parpadeo reflejo
    if (this.previousMood === 'thinking' && mood !== 'thinking') {
      this.targetGazeX = this.gazeTarget[0];
      this.targetGazeY = this.gazeTarget[1];
      this.currentFixationDuration = 0.8;
      this.fixationTimer = 0;

      const deltaX = this.targetGazeX - this.currentGazeX;
      const deltaY = this.targetGazeY - this.currentGazeY;
      const mag = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      if (mag > 0.18) {
        this.onSaccade?.(mag);
        this.blinkController?.triggerSaccadeBlink(mag);
      }
    } else if (mood === 'thinking' && this.previousMood !== 'thinking') {
      this.scheduleNextFixation('thinking');
    } else if (mood === 'speaking' && this.previousMood !== 'speaking') {
      // Aversión inicial natural breve al comenzar a hablar
      this.targetGazeX = (Math.random() < 0.5 ? 1 : -1) * 0.20;
      this.targetGazeY = -0.10;
      this.currentFixationDuration = 0.35;
      this.fixationTimer = 0;
    }
    this.previousMood = mood;

    this.fixationTimer += deltaSeconds;
    if (this.fixationTimer >= this.currentFixationDuration) {
      this.scheduleNextFixation(mood);
    }

    // Trayectoria asimétrica de la secuencia principal (Bahill et al., 1975)
    if (this.isSaccading) {
      this.saccadeTimer += deltaSeconds;
      const p = Math.min(1.0, this.saccadeTimer / this.saccadeDuration);
      const progress = (1.0 - Math.exp(-6.0 * Math.pow(p, 1.35))) / (1.0 - Math.exp(-6.0));
      this.currentGazeX = this.saccadeStartX + (this.targetGazeX - this.saccadeStartX) * progress;
      this.currentGazeY = this.saccadeStartY + (this.targetGazeY - this.saccadeStartY) * progress;
      if (p >= 1.0) {
        this.isSaccading = false;
      }
    } else {
      const kGaze = 22.0;
      const alphaGaze = 1.0 - Math.exp(-kGaze * deltaSeconds);
      this.currentGazeX += (this.targetGazeX - this.currentGazeX) * alphaGaze;
      this.currentGazeY += (this.targetGazeY - this.currentGazeY) * alphaGaze;
    }

    // Procesar giro cefálico retardado acoplado
    if (this.delayedTurn.active) {
      this.delayedTurn.delayRemaining -= deltaSeconds;
      if (this.delayedTurn.delayRemaining <= 0) {
        this.delayedTurn.active = false;
        this.coupledYaw = this.delayedTurn.yawDelta;
        this.coupledPitch = this.delayedTurn.pitchDelta;
      }
    }

    // Decaimiento suave del giro cefálico acoplado hacia el centro
    const kHeadDecay = 2.5;
    const alphaHead = 1.0 - Math.exp(-kHeadDecay * deltaSeconds);
    this.coupledYaw += (0 - this.coupledYaw) * alphaHead;
    this.coupledPitch += (0 - this.coupledPitch) * alphaHead;

    this.targets.gazeX = this.currentGazeX;
    this.targets.gazeY = this.currentGazeY;
    this.targets.coupledHeadYaw = this.coupledYaw;
    this.targets.coupledHeadPitch = this.coupledPitch;

    return this.targets;
  }
}
