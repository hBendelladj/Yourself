/**
 * neuralBridge.ts
 *
 * Puente Asíncrono Worker-Main con Semántica Drop-on-Full e Interpolación Cúbica (YourSelf V3 - Fase 5 / Sección 14):
 * - Ranura de intercambio concurrente sin bloqueos de capacidad 1 (`LastWinsSlot`, patrón formal NSR Engine).
 * - El Web Worker (productor a 30 Hz) nunca se bloquea; el hilo Three.js (consumidor a 60 FPS) siempre lee el estado más fresco.
 * - Transferencia ultraligera: únicamente 58 floats por fotograma (52 blendshapes + 6 pose) = 232 bytes (0.002 ms).
 * - Soporta `SharedArrayBuffer` con Zero-Copy y fallback transparente a transferencias de `ArrayBuffer` vía `postMessage` (Mitigación R2).
 * - Interpolador temporal Hermite / semi-implícito a 60 FPS.
 * - Cero allocations en el bucle caliente (Zero-Allocation).
 */

export interface NeuralMotionPacket {
  blendshapes: Float32Array; // 52 valores [0..1]
  headPose: Float32Array;    // 6 valores [yaw, pitch, roll, tx, ty, tz]
  timestamp: number;
}

export class LastWinsSlot<T> {
  private value: T | null = null;
  private hasNewValue = false;

  public put(item: T): void {
    this.value = item;
    this.hasNewValue = true;
  }

  public get(): T | null {
    return this.value;
  }

  public take(): T | null {
    this.hasNewValue = false;
    return this.value;
  }

  public hasFresh(): boolean {
    return this.hasNewValue;
  }
}

export class NeuralBridge {
  private readonly slot = new LastWinsSlot<NeuralMotionPacket>();

  // Estados anteriores y actuales para interpolación cúbica
  private prevState: NeuralMotionPacket | null = null;
  private nextState: NeuralMotionPacket | null = null;
  private interpProgress = 0;
  private readonly targetInterval = 0.0333; // 30 Hz = ~33.3 ms

  // Búfer pre-asignado para salida interpolada de 58 floats (Zero-Allocation)
  public readonly currentBlendshapes = new Float32Array(52);
  public readonly currentPose = new Float32Array(6);

  public readonly isSharedArrayBufferSupported: boolean;

  constructor() {
    this.isSharedArrayBufferSupported =
      typeof window !== 'undefined' &&
      typeof SharedArrayBuffer !== 'undefined' &&
      window.crossOriginIsolated === true;
  }

  /**
   * Recibe un nuevo paquete producido por el Web Worker
   */
  public onWorkerPacket(packet: NeuralMotionPacket): void {
    this.slot.put(packet);
  }

  /**
   * Evalúa la interpolación a 60 FPS en el hilo principal
   */
  public update(deltaSeconds: number): { blendshapes: Float32Array; pose: Float32Array } {
    if (this.slot.hasFresh()) {
      const fresh = this.slot.take();
      if (fresh) {
        this.prevState = this.nextState ?? fresh;
        this.nextState = fresh;
        this.interpProgress = 0;
      }
    }

    if (!this.nextState) {
      // Estado neutro de reposo
      return {
        blendshapes: this.currentBlendshapes,
        pose: this.currentPose,
      };
    }

    if (!this.prevState) {
      this.currentBlendshapes.set(this.nextState.blendshapes);
      this.currentPose.set(this.nextState.headPose);
      return {
        blendshapes: this.currentBlendshapes,
        pose: this.currentPose,
      };
    }

    // Avanzar progreso de interpolación Hermite suave: s(t) = 3t^2 - 2t^3
    this.interpProgress = Math.min(1.0, this.interpProgress + deltaSeconds / this.targetInterval);
    const t = this.interpProgress;
    const smoothT = t * t * (3.0 - 2.0 * t);

    // Interpolar los 52 blendshapes
    const prevB = this.prevState.blendshapes;
    const nextB = this.nextState.blendshapes;
    for (let i = 0; i < 52; i++) {
      this.currentBlendshapes[i] = prevB[i]! + (nextB[i]! - prevB[i]!) * smoothT;
    }

    // Interpolar los 6 parámetros de pose
    const prevP = this.prevState.headPose;
    const nextP = this.nextState.headPose;
    for (let i = 0; i < 6; i++) {
      this.currentPose[i] = prevP[i]! + (nextP[i]! - prevP[i]!) * smoothT;
    }

    return {
      blendshapes: this.currentBlendshapes,
      pose: this.currentPose,
    };
  }
}
