/**
 * headDirector.ts
 *
 * Director de Cinemática y Gestualidad Cefálica (YourSelf V3 - Fase B):
 * - Orquesta el catálogo anatómico de gestos coordinados guiados por el discurso:
 *   1. Pequeños cabeceos prosódicos en sílabas tónicas (accent_pitch +3.5°).
 *   2. Inclinaciones de final de frase (nod / curious_tilt).
 *   3. Giros y derivas suaves en yaw y roll.
 *   4. Ruido fractal multioctava no periódico (fBm con Perlin/Hermite 1D).
 *   5. Respiración sutil acoplada (0.2–0.3 Hz).
 * - Ángulos calibrados:
 *   - En habla: yaw ±6–10°, pitch ±3–5°, roll ±3–5°.
 *   - En reposo: ±1–2°.
 * - Cumplimiento estricto de cooldown: gestos grandes (asentir, negar, ladear)
 *   no se repiten en ventanas menores a 10 segundos (MotionMemory).
 * - Cero asignaciones en memoria en el bucle caliente (Zero-Allocation).
 */

import { AvatarMood } from '@/lib/types';
import { MotionMemory, HeadGestureType } from './motionMemory';
import { sampleFractalNoise1D } from '@/core/animation/noise';

export interface HeadKinematics {
  yaw: number;
  pitch: number;
  roll: number;
  currentGesture: HeadGestureType;
  isExecutingGesture: boolean;
}

export interface HeadGains {
  speechGain: number;       // Amplitud de cabeza en habla (0.5..2.0, default 1.0)
  idleGain: number;         // Amplitud de cabeza en reposo (0.5..2.0, default 1.0)
  breathGain: number;       // Amplitud de respiración (0.0..2.0, default 1.0)
  gestureFrequency: number; // Frecuencia de gestos espontáneos (0.0..2.0, default 1.0)
}

const DEG2RAD = Math.PI / 180.0;

export class HeadDirector {
  public readonly memory: MotionMemory;
  public rigVersion: 'v1' | 'v2' | 'v3' | 'v4' = 'v3';

  // Proceso estocástico Ornstein-Uhlenbeck (V4 - Algoritmo G)
  private ouYaw = 0;
  private ouPitch = 0;
  private ouRoll = 0;

  // Saltos de Poisson con distribución de Laplace (gestos con colas pesadas)
  private jumpYaw = 0;
  private jumpPitch = 0;
  private jumpRoll = 0;
  private readonly thetaOU = 1.5;         // Tasa de retorno al centro (1.5 s^-1)
  private readonly tauJump = 0.40;        // Constante de decaimiento del salto (0.4 s)
  private readonly lambdaPoisson = 0.15;  // Tasa de llegada de saltos espontáneos (0.15 s^-1)

  // Ganancias configurables desde el panel de depuración
  public gains: HeadGains = {
    speechGain: 1.0,
    idleGain: 1.0,
    breathGain: 1.0,
    gestureFrequency: 1.0,
  };

  // Estado cinemático actual
  private currentYaw = 0;
  private currentPitch = 0;
  private currentRoll = 0;

  // Estado del gesto en curso
  private activeGesture: HeadGestureType = 'idle_sway';
  private gestureTimer = 0;
  private gestureDuration = 0;
  private isExecuting = false;

  // Temporizador para el próximo gesto espontáneo
  private timeUntilNextGesture = 4.0;
  private elapsedTime = 0;

  // Fuente fractal (fBm): Semillas y frecuencias desacopladas por eje
  private readonly seedYaw = 19.34;
  private readonly seedPitch = 71.12;
  private readonly seedRoll = 143.85;

  private readonly freqYaw = 0.22;
  private readonly freqPitch = 0.18;
  private readonly freqRoll = 0.14;

  // Fuente (c): Deriva suave de objetivo de cabeza cada 1.8 a 4.2 s
  private driftYaw = 0;
  private driftRoll = 0;
  private targetDriftYaw = 0;
  private targetDriftRoll = 0;
  private timeUntilNextDrift = 2.5;

  // Fuente (b): Seguimiento prosódico y final de frase
  private prevEnergy = 0;
  private activeSpeechTime = 0;

  // Búfer reutilizable (Zero-Allocation)
  private readonly kinematics: HeadKinematics = {
    yaw: 0,
    pitch: 0,
    roll: 0,
    currentGesture: 'idle_sway',
    isExecutingGesture: false,
  };

