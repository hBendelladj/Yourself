/**
 * emotion.ts
 *
 * Estimador heurístico de emoción y generador de expresiones faciales (Fase 4 / Sección 7.7):
 * - Espacio afectivo continuo bidimensional (Circumplex de Russell):
 *   - Valence [-1.0 .. +1.0] (negatividad vs positividad)
 *   - Arousal [0.0 .. +1.0] (calma vs activación/intensidad)
 * - Interpolación radial suave (RBF 2D) entre 7 presets de expresión
 *   (neutral, alegre, triste, sorprendido, pensativo, empático, divertido).
 * - Análisis heurístico de texto en español (palabras clave + signos de puntuación ¿? ¡! ...).
 * - Modulación por prosodia acústica (varianza de F0 y energía RMS).
 * - Relajación temporal suave hacia la línea base sin saltos abruptos.
 * - Cero asignaciones de memoria dinámicas por fotograma.
 */

import { EmotionSource, PoseValues } from './animationState';
import { ProsodyFeatures } from '../audio/prosodyAnalyzer';

export interface EmotionState {
  valence: number; // -1 (triste/negativo) a +1 (alegre/positivo)
  arousal: number; // 0 (calma/letargo) a 1 (máxima activación/expresividad)
}

export interface EmotionExpressionTargets {
  smile: number;
  cheekRaise: number;
  eyeSquint: number;
  browRaise: number;
  browInnerUp: number;
  browOuterUp: number;
  browDown: number;
  mouthFrown: number;
  mouthDimple: number;
  jawOpen: number;
}

interface EmotionPreset {
  name: string;
  valence: number;
  arousal: number;
  targets: EmotionExpressionTargets;
}

const EMOTION_PRESETS: EmotionPreset[] = [
  {
    name: 'neutral',
    valence: 0.0,
    arousal: 0.15,
    targets: {
      smile: 0.02,
      cheekRaise: 0.0,
      eyeSquint: 0.0,
      browRaise: 0.0,
      browInnerUp: 0.0,
      browOuterUp: 0.0,
      browDown: 0.0,
      mouthFrown: 0.0,
      mouthDimple: 0.0,
      jawOpen: 0.0,
    },
  },
  {
    name: 'alegre',
    valence: 0.80,
    arousal: 0.65,
    targets: {
      smile: 0.65,
      cheekRaise: 0.45,
      eyeSquint: 0.22,
      browRaise: 0.12,
      browInnerUp: 0.0,
      browOuterUp: 0.15,
      browDown: 0.0,
      mouthFrown: 0.0,
      mouthDimple: 0.25,
      jawOpen: 0.0,
    },
  },
  {
    name: 'triste',
    valence: -0.75,
    arousal: 0.20,
    targets: {
      smile: 0.0,
      cheekRaise: 0.0,
      eyeSquint: 0.0,
      browRaise: 0.0,
      browInnerUp: 0.55,
      browOuterUp: 0.0,
      browDown: 0.25,
      mouthFrown: 0.45,
      mouthDimple: 0.0,
      jawOpen: 0.0,
    },
  },
  {
    name: 'sorprendido',
    valence: 0.25,
    arousal: 0.90,
    targets: {
      smile: 0.10,
      cheekRaise: 0.10,
      eyeSquint: 0.0,
      browRaise: 0.48,
      browInnerUp: 0.65,
      browOuterUp: 0.65,
      browDown: 0.0,
      mouthFrown: 0.0,
      mouthDimple: 0.0,
      jawOpen: 0.12,
    },
  },
  {
    name: 'pensativo',
    valence: -0.25,
    arousal: 0.38,
    targets: {
      smile: 0.0,
      cheekRaise: 0.0,
      eyeSquint: 0.15,
      browRaise: 0.0,
      browInnerUp: 0.10,
      browOuterUp: 0.0,
      browDown: 0.35,
      mouthFrown: 0.0,
      mouthDimple: 0.20,
      jawOpen: 0.0,
    },
  },
  {
    name: 'empatico',
    valence: 0.50,
    arousal: 0.35,
    targets: {
      smile: 0.35,
      cheekRaise: 0.20,
      eyeSquint: 0.08,
      browRaise: 0.15,
      browInnerUp: 0.28,
      browOuterUp: 0.10,
      browDown: 0.0,
      mouthFrown: 0.0,
      mouthDimple: 0.12,
      jawOpen: 0.0,
    },
  },
  {
    name: 'divertido',
    valence: 0.88,
    arousal: 0.85,
    targets: {
      smile: 0.85,
      cheekRaise: 0.60,
      eyeSquint: 0.35,
      browRaise: 0.20,
      browInnerUp: 0.0,
      browOuterUp: 0.25,
      browDown: 0.0,
      mouthFrown: 0.0,
      mouthDimple: 0.35,
      jawOpen: 0.05,
    },
  },
];

