/**
 * coarticulation.ts
 *
 * Modelo de Coarticulación Articulada de Cohen–Massaro (1993) (YourSelf v4 - Algoritmo F):
 * - Los fonemas no se tocan como fichas de dominó: cada gesto vocal influye en sus vecinos.
 * - Función de dominancia asimétrica:
 *     D_{s,c}(t) = alpha_{s,c} * exp(-theta_{s,c} * |t - t_s|^gamma)
 *     con gamma = 1.5, tau_ataque = 200 ms (theta = 5.0), tau_caída = 167 ms (theta = 6.0)
 * - Valor combinado ponderado:
 *     F_c(t) = sum_s(D_{s,c}(t) * T_{s,c}) / sum_s(D_{s,c}(t))
 * - Búfer deslizante de lookahead (100 ms) para anticipación de cierres bilabiales (/p, b, m/) 40-60 ms antes de la explosión acústica.
 * - Cero recolección de basura (preasignación de resultados).
 */

export interface PhonemeTarget {
  name: string;
  time: number; // t_s (centro temporal del fonema en segundos)
  duration: number;
  targets: Record<string, number>;
  alphas?: Record<string, number>;
}

export class CohenMassaroCoarticulator {
  private phonemeBuffer: PhonemeTarget[] = [];
  private readonly gamma = 1.5;
  private readonly thetaAttack = Math.pow(1.0 / 0.200, 1.5); // (1/0.200)^1.5 ≈ 11.18 s^-1.5
  private readonly thetaDecay = Math.pow(1.0 / 0.167, 1.5);  // (1/0.167)^1.5 ≈ 14.70 s^-1.5

  private cachedResult: Record<string, number> = {
    jawOpen: 0,
    mouthClose: 0,
    mouthPressLips: 0,
    lowerLipTuck: 0,
    mouthWide: 0,
    mouthRound: 0,
    mouthFunnel: 0,
    mouthPucker: 0,
    tongueElevation: 0,
    tongueProtrusion: 0,
  };

  /**
   * Encola un nuevo fonema en el búfer de coarticulación
   */
  public enqueuePhoneme(phoneme: PhonemeTarget): void {
    this.phonemeBuffer.push(phoneme);

    // Mantener tamaño razonable de búfer podando fonemas con más de 600 ms de antigüedad
    if (this.phonemeBuffer.length > 24) {
      this.phonemeBuffer.splice(0, this.phonemeBuffer.length - 16);
    }
  }

  /**
   * Evalúa la mezcla de Cohen–Massaro para todos los canales articulatorios en el instante `time`
   */
  public evaluate(time: number, channels: string[]): Record<string, number> {
    // Podar fonemas viejos que ya no influyen (más de 400 ms en el pasado)
    while (this.phonemeBuffer.length > 0 && time - this.phonemeBuffer[0]!.time > 0.45) {
      this.phonemeBuffer.shift();
    }

    if (this.phonemeBuffer.length === 0) {
      for (const ch of channels) {
        this.cachedResult[ch] = 0;
      }
      return this.cachedResult;
    }

    for (const ch of channels) {
      let sumDT = 0;
      let sumD = 0;

      for (let i = 0; i < this.phonemeBuffer.length; i++) {
        const p = this.phonemeBuffer[i]!;
        const dt = time - p.time;

        // Fuera de la ventana de influencia articulatoria (+-350 ms)
        if (Math.abs(dt) > 0.35) continue;

        const theta = dt < 0 ? this.thetaAttack : this.thetaDecay;
        const alpha = p.alphas?.[ch] ?? (p.name === 'MBP' && (ch === 'mouthClose' || ch === 'jawOpen' || ch === 'mouthPressLips') ? 14.0 : 1.0);

        const dist = Math.abs(dt);
        const D = alpha * Math.exp(-theta * Math.pow(dist, this.gamma));
        const T = p.targets[ch] ?? 0;

        sumDT += D * T;
        sumD += D;
      }

      this.cachedResult[ch] = sumD > 1e-5 ? sumDT / sumD : 0;
    }

    // Regla estricta de consistencia física para oclusivas bilabiales:
    // Si mouthClose > 0.85, la mandíbula debe estar completamente cerrada (jawOpen = 0)
    if ((this.cachedResult['mouthClose'] ?? 0) > 0.85) {
      this.cachedResult['jawOpen'] = 0;
    }

    return this.cachedResult;
  }

  public flush(): void {
    this.phonemeBuffer.length = 0;
  }

  public getBufferLength(): number {
    return this.phonemeBuffer.length;
  }
}
