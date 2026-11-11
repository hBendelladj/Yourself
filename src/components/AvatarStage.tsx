import React, { useRef, useEffect, useState } from 'react';
import { useSessionStore } from '@/store/session';
import { buildFaceMesh } from '@/core/face/buildMesh';
import {
  AvatarRenderer,
  DebugMetrics,
  LayerGains,
  SpeechGains,
  HeadGains,
} from '@/core/render/avatarRenderer';
import { PoseValues } from '@/core/animation/animationState';
import { AvatarMood } from '@/lib/types';
import { AvatarDebugPanel } from '@/components/AvatarDebugPanel';
import {
  ArrowLeft,
  Bug,
  AlertTriangle,
  RotateCcw,
  Eye,
  Activity,
  Smile,
  Ear,
  Brain,
  MessageSquare,
  Sparkles,
} from 'lucide-react';

export const AvatarStage: React.FC = () => {
  const {
    characterName,
    imageUrl,
    imageDimensions,
    faceLandmarks,
    facialTransformationMatrix,
    setStage,
    avatarMood,
    setAvatarMood,
    isDebugOverlay,
    setIsDebugOverlay,
    rigVersion,
    setRigVersion,
    analyserNode,
    transcripts,
  } = useSessionStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<AvatarRenderer | null>(null);
  const isDebugRef = useRef(isDebugOverlay);
  isDebugRef.current = isDebugOverlay;
  const moodRef = useRef(avatarMood);
  moodRef.current = avatarMood;
  const rigVersionRef = useRef(rigVersion);
  rigVersionRef.current = rigVersion;
  const analyserNodeRef = useRef(analyserNode);
  analyserNodeRef.current = analyserNode;

  const [webGlError, setWebGlError] = useState<string | null>(null);
  const [fps, setFps] = useState<number>(60);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isBlinking, setIsBlinking] = useState(false);
  const [metrics, setMetrics] = useState<DebugMetrics | null>(null);
  const [layerGains, setLayerGains] = useState<LayerGains>({
    lips: 1.0,
    expression: 1.0,
    pose: 1.0,
  });
  const [speechGains, setSpeechGains] = useState<SpeechGains>({
    jawGain: 1.0,
    bilabialTightness: 1.0,
  });
  const [headGains, setHeadGains] = useState<HeadGains>({
    speechGain: 1.0,
    idleGain: 1.0,
    breathGain: 1.0,
    gestureFrequency: 1.0,
  });
  const [emotionSensitivity, setEmotionSensitivity] = useState(1.0);
  const [blinkRate, setBlinkRate] = useState(1.0);
  const [manualChannels, setManualChannels] = useState<Partial<PoseValues> | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !imageUrl || !faceLandmarks || faceLandmarks.length === 0) {
      return;
    }

    setWebGlError(null);
    setIsInitializing(true);

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const width = imageDimensions?.width || img.naturalWidth || 512;
        const height = imageDimensions?.height || img.naturalHeight || 512;

        // 1. Construir geometría Delaunay con anclas
        const meshData = buildFaceMesh(faceLandmarks, width, height);

        // 2. Limpiar renderer previo si existía
        if (rendererRef.current) {
          rendererRef.current.destroy();
          rendererRef.current = null;
        }

        // 3. Crear instancia del AvatarRenderer con Three.js, reposo vivo y lip-sync
        const renderer = new AvatarRenderer({
          canvas: canvasRef.current!,
          imageElement: img,
          meshData,
          transformationMatrix: facialTransformationMatrix || undefined,
          isDebug: isDebugRef.current,
          initialMood: moodRef.current,
          analyserNode: analyserNodeRef.current,
          rigVersion: rigVersionRef.current,
          onFpsUpdate: (currentFps) => setFps(currentFps),
          onBlinkChange: (blinking) => setIsBlinking(blinking),
          onMetricsUpdate: (m) => setMetrics(m),
        });

        rendererRef.current = renderer;
        setIsInitializing(false);
      } catch (err: unknown) {
        console.error('Error al iniciar AvatarRenderer:', err);
        setWebGlError(
          err instanceof Error
            ? err.message
            : 'Error inesperado al inicializar el motor de renderizado WebGL.'
        );
        setIsInitializing(false);
      }
    };

    img.onerror = () => {
      setWebGlError('No se pudo recargar la imagen del avatar para Three.js.');
      setIsInitializing(false);
    };

    img.src = imageUrl;

    const handleResize = () => {
      rendererRef.current?.handleResize();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
    };
  }, [imageUrl, faceLandmarks, imageDimensions, facialTransformationMatrix]);

  // Actualizar modo de depuración en tiempo de ejecución
  useEffect(() => {
    rendererRef.current?.setDebugOverlay(isDebugOverlay);
  }, [isDebugOverlay]);

  // Actualizar versión de Rig (v1 / v2)
  useEffect(() => {
    rendererRef.current?.setRigVersion(rigVersion);
  }, [rigVersion]);

  // Actualizar estado de ánimo en el renderizador
  useEffect(() => {
    rendererRef.current?.setMood(avatarMood);
  }, [avatarMood]);

  // Actualizar AnalyserNode para lip-sync en tiempo real
  useEffect(() => {
    rendererRef.current?.setAudioAnalyser(analyserNode);
  }, [analyserNode]);

  // Transmitir fragmentos de transcripción en español al VisemeScheduler y Director de V2
  const processedTextLengthRef = useRef(0);
  const lastTranscriptIdRef = useRef<string | null>(null);

  useEffect(() => {
    const lastMsg = transcripts[transcripts.length - 1];
    if (lastMsg) {
      if (lastTranscriptIdRef.current !== lastMsg.id) {
        lastTranscriptIdRef.current = lastMsg.id;
        processedTextLengthRef.current = 0;
      }
      const newText = lastMsg.text.slice(processedTextLengthRef.current);
      if (newText.length > 0) {
        processedTextLengthRef.current = lastMsg.text.length;
        if (lastMsg.role === 'assistant') {
          rendererRef.current?.enqueueTranscript(newText);
        } else if (lastMsg.role === 'user') {
          rendererRef.current?.getDirector().processText(newText);
        }
      }
    }
  }, [transcripts]);

  // Si el avatar pasa a 'listening' o se interrumpe, vaciar cola de visemas pendientes
  useEffect(() => {
    if (avatarMood === 'listening') {
      rendererRef.current?.onInterrupted();
    }
  }, [avatarMood]);

  const handleLayerGainsChange = (gains: Partial<LayerGains>) => {
    setLayerGains((prev) => {
      const updated = { ...prev, ...gains };
      rendererRef.current?.setLayerGains(updated);
      return updated;
    });
  };

  const handleSpeechGainsChange = (gains: Partial<SpeechGains>) => {
    setSpeechGains((prev) => {
      const updated = { ...prev, ...gains };
      rendererRef.current?.setSpeechGains(updated);
      return updated;
    });
  };

  const handleHeadGainsChange = (gains: Partial<HeadGains>) => {
    setHeadGains((prev) => {
      const updated = { ...prev, ...gains };
      rendererRef.current?.setHeadGains(updated);
      return updated;
    });
  };

  const handleEmotionSensitivityChange = (val: number) => {
    setEmotionSensitivity(val);
    rendererRef.current?.setEmotionSensitivity(val);
  };

  const handleBlinkRateChange = (val: number) => {
    setBlinkRate(val);
    rendererRef.current?.setBlinkRate(val);
  };

  const handleManualChannelsChange = (channels: Partial<PoseValues> | null) => {
    setManualChannels(channels);
    rendererRef.current?.setManualChannels(channels);
  };

  // Controles 3D interactivos: arrastre del ratón y teclas de flecha (Fase 2)
  const isDraggingRef = useRef(false);
  const dragDistanceRef = useRef(0);
  const dragStartRef = useRef<{ x: number; y: number; yaw: number; pitch: number; roll: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignorar en entornos de test o si el puntero ya está capturado
    }
    isDraggingRef.current = true;
    dragDistanceRef.current = 0;
    const curYaw = manualChannels?.headYaw ?? 0;
    const curPitch = manualChannels?.headPitch ?? 0;
    const curRoll = manualChannels?.headRoll ?? 0;
    dragStartRef.current = { x: e.clientX, y: e.clientY, yaw: curYaw, pitch: curPitch, roll: curRoll };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    dragDistanceRef.current = Math.hypot(dx, dy);

    if (dragDistanceRef.current > 3) {
      if (e.shiftKey) {
        // Shift + Arrastre horizontal: ladeo (roll ±10° ≈ ±0.175 rad)
        const dRoll = (dx / 200) * 0.175;
        const newRoll = Math.max(-0.175, Math.min(0.175, dragStartRef.current.roll + dRoll));
        handleManualChannelsChange({ ...(manualChannels || {}), headRoll: newRoll });
      } else {
        // Giro horizontal (yaw ±30° ≈ ±0.524 rad) e inclinación (pitch ±20° ≈ ±0.349 rad)
        const dYaw = (dx / 180) * 0.524;
        const dPitch = (-dy / 180) * 0.349;
        const newYaw = Math.max(-0.524, Math.min(0.524, dragStartRef.current.yaw + dYaw));
        const newPitch = Math.max(-0.349, Math.min(0.349, dragStartRef.current.pitch + dPitch));
        handleManualChannelsChange({ ...(manualChannels || {}), headYaw: newYaw, headPitch: newPitch });
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current) {
      if (dragDistanceRef.current < 5) {
        // Si no hubo desplazamiento significativo, cuenta como clic para parpadear
        handleManualBlink();
      }
      isDraggingRef.current = false;
      dragStartRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const curYaw = manualChannels?.headYaw ?? 0;
    const curPitch = manualChannels?.headPitch ?? 0;
    const curRoll = manualChannels?.headRoll ?? 0;

    let handled = true;
    if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const step = e.key === 'ArrowLeft' ? -0.025 : 0.025;
      const newRoll = Math.max(-0.175, Math.min(0.175, curRoll + step));
      handleManualChannelsChange({ ...(manualChannels || {}), headRoll: newRoll });
    } else if (e.key === 'ArrowLeft') {
      const newYaw = Math.max(-0.524, curYaw - 0.05);
      handleManualChannelsChange({ ...(manualChannels || {}), headYaw: newYaw });
    } else if (e.key === 'ArrowRight') {
      const newYaw = Math.min(0.524, curYaw + 0.05);
      handleManualChannelsChange({ ...(manualChannels || {}), headYaw: newYaw });
    } else if (e.key === 'ArrowUp') {
      const newPitch = Math.min(0.349, curPitch + 0.035);
      handleManualChannelsChange({ ...(manualChannels || {}), headPitch: newPitch });
    } else if (e.key === 'ArrowDown') {
      const newPitch = Math.max(-0.349, curPitch - 0.035);
      handleManualChannelsChange({ ...(manualChannels || {}), headPitch: newPitch });
    } else if (e.key === ' ' || e.key === 'r' || e.key === 'R') {
      // Espacio o R: restablecer orientación de cabeza al reposo automático
      handleManualChannelsChange({
        ...(manualChannels || {}),
        headYaw: 0,
        headPitch: 0,
        headRoll: 0,
      });
    } else {
      handled = false;
    }

    if (handled) {
      e.preventDefault();
    }
  };

  const [activeVisemeTest, setActiveVisemeTest] = useState<string | null>(null);
  const visemeTimeoutRef = useRef<number | null>(null);

  const testViseme = (name: string, visemes: { jawOpen?: number; mouthRound?: number; mouthWide?: number; smile?: number }) => {
    if (visemeTimeoutRef.current) {
      window.clearTimeout(visemeTimeoutRef.current);
    }
    setActiveVisemeTest(name);
    rendererRef.current?.setManualVisemes(visemes);

    visemeTimeoutRef.current = window.setTimeout(() => {
      rendererRef.current?.setManualVisemes(null);
      setActiveVisemeTest(null);
    }, 1500);
  };

  const handleManualBlink = () => {
    rendererRef.current?.triggerBlink();
  };

  const moods: { id: AvatarMood; label: string; icon: React.ReactNode }[] = [
    { id: 'idle', label: 'Reposo', icon: <Smile className="w-3.5 h-3.5" /> },
    { id: 'listening', label: 'Escuchando', icon: <Ear className="w-3.5 h-3.5" /> },
    { id: 'thinking', label: 'Pensando', icon: <Brain className="w-3.5 h-3.5" /> },
    { id: 'speaking', label: 'Hablando', icon: <MessageSquare className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="w-full max-w-[512px] mx-auto flex flex-col items-center justify-center p-0">
      {/* Barra de Controles y Estado Superior */}
      <div className="w-full flex items-center justify-between gap-3 mb-4 flex-wrap">
        <button
          onClick={() => setStage('setup')}
          className="inline-flex items-center gap-2 text-xs font-medium text-slate-300 hover:text-white px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 transition-colors cursor-pointer shadow-sm hover:border-slate-700"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Configuración</span>
        </button>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs">
            <span className="text-slate-400">Avatar:</span>
            <span className="font-bold text-white text-indigo-300">
              {characterName || 'YourSelf'}
            </span>
          </div>

          {/* Botón para forzar parpadeo manual con feedback visual activo */}
          <button
            onClick={handleManualBlink}
            title="Probar parpadeo instantáneo"
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-sm ${
              isBlinking
                ? 'bg-amber-400 text-slate-950 scale-105 shadow-amber-400/30'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{isBlinking ? '¡Parpadeando!' : 'Probar Parpadeo'}</span>
          </button>

          {/* Toggle de depuración visual */}
          <button
            onClick={() => setIsDebugOverlay(!isDebugOverlay)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
              isDebugOverlay
                ? 'bg-indigo-950 border-indigo-500 text-indigo-300 shadow-xs'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bug className="w-3.5 h-3.5" />
            <span>{isDebugOverlay ? 'Ocultar Malla' : 'Ver Malla'}</span>
          </button>
        </div>
      </div>

      {/* Selector Rápido de Estados de Ánimo para Evaluación */}
      <div className="w-full max-w-[512px] flex items-center justify-between gap-1 p-1 bg-slate-900/80 border border-slate-800/80 rounded-xl mb-2 shadow-md">
        {moods.map((m) => {
          const isActive = avatarMood === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setAvatarMood(m.id)}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              {m.icon}
              <span>{m.label}</span>
            </button>
          );
        })}
      </div>

      {/* Botones de Evaluación Rápida de Lip-Sync y Cavidad Bucal */}
      <div className="w-full max-w-[512px] flex items-center justify-between gap-1.5 mb-3 px-1 flex-wrap">
        <span className="text-[11px] text-slate-400 font-medium shrink-0 flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-amber-400" />
          Probar Lip-sync:
        </span>
        <div className="flex items-center gap-1.5 flex-1 justify-end flex-wrap">
          <button
            onClick={() => testViseme('jaw', { jawOpen: 0.42 })}
            className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all cursor-pointer border ${
              activeVisemeTest === 'jaw'
                ? 'bg-amber-400 text-slate-950 border-amber-300 font-bold scale-105 shadow-md shadow-amber-400/20'
                : 'bg-slate-900/90 text-slate-300 border-slate-800 hover:border-slate-700 hover:text-white'
            }`}
            title="Apertura mandibular calibrada para verificar dientes y cavidad oral de forma natural"
          >
            {activeVisemeTest === 'jaw' ? '👄 ¡Boca Abierta!' : '👄 Boca y Dientes'}
          </button>
          <button
            onClick={() => testViseme('round', { jawOpen: 0.28, mouthRound: 0.65 })}
            className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all cursor-pointer border ${
              activeVisemeTest === 'round'
                ? 'bg-amber-400 text-slate-950 border-amber-300 font-bold scale-105 shadow-md shadow-amber-400/20'
                : 'bg-slate-900/90 text-slate-300 border-slate-800 hover:border-slate-700 hover:text-white'
            }`}
            title="Visema vocal redondeado (O / U)"
          >
            {activeVisemeTest === 'round' ? '⭕ ¡Vocal O!' : 'Vocal O (Redondeo)'}
          </button>
          <button
            onClick={() => testViseme('wide', { jawOpen: 0.25, mouthWide: 0.50, smile: 0.30 })}
            className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all cursor-pointer border ${
              activeVisemeTest === 'wide'
                ? 'bg-amber-400 text-slate-950 border-amber-300 font-bold scale-105 shadow-md shadow-amber-400/20'
                : 'bg-slate-900/90 text-slate-300 border-slate-800 hover:border-slate-700 hover:text-white'
            }`}
            title="Visema vocal extendido (E / I / Sonrisa)"
          >
            {activeVisemeTest === 'wide' ? '😁 ¡Vocal E!' : 'Vocal E (Estiramiento)'}
          </button>
        </div>
      </div>

      {/* Contenedor del Canvas de WebGL con Arrastre 3D y Atajos de Teclado */}
      <div
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        title="Arrastra para rotar la cabeza en 3D (±30° yaw, ±20° pitch, Shift+arrastre para roll). Usa flechas (← ↑ → ↓) o pulsa Espacio para centrar. Clic simple para parpadear."
        className="relative w-full aspect-square max-w-[512px] bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 shadow-2xl flex items-center justify-center cursor-grab active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-indigo-500/50 group select-none touch-none"
      >
        {webGlError ? (
          <div className="p-6 text-center max-w-sm space-y-3 bg-rose-950/40 border border-rose-900/60 rounded-xl m-4">
            <AlertTriangle className="w-10 h-10 text-rose-400 mx-auto" />
            <h3 className="text-sm font-bold text-rose-200">Fallo en WebGL</h3>
            <p className="text-xs text-rose-300 leading-relaxed">{webGlError}</p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-rose-900/60 text-white hover:bg-rose-800 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Recargar Página</span>
            </button>
          </div>
        ) : (
          <>
            <canvas
              ref={canvasRef}
              className="w-full h-full object-contain block"
            />

            {/* Spinner de Inicialización */}
            {isInitializing && (
              <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-xs flex flex-col items-center justify-center text-center p-4">
                <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3"></div>
                <p className="text-sm font-medium text-slate-200">
                  Iniciando reposo vivo y deformador de poses...
                </p>
                <p className="text-xs text-slate-400 mt-1">Calculando armónicos de balanceo</p>
              </div>
            )}

            {/* Overlay Informativo de Depuración */}
            {isDebugOverlay && !isInitializing && (
              <div className="absolute top-3 left-3 bg-slate-950/85 backdrop-blur-md border border-slate-800 text-[11px] px-3 py-2 rounded-lg text-slate-300 space-y-1 shadow-lg pointer-events-none">
                <div className="flex items-center justify-between gap-4 font-mono">
                  <span className="text-slate-400">Rendimiento:</span>
                  <span
                    className={`font-bold ${
                      fps >= 50
                        ? 'text-emerald-400'
                        : fps >= 30
                          ? 'text-amber-400'
                          : 'text-rose-400'
                    }`}
                  >
                    {fps} FPS
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 font-mono">
                  <span className="text-slate-400">Estado:</span>
                  <span className="font-bold text-indigo-400 uppercase">{avatarMood}</span>
                </div>
                <div className="flex items-center gap-2 pt-1 border-t border-slate-800 text-[10px]">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block"></span>
                  <span>Rostro vivo</span>
                  <span className="w-2 h-2 rounded-full bg-pink-500 inline-block ml-1"></span>
                  <span>Borde estático</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Panel Extendido de Diagnóstico, Métricas y Rig (?debug=1) */}
      {isDebugOverlay && !isInitializing && (
        <AvatarDebugPanel
          metrics={metrics}
          rigVersion={rigVersion}
          layerGains={layerGains}
          speechGains={speechGains}
          headGains={headGains}
          emotionSensitivity={emotionSensitivity}
          blinkRate={blinkRate}
          manualChannels={manualChannels}
          onRigVersionChange={setRigVersion}
          onLayerGainsChange={handleLayerGainsChange}
          onSpeechGainsChange={handleSpeechGainsChange}
          onHeadGainsChange={handleHeadGainsChange}
          onEmotionSensitivityChange={handleEmotionSensitivityChange}
          onBlinkRateChange={handleBlinkRateChange}
          onManualChannelsChange={handleManualChannelsChange}
          onTriggerAction={(id, scale) => rendererRef.current?.triggerAction(id, scale)}
          onSetEmotion={(valence, arousal) => rendererRef.current?.setEmotion(valence, arousal)}
        />
      )}

      {/* Indicador de Control Manual de Cabeza 3D si está activo */}
      {(manualChannels?.headYaw !== undefined ||
        manualChannels?.headPitch !== undefined ||
        manualChannels?.headRoll !== undefined) &&
        (Math.abs(manualChannels?.headYaw ?? 0) > 0.001 ||
          Math.abs(manualChannels?.headPitch ?? 0) > 0.001 ||
          Math.abs(manualChannels?.headRoll ?? 0) > 0.001) && (
          <div className="w-full max-w-[512px] mt-2 flex items-center justify-between px-3 py-1.5 bg-slate-900/90 border border-indigo-500/40 rounded-xl text-xs text-slate-300 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-indigo-300">Giro 3D Manual:</span>
              <span className="font-mono text-cyan-300">
                Yaw {((manualChannels?.headYaw ?? 0) * (180 / Math.PI)).toFixed(1)}° · Pitch{' '}
                {((manualChannels?.headPitch ?? 0) * (180 / Math.PI)).toFixed(1)}° · Roll{' '}
                {((manualChannels?.headRoll ?? 0) * (180 / Math.PI)).toFixed(1)}°
              </span>
            </div>
            <button
              onClick={() =>
                handleManualChannelsChange({
                  ...(manualChannels || {}),
                  headYaw: 0,
                  headPitch: 0,
                  headRoll: 0,
                })
              }
              className="text-[11px] px-2 py-0.5 rounded bg-indigo-950 border border-indigo-500/40 text-indigo-200 hover:text-white cursor-pointer"
              title="Restablecer giro manual al reposo automático"
            >
              Centrar (Espacio)
            </button>
          </div>
        )}

      {/* Indicador de Estado de Reposo Vivo y ayuda */}
      <div className="mt-4 flex flex-col items-center gap-1.5 text-center">
        <div className="flex items-center gap-2 text-xs text-slate-300 bg-slate-900/80 border border-slate-800 px-4 py-1.5 rounded-full shadow-sm">
          <Activity className="w-4 h-4 text-emerald-400 animate-pulse shrink-0" />
          <span>
            {isBlinking
              ? '👁️ Cerrando y abriendo párpados...'
              : 'Reposo vivo activo: parpadeo aleatorio, micro-mirada, balanceo armónico y respiración'}
          </span>
        </div>
        <p className="text-[11px] text-slate-500">
          Tip: Haz clic directamente sobre el avatar o pulsa el botón "Probar Parpadeo" para accionarlo.
        </p>
      </div>
    </div>
  );
};
