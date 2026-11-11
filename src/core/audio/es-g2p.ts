/**
 * es-g2p.ts
 *
 * Conversor Grafema a Fonema y Visema en Español (G2P) para Lip-Sync V2 (Fase 3 / Apéndice B):
 * - El español es una lengua eminentemente fonética, lo que permite reglas analíticas de alta fidelidad sin modelos pesados.
 * - Clasifica cada grafema/fonema en 12 visemas canónicos:
 *   SIL, MBP, FV, A, E, I, O, U, TDNL, SZ, CH_Y, K_G_J.
 * - Reglas ortográficas y fonotácticas:
 *   - 'h' muda.
 *   - 'qu' y 'gu' (+ e/i): 'u' muda salvo diéresis ('gü').
 *   - 'v' = 'b' (cierre bilabial idéntico).
 *   - 'c' y 'g' dependientes del contexto vocálico (suave / fuerte).
 *   - 'll', 'ch', 'ñ' y 'y' (consonántica vs vocálica).
 * - Silabificación fonotáctica del español con detección de diptongos e hiatos.
 * - Identificación de sílaba tónica (por tilde ortográfica o regla de penúltima/última sílaba)
 *   para modulación articulatoria de amplitud (+20% tónica, -15% átona).
 */

export type SpanishViseme =
  | 'SIL'
  | 'MBP'   // m, b, p, v, w inicial (cierre total bilabial)
  | 'FV'    // f (labio inferior bajo incisivos superiores)
  | 'A'     // a, á (mandíbula abierta, ancho neutro)
  | 'E'     // e, é (apertura media, comisuras expandidas)
  | 'I'     // i, í, y vocálica (apertura pequeña, comisuras extendidas)
  | 'O'     // o, ó (apertura media, labios redondeados)
  | 'U'     // u, ú (apertura pequeña, proyección labial)
  | 'TDNL'  // t, d, n, l, r, rr (dientes próximos, lengua)
  | 'SZ'    // s, z, c (ante e/i), x (dientes juntos, mandíbula contenida)
  | 'CH_Y'  // ch, y consonántica, ll, ñ (labios proyectados/estrechos)
  | 'K_G_J'; // k, qu, c (ante a/o/u), g, j (apertura media sin cierre labial)

export interface SyllablePhonemes {
  rawText: string;
  onsetVisemes: SpanishViseme[];    // Consonantes antes del núcleo vocálico
  nucleusVisemes: SpanishViseme[];  // Vocales del núcleo (1 vocal o 2 en diptongo)
  codaVisemes: SpanishViseme[];     // Consonantes posteriores
  isTonic: boolean;                 // Sílaba tónica (mayor acento articulatorio)
  targetViseme: SpanishViseme;      // Visema representativo principal para la animación
}

const STRONG_VOWELS = new Set(['a', 'e', 'o', 'á', 'é', 'ó']);
const ACCENTED_WEAK = new Set(['í', 'ú']);
const ALL_VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'á', 'é', 'í', 'ó', 'ú', 'ü', 'y']);

/**
 * Determina si un carácter es una vocal en español
 */
export function isVowel(ch: string): boolean {
  return ALL_VOWELS.has(ch.toLowerCase());
}

/**
 * Silabificación fonotáctica básica para español
 */
