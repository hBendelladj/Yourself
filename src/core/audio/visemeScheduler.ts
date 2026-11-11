/**
 * visemeScheduler.ts
 *
 * Programador y Mezclador de Visemas en Español (Fase 3 / Sección 7.8):
 * - Consume la transcripción progresiva de salida (`outputAudioTranscription`) convertida en sílabas por `es-g2p.ts`.
 * - Sincronizado con los eventos de núcleo emitidos por `syllableClock.ts` y el reloj de audio `audioClock.ts`.
 * - Modela coarticulación articulatoria:
 *   - Onset consonántico anticipatorio (30–60 ms antes del pico de energía)
 *   - Núcleo vocálico centrado en el pico
 *   - Modulación tónica (+20% sílaba acentuada, -15% átona)
 *   - Cierres bilabiales herméticos en /m/, /b/, /p/, /v/
 *   - Labio inferior metido bajo los incisivos en /f/
 *   - Sibilantes /s/, /z/ con mandíbula contenida y dientes próximos
 * - Robustez ante contingencias de red:
 *   - Fallback suave al Nivel 1 (espectral) si la cola se vacía.
 *   - Resincronización automática si el desfase supera 600 ms.
 *   - Vaciado instantáneo (`flush()`) ante el evento `interrupted` de Gemini Live.
 */

import { SyllablePhonemes, textToSyllables, SpanishViseme } from './es-g2p';
import { VisemeWeights } from './lipsyncAnalyzer';
import { CohenMassaroCoarticulator } from './coarticulation';

export interface VisemeRigTargets {
  jawOpen: number;
  mouthRound: number;
  mouthWide: number;
  mouthClose: number;
  mouthPressLips: number;
  lowerLipTuck: number;
  mouthFunnel: number;
  mouthPucker: number;
  mouthSmileLeft: number;
  mouthSmileRight: number;
  tongueElevation: number;
  tongueProtrusion: number;
}

export class VisemeScheduler {
  // Cola de sílabas pendientes por pronunciar
  private syllableQueue: SyllablePhonemes[] = [];

  // Sílaba actualmente en ejecución
  private currentSyllable: SyllablePhonemes | null = null;
  private syllableStartTime = 0;
  private syllableDuration = 0.14; // ~140 ms por defecto
  private bilabialHoldTime = 0.06; // 60 ms de sello bilabial hermético (/m, b, p/)

  // Estado del planificador
  private isSpeaking = false;
  private lastAudioTime = 0;

  // Modelo de coarticulación continua de Cohen-Massaro
  public coarticulator = new CohenMassaroCoarticulator();