// Diccionarios heurísticos de sentimiento en español
const POSITIVE_WORDS = [
  'gracias', 'genial', 'excelente', 'perfecto', 'alegria', 'alegría', 'feliz',
  'felicidad', 'bien', 'fantastico', 'fantástico', 'maravilloso', 'maravillosa',
  'encanta', 'encantador', 'contento', 'contenta', 'claro', 'estupendo', 'estupenda',
  'gusto', 'bienvenida', 'bienvenido', 'hola', 'amigo', 'amiga', 'exacto',
  'super', 'súper', 'bueno', 'buena', 'buenisimo', 'buenísimo', 'maravilla',
  'increible', 'increíble', 'éxito', 'exito', 'celebrar', 'logro', 'optimista',
];

const NEGATIVE_WORDS = [
  'triste', 'tristeza', 'pena', 'lastima', 'lástima', 'mal', 'malo', 'mala',
  'dolor', 'doloroso', 'error', 'problema', 'fallo', 'fracaso', 'desastre',
  'disculpa', 'perdon', 'perdón', 'siento', 'terrible', 'dificil', 'difícil',
  'peligro', 'miedo', 'temor', 'preocupado', 'preocupada', 'preocupacion', 'preocupación',
  'lagrima', 'lágrima', 'llorar', 'enojo', 'molesto', 'molesta', 'horrible', 'fatal',
  'lamento', 'angustia', 'decepcion', 'decepción',
];

const SURPRISE_WORDS = [
  'wow', 'uau', 'guau', 'increible', 'increíble', 'sorpresa', 'sorprendente',
  'verdad', 'serio', 'jamas', 'jamás', 'caramba', 'impresionante', 'inesperado',
  'inesperada', 'dios', 'ostras', 'cielos', 'asombroso', 'asombro', 'alucinante',
];

const THOUGHTFUL_WORDS = [
  'interesante', 'veamos', 'pensar', 'pensando', 'quizas', 'quizás', 'tal vez',
  'analizar', 'análisis', 'analizando', 'supongo', 'considero', 'considerando',
  'duda', 'dudoso', 'posible', 'posiblemente', 'pregunta', 'curiosidad', 'depende',
  'entender', 'reflexionar', 'reflexión', 'evaluar', 'examinar', 'hipótesis',
];

const EMPATHIC_WORDS = [
  'entiendo', 'te entiendo', 'comprendo', 'te comprendo', 'cuenta conmigo',
  'aqui estoy', 'aquí estoy', 'animo', 'ánimo', 'abrazo', 'un abrazo',
  'tranquilo', 'tranquila', 'preocupes', 'no te preocupes', 'apoyo',
  'estoy contigo', 'calma', 'ten calma', 'paz', 'solidaridad', 'cuídate',
];

const FUN_WORDS = [
  'jaja', 'jajaja', 'jajajaja', 'jeje', 'jejeje', 'risa', 'reir', 'reír',
  'chiste', 'divertido', 'divertida', 'gracioso', 'graciosa', 'humor',
  'broma', 'bromeando', 'cómico', 'cómica', 'carcajada', 'carcajadas',
];

export class EmotionEstimator implements EmotionSource {
  // Estado actual suave y objetivo
  public current: EmotionState = { valence: 0.0, arousal: 0.15 };
  public target: EmotionState = { valence: 0.0, arousal: 0.15 };

  // Offset manual tipo VASA-1
  public offset: EmotionState = { valence: 0.0, arousal: 0.0 };

  // Sensibilidad a estímulos (Fase C: calibrable desde UI de depuración 0.5 .. 2.0)
  public sensitivity = 1.0;

  // Nombre de la emoción dominante actual en el espacio Russell 2D
  public currentEmotionName = 'neutral';

  // Metas calculadas de expresión preasignadas
  public blendedTargets: EmotionExpressionTargets = {
    smile: 0,
    cheekRaise: 0,
    eyeSquint: 0,
    browRaise: 0,
    browInnerUp: 0,
    browOuterUp: 0,
    browDown: 0,
    mouthFrown: 0,
    mouthDimple: 0,
    jawOpen: 0,
  };

  // Pesos temporales para cada preset
  private presetWeights = new Float32Array(EMOTION_PRESETS.length);

  // Constante de relajación hacia la línea base neutra
  private readonly baselineValence = 0.0;
  private readonly baselineArousal = 0.15;
  private timeSinceLastStimulus = 0;

  public setSensitivity(s: number): void {
    this.sensitivity = Math.max(0.5, Math.min(2.0, s));
  }

  public getSensitivity(): number {
    return this.sensitivity;
  }

