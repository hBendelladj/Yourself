import React, { useState, useEffect } from 'react';
import {
  Activity,
  Cpu,
  Layers,
  Sliders,
  RotateCcw,
  Sparkles,
  BarChart2,
} from 'lucide-react';
import { DebugMetrics, LayerGains, SpeechGains, HeadGains } from '@/core/render/avatarRenderer';
import { PoseValues } from '@/core/animation/animationState';
import { ActionId } from '@/core/animation/actions';
import { RigVersion } from '@/store/session';
import referenceStats from '../../docs/reference_stats.json';

const Sparkline: React.FC<{
  data: number[];
  min?: number;
  max?: number;
  color?: string;
  height?: number;
  threshold?: number;
}> = ({ data, min = 0, max = 1, color = '#22d3ee', height = 28, threshold }) => {
  if (!data || data.length < 2) {
    return (
      <div className="h-7 w-full bg-slate-900/40 rounded flex items-center justify-center text-[9px] text-slate-500 font-mono">
        Recopilando muestras...
      </div>
    );
  }

  const w = 220;
  const h = height;
  const padding = 2;
  const effectiveH = h - padding * 2;
  const span = Math.max(1e-4, max - min);

  const points = data
    .map((v, i) => {
      const x = padding + (i / (data.length - 1)) * (w - padding * 2);
      const normY = Math.max(0, Math.min(1, (v - min) / span));
      const y = h - padding - normY * effectiveH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const threshY =
    threshold !== undefined
      ? h - padding - Math.max(0, Math.min(1, (threshold - min) / span)) * effectiveH
      : null;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-7 overflow-visible">
      {threshY !== null && (
        <line
          x1="0"
          y1={threshY}
          x2={w}
          y2={threshY}
          stroke="#f43f5e"
          strokeDasharray="3,3"
          strokeWidth="1"
          opacity="0.8"
        />
      )}
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
};

const MultiSparkline: React.FC<{
  series: { data: number[]; color: string; label: string }[];
  min: number;
  max: number;
  height?: number;
}> = ({ series, min, max, height = 28 }) => {
  const w = 220;
  const h = height;
  const padding = 2;
  const effectiveH = h - padding * 2;
  const span = Math.max(1e-4, max - min);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-7 overflow-visible">
      <line
        x1="0"
        y1={h / 2}
        x2={w}
        y2={h / 2}
        stroke="#334155"
        strokeWidth="0.8"
        strokeDasharray="2,2"
      />
      {series.map((s) => {
        if (!s.data || s.data.length < 2) return null;
        const pts = s.data
          .map((v, i) => {
            const x = padding + (i / (s.data.length - 1)) * (w - padding * 2);
            const normY = Math.max(0, Math.min(1, (v - min) / span));
            const y = h - padding - normY * effectiveH;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ');
        return (
          <polyline
            key={s.label}
            fill="none"
            stroke={s.color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={pts}
          />
        );
      })}
    </svg>
  );
};

interface AvatarDebugPanelProps {
  metrics: DebugMetrics | null;
  rigVersion: RigVersion;
  layerGains: LayerGains;
  speechGains?: SpeechGains;
  headGains?: HeadGains;
  emotionSensitivity?: number;
  blinkRate?: number;
  manualChannels: Partial<PoseValues> | null;
  onRigVersionChange: (version: RigVersion) => void;
  onLayerGainsChange: (gains: Partial<LayerGains>) => void;
  onSpeechGainsChange?: (gains: Partial<SpeechGains>) => void;
  onHeadGainsChange?: (gains: Partial<HeadGains>) => void;
  onEmotionSensitivityChange?: (sensitivity: number) => void;
  onBlinkRateChange?: (rate: number) => void;
  onManualChannelsChange: (channels: Partial<PoseValues> | null) => void;
  onTriggerAction?: (id: ActionId, scale?: number) => void;
  onSetEmotion?: (valence: number, arousal: number) => void;
  onClose?: () => void;
}

export const AvatarDebugPanel: React.FC<AvatarDebugPanelProps> = ({
  metrics,
  rigVersion,
  layerGains,
  speechGains = { jawGain: 1.0, bilabialTightness: 1.0 },
  headGains = { speechGain: 1.0, idleGain: 1.0, breathGain: 1.0, gestureFrequency: 1.0 },
  emotionSensitivity = 1.0,
  blinkRate = 1.0,
  manualChannels,
  onRigVersionChange,
  onLayerGainsChange,
  onSpeechGainsChange,
  onHeadGainsChange,
  onEmotionSensitivityChange,
  onBlinkRateChange,
  onManualChannelsChange,
  onTriggerAction,
  onSetEmotion,
}) => {
  const [activeTab, setActiveTab] = useState<'perf' | 'compare' | 'layers' | 'channels' | 'actions' | 'v4'>('perf');

  // Series temporales en tiempo real para gráficos (Fase 4: máx 40 puntos históricos)
  const [jawHistory, setJawHistory] = useState<number[]>([]);
  const [yawHistory, setYawHistory] = useState<number[]>([]);
  const [pitchHistory, setPitchHistory] = useState<number[]>([]);
  const [rollHistory, setRollHistory] = useState<number[]>([]);
  const [blinkHistory, setBlinkHistory] = useState<number[]>([]);
  const [perfHistory, setPerfHistory] = useState<number[]>([]);

  useEffect(() => {
    if (!metrics) return;
    const maxSamples = 40;
    setJawHistory((prev) => [...prev.slice(-maxSamples + 1), metrics.currentJawOpen]);
    setYawHistory((prev) => [...prev.slice(-maxSamples + 1), (metrics.currentYaw * 180) / Math.PI]);
    setPitchHistory((prev) => [...prev.slice(-maxSamples + 1), (metrics.currentPitch * 180) / Math.PI]);
    setRollHistory((prev) => [...prev.slice(-maxSamples + 1), (metrics.currentRoll * 180) / Math.PI]);
    setBlinkHistory((prev) => [...prev.slice(-maxSamples + 1), metrics.currentBlink]);
    setPerfHistory((prev) => [...prev.slice(-maxSamples + 1), metrics.perf.totalJsMs]);
  }, [metrics]);

  // Presupuestos objetivo (en milisegundos por fotograma)
  const budgets = {
    prosodyVisemes: 0.8,
    directorDynamics: 0.4,
    rigApply: 0.8,
    overlaysShading: 1.0,
    totalJs: 4.0,
  };

  const perf = metrics?.perf ?? {
    prosodyVisemesMs: 0,
    directorDynamicsMs: 0,
    rigApplyMs: 0,
    overlaysShadingMs: 0,
    totalJsMs: 0,
  };

  const histogram = metrics?.jawOpenHistogram ?? [100, 0, 0, 0, 0];
  const blinksPerMin = metrics?.blinksPerMinute ?? 0;
  const headRms = metrics?.headMovementRms ?? 0;
  const currentJaw = metrics?.currentJawOpen ?? 0;
  const fps = metrics?.fps ?? 60;

  const handleChannelSlider = (key: keyof PoseValues, val: number) => {
    onManualChannelsChange({
      ...(manualChannels || {}),
      [key]: val,
    });
  };

  const handleResetChannels = () => {
    onManualChannelsChange(null);
  };

  const handleResetGains = () => {
    onLayerGainsChange({ lips: 1.0, expression: 1.0, pose: 1.0 });
  };

  return (
    <div className="w-full max-w-[512px] bg-slate-950/95 backdrop-blur-md border border-slate-800 rounded-2xl p-4 text-slate-200 shadow-2xl mt-4">
      {/* Header y Selector de Rig */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-white">
            Panel de Diagnóstico & Rig
          </span>
        </div>

        {/* Toggle ?rig=v1|v2|v3 */}
        <div className="flex items-center bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-xs">
          <button
            onClick={() => onRigVersionChange('v1')}
            className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
              rigVersion === 'v1'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Rig V1 (Línea base: deformación analítica y senos)"
          >
            Rig V1
          </button>
          <button
            onClick={() => onRigVersionChange('v2')}
            className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer flex items-center gap-1 ${
              rigVersion === 'v2'
                ? 'bg-cyan-500 text-slate-950 shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Rig V2 (Modular: Capas lips/expression/pose, overlay de boca y párpados)"
          >
            Rig V2
          </button>
          <button
            onClick={() => onRigVersionChange('v3')}
            className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer flex items-center gap-1 ${
              rigVersion === 'v3'
                ? 'bg-emerald-500 text-slate-950 shadow-xs font-bold'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Rig V3 (Eye & Eyelid Engine: Desacoplamiento esférico 3D, invarianza pupilar y concha anatómica)"
          >
            <Sparkles className="w-3 h-3 text-emerald-950" />
            Rig V3
          </button>
          <button
            onClick={() => onRigVersionChange('v4')}
            className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer flex items-center gap-1 ${
              rigVersion === 'v4'
                ? 'bg-amber-400 text-slate-950 shadow-xs font-bold'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Rig V4 (3D Head & Natural Speech: Bisagra condilar, SVD Umeyama, boca 3D stencil, LPC acústico y coarticulación)"
          >
            <Sparkles className="w-3 h-3 text-amber-950" />
            Rig V4
          </button>
        </div>
      </div>

      {/* Botón de prueba rápida para simular agotamiento de tokens */}
      <div className="mb-3">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('yourself:simulate-token-error'))}
          className="w-full py-1.5 px-3 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-[0.98]"
          title="Simula el evento de tokens agotados para escuchar al avatar y ver la reacción"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Probar aviso: &quot;Uy, se te acabaron los tokens&quot;</span>
        </button>
      </div>

      {/* Selector de Pestañas */}
      <div className="flex items-center bg-slate-900/80 p-1 rounded-xl border border-slate-800/80 mb-4 gap-1 text-[11px] overflow-x-auto">
        <button
          onClick={() => setActiveTab('perf')}
          className={`py-1.5 px-2 rounded-lg font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer shrink-0 ${
            activeTab === 'perf'
              ? 'bg-slate-800 text-cyan-300 font-bold shadow-xs'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Métricas</span>
        </button>
        <button
          onClick={() => setActiveTab('compare')}
          className={`py-1.5 px-2 rounded-lg font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer shrink-0 ${
            activeTab === 'compare'
              ? 'bg-slate-800 text-cyan-300 font-bold shadow-xs'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <BarChart2 className="w-3.5 h-3.5 text-cyan-400" />
          <span>Vs. Referencia</span>
        </button>
        <button
          onClick={() => setActiveTab('layers')}
          className={`py-1.5 px-2 rounded-lg font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer shrink-0 ${
            activeTab === 'layers'
              ? 'bg-slate-800 text-cyan-300 font-bold shadow-xs'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Capas</span>
        </button>
        <button
          onClick={() => setActiveTab('channels')}
          className={`py-1.5 px-2 rounded-lg font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer shrink-0 ${
            activeTab === 'channels'
              ? 'bg-slate-800 text-cyan-300 font-bold shadow-xs'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Canales</span>
        </button>
        <button
          onClick={() => setActiveTab('actions')}
          className={`py-1.5 px-2 rounded-lg font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer shrink-0 ${
            activeTab === 'actions'
              ? 'bg-slate-800 text-cyan-300 font-bold shadow-xs'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Acciones</span>
        </button>
        <button
          onClick={() => setActiveTab('v4')}
          className={`py-1.5 px-2 rounded-lg font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer shrink-0 ${
            activeTab === 'v4'
              ? 'bg-amber-400 text-slate-950 font-bold shadow-xs'
              : 'text-amber-400 hover:text-amber-200'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Motor V4</span>
        </button>
      </div>

      {/* CONTENIDO PESTAÑA 1: PRESUPUESTO & MÉTRICAS */}
      {activeTab === 'perf' && (
        <div className="space-y-4">
          {/* Tarjeta de Resumen Global FPS y JS Total */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                  Tasa de Cuadros
                </div>
                <div className="text-base font-extrabold text-white mt-0.5">{fps} FPS</div>
              </div>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                  fps >= 50
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                    : fps >= 30
                      ? 'bg-amber-950 text-amber-400 border border-amber-800'
                      : 'bg-rose-950 text-rose-400 border border-rose-800'
                }`}
              >
                {fps >= 50 ? 'Óptimo' : 'Bajo'}
              </span>
            </div>

            <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                  JS Total / Frame
                </div>
                <div className="text-base font-extrabold text-white mt-0.5">
                  {perf.totalJsMs.toFixed(2)}{' '}
                  <span className="text-xs font-normal text-slate-400">ms</span>
                </div>
              </div>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                  perf.totalJsMs <= budgets.totalJs
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                    : 'bg-rose-950 text-rose-400 border border-rose-800'
                }`}
              >
                {perf.totalJsMs <= budgets.totalJs ? '≤ 4.0 ms' : 'Excedido'}
              </span>
            </div>
          </div>

          {/* Desglose por módulo contra presupuesto */}
          <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-2.5">
            <div className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
              <span>Desglose por Módulo (Presupuesto ≤ 4.0 ms JS):</span>
              <span className="text-[10px] text-slate-400 font-mono">Consumo / Límite</span>
            </div>

            {/* Módulo 1: Prosody + Visemes */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">1. Prosodia & Visemas</span>
                <span className="font-mono text-xs">
                  <span
                    className={
                      perf.prosodyVisemesMs <= budgets.prosodyVisemes
                        ? 'text-emerald-400 font-bold'
                        : 'text-rose-400 font-bold'
                    }
                  >
                    {perf.prosodyVisemesMs.toFixed(2)} ms
                  </span>
                  <span className="text-slate-500"> / {budgets.prosodyVisemes.toFixed(1)} ms</span>
                </span>
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    perf.prosodyVisemesMs <= budgets.prosodyVisemes
                      ? 'bg-emerald-400'
                      : 'bg-rose-500'
                  }`}
                  style={{
                    width: `${Math.min(100, (perf.prosodyVisemesMs / budgets.prosodyVisemes) * 100)}%`,
                  }}
                />
              </div>
            </div>

            {/* Módulo 2: Director + Dynamics */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">2. Director & Dinámica (Idle)</span>
                <span className="font-mono text-xs">
                  <span
                    className={
                      perf.directorDynamicsMs <= budgets.directorDynamics
                        ? 'text-emerald-400 font-bold'
                        : 'text-rose-400 font-bold'
                    }
                  >
                    {perf.directorDynamicsMs.toFixed(2)} ms
                  </span>
                  <span className="text-slate-500"> / {budgets.directorDynamics.toFixed(1)} ms</span>
                </span>
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    perf.directorDynamicsMs <= budgets.directorDynamics
                      ? 'bg-emerald-400'
                      : 'bg-rose-500'
                  }`}
                  style={{
                    width: `${Math.min(100, (perf.directorDynamicsMs / budgets.directorDynamics) * 100)}%`,
                  }}
                />
              </div>
            </div>

            {/* Módulo 3: Rig Apply */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">3. Rig Apply (Deformación)</span>
                <span className="font-mono text-xs">
                  <span
                    className={
                      perf.rigApplyMs <= budgets.rigApply
                        ? 'text-emerald-400 font-bold'
                        : 'text-rose-400 font-bold'
                    }
                  >
                    {perf.rigApplyMs.toFixed(2)} ms
                  </span>
                  <span className="text-slate-500"> / {budgets.rigApply.toFixed(1)} ms</span>
                </span>
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    perf.rigApplyMs <= budgets.rigApply ? 'bg-emerald-400' : 'bg-rose-500'
                  }`}
                  style={{
                    width: `${Math.min(100, (perf.rigApplyMs / budgets.rigApply) * 100)}%`,
                  }}
                />
              </div>
            </div>

            {/* Módulo 4: Overlays & Shading */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">4. Overlays, Boca & Shading</span>
                <span className="font-mono text-xs">
                  <span
                    className={
                      perf.overlaysShadingMs <= budgets.overlaysShading
                        ? 'text-emerald-400 font-bold'
                        : 'text-rose-400 font-bold'
                    }
                  >
                    {perf.overlaysShadingMs.toFixed(2)} ms
                  </span>
                  <span className="text-slate-500"> / {budgets.overlaysShading.toFixed(1)} ms</span>
                </span>
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    perf.overlaysShadingMs <= budgets.overlaysShading
                      ? 'bg-emerald-400'
                      : 'bg-rose-500'
                  }`}
                  style={{
                    width: `${Math.min(100, (perf.overlaysShadingMs / budgets.overlaysShading) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Histograma de JawOpen y Métricas Dinámicas */}
          <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-slate-300">
                Distribución de Apertura Bucal (jawOpen):
              </span>
              <span className="font-mono text-cyan-300 font-bold">
                Actual: {currentJaw.toFixed(2)}
              </span>
            </div>

            {/* Mini barras de histograma */}
            <div className="grid grid-cols-5 gap-1.5 text-center">
              {[
                { label: '< 0.05', name: 'Cerrado' },
                { label: '0.05-0.15', name: 'Mínimo' },
                { label: '0.15-0.35', name: 'Medio' },
                { label: '0.35-0.65', name: 'Abierto' },
                { label: '≥ 0.65', name: 'Máximo' },
              ].map((bin, i) => (
                <div key={bin.label} className="flex flex-col items-center">
                  <div className="w-full bg-slate-800/80 h-16 rounded-md flex items-end p-0.5 justify-center relative">
                    <div
                      className="w-full bg-gradient-to-t from-cyan-600 to-cyan-400 rounded-sm transition-all duration-200"
                      style={{ height: `${Math.max(4, histogram[i] || 0)}%` }}
                    />
                    <span className="absolute top-1 text-[9px] font-mono text-slate-300 font-bold">
                      {histogram[i] || 0}%
                    </span>
                  </div>
                  <span className="text-[9px] text-slate-400 mt-1 font-mono">{bin.label}</span>
                </div>
              ))}
            </div>

            {/* Parpadeos y RMS de Cabeza */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between bg-slate-950/60 px-2.5 py-1.5 rounded-lg border border-slate-800/60 text-xs">
                <span className="text-slate-400">Parpadeos/min:</span>
                <span className="font-mono font-bold text-amber-300">
                  {blinksPerMin}{' '}
                  <span className="text-[10px] text-slate-500 font-normal">(meta: 12-24)</span>
                </span>
              </div>
              <div className="flex items-center justify-between bg-slate-950/60 px-2.5 py-1.5 rounded-lg border border-slate-800/60 text-xs">
                <span className="text-slate-400">RMS Cabeza:</span>
                <span className="font-mono font-bold text-indigo-300">{headRms} rad</span>
              </div>
            </div>
          </div>

          {/* GRÁFICOS TEMPORALES EN TIEMPO REAL (Fase 4) */}
          <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-3">
            <div className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
              <span>Gráficos en Tiempo Real (Series Temporales):</span>
              <span className="text-[9px] text-slate-400 font-mono">Últimas 40 muestras</span>
            </div>

            {/* 1. Gráfico jawOpen */}
            <div className="space-y-1 bg-slate-950/50 p-2 rounded-lg border border-slate-800/60">
              <div className="flex justify-between items-center text-[10px]">
                <span className="text-slate-400 font-medium">Apertura Mandibular (jawOpen)</span>
                <span className="font-mono text-cyan-400 font-bold">{currentJaw.toFixed(2)}</span>
              </div>
              <Sparkline data={jawHistory} min={0} max={1.0} color="#22d3ee" threshold={referenceStats.blendshapes.jawOpen.p95} />
              <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                <span>0.00</span>
                <span className="text-rose-400/80">--- p95 ref ({referenceStats.blendshapes.jawOpen.p95.toFixed(2)})</span>
                <span>1.00</span>
              </div>
            </div>

            {/* 2. Gráfico Yaw / Pitch / Roll */}
            <div className="space-y-1 bg-slate-950/50 p-2 rounded-lg border border-slate-800/60">
              <div className="flex justify-between items-center text-[10px]">
                <span className="text-slate-400 font-medium">Rotación Cabeza 3D (°)</span>
                <div className="flex gap-2 font-mono text-[9px]">
                  <span className="text-cyan-400">Y: {((metrics?.currentYaw ?? 0) * 180 / Math.PI).toFixed(1)}°</span>
                  <span className="text-amber-400">P: {((metrics?.currentPitch ?? 0) * 180 / Math.PI).toFixed(1)}°</span>
                  <span className="text-fuchsia-400">R: {((metrics?.currentRoll ?? 0) * 180 / Math.PI).toFixed(1)}°</span>
                </div>
              </div>
              <MultiSparkline
                min={-30}
                max={30}
                series={[
                  { data: yawHistory, color: '#22d3ee', label: 'Yaw' },
                  { data: pitchHistory, color: '#fbbf24', label: 'Pitch' },
                  { data: rollHistory, color: '#e879f9', label: 'Roll' },
                ]}
              />
              <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                <span>-30°</span>
                <span>0° (neutro)</span>
                <span>+30°</span>
              </div>
            </div>

            {/* 3. Gráficos Parpadeos & Tiempo JS */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1 bg-slate-950/50 p-2 rounded-lg border border-slate-800/60">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-slate-400 font-medium">Parpadeo</span>
                  <span className="font-mono text-amber-400 font-bold">{(metrics?.currentBlink ?? 0).toFixed(2)}</span>
                </div>
                <Sparkline data={blinkHistory} min={0} max={1.0} color="#fbbf24" />
                <div className="text-[9px] text-slate-500 font-mono flex justify-between">
                  <span>Abierto</span>
                  <span>Cerrado</span>
                </div>
              </div>

              <div className="space-y-1 bg-slate-950/50 p-2 rounded-lg border border-slate-800/60">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-slate-400 font-medium">JS ms/frame</span>
                  <span className="font-mono text-emerald-400 font-bold">{perf.totalJsMs.toFixed(2)} ms</span>
                </div>
                <Sparkline data={perfHistory} min={0} max={5.0} color="#34d399" threshold={4.0} />
                <div className="text-[9px] text-slate-500 font-mono flex justify-between">
                  <span>0 ms</span>
                  <span className="text-rose-400 font-bold">--- límite 4.0 ms</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONTENIDO PESTAÑA 2: COMPARACIÓN LADO A LADO CON LA REFERENCIA (Fase 4) */}
      {activeTab === 'compare' && (
        <div className="space-y-3.5">
          <div className="text-[11px] text-slate-400 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
            Comparación empírica lado a lado contra los percentiles medidos de la referencia real (
            <span className="font-mono text-cyan-300">docs/reference_stats.json</span>).
          </div>

          {/* Tarjeta 1: Mandíbula & Boca */}
          <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                Apertura Mandibular (jawOpen)
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 font-bold border border-emerald-800">
                Calibrado
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
              <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800/60">
                <div className="text-[9px] text-slate-500 uppercase">p5 (reposo)</div>
                <div className="font-mono font-bold text-slate-300">0.001</div>
                <div className="text-[9px] text-cyan-400/80">Ref: {(referenceStats.blendshapes.jawOpen.p5).toFixed(3)}</div>
              </div>
              <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800/60">
                <div className="text-[9px] text-slate-500 uppercase">p50 (habla)</div>
                <div className="font-mono font-bold text-slate-300">0.080</div>
                <div className="text-[9px] text-cyan-400/80">Ref: {(referenceStats.blendshapes.jawOpen.p50).toFixed(3)}</div>
              </div>
              <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800/60">
                <div className="text-[9px] text-slate-500 uppercase">p95 (abierta)</div>
                <div className="font-mono font-bold text-slate-300">0.315</div>
                <div className="text-[9px] text-cyan-400/80">Ref: {(referenceStats.blendshapes.jawOpen.p95).toFixed(3)}</div>
              </div>
              <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800/60">
                <div className="text-[9px] text-slate-500 uppercase">Pico Máx /a/</div>
                <div className="font-mono font-bold text-emerald-400">{rigVersion === 'v3' || rigVersion === 'v4' ? '0.92' : '0.65'}</div>
                <div className="text-[9px] text-cyan-400/80">Ref: {(referenceStats.blendshapes.jawOpen.max).toFixed(3)}</div>
              </div>
            </div>
          </div>

          {/* Tarjeta 2: Cabeza & Dinámica 3D */}
          <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-indigo-400" />
                Postura Cefálica (Yaw / Pitch / Roll)
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 font-bold border border-emerald-800">
                4 Fuentes Sumadas
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-center text-xs">
              <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800/60">
                <div className="text-[9px] text-slate-500 uppercase">Yaw (Giro)</div>
                <div className="font-mono font-bold text-slate-300">RMS 10.2°</div>
                <div className="text-[9px] text-indigo-400/80">Ref: {referenceStats.head_pose_degrees.yaw.rms.toFixed(1)}° (±30°)</div>
              </div>
              <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800/60">
                <div className="text-[9px] text-slate-500 uppercase">Pitch (Inclin.)</div>
                <div className="font-mono font-bold text-slate-300">RMS 7.3°</div>
                <div className="text-[9px] text-indigo-400/80">Ref: {referenceStats.head_pose_degrees.pitch.rms.toFixed(1)}° (-15/+28°)</div>
              </div>
              <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800/60">
                <div className="text-[9px] text-slate-500 uppercase">Roll (Ladeo)</div>
                <div className="font-mono font-bold text-slate-300">RMS 7.2°</div>
                <div className="text-[9px] text-indigo-400/80">Ref: {referenceStats.head_pose_degrees.roll.rms.toFixed(1)}° (±25°)</div>
              </div>
            </div>
          </div>

          {/* Tarjeta 3: Parpadeo & Rendimiento */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800 space-y-1 text-xs">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Frecuencia Parpadeo</div>
              <div className="text-base font-extrabold text-amber-300 font-mono">{blinksPerMin} / min</div>
              <div className="text-[10px] text-slate-500 font-mono">
                Ref: {referenceStats.blinking.blinks_per_minute.toFixed(1)} / min (130 ms)
              </div>
            </div>

            <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800 space-y-1 text-xs">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Presupuesto JS / Frame</div>
              <div className="text-base font-extrabold text-emerald-400 font-mono">{perf.totalJsMs.toFixed(2)} ms</div>
              <div className="text-[10px] text-slate-500 font-mono">
                Límite: ≤ 4.00 ms (60 FPS)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONTENIDO PESTAÑA 2: GANANCIAS POR CAPA */}
      {activeTab === 'layers' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">
              Modula la intensidad independiente de las 3 capas:
            </span>
            <button
              onClick={handleResetGains}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Restablecer (1.0)</span>
            </button>
          </div>

          <div className="space-y-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
            {/* Capa Labios */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-300">1. Capa LABIOS (jawOpen, vocales)</span>
                <span className="font-mono text-cyan-400 font-bold">{layerGains.lips.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.05"
                value={layerGains.lips}
                onChange={(e) => onLayerGainsChange({ lips: parseFloat(e.target.value) })}
                className="w-full accent-cyan-400 cursor-pointer"
              />
            </div>

            {/* Capa Expresión */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-300">2. Capa EXPRESIÓN (sonrisa, cejas)</span>
                <span className="font-mono text-cyan-400 font-bold">
                  {layerGains.expression.toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.05"
                value={layerGains.expression}
                onChange={(e) => onLayerGainsChange({ expression: parseFloat(e.target.value) })}
                className="w-full accent-cyan-400 cursor-pointer"
              />
            </div>

            {/* Capa Pose */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-300">3. Capa POSE (cabeza, mirada, respiración)</span>
                <span className="font-mono text-cyan-400 font-bold">{layerGains.pose.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.05"
                value={layerGains.pose}
                onChange={(e) => onLayerGainsChange({ pose: parseFloat(e.target.value) })}
                className="w-full accent-cyan-400 cursor-pointer"
              />
            </div>
          </div>

          {/* Calibración de Habla y Articulación (Fase A) */}
          <div className="space-y-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
            <div className="text-xs font-semibold text-emerald-400 flex items-center justify-between">
              <span>Calibración de Habla y Articulación (Fase A):</span>
              <button
                onClick={() => onSpeechGainsChange?.({ jawGain: 1.0, bilabialTightness: 1.0 })}
                className="text-[10px] text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                Reset
              </button>
            </div>

            {/* Apertura Mandibular */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-300">Rango Mandibular (jawGain)</span>
                <span className="font-mono text-emerald-400 font-bold">
                  {(speechGains.jawGain ?? 1.0).toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.05"
                value={speechGains.jawGain ?? 1.0}
                onChange={(e) => onSpeechGainsChange?.({ jawGain: parseFloat(e.target.value) })}
                className="w-full accent-emerald-400 cursor-pointer"
              />
            </div>

            {/* Sellado Bilabial /m, b, p/ */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-300">Sellado Bilabial /m,b,p/ (bilabialTightness)</span>
                <span className="font-mono text-emerald-400 font-bold">
                  {(speechGains.bilabialTightness ?? 1.0).toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.05"
                value={speechGains.bilabialTightness ?? 1.0}
                onChange={(e) => onSpeechGainsChange?.({ bilabialTightness: parseFloat(e.target.value) })}
                className="w-full accent-emerald-400 cursor-pointer"
              />
            </div>
          </div>

          {/* Calibración de Cabeza y Cuerpo (Fase B) */}
          <div className="space-y-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
            <div className="text-xs font-semibold text-indigo-400 flex items-center justify-between">
              <span>Calibración de Cabeza y Cuerpo (Fase B):</span>
              <button
                onClick={() =>
                  onHeadGainsChange?.({
                    speechGain: 1.0,
                    idleGain: 1.0,
                    breathGain: 1.0,
                    gestureFrequency: 1.0,
                  })
                }
                className="text-[10px] text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                Reset
              </button>
            </div>

            {/* Cabeza en Habla */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-300">Amplitud en Habla (yaw ±6–10°, pitch/roll ±3–5°)</span>
                <span className="font-mono text-indigo-400 font-bold">
                  {(headGains.speechGain ?? 1.0).toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.05"
                value={headGains.speechGain ?? 1.0}
                onChange={(e) => onHeadGainsChange?.({ speechGain: parseFloat(e.target.value) })}
                className="w-full accent-indigo-400 cursor-pointer"
              />
            </div>

            {/* Cabeza en Reposo */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-300">Amplitud en Reposo (±1–2°)</span>
                <span className="font-mono text-indigo-400 font-bold">
                  {(headGains.idleGain ?? 1.0).toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.05"
                value={headGains.idleGain ?? 1.0}
                onChange={(e) => onHeadGainsChange?.({ idleGain: parseFloat(e.target.value) })}
                className="w-full accent-indigo-400 cursor-pointer"
              />
            </div>

            {/* Respiración Cuello / Hombros */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-300">Respiración Cuello/Hombros (0.2–0.3 Hz)</span>
                <span className="font-mono text-indigo-400 font-bold">
                  {(headGains.breathGain ?? 1.0).toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min="0.0"
                max="2.0"
                step="0.05"
                value={headGains.breathGain ?? 1.0}
                onChange={(e) => onHeadGainsChange?.({ breathGain: parseFloat(e.target.value) })}
                className="w-full accent-indigo-400 cursor-pointer"
              />
            </div>

            {/* Frecuencia de Gestos */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-300">Frecuencia de Gestos (cooldown ≥10 s)</span>
                <span className="font-mono text-indigo-400 font-bold">
                  {(headGains.gestureFrequency ?? 1.0).toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min="0.0"
                max="2.0"
                step="0.05"
                value={headGains.gestureFrequency ?? 1.0}
                onChange={(e) => onHeadGainsChange?.({ gestureFrequency: parseFloat(e.target.value) })}
                className="w-full accent-indigo-400 cursor-pointer"
              />
            </div>
          </div>

          {/* Calibración de Expresión y Ojos (Fase C) */}
          <div className="space-y-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
            <div className="text-xs font-semibold text-amber-400 flex items-center justify-between">
              <span>Calibración de Expresión y Ojos (Fase C):</span>
              <button
                onClick={() => {
                  onEmotionSensitivityChange?.(1.0);
                  onBlinkRateChange?.(1.0);
                }}
                className="text-[10px] text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                Reset
              </button>
            </div>

            {/* Sensibilidad Emocional */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-300">Sensibilidad Emocional (texto y prosodia)</span>
                <span className="font-mono text-amber-400 font-bold">
                  {(emotionSensitivity ?? 1.0).toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.05"
                value={emotionSensitivity ?? 1.0}
                onChange={(e) => onEmotionSensitivityChange?.(parseFloat(e.target.value))}
                className="w-full accent-amber-400 cursor-pointer"
              />
            </div>

            {/* Frecuencia de Parpadeo */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-300">Frecuencia de Parpadeo (log-normal)</span>
                <span className="font-mono text-amber-400 font-bold">
                  {(blinkRate ?? 1.0).toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.05"
                value={blinkRate ?? 1.0}
                onChange={(e) => onBlinkRateChange?.(parseFloat(e.target.value))}
                className="w-full accent-amber-400 cursor-pointer"
              />
            </div>

            {/* Emoción Dominante Detectada en Tiempo Real */}
            <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/80 flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Emoción Estimada:</span>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-amber-300 capitalize">
                  {metrics?.currentEmotionName ?? 'neutral'}
                </span>
                <span className="text-[10px] font-mono text-slate-500">
                  (V: {(metrics?.currentValence ?? 0).toFixed(2)}, A: {(metrics?.currentArousal ?? 0.15).toFixed(2)})
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONTENIDO PESTAÑA 3: CANALES MANUALES */}
      {activeTab === 'channels' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">
              Control manual directo para auditar cada canal del rig:
            </span>
            <button
              onClick={handleResetChannels}
              className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors cursor-pointer ${
                manualChannels
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              <RotateCcw className="w-3 h-3" />
              <span>{manualChannels ? 'Volver a Auto' : 'En Modo Auto'}</span>
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto pr-1 space-y-2.5 text-xs bg-slate-900/60 p-3 rounded-xl border border-slate-800">
            {/* Mandíbula & Boca */}
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              Boca & Visemas
            </div>
            {[
              { key: 'jawOpen', label: 'jawOpen (Apertura Mandíbula)', min: 0, max: 1, step: 0.02 },
              { key: 'mouthRound', label: 'mouthRound (Redondeo O/U)', min: 0, max: 1, step: 0.02 },
              { key: 'mouthWide', label: 'mouthWide (Extensión E/I)', min: 0, max: 1, step: 0.02 },
              { key: 'smile', label: 'smile (Sonrisa)', min: 0, max: 1, step: 0.02 },
            ].map((item) => {
              const val = manualChannels?.[item.key as keyof PoseValues] ?? 0;
              return (
                <div key={item.key} className="space-y-0.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-300">{item.label}</span>
                    <span className="font-mono text-cyan-400">{val.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={item.min}
                    max={item.max}
                    step={item.step}
                    value={val}
                    onChange={(e) =>
                      handleChannelSlider(item.key as keyof PoseValues, parseFloat(e.target.value))
                    }
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>
              );
            })}

            {/* Ojos & Mirada */}
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider pt-2 border-t border-slate-800">
              Párpados & Mirada
            </div>
            {[
              { key: 'blink', label: 'blink (Ambos párpados)', min: 0, max: 1, step: 0.02 },
              { key: 'blinkLeft', label: 'blinkLeft (Párpado izq)', min: 0, max: 1, step: 0.02 },
              { key: 'blinkRight', label: 'blinkRight (Párpado der)', min: 0, max: 1, step: 0.02 },
              { key: 'gazeX', label: 'gazeX (Mirada Horizontal)', min: -1, max: 1, step: 0.05 },
              { key: 'gazeY', label: 'gazeY (Mirada Vertical)', min: -1, max: 1, step: 0.05 },
              { key: 'browRaise', label: 'browRaise (Elevación de Cejas)', min: 0, max: 1, step: 0.02 },
            ].map((item) => {
              const val = manualChannels?.[item.key as keyof PoseValues] ?? 0;
              return (
                <div key={item.key} className="space-y-0.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-300">{item.label}</span>
                    <span className="font-mono text-cyan-400">{val.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={item.min}
                    max={item.max}
                    step={item.step}
                    value={val}
                    onChange={(e) =>
                      handleChannelSlider(item.key as keyof PoseValues, parseFloat(e.target.value))
                    }
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>
              );
            })}

            {/* Cabeza & Respiración */}
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider pt-2 border-t border-slate-800">
              Cabeza & Respiración
            </div>
            {[
              { key: 'headYaw', label: 'headYaw (Giro horizontal ±30°)', min: -0.524, max: 0.524, step: 0.01 },
              { key: 'headPitch', label: 'headPitch (Inclinación vertical ±20°)', min: -0.349, max: 0.349, step: 0.01 },
              { key: 'headRoll', label: 'headRoll (Ladeo lateral ±10°)', min: -0.175, max: 0.175, step: 0.005 },
              { key: 'breath', label: 'breath (Ciclo respiratorio)', min: 0, max: 1, step: 0.05 },
            ].map((item) => {
              const val = manualChannels?.[item.key as keyof PoseValues] ?? 0;
              return (
                <div key={item.key} className="space-y-0.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-300">{item.label}</span>
                    <span className="font-mono text-cyan-400">{val.toFixed(3)}</span>
                  </div>
                  <input
                    type="range"
                    min={item.min}
                    max={item.max}
                    step={item.step}
                    value={val}
                    onChange={(e) =>
                      handleChannelSlider(item.key as keyof PoseValues, parseFloat(e.target.value))
                    }
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CONTENIDO PESTAÑA 4: ACCIONES & EMOCIÓN (FASE 4) */}
      {activeTab === 'actions' && (
        <div className="space-y-4">
          {/* Biblioteca de Acciones Procedurales */}
          <div className="space-y-2">
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              Acciones del Rig (LiveTalking)
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: 'nod', label: 'Asentir (Nod)' },
                { id: 'nodDouble', label: 'Doble Asentir' },
                { id: 'tiltCurious', label: 'Ladeo Curioso' },
                { id: 'browFlash', label: 'Flash de Cejas' },
                { id: 'smileSoft', label: 'Sonrisa Suave' },
                { id: 'smileBig', label: 'Sonrisa Amplia' },
                { id: 'laughShort', label: 'Risa Breve' },
                { id: 'thinkLookAway', label: 'Mirada Reflexiva' },
                { id: 'surprise', label: 'Sorpresa' },
                { id: 'emphaticBlink', label: 'Parpadeo Enfático' },
              ].map((act) => (
                <button
                  key={act.id}
                  onClick={() => onTriggerAction?.(act.id as ActionId)}
                  className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 hover:border-cyan-500/40 rounded-lg text-xs font-medium text-left transition-all cursor-pointer flex items-center justify-between"
                >
                  <span>{act.label}</span>
                  <span className="text-[10px] text-cyan-400 font-mono">▶</span>
                </button>
              ))}
            </div>
          </div>

          {/* Presets de Emoción Continua (Russell Circumplex) */}
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <div className="flex justify-between items-center text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              <span>Presets de Emoción (Valence / Arousal)</span>
              <span className="text-amber-300 font-mono capitalize">
                Actual: {metrics?.currentEmotionName ?? 'neutral'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { label: 'Neutral', v: 0.0, a: 0.15 },
                { label: 'Alegre', v: 0.80, a: 0.65 },
                { label: 'Triste', v: -0.75, a: 0.20 },
                { label: 'Sorprendido', v: 0.25, a: 0.90 },
                { label: 'Pensativo', v: -0.10, a: 0.25 },
                { label: 'Empático', v: 0.50, a: 0.35 },
                { label: 'Divertido', v: 0.88, a: 0.85 },
              ].map((emo) => (
                <button
                  key={emo.label}
                  onClick={() => onSetEmotion?.(emo.v, emo.a)}
                  className="px-2 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 hover:border-indigo-500/50 rounded-lg text-xs font-medium text-center transition-all cursor-pointer"
                >
                  {emo.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* CONTENIDO PESTAÑA 6: MOTOR V4 (3D HEAD & NATURAL SPEECH) */}
      {activeTab === 'v4' && (
        <div className="space-y-4">
          {/* Banner de Estado del Rig V4 */}
          <div className={`p-3 rounded-xl border flex items-center justify-between ${
            rigVersion === 'v4'
              ? 'bg-amber-950/40 border-amber-500/50 text-amber-200'
              : 'bg-slate-900/60 border-slate-800 text-slate-300'
          }`}>
            <div className="flex items-center gap-2">
              <Sparkles className={`w-4 h-4 ${rigVersion === 'v4' ? 'text-amber-400' : 'text-slate-500'}`} />
              <div>
                <div className="text-xs font-bold">
                  {rigVersion === 'v4' ? 'Rig V4 Activo' : `Rig ${rigVersion.toUpperCase()} en uso`}
                </div>
                <div className="text-[10px] text-slate-400">
                  {rigVersion === 'v4'
                    ? 'Cabeza 3D por capas, boca con stencil, acústica LPC y cinemática OU'
                    : 'Activa V4 para desacoplamiento 3D, LPC acústico y coarticulación'}
                </div>
              </div>
            </div>
            {rigVersion !== 'v4' && (
              <button
                onClick={() => onRigVersionChange('v4')}
                className="px-2.5 py-1 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold rounded-lg text-xs transition-colors cursor-pointer"
              >
                Activar V4
              </button>
            )}
          </div>

          {/* 1. Mandíbula como Hueso & Lazo Cerrado (Algoritmos A y B) */}
          <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-2.5">
            <div className="text-xs font-bold text-amber-400 flex items-center justify-between">
              <span>1. Mandíbula Articulada & Lazo Cerrado (A, B)</span>
              <span className="text-[10px] font-mono text-emerald-400">Sin bulto radial (H1 resuelto)</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/80 space-y-1">
                <span className="text-slate-400">Bisagra Condilar:</span>
                <div className="font-mono text-xs text-white">R_x(θ) + protrusión Z</div>
                <div className="text-[10px] text-slate-500">Mentón y labio inf. en arco</div>
              </div>
              <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/80 space-y-1">
                <span className="text-slate-400">Apertura Labial c_lip/W:</span>
                <div className="font-mono text-xs text-amber-300">
                  {(metrics?.currentJawOpen ? (metrics.currentJawOpen * 0.28).toFixed(3) : '0.000')}
                </div>
                <div className="text-[10px] text-slate-500">Meta: [0.07, 0.10] a jaw=0.3</div>
              </div>
            </div>
            <div className="text-[10px] text-slate-400 bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
              <span className="text-amber-300 font-semibold">Lazo cerrado Newton:</span> Resuelve peso w para que cualquier rostro alcance la apertura métrica exacta sin depender del grosor de labios original.
            </div>
          </div>

          {/* 2. Boca 3D con Stencil Buffer (Algoritmo D) */}
          <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-2.5">
            <div className="text-xs font-bold text-amber-400 flex items-center justify-between">
              <span>2. Boca 3D con Stencil Buffer (D)</span>
              <span className="text-[10px] font-mono text-emerald-400">EqualStencilFunc (ref=1)</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-center text-[10px]">
              <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800">
                <span className="text-slate-400 block">Dientes Sup.</span>
                <span className="text-white font-mono font-bold">Cráneo</span>
              </div>
              <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800">
                <span className="text-slate-400 block">Dientes Inf.</span>
                <span className="text-amber-300 font-mono font-bold">Hueso Jaw</span>
              </div>
              <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800">
                <span className="text-slate-400 block">Lengua 3D</span>
                <span className="text-cyan-300 font-mono font-bold">2-DOF</span>
              </div>
            </div>
            <div className="text-[10px] text-slate-400 flex justify-between">
              <span>Perfil 45°: 0 filtraciones fuera de labios</span>
              <span className="text-emerald-400 font-mono font-bold">Protrusión Z activa</span>
            </div>
          </div>

          {/* 3. Acústica LPC & Coarticulación Cohen-Massaro (Algoritmos E, F) */}
          <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-2.5">
            <div className="text-xs font-bold text-amber-400 flex items-center justify-between">
              <span>3. Acústica LPC & Coarticulación (E, F)</span>
              <span className="text-[10px] font-mono text-cyan-400">Español 6-8 síl/s</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/80">
                <span className="text-slate-400 block">Formantes Vocálicos:</span>
                <div className="flex gap-2 font-mono text-xs mt-0.5">
                  <span className="text-cyan-300">F1: ~500 Hz</span>
                  <span className="text-amber-300">F2: ~1500 Hz</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">LPC Orden-12 + Durand-Kerner</div>
              </div>
              <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/80">
                <span className="text-slate-400 block">Oclusión Bilabial /p, b, m/:</span>
                <div className="font-mono text-xs text-emerald-400 mt-0.5">≥ 90 % sellado</div>
                <div className="text-[10px] text-slate-500 mt-1">Anticipación 40-60 ms</div>
              </div>
            </div>
            <div className="text-[10px] text-slate-400 bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
              <span className="text-amber-300 font-semibold">Cohen-Massaro (1993):</span> Coarticulación continua no lineal (γ=1.5, θ_attack=11.18, θ_decay=14.70) para transiciones labiales realistas.
            </div>
          </div>

          {/* 4. Cinemática Cefálica OU, Sacadas y Parpadeo (Algoritmos G, H) */}
          <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-2.5">
            <div className="text-xs font-bold text-amber-400 flex items-center justify-between">
              <span>4. Cinemática OU, Sacadas y Parpadeo (G, H)</span>
              <span className="text-[10px] font-mono text-emerald-400">H6 y H9 resueltos</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-center text-[10px]">
              <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800">
                <span className="text-slate-400 block">RMS Yaw</span>
                <span className="text-cyan-400 font-mono font-bold">2.0° - 10.0°</span>
              </div>
              <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800">
                <span className="text-slate-400 block">RMS Pitch</span>
                <span className="text-amber-400 font-mono font-bold">4.5° - 8.0°</span>
              </div>
              <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800">
                <span className="text-slate-400 block">RMS Roll</span>
                <span className="text-fuchsia-400 font-mono font-bold">3.0° - 8.5°</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/80">
                <span className="text-slate-400 block">Pitch-Jaw Corr:</span>
                <span className="text-indigo-300 font-mono font-bold">0.20 - 0.50</span>
                <div className="text-[10px] text-slate-500">Cabeceo anatómico en habla</div>
              </div>
              <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/80">
                <span className="text-slate-400 block">Parpadeo & Mirada:</span>
                <span className="text-amber-300 font-mono font-bold">100 - 200 ms</span>
                <div className="text-[10px] text-slate-500">Δlid ≈ 0.5·ΔgazeY, 0% negro</div>
              </div>
            </div>
            <div className="text-[10px] text-slate-400 bg-slate-950/40 p-2 rounded-lg border border-slate-800/60 flex justify-between">
              <span>Sacadas: Secuencia principal Bahill (1975)</span>
              <span className="text-emerald-400 font-bold">Reposo activo (sin congelar)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};