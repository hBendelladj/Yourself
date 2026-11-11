/**
 * modelContracts.ts
 *
 * Contratos Formales y Validación Estricta de Tensores ONNX (YourSelf V3 - Fase 5 / Sección 14 & 18.5):
 * - Inspirado en el patrón de contratos de tensores de NSR Engine (`contract/guard.py`).
 * - Valida en tiempo de carga e inferencia que las dimensiones, tipos de datos y rangos numéricos
 *   coincidan exactamente con la especificación para prevenir fallos silenciosos o conversiones costosas en runtime.
 * - Contrato Audio2Motion: Entrada (audio_pcm) -> Salida (52 ARKit blendshapes + 6 DoF pose).
 */

export interface TensorContractSpec {
  name: string;
  expectedShape: number[]; // e.g. [1, 52] o [-1, 80]
  dataType: 'float32' | 'int8' | 'int16';
  minValue?: number;
  maxValue?: number;
}

export const AUDIO2MOTION_CONTRACT = {
  inputAudio: {
    name: 'audio_chunk',
    expectedShape: [1, 800], // 33 ms a 24 kHz mono (~800 muestras)
    dataType: 'float32',
    minValue: -1.0,
    maxValue: 1.0,
  } as TensorContractSpec,

  outputBlendshapes: {
    name: 'arkit_blendshapes',
    expectedShape: [1, 52],
    dataType: 'float32',
    minValue: 0.0,
    maxValue: 1.0,
  } as TensorContractSpec,

  outputHeadPose: {
    name: 'head_pose_6dof',
    expectedShape: [1, 6], // [yaw, pitch, roll, tx, ty, tz]
    dataType: 'float32',
  } as TensorContractSpec,
} as const;

export class ModelContractGuard {
  /**
   * Valida un búfer Float32Array contra una especificación de contrato
   */
  public static validateBuffer(
    buffer: Float32Array,
    spec: TensorContractSpec
  ): { isValid: boolean; error?: string } {
    // 1. Validar longitud total esperada
    const expectedLength = spec.expectedShape.reduce((acc, dim) => (dim > 0 ? acc * dim : acc), 1);
    if (buffer.length !== expectedLength) {
      return {
        isValid: false,
        error: `Violación de dimensión para '${spec.name}': se esperaban ${expectedLength} elementos, se recibieron ${buffer.length}`,
      };
    }

    // 2. Validar que no contenga valores NaN o Infinitos
    for (let i = 0; i < buffer.length; i++) {
      const v = buffer[i]!;
      if (!Number.isFinite(v)) {
        return {
          isValid: false,
          error: `Violación de rango para '${spec.name}': elemento en índice ${i} es NaN o Infinito`,
        };
      }
    }

    // 3. Validar límites de rango si están especificados
    if (spec.minValue !== undefined || spec.maxValue !== undefined) {
      const min = spec.minValue ?? -Infinity;
      const max = spec.maxValue ?? Infinity;

      for (let i = 0; i < buffer.length; i++) {
        const v = buffer[i]!;
        if (v < min - 1e-4 || v > max + 1e-4) {
          return {
            isValid: false,
            error: `Violación de límites para '${spec.name}': valor ${v} en índice ${i} fuera del rango [${min}, ${max}]`,
          };
        }
      }
    }

    return { isValid: true };
  }
}
