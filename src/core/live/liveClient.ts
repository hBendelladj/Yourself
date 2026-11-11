/**
 * liveClient.ts
 *
 * Cliente de WebSocket para la Gemini Multimodal Live API:
 * - Soporta modelos nativos de audio en tiempo real:
 *   gemini-live-2.5-flash-preview, gemini-2.5-flash-native-audio-latest,
 *   gemini-2.5-flash-preview-native-audio-dialog, gemini-2.5-flash.
 * - Configuración con responseModalities: ["AUDIO"], speechConfig (voces HD) y systemInstruction.
 * - Disparo automático del saludo inicial del personaje por voz al completar el setup.
 * - Activación de contextWindowCompression (slidingWindow) y sessionResumption para sesiones de >15 min.
 * - Recepción de audio PCM16 a 24 kHz y transcripciones de entrada/salida.
 * - Manejo reactivo de interrupciones (interrupted) y aviso de reconexión de infraestructura (goAway).
 */

import { buildSystemInstruction } from '@/core/live/persona';

/**
 * Detecta si un error proviene de agotamiento de cuota, tokens o rate limits de Google Gemini
 */
export function isQuotaOrTokenError(error: unknown): boolean {
  if (!error) return false;
  const str = (
    typeof error === 'string'
      ? error
      : typeof error === 'object' && error !== null
        ? JSON.stringify(error)
        : String(error)
  ).toLowerCase();

  return (
    str.includes('quota_exhausted') ||
    str.includes('resource_exhausted') ||
    str.includes('resource has been exhausted') ||
    str.includes('quota') ||
    str.includes('cuota') ||
    str.includes('rate limit') ||
    str.includes('ratelimit') ||
    str.includes('429') ||
    str.includes('token') ||
    str.includes('tokens') ||
    str.includes('insufficient_quota') ||
    str.includes('exhausted')
  );
}

export interface LiveClientCallbacks {
  onSetupComplete?: () => void;
  onAudioData?: (base64Audio24k: string) => void;
  onInterrupted?: () => void;
  onTurnComplete?: () => void;
  onTranscript?: (role: 'user' | 'assistant', text: string, isStreaming: boolean) => void;
  onStatusChange?: (status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error') => void;
  onError?: (errorMessage: string) => void;
}

export interface LiveClientConfig {
  apiKey: string;
  modelName: string;
  characterName: string;
  voiceName: string;
  callbacks: LiveClientCallbacks;
}

export class LiveClient {
  private apiKey: string;
  private modelName: string;
  private characterName: string;
  private voiceName: string;
  private callbacks: LiveClientCallbacks;

  private socket: WebSocket | null = null;
  private isConnected = false;
  private isConnecting = false;
  private isIntentionalClose = false;

  // Manejo de reanudación de sesión
  private sessionResumptionHandle: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 4;
  private reconnectTimeoutId: number | null = null;

  constructor(config: LiveClientConfig) {
    this.apiKey = config.apiKey;
    this.modelName = config.modelName;
    this.characterName = config.characterName;
    this.voiceName = config.voiceName;
    this.callbacks = config.callbacks;
  }