  /**
   * Procesa texto entrante en español para ajustar la emoción estimada
   */
  public processText(text: string): void {
    if (!text || text.length === 0) return;
    this.timeSinceLastStimulus = 0;

    const lower = text.toLowerCase();
    const sens = this.sensitivity;

    // 1. Detección de signos de puntuación
    if (lower.includes('?') || lower.includes('¿')) {
      // Pregunta: curiosidad, cejas y activación moderada
      this.target.arousal = Math.max(this.target.arousal, 0.40 + 0.15 * sens);
      if (this.target.valence < 0.1) {
        this.target.valence = Math.min(0.3, this.target.valence + 0.15 * sens);
      }
    }

    if (lower.includes('!') || lower.includes('¡')) {
      // Exclamación: alta activación
      this.target.arousal = Math.min(1.0, this.target.arousal + 0.35 * sens);
      if (this.target.valence >= 0) {
        this.target.valence = Math.min(1.0, this.target.valence + 0.25 * sens);
      } else {
        this.target.valence = Math.max(-1.0, this.target.valence - 0.20 * sens);
      }
    }

    if (lower.includes('...')) {
      // Puntos suspensivos: tono reflexivo/pensativo
      this.target.arousal = 0.22;
      this.target.valence = Math.max(-0.2, Math.min(0.1, this.target.valence));
    }

    // 2. Lexicón de palabras
    let matchPos = 0;
    let matchNeg = 0;
    let matchSur = 0;
    let matchTho = 0;
    let matchEmp = 0;
    let matchFun = 0;

    for (const w of FUN_WORDS) {
      if (lower.includes(w)) matchFun++;
    }
    for (const w of POSITIVE_WORDS) {
      if (lower.includes(w)) matchPos++;
    }
    for (const w of NEGATIVE_WORDS) {
      if (lower.includes(w)) matchNeg++;
    }
    for (const w of SURPRISE_WORDS) {
      if (lower.includes(w)) matchSur++;
    }
    for (const w of THOUGHTFUL_WORDS) {
      if (lower.includes(w)) matchTho++;
    }
    for (const w of EMPATHIC_WORDS) {
      if (lower.includes(w)) matchEmp++;
    }

    if (matchFun > 0) {
      this.target.valence = Math.min(1.0, Math.max(0.80, this.target.valence + 0.45 * matchFun * sens));
      this.target.arousal = Math.min(1.0, Math.max(0.75, this.target.arousal + 0.35 * matchFun * sens));
    } else if (matchPos > 0) {
      this.target.valence = Math.min(0.85, Math.max(0.70, this.target.valence + 0.35 * matchPos * sens));
      this.target.arousal = Math.min(0.68, Math.max(0.45, this.target.arousal + 0.20 * matchPos * sens));
    }

    if (matchNeg > 0) {
      this.target.valence = Math.max(-1.0, this.target.valence - 0.45 * matchNeg * sens);
      this.target.arousal = Math.max(0.15, this.target.arousal - 0.1 * matchNeg * sens);
    }
    if (matchSur > 0) {
      this.target.arousal = Math.min(1.0, this.target.arousal + 0.45 * matchSur * sens);
      this.target.valence = Math.min(0.6, Math.max(-0.2, this.target.valence + 0.15 * sens));
    }
    if (matchTho > 0) {
      this.target.arousal = 0.38;
      this.target.valence = -0.25 * sens;
    }
    if (matchEmp > 0) {
      this.target.valence = Math.max(0.45, Math.min(0.65, this.target.valence + 0.35 * sens));
      this.target.arousal = 0.35;
    }
  }

  /**
   * Modula la emoción a partir de las características acústicas y prosódicas
   */
  public processProsody(prosody: ProsodyFeatures): void {
    if (prosody.isVoiced && prosody.energy > 0.03) {
      this.timeSinceLastStimulus = 0;
      // Varianza alta de pitch + alta energía => animación y expresividad
      if (prosody.pitchVariance > 25.0) {
        const boost = Math.min(0.35, (prosody.pitchVariance - 25.0) * 0.015) * this.sensitivity;
        this.target.arousal = Math.min(1.0, Math.max(this.target.arousal, 0.4 + boost));
      }

      // Pendiente de pitch positiva marcada (entonación interrogativa o énfasis ascendente)
      if (prosody.pitchSlope > 35.0) {
        this.target.arousal = Math.min(1.0, this.target.arousal + 0.15 * this.sensitivity);
      }
    }
  }

  /**
   * Establece explícitamente un estado emocional objetivo (ej. vía Gemini Live tools o presets)
   */
  public setEmotion(valence: number, arousal: number, immediate = false): void {
    this.target.valence = Math.max(-1.0, Math.min(1.0, valence));
    this.target.arousal = Math.max(0.0, Math.min(1.0, arousal));
    if (immediate) {
      this.current.valence = this.target.valence;
      this.current.arousal = this.target.arousal;
    }
    this.timeSinceLastStimulus = 0;
  }

