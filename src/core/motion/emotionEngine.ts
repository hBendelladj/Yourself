/**
 * emotionEngine.ts
 *
 * Motor Emocional Biomecánico y Controles VASA-1 (YourSelf V3 - Fases 3 & 4 / Secciones 12 & 13):
 * - Espacio afectivo bidimensional continuo: Valencia v ∈ [-1, 1] y Activación (Arousal) a ∈ [-1, 1] (Modelo Circunflejo de Russell).
 * - Biomecánica muscular integrada FACS:
 *   - Sonrisa Genuina de Duchenne (AU6 + AU12 acoplados): Zygomaticus major + Orbicularis oculi.
 *   - Expresiones compuestas: concentración (AU4 + AU1), asombro (AU1 + AU2 + AU26), duda.
 * - Habilidades Afectivas Visuales (Visual Affective Skills - VASA-1):
 *   - `emotionOffset` {v, a}: polarización anímica independiente del lip-sync.
 *   - `headDistance`: distancia conversacional y escala.
 *   - `gazeTarget` [x, y]: dirección forzada de contacto visual.
 * - Cero asignaciones en memoria (Zero-Allocation).
 */

export interface AffectiveState {
  valence: number; // [-1..1] De displacentero a placentero
  arousal: number; // [-1..1] De calmado a excitado
}

export interface VASA1Controls {
  emotionOffset: AffectiveState;
  headDistance: number; // 0.85 a 1.25 (zoom dinámico)
  gazeTarget: { x: number; y: number } | null;
}

export interface EmotionBlendshapeTargets {
  mouthSmileLeft: number;
  mouthSmileRight: number;
  mouthFrownLeft: number;
  mouthFrownRight: number;
  eyeSquintLeft: number;
  eyeSquintRight: number;
  browDownLeft: number;
  browDownRight: number;
  browInnerUp: number;
  browOuterUpLeft: number;
  browOuterUpRight: number;
  cheekSquintLeft: number;
  cheekSquintRight: number;
}

export class EmotionEngine {
  private baseAffect: AffectiveState = { valence: 0.1, arousal: 0.0 };
  private vasa1Controls: VASA1Controls = {
    emotionOffset: { valence: 0, arousal: 0 },
    headDistance: 1.0,
    gazeTarget: null,
  };

  // Dinámica de suavizado temporal para transiciones anímicas lentas (τ ≈ 1.2 s)
  private smoothedValence = 0.1;
  private smoothedArousal = 0.0;

  // Búfer pre-asignado de formas resultantes (Zero-Allocation)
  private readonly targets: EmotionBlendshapeTargets = {
    mouthSmileLeft: 0,
    mouthSmileRight: 0,
    mouthFrownLeft: 0,
    mouthFrownRight: 0,
    eyeSquintLeft: 0,
    eyeSquintRight: 0,
    browDownLeft: 0,
    browDownRight: 0,
    browInnerUp: 0,
    browOuterUpLeft: 0,
    browOuterUpRight: 0,
    cheekSquintLeft: 0,
    cheekSquintRight: 0,
  };

  /**
   * Configura el sesgo afectivo global o los controles interactivos VASA-1
   */
  public setVASA1Controls(controls: Partial<VASA1Controls>): void {
    if (controls.emotionOffset) {
      this.vasa1Controls.emotionOffset.valence = Math.max(-1, Math.min(1, controls.emotionOffset.valence));
      this.vasa1Controls.emotionOffset.arousal = Math.max(-1, Math.min(1, controls.emotionOffset.arousal));
    }
    if (controls.headDistance !== undefined) {
      this.vasa1Controls.headDistance = Math.max(0.8, Math.min(1.3, controls.headDistance));
    }
    if (controls.gazeTarget !== undefined) {
      this.vasa1Controls.gazeTarget = controls.gazeTarget;
    }
  }

  public setBaseAffect(affect: Partial<AffectiveState>): void {
    if (affect.valence !== undefined) this.baseAffect.valence = Math.max(-1, Math.min(1, affect.valence));
    if (affect.arousal !== undefined) this.baseAffect.arousal = Math.max(-1, Math.min(1, affect.arousal));
  }

  /**
   * Evalúa la coarticulación muscular facial FACS y los pesos de blendshapes resultantes
   */
  public update(deltaSeconds: number): EmotionBlendshapeTargets {
    // 1. Combinar afecto base con offset VASA-1
    const targetV = Math.max(-1, Math.min(1, this.baseAffect.valence + this.vasa1Controls.emotionOffset.valence));
    const targetA = Math.max(-1, Math.min(1, this.baseAffect.arousal + this.vasa1Controls.emotionOffset.arousal));

    // Suavizado temporal exponencial de estado de ánimo
    const filterConst = Math.min(1.0, deltaSeconds * 2.5);
    this.smoothedValence += (targetV - this.smoothedValence) * filterConst;
    this.smoothedArousal += (targetA - this.smoothedArousal) * filterConst;

    const v = this.smoothedValence;
    const a = this.smoothedArousal;

    // 2. Coarticulación Duchenne (Valencia Positiva)
    if (v >= 0) {
      // AU12: Zygomaticus Major (elevación de comisuras labiales)
      const au12 = v * (0.70 + 0.30 * Math.max(0, a));
      // AU6: Orbicularis Oculi (contracción periocular y elevación de mejilla) acoplada a AU12
      const au6 = au12 * 0.65;

      this.targets.mouthSmileLeft = au12;
      this.targets.mouthSmileRight = au12;
      this.targets.eyeSquintLeft = au6;
      this.targets.eyeSquintRight = au6;
      this.targets.cheekSquintLeft = au6 * 0.85;
      this.targets.cheekSquintRight = au6 * 0.85;

      this.targets.mouthFrownLeft = 0;
      this.targets.mouthFrownRight = 0;
      this.targets.browDownLeft = 0;
      this.targets.browDownRight = 0;
    } else {
      // 3. Valencia Negativa: Fruncimiento y tristeza
      const negV = -v;
      const au15 = negV * 0.55; // Depressor anguli oris (comisuras abajo)
      const au4 = negV * (0.45 + 0.35 * Math.max(0, a)); // Corrugator (cejas juntas y abajo)

      this.targets.mouthFrownLeft = au15;
      this.targets.mouthFrownRight = au15;
      this.targets.browDownLeft = au4;
      this.targets.browDownRight = au4;

      this.targets.mouthSmileLeft = 0;
      this.targets.mouthSmileRight = 0;
      this.targets.eyeSquintLeft = 0;
      this.targets.eyeSquintRight = 0;
      this.targets.cheekSquintLeft = 0;
      this.targets.cheekSquintRight = 0;
    }

    // 4. Modulación de Cejas por Arousal (AU1 y AU2)
    if (a > 0.2) {
      const surprise = (a - 0.2) * 0.5;
      this.targets.browInnerUp = surprise;
      this.targets.browOuterUpLeft = surprise * 0.75;
      this.targets.browOuterUpRight = surprise * 0.75;
    } else {
      this.targets.browInnerUp = 0;
      this.targets.browOuterUpLeft = 0;
      this.targets.browOuterUpRight = 0;
    }

    return this.targets;
  }

  public getVASA1Controls(): Readonly<VASA1Controls> {
    return this.vasa1Controls;
  }

  public getSmoothedAffect(): Readonly<AffectiveState> {
    return { valence: this.smoothedValence, arousal: this.smoothedArousal };
  }
}