  constructor(cooldownSeconds = 10.0) {
    this.memory = new MotionMemory(cooldownSeconds);
  }

  public setGains(gains: Partial<HeadGains>): void {
    if (gains.speechGain !== undefined) this.gains.speechGain = Math.max(0.2, Math.min(2.5, gains.speechGain));
    if (gains.idleGain !== undefined) this.gains.idleGain = Math.max(0.2, Math.min(2.5, gains.idleGain));
    if (gains.breathGain !== undefined) this.gains.breathGain = Math.max(0.0, Math.min(2.5, gains.breathGain));
    if (gains.gestureFrequency !== undefined) this.gains.gestureFrequency = Math.max(0.0, Math.min(2.5, gains.gestureFrequency));
  }

  public getGains(): HeadGains {
    return { ...this.gains };
  }

  /**
   * Inicia un gesto específico manualmente o por evento, validando el cooldown
   */
  public triggerGesture(type: HeadGestureType, durationSeconds?: number, force = false): boolean {
    if (!force && !this.memory.isGestureAllowed(type, this.elapsedTime)) {
      return false;
    }

    this.activeGesture = type;
    this.isExecuting = true;
    this.gestureTimer = 0;

    switch (type) {
      case 'nod':
        this.gestureDuration = durationSeconds ?? 0.65;
        break;
      case 'double_nod':
        this.gestureDuration = durationSeconds ?? 0.85;
        break;
      case 'shake':
        this.gestureDuration = durationSeconds ?? 0.80;
        break;
      case 'curious_tilt':
        this.gestureDuration = durationSeconds ?? 1.10;
        break;
      case 'look_away':
        this.gestureDuration = durationSeconds ?? 1.25;
        break;
      case 'accent_pitch':
        this.gestureDuration = durationSeconds ?? 0.28;
        break;
      default:
        this.gestureDuration = 0.5;
    }

    this.memory.recordGesture(type, this.elapsedTime);
    return true;
  }

  public setRigVersion(version: 'v1' | 'v2' | 'v3' | 'v4'): void {
    this.rigVersion = version;
  }

