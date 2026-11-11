/**
 * director.ts
 *
 * Director Orquestador Multicapa (Fase 4 / Sección 7.7 - Hallo / VASA-1 / LiveTalking):
 * - Tres capas desacopladas con intensidades (`layerGain.lips/expression/pose` [0..2.0]):
 *   1. LABIOS (rápida, 30–38 rad/s): VisemeScheduler + fallback espectral.
 *   2. EXPRESIÓN (media, 8–12 rad/s): Espacio continuo (valence/arousal) + micro-expresiones
 *      (parpadeo de cejas cada 4–9 s, asimetría de sonrisa, acoplamiento Duchenne).
 *   3. POSE (lenta, 3–5 rad/s): Ruido fBm (yaw/pitch/roll), mirada con sacadas balísticas,
 *      acoplamiento ojo-cabeza y cabeceos de escucha activa (back-channel).
 * - Controles tipo VASA-1: `gazeTarget` [x, y], `headDistance` (0.97..1.03), `emotionOffset` {v, a}.
 * - Biblioteca de acciones integradas (`nod`, `nodDouble`, `tiltCurious`, `browFlash`, etc.).
 * - Cancelación instantánea y vaciado de colas (`onInterrupted` / `flush`).
 * - Cero asignaciones dinámicas por fotograma.
 */

import { AvatarMood } from '@/lib/types';
import { PoseValues } from './animationState';
import { BlinkController } from './blink';
import { EmotionEstimator, EmotionState } from './emotion';
import { ActionController, ActionId, ActionOffsets } from './actions';
import { GazeController } from './gaze';
import { HeadNoiseController } from './noise';
import { VisemeScheduler, VisemeRigTargets } from '../audio/visemeScheduler';
import { VisemeWeights } from '../audio/lipsyncAnalyzer';
import { ProsodyFeatures, ProsodyAnalyzer } from '../audio/prosodyAnalyzer';

export interface LayerGains {
  lips: number;
  expression: number;
  pose: number;
}

export interface SpeechGains {
  jawGain: number;          // Escala de apertura mandibular (0.5 .. 2.0, default 1.0)
  bilabialTightness: number; // Fuerza de sellado bilabial (0.5 .. 2.0, default 1.0)
}

export interface DirectorConfig {
  blinkController?: BlinkController;
  visemeScheduler?: VisemeScheduler;
  prosodyAnalyzer?: ProsodyAnalyzer;
  frontality?: number;
}

export interface DirectorOutput {
  poseTargets: PoseValues;
  extraShapes: Record<string, number>;
  headDistance: number;
}

export class Director {
  // Capas y ganancias (Sección 7.7)
  public layerGains: LayerGains = {
    lips: 1.0,
    expression: 1.0,
    pose: 1.0,
  };

  // Parámetros específicos de articulación y habla (Fase A)
  public speechGains: SpeechGains = {
    jawGain: 1.0,
    bilabialTightness: 1.0,
  };

  // Controles tipo VASA-1
  public gazeTarget: [number, number] = [0, 0];
  public headDistance = 1.0; // [0.97 .. 1.03]
  public emotionOffset: EmotionState = { valence: 0.0, arousal: 0.0 };

  // Sub-controladores
  public emotion: EmotionEstimator;
  public actions: ActionController;
  public gaze: GazeController;
  public headNoise: HeadNoiseController;
  public prosody: ProsodyAnalyzer;

  private blinkController?: BlinkController;
  private visemeScheduler?: VisemeScheduler;

  // Estado conversacional
  private currentMood: AvatarMood = 'idle';

  // Temporizadores para micro-expresiones y back-channel
  private browFlashTimer = 5.0; // Cada 4 a 9 s durante el habla
  private prosodyBrowFlashCooldown = 0.0;
  private userSilenceTimer = 0.0;
  private lastBackChannelNodTime = 0.0;
  private totalElapsedSeconds = 0.0;

