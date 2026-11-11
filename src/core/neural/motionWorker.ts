/**
 * motionWorker.ts
 *
 * Web Worker de Inferencia Acústica Heurística (Audio2Motion Heurístico):
 * NOTA DE ARQUITECTURA (v4 / Hallazgo H5):
 * Este componente implementa una aproximación heurística basada en energía RMS y tasa de cruces por cero (ZCR),
 * no una red neuronal profunda real (ONNX). Satisface el contrato de buffers de `modelContracts.ts`
 * para alimentar jawOpen, mouthStretch y cabeceo prosódico con latencia nula y bajo coste de CPU (< 3.5 ms).
 * Permanece como fallback acústico ultraligero hasta la incorporación de un modelo ONNX entrenado.
 */

import { AUDIO2MOTION_CONTRACT, ModelContractGuard } from './modelContracts';

export interface WorkerInferenceRequest {
  type: 'process_audio';
  audioBuffer: Float32Array;
  sampleRate: number;
  timestamp: number;
}

export interface WorkerInferenceResponse {
  type: 'motion_packet';
  blendshapes: Float32Array;
  headPose: Float32Array;
  timestamp: number;
}

export class MotionWorkerProcessor {
  private readonly blendshapes = new Float32Array(52);
  private readonly headPose = new Float32Array(6);

  /**
   * Procesa un fragmento de audio y sintetiza los coeficientes de movimiento a 30 Hz
   */
  public processAudioChunk(
    audioChunk: Float32Array,
    sampleRate = 24000,
    timestamp = 0
  ): { blendshapes: Float32Array; headPose: Float32Array; timestamp: number } {
    // 1. Cálculo de energía RMS y cruces por cero (Zero-Crossing Rate)
    let sumSquares = 0;
    let zeroCrossings = 0;
    const len = audioChunk.length;

    for (let i = 0; i < len; i++) {
      const s = audioChunk[i]!;
      sumSquares += s * s;
      if (i > 0 && ((audioChunk[i - 1]! >= 0 && s < 0) || (audioChunk[i - 1]! < 0 && s >= 0))) {
        zeroCrossings++;
      }
    }

    const rms = Math.sqrt(sumSquares / Math.max(1, len));
    const zcr = zeroCrossings / Math.max(1, len);

    // 2. Mapeo a apertura mandibular (jawOpen: blendshape 0)
    // Histéresis suave con saturación tangencial hiperbólica
    const jawOpen = Math.min(1.0, Math.tanh(Math.max(0, rms - 0.015) * 8.5));
    this.blendshapes[0] = jawOpen;

    // 3. Fricativas / sibilantes (ZCR alto): comprimir apertura y ensanchar comisuras (mouthStretch)
    if (zcr > 0.18 && rms > 0.02) {
      this.blendshapes[0] = Math.min(0.20, jawOpen); // Dientes juntos
      this.blendshapes[7] = 0.35; // mouthStretchLeft
      this.blendshapes[8] = 0.35; // mouthStretchRight
    } else {
      this.blendshapes[7] = 0;
      this.blendshapes[8] = 0;
    }

    // 4. Cabeceo prosódico acoplado a picos de energía de audio (Head nod)
    if (rms > 0.08) {
      this.headPose[1] = Math.min(0.06, rms * 0.4); // pitch hacia abajo
    } else {
      this.headPose[1] *= 0.85; // decaimiento suave
    }

    // Validar contrato
    ModelContractGuard.validateBuffer(this.blendshapes, AUDIO2MOTION_CONTRACT.outputBlendshapes);

    return {
      blendshapes: this.blendshapes,
      headPose: this.headPose,
      timestamp,
    };
  }
}

// Configuración opcional para ejecución como Web Worker nativo en entornos de navegador
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  const processor = new MotionWorkerProcessor();

  self.onmessage = (e: MessageEvent<WorkerInferenceRequest>) => {
    if (e.data.type === 'process_audio') {
      const res = processor.processAudioChunk(e.data.audioBuffer, e.data.sampleRate, e.data.timestamp);
      // Transferencia rápida sin copia (transferable objects)
      self.postMessage(
        {
          type: 'motion_packet',
          blendshapes: res.blendshapes,
          headPose: res.headPose,
          timestamp: res.timestamp,
        },
        [res.blendshapes.buffer, res.headPose.buffer] as unknown as StructuredSerializeOptions
      );
    }
  };
}
