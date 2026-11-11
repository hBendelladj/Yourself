/**
 * idleBehavior.ts
 *
 * Genera el comportamiento autónomo del avatar en estado de reposo:
 * 1. Parpadeos programados de duración orgánica (~150 ms) cada 2.5 a 5 s, con doble parpadeo ocasional.
 * 2. Micro-sacadas oculares (movimientos sutiles de la pupila/iris hacia puntos de fijación).
 * 3. Balanceo cefálico armónico suave (yaw, pitch, roll) y respiración continua.
 */

import { AnimationStateManager } from '@/core/animation/animationState';
import { AvatarMood } from '@/lib/types';
import { HeadNoiseController } from './noise';

export class IdleBehaviorController {
  private stateManager: AnimationStateManager;
  public onBlinkChange?: (isBlinking: boolean) => void;
  private headNoise = new HeadNoiseController();
  private rigVersion: 'v1' | 'v2' = 'v1';

  // Estado del parpadeador
  private timeUntilNextBlink = 1.0; // El primer parpadeo ocurre rápido (~1s) para confirmar visualmente la animación
  private blinkTimer = 0; // progreso del parpadeo actual
  private isBlinking = false;
  private isDoubleBlinkQueued = false;
  private readonly blinkDuration = 0.16; // ~160ms para que sea claramente perceptible y suave

  // Estado de las micro-sacadas (gaze)
  private gazeTimer = 0;
  private timeUntilNextSaccade = 1.5;
  private targetGazeX = 0;
  private targetGazeY = 0;

  // Tiempo global para osciladores de balanceo
  private elapsedSeconds = 0;

  constructor(stateManager: AnimationStateManager) {
    this.stateManager = stateManager;
    this.scheduleNextSaccade();
  }

  private scheduleNextBlink(): void {
    // Intervalo aleatorio entre 2.2 y 4.8 segundos
    this.timeUntilNextBlink = 2.2 + Math.random() * 2.6;
  }

  private scheduleNextSaccade(): void {
    // Intervalo de fijación de mirada entre 1.2 y 3.0 segundos
    this.timeUntilNextSaccade = 1.2 + Math.random() * 1.8;

    // Desplazamiento sutil del iris: [-0.18, 0.18]
    this.targetGazeX = (Math.random() - 0.5) * 0.32;
    this.targetGazeY = (Math.random() - 0.5) * 0.2;
  }

  public setRigVersion(version: 'v1' | 'v2'): void {
    this.rigVersion = version;
  }

  public setFrontality(frontality: number): void {
    this.headNoise.frontality = frontality;
  }

  public isCurrentlyBlinking(): boolean {
    return this.isBlinking;
  }

  /**
   * Actualiza el comportamiento idle cada fotograma
   */
  public update(deltaSeconds: number, mood: AvatarMood = 'idle'): void {
    this.elapsedSeconds += deltaSeconds;

    // 1. Manejo del ciclo de parpadeo
    this.updateBlinking(deltaSeconds, mood);

    // 2. Manejo de micro-sacadas de mirada
    this.updateGaze(deltaSeconds, mood);

    // 3. Balanceo cefálico y respiración
    this.updateHeadAndBreathing(deltaSeconds, mood);
  }

  private updateBlinking(deltaSeconds: number, mood: AvatarMood): void {
    if (!this.isBlinking) {
      this.timeUntilNextBlink -= deltaSeconds;

      const blinkThreshold = mood === 'listening' ? -0.4 : 0;

      if (this.timeUntilNextBlink <= blinkThreshold) {
        this.isBlinking = true;
        this.blinkTimer = 0;
        this.onBlinkChange?.(true);
        // ~22% de probabilidad de doble parpadeo
        this.isDoubleBlinkQueued = Math.random() < 0.22;
      }
    } else {
      this.blinkTimer += deltaSeconds;
      const progress = this.blinkTimer / this.blinkDuration;

      if (progress <= 1.0) {
        // Curva senoidal asimétrica para parpadeo natural: cierre rápido (~50ms), apertura gradual (~110ms)
        let blinkVal: number;
        if (progress < 0.32) {
          blinkVal = Math.sin((progress / 0.32) * (Math.PI / 2));
        } else {
          blinkVal = Math.cos(((progress - 0.32) / 0.68) * (Math.PI / 2));
        }
        const clampedBlink = Math.max(0, Math.min(1, blinkVal));
        this.stateManager.setTarget('blink', clampedBlink);
        this.stateManager.setTarget('blinkLeft', clampedBlink);
        this.stateManager.setTarget('blinkRight', clampedBlink);
      } else {
        // Fin del parpadeo actual
        this.stateManager.setTarget('blink', 0);
        this.stateManager.setTarget('blinkLeft', 0);
        this.stateManager.setTarget('blinkRight', 0);
        this.isBlinking = false;
        this.onBlinkChange?.(false);

        if (this.isDoubleBlinkQueued) {
          this.isDoubleBlinkQueued = false;
          // El segundo parpadeo se produce rápidamente (~120ms después)
          this.timeUntilNextBlink = 0.12;
        } else {
          this.scheduleNextBlink();
        }
      }
    }
  }

