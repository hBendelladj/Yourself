import { describe, it, expect } from 'vitest';
import { FormantAnalyzer } from '../src/core/audio/formants';
import { CohenMassaroCoarticulator } from '../src/core/audio/coarticulation';
import { VisemeScheduler } from '../src/core/audio/visemeScheduler';
import { PoseDeformer } from '../src/core/render/poses';
import { LANDMARK_INDICES } from '../src/core/face/landmarkGroups';

/**
 * Genera una señal sintética de habla (impulso glótico filtrado por formantes)
 */
function generateSyntheticVowel(
  f1: number,
  f2: number,
  f3: number,
  sampleRate = 24000,
  durationMs = 50,
  f0 = 125
): Float32Array {
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const signal = new Float32Array(numSamples);

  // 1. Tren de impulsos glóticos a f0
  const period = Math.floor(sampleRate / f0);
  for (let i = 0; i < numSamples; i += period) {
    signal[i] = 1.0;
  }

  // 2. Filtros resonadores para cada formante (2 polos por formante)
  const formants = [
    { f: f1, bw: 80 },
    { f: f2, bw: 110 },
    { f: f3, bw: 140 },
  ];

  let current = signal;
  for (const fmt of formants) {
    const r = Math.exp((-Math.PI * fmt.bw) / sampleRate);
    const theta = (2 * Math.PI * fmt.f) / sampleRate;
    const a1 = -2 * r * Math.cos(theta);
    const a2 = r * r;

    const filtered = new Float32Array(numSamples);
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < numSamples; i++) {
      const y0 = current[i]! - a1 * y1 - a2 * y2;
      filtered[i] = y0;
      y2 = y1;
      y1 = y0;
    }
    current = filtered;
  }

  // Normalizar amplitud
  let maxAmp = 1e-6;
  for (let i = 0; i < numSamples; i++) {
    if (Math.abs(current[i]!) > maxAmp) maxAmp = Math.abs(current[i]!);
  }
  for (let i = 0; i < numSamples; i++) {
    current[i] = (current[i]! / maxAmp) * 0.8;
  }

  return current;
}