  /**
   * Conecta con la Gemini Live API vía WebSocket
   */
  public async connect(): Promise<void> {
    if (this.isConnected || this.isConnecting) return;

    if (!this.apiKey || this.apiKey.trim().length < 15) {
      this.callbacks.onError?.('API key no válida o ausente. Ingresa una Gemini API Key válida.');
      return;
    }

    this.isConnecting = true;
    this.isIntentionalClose = false;
    this.callbacks.onStatusChange?.(this.sessionResumptionHandle ? 'reconnecting' : 'connecting');

    const apiVersion = 'v1alpha';
    const baseUrl = 'wss://generativelanguage.googleapis.com';
    const url = `${baseUrl}/ws/google.ai.generativelanguage.${apiVersion}.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(this.apiKey)}`;

    try {
      this.socket = new WebSocket(url);
    } catch (err: unknown) {
      this.isConnecting = false;
      const msg = err instanceof Error ? err.message : 'Error al instanciar WebSocket';
      this.callbacks.onError?.(`Fallo al iniciar conexión con Gemini Live: ${msg}`);
      this.callbacks.onStatusChange?.('error');
      return;
    }

    this.socket.onopen = () => {
      this.isConnecting = false;
      this.sendInitialSetup();
    };

    this.socket.onmessage = async (event: MessageEvent) => {
      await this.handleMessage(event);
    };

    this.socket.onerror = (event: Event) => {
      console.error('Gemini Live WebSocket error:', event);
      this.callbacks.onError?.(
        'Error de red en la conexión con Gemini Live. Verifica tu conexión o que la API key tenga acceso a la Live API.'
      );
    };

    this.socket.onclose = (event: CloseEvent) => {
      this.isConnected = false;
      this.isConnecting = false;

      // Si fue un cierre controlado por el usuario, no reintentar
      if (this.isIntentionalClose) {
        this.callbacks.onStatusChange?.('disconnected');
        return;
      }

      console.warn(`WebSocket cerrado (código ${event.code}): ${event.reason}`);

      // Código 1008 = Policy Violation; 4429 = Quota/Rate Limit; 4403 = Forbidden
      if (
        event.code === 1008 ||
        event.code === 4403 ||
        event.code === 4429 ||
        isQuotaOrTokenError(event.reason) ||
        event.reason.includes('API key')
      ) {
        if (isQuotaOrTokenError(event.reason) || event.code === 4429) {
          this.callbacks.onError?.('QUOTA_EXHAUSTED: ¡Uy, se te acabaron los tokens!');
        } else if (event.reason.includes('API key')) {
          this.callbacks.onError?.('La API key no fue autorizada por Google Gemini o no tiene permisos para la Live API.');
        } else {
          this.callbacks.onError?.('QUOTA_EXHAUSTED: ¡Uy, se te acabaron los tokens!');
        }
        this.callbacks.onStatusChange?.('error');
        return;
      }

      if (event.code === 1000) {
        this.callbacks.onStatusChange?.('disconnected');
        return;
      }

      // Reintento automático con reanudación de sesión
      this.scheduleReconnection();
    };
  }