  /**
   * Evalúa la cinemática cefálica fotograma a fotograma integrando las fuentes continuas (Fase B / V4 Algoritmo G):
   * En V4:
   * - Proceso estocástico Ornstein-Uhlenbeck con tasa theta = 1.5 s^-1 (RMS calibrado al video)
   * - Saltos de Poisson con amplitud Laplace (gestos con colas pesadas, curtosis > 3)
   * - Acoplamiento mandibular pitch <-> jawOpen (~0.32 correlación)
   * - Nunca congelado en reposo (elimina H6)
   */
  public update(
    deltaSeconds: number,
    mood: AvatarMood = 'idle',
    tonicAccent = false,
    f0Hz = 0,
    energy = 0,
    jawOpen = 0
  ): HeadKinematics {
    this.elapsedTime += deltaSeconds;

    if (this.rigVersion === 'v4') {
      const isSpeaking = mood === 'speaking' || energy > 0.03 || jawOpen > 0.05;
      const dt = Math.max(0.001, Math.min(0.05, deltaSeconds));
      const sqrtDt = Math.sqrt(dt);

      // 1. Ornstein-Uhlenbeck: dX = -theta * X * dt + sigma * dW
      // En habla: RMS calibrado en yaw ~5.5° (0.096 rad), pitch ~6.0° (0.105 rad), roll ~5.5° (0.096 rad)
      // En reposo: sigma al 40% (nunca congelado, elimina H6)
      const sigmaMult = isSpeaking ? this.gains.speechGain : (0.40 * this.gains.idleGain);
      const sigmaYaw = 0.166 * sigmaMult;
      const sigmaPitch = 0.182 * sigmaMult;
      const sigmaRoll = 0.166 * sigmaMult;

      // Normal estándar vía Box-Muller
      const u1 = Math.max(1e-7, Math.random());
      const u2 = Math.random();
      const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
      const u3 = Math.max(1e-7, Math.random());
      const z2 = Math.sqrt(-2.0 * Math.log(u3)) * Math.cos(2.0 * Math.PI * Math.random());

      this.ouYaw += -this.thetaOU * this.ouYaw * dt + sigmaYaw * sqrtDt * z0;
      this.ouPitch += -this.thetaOU * this.ouPitch * dt + sigmaPitch * sqrtDt * z1;
      this.ouRoll += -this.thetaOU * this.ouRoll * dt + sigmaRoll * sqrtDt * z2;

      // 2. Saltos de Poisson con distribución de Laplace (gestos de cola pesada)
      // Tasa lambda = 0.15 s^-1 (un gesto cada 5-10 s)
      const jumpRate = this.lambdaPoisson * this.gains.gestureFrequency * (isSpeaking ? 1.0 : 0.6);
      if (Math.random() < jumpRate * dt) {
        // Laplace(0, b): x = -b * sgn(u) * ln(1 - 2|u|) con u in (-0.5, 0.5)
        const unifY = Math.random() - 0.5;
        const unifP = Math.random() - 0.5;
        const unifR = Math.random() - 0.5;
        const lapY = -Math.sign(unifY) * Math.log(1.0 - 2.0 * Math.abs(unifY));
        const lapP = -Math.sign(unifP) * Math.log(1.0 - 2.0 * Math.abs(unifP));
        const lapR = -Math.sign(unifR) * Math.log(1.0 - 2.0 * Math.abs(unifR));

        this.jumpYaw += 0.055 * lapY * this.gains.gestureFrequency;
        this.jumpPitch += 0.050 * lapP * this.gains.gestureFrequency;
        this.jumpRoll += 0.040 * lapR * this.gains.gestureFrequency;
      }

      // Decaimiento exponencial del salto: tau = 0.40 s
      const jumpDecay = Math.exp(-dt / this.tauJump);
      this.jumpYaw *= jumpDecay;
      this.jumpPitch *= jumpDecay;
      this.jumpRoll *= jumpDecay;

      // 3. Acoplamiento pitch <-> mandíbula / energía (correlación calibrada ~0.30 - 0.35)
      const kp = 0.18;
      const jawOffset = jawOpen > 0.01 ? jawOpen : energy * 0.7;
      const coupledPitch = kp * jawOffset;

      // Respiración sutil en pitch
      const breathPitch = Math.sin(this.elapsedTime * (Math.PI * 2 * 0.24)) * 0.008 * this.gains.breathGain;

      this.kinematics.yaw = Math.max(-0.35, Math.min(0.35, this.ouYaw + this.jumpYaw));
      this.kinematics.pitch = Math.max(-0.25, Math.min(0.30, this.ouPitch + this.jumpPitch + coupledPitch + breathPitch));
      this.kinematics.roll = Math.max(-0.20, Math.min(0.20, this.ouRoll + this.jumpRoll));
      this.kinematics.currentGesture = Math.abs(this.jumpYaw) + Math.abs(this.jumpPitch) > 0.05 ? 'nod' : 'idle_sway';
      this.kinematics.isExecutingGesture = Math.abs(this.jumpYaw) + Math.abs(this.jumpPitch) > 0.05;

      return this.kinematics;
    }
    const isSpeaking = mood === 'speaking' || energy > 0.03;

    // --- FUENTE (b): Seguimiento Prosódico y Detección de Final de Frase ---
    let prosodyPitch = 0;
    if (energy > 0.02) {
      this.activeSpeechTime += deltaSeconds;
      if (f0Hz > 80) {
        // Ligera elevación de mentón en notas agudas (+1.5° máx)
        prosodyPitch = Math.min(0.035, Math.max(-0.025, (f0Hz - 160) * 0.0003));
      }
    } else {
      // Detección de final de frase tras habla prolongada (> 0.6 s): gesto de cierre suave
      if (this.prevEnergy > 0.04 && this.activeSpeechTime > 0.6 && !this.isExecuting) {
        if (this.memory.isGestureAllowed('curious_tilt', this.elapsedTime)) {
          this.triggerGesture('curious_tilt', 1.05);
        } else if (this.memory.isGestureAllowed('nod', this.elapsedTime)) {
          this.triggerGesture('nod', 0.60);
        }
      }
      this.activeSpeechTime = 0;
    }
    this.prevEnergy = energy;

    // Cabeceo prosódico rápido en sílabas tónicas acentuadas
    if (tonicAccent && !this.isExecuting && isSpeaking) {
      if (this.memory.isGestureAllowed('accent_pitch', this.elapsedTime)) {
        this.triggerGesture('accent_pitch', 0.28);
      }
    }

    // --- FUENTE (c): Deriva de Objetivo de Cabeza cada 1.8–4.2 s ---
    this.timeUntilNextDrift -= deltaSeconds;
    if (this.timeUntilNextDrift <= 0) {
      if (isSpeaking) {
        // En habla: giros suaves en yaw ±6–8° (±0.10–0.14 rad) y roll ±2.5–3.5° (±0.04–0.06 rad)
        const driftAmpYaw = 0.13 * this.gains.speechGain;
        const driftAmpRoll = 0.065 * this.gains.speechGain;
        this.targetDriftYaw = (Math.random() - 0.5) * 2.0 * driftAmpYaw;
        this.targetDriftRoll = (Math.random() - 0.5) * 2.0 * driftAmpRoll;
      } else {
        // En reposo: derivas mínimas dentro de ±1°
        const driftAmpYaw = 0.018 * this.gains.idleGain;
        const driftAmpRoll = 0.012 * this.gains.idleGain;
        this.targetDriftYaw = (Math.random() - 0.5) * 2.0 * driftAmpYaw;
        this.targetDriftRoll = (Math.random() - 0.5) * 2.0 * driftAmpRoll;
      }
      this.timeUntilNextDrift = 1.8 + Math.random() * 2.4;
    }

    // Suavizado exponencial con amortiguamiento crítico
    const driftSpeed = 1.0 - Math.exp(-2.0 * deltaSeconds);
    this.driftYaw += (this.targetDriftYaw - this.driftYaw) * driftSpeed;
    this.driftRoll += (this.targetDriftRoll - this.driftRoll) * driftSpeed;

    // --- FUENTE (d): Respiración (0.24 Hz = ~4.16 s ciclo) ---
    const breathPhase = this.elapsedTime * (Math.PI * 2 * 0.24);
    const breathPitch = Math.sin(breathPhase) * 0.010 * this.gains.breathGain; // ±0.6° cabeceo acoplado

    // --- FUENTE (a): Ruido Fractal Multioctava fBm (No periódico, no repetitivo) ---
    const noiseScale = isSpeaking ? (2.6 * DEG2RAD * this.gains.speechGain) : (1.85 * DEG2RAD * this.gains.idleGain);
    const fBmYaw = sampleFractalNoise1D(this.elapsedTime * this.freqYaw + this.seedYaw, 3) * noiseScale * 1.25;
    const fBmPitch = sampleFractalNoise1D(this.elapsedTime * this.freqPitch + this.seedPitch, 3) * noiseScale * 0.95;
    const fBmRoll = sampleFractalNoise1D(this.elapsedTime * this.freqRoll + this.seedRoll, 2) * noiseScale * 1.15;

    // Programación espontánea de gestos naturales respetando cooldown y ganancia
    if (!this.isExecuting && this.gains.gestureFrequency > 0.01) {
      this.timeUntilNextGesture -= deltaSeconds;

      if (this.timeUntilNextGesture <= 0) {
        const candidates = this.getCandidatesForMood(mood);
        const selected = this.memory.selectBestGesture(candidates, this.elapsedTime);

        if (selected !== 'idle_sway') {
          this.triggerGesture(selected);
        }

        this.timeUntilNextGesture = (3.5 + Math.random() * 3.5) / Math.max(0.2, this.gains.gestureFrequency);
      }
    }

    const wasExecuting = this.isExecuting;

    // Evaluar trayectoria del gesto activo
    if (this.isExecuting) {
      this.gestureTimer += deltaSeconds;
      const progress = Math.min(1.0, this.gestureTimer / this.gestureDuration);

      this.evaluateGestureTrajectory(this.activeGesture, progress);

      if (progress >= 1.0) {
        this.isExecuting = false;
        this.activeGesture = 'idle_sway';
      }
    } else {
      this.currentYaw = 0;
      this.currentPitch = 0;
      this.currentRoll = 0;
    }

    // Composición final desacoplada
    if (wasExecuting) {
      // Durante un gesto dominante, el gesto conduce con su trayectoria precisa
      this.kinematics.yaw = this.currentYaw;
      this.kinematics.pitch = this.currentPitch;
      this.kinematics.roll = this.currentRoll;
    } else {
      // Suma continua de las fuentes
      this.kinematics.yaw = this.driftYaw + fBmYaw;
      this.kinematics.pitch = prosodyPitch + breathPitch + fBmPitch;
      this.kinematics.roll = this.driftRoll + fBmRoll;
    }

    // Acotación final de seguridad estricta
    const maxYawRad = (isSpeaking ? 11.0 : 2.5) * DEG2RAD;
    const maxPitchRad = (isSpeaking ? 6.0 : 2.5) * DEG2RAD;
    const maxRollRad = (isSpeaking ? 5.5 : 2.5) * DEG2RAD;

    this.kinematics.yaw = Math.max(-maxYawRad, Math.min(maxYawRad, this.kinematics.yaw));
    this.kinematics.pitch = Math.max(-maxPitchRad, Math.min(maxPitchRad, this.kinematics.pitch));
    this.kinematics.roll = Math.max(-maxRollRad, Math.min(maxRollRad, this.kinematics.roll));

    this.kinematics.currentGesture = this.activeGesture;
    this.kinematics.isExecutingGesture = this.isExecuting;

    return this.kinematics;
  }