describe('V4 Fase 5: Audio Acústico LPC + Cohen–Massaro (Algoritmos E y F)', () => {
  describe('1. Análisis LPC de Orden 12 y Estimación de Formantes', () => {
    it('estima F1 y F2 con error < 8% sobre señal sintética con formantes conocidos', () => {
      const sampleRate = 24000;
      const analyzer = new FormantAnalyzer(12, sampleRate, 25);

      // Vocal /a/ sintética (F1 = 800 Hz, F2 = 1300 Hz, F3 = 2500 Hz)
      const targetF1 = 800;
      const targetF2 = 1300;
      const syntheticA = generateSyntheticVowel(targetF1, targetF2, 2500, sampleRate, 50, 100);

      // Tomar una ventana centrada de 25 ms (600 muestras)
      const frame = syntheticA.subarray(200, 800);
      const res = analyzer.analyzeFrame(frame);

      expect(res.rms).toBeGreaterThan(0.01);
      const errF1 = Math.abs(res.f1 - targetF1) / targetF1;
      const errF2 = Math.abs(res.f2 - targetF2) / targetF2;

      // Criterio Fase 5: Error relativo < 8%
      expect(errF1).toBeLessThan(0.08);
      expect(errF2).toBeLessThan(0.08);
    });

    it('identifica vocal /i/ anterior cerrada (F1 bajo ~300 Hz, F2 alto ~2200 Hz)', () => {
      const sampleRate = 24000;
      const analyzer = new FormantAnalyzer(12, sampleRate, 25);

      const targetF1 = 300;
      const targetF2 = 2200;
      const syntheticI = generateSyntheticVowel(targetF1, targetF2, 2800, sampleRate, 50, 100);

      const frame = syntheticI.subarray(200, 800);
      const res = analyzer.analyzeFrame(frame);

      expect(res.f1).toBeLessThan(450);
      expect(res.f2).toBeGreaterThan(1800);

      const visemes = analyzer.mapToVisemes(res);
      // /i/ debe tener mandíbula contenida y extensión lateral (mouthWide)
      expect(visemes.jawOpen).toBeLessThan(0.35);
      expect(visemes.mouthWide).toBeGreaterThan(0.20);
    });
  });

  describe('2. Modelo de Coarticulación Cohen–Massaro (1993)', () => {
    it('calcula la función de dominancia D(t) con gamma=1.5 y genera transiciones suaves', () => {
      const cm = new CohenMassaroCoarticulator();

      cm.enqueuePhoneme({
        name: 'A',
        time: 0.10,
        duration: 0.10,
        targets: { jawOpen: 0.8, mouthWide: 0.1 },
      });

      cm.enqueuePhoneme({
        name: 'I',
        time: 0.25,
        duration: 0.10,
        targets: { jawOpen: 0.2, mouthWide: 0.7 },
      });

      const res1 = cm.evaluate(0.10, ['jawOpen', 'mouthWide']);
      const val1 = res1['jawOpen']!;
      expect(val1).toBeGreaterThan(0.55);

      const res2 = cm.evaluate(0.175, ['jawOpen', 'mouthWide']);
      const val2 = res2['jawOpen']!;
      // En el punto medio entre /a/ e /i/, la apertura debe estar en transición suave
      expect(val2).toBeLessThan(val1);
      expect(val2).toBeGreaterThan(0.25);

      const res3 = cm.evaluate(0.25, ['jawOpen', 'mouthWide']);
      const val3 = res3['jawOpen']!;
      expect(val3).toBeLessThan(val2);
      expect(res3['mouthWide']!).toBeGreaterThan(0.45);
    });
  });

  describe('3. Criterio de Aceptación 3: Cierre de Bilabiales (/p, b, m/)', () => {
    it('al pronunciar "mamá", "pipa", "bobo", los labios se tocan (gap < 0.004·W) en >= 90% de las oclusivas', () => {
      const words = ['mamá', 'pipa', 'bobo'];
      const faceScale = 0.45;
      const W = faceScale * 0.35; // Ancho labial de referencia
      const maxAllowedGap = 0.004 * W;

      for (const word of words) {
        const scheduler = new VisemeScheduler();
        scheduler.enqueueText(word);

        // Configurar deformador de malla para medir la distancia real entre L13 y L14
        const basePositions = new Float32Array(500 * 3);
        const deformedPositions = new Float32Array(500 * 3);
        const uIdx = LANDMARK_INDICES.lipUpperInnerCenter; // 13
        const lIdx = LANDMARK_INDICES.lipLowerInnerCenter; // 14

        // En reposo con labios juntos
        basePositions[uIdx * 3 + 1] = 0.0;
        basePositions[lIdx * 3 + 1] = 0.0;

        const deformer = new PoseDeformer({
          basePositions,
          landmarkCount: 478,
          vertexCount: 478,
          indices: new Uint16Array(0),
          faceScale,
          rigVersion: 'v4',
        });

        // Simular ejecución temporal de la palabra con dos sílabas (cada una con oclusiva bilabial)
        const syl1Time = 0.05;
        const syl2Time = 0.20;

        scheduler.onSyllableTick(syl1Time);

        let totalOcclusionFrames = 0;
        let closedFrames = 0;

        // Evaluar durante la fase oclusiva de la primera sílaba (syl1Time a syl1Time + 0.04)
        for (let t = syl1Time; t <= syl1Time + 0.04; t += 0.005) {
          totalOcclusionFrames++;
          const targets = scheduler.update(t, { jawOpen: 0.4, mouthRound: 0, mouthWide: 0, smile: 0 });

          deformer.apply(deformedPositions, {
            jawOpen: targets.jawOpen,
            mouthRound: targets.mouthRound,
            mouthWide: targets.mouthWide,
            headYaw: 0,
            headPitch: 0,
            headRoll: 0,
          }, {
            mouthClose: targets.mouthClose,
            mouthPressLips: targets.mouthPressLips,
          });

          const y13 = deformedPositions[uIdx * 3 + 1]!;
          const y14 = deformedPositions[lIdx * 3 + 1]!;
          const gap = Math.max(0, y13 - y14);

          if (gap <= maxAllowedGap) {
            closedFrames++;
          }
        }

        // Pasar a la segunda sílaba
        scheduler.onSyllableTick(syl2Time);
        for (let t = syl2Time; t <= syl2Time + 0.04; t += 0.005) {
          totalOcclusionFrames++;
          const targets = scheduler.update(t, { jawOpen: 0.4, mouthRound: 0, mouthWide: 0, smile: 0 });

          deformer.apply(deformedPositions, {
            jawOpen: targets.jawOpen,
            mouthRound: targets.mouthRound,
            mouthWide: targets.mouthWide,
            headYaw: 0,
            headPitch: 0,
            headRoll: 0,
          }, {
            mouthClose: targets.mouthClose,
            mouthPressLips: targets.mouthPressLips,
          });

          const y13 = deformedPositions[uIdx * 3 + 1]!;
          const y14 = deformedPositions[lIdx * 3 + 1]!;
          const gap = Math.max(0, y13 - y14);

          if (gap <= maxAllowedGap) {
            closedFrames++;
          }
        }

        const closureRate = closedFrames / totalOcclusionFrames;
        // Criterio 3: >= 90% de los casos oclusivos con labios tocándose
        expect(closureRate).toBeGreaterThanOrEqual(0.90);
      }
    });
  });
});
