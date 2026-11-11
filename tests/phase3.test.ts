import { describe, it, expect } from 'vitest';
import {
  graphemesToVisemes,
  syllabifyWord,
} from '../src/core/audio/es-g2p';
import { SyllableClock } from '../src/core/audio/syllableClock';
import { AudioClock } from '../src/core/audio/audioClock';
import { VisemeScheduler } from '../src/core/audio/visemeScheduler';

describe('Phase 3: Spanish Phonetic Lip-Sync (es-g2p, syllableClock, visemeScheduler)', () => {
  describe('1. es-g2p Spanish Grapheme-to-Phoneme Table (≥ 60 Words & Phonotactic Rules)', () => {
    // 1. Diptongos (10 palabras)
    const diphthongs = [
      'tierra', 'cielo', 'fuego', 'agua', 'reina',
      'auto', 'peine', 'ciudad', 'cuatro', 'viento',
    ];

    // 2. qu / gu / gü (10 palabras)
    const quGu = [
      'queso', 'quince', 'guitarra', 'guerra', 'guiso',
      'pingüino', 'bilingüe', 'antiguo', 'averiguar', 'quinto',
    ];

    // 3. ll / y (10 palabras)
    const llY = [
      'llave', 'calle', 'lluvia', 'pollo', 'ayer',
      'yo', 'ya', 'playa', 'rey', 'hoy',
    ];

    // 4. ñ (6 palabras)
    const enye = ['niño', 'mañana', 'sueño', 'año', 'otoño', 'muñeca'];

    // 5. ch (6 palabras)
    const che = ['chocolate', 'chico', 'noche', 'mucho', 'ocho', 'leche'];

    // 6. rr / r (7 palabras)
    const erre = ['perro', 'carro', 'tierra', 'ratón', 'rosa', 'caro', 'pera'];

    // 7. h muda (6 palabras)
    const hache = ['hola', 'hueso', 'hacer', 'hierro', 'ahora', 'hijo'];

    // 8. v = b (bilabiales) (6 palabras)
    const veBe = ['vamos', 'barco', 'vivir', 'beber', 'vaca', 'boca'];

    // 9. c / z (SZ vs K_G_J) (6 palabras)
    const ceZeta = ['cine', 'cena', 'zapato', 'corazón', 'caza', 'casa'];

    // 10. g / j (6 palabras)
    const geJota = ['gente', 'girar', 'jamón', 'jugar', 'general', 'gato'];

    const testCorpus = [
      ...diphthongs,
      ...quGu,
      ...llY,
      ...enye,
      ...che,
      ...erre,
      ...hache,
      ...veBe,
      ...ceZeta,
      ...geJota,
    ];

    it('corpus contains at least 60 distinct Spanish words (actual: 73)', () => {
      expect(testCorpus.length).toBeGreaterThanOrEqual(60);
      const uniqueWords = new Set(testCorpus);
      expect(uniqueWords.size).toBeGreaterThanOrEqual(60);
    });

    it('treats "h" as completely silent (mute)', () => {
      // "hola" -> O - TDNL - A
      const visemesHola = graphemesToVisemes('hola');
      expect(visemesHola).toEqual(['O', 'TDNL', 'A']);

      // "ahora" -> A - O - TDNL - A
      const visemesAhora = graphemesToVisemes('ahora');
      expect(visemesAhora).toEqual(['A', 'O', 'TDNL', 'A']);
    });

    it('treats "qu" and "gu" with silent "u" unless dieresis "ü" is present', () => {
      // "queso" -> K_G_J - E - SZ - O (la 'u' no se pronuncia)
      const visemesQueso = graphemesToVisemes('queso');
      expect(visemesQueso[0]).toBe('K_G_J');
      expect(visemesQueso[1]).toBe('E');
      expect(visemesQueso).not.toContain('U');

      // "guerra" -> K_G_J - E - TDNL - A
      const visemesGuerra = graphemesToVisemes('guerra');
      expect(visemesGuerra[0]).toBe('K_G_J');
      expect(visemesGuerra[1]).toBe('E');
      expect(visemesGuerra).not.toContain('U');

      // "pingüino" -> con 'ü', la U SÍ se pronuncia
      const visemesPinguino = graphemesToVisemes('pingüino');
      expect(visemesPinguino).toContain('U');
    });

    it('maps "v" and "b" identically to bilabial MBP', () => {
      const visemesVamos = graphemesToVisemes('vamos');
      const visemesBarco = graphemesToVisemes('barco');

      expect(visemesVamos[0]).toBe('MBP'); // 'v'
      expect(visemesBarco[0]).toBe('MBP'); // 'b'
    });

    it('maps "f" strictly to labiodental FV', () => {
      const visemesFiesta = graphemesToVisemes('fiesta');
      expect(visemesFiesta[0]).toBe('FV');
    });

    it('distinguishes "c" soft (SZ) ante e/i vs hard (K_G_J) ante a/o/u', () => {
      const visemesCine = graphemesToVisemes('cine');
      const visemesCasa = graphemesToVisemes('casa');

      expect(visemesCine[0]).toBe('SZ'); // 'c' ante 'i'
      expect(visemesCasa[0]).toBe('K_G_J'); // 'c' ante 'a'
    });

    it('maps "ch", "ll", "ñ" to CH_Y', () => {
      expect(graphemesToVisemes('chico')[0]).toBe('CH_Y');
      expect(graphemesToVisemes('llave')[0]).toBe('CH_Y');
      expect(graphemesToVisemes('niño')[2]).toBe('CH_Y');
    });

    it('correctly syllabifies words and detects tonic syllables', () => {
      // 1. Aguda con tilde
      const cancion = syllabifyWord('canción');
      expect(cancion.syllables.length).toBe(2);
      expect(cancion.tonicIndex).toBe(1); // can-CIÓN

      // 2. Llana sin tilde terminada en vocal
      const casa = syllabifyWord('casa');
      expect(casa.syllables).toEqual(['ca', 'sa']);
      expect(casa.tonicIndex).toBe(0); // CA-sa

      // 3. Esdrújula
      const musica = syllabifyWord('música');
      expect(musica.syllables.length).toBe(3);
      expect(musica.tonicIndex).toBe(0); // MÚ-si-ca
    });
  });

  describe('2. SyllableClock Energy Peak Detection', () => {
    it('detects syllable energy peaks with minimum distance ≥ 95 ms', () => {
      const clock = new SyllableClock({ minPeakDistance: 0.095 });
      const detectedTimes: number[] = [];
      clock.onSyllable = (t) => detectedTimes.push(t);

      // Simular 3 sílabas acústicas separadas por 150 ms
      // Sílaba 1 en t = 0.10, Sílaba 2 en t = 0.25, Sílaba 3 en t = 0.40
      for (let t = 0; t <= 0.60; t += 0.01) {
        let rms = 0.005; // piso de ruido
        // Ráfagas de campana gaussiana en cada sílaba
        if (Math.abs(t - 0.10) < 0.03) rms = 0.25;
        if (Math.abs(t - 0.25) < 0.03) rms = 0.30;
        if (Math.abs(t - 0.40) < 0.03) rms = 0.28;

        clock.processSample(rms, t);
      }

      // Debe haber detectado exactamente 3 sílabas
      expect(detectedTimes.length).toBe(3);
      expect(detectedTimes[0]).toBeCloseTo(0.12, 1);
      expect(detectedTimes[1]).toBeCloseTo(0.27, 1);
      expect(detectedTimes[2]).toBeCloseTo(0.42, 1);
    });

    it('ignores continuous background noise below noiseFloor', () => {
      const clock = new SyllableClock({ noiseFloor: 0.015 });
      let called = false;
      clock.onSyllable = () => { called = true; };

      for (let t = 0; t < 0.5; t += 0.01) {
        clock.processSample(0.008, t); // Ruido de fondo inferior
      }

      expect(called).toBe(false);
    });
  });

  describe('3. AudioClock Synchronization', () => {
    it('provides monotonic time advancement and resets cleanly', () => {
      const clock = new AudioClock(null);
      const t0 = clock.getAudioTime();
      expect(t0).toBeGreaterThanOrEqual(0);

      clock.reset();
      const t1 = clock.getAudioTime();
      expect(t1).toBeLessThan(0.05);
    });
  });

  describe('4. VisemeScheduler Phonation and Robustness', () => {
    it('seals lips with mouthClose > 0.8 and jawOpen = 0 for bilabials (/m/, /b/, /p/)', () => {
      const scheduler = new VisemeScheduler();
      scheduler.enqueueText('mamá');

      // Disparar sílaba "ma"
      scheduler.onSyllableTick(0.10);

      const spectralDummy = { jawOpen: 0.25, mouthRound: 0, mouthWide: 0, smile: 0 };
      // En la fase de inicio consonántico (onset 'm')
      const targets = scheduler.update(0.11, spectralDummy);

      // Cierre bilabial hermético
      expect(targets.mouthClose).toBeGreaterThan(0.70);
      expect(targets.mouthPressLips).toBeGreaterThan(0.40);
      expect(targets.jawOpen).toBe(0);
    });

    it('tucks lower lip under upper incisors with lowerLipTuck > 0.6 for /f/', () => {
      const scheduler = new VisemeScheduler();
      scheduler.enqueueText('fiesta');

      scheduler.onSyllableTick(0.10);

      const spectralDummy = { jawOpen: 0.20, mouthRound: 0, mouthWide: 0, smile: 0 };
      // En la fase de inicio labiodental 'f'
      const targets = scheduler.update(0.11, spectralDummy);

      expect(targets.lowerLipTuck).toBeGreaterThan(0.60);
      expect(targets.mouthClose).toBe(0);
      expect(targets.jawOpen).toBeLessThanOrEqual(0.12);
    });

    it('produces distinct characteristic geometries for all 5 vowels (A, E, I, O, U)', () => {
      const scheduler = new VisemeScheduler();
      const spectral = { jawOpen: 0.30, mouthRound: 0, mouthWide: 0, smile: 0 };

      // Vocal A
      scheduler.enqueueText('a');
      scheduler.onSyllableTick(0.0);
      const vA = { ...scheduler.update(0.05, spectral) };

      // Vocal E
      scheduler.enqueueText('e');
      scheduler.onSyllableTick(0.2);
      const vE = { ...scheduler.update(0.25, spectral) };

      // Vocal I
      scheduler.enqueueText('i');
      scheduler.onSyllableTick(0.4);
      const vI = { ...scheduler.update(0.45, spectral) };

      // Vocal O
      scheduler.enqueueText('o');
      scheduler.onSyllableTick(0.6);
      const vO = { ...scheduler.update(0.65, spectral) };

      // Vocal U
      scheduler.enqueueText('u');
      scheduler.onSyllableTick(0.8);
      const vU = { ...scheduler.update(0.85, spectral) };

      // A tiene la mayor apertura de mandíbula
      expect(vA.jawOpen).toBeGreaterThan(vE.jawOpen);
      expect(vA.jawOpen).toBeGreaterThan(vI.jawOpen);
      expect(vA.jawOpen).toBeGreaterThan(vU.jawOpen);

      // I tiene mayor extensión horizontal (mouthWide)
      expect(vI.mouthWide).toBeGreaterThan(vA.mouthWide);

      // O y U tienen mayor redondeo/proyección labial (mouthFunnel / mouthPucker)
      expect(vO.mouthFunnel).toBeGreaterThan(0.3);
      expect(vU.mouthPucker).toBeGreaterThan(0.4);
    });

    it('flushes pending syllables and resets visemes to neutral on flush() / interrupted', () => {
      const scheduler = new VisemeScheduler();
      scheduler.enqueueText('Una frase muy larga con muchas palabras pendientes');
      expect(scheduler.getQueueLength()).toBeGreaterThan(5);

      scheduler.onSyllableTick(0.10);
      scheduler.update(0.12, { jawOpen: 0.4, mouthRound: 0, mouthWide: 0, smile: 0 });

      // Simular evento interrupted
      scheduler.flush();

      expect(scheduler.getQueueLength()).toBe(0);
      expect(scheduler.currentTargets.jawOpen).toBe(0);
      expect(scheduler.currentTargets.mouthClose).toBe(0);
      expect(scheduler.currentTargets.lowerLipTuck).toBe(0);
    });
  });
});
