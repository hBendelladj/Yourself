import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  Key,
  Headphones,
  AlertCircle,
  Volume2,
  Cpu,
  Sparkles,
} from 'lucide-react';
import { useSessionStore } from '@/store/session';
import { LiveClient, isQuotaOrTokenError } from '@/core/live/liveClient';
import { MicCapture } from '@/core/audio/micCapture';
import { PlaybackQueue } from '@/core/audio/playbackQueue';
import { SUPPORTED_MODELS } from '@/lib/constants';

export const ConversationBar: React.FC = () => {
  const {
    apiKey,
    setApiKey,
    characterName,
    voiceGender,
    voiceName,
    modelName,
    setModelName,
    isMicMuted,
    setIsMicMuted,
    conversationState,
    setConversationState,
    setAvatarMood,
    setStage,
    clearAll,
    addTranscript,
    updateLastStreamingTranscript,
    errorMessage,
    setErrorMessage,
    setAnalyserNode,
  } = useSessionStore();

  const [localApiKeyInput, setLocalApiKeyInput] = useState(apiKey);
  const [showKeyPrompt, setShowKeyPrompt] = useState(!apiKey || apiKey.length < 15);
  const [audioLevel, setAudioLevel] = useState(0);

  const liveClientRef = useRef<LiveClient | null>(null);
  const micCaptureRef = useRef<MicCapture | null>(null);
  const playbackQueueRef = useRef<PlaybackQueue | null>(null);

  // Terminar y limpiar sesión
  const handleEndSession = useCallback(() => {
    micCaptureRef.current?.stop();
    playbackQueueRef.current?.clear();
    playbackQueueRef.current?.close();
    liveClientRef.current?.disconnect();

    micCaptureRef.current = null;
    playbackQueueRef.current = null;
    liveClientRef.current = null;

    setAnalyserNode(null);
    setConversationState('setup');
    setAvatarMood('idle');
  }, [setConversationState, setAvatarMood, setAnalyserNode]);

  // Avisar al usuario por voz y texto cuando se acaban los tokens de la API
  const handleTokensExhausted = useCallback(() => {
    const quotaSpoken = 'Uy, se te acabaron los tokens';
    const quotaDisplay = '¡Uy, se te acabaron los tokens!';

    setErrorMessage('¡Uy, se te acabaron los tokens de la API de Gemini! Has alcanzado el límite de cuota o rate limit gratuito.');
    setConversationState('error');

    // 1. Mostrar en transcripción como mensaje dicho por el avatar
    addTranscript({
      id: 'quota-msg-' + Date.now(),
      role: 'assistant',
      text: quotaDisplay,
      timestamp: Date.now(),
    });

    // 2. Animar al avatar hablando y activar lip-sync
    setAvatarMood('speaking');
    playbackQueueRef.current?.simulateLipSync(2.8);

    // 3. Pronunciar en voz alta mediante TTS en español
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(quotaSpoken);
        utterance.lang = 'es-ES';
        utterance.rate = 0.95;
        utterance.pitch = 1.05;

        const voices = window.speechSynthesis.getVoices();
        const esVoices = voices.filter((v) => v.lang.startsWith('es'));
        if (esVoices.length > 0) {
          const femaleMatch = esVoices.find((v) =>
            /monica|paulina|helena|sabina|laura|female|mujer/i.test(v.name)
          );
          const maleMatch = esVoices.find((v) =>
            /jorge|diego|alvaro|carlos|male|hombre/i.test(v.name)
          );
          if (voiceGender === 'mujer' && femaleMatch) {
            utterance.voice = femaleMatch;
          } else if (voiceGender === 'hombre' && maleMatch) {
            utterance.voice = maleMatch;
          } else {
            utterance.voice = esVoices[0]!;
          }
        }

        utterance.onend = () => setAvatarMood('idle');
        utterance.onerror = () => setAvatarMood('idle');
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn('Error en SpeechSynthesis:', err);
        setTimeout(() => setAvatarMood('idle'), 2800);
      }
    } else {
      setTimeout(() => setAvatarMood('idle'), 2800);
    }
  }, [setErrorMessage, setConversationState, addTranscript, setAvatarMood, voiceGender]);

  // Permitir simulación y prueba desde la interfaz
  useEffect(() => {
    const handleSimulate = () => {
      handleTokensExhausted();
    };
    window.addEventListener('yourself:simulate-token-error', handleSimulate);
    return () => {
      window.removeEventListener('yourself:simulate-token-error', handleSimulate);
    };
  }, [handleTokensExhausted]);

  // Iniciar la sesión de voz con Gemini Live
  const startLiveSession = useCallback(async (keyToUse: string, modelToUse?: string) => {
    if (!keyToUse || keyToUse.trim().length < 15) {
      setShowKeyPrompt(true);
      return;
    }

    setErrorMessage(null);
    setConversationState('connecting');

    // 1. Inicializar cola de reproducción de audio a 24 kHz
    const playbackQueue = new PlaybackQueue({
      onStateChange: (isPlaying) => {
        if (isPlaying) {
          setAvatarMood('speaking');
        } else {
          setAvatarMood('listening');
        }
      },
      onInterrupted: () => {
        setAvatarMood('listening');
      },
    });
    playbackQueueRef.current = playbackQueue;
    await playbackQueue.initContext();
    setAnalyserNode(playbackQueue.getAnalyserNode());

    // 2. Inicializar cliente Live con WebSocket
    let currentAssistantMsgId: string | null = null;
    let accumulatedText = '';

    const effectiveModel = modelToUse || modelName;

    const liveClient = new LiveClient({
      apiKey: keyToUse.trim(),
      modelName: effectiveModel,
      characterName: characterName || 'YourSelf',
      voiceName,
      callbacks: {
        onSetupComplete: async () => {
          setConversationState('active');
          setAvatarMood('listening');

          // 3. Iniciar captura de micrófono tras setup exitoso
          try {
            const mic = new MicCapture({
              onAudioChunk: (chunk) => {
                liveClient.sendRealtimeAudio(chunk);
              },
              onError: (err) => {
                console.error('Error de micrófono:', err);
                setErrorMessage(err.message);
              },
            });
            micCaptureRef.current = mic;
            await mic.start();
          } catch (micErr: unknown) {
            console.error('No se pudo iniciar el micrófono:', micErr);
            const msg =
              micErr instanceof Error
                ? micErr.message
                : 'No se pudo acceder al micrófono. Permite el acceso para hablar.';
            setErrorMessage(msg);
          }
        },

        onAudioData: (base64Audio24k) => {
          playbackQueue.enqueueBase64Chunk(base64Audio24k);
        },

        onInterrupted: () => {
          playbackQueue.clear();
          setAvatarMood('listening');
        },

        onTranscript: (_role, text, isStreaming) => {
          if (!currentAssistantMsgId) {
            currentAssistantMsgId = 'msg-' + Date.now();
            accumulatedText = text;
            addTranscript({
              id: currentAssistantMsgId,
              role: 'assistant',
              text: accumulatedText,
              timestamp: Date.now(),
              isStreaming: true,
            });
          } else {
            accumulatedText += text;
            updateLastStreamingTranscript(accumulatedText);
          }

          if (!isStreaming) {
            currentAssistantMsgId = null;
            accumulatedText = '';
          }
        },

        onTurnComplete: () => {
          currentAssistantMsgId = null;
          accumulatedText = '';
        },

        onStatusChange: (status) => {
          if (status === 'connected') {
            setConversationState('active');
          } else if (status === 'reconnecting') {
            setConversationState('connecting');
          } else if (status === 'disconnected') {
            setConversationState('disconnected');
          } else if (status === 'error') {
            setConversationState('error');
          }
        },

        onError: (msg) => {
          if (isQuotaOrTokenError(msg)) {
            handleTokensExhausted();
          } else {
            setErrorMessage(msg);
            setConversationState('error');
          }
        },
      },
    });

    liveClientRef.current = liveClient;
    await liveClient.connect();
  }, [
    modelName,
    characterName,
    voiceName,
    setConversationState,
    setAvatarMood,
    setErrorMessage,
    setAnalyserNode,
    addTranscript,
    updateLastStreamingTranscript,
    handleTokensExhausted,
  ]);

  // Si hay API key disponible al montar, conectar automáticamente
  useEffect(() => {
    if (apiKey && apiKey.length >= 20 && conversationState === 'setup') {
      startLiveSession(apiKey);
    }

    return () => {
      handleEndSession();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Manejo de cambio dinámico de modelo
  const handleModelChange = (newModel: string) => {
    setModelName(newModel);
    if (conversationState === 'active' || conversationState === 'connecting') {
      handleEndSession();
      if (apiKey) {
        startLiveSession(apiKey, newModel);
      }
    }
  };

  // Manejo de silenciamiento de micrófono
  const handleToggleMute = () => {
    const nextMuted = !isMicMuted;
    setIsMicMuted(nextMuted);
    micCaptureRef.current?.setMuted(nextMuted);
  };

  // Monitor simple de nivel de audio para retroalimentación visual
  useEffect(() => {
    let animId: number;
    const updateLevel = () => {
      const analyser = playbackQueueRef.current?.getAnalyserNode();
      if (analyser && conversationState === 'active') {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < 32; i++) {
          sum += data[i]!;
        }
        setAudioLevel(Math.min(100, Math.round((sum / 32) * 1.2)));
      } else {
        setAudioLevel(0);
      }
      animId = requestAnimationFrame(updateLevel);
    };

    animId = requestAnimationFrame(updateLevel);
    return () => cancelAnimationFrame(animId);
  }, [conversationState]);

  const handleSaveAndConnectKey = () => {
    const trimmed = localApiKeyInput.trim();
    if (trimmed.length < 15) return;
    setApiKey(trimmed);
    setShowKeyPrompt(false);
    startLiveSession(trimmed);
  };

  return (
    <div className="w-full max-w-[512px] mx-auto space-y-2">
      {/* Solicitud de API Key si no fue provista en el Setup */}
      {showKeyPrompt && conversationState !== 'active' && (
        <div className="p-4 bg-slate-900 border border-indigo-700/60 rounded-2xl shadow-xl space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-indigo-300">
            <Key className="w-4 h-4 text-indigo-400" />
            <span>Conectar con Gemini Live API para hablar por voz con {characterName || 'tu avatar'}</span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Ingresa tu Gemini API Key para iniciar la conversación de voz en tiempo real:
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={localApiKeyInput}
              onChange={(e) => setLocalApiKeyInput(e.target.value)}
              placeholder="AIzaSy..."
              className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-slate-100 focus:outline-hidden focus:border-indigo-500"
            />
            <button
              onClick={handleSaveAndConnectKey}
              disabled={localApiKeyInput.trim().length < 15}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
            >
              Conectar
            </button>
          </div>
          <p className="text-[10px] text-slate-500">
            La clave va directa a Google y no se almacena en disco ni servidores intermediarios.
          </p>
        </div>
      )}

      {/* Selector Rápido de Modelo de Voz */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-950/70 border border-slate-800/80 rounded-xl text-xs">
        <div className="flex items-center gap-1.5 text-slate-400">
          <Cpu className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-[11px] font-medium">Modelo Live:</span>
        </div>
        <select
          value={modelName}
          onChange={(e) => handleModelChange(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-[11px] text-indigo-300 font-mono focus:outline-hidden focus:border-indigo-500 cursor-pointer"
        >
          {SUPPORTED_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {/* Barra Principal de Conversación */}
      <div className="flex items-center justify-between gap-3 p-3 bg-slate-900/90 border border-slate-800 rounded-2xl backdrop-blur-md shadow-xl">
        {/* Indicador de Estado de Conexión */}
        <div className="flex items-center gap-2.5">
          <span
            className={`w-3 h-3 rounded-full shrink-0 ${
              conversationState === 'active'
                ? 'bg-emerald-500 animate-pulse'
                : conversationState === 'connecting'
                  ? 'bg-amber-400 animate-ping'
                  : conversationState === 'error'
                    ? 'bg-rose-500'
                    : 'bg-slate-600'
            }`}
          />
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-slate-200">
              {conversationState === 'active'
                ? `En Vivo con ${characterName || 'YourSelf'}`
                : conversationState === 'connecting'
                  ? 'Conectando con Gemini...'
                  : conversationState === 'error'
                    ? 'Error de conexión'
                    : 'En reposo'}
            </span>
            <span className="text-[10px] text-slate-400 capitalize">
              {conversationState === 'active' && audioLevel > 5
                ? 'Voz activa'
                : conversationState === 'active'
                  ? 'Escuchando tu voz...'
                  : 'Listo para conectar'}
            </span>
          </div>
        </div>

        {/* Onda de actividad de audio */}
        {conversationState === 'active' && (
          <div className="hidden sm:flex items-center gap-1 px-3 py-1 bg-slate-950/60 rounded-full border border-slate-800">
            <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
            <div className="w-16 h-2 bg-slate-800 rounded-full overflow-hidden flex items-center">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-75"
                style={{ width: `${Math.max(5, audioLevel)}%` }}
              />
            </div>
          </div>
        )}

        {/* Botones de Control */}
        <div className="flex items-center gap-2">
          {/* Botón Silenciar Micrófono */}
          <button
            onClick={handleToggleMute}
            disabled={conversationState !== 'active'}
            className={`p-2.5 rounded-xl transition-all cursor-pointer ${
              conversationState !== 'active'
                ? 'bg-slate-950 border border-slate-800 text-slate-600 cursor-not-allowed'
                : isMicMuted
                  ? 'bg-rose-950/70 border border-rose-800 text-rose-400 shadow-md'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md'
            }`}
            title={isMicMuted ? 'Activar micrófono' : 'Silenciar micrófono'}
          >
            {isMicMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          {/* Botón Conectar si está desconectado */}
          {conversationState !== 'active' && conversationState !== 'connecting' && (
            <button
              onClick={() => {
                if (apiKey) {
                  startLiveSession(apiKey);
                } else {
                  setShowKeyPrompt(true);
                }
              }}
              className="px-3 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-md"
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Conectar Voz</span>
            </button>
          )}

          {/* Botón Terminar Sesión */}
          <button
            onClick={() => {
              handleEndSession();
              setStage('setup');
              clearAll();
            }}
            className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-900/60 text-rose-400 hover:bg-rose-900/60 hover:text-white transition-all cursor-pointer"
            title="Finalizar sesión y volver al inicio"
          >
            <PhoneOff className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Aviso de Recomendación de Auriculares para evitar retroalimentación */}
      <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
        <div className="flex items-center gap-1.5">
          <Headphones className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span>Usa audífonos para evitar eco entre tus altavoces y el micrófono.</span>
        </div>
        {conversationState === 'active' && (
          <span className="text-[10px] text-emerald-400 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Voz activa
          </span>
        )}
      </div>

      {/* Mensaje de error si la conexión falló */}
      {conversationState === 'error' && (
        isQuotaOrTokenError(errorMessage) ? (
          <div className="p-3 bg-amber-950/80 border border-amber-600/70 text-amber-200 text-xs rounded-xl flex items-start gap-2.5 shadow-lg">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1 w-full">
              <div className="flex items-center justify-between">
                <p className="font-bold text-amber-100 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>¡Uy, se te acabaron los tokens!</span>
                </p>
                <button
                  type="button"
                  onClick={handleTokensExhausted}
                  className="text-[10px] bg-amber-800/60 hover:bg-amber-700/80 text-amber-100 px-2 py-0.5 rounded cursor-pointer transition-colors"
                  title="Hacer que el avatar repita el aviso de tokens"
                >
                  Repetir audio
                </button>
              </div>
              <p className="text-[11px] text-amber-300/90 leading-relaxed">
                Tu Gemini API Key ha agotado su cuota de tokens o alcanzado el límite gratuito de Google.
                Puedes ingresar una nueva clave o cambiar de modelo.
              </p>
              <div className="pt-1 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowKeyPrompt(true)}
                  className="text-xs text-amber-300 hover:text-white underline font-semibold cursor-pointer"
                >
                  Cambiar API Key ahora
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-3 bg-rose-950/70 border border-rose-800 text-rose-200 text-xs rounded-xl flex items-start gap-2 shadow-lg">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">{errorMessage || 'Fallo en la conexión con Gemini Live.'}</p>
              <p className="text-[11px] text-rose-300">
                Prueba cambiando el modelo arriba a <code className="bg-rose-900/60 px-1 rounded">gemini-live-2.5-flash-preview</code> o <code className="bg-rose-900/60 px-1 rounded">gemini-2.5-flash</code> y pulsa Conectar Voz.
              </p>
            </div>
          </div>
        )
      )}
    </div>
  );
};