  /**
   * Actualiza el estado emocional continuo y evalúa la interpolación RBF
   */
  public update(deltaSeconds: number): EmotionExpressionTargets {
    this.timeSinceLastStimulus += deltaSeconds;

    // Relajación suave hacia la línea base si no hay nuevos estímulos por más de 1.8 segundos
    if (this.timeSinceLastStimulus > 1.8) {
      const decayRate = 1.0 * deltaSeconds;
      this.target.valence += (this.baselineValence - this.target.valence) * decayRate;
      this.target.arousal += (this.baselineArousal - this.target.arousal) * decayRate;
    }

    // Suavizado continuo de segundo orden / filtro crítico
    const kSmooth = 3.5;
    const alpha = 1.0 - Math.exp(-kSmooth * deltaSeconds);
    this.current.valence += (this.target.valence - this.current.valence) * alpha;
    this.current.arousal += (this.target.arousal - this.current.arousal) * alpha;

    // Aplicar offset tipo VASA-1
    const effValence = Math.max(-1.0, Math.min(1.0, this.current.valence + this.offset.valence));
    const effArousal = Math.max(0.0, Math.min(1.0, this.current.arousal + this.offset.arousal));

    // Evaluar RBF 2D sobre todos los presets con sigmas calibrados para evitar sangrado residual
    let weightSum = 0;
    const sigmaV = 0.36;
    const sigmaA = 0.32;

    for (let i = 0; i < EMOTION_PRESETS.length; i++) {
      const p = EMOTION_PRESETS[i]!;
      const dv = (effValence - p.valence) / sigmaV;
      const da = (effArousal - p.arousal) / sigmaA;
      const distSq = dv * dv + da * da;
      const w = Math.exp(-0.5 * distSq);
      this.presetWeights[i] = w;
      weightSum += w;
    }

    const invSum = weightSum > 1e-5 ? 1.0 / weightSum : 1.0;

    // Reiniciar metas preasignadas
    this.blendedTargets.smile = 0;
    this.blendedTargets.cheekRaise = 0;
    this.blendedTargets.eyeSquint = 0;
    this.blendedTargets.browRaise = 0;
    this.blendedTargets.browInnerUp = 0;
    this.blendedTargets.browOuterUp = 0;
    this.blendedTargets.browDown = 0;
    this.blendedTargets.mouthFrown = 0;
    this.blendedTargets.mouthDimple = 0;
    this.blendedTargets.jawOpen = 0;

    let maxWeight = -1;
    let dominantName = 'neutral';

    for (let i = 0; i < EMOTION_PRESETS.length; i++) {
      const nw = this.presetWeights[i]! * invSum;
      if (nw > maxWeight) {
        maxWeight = nw;
        dominantName = EMOTION_PRESETS[i]!.name;
      }
      if (nw < 0.001) continue;
      const t = EMOTION_PRESETS[i]!.targets;
      this.blendedTargets.smile += t.smile * nw;
      this.blendedTargets.cheekRaise += t.cheekRaise * nw;
      this.blendedTargets.eyeSquint += t.eyeSquint * nw;
      this.blendedTargets.browRaise += t.browRaise * nw;
      this.blendedTargets.browInnerUp += t.browInnerUp * nw;
      this.blendedTargets.browOuterUp += t.browOuterUp * nw;
      this.blendedTargets.browDown += t.browDown * nw;
      this.blendedTargets.mouthFrown += t.mouthFrown * nw;
      this.blendedTargets.mouthDimple += t.mouthDimple * nw;
      this.blendedTargets.jawOpen += t.jawOpen * nw;
    }

    this.currentEmotionName = dominantName;

    // Umbral de corte de colas RBF para garantizar neutralidad limpia en reposo
    if (dominantName === 'neutral') {
      if (this.blendedTargets.mouthFrown < 0.15) this.blendedTargets.mouthFrown = 0;
      if (this.blendedTargets.browDown < 0.15) this.blendedTargets.browDown = 0;
    } else {
      if (this.blendedTargets.mouthFrown < 0.03) this.blendedTargets.mouthFrown = 0;
      if (this.blendedTargets.browDown < 0.03) this.blendedTargets.browDown = 0;
    }

    return this.blendedTargets;
  }

  /**
   * Implementación de EmotionSource para compatibilidad
   */
  public getEmotionValues(): Partial<Pick<PoseValues, 'smile' | 'browRaise'>> {
    return {
      smile: this.blendedTargets.smile,
      browRaise: this.blendedTargets.browRaise,
    };
  }
}
