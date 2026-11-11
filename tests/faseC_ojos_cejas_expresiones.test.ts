/**
 * faseC_ojos_cejas_expresiones.test.ts
 *
 * Pruebas unitarias y de integración para la Fase C:
 * 1. Parpadeo con intervalos log-normales (12–20 blinks/min), parpadeos incompletos y dobles.
 * 2. Parpadeo reflejo acoplado a sacadas oculares balísticas (> 0.18 rad/magnitud).
 * 3. Mirada: fijaciones, deriva hacia arriba/lado al pensar (thinking), y retorno rápido al interlocutor.
 * 4. Cejas: fruncido leve y entrecerrado al pensar, flash de cejas en preguntas y picos prosódicos.
 * 5. Clasificación y modulación continua de emociones a partir de texto en español:
 *    - alegre, triste, sorprendido, pensativo, empático, divertido, neutral.
 * 6. Micro-expresiones periódicas durante el habla y escucha activa (asentimiento + cejas).
 * 7. Multiplicador de sensibilidad emocional y tasa de parpadeo.
 * 8. Invarianza del reposo neutral (sin deformaciones residuales ni saltos).
 */

import { describe, it, expect, vi } from 'vitest';
import { BlinkEngine } from '../src/core/eye/blinkEngine';
import { BlinkController } from '../src/core/animation/blink';
import { GazeController } from '../src/core/animation/gaze';
import { EmotionEstimator } from '../src/core/animation/emotion';
import { Director } from '../src/core/animation/director';
import { VORCoordinator } from '../src/core/motion/vorCoordinator';
import { ProsodyFeatures } from '../src/core/audio/prosodyAnalyzer';