  /**
   * Envía el marco de configuración inicial (setup)
   */
  private sendInitialSetup(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    // Formato canónico de modelo
    const formattedModel = this.modelName.startsWith('models/')
      ? this.modelName
      : `models/${this.modelName}`;

    const setupData: Record<string, unknown> = {
      model: formattedModel,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: this.voiceName || 'Kore',
            },
          },
        },
      },
      systemInstruction: {
        parts: [{ text: buildSystemInstruction(this.characterName) }],
      },
      // Compresión de ventana de contexto: permite sesiones continuas > 15 minutos sin corte
      contextWindowCompression: {
        slidingWindow: {},
      },
    };

    // Solo enviar sessionResumption si tenemos un handle activo no vacío
    if (this.sessionResumptionHandle) {
      setupData.sessionResumption = { handle: this.sessionResumptionHandle };
    }

    const setupPayload = {
      setup: setupData,
    };

    console.log('[Gemini Live] Enviando marco de setup:', formattedModel, this.voiceName);
    this.socket.send(JSON.stringify(setupPayload));
  }

  /**
   * Procesa mensajes entrantes del servidor Gemini Live
   */
  private async handleMessage(event: MessageEvent): Promise<void> {
    let rawText = '';
    if (typeof event.data === 'string') {
      rawText = event.data;
    } else if (event.data instanceof Blob) {
      rawText = await event.data.text();
    } else if (event.data instanceof ArrayBuffer) {
      rawText = new TextDecoder().decode(event.data);
    }

    try {
      const msg = JSON.parse(rawText) as Record<string, unknown>;

      // 0. Comprobar si Google devuelve un error estructurado
      if (msg['error']) {
        const errObj = msg['error'] as { code?: number; message?: string; status?: string };
        const errMsg = errObj.message || `Error de Google Gemini (${errObj.code || 'desconocido'})`;
        console.error('[Gemini Live Error del Servidor]', errObj);
        if (isQuotaOrTokenError(errObj) || isQuotaOrTokenError(errMsg)) {
          this.callbacks.onError?.('QUOTA_EXHAUSTED: ¡Uy, se te acabaron los tokens!');
        } else {
          this.callbacks.onError?.(`Google Gemini: ${errMsg}`);
        }
        this.callbacks.onStatusChange?.('error');
        return;
      }

      // 1. Confirmación de setup exitoso
      if (msg['setupComplete']) {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.callbacks.onStatusChange?.('connected');
        this.callbacks.onSetupComplete?.();

        // Disparar saludo inicial automático del avatar con su nombre
        this.sendInitialGreeting();
        return;
      }

      // 2. Manejo de reanudación de sesión (SessionResumptionUpdate)
      if (msg['sessionResumptionUpdate']) {
        const update = msg['sessionResumptionUpdate'] as { handle?: string; newHandle?: string };
        const newHandle = update.newHandle || update.handle;
        if (newHandle) {
          this.sessionResumptionHandle = newHandle;
        }
      }

      // 3. Aviso de fin de conexión programada (GoAway)
      if (msg['goAway']) {
        const goAway = msg['goAway'] as { timeLeft?: string | number };
        console.warn('[Gemini Live] Señal goAway recibida de la infraestructura. Tiempo restante:', goAway.timeLeft);
        this.scheduleReconnection();
        return;
      }

      // 4. Contenido del servidor (ServerContent)
      if (msg['serverContent']) {
        const sc = msg['serverContent'] as Record<string, unknown>;

        // Manejo de interrupción cuando el usuario comienza a hablar
        if (sc['interrupted'] === true) {
          this.callbacks.onInterrupted?.();
          return;
        }

        // Partes generadas por el modelo (Audio y Texto)
        const modelTurn = sc['modelTurn'] as { parts?: Array<Record<string, unknown>> } | undefined;
        if (modelTurn && Array.isArray(modelTurn.parts)) {
          for (const part of modelTurn.parts) {
            // Audio entrante en 24 kHz PCM16
            const inlineData = part['inlineData'] as { mimeType?: string; data?: string } | undefined;
            if (inlineData && inlineData.data) {
              this.callbacks.onAudioData?.(inlineData.data);
            }

            // Transcripción incremental de lo que dice el modelo
            if (typeof part['text'] === 'string' && part['text'].length > 0) {
              const isTurnComplete = sc['turnComplete'] === true;
              this.callbacks.onTranscript?.('assistant', part['text'], !isTurnComplete);
            }
          }
        }

        // Fin del turno del modelo
        if (sc['turnComplete'] === true) {
          this.callbacks.onTurnComplete?.();
        }
      }
    } catch (err) {
      console.error('Error al decodificar mensaje de Gemini Live:', err);
    }
  }

  /**
   * Saludo de bienvenida inicial para que el personaje se presente por voz con su nombre
   */
  public sendInitialGreeting(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    const charName = this.characterName.trim() || 'YourSelf';
    const greetingPrompt = `¡Hola! Preséntate brevemente diciendo: "¡Hola! Soy ${charName}, ¿cómo estás hoy?" o un saludo similar corto y alegre con tu nombre en español.`;

    const payload = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text: greetingPrompt }],
          },
        ],
        turnComplete: true,
      },
    };

    try {
      this.socket.send(JSON.stringify(payload));
    } catch (err) {
      console.error('Error al enviar saludo inicial a Gemini:', err);
    }
  }

  /**
   * Envía fragmento de audio en tiempo real desde el micrófono (16 kHz mono PCM16 en Base64)
   */
  public sendRealtimeAudio(base64Pcm16Chunk: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.isConnected) {
      return;
    }

    const payload = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: 'audio/pcm;rate=16000',
            data: base64Pcm16Chunk,
          },
        ],
      },
    };

    try {
      this.socket.send(JSON.stringify(payload));
    } catch (err) {
      console.error('Error al enviar audio en tiempo real:', err);
    }
  }

  /**
   * Programa reconexión con retroceso exponencial
   */
  private scheduleReconnection(): void {
    if (this.reconnectTimeoutId !== null) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.callbacks.onError?.('Se agotaron los intentos de reconexión con Gemini Live.');
      this.callbacks.onStatusChange?.('error');
      return;
    }

    this.reconnectAttempts++;
    const delayMs = Math.min(8000, 1000 * Math.pow(1.8, this.reconnectAttempts - 1));

    this.callbacks.onStatusChange?.('reconnecting');

    this.reconnectTimeoutId = window.setTimeout(async () => {
      this.reconnectTimeoutId = null;
      if (this.socket) {
        try {
          this.socket.close();
        } catch {
          // ignore
        }
        this.socket = null;
      }
      await this.connect();
    }, delayMs);
  }

  /**
   * Cierra ordenadamente la sesión
   */
  public disconnect(): void {
    this.isIntentionalClose = true;
    if (this.reconnectTimeoutId !== null) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    if (this.socket) {
      try {
        this.socket.close(1000, 'Sesión finalizada por el usuario');
      } catch {
        // ignore
      }
      this.socket = null;
    }

    this.isConnected = false;
    this.isConnecting = false;
    this.sessionResumptionHandle = null;
    this.callbacks.onStatusChange?.('disconnected');
  }

  public getSessionHandle(): string | null {
    return this.sessionResumptionHandle;
  }
}
