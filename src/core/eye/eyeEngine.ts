/**
 * eyeEngine.ts
 *
 * Motor Unificado de Ojos y Párpados (Eye & Eyelid Engine - YourSelf V3 - Fase 1 / Sección 9):
 * Orquesta la biomecánica desacoplada ocular:
 * 1. BlinkEngine: Temporización y perfil asimétrico de parpadeo (38% cierre, 62% apertura).
 * 2. EyeBall: Rotación angular pura del globo ocular rígido (gazeX, gazeY) con invarianza total del iris.
 * 3. EyelidMesh: Concha oclusora palpebral esférica 3D que cubre la córnea sin colapsar el iris.
 * - Cero asignaciones en memoria por fotograma.
 */

import * as THREE from 'three';
import { AvatarMood } from '@/lib/types';
import { BlinkEngine, BlinkState } from './blinkEngine';
import { EyeBall, EyeSphereData } from './eyeBall';
import { EyelidMesh } from './eyelidMesh';
import { PhotoProfile } from '@/core/face/photoProfile';

export interface EyeEngineOptions {
  texture: THREE.Texture;
  basePositions: Float32Array;
  faceScale: number;
  profile?: PhotoProfile;
  onBlinkChange?: (isBlinking: boolean) => void;
}

export interface EyeEngineUpdateResult {
  blinkLeft: number;
  blinkRight: number;
  isBlinking: boolean;
  gazeYaw: number;
  gazePitch: number;
}

export class EyeEngine {
  public readonly blinkEngine: BlinkEngine;
  public readonly eyeBall: EyeBall;
  public readonly eyelidMesh: EyelidMesh;

  private readonly result: EyeEngineUpdateResult = {
    blinkLeft: 0,
    blinkRight: 0,
    isBlinking: false,
    gazeYaw: 0,
    gazePitch: 0,
  };

  constructor(options: EyeEngineOptions) {
    this.blinkEngine = new BlinkEngine({
      onBlinkChange: options.onBlinkChange,
    });

    this.eyeBall = new EyeBall({
      basePositions: options.basePositions,
      faceScale: options.faceScale,
    });

    this.eyelidMesh = new EyelidMesh({
      texture: options.texture,
      faceScale: options.faceScale,
      profile: options.profile,
    });
  }

  public setPhotoProfile(profile: PhotoProfile): void {
    this.eyelidMesh.setPhotoProfile(profile);
  }

  /**
   * Actualiza el sistema ocular en el bucle caliente de renderizado:
   * 1. Actualiza temporizador y asimetría de parpadeo.
   * 2. Aplica rotación pura de mirada a los vértices del iris en `currentPositions`.
   * 3. Actualiza la concha oclusora palpebral deslizándose sobre la esfera ocular.
   * Cero asignaciones en memoria.
   */
  public update(
    deltaSeconds: number,
    currentPositions: Float32Array,
    baseUvs: Float32Array,
    gazeX: number,
    gazeY: number,
    faceScale: number,
    mood: AvatarMood = 'idle',
    manualBlinkLeft?: number,
    manualBlinkRight?: number
  ): EyeEngineUpdateResult {
    // 1. Evaluar parpadeo (manual o procedural)
    let blinkLeft = 0;
    let blinkRight = 0;
    let isBlinking = false;

    if (manualBlinkLeft !== undefined || manualBlinkRight !== undefined) {
      blinkLeft = manualBlinkLeft ?? manualBlinkRight ?? 0;
      blinkRight = manualBlinkRight ?? manualBlinkLeft ?? 0;
      isBlinking = Math.max(blinkLeft, blinkRight) > 0.01;
    } else {
      const bState = this.blinkEngine.update(deltaSeconds, mood);
      blinkLeft = bState.blinkLeft;
      blinkRight = bState.blinkRight;
      isBlinking = bState.isBlinking;
    }

    // 2. Mirada: rotación esférica 3D sobre el centro de rotación ocular
    this.eyeBall.updateGaze(gazeX, gazeY);
    this.eyeBall.applyToPositions(currentPositions);

    // 3. Párpados: concha oclusora curva sobre la superficie esférica
    const leftSphere: EyeSphereData = this.eyeBall.getLeftEyeSphere();
    const rightSphere: EyeSphereData = this.eyeBall.getRightEyeSphere();

    this.eyelidMesh.update(
      currentPositions,
      baseUvs,
      blinkLeft,
      blinkRight,
      leftSphere,
      rightSphere,
      gazeY,
      faceScale
    );

    const gazeAngles = this.eyeBall.getGazeAngles();
    this.result.blinkLeft = blinkLeft;
    this.result.blinkRight = blinkRight;
    this.result.isBlinking = isBlinking;
    this.result.gazeYaw = gazeAngles.yaw;
    this.result.gazePitch = gazeAngles.pitch;

    return this.result;
  }

  public triggerBlink(): void {
    this.blinkEngine.triggerBlink();
  }

  public triggerSaccadeBlink(saccadeMagnitude: number): void {
    this.blinkEngine.triggerSaccadeBlink(saccadeMagnitude);
  }

  public destroy(): void {
    this.eyelidMesh.destroy();
  }
}