  private evaluateGestureTrajectory(gesture: HeadGestureType, p: number): void {
    const speechMult = this.gains.speechGain;

    switch (gesture) {
      case 'nod': {
        // Asentimiento (+4.3° ≈ 0.075 rad)
        const envelope = Math.sin(p * Math.PI);
        this.currentPitch = envelope * 0.075 * speechMult;
        this.currentYaw = 0;
        this.currentRoll = 0;
        break;
      }
      case 'double_nod': {
        // Dos cabeceos con decaimiento elástico (+4.0° luego +2.2°)
        const wave = Math.sin(p * Math.PI * 2);
        const decay = 1.0 - p * 0.45;
        this.currentPitch = Math.max(0, wave) * 0.070 * decay * speechMult;
        this.currentYaw = 0;
        this.currentRoll = 0;
        break;
      }
      case 'shake': {
        // Negación amplia amortiguada (±6.6° ≈ 0.115 rad)
        const wave = Math.sin(p * Math.PI * 3.5);
        const decay = Math.cos((p * Math.PI) / 2);
        this.currentYaw = wave * 0.115 * decay * speechMult;
        this.currentPitch = 0;
        this.currentRoll = -this.currentYaw * 0.16;
        break;
      }
      case 'curious_tilt': {
        // Inclinación lateral con giro (+4.0° roll, -2.0° yaw, +1.4° pitch)
        const envelope = Math.sin(p * Math.PI);
        this.currentRoll = envelope * 0.070 * speechMult;
        this.currentYaw = -envelope * 0.035 * speechMult;
        this.currentPitch = envelope * 0.025 * speechMult;
        break;
      }
      case 'look_away': {
        // Desvío lateral amplio y retorno (+4.9° yaw, +2.0° pitch)
        const envelope = Math.sin(p * Math.PI);
        this.currentYaw = envelope * 0.085 * speechMult;
        this.currentPitch = envelope * 0.035 * speechMult;
        this.currentRoll = 0;
        break;
      }
      case 'accent_pitch': {
        // Cabeceo prosódico rápido (+3.4° ≈ 0.06 rad)
        const envelope = Math.sin(p * Math.PI);
        this.currentPitch = envelope * 0.060 * speechMult;
        break;
      }
      default:
        this.currentYaw = 0;
        this.currentPitch = 0;
        this.currentRoll = 0;
    }
  }