  // Búfer preasignado de salida para cero recolección de basura
  public currentTargets: VisemeRigTargets = {
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

  /**
   * Determina si hay sílabas activas o pendientes en la cola de coarticulación
   */
  public hasPendingSyllables(): boolean {
    return this.syllableQueue.length > 0 || this.currentSyllable !== null;
  }

  /**
   * Encola nuevo texto recibido de la transcripción de Gemini Live
   */
  public enqueueText(text: string): void {
    if (!text || text.trim().length === 0) return;

    const syllables = textToSyllables(text);
    for (let i = 0; i < syllables.length; i++) {
      this.syllableQueue.push(syllables[i]!);
    }
  }

  /**
   * Consume la siguiente sílaba al detectarse un nuevo núcleo por el SyllableClock
   */
  public onSyllableTick(audioTime: number): void {
    this.lastAudioTime = audioTime;

    // Si la cola se desfasó por más de 600 ms (ej. ráfaga de texto muy vieja), podar
    if (this.syllableQueue.length > 12) {
      this.syllableQueue.splice(0, this.syllableQueue.length - 8);
    }

    if (this.syllableQueue.length > 0) {
      this.currentSyllable = this.syllableQueue.shift()!;
      this.syllableStartTime = audioTime;
      this.isSpeaking = true;

      // Encolar en el coarticulador Cohen-Massaro con anticipación
      const syl = this.currentSyllable;
      const onsetV = syl.onsetVisemes[0] || syl.targetViseme;
      const nucleusV = syl.nucleusVisemes[0] || syl.targetViseme;
      const isBilabial = onsetV === 'MBP';

      const onsetTargets = this.getVisemeTargets(onsetV, syl.isTonic);
      this.coarticulator.enqueuePhoneme({
        name: onsetV,
        time: audioTime,
        duration: isBilabial ? 0.08 : 0.05,
        targets: onsetTargets as Record<string, number>,
        alphas: isBilabial ? { mouthClose: 16.0, jawOpen: 16.0, mouthPressLips: 12.0 } : undefined,
      });

      const nucleusTargets = this.getVisemeTargets(nucleusV, syl.isTonic);
      this.coarticulator.enqueuePhoneme({
        name: nucleusV,
        time: audioTime + 0.060,
        duration: 0.10,
        targets: nucleusTargets as Record<string, number>,
      });
    } else {
      this.currentSyllable = null;
    }
  }

  /**
   * Mapea un visema fonético español a los canales correspondientes del rig
   */
  private getVisemeTargets(viseme: SpanishViseme, isTonic = false): Partial<VisemeRigTargets> {
    const tonicMult = isTonic ? 1.20 : 0.85;

    switch (viseme) {
      case 'MBP':
        // Cierre total hermético bilabial (m, b, p, v) con sello mantenido (40-80 ms)
        return {
          jawOpen: 0,
          mouthClose: 0.95,
          mouthPressLips: 0.70,
          lowerLipTuck: 0,
          mouthWide: 0,
          mouthFunnel: 0,
          mouthPucker: 0,
          tongueElevation: 0,
          tongueProtrusion: 0,
        };

      case 'FV':
        // Labiodental (f, v): labio inferior contacta borde inferior de incisivos superiores
        return {
          jawOpen: 0.08,
          lowerLipTuck: 0.85,
          mouthClose: 0,
          mouthPressLips: 0,
          mouthWide: 0.25,
          mouthFunnel: 0,
          mouthPucker: 0,
          tongueElevation: 0.1,
          tongueProtrusion: 0,
        };

      case 'A':
        // Vocoide abierto: apertura profunda (0.85-0.95) y lengua baja
        return {
          jawOpen: Math.min(0.95, 0.85 * tonicMult),
          mouthWide: 0.15,
          mouthClose: 0,
          mouthPressLips: 0,
          lowerLipTuck: 0,
          mouthFunnel: 0,
          mouthPucker: 0,
          tongueElevation: 0,
          tongueProtrusion: 0,
        };

      case 'E':
        // Vocoide anterior medio: apertura moderada y retracción labial
        return {
          jawOpen: Math.min(0.65, 0.48 * tonicMult),
          mouthWide: 0.50,
          mouthClose: 0,
          mouthPressLips: 0,
          lowerLipTuck: 0,
          mouthFunnel: 0,
          mouthPucker: 0,
          tongueElevation: 0.25,
          tongueProtrusion: 0,
        };

      case 'I':
        // Vocoide anterior cerrado: apertura contenida y máxima retracción
        return {
          jawOpen: Math.min(0.40, 0.25 * tonicMult),
          mouthWide: 0.65,
          mouthClose: 0,
          mouthPressLips: 0,
          lowerLipTuck: 0,
          mouthFunnel: 0,
          mouthPucker: 0,
          tongueElevation: 0.40,
          tongueProtrusion: 0,
        };

      case 'O':
        // Vocoide posterior medio: apertura media y redondeo en embudo
        return {
          jawOpen: Math.min(0.60, 0.45 * tonicMult),
          mouthFunnel: 0.45,
          mouthPucker: 0.30,
          mouthRound: 0.65,
          mouthWide: 0,
          mouthClose: 0,
          mouthPressLips: 0,
          lowerLipTuck: 0,
          tongueElevation: 0.1,
          tongueProtrusion: 0,
        };

      case 'U':
        // Vocoide posterior cerrado: protrusión máxima calibrada con p95=0.80
        return {
          jawOpen: Math.min(0.40, 0.28 * tonicMult),
          mouthPucker: 0.80,
          mouthFunnel: 0.25,
          mouthRound: 0.70,
          mouthWide: 0,
          mouthClose: 0,
          mouthPressLips: 0,
          lowerLipTuck: 0,
          tongueElevation: 0.1,
          tongueProtrusion: 0,
        };

      case 'TDNL':
        // Consonantes alveolares / dentales (T, D, N, L): ápice lingual se eleva a la arcada superior
        return {
          jawOpen: 0.18,
          mouthWide: 0.18,
          mouthClose: 0,
          mouthPressLips: 0,
          lowerLipTuck: 0,
          mouthFunnel: 0,
          mouthPucker: 0,
          tongueElevation: 0.85,
          tongueProtrusion: 0.05,
        };

      case 'SZ':
        // Sibilantes y fricativas (S, Z): dientes frontales cerrados y lengua asoma levemente
        return {
          jawOpen: 0.06,
          mouthWide: 0.40,
          mouthClose: 0,
          mouthPressLips: 0,
          lowerLipTuck: 0,
          mouthFunnel: 0,
          mouthPucker: 0,
          tongueElevation: 0.35,
          tongueProtrusion: 0.40,
        };

      case 'CH_Y':
        return {
          jawOpen: 0.18,
          mouthFunnel: 0.25,
          mouthWide: 0.15,
          mouthClose: 0,
          mouthPressLips: 0,
          lowerLipTuck: 0,
          mouthPucker: 0,
          tongueElevation: 0.50,
          tongueProtrusion: 0,
        };

      case 'K_G_J':
        return {
          jawOpen: 0.30 * tonicMult,
          mouthWide: 0.14,
          mouthClose: 0,
          mouthPressLips: 0,
          lowerLipTuck: 0,
          mouthFunnel: 0,
          mouthPucker: 0,
          tongueElevation: 0.1,
          tongueProtrusion: 0,
        };

      case 'SIL':
      default:
        return {
          jawOpen: 0,
          mouthClose: 0,
          mouthPressLips: 0,
          lowerLipTuck: 0,
          mouthWide: 0,
          mouthRound: 0,
          mouthFunnel: 0,
          mouthPucker: 0,
          tongueElevation: 0,
          tongueProtrusion: 0,
        };
    }
  }

  /**
   * Actualiza y mezcla la trayectoria articulatoria para el instante `audioTime`
   * @param audioTime tiempo actual del reloj de audio en segundos
   * @param spectralVisemes visemas del analizador espectral (fallback / modulador de amplitud)
   */
  public update(
    audioTime: number,
    spectralVisemes: VisemeWeights
  ): VisemeRigTargets {
    const targets = this.currentTargets;

    // Si no hay sílaba activa planificada, depender del analizador espectral Nivel 1
    if (!this.currentSyllable) {
      targets.jawOpen = spectralVisemes.jawOpen;
      targets.mouthRound = spectralVisemes.mouthRound;
      targets.mouthWide = spectralVisemes.mouthWide;
      targets.mouthClose = 0;
      targets.mouthPressLips = 0;
      targets.lowerLipTuck = 0;
      targets.mouthFunnel = 0;
      targets.mouthPucker = 0;
      targets.tongueElevation = 0;
      targets.tongueProtrusion = 0;
      return targets;
    }

    const syl = this.currentSyllable;
    const elapsed = audioTime - this.syllableStartTime;
    const progress = Math.max(0, Math.min(1.0, elapsed / this.syllableDuration));

    // 1. Onset vocálico / consonántico
    const onsetViseme = syl.onsetVisemes[0] || syl.targetViseme;
    const nucleusViseme = syl.nucleusVisemes[0] || syl.targetViseme;
    const nextSyl = this.syllableQueue[0];
    const codaViseme = syl.codaVisemes[0] || (nextSyl
      ? (nextSyl.onsetVisemes[0] || nextSyl.targetViseme)
      : nucleusViseme);

    const onsetTargets = this.getVisemeTargets(onsetViseme, syl.isTonic);
    const nucleusTargets = this.getVisemeTargets(nucleusViseme, syl.isTonic);
    const codaTargets = this.getVisemeTargets(codaViseme, nextSyl ? nextSyl.isTonic : syl.isTonic);

    let plannedJaw = 0;
    let plannedWide = 0;
    let plannedRound = 0;
    let plannedClose = 0;
    let plannedPress = 0;
    let plannedTuck = 0;
    let plannedFunnel = 0;
    let plannedPucker = 0;
    let plannedTongueElev = 0;
    let plannedTongueProt = 0;

    const isBilabialOnset = onsetViseme === 'MBP';
    const isBilabialCoda = codaViseme === 'MBP';

    if (isBilabialOnset && progress < 0.60) {
      if (progress < 0.08) {
        // Retención hermética bilabial completa (/m, b, p/)
        plannedJaw = 0;
        plannedClose = onsetTargets.mouthClose ?? 0.98;
        plannedPress = onsetTargets.mouthPressLips ?? 0.75;
      } else {
        // Liberación suave y continua hacia el núcleo vocálico (coarticulación natural ~72 ms)
        const u = (progress - 0.08) / 0.52;
        const blend = u * u * (3 - 2 * u);

        plannedJaw = (nucleusTargets.jawOpen ?? 0) * blend;
        plannedWide = (nucleusTargets.mouthWide ?? 0) * blend;
        plannedRound = (nucleusTargets.mouthRound ?? 0) * blend;
        plannedClose = (onsetTargets.mouthClose ?? 0.98) * (1 - blend);
        plannedPress = (onsetTargets.mouthPressLips ?? 0.75) * (1 - blend);
        plannedTuck = (nucleusTargets.lowerLipTuck ?? 0) * blend;
        plannedFunnel = (nucleusTargets.mouthFunnel ?? 0) * blend;
        plannedPucker = (nucleusTargets.mouthPucker ?? 0) * blend;
        plannedTongueElev = (nucleusTargets.tongueElevation ?? 0) * blend;
        plannedTongueProt = (nucleusTargets.tongueProtrusion ?? 0) * blend;
      }
    } else if (progress < 0.30) {
      // Fase 1 estándar: Onset -> Núcleo con interpolación Hermite suave
      const u = progress / 0.30;
      const blend = u * u * (3 - 2 * u);

      plannedJaw = (onsetTargets.jawOpen ?? 0) * (1 - blend) + (nucleusTargets.jawOpen ?? 0) * blend;
      plannedWide = (onsetTargets.mouthWide ?? 0) * (1 - blend) + (nucleusTargets.mouthWide ?? 0) * blend;
      plannedRound = (onsetTargets.mouthRound ?? 0) * (1 - blend) + (nucleusTargets.mouthRound ?? 0) * blend;
      plannedClose = (onsetTargets.mouthClose ?? 0) * (1 - blend);
      plannedPress = (onsetTargets.mouthPressLips ?? 0) * (1 - blend);
      plannedTuck = (onsetTargets.lowerLipTuck ?? 0) * (1 - blend) + (nucleusTargets.lowerLipTuck ?? 0) * blend;
      plannedFunnel = (onsetTargets.mouthFunnel ?? 0) * (1 - blend) + (nucleusTargets.mouthFunnel ?? 0) * blend;
      plannedPucker = (onsetTargets.mouthPucker ?? 0) * (1 - blend) + (nucleusTargets.mouthPucker ?? 0) * blend;
      plannedTongueElev = (onsetTargets.tongueElevation ?? 0) * (1 - blend) + (nucleusTargets.tongueElevation ?? 0) * blend;
      plannedTongueProt = (onsetTargets.tongueProtrusion ?? 0) * (1 - blend) + (nucleusTargets.tongueProtrusion ?? 0) * blend;
    } else if (progress > 0.68) {
      if (isBilabialCoda) {
        if (progress > 0.90) {
          plannedJaw = 0;
          plannedClose = codaTargets.mouthClose ?? 0.98;
          plannedPress = codaTargets.mouthPressLips ?? 0.75;
        } else {
          const u = (progress - 0.68) / 0.22;
          const blend = u * u * (3 - 2 * u);

          plannedJaw = (nucleusTargets.jawOpen ?? 0) * (1 - blend);
          plannedWide = (nucleusTargets.mouthWide ?? 0) * (1 - blend);
          plannedRound = (nucleusTargets.mouthRound ?? 0) * (1 - blend);
          plannedClose = (codaTargets.mouthClose ?? 0.98) * blend;
          plannedPress = (codaTargets.mouthPressLips ?? 0.75) * blend;
          plannedTuck = (nucleusTargets.lowerLipTuck ?? 0) * (1 - blend);
          plannedFunnel = (nucleusTargets.mouthFunnel ?? 0) * (1 - blend);
          plannedPucker = (nucleusTargets.mouthPucker ?? 0) * (1 - blend);
          plannedTongueElev = (nucleusTargets.tongueElevation ?? 0) * (1 - blend);
          plannedTongueProt = (nucleusTargets.tongueProtrusion ?? 0) * (1 - blend);
        }
      } else {
        // Fase 3 estándar: Núcleo -> Coda o Anticipación de la siguiente sílaba
        const u = (progress - 0.68) / 0.32;
        const blend = u * u * (3 - 2 * u);

        plannedJaw = (nucleusTargets.jawOpen ?? 0) * (1 - blend) + (codaTargets.jawOpen ?? 0) * blend;
        plannedWide = (nucleusTargets.mouthWide ?? 0) * (1 - blend) + (codaTargets.mouthWide ?? 0) * blend;
        plannedRound = (nucleusTargets.mouthRound ?? 0) * (1 - blend) + (codaTargets.mouthRound ?? 0) * blend;
        plannedClose = (codaTargets.mouthClose ?? 0) * blend;
        plannedPress = (codaTargets.mouthPressLips ?? 0) * blend;
        plannedTuck = (nucleusTargets.lowerLipTuck ?? 0) * (1 - blend) + (codaTargets.lowerLipTuck ?? 0) * blend;
        plannedFunnel = (nucleusTargets.mouthFunnel ?? 0) * (1 - blend) + (codaTargets.mouthFunnel ?? 0) * blend;
        plannedPucker = (nucleusTargets.mouthPucker ?? 0) * (1 - blend) + (codaTargets.mouthPucker ?? 0) * blend;
        plannedTongueElev = (nucleusTargets.tongueElevation ?? 0) * (1 - blend) + (codaTargets.tongueElevation ?? 0) * blend;
        plannedTongueProt = (nucleusTargets.tongueProtrusion ?? 0) * (1 - blend) + (codaTargets.tongueProtrusion ?? 0) * blend;
      }
    } else {
      // Fase 2: Pleno núcleo vocálico
      plannedJaw = nucleusTargets.jawOpen ?? 0;
      plannedWide = nucleusTargets.mouthWide ?? 0;
      plannedRound = nucleusTargets.mouthRound ?? 0;
      plannedClose = 0;
      plannedPress = 0;
      plannedTuck = nucleusTargets.lowerLipTuck ?? 0;
      plannedFunnel = nucleusTargets.mouthFunnel ?? 0;
      plannedPucker = nucleusTargets.mouthPucker ?? 0;
      plannedTongueElev = nucleusTargets.tongueElevation ?? 0;
      plannedTongueProt = nucleusTargets.tongueProtrusion ?? 0;
    }

    // Si la sílaba concluyó su duración temporal, avanzar a la siguiente o finalizar
    if (progress >= 1.0) {
      if (this.syllableQueue.length > 0) {
        this.currentSyllable = this.syllableQueue.shift()!;
        this.syllableStartTime = audioTime;
      } else {
        this.currentSyllable = null;
        this.isSpeaking = false;
      }
    }

    // Mezcla ponderada: 75% fonética planificada + 25% envolvente de audio
    const spectralWeight = 0.25;
    const plannedWeight = 0.75;
    const volumeMod = Math.max(0.5, Math.min(1.4, spectralVisemes.jawOpen * 2.5 + 0.3));

    // Si hay cierre labial planificado (bilabiales / pausas >= 0.90), suprimir apertura del audio espectral
    const closeSup = plannedClose >= 0.90 ? 0 : Math.max(0, 1.0 - plannedClose / 0.90);

    const spectralJaw = spectralVisemes.jawOpen * spectralWeight * closeSup;
    targets.jawOpen = Math.min(0.95, plannedJaw * volumeMod * plannedWeight + spectralJaw);

    const spectralWide = spectralVisemes.mouthWide * spectralWeight * closeSup;
    targets.mouthWide = Math.min(1.0, plannedWide * plannedWeight + spectralWide);
    targets.mouthRound = Math.min(1.0, plannedRound * plannedWeight + spectralVisemes.mouthRound * spectralWeight);
    targets.mouthClose = plannedClose;
    targets.mouthPressLips = plannedPress;
    targets.lowerLipTuck = plannedTuck;
    targets.mouthFunnel = plannedFunnel;
    targets.mouthPucker = plannedPucker;
    targets.tongueElevation = plannedTongueElev;
    targets.tongueProtrusion = plannedTongueProt;

    return targets;
  }

  /**
   * Vacía inmediatamente la cola ante interrupciones (interrupted) o fin de turno (turnComplete)
   */
  public flush(): void {
    this.syllableQueue.length = 0;
    this.currentSyllable = null;
    this.isSpeaking = false;
    this.coarticulator.flush();

    // Restablecer valores de reposo
    this.currentTargets.jawOpen = 0;
    this.currentTargets.mouthRound = 0;
    this.currentTargets.mouthWide = 0;
    this.currentTargets.mouthClose = 0;
    this.currentTargets.mouthPressLips = 0;
    this.currentTargets.lowerLipTuck = 0;
    this.currentTargets.mouthFunnel = 0;
    this.currentTargets.mouthPucker = 0;
    this.currentTargets.tongueElevation = 0;
    this.currentTargets.tongueProtrusion = 0;
  }

  public getQueueLength(): number {
    return this.syllableQueue.length;
  }
}