export function syllabifyWord(rawWord: string): { syllables: string[]; tonicIndex: number } {
  const word = rawWord.toLowerCase();
  const len = word.length;
  if (len === 0) return { syllables: [], tonicIndex: 0 };
  if (len <= 2) return { syllables: [word], tonicIndex: 0 };

  const syllables: string[] = [];
  let current = '';

  let i = 0;
  while (i < len) {
    const ch = word[i]!;
    current += ch;

    // Si encontramos una vocal, inspeccionar si forma diptongo o termina la sílaba
    if (isVowel(ch)) {
      // Verificar si hay vocal siguiente para posible diptongo o hiato
      if (i + 1 < len && isVowel(word[i + 1]!)) {
        const nextV = word[i + 1]!;
        const isHiatus =
          ACCENTED_WEAK.has(ch) ||
          ACCENTED_WEAK.has(nextV) ||
          (STRONG_VOWELS.has(ch) && STRONG_VOWELS.has(nextV));

        if (!isHiatus) {
          // Diptongo: absorber siguiente vocal en la misma sílaba
          current += nextV;
          i++;
        }
      }

      // Analizar consonantes siguientes hasta la próxima vocal
      let nextVowelIdx = -1;
      for (let j = i + 1; j < len; j++) {
        if (isVowel(word[j]!)) {
          nextVowelIdx = j;
          break;
        }
      }

      if (nextVowelIdx === -1) {
        // No hay más vocales: el resto de la palabra pertenece a esta sílaba
        current += word.slice(i + 1);
        syllables.push(current);
        current = '';
        break;
      } else {
        const consonantsBetween = nextVowelIdx - (i + 1);
        if (consonantsBetween === 0) {
          // Hiato inmediato
          syllables.push(current);
          current = '';
        } else if (consonantsBetween === 1) {
          // 1 consonante: se va con la siguiente sílaba (ej. ca-sa)
          syllables.push(current);
          current = '';
        } else if (consonantsBetween === 2) {
          const c1 = word[i + 1]!;
          const c2 = word[i + 2]!;

          // Dígrafos inseparables ('ch', 'll', 'rr')
          const isDigraph = (c1 === 'c' && c2 === 'h') || (c1 === 'l' && c2 === 'l') || (c1 === 'r' && c2 === 'r');
          // Grupos consonánticos inseparables (pl, pr, bl, br, fl, fr, cl, cr, gl, gr, tr, dr)
          const isInseparableCluster =
            ('pbcfg'.includes(c1) && 'lr'.includes(c2)) ||
            ('td'.includes(c1) && c2 === 'r');

          if (isDigraph || isInseparableCluster) {
            // Ambas van con la siguiente sílaba
            syllables.push(current);
            current = '';
          } else {
            // Se dividen (ej. ac-to, in-ten-so)
            current += c1;
            syllables.push(current);
            current = '';
            i++;
          }
        } else {
          // 3 o más consonantes: generalmente las 2 primeras se quedan o 1 y 2
          current += word[i + 1]!;
          syllables.push(current);
          current = '';
          i++;
        }
      }
    }

    i++;
  }

  if (current.length > 0) {
    if (syllables.length > 0) {
      syllables[syllables.length - 1] += current;
    } else {
      syllables.push(current);
    }
  }

  // Identificar la sílaba tónica
  let tonicIndex = -1;

  // 1. Regla de tilde ortográfica
  for (let s = 0; s < syllables.length; s++) {
    if (/[áéíóú]/.test(syllables[s]!)) {
      tonicIndex = s;
      break;
    }
  }

  // 2. Si no hay tilde explícita:
  if (tonicIndex === -1) {
    const lastSyl = syllables[syllables.length - 1] || '';
    const lastChar = lastSyl[lastSyl.length - 1] || '';

    if (syllables.length === 1) {
      tonicIndex = 0;
    } else if (ALL_VOWELS.has(lastChar) || lastChar === 'n' || lastChar === 's') {
      // Palabra llana (penúltima sílaba es tónica)
      tonicIndex = syllables.length - 2;
    } else {
      // Palabra aguda (última sílaba es tónica)
      tonicIndex = syllables.length - 1;
    }
  }

  return { syllables, tonicIndex: Math.max(0, tonicIndex) };
}

/**
 * Convierte una secuencia de grafemas a su lista de visemas fonéticos
 */