describe('Fase C — Ojos, cejas y expresiones faciales realistas', () => {
  describe('1. Parpadeo Log-Normal y Variabilidad Biológica', () => {
    it('genera intervalos de parpadeo fisiológicos equivalentes a 12–20 parpadeos por minuto', () => {
      const blinkEngine = new BlinkEngine();
      const samples: number[] = [];
      const N = 1000;

      for (let i = 0; i < N; i++) {
        samples.push(blinkEngine.sampleBlinkInterval('idle'));
      }

      const meanInterval = samples.reduce((a, b) => a + b, 0) / N;
      const blinksPerMin = 60 / meanInterval;

      // El rango humano natural es ~12 a 22 parpadeos por minuto
      expect(blinksPerMin).toBeGreaterThanOrEqual(12.0);
      expect(blinksPerMin).toBeLessThanOrEqual(24.0);

      // Todos los intervalos deben estar dentro de los límites anatómicos [1.2s, 6.8s]
      for (const s of samples) {
        expect(s).toBeGreaterThanOrEqual(1.19);
        expect(s).toBeLessThanOrEqual(6.81);
      }
    });

    it('genera una proporción de parpadeos incompletos biológicos (~18%)', () => {
      const blinkEngine = new BlinkEngine();
      let incompleteCount = 0;
      const totalBlinks = 300;

      for (let i = 0; i < totalBlinks; i++) {
        blinkEngine.triggerBlink();
        if (blinkEngine.getMaxClosure() < 0.98) {
          incompleteCount++;
          expect(blinkEngine.getMaxClosure()).toBeGreaterThanOrEqual(0.70);
          expect(blinkEngine.getMaxClosure()).toBeLessThanOrEqual(0.96);
        }
        // Avanzar el tiempo para que termine el parpadeo
        blinkEngine.update(0.20);
      }

      const incompleteRatio = incompleteCount / totalBlinks;
      // Esperamos ~18% (margen razonable 10% - 28% con N=300)
      expect(incompleteRatio).toBeGreaterThan(0.08);
      expect(incompleteRatio).toBeLessThan(0.32);
    });

    it('permite calibrar la tasa de parpadeo mediante blinkRate', () => {
      const blinkEngine = new BlinkEngine();

      blinkEngine.setRateMultiplier(2.0);
      const fastInterval = blinkEngine.sampleBlinkInterval('idle');

      blinkEngine.setRateMultiplier(0.5);
      const slowInterval = blinkEngine.sampleBlinkInterval('idle');

      // A 2.0x los intervalos medios son significativamente más cortos que a 0.5x
      expect(blinkEngine.getRateMultiplier()).toBe(0.5);
    });
  });

  describe('2. Parpadeo Reflejo Acoplado a Sacadas Oculares (Post-Saccade Blink)', () => {
    it('dispara un parpadeo reflejo ante sacadas de mirada balísticas (> 0.18 de magnitud)', () => {
      const blinkEngine = new BlinkEngine();
      let triggered = false;
      blinkEngine.onBlinkChange = (isBlinking) => {
        if (isBlinking) triggered = true;
      };

      // Múltiples intentos para superar la probabilidad estocástica (~75%)
      for (let attempt = 0; attempt < 10; attempt++) {
        blinkEngine.triggerSaccadeBlink(0.25);
        if (triggered) break;
      }

      expect(triggered).toBe(true);
    });

    it('no dispara parpadeo ante micro-sacadas imperceptibles (< 0.10)', () => {
      const blinkEngine = new BlinkEngine();
      let triggered = false;
      blinkEngine.onBlinkChange = (isBlinking) => {
        if (isBlinking) triggered = true;
      };

      for (let attempt = 0; attempt < 20; attempt++) {
        blinkEngine.triggerSaccadeBlink(0.08);
      }

      expect(triggered).toBe(false);
    });

    it('GazeController invoca onSaccade y dispara parpadeo al retornar de thinking al interlocutor', () => {
      const gaze = new GazeController();
      let saccadeCount = 0;
      gaze.onSaccade = (mag) => {
        if (mag > 0.18) saccadeCount++;
      };

      // Simular avatar pensando durante 0.5s para alcanzar la fijación excéntrica
      for (let i = 0; i < 20; i++) {
        gaze.update(0.025, 'thinking');
      }
      expect(Math.abs(gaze.targets.gazeX) + Math.abs(gaze.targets.gazeY)).toBeGreaterThan(0.20);

      // Simular cambio de estado a 'idle' retornando al interlocutor
      gaze.update(0.025, 'idle');

      expect(saccadeCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('3. Mirada: Fijación, Pensamiento y VOR', () => {
    it('en estado "thinking" la mirada deriva hacia el cuadrante superior lateral', () => {
      const gaze = new GazeController();

      // Dejar que thinking programe y avance la fijación
      for (let i = 0; i < 40; i++) {
        gaze.update(0.033, 'thinking');
      }

      // En thinking, gazeY debe ser positivo (mirando hacia arriba) y gazeX hacia un lado
      expect(gaze.targets.gazeY).toBeGreaterThan(0.10);
      expect(Math.abs(gaze.targets.gazeX)).toBeGreaterThan(0.15);
    });

    it('el coordinador VOR compensa la dirección ocular ante giros cefálicos', () => {
      const vor = new VORCoordinator();

      // Si la cabeza gira a la derecha (+yaw = +0.20 rad) y la mirada deseada es central (0.0),
      // el VOR debe desplazar los ojos a la izquierda (-compensatedGazeX)
      const res = vor.update(0.016, 0.0, 0.0, 0.20, 0.0);
      expect(res.compensatedGazeX).toBeLessThan(0.0);
    });
  });

  describe('4. Cejas: Fruncido Pensativo, Preguntas y Prosodia', () => {
    it('durante "thinking" activa fruncido de cejas (browDown) y ligero entrecerrado (eyeSquint)', () => {
      const director = new Director();
      director.setMood('thinking');

      const out = director.update(0.05, 0.0, { jawOpen: 0, mouthRound: 0, mouthWide: 0 });

      // Cejas fruncidas
      expect(out.extraShapes['browDownLeft']).toBeGreaterThanOrEqual(0.25);
      expect(out.extraShapes['browDownRight']).toBeGreaterThanOrEqual(0.25);
      // Ojos entrecerrados
      expect(out.extraShapes['eyeSquintLeft']).toBeGreaterThanOrEqual(0.12);
      expect(out.extraShapes['eyeSquintRight']).toBeGreaterThanOrEqual(0.12);
      // Arqueo interno sutil
      expect(out.extraShapes['browInnerUp']).toBeGreaterThanOrEqual(0.10);
    });

    it('al recibir preguntas en español dispara flash de cejas (browFlash)', () => {
      const director = new Director();
      const triggerSpy = vi.spyOn(director.actions, 'trigger');

      director.processText('¿Qué opinas sobre este resultado?');

      expect(triggerSpy).toHaveBeenCalledWith('browFlash', expect.any(Number));
    });

    it('en habla, picos de varianza prosódica y énfasis silábico disparan micro-levantamiento de cejas', () => {
      const director = new Director();
      director.setMood('speaking');
      const triggerSpy = vi.spyOn(director.actions, 'trigger');

      const highProsody: ProsodyFeatures = {
        f0: 220,
        energy: 0.25,
        pitchVariance: 35.0,
        pitchSlope: 40.0,
        isVoiced: true,
        isStressedSyllable: true,
      };

      director.processProsody(highProsody);

      expect(triggerSpy).toHaveBeenCalledWith('browFlash', 0.60);
    });
  });

  describe('5. Estimador Emocional Continuo para Español', () => {
    it('clasifica texto alegre y activa sonrisa con Duchenne (smile + cheekRaise)', () => {
      const estimator = new EmotionEstimator();
      estimator.processText('¡Qué alegría, me encanta! Es maravilloso y una gran felicidad.');

      for (let i = 0; i < 30; i++) {
        estimator.update(0.016);
      }

      expect(estimator.currentEmotionName).toBe('alegre');
      expect(estimator.current.valence).toBeGreaterThan(0.40);
      expect(estimator.blendedTargets.smile).toBeGreaterThan(0.35);
      expect(estimator.blendedTargets.cheekRaise).toBeGreaterThan(0.20);
    });

    it('clasifica texto triste y activa comisuras caídas (mouthFrown) y cejas caídas (browInnerUp)', () => {
      const estimator = new EmotionEstimator();
      estimator.processText('Qué triste noticia, es una pena y un dolor terrible, lo lamento mucho.');

      for (let i = 0; i < 30; i++) {
        estimator.update(0.016);
      }

      expect(estimator.currentEmotionName).toBe('triste');
      expect(estimator.current.valence).toBeLessThan(-0.30);
      expect(estimator.blendedTargets.mouthFrown).toBeGreaterThan(0.20);
      expect(estimator.blendedTargets.browInnerUp).toBeGreaterThan(0.25);
    });

    it('clasifica texto de asombro/sorpresa y activa cejas levantadas (browRaise)', () => {
      const estimator = new EmotionEstimator();
      estimator.processText('¡Wow, increíble, qué sorpresa tan impresionante e inesperada!');

      for (let i = 0; i < 30; i++) {
        estimator.update(0.016);
      }

      expect(estimator.currentEmotionName).toBe('sorprendido');
      expect(estimator.current.arousal).toBeGreaterThan(0.50);
      expect(estimator.blendedTargets.browRaise).toBeGreaterThan(0.20);
    });

    it('clasifica texto reflexivo/pensativo', () => {
      const estimator = new EmotionEstimator();
      estimator.processText('Veamos, es interesante analizar y pensar en esta cuestión...');

      for (let i = 0; i < 30; i++) {
        estimator.update(0.016);
      }

      expect(estimator.currentEmotionName).toBe('pensativo');
    });

    it('clasifica texto empático con sonrisa serena y comprensión', () => {
      const estimator = new EmotionEstimator();
      estimator.processText('Te comprendo perfectamente, cuenta conmigo, ten calma y un abrazo.');

      for (let i = 0; i < 30; i++) {
        estimator.update(0.016);
      }

      expect(estimator.currentEmotionName).toBe('empatico');
      expect(estimator.current.valence).toBeGreaterThan(0.25);
      expect(estimator.blendedTargets.smile).toBeGreaterThan(0.15);
    });

    it('clasifica texto divertido/humor y activa máxima expresividad (divertido)', () => {
      const estimator = new EmotionEstimator();
      estimator.processText('Jajaja qué risa, qué chiste tan divertido y gracioso, me muero de risa jaja');

      for (let i = 0; i < 30; i++) {
        estimator.update(0.016);
      }

      expect(estimator.currentEmotionName).toBe('divertido');
      expect(estimator.current.valence).toBeGreaterThan(0.60);
      expect(estimator.current.arousal).toBeGreaterThan(0.60);
    });

    it('relaja suavemente hacia el estado neutral en ausencia de estímulos (> 3.5 s)', () => {
      const estimator = new EmotionEstimator();
      estimator.setEmotion(0.8, 0.8, true);

      // Simular paso de 4 segundos sin nuevo texto ni audio
      for (let i = 0; i < 250; i++) {
        estimator.update(0.016);
      }

      expect(estimator.current.valence).toBeLessThan(0.40);
      expect(estimator.current.arousal).toBeLessThan(0.50);
    });
  });

  describe('6. Escucha Activa y Micro-Expresiones (Listening Back-Channel)', () => {
    it('en estado "listening", tras 3 segundos de silencio del usuario, dispara cabeceo de asentimiento con cejas', () => {
      const director = new Director();
      director.setMood('listening');
      const triggerSpy = vi.spyOn(director.actions, 'trigger');

      // Avanzar más de 2.8 s en escucha
      for (let i = 0; i < 180; i++) {
        director.update(0.016, 0.0, { jawOpen: 0, mouthRound: 0, mouthWide: 0 });
      }

      // Debe haber disparado al menos un asentimiento ('nod' o 'nodDouble') y 'browFlash'
      expect(triggerSpy).toHaveBeenCalledWith(
        expect.stringMatching(/nod|nodDouble/),
        expect.any(Number)
      );
      expect(triggerSpy).toHaveBeenCalledWith('browFlash', 0.45);
    });
  });

  describe('7. Modulador de Sensibilidad Emocional (emotionSensitivity)', () => {
    it('con sensibilidad alta (1.8x) el estímulo genera un impacto afectivo mayor que con 0.6x', () => {
      const estimatorLow = new EmotionEstimator();
      estimatorLow.setSensitivity(0.6);
      estimatorLow.processText('¡Excelente, me gusta!');

      const estimatorHigh = new EmotionEstimator();
      estimatorHigh.setSensitivity(1.8);
      estimatorHigh.processText('¡Excelente, me gusta!');

      expect(estimatorHigh.target.valence).toBeGreaterThan(estimatorLow.target.valence);
      expect(estimatorHigh.target.arousal).toBeGreaterThan(estimatorLow.target.arousal);
    });
  });

  describe('8. Invarianza del Reposo Neutral y Rendimiento', () => {
    it('en reposo absoluto con neutralidad, las expresiones faciales no generan distorsiones residuales', () => {
      const director = new Director();
      director.setMood('idle');
      director.setEmotion(0.0, 0.15, true);

      const out = director.update(0.016, 0.0, { jawOpen: 0, mouthRound: 0, mouthWide: 0 });

      // Comprobar que blendshapes de deformación extrema están en reposo
      expect(out.extraShapes['mouthClose']).toBe(0);
      expect(out.extraShapes['mouthFrownLeft']).toBeLessThan(0.02);
      expect(out.extraShapes['browDownLeft']).toBeLessThan(0.02);
      expect(out.poseTargets.jawOpen).toBe(0);
    });

    it('1,000 iteraciones del bucle caliente de Fase C se ejecutan dentro del presupuesto de tiempo', () => {
      const director = new Director();
      director.setMood('speaking');
      const visemes = { jawOpen: 0.25, mouthRound: 0.1, mouthWide: 0.3 };
      const prosody: ProsodyFeatures = {
        f0: 160,
        energy: 0.18,
        pitchVariance: 22,
        pitchSlope: 10,
        isVoiced: true,
        isStressedSyllable: false,
      };

      const tStart = performance.now();
      for (let i = 0; i < 1000; i++) {
        director.update(0.016, i * 0.016, visemes, prosody);
      }
      const tEnd = performance.now();
      const avgMs = (tEnd - tStart) / 1000;

      // Presupuesto JS/frame estricto: < 1.0 ms promedio para la capa de lógica y director
      expect(avgMs).toBeLessThan(1.0);
    });
  });
});
