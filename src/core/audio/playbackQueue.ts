/**
 * playbackQueue.ts
 *
 * Cola de reproducción continua de audio para la Gemini Live API:
 * - Recibe fragmentos PCM16 mono a 24 kHz en Base64.
 * - Los programa de forma fluida en AudioContext sin solapamientos ni micro-cortes.
 * - Conecta a través de un AnalyserNode antes del destino para análisis espectral (lip-sync).
 * - Maneja interrupciones instantáneas (interrupted) cancelando el audio en reproducción y vaciando la cola.
 */

import { base64ToPcm16, pcm16ToFloat32, resampleAudio } from '@/core/audio/pcm';

export interface PlaybackQueueOptions {
  onStateChange?: (isPlaying: boolean) => void;
  onInterrupted?: () => void;
}

export class PlaybackQueue {
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private delayNode: DelayNode | null = null;
  private gainNode: GainNode | null = null;

  private nextPlayTime = 0;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  private isPlaying = false;

  private onStateChange?: (isPlaying: boolean) => void;
  private onInterrupted?: () => void;

  constructor(options?: PlaybackQueueOptions) {
    this.onStateChange = options?.onStateChange;
    this.onInterrupted = options?.onInterrupted;
  }

  /**
   * Inicializa el AudioContext de forma diferida (tras interacción de usuario)
   */
  public async initContext(): Promise<void> {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioCtx();

      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 512;
      this.analyserNode.smoothingTimeConstant = 0.2;

      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 1.0;

      // Anticipación de lip-sync (60-80 ms según Sección 7.8):
      // AnalyserNode recibe el audio ANTES del DelayNode para que los labios
      // se adelanten sutilmente al sonido físico emitido por los altavoces.
      this.delayNode = this.audioContext.createDelay(0.2);
      this.delayNode.delayTime.value = 0.070; // 70 ms de anticipación visual

      // Cadena de audio: Fuente -> Gain -> Analyser (0 ms) & Gain -> Delay -> Destino (70 ms)
      this.gainNode.connect(this.analyserNode);
      this.gainNode.connect(this.delayNode);
      this.delayNode.connect(this.audioContext.destination);
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  public getAnalyserNode(): AnalyserNode | null {
    return this.analyserNode;
  }

  public getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  public isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Encola un fragmento de audio Base64 PCM16 a 24 kHz recibido de Gemini Live
   */
  public async enqueueBase64Chunk(base64: string): Promise<void> {
    await this.initContext();
    if (!this.audioContext || !this.gainNode) return;

    try {
      const pcm16 = base64ToPcm16(base64);
      if (pcm16.length === 0) return;

      let float32 = pcm16ToFloat32(pcm16);

      // Si el AudioContext opera a una tasa distinta de 24 kHz (ej. 48 kHz estándar del hardware),
      // remuestreamos para mantener tono y duración idénticos.
      const targetRate = this.audioContext.sampleRate;
      if (targetRate !== 24000) {
        float32 = resampleAudio(float32, 24000, targetRate);
      }

      const audioBuffer = this.audioContext.createBuffer(1, float32.length, targetRate);
      audioBuffer.copyToChannel(float32, 0);

      const sourceNode = this.audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(this.gainNode);

      // Programar inicio continuo
      const now = this.audioContext.currentTime;
      const startTime = Math.max(now, this.nextPlayTime);
      sourceNode.start(startTime);

      this.nextPlayTime = startTime + audioBuffer.duration;
      this.activeSources.add(sourceNode);

      if (!this.isPlaying) {
        this.isPlaying = true;
        this.onStateChange?.(true);
      }

      sourceNode.onended = () => {
        this.activeSources.delete(sourceNode);
        if (this.activeSources.size === 0 && (!this.audioContext || this.audioContext.currentTime >= this.nextPlayTime - 0.05)) {
          this.isPlaying = false;
          this.onStateChange?.(false);
        }
      };
    } catch (err) {
      console.error('Error al decodificar y reproducir fragmento PCM16:', err);
    }
  }

  /**
   * Cancela inmediatamente todo audio en reproducción y vacía la cola pendiente.
   * Llamado de inmediato cuando el servidor emite 'interrupted'.
   */
  public clear(): void {
    for (const source of this.activeSources) {
      try {
        source.stop(0);
        source.disconnect();
      } catch {
        // Ignorar fuentes ya finalizadas
      }
    }
    this.activeSources.clear();

    if (this.audioContext) {
      this.nextPlayTime = this.audioContext.currentTime;
    } else {
      this.nextPlayTime = 0;
    }

    if (this.isPlaying) {
      this.isPlaying = false;
      this.onStateChange?.(false);
    }

    this.onInterrupted?.();
  }

  /**
   * Simula actividad articulatoria en el AnalyserNode para sincronizar labios
   * cuando el avatar habla mediante TTS o mensajes del sistema (ej. tokens agotados).
   * Alimenta directamente al AnalyserNode sin duplicar el audio hacia los altavoces.
   */
  public async simulateLipSync(durationSeconds = 2.8): Promise<void> {
    await this.initContext();
    if (!this.audioContext || !this.analyserNode) return;

    try {
      const sampleRate = this.audioContext.sampleRate;
      const numSamples = Math.floor(sampleRate * durationSeconds);
      const buffer = this.audioContext.createBuffer(1, numSamples, sampleRate);
      const data = buffer.getChannelData(0);

      // Simular cadencia de habla humana en español:
      // Envolvente silábica a ~4.2 Hz con armónicos vocálicos
      for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        const syllablePhase = (t * 4.2) % 1.0;
        const envelope = Math.sin(Math.PI * syllablePhase) ** 1.6;
        const f1 = Math.sin(2 * Math.PI * 480 * t);
        const f2 = Math.sin(2 * Math.PI * 1400 * t);
        const noise = (Math.random() - 0.5) * 0.1;
        data[i] = (f1 * 0.45 + f2 * 0.35 + noise) * envelope * 0.4;
      }

      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;

      const simGain = this.audioContext.createGain();
      simGain.gain.value = 1.0;
      source.connect(simGain);
      simGain.connect(this.analyserNode);

      source.start();
      this.isPlaying = true;
      this.onStateChange?.(true);

      source.onended = () => {
        this.isPlaying = false;
        this.onStateChange?.(false);
      };
    } catch (e) {
      console.warn('PlaybackQueue simulateLipSync error:', e);
    }
  }

  /**
   * Cierra el contexto y libera recursos
   */
  public async close(): Promise<void> {
    this.clear();
    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch {
        // ignore
      }
      this.audioContext = null;
    }
  }
}