export function graphemesToVisemes(text: string): SpanishViseme[] {
  const visemes: SpanishViseme[] = [];
  const s = text.toLowerCase();
  const len = s.length;

  let i = 0;
  while (i < len) {
    const ch = s[i]!;
    const next = i + 1 < len ? s[i + 1]! : '';
    const next2 = i + 2 < len ? s[i + 2]! : '';

    // Espacios o puntuación -> SIL
    if (/[\s,.;:!?—\-_]/.test(ch)) {
      visemes.push('SIL');
      i++;
      continue;
    }

    // 'ch' -> CH_Y
    if (ch === 'c' && next === 'h') {
      visemes.push('CH_Y');
      i += 2;
      continue;
    }

    // 'll' -> CH_Y
    if (ch === 'l' && next === 'l') {
      visemes.push('CH_Y');
      i += 2;
      continue;
    }

    // 'rr' -> TDNL
    if (ch === 'r' && next === 'r') {
      visemes.push('TDNL');
      i += 2;
      continue;
    }

    // 'qu' (+ e / i) -> K_G_J (u es muda)
    if (ch === 'q' && next === 'u') {
      visemes.push('K_G_J');
      i += 2; // se salta la 'u'
      continue;
    }

    // 'gu' (+ e / i): u muda salvo si es 'gü'
    if (ch === 'g' && next === 'u' && (next2 === 'e' || next2 === 'i')) {
      visemes.push('K_G_J');
      i += 2; // se salta la 'u'
      continue;
    }

    // 'gü' -> K_G_J seguido de U
    if (ch === 'g' && next === 'ü') {
      visemes.push('K_G_J');
      visemes.push('U');
      i += 2;
      continue;
    }

    // 'h' es siempre muda en español
    if (ch === 'h') {
      i++;
      continue;
    }

    // Bilabiales: 'm', 'b', 'p', 'v' (en español v = b)
    if (ch === 'm' || ch === 'b' || ch === 'p' || ch === 'v') {
      visemes.push('MBP');
      i++;
      continue;
    }

    // Labiodental: 'f'
    if (ch === 'f') {
      visemes.push('FV');
      i++;
      continue;
    }

    // Dentales / Alveolares: 't', 'd', 'n', 'l', 'r'
    if (ch === 't' || ch === 'd' || ch === 'n' || ch === 'l' || ch === 'r') {
      visemes.push('TDNL');
      i++;
      continue;
    }

    // Sibilantes: 's', 'z', 'x'
    if (ch === 's' || ch === 'z' || ch === 'x') {
      visemes.push('SZ');
      i++;
      continue;
    }

    // 'c' ante e/i es sibilante ('SZ'), ante a/o/u o consonante es velar ('K_G_J')
    if (ch === 'c') {
      if (next === 'e' || next === 'i' || next === 'é' || next === 'í') {
        visemes.push('SZ');
      } else {
        visemes.push('K_G_J');
      }
      i++;
      continue;
    }

    // 'g' ante e/i es velar fricativa (/x/, como 'j' -> 'K_G_J'), ante a/o/u es oclusiva ('K_G_J')
    if (ch === 'g' || ch === 'j' || ch === 'k') {
      visemes.push('K_G_J');
      i++;
      continue;
    }

    // 'ñ' -> CH_Y
    if (ch === 'ñ') {
      visemes.push('CH_Y');
      i++;
      continue;
    }

    // 'y' consonántica vs vocálica
    if (ch === 'y') {
      // Si la siguiente es vocal, actúa como consonante (CH_Y, ej. "yo", "ayer")
      if (isVowel(next)) {
        visemes.push('CH_Y');
      } else {
        visemes.push('I');
      }
      i++;
      continue;
    }

    // Vocales
    if (ch === 'a' || ch === 'á') {
      visemes.push('A');
    } else if (ch === 'e' || ch === 'é') {
      visemes.push('E');
    } else if (ch === 'i' || ch === 'í') {
      visemes.push('I');
    } else if (ch === 'o' || ch === 'ó') {
      visemes.push('O');
    } else if (ch === 'u' || ch === 'ú' || ch === 'ü') {
      visemes.push('U');
    }

    i++;
  }

  return visemes;
}

/**
 * Procesa un texto en español y devuelve la lista cronológica de sílabas fonéticas
 */
export function textToSyllables(text: string): SyllablePhonemes[] {
  const result: SyllablePhonemes[] = [];

  // Separar por palabras y signos de puntuación / pausas
  const tokens = text.split(/([,.;:!?—\s]+)/);

  for (const token of tokens) {
    if (!token || token.trim().length === 0) continue;

    // Pausas explícitas por puntuación
    if (/^[,.;:!?—-]+$/.test(token)) {
      result.push({
        rawText: token,
        onsetVisemes: [],
        nucleusVisemes: ['SIL'],
        codaVisemes: [],
        isTonic: false,
        targetViseme: 'SIL',
      });
      continue;
    }

    const cleanWord = token.replace(/[^a-záéíóúüñA-ZÁÉÍÓÚÜÑ]/g, '');
    if (cleanWord.length === 0) continue;

    const { syllables, tonicIndex } = syllabifyWord(cleanWord);

    for (let s = 0; s < syllables.length; s++) {
      const syl = syllables[s]!;
      const isTonic = s === tonicIndex;

      // Descomponer sílaba en onset, núcleo y coda
      let onsetPart = '';
      let nucleusPart = '';
      let codaPart = '';

      let idx = 0;
      // 1. Onset: consonantes iniciales
      while (idx < syl.length && !isVowel(syl[idx]!)) {
        onsetPart += syl[idx]!;
        idx++;
      }
      // 2. Núcleo: vocales contiguas (1 o 2 en diptongo)
      while (idx < syl.length && isVowel(syl[idx]!)) {
        nucleusPart += syl[idx]!;
        idx++;
      }
      // 3. Coda: consonantes finales
      while (idx < syl.length) {
        codaPart += syl[idx]!;
        idx++;
      }

      const onsetVisemes = graphemesToVisemes(onsetPart);
      const nucleusVisemes = graphemesToVisemes(nucleusPart);
      const codaVisemes = graphemesToVisemes(codaPart);

      // El visema target principal para el núcleo de la sílaba
      const targetViseme = nucleusVisemes[0] || onsetVisemes[0] || 'SIL';

      result.push({
        rawText: syl,
        onsetVisemes,
        nucleusVisemes,
        codaVisemes,
        isTonic,
        targetViseme,
      });
    }
  }

  return result;
}
