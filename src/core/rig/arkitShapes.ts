/**
 * arkitShapes.ts
 *
 * Catálogo Universal de los 52 Blendshapes ARKit (YourSelf V3 - Fase 4 / Sección 12.2):
 * - Estándar universal de animación facial compatible con Three.js, MediaPipe FaceLandmarker y motores 3D.
 * - Desglosado anatómicamente en 5 grupos musculares FACS:
 *   1. Mandíbula (7 formas)
 *   2. Boca y Labios (24 formas)
 *   3. Ojos y Párpados (12 formas)
 *   4. Cejas (5 formas)
 *   5. Mejillas y Nariz (4 formas)
 */

export const ARKIT_SHAPE_NAMES = [
  // Mandíbula (7)
  'jawOpen',
  'jawForward',
  'jawLeft',
  'jawRight',
  'mouthClose',
  'jawOpenExtended',
  'jawPivot',

  // Boca y Labios (24)
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthDimpleLeft',
  'mouthDimpleRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthRollLower',
  'mouthRollUpper',
  'mouthShrugLower',
  'mouthShrugUpper',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'mouthPucker',
  'mouthFunnel',
  'mouthLeft',
  'mouthRight',
  'mouthLipsTogether',
  'mouthTighten',

  // Ojos y Párpados (12)
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'eyeLookUpLeft',
  'eyeLookUpRight',
  'eyeLookDownLeft',
  'eyeLookDownRight',
  'eyeLookInLeft',
  'eyeLookInRight',
  'eyeLookOutLeft',
  'eyeLookOutRight',
  'eyeSquintLeft',
  'eyeSquintRight',

  // Cejas (5)
  'browDownLeft',
  'browDownRight',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',

  // Mejillas y Nariz (4)
  'cheekPuff',
  'cheekSquintLeft',
  'cheekSquintRight',
  'noseSneerLeft',
] as const;

export type ARKitShapeName = (typeof ARKIT_SHAPE_NAMES)[number];

export interface ARKitShapeMetadata {
  name: ARKitShapeName;
  category: 'jaw' | 'mouth' | 'eyes' | 'brows' | 'cheek_nose';
  facsAU?: string;
  description: string;
}