  private updateGaze(deltaSeconds: number, mood: AvatarMood): void {
    this.gazeTimer += deltaSeconds;

    if (mood === 'thinking') {
      // En modo thinking, la mirada se dirige hacia un lado y arriba
      this.stateManager.setTarget('gazeX', 0.4);
      this.stateManager.setTarget('gazeY', 0.35);
      return;
    }

    if (mood === 'listening') {
      // En modo listening, la mirada está fijada hacia el centro del usuario
      this.stateManager.setTarget('gazeX', 0.0);
      this.stateManager.setTarget('gazeY', 0.03);
      return;
    }

    // Modo idle / speaking: micro-sacadas orgánicas
    if (this.gazeTimer >= this.timeUntilNextSaccade) {
      this.gazeTimer = 0;
      this.scheduleNextSaccade();
    }

    this.stateManager.setTarget('gazeX', this.targetGazeX);
    this.stateManager.setTarget('gazeY', this.targetGazeY);
  }

  private updateHeadAndBreathing(deltaSeconds: number, mood: AvatarMood): void {
    if (this.rigVersion === 'v2') {
      const targets = this.headNoise.update(deltaSeconds, mood);
      let yaw = targets.yaw;
      let pitch = targets.pitch;
      let roll = targets.roll;

      this.stateManager.setTarget('breath', targets.breath);

      // Modulaciones sutiles de pose según el estado conversacional
      if (mood === 'listening') {
        pitch += 0.025;
        roll += 0.02;
        this.stateManager.setTarget('browRaise', 0.20);
        this.stateManager.setTarget('smile', 0.08);
      } else if (mood === 'thinking') {
        pitch -= 0.02;
        roll -= 0.025;
        yaw += 0.035;
        this.stateManager.setTarget('browRaise', 0.12);
        this.stateManager.setTarget('smile', 0.0);
      } else if (mood === 'speaking') {
        this.stateManager.setTarget('browRaise', 0.15);
      } else {
        this.stateManager.setTarget('browRaise', 0.0);
        this.stateManager.setTarget('smile', 0.03);
      }

      this.stateManager.setTarget('headYaw', yaw);
      this.stateManager.setTarget('headPitch', pitch);
      this.stateManager.setTarget('headRoll', roll);
      return;
    }

    // Modo V1: osciladores senoidales clásicos
    const t = this.elapsedSeconds;

    // Respiración continua: ciclo suave de ~3.8 segundos
    const breath = 0.5 + 0.5 * Math.sin(t * 1.65);
    this.stateManager.setTarget('breath', breath);

    // Armónicos para balanceo suave no repetitivo (amplitud amplificada para claridad visual)
    let yaw =
      Math.sin(t * 0.75) * 0.024 +
      Math.sin(t * 0.25 + 1.2) * 0.016;
    let pitch =
      Math.sin(t * 0.95 + 0.5) * 0.02 +
      Math.sin(t * 0.33) * 0.012;
    let roll =
      Math.sin(t * 0.65 + 2.1) * 0.016 +
      Math.sin(t * 0.21) * 0.009;

    // Modulaciones según el estado emocional / mood
    if (mood === 'listening') {
      pitch += 0.03;
      roll += 0.025;
      this.stateManager.setTarget('browRaise', 0.22);
      this.stateManager.setTarget('smile', 0.08);
    } else if (mood === 'thinking') {
      pitch -= 0.025;
      roll -= 0.03;
      yaw += 0.04;
      this.stateManager.setTarget('browRaise', 0.12);
      this.stateManager.setTarget('smile', 0.0);
    } else if (mood === 'speaking') {
      pitch += Math.sin(t * 3.5) * 0.02;
      yaw += Math.cos(t * 2.2) * 0.02;
      this.stateManager.setTarget('browRaise', 0.15);
    } else {
      this.stateManager.setTarget('browRaise', 0.0);
      this.stateManager.setTarget('smile', 0.03);
    }

    this.stateManager.setTarget('headYaw', yaw);
    this.stateManager.setTarget('headPitch', pitch);
    this.stateManager.setTarget('headRoll', roll);
  }

  /**
   * Fuerza un parpadeo inmediato
   */
  public triggerBlink(): void {
    this.isBlinking = true;
    this.blinkTimer = 0;
    this.onBlinkChange?.(true);
  }
}
