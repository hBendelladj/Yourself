/**
 * phase4.test.ts
 *
 * Pruebas de aceptación de la Fase 4: Director, Expresión y Cabeza Viva
 * - 3 capas desacopladas con intensidades independientes (lips, expression, pose).
 * - Espacio emocional continuo (Russell Circumplex) e interpolación RBF 2D.
 * - Heurística de texto en español y análisis prosódico (F0 / pitch variance).
 * - Biblioteca de acciones procedurales (keyframes, aditividad y cancelación inmediata en interrupción).
 * - Acoplamiento cinemático ojo-cabeza y sacadas balísticas.
 * - Comportamiento de escucha activa (back-channel nods).
 * - Controles tipo VASA-1 (gazeTarget, headDistance, emotionOffset).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Director } from '../src/core/animation/director';
import { EmotionEstimator } from '../src/core/animation/emotion';
import { ActionController } from '../src/core/animation/actions';
import { GazeController } from '../src/core/animation/gaze';
import { ProsodyAnalyzer } from '../src/core/audio/prosodyAnalyzer';
import { VisemeWeights } from '../src/core/audio/lipsyncAnalyzer';

describe('Fase 4: Director, Expresión y Cabeza Viva', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Capas Independientes y Ganancias (layerGains)', () => {
    it('aisla completamente la capa de labios cuando layerGain.lips = 0', () => {
      const director = new Director();
      director.setMood('speaking');

      const spectralVisemes: VisemeWeights = {
        jawOpen: 0.35,
        mouthRound: 0.25,
        mouthWide: 0.20,
        smile: 0.15,
      };

      // Evaluación con ganancias por defecto (1.0)
      director.setLayerGains({ lips: 1.0, expression: 1.0, pose: 1.0 });
      const outActive = director.update(0.016, 0.5, spectralVisemes);
      expect(outActive.poseTargets.jawOpen).toBeGreaterThan(0.1);
      expect(outActive.poseTargets.mouthRound).toBeGreaterThan(0.05);

      // Desactivar estrictamente la capa de labios
      director.setLayerGains({ lips: 0.0, expression: 1.0, pose: 1.0 });
      const outMuted = director.update(0.016, 0.52, spectralVisemes);

      expect(outMuted.poseTargets.jawOpen).toBe(0);
      expect(outMuted.poseTargets.mouthRound).toBe(0);
      expect(outMuted.poseTargets.mouthWide).toBe(0);
      expect(outMuted.extraShapes.mouthClose).toBe(0);
      expect(outMuted.extraShapes.lowerLipTuck).toBe(0);

      // Las capas de expresión y pose continúan activas
      expect(Math.abs(outMuted.poseTargets.headPitch) + Math.abs(outMuted.poseTargets.headYaw)).toBeGreaterThan(0);
    });

    it('aisla la capa de expresión cuando layerGain.expression = 0', () => {
      const director = new Director();
      director.setEmotion(0.85, 0.70, true); // Emoción alegre activa de forma inmediata

      director.setLayerGains({ lips: 1.0, expression: 1.0, pose: 1.0 });
      const outActive = director.update(0.016, 0.1, { jawOpen: 0, mouthRound: 0, mouthWide: 0, smile: 0 });
      expect(outActive.poseTargets.smile).toBeGreaterThan(0.3);
      expect(outActive.extraShapes.mouthSmileLeft).toBeGreaterThan(0.3);

      // Desactivar capa de expresión
      director.setLayerGains({ lips: 1.0, expression: 0.0, pose: 1.0 });
      const outMuted = director.update(0.016, 0.12, { jawOpen: 0, mouthRound: 0, mouthWide: 0, smile: 0 });

      expect(outMuted.poseTargets.smile).toBe(0);
      expect(outMuted.poseTargets.browRaise).toBe(0);
      expect(outMuted.extraShapes.mouthSmileLeft).toBe(0);
      expect(outMuted.extraShapes.mouthSmileRight).toBe(0);
      expect(outMuted.extraShapes.cheekRaiseLeft).toBe(0);
      expect(outMuted.extraShapes.browInnerUp).toBe(0);
    });

    it('aisla la capa de pose cuando layerGain.pose = 0', () => {
      const director = new Director();
      director.setMood('idle');

      director.setLayerGains({ lips: 1.0, expression: 1.0, pose: 0.0 });
      const out = director.update(0.016, 0.1, { jawOpen: 0, mouthRound: 0, mouthWide: 0, smile: 0 });

      expect(out.poseTargets.headYaw).toBe(0);
      expect(out.poseTargets.headPitch).toBe(0);
      expect(out.poseTargets.headRoll).toBe(0);
      expect(out.poseTargets.gazeX).toBe(0);
      expect(out.poseTargets.gazeY).toBe(0);
      expect(out.poseTargets.breath).toBe(0);
    });
  });

  describe('2. Espacio Emocional Continuo (EmotionEstimator)', () => {
    it('interpola correctamente hacia alegría (smile y cheekRaise elevados)', () => {
      const estimator = new EmotionEstimator();
      estimator.setEmotion(0.85, 0.75); // Cuadrante alegre

      // Avanzar pasos de suavizado
      for (let i = 0; i < 30; i++) {
        estimator.update(0.016);
      }

      const targets = estimator.blendedTargets;
      expect(targets.smile).toBeGreaterThan(0.40);
      expect(targets.cheekRaise).toBeGreaterThan(0.25);
      expect(targets.mouthFrown).toBeLessThan(0.05);
    });

    it('interpola correctamente hacia tristeza (browInnerUp y mouthFrown sin sonrisa)', () => {
      const estimator = new EmotionEstimator();
      estimator.setEmotion(-0.80, 0.20); // Cuadrante triste

      for (let i = 0; i < 30; i++) {
        estimator.update(0.016);
      }

      const targets = estimator.blendedTargets;
      expect(targets.browInnerUp).toBeGreaterThan(0.30);
      expect(targets.mouthFrown).toBeGreaterThan(0.25);
      expect(targets.smile).toBeLessThan(0.05);
    });

    it('interpola correctamente hacia sorpresa (browRaise y eyeWide elevados con ligera apertura)', () => {
      const estimator = new EmotionEstimator();
      estimator.setEmotion(0.25, 0.90, true); // Cuadrante sorpresa

      for (let i = 0; i < 30; i++) {
        estimator.update(0.016);
      }

      const targets = estimator.blendedTargets;
      expect(targets.browRaise).toBeGreaterThan(0.20);
      expect(targets.browInnerUp).toBeGreaterThan(0.30);
      expect(targets.browOuterUp).toBeGreaterThan(0.30);
    });

    it('aplica offset emocional manual (control VASA-1 emotionOffset)', () => {
      const estimator = new EmotionEstimator();
      estimator.setEmotion(0.0, 0.15); // Neutral
      estimator.offset.valence = 0.60;
      estimator.offset.arousal = 0.50;

      for (let i = 0; i < 20; i++) {
        estimator.update(0.016);
      }

      // Con offset positivo debe activar componentes de alegría
      expect(estimator.blendedTargets.smile).toBeGreaterThan(0.20);
    });
  });

  describe('3. Heurística de Texto y Prosodia Acústica', () => {
    it('detecta preguntas en español e incrementa arousal y curiosidad', () => {
      const estimator = new EmotionEstimator();
      const initialArousal = estimator.target.arousal;

      estimator.processText('¿Cómo estás hoy?');
      expect(estimator.target.arousal).toBeGreaterThan(initialArousal);
    });

    it('detecta palabras positivas en español e incrementa valence', () => {
      const estimator = new EmotionEstimator();
      estimator.processText('¡Muchas gracias, es una maravilla y un placer!');
      expect(estimator.target.valence).toBeGreaterThan(0.40);
      expect(estimator.target.arousal).toBeGreaterThan(0.40);
    });

    it('detecta palabras negativas en español y disminuye valence', () => {
      const estimator = new EmotionEstimator();
      estimator.processText('Qué lástima, tenemos un problema grave y un error');
      expect(estimator.target.valence).toBeLessThan(-0.30);
    });

    it('ProsodyAnalyzer extrae F0 y calcula varianza tonal sobre señal periódica', () => {
      const prosody = new ProsodyAnalyzer(24000);

      // Sintetizar señal senoidal periódica pura a 150 Hz
      const timeData = new Uint8Array(512);
      const freq = 150;
      for (let i = 0; i < 512; i++) {
        const t = i / 24000;
        const s = Math.sin(2 * Math.PI * freq * t);
        timeData[i] = Math.round(128 + s * 110);
      }

      // Procesar múltiples fotogramas para construir la historia
      let feat = prosody.processTimeDomain(timeData);
      for (let f = 0; f < 10; f++) {
        feat = prosody.processTimeDomain(timeData);
      }

      expect(feat.isVoiced).toBe(true);
      expect(feat.f0).toBeGreaterThan(135);
      expect(feat.f0).toBeLessThan(165);
      expect(feat.energy).toBeGreaterThan(0.3);
    });
  });

  describe('4. Biblioteca de Acciones Procedurales (ActionController)', () => {
    it('dispara asentimiento (nod) produciendo inclinación descendente de cabeza', () => {
      const actions = new ActionController();
      actions.trigger('nod', 1.0);

      // Avanzar al 50% de la duración
      const offsets = actions.update(0.32);
      expect(offsets.headPitch).toBeLessThan(-0.03); // Inclinación descendente
    });

    it('dispara ladeo curioso (tiltCurious) produciendo headRoll y elevación de cejas', () => {
      const actions = new ActionController();
      actions.trigger('tiltCurious', 1.0);

      const offsets = actions.update(0.5);
      expect(Math.abs(offsets.headRoll)).toBeGreaterThan(0.03);
      expect(offsets.browRaise).toBeGreaterThan(0.08);
    });

    it('dispara flash de cejas (browFlash) y retorna a 0 tras finalizar', () => {
      const actions = new ActionController();
      actions.trigger('browFlash', 1.0);

      // En la mitad del progreso
      const peak = actions.update(0.20);
      expect(peak.browRaise).toBeGreaterThan(0.20);

      // Al terminar la duración total (~0.4s)
      actions.update(0.30);
      const ended = actions.update(0.016);
      expect(ended.browRaise).toBe(0);
      expect(actions.hasActiveActions()).toBe(false);
    });

    it('cancela inmediatamente todas las acciones al recibir cancelAll() (interrupción)', () => {
      const actions = new ActionController();
      actions.trigger('nod', 1.0);
      actions.trigger('smileBig', 1.0);
      actions.trigger('browFlash', 1.0);

      actions.update(0.1);
      expect(actions.hasActiveActions()).toBe(true);

      // Interrupción
      actions.cancelAll();
      expect(actions.hasActiveActions()).toBe(false);
      expect(actions.offsets.headPitch).toBe(0);
      expect(actions.offsets.smile).toBe(0);
      expect(actions.offsets.browRaise).toBe(0);
    });
  });

  describe('5. Acoplamiento Ojo-Cabeza y Mirada (GazeController)', () => {
    it('sacadas grandes programan un giro de cabeza en la misma dirección con retraso', () => {
      const gaze = new GazeController();
      gaze.triggerSaccade(0.35, 0.20); // Disparar sacada grande

      // En los primeros fotogramas aún no transcurre el retraso fisiológico de 80 ms
      const t0 = gaze.update(0.016, 'idle');
      expect(t0.coupledHeadYaw).toBe(0);

      // Tras superar los 80 ms, el giro cefálico acoplado se activa
      let coupledYaw = 0;
      for (let i = 0; i < 8; i++) {
        const t = gaze.update(0.016, 'idle');
        if (Math.abs(t.coupledHeadYaw) > 0.01) {
          coupledYaw = t.coupledHeadYaw;
          break;
        }
      }
      expect(coupledYaw).toBeGreaterThan(0.05);
    });

    it('en modo thinking la mirada deriva hacia cuadrante superior con movimiento continuo', () => {
      const gaze = new GazeController();
      let hadUpperGaze = false;

      for (let step = 0; step < 80; step++) {
        const targets = gaze.update(0.02, 'thinking');
        if (targets.gazeY > 0.15) {
          hadUpperGaze = true;
          break;
        }
      }

      expect(hadUpperGaze).toBe(true);
    });
  });

  describe('6. Escucha Activa (Back-Channel) y Control VASA-1', () => {
    it('dispara cabeceos de escucha activa (back-channel) tras varios segundos de silencio en listening', () => {
      const director = new Director();
      director.setMood('listening');

      let actionTriggered = false;
      const initialActionHas = director.actions.hasActiveActions();
      expect(initialActionHas).toBe(false);

      // Simular 3.5 segundos de escucha continuada
      for (let step = 0; step < 220; step++) {
        director.update(0.016, 0.0, { jawOpen: 0, mouthRound: 0, mouthWide: 0, smile: 0 });
        if (director.actions.hasActiveActions()) {
          actionTriggered = true;
          break;
        }
      }

      expect(actionTriggered).toBe(true);
    });

    it('ajusta la distancia cefálica (headDistance) acotada entre 0.97 y 1.03', () => {
      const director = new Director();

      director.headDistance = 1.02;
      const out1 = director.update(0.016, 0, { jawOpen: 0, mouthRound: 0, mouthWide: 0, smile: 0 });
      expect(out1.headDistance).toBeCloseTo(1.02, 3);

      // Fuera de rango debe acotarse
      director.headDistance = 1.15;
      const out2 = director.update(0.016, 0, { jawOpen: 0, mouthRound: 0, mouthWide: 0, smile: 0 });
      expect(out2.headDistance).toBe(1.03);
    });

    it('limpia inmediatamente colas y acciones ante onInterrupted()', () => {
      const director = new Director();
      director.triggerAction('nod', 1.0);
      director.triggerAction('smileBig', 1.0);
      director.setEmotion(0.8, 0.8);

      director.update(0.05, 0, { jawOpen: 0, mouthRound: 0, mouthWide: 0, smile: 0 });
      expect(director.actions.hasActiveActions()).toBe(true);

      // Disparar interrupción
      director.onInterrupted();
      expect(director.actions.hasActiveActions()).toBe(false);
    });
  });
});