export const ARKIT_SHAPES_METADATA: Record<ARKitShapeName, ARKitShapeMetadata> = {
  jawOpen: { name: 'jawOpen', category: 'jaw', facsAU: 'AU26/27', description: 'Apertura mandibular temporomandibular' },
  jawForward: { name: 'jawForward', category: 'jaw', facsAU: 'AU29', description: 'Protrusión anterior de mandíbula' },
  jawLeft: { name: 'jawLeft', category: 'jaw', facsAU: 'AU30L', description: 'Desviación mandibular lateral izquierda' },
  jawRight: { name: 'jawRight', category: 'jaw', facsAU: 'AU30R', description: 'Desviación mandibular lateral derecha' },
  mouthClose: { name: 'mouthClose', category: 'jaw', facsAU: 'AU24', description: 'Sellado interlabial activo' },
  jawOpenExtended: { name: 'jawOpenExtended', category: 'jaw', facsAU: 'AU27', description: 'Apertura extrema' },
  jawPivot: { name: 'jawPivot', category: 'jaw', description: 'Rotación cóndilo-mandibular' },

  mouthSmileLeft: { name: 'mouthSmileLeft', category: 'mouth', facsAU: 'AU12L', description: 'Elevación de comisura izquierda (Zygomaticus major)' },
  mouthSmileRight: { name: 'mouthSmileRight', category: 'mouth', facsAU: 'AU12R', description: 'Elevación de comisura derecha (Zygomaticus major)' },
  mouthFrownLeft: { name: 'mouthFrownLeft', category: 'mouth', facsAU: 'AU15L', description: 'Descenso de comisura izquierda (Depressor anguli oris)' },
  mouthFrownRight: { name: 'mouthFrownRight', category: 'mouth', facsAU: 'AU15R', description: 'Descenso de comisura derecha (Depressor anguli oris)' },
  mouthDimpleLeft: { name: 'mouthDimpleLeft', category: 'mouth', facsAU: 'AU14L', description: 'Hoyuelo izquierdo (Risorius)' },
  mouthDimpleRight: { name: 'mouthDimpleRight', category: 'mouth', facsAU: 'AU14R', description: 'Hoyuelo derecho (Risorius)' },
  mouthStretchLeft: { name: 'mouthStretchLeft', category: 'mouth', facsAU: 'AU20L', description: 'Estiramiento lateral izquierdo' },
  mouthStretchRight: { name: 'mouthStretchRight', category: 'mouth', facsAU: 'AU20R', description: 'Estiramiento lateral derecho' },
  mouthRollLower: { name: 'mouthRollLower', category: 'mouth', facsAU: 'AU28L', description: 'Inversión de labio inferior hacia dientes' },
  mouthRollUpper: { name: 'mouthRollUpper', category: 'mouth', facsAU: 'AU28U', description: 'Inversión de labio superior hacia dientes' },
  mouthShrugLower: { name: 'mouthShrugLower', category: 'mouth', facsAU: 'AU17', description: 'Elevación de mentón y labio inferior (Mentalis)' },
  mouthShrugUpper: { name: 'mouthShrugUpper', category: 'mouth', facsAU: 'AU10', description: 'Elevación medial de labio superior' },
  mouthPressLeft: { name: 'mouthPressLeft', category: 'mouth', facsAU: 'AU24L', description: 'Compresión labial lateral izquierda' },
  mouthPressRight: { name: 'mouthPressRight', category: 'mouth', facsAU: 'AU24R', description: 'Compresión labial lateral derecha' },
  mouthLowerDownLeft: { name: 'mouthLowerDownLeft', category: 'mouth', facsAU: 'AU25LL', description: 'Descenso de labio inferior izquierdo' },
  mouthLowerDownRight: { name: 'mouthLowerDownRight', category: 'mouth', facsAU: 'AU25LR', description: 'Descenso de labio inferior derecho' },
  mouthUpperUpLeft: { name: 'mouthUpperUpLeft', category: 'mouth', facsAU: 'AU10L', description: 'Elevación de labio superior izquierdo' },
  mouthUpperUpRight: { name: 'mouthUpperUpRight', category: 'mouth', facsAU: 'AU10R', description: 'Elevación de labio superior derecho' },
  mouthPucker: { name: 'mouthPucker', category: 'mouth', facsAU: 'AU18', description: 'Protrusión labial en beso ("U")' },
  mouthFunnel: { name: 'mouthFunnel', category: 'mouth', facsAU: 'AU22', description: 'Embudo abierto en "O"' },
  mouthLeft: { name: 'mouthLeft', category: 'mouth', description: 'Desplazamiento horizontal bucal a izquierda' },
  mouthRight: { name: 'mouthRight', category: 'mouth', description: 'Desplazamiento horizontal bucal a derecha' },
  mouthLipsTogether: { name: 'mouthLipsTogether', category: 'mouth', description: 'Aproximación de bordes bermellón' },
  mouthTighten: { name: 'mouthTighten', category: 'mouth', facsAU: 'AU23', description: 'Estrechamiento del esfínter labial (Orbicularis oris)' },

  eyeBlinkLeft: { name: 'eyeBlinkLeft', category: 'eyes', facsAU: 'AU45L', description: 'Cierre palpebral izquierdo' },
  eyeBlinkRight: { name: 'eyeBlinkRight', category: 'eyes', facsAU: 'AU45R', description: 'Cierre palpebral derecho' },
  eyeLookUpLeft: { name: 'eyeLookUpLeft', category: 'eyes', description: 'Mirada arriba ojo izquierdo' },
  eyeLookUpRight: { name: 'eyeLookUpRight', category: 'eyes', description: 'Mirada arriba ojo derecho' },
  eyeLookDownLeft: { name: 'eyeLookDownLeft', category: 'eyes', description: 'Mirada abajo ojo izquierdo' },
  eyeLookDownRight: { name: 'eyeLookDownRight', category: 'eyes', description: 'Mirada abajo ojo derecho' },
  eyeLookInLeft: { name: 'eyeLookInLeft', category: 'eyes', description: 'Aducción ocular izquierda (hacia la nariz)' },
  eyeLookInRight: { name: 'eyeLookInRight', category: 'eyes', description: 'Aducción ocular derecha (hacia la nariz)' },
  eyeLookOutLeft: { name: 'eyeLookOutLeft', category: 'eyes', description: 'Abducción ocular izquierda (hacia la sien)' },
  eyeLookOutRight: { name: 'eyeLookOutRight', category: 'eyes', description: 'Abducción ocular derecha (hacia la sien)' },
  eyeSquintLeft: { name: 'eyeSquintLeft', category: 'eyes', facsAU: 'AU6L', description: 'Contracción periocular izquierda (Orbicularis oculi)' },
  eyeSquintRight: { name: 'eyeSquintRight', category: 'eyes', facsAU: 'AU6R', description: 'Contracción periocular derecha (Orbicularis oculi)' },

  browDownLeft: { name: 'browDownLeft', category: 'brows', facsAU: 'AU4L', description: 'Descenso y aproximación de ceja izquierda (Corrugator)' },
  browDownRight: { name: 'browDownRight', category: 'brows', facsAU: 'AU4R', description: 'Descenso y aproximación de ceja derecha (Corrugator)' },
  browInnerUp: { name: 'browInnerUp', category: 'brows', facsAU: 'AU1', description: 'Elevación de ceja medial (Frontalis pars medialis)' },
  browOuterUpLeft: { name: 'browOuterUpLeft', category: 'brows', facsAU: 'AU2L', description: 'Elevación lateral de ceja izquierda (Frontalis pars lateralis)' },
  browOuterUpRight: { name: 'browOuterUpRight', category: 'brows', facsAU: 'AU2R', description: 'Elevación lateral de ceja derecha (Frontalis pars lateralis)' },

  cheekPuff: { name: 'cheekPuff', category: 'cheek_nose', facsAU: 'AU34', description: 'Distensión de mejillas con aire' },
  cheekSquintLeft: { name: 'cheekSquintLeft', category: 'cheek_nose', facsAU: 'AU6L', description: 'Elevación de mejilla izquierda' },
  cheekSquintRight: { name: 'cheekSquintRight', category: 'cheek_nose', facsAU: 'AU6R', description: 'Elevación de mejilla derecha' },
  noseSneerLeft: { name: 'noseSneerLeft', category: 'cheek_nose', facsAU: 'AU9L', description: 'Fruncimiento nasal izquierdo (Levator labii)' },
};

/**
 * Representación en vector Float32Array de dimensión 52
 */
export class ARKitVector {
  public readonly values = new Float32Array(52);

  public set(shape: ARKitShapeName, weight: number): void {
    const idx = ARKIT_SHAPE_NAMES.indexOf(shape);
    if (idx !== -1) {
      this.values[idx] = Math.max(0, Math.min(1.0, weight));
    }
  }

  public get(shape: ARKitShapeName): number {
    const idx = ARKIT_SHAPE_NAMES.indexOf(shape);
    return idx !== -1 ? this.values[idx]! : 0;
  }

  public reset(): void {
    this.values.fill(0);
  }
}
