/**
 * animationState.ts
 *
 * Mantiene y suaviza los valores de todos los canales de animación (poses y visemas)
 * aplicando curvas de ataque (attack) y liberación (release) diferenciadas.
 * También define la interfaz EmotionSource para futuras extensiones de control de emociones.
 */

export interface PoseValues {
  // Párpados
  blink: number; // 0 (abierto) a 1 (cerrado)
  blinkLeft: number;
  blinkRight: number;

  // Mirada (Gaze)
  gazeX: number; // -1 (izquierda) a 1 (derecha)
  gazeY: number; // -1 (abajo) a 1 (arriba)

  // Boca y Habla
  jawOpen: number; // 0 (cerrado) a 1 (máxima apertura)
  mouthRound: number; // 0 a 1 ("o/u")
  mouthWide: number; // 0 a 1 ("e/i")
  smile: number; // 0 a 1

  // Cejas
  browRaise: number; // 0 (reposo) a 1 (levantadas)

  // Postura y Cabeza (en radianes / normalizado)
  headYaw: number; // rotación horizontal
  headPitch: number; // inclinación vertical
  headRoll: number; // ladeo lateral
  breath: number; // 0 a 1 (ciclo respiratorio)
}

/**
 * Interfaz para control futuro de emociones por parte del modelo Gemini Live
 * (a través de llamadas de herramientas o tags de emoción).
 */
export interface EmotionSource {
  getEmotionValues(): Partial<Pick<PoseValues, 'smile' | 'browRaise'>>;
}

import { DynamicsController } from './dynamics';

export class AnimationStateManager {
  public current: PoseValues;
  public target: PoseValues;
  private dynamics: DynamicsController;

  constructor() {
    const initial: PoseValues = {
      blink: 0,
      blinkLeft: 0,
      blinkRight: 0,
      gazeX: 0,
      gazeY: 0,
      jawOpen: 0,
      mouthRound: 0,
      mouthWide: 0,
      smile: 0,
      browRaise: 0,
      headYaw: 0,
      headPitch: 0,
      headRoll: 0,
      breath: 0,
    };

    this.current = { ...initial };
    this.target = { ...initial };
    this.dynamics = new DynamicsController();
  }

  /**
   * Suaviza todos los canales de animación hacia su objetivo usando resortes críticamente amortiguados (V2)
   * @param deltaSeconds tiempo transcurrido desde el último fotograma
   */
  public update(deltaSeconds: number): void {
    this.dynamics.update(deltaSeconds, this.current);
  }

  public setTarget<K extends keyof PoseValues>(key: K, value: number): void {
    this.target[key] = value;
    this.dynamics.setTarget(key, value);
  }

  public resetAll(): void {
    const keys = Object.keys(this.current) as Array<keyof PoseValues>;
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k]!;
      this.target[key] = 0;
    }
    this.dynamics.resetAll(this.current);
  }
}