  // Objetos de salida preasignados para cero allocations
  private poseTargets: PoseValues = {
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

  private extraShapes: Record<string, number> = {
    mouthClose: 0,
    mouthPressLips: 0,
    lowerLipTuck: 0,
    mouthFunnel: 0,
    mouthPucker: 0,
    mouthSmileLeft: 0,
    mouthSmileRight: 0,
    mouthDimpleLeft: 0,
    mouthDimpleRight: 0,
    mouthFrownLeft: 0,
    mouthFrownRight: 0,
    cheekRaiseLeft: 0,
    cheekRaiseRight: 0,
    eyeSquintLeft: 0,
    eyeSquintRight: 0,
    browInnerUp: 0,
    browOuterUpLeft: 0,
    browOuterUpRight: 0,
    browDownLeft: 0,
    browDownRight: 0,
    tongueElevation: 0,
    tongueProtrusion: 0,
  };

  private output: DirectorOutput = {
    poseTargets: this.poseTargets,
    extraShapes: this.extraShapes,
    headDistance: 1.0,
  };

  constructor(config?: DirectorConfig) {
    this.blinkController = config?.blinkController;
    this.visemeScheduler = config?.visemeScheduler;
    this.prosody = config?.prosodyAnalyzer ?? new ProsodyAnalyzer();

    this.emotion = new EmotionEstimator();
    this.actions = new ActionController();
    this.gaze = new GazeController(this.blinkController);
    this.headNoise = new HeadNoiseController();

    if (config?.frontality !== undefined) {
      this.headNoise.frontality = config.frontality;
    }

    if (this.blinkController) {
      this.actions.onBlinkTrigger = () => {
        this.blinkController?.triggerBlink();
      };
    }

    this.scheduleNextBrowFlash();
  }

  public setMood(mood: AvatarMood): void {
    if (this.currentMood !== mood) {
      this.currentMood = mood;
      if (mood === 'listening') {
        this.userSilenceTimer = 0;
        this.lastBackChannelNodTime = this.totalElapsedSeconds;
      }
    }
  }

  public getMood(): AvatarMood {
    return this.currentMood;
  }

  public setBlinkController(controller: BlinkController): void {
    this.blinkController = controller;
    this.gaze.setBlinkController(controller);
    this.actions.onBlinkTrigger = () => {
      this.blinkController?.triggerBlink();
    };
  }

  public setVisemeScheduler(scheduler: VisemeScheduler): void {
    this.visemeScheduler = scheduler;
  }

  public setLayerGains(gains: Partial<LayerGains>): void {
    if (gains.lips !== undefined) {
      this.layerGains.lips = Math.max(0, Math.min(2.0, gains.lips));
    }
    if (gains.expression !== undefined) {
      this.layerGains.expression = Math.max(0, Math.min(2.0, gains.expression));
    }
    if (gains.pose !== undefined) {
      this.layerGains.pose = Math.max(0, Math.min(2.0, gains.pose));
    }
  }

  public getLayerGains(): LayerGains {
    return { ...this.layerGains };
  }

  public setSpeechGains(gains: Partial<SpeechGains>): void {
    if (gains.jawGain !== undefined) {
      this.speechGains.jawGain = Math.max(0.2, Math.min(2.5, gains.jawGain));
    }
    if (gains.bilabialTightness !== undefined) {
      this.speechGains.bilabialTightness = Math.max(0.2, Math.min(2.5, gains.bilabialTightness));
    }
  }

  public getSpeechGains(): SpeechGains {
    return { ...this.speechGains };
  }

  public setEmotion(valence: number, arousal: number, immediate = false): void {
    this.emotion.setEmotion(valence, arousal, immediate);
  }

  public setEmotionSensitivity(s: number): void {
    this.emotion.setSensitivity(s);
  }

  public getEmotionSensitivity(): number {
    return this.emotion.getSensitivity();
  }

  public processText(text: string): void {
    this.emotion.processText(text);

    const isQuestion = text.includes('?') || text.includes('¿');
    const isExclamation = text.includes('!') || text.includes('¡');

    // Pregunta o exclamación: levantamiento de cejas para énfasis y atención
    if (isQuestion) {
      if (this.currentMood === 'listening') {
        if (Math.random() < 0.65) {
          this.actions.trigger('tiltCurious', 0.85);
        } else {
          this.actions.trigger('browFlash', 0.80);
        }
      } else {
        this.actions.trigger('browFlash', 0.75);
      }
    } else if (isExclamation) {
      this.actions.trigger('browFlash', 0.70);
    }
  }

  public processProsody(prosody: ProsodyFeatures): void {
    this.emotion.processProsody(prosody);

    // Énfasis de cabeza y cejas en picos energéticos prosódicos durante el habla
    if (this.currentMood === 'speaking' && prosody.isVoiced && prosody.energy > 0.12) {
      // Cejas: levantamiento breve para énfasis en palabras importantes o varianza tonal
      if (
        this.prosodyBrowFlashCooldown <= 0 &&
        (prosody.pitchVariance > 28.0 || (prosody.isStressedSyllable && prosody.energy > 0.16))
      ) {
        this.actions.trigger('browFlash', 0.60);
        this.prosodyBrowFlashCooldown = 1.8 + Math.random() * 1.2;
      }

      if (prosody.pitchVariance > 32.0 && Math.random() < 0.15) {
        this.actions.trigger('nod', 0.6);
      }
    }
  }

  public triggerAction(id: ActionId, scale = 1.0): void {
    this.actions.trigger(id, scale);
  }

  /**
   * Manejador de interrupción: limpia inmediatamente colas de visemas y acciones activas
   */
  public onInterrupted(): void {
    this.visemeScheduler?.flush();
    this.actions.cancelAll();
    this.emotion.setEmotion(0.0, 0.20);
    this.userSilenceTimer = 0;
  }

  private scheduleNextBrowFlash(): void {
    // Entre 4.0 y 8.5 s durante habla
    this.browFlashTimer = 4.0 + Math.random() * 4.5;
  }

  /**
   * Actualiza el Director en cada fotograma
   */
  public update(
    deltaSeconds: number,
    audioTime: number,
    spectralVisemes: VisemeWeights,
    prosody?: ProsodyFeatures
  ): DirectorOutput {
    this.totalElapsedSeconds += deltaSeconds;
    if (this.prosodyBrowFlashCooldown > 0) {
      this.prosodyBrowFlashCooldown -= deltaSeconds;
    }

    // Actualizar prosodia si fue provista
    if (prosody) {
      this.processProsody(prosody);
    }

    // ----------------------------------------------------
    // CAPA 1: LABIOS (VisemeScheduler + Fallback Espectral + Ganancia Lips)
    // Audita y activa tanto la ruta con transcripción (coarticulación) como audio-only
    // ----------------------------------------------------
    let mixedVisemes: VisemeRigTargets;
    const isAudioActive = spectralVisemes.jawOpen > 0.005;
    const hasSyllables = this.visemeScheduler?.hasPendingSyllables() ?? false;

    if (this.visemeScheduler && (isAudioActive || hasSyllables)) {
      mixedVisemes = this.visemeScheduler.update(audioTime, spectralVisemes);
    } else if (isAudioActive) {
      mixedVisemes = {
        jawOpen: spectralVisemes.jawOpen,
        mouthRound: spectralVisemes.mouthRound,
        mouthWide: spectralVisemes.mouthWide,
        mouthClose: 0,
        mouthPressLips: 0,
        lowerLipTuck: 0,
        mouthFunnel: spectralVisemes.mouthRound * 0.5,
        mouthPucker: spectralVisemes.mouthRound * 0.4,
        mouthSmileLeft: 0,
        mouthSmileRight: 0,
        tongueElevation: 0,
        tongueProtrusion: 0,
      };
    } else if (this.currentMood === 'speaking') {
      // Articulación conversacional procedimental cuando se pulsa 'Hablando' sin audio streaming
      const t = this.totalElapsedSeconds;
      // Cadencia silábica realista a ~3.8 Hz
      const syllablePhase = t * (Math.PI * 2 * 3.8);
      const syllableSin = Math.sin(syllablePhase);
      const syllablePulse = Math.max(0, syllableSin);

      // Envolvente de frase y pausas naturales cada 2.5–3.5 s
      const phraseEnvelope = Math.sin(t * 1.5) * 0.45 + 0.55;
      const isPause = Math.sin(t * 0.8) < -0.70; // Pausa breve entre frases

      // Cierre bilabial periódico (/m, b, p/)
      const isBilabial = !isPause && Math.sin(t * 3.8 + 1.2) < -0.82;

      // Alternancia de vocales (/a, e, o/)
      const vowelCycle = Math.sin(t * 2.1);
      const mRound = isPause || isBilabial ? 0.0 : vowelCycle > 0.25 ? (vowelCycle - 0.25) * 0.6 : 0.0;
      const mWide = isPause || isBilabial ? 0.0 : vowelCycle < -0.25 ? (-vowelCycle - 0.25) * 0.6 : 0.0;

      const jaw = isPause ? 0.0 : isBilabial ? 0.02 : 0.12 + 0.22 * syllablePulse * phraseEnvelope;

      mixedVisemes = {
        jawOpen: jaw,
        mouthRound: mRound,
        mouthWide: mWide,
        mouthClose: isBilabial ? 0.85 : isPause ? 0.70 : 0,
        mouthPressLips: isBilabial ? 0.75 : 0,
        lowerLipTuck: 0,
        mouthFunnel: mRound * 0.5,
        mouthPucker: mRound * 0.4,
        mouthSmileLeft: mWide * 0.25,
        mouthSmileRight: mWide * 0.25,
        tongueElevation: 0,
        tongueProtrusion: 0,
      };
    } else {
      mixedVisemes = {
        jawOpen: 0,
        mouthRound: 0,
        mouthWide: 0,
        mouthClose: 0,
        mouthPressLips: 0,
        lowerLipTuck: 0,
        mouthFunnel: 0,
        mouthPucker: 0,
        mouthSmileLeft: 0,
        mouthSmileRight: 0,
        tongueElevation: 0,
        tongueProtrusion: 0,
      };
    }

    const gLips = this.layerGains.lips;
    this.poseTargets.jawOpen = mixedVisemes.jawOpen * gLips * this.speechGains.jawGain;
    this.poseTargets.mouthRound = mixedVisemes.mouthRound * gLips;
    this.poseTargets.mouthWide = mixedVisemes.mouthWide * gLips;

    this.extraShapes.mouthClose = mixedVisemes.mouthClose * gLips * this.speechGains.bilabialTightness;
    this.extraShapes.mouthPressLips = mixedVisemes.mouthPressLips * gLips * this.speechGains.bilabialTightness;
    this.extraShapes.lowerLipTuck = mixedVisemes.lowerLipTuck * gLips;
    this.extraShapes.mouthFunnel = mixedVisemes.mouthFunnel * gLips;
    this.extraShapes.mouthPucker = mixedVisemes.mouthPucker * gLips;
    this.extraShapes.tongueElevation = (mixedVisemes.tongueElevation ?? 0) * gLips;
    this.extraShapes.tongueProtrusion = (mixedVisemes.tongueProtrusion ?? 0) * gLips;

    // ----------------------------------------------------
    // CAPA 2: EXPRESIÓN (Emoción continua + Acciones + Ganancia Expression)
    // ----------------------------------------------------
    this.emotion.offset.valence = this.emotionOffset.valence;
    this.emotion.offset.arousal = this.emotionOffset.arousal;
    const emotionTargets = this.emotion.update(deltaSeconds);

    // Micro-expresiones periódicas durante habla
    if (this.currentMood === 'speaking') {
      this.browFlashTimer -= deltaSeconds;
      if (this.browFlashTimer <= 0) {
        this.actions.trigger('browFlash', 0.65);
        this.scheduleNextBrowFlash();
      }
    }

    // Actualizar acciones gestuales
    const actionOffsets: ActionOffsets = this.actions.update(deltaSeconds);

    const gExpr = this.layerGains.expression;

    // Sonrisa base con leve asimetría natural (±3%)
    const asymmetry = Math.sin(this.totalElapsedSeconds * 0.7) * 0.035;
    const baseSmile = Math.max(0, emotionTargets.smile + actionOffsets.smile);
    const smileLeft = Math.max(0, Math.min(1.0, (baseSmile + asymmetry) * gExpr));
    const smileRight = Math.max(0, Math.min(1.0, (baseSmile - asymmetry) * gExpr));

    this.poseTargets.smile = 0.5 * (smileLeft + smileRight);
    this.extraShapes.mouthSmileLeft = smileLeft;
    this.extraShapes.mouthSmileRight = smileRight;

    // Cejas
    const browRaiseVal = (emotionTargets.browRaise + actionOffsets.browRaise) * gExpr;
    this.poseTargets.browRaise = Math.max(0, Math.min(1.0, browRaiseVal));

    this.extraShapes.browInnerUp = Math.max(0, Math.min(1.0, (emotionTargets.browInnerUp + actionOffsets.browInnerUp) * gExpr));
    this.extraShapes.browOuterUpLeft = Math.max(0, Math.min(1.0, (emotionTargets.browOuterUp + actionOffsets.browOuterUp) * gExpr));
    this.extraShapes.browOuterUpRight = Math.max(0, Math.min(1.0, (emotionTargets.browOuterUp + actionOffsets.browOuterUp) * gExpr));
    this.extraShapes.browDownLeft = Math.max(0, Math.min(1.0, (emotionTargets.browDown + actionOffsets.browDown) * gExpr));
    this.extraShapes.browDownRight = Math.max(0, Math.min(1.0, (emotionTargets.browDown + actionOffsets.browDown) * gExpr));

    // Ojos y mejillas (Duchenne)
    const cheekVal = Math.max(0, Math.min(1.0, (emotionTargets.cheekRaise + actionOffsets.cheekRaise) * gExpr));
    this.extraShapes.cheekRaiseLeft = cheekVal;
    this.extraShapes.cheekRaiseRight = cheekVal;

    const squintVal = Math.max(0, Math.min(1.0, (emotionTargets.eyeSquint + actionOffsets.eyeSquint) * gExpr));
    this.extraShapes.eyeSquintLeft = squintVal;
    this.extraShapes.eyeSquintRight = squintVal;

    this.extraShapes.mouthDimpleLeft = Math.max(0, Math.min(1.0, (emotionTargets.mouthDimple + actionOffsets.mouthDimple) * gExpr));
    this.extraShapes.mouthDimpleRight = Math.max(0, Math.min(1.0, (emotionTargets.mouthDimple + actionOffsets.mouthDimple) * gExpr));

    const frownVal = Math.max(0, Math.min(1.0, emotionTargets.mouthFrown * gExpr));
    this.extraShapes.mouthFrownLeft = frownVal;
    this.extraShapes.mouthFrownRight = frownVal;

    // Sumar componente de mandíbula por sorpresa/risa de acción
    if (actionOffsets.jawOpen > 0.001) {
      this.poseTargets.jawOpen = Math.min(0.65, this.poseTargets.jawOpen + actionOffsets.jawOpen * gExpr);
    }

    // Micro-expresión de fruncido de cejas y mirada reflexiva al pensar (thinking)
    if (this.currentMood === 'thinking') {
      this.extraShapes.browDownLeft = Math.max(this.extraShapes.browDownLeft, 0.32 * gExpr);
      this.extraShapes.browDownRight = Math.max(this.extraShapes.browDownRight, 0.32 * gExpr);
      this.extraShapes.eyeSquintLeft = Math.max(this.extraShapes.eyeSquintLeft, 0.16 * gExpr);
      this.extraShapes.eyeSquintRight = Math.max(this.extraShapes.eyeSquintRight, 0.16 * gExpr);
      this.extraShapes.browInnerUp = Math.max(this.extraShapes.browInnerUp, 0.14 * gExpr);
    }

    // ----------------------------------------------------
    // CAPA 3: POSE (Mirada + fBm Head Noise + Back-channel + Ganancia Pose)
    // ----------------------------------------------------
    const gPose = this.layerGains.pose;

    // Actualizar mirada y acoplamiento ojo-cabeza
    this.gaze.gazeTarget = this.gazeTarget;
    const gazeTargets = this.gaze.update(deltaSeconds, this.currentMood);

    this.poseTargets.gazeX = ((gazeTargets.gazeX + actionOffsets.gazeX) * gPose) || 0;
    this.poseTargets.gazeY = ((gazeTargets.gazeY + actionOffsets.gazeY) * gPose) || 0;

    // Ruido fBm para balanceo craneal natural
    const noiseTargets = this.headNoise.update(deltaSeconds, this.currentMood);

    // Lógica de Back-Channel (escucha activa) en modo listening
    if (this.currentMood === 'listening') {
      this.userSilenceTimer += deltaSeconds;
      const timeSinceLastNod = this.totalElapsedSeconds - this.lastBackChannelNodTime;

      // Cada 2.5 a 4.0 segundos de escucha, si no hay acción activa, disparar cabeceo de escucha con ceja empática
      if (timeSinceLastNod > 2.8 && !this.actions.hasActiveActions()) {
        this.lastBackChannelNodTime = this.totalElapsedSeconds;
        if (Math.random() < 0.65) {
          this.actions.trigger('nod', 0.65);
        } else {
          this.actions.trigger('nodDouble', 0.55);
        }
        // Micro-expresión empática de cejas que acompaña el asentimiento
        this.actions.trigger('browFlash', 0.45);
      }
    } else {
      this.userSilenceTimer = 0;
    }

    // Integrar cabeceo, balanceo y acoplamiento ocular
    let totalYaw = noiseTargets.yaw + gazeTargets.coupledHeadYaw + actionOffsets.headYaw;
    let totalPitch = noiseTargets.pitch + gazeTargets.coupledHeadPitch + actionOffsets.headPitch;
    let totalRoll = noiseTargets.roll + actionOffsets.headRoll;

    // Modulaciones posturales según estado conversacional
    if (this.currentMood === 'listening') {
      totalPitch += 0.020;
      totalRoll += 0.015;
    } else if (this.currentMood === 'thinking') {
      totalPitch -= 0.020;
      totalRoll -= 0.022;
      totalYaw += 0.030;
    }

    this.poseTargets.headYaw = (totalYaw * gPose) || 0;
    this.poseTargets.headPitch = (totalPitch * gPose) || 0;
    this.poseTargets.headRoll = (totalRoll * gPose) || 0;
    this.poseTargets.breath = (noiseTargets.breath * gPose) || 0;

    // Control VASA-1 de distancia cefálica (escala de la imagen)
    this.output.headDistance = Math.max(0.97, Math.min(1.03, this.headDistance));

    return this.output;
  }
}
