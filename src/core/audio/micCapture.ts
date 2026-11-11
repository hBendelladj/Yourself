/**
 * micCapture.ts
 *
 * Captura continua de micrófono mediante AudioWorklet:
 * - Activa cancelación de eco, supresión de ruido y control automático de ganancia.
 * - Utiliza /worklets/mic-processor.js para remuestrear a 16 kHz mono y convertir a PCM16.
 * - Emite fragmentos Base64 de ~25 ms listos para enviar a la Gemini Live API.
 * - Soporta silenciamiento (mute) sin desconectar el flujo de hardware.
 */

import { pcm16ToBase64 } from '@/core/audio/pcm';

export interface MicCaptureOptions {
  onAudioChunk: (base64Chunk: string) => void;
  onError?: (error: Error) => void;
}

export class MicCapture {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;

  private isMuted = false;
  private isRunning = false;

  private onAudioChunk: (base64Chunk: string) => void;
  private onError?: (error: Error) => void;

  constructor(options: MicCaptureOptions) {
    this.onAudioChunk = options.onAudioChunk;
    this.onError = options.onError;
  }

  /**
   * Inicia la captura del micrófono y carga el AudioWorklet
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      // 1. Solicitar acceso al micrófono con filtros profesionales
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });

      // 2. Crear AudioContext
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioCtx();

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // 3. Cargar el AudioWorklet auto-alojado en /worklets/mic-processor.js
      await this.audioContext.audioWorklet.addModule('/worklets/mic-processor.js');

      // 4. Conectar nodos de audio
      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      this.workletNode = new AudioWorkletNode(this.audioContext, 'mic-processor', {
        processorOptions: {
          targetSampleRate: 16000,
        },
      });

      this.workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (this.isMuted || !this.isRunning) return;

        const buffer = event.data;
        if (!buffer || buffer.byteLength === 0) return;

        const pcm16 = new Int16Array(buffer);
        const base64Chunk = pcm16ToBase64(pcm16);

        this.onAudioChunk(base64Chunk);
      };

      this.sourceNode.connect(this.workletNode);
      // No conectar a audioContext.destination para no escuchar el propio micrófono por los altavoces
      this.isRunning = true;
    } catch (err: unknown) {
      console.error('Error al iniciar la captura de micrófono:', err);
      let errorMsg = 'No se pudo acceder al micrófono.';
      if (err instanceof DOMException || (err && typeof err === 'object' && 'name' in err)) {
        const name = (err as { name: string }).name;
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          errorMsg = 'Permiso de micrófono denegado. Habilita el acceso al micrófono en la barra del navegador para poder hablar.';
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          errorMsg = 'No se detectó ningún micrófono conectado en tu dispositivo.';
        } else if (name === 'NotReadableError' || name === 'TrackStartError') {
          errorMsg = 'El micrófono está ocupado o siendo usado por otra aplicación.';
        }
      } else if (err instanceof Error && err.message) {
        errorMsg = err.message;
      }
      const error = new Error(errorMsg);
      this.onError?.(error);
      this.stop();
      throw error;
    }
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.stream) {
      this.stream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
  }

  public isCapturing(): boolean {
    return this.isRunning;
  }

  /**
   * Detiene la captura y libera el micrófono
   */
  public stop(): void {
    this.isRunning = false;

    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {
        // ignore
      }
      this.audioContext = null;
    }
  }
}