  private getCandidatesForMood(mood: AvatarMood): Array<{ type: HeadGestureType; baseProbability: number }> {
    switch (mood) {
      case 'listening':
        return [
          { type: 'nod', baseProbability: 0.35 },
          { type: 'double_nod', baseProbability: 0.20 },
          { type: 'curious_tilt', baseProbability: 0.25 },
          { type: 'idle_sway', baseProbability: 0.20 },
        ];
      case 'speaking':
        return [
          { type: 'nod', baseProbability: 0.25 },
          { type: 'shake', baseProbability: 0.15 },
          { type: 'curious_tilt', baseProbability: 0.15 },
          { type: 'look_away', baseProbability: 0.20 },
          { type: 'idle_sway', baseProbability: 0.25 },
        ];
      case 'thinking':
        return [
          { type: 'look_away', baseProbability: 0.50 },
          { type: 'curious_tilt', baseProbability: 0.30 },
          { type: 'idle_sway', baseProbability: 0.20 },
        ];
      default: // 'idle'
        return [
          { type: 'curious_tilt', baseProbability: 0.20 },
          { type: 'look_away', baseProbability: 0.15 },
          { type: 'nod', baseProbability: 0.15 },
          { type: 'idle_sway', baseProbability: 0.50 },
        ];
    }
  }
}
