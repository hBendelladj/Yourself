/**
 * avatarRenderer.ts
 *
 * Motor de renderizado en Three.js con cámara ortográfica para el avatar 2D/3D.
 * Renderiza la malla triangulada con textura fotográfica, ejecuta la deformación
 * orgánica de poses (reposo vivo: parpadeo, respiración, balanceo, mirada) y soporta
 * overlays de depuración (puntos de malla, wireframe y anclas).
 */

import * as THREE from 'three';
import { MeshGeometryData } from '@/core/face/buildMesh';
import { LANDMARK_INDICES } from '@/core/face/landmarkGroups';
import { PoseDeformer } from '@/core/render/poses';
import { AnimationStateManager, PoseValues } from '@/core/animation/animationState';
import { IdleBehaviorController } from '@/core/animation/idleBehavior';
import { MouthInterior } from '@/core/render/mouthInterior';
import { Mouth3D } from '@/core/render/mouth3d';
import { LipsyncAnalyzer, VisemeWeights } from '@/core/audio/lipsyncAnalyzer';
import { PhotoProfile, calibratePhotoProfile } from '@/core/face/photoProfile';
import { closeRestingLips } from '@/core/face/restingLips';
import { EyelidOverlay } from '@/core/render/eyelids';
import { EyeEngine } from '@/core/eye';
import { VORCoordinator, HeadDirector, EmotionEngine, HeadGains } from '@/core/motion';
import { DepthEstimator } from '@/core/face3d';
import { NeuralBridge } from '@/core/neural';
import { RigEvaluator } from '@/core/rig/rigEvaluator';
import { BlinkController } from '@/core/animation/blink';
import { PseudoVolumeShading } from '@/core/render/shading';
import { VisemeScheduler } from '@/core/audio/visemeScheduler';
import { SyllableClock } from '@/core/audio/syllableClock';
import { AudioClock } from '@/core/audio/audioClock';
import { Director, LayerGains, SpeechGains } from '@/core/animation/director';
import { ActionId } from '@/core/animation/actions';
import { AvatarMood } from '@/lib/types';

export type { LayerGains, SpeechGains } from '@/core/animation/director';
export type { HeadGains } from '@/core/motion';

export interface ModulePerfMetrics {
  prosodyVisemesMs: number;
  directorDynamicsMs: number;
  rigApplyMs: number;
  overlaysShadingMs: number;
  totalJsMs: number;
}

export interface DebugMetrics {
  fps: number;
  perf: ModulePerfMetrics;
  jawOpenHistogram: number[]; // 5 rangos: [0-0.05, 0.05-0.15, 0.15-0.35, 0.35-0.65, >0.65]
  blinksPerMinute: number;
  headMovementRms: number;
  currentJawOpen: number;
  currentYaw: number;
  currentPitch: number;
  currentRoll: number;
  currentBlink: number;
  rigVersion: 'v1' | 'v2' | 'v3' | 'v4';
  currentEmotionName?: string;
  currentValence?: number;
  currentArousal?: number;
}

export interface AvatarRendererOptions {
  canvas: HTMLCanvasElement;
  imageElement: HTMLImageElement;
  meshData: MeshGeometryData;
  transformationMatrix?: number[];
  isDebug?: boolean;
  initialMood?: AvatarMood;
  analyserNode?: AnalyserNode | null;
  rigVersion?: 'v1' | 'v2' | 'v3' | 'v4';
  onFpsUpdate?: (fps: number) => void;
  onBlinkChange?: (isBlinking: boolean) => void;
  onMetricsUpdate?: (metrics: DebugMetrics) => void;
}

export class AvatarRenderer {
  private canvas: HTMLCanvasElement;
  private imageElement: HTMLImageElement;
  private meshData: MeshGeometryData;
  private transformationMatrix?: number[];
  private isFrontalFace = true;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private orthographicCamera: THREE.OrthographicCamera;
  private perspectiveCamera: THREE.PerspectiveCamera;

  private faceGeometry: THREE.BufferGeometry;
  private faceMaterial: THREE.MeshBasicMaterial;
  private faceMesh: THREE.Mesh;
  private texture: THREE.Texture;

  // Sistema de animación y deformación
  private poseDeformer: PoseDeformer;
  public animationState: AnimationStateManager;
  public idleBehavior: IdleBehaviorController;
  public blinkController: BlinkController;
  public director: Director;
  private currentMood: AvatarMood = 'idle';

  // Boca interior procedural, overlays y lip-sync
  public photoProfile: PhotoProfile;
  public mouthInterior: MouthInterior;
  public mouth3d?: Mouth3D;
  public eyelidOverlay: EyelidOverlay;
  public eyeEngine: EyeEngine;
  public vorCoordinator: VORCoordinator;
  public headDirector: HeadDirector;
  public emotionEngine: EmotionEngine;
  public neuralBridge: NeuralBridge;
  public rigEvaluator: RigEvaluator;
  public pseudoVolumeShading: PseudoVolumeShading;
  public lipsyncAnalyzer: LipsyncAnalyzer;
  public visemeScheduler: VisemeScheduler;
  public syllableClock: SyllableClock;
  public audioClock: AudioClock;
  private extraShapeWeights: Record<string, number> = {};
  private manualVisemes: Partial<VisemeWeights> | null = null;
  private manualChannels: Partial<PoseValues> | null = null;
  private layerGains: LayerGains = { lips: 1.0, expression: 1.0, pose: 1.0 };
  private rigVersion: 'v1' | 'v2' | 'v3' | 'v4' = 'v4';

  // Debug objects y métricas
  private isDebug: boolean;
  private wireframeMesh: THREE.Mesh | null = null;
  private debugPoints: THREE.Points | null = null;
  private onMetricsUpdate?: (metrics: DebugMetrics) => void;

  // Render loop
  private animationFrameId: number | null = null;
  private isDestroyed = false;
  private isTabHidden = false;
  private lastTime = 0;
  private frameCount = 0;
  private fpsAccumulator = 0;
  private currentFps = 60;
  private onFpsUpdate?: (fps: number) => void;

  // Búferes pre-asignados para métricas (CERO allocations en bucle caliente)
  private metricsData: DebugMetrics = {
    fps: 60,
    perf: {
      prosodyVisemesMs: 0,
      directorDynamicsMs: 0,
      rigApplyMs: 0,
      overlaysShadingMs: 0,
      totalJsMs: 0,
    },
    jawOpenHistogram: [1, 0, 0, 0, 0],
    blinksPerMinute: 0,
    headMovementRms: 0,
    currentJawOpen: 0,
    currentYaw: 0,
    currentPitch: 0,
    currentRoll: 0,
    currentBlink: 0,
    rigVersion: 'v3',
    currentEmotionName: 'neutral',
    currentValence: 0.0,
    currentArousal: 0.15,
  };

  private perfAccumulator: ModulePerfMetrics = {
    prosodyVisemesMs: 0,
    directorDynamicsMs: 0,
    rigApplyMs: 0,
    overlaysShadingMs: 0,
    totalJsMs: 0,
  };
  private perfIntervalAccumulator = 0;
  private perfFrameCounter = 0;

  // Histograma exponencial y seguimiento de parpadeo/cabeza
  private jawOpenHistogramBins = [1.0, 0, 0, 0, 0];
  private blinkTimestamps = new Float64Array(128);
  private blinkTimestampCount = 0;
  private headSquaresWindow = new Float32Array(60);
  private headWindowIndex = 0;
  private lastGazeTargetX = 0;
  private lastGazeTargetY = 0;

  constructor(options: AvatarRendererOptions) {
    this.canvas = options.canvas;
    this.imageElement = options.imageElement;
    this.meshData = options.meshData;
    this.transformationMatrix = options.transformationMatrix;
    this.isDebug = options.isDebug ?? false;
    this.currentMood = options.initialMood ?? 'idle';
    this.rigVersion = options.rigVersion ?? 'v4';
    this.onFpsUpdate = options.onFpsUpdate;
    this.onMetricsUpdate = options.onMetricsUpdate;
    this.metricsData.rigVersion = this.rigVersion;

    // 1. Inicializar Three.js WebGLRenderer con captura de errores
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
        stencil: true,
      });
    } catch (err: unknown) {
      console.error('Three.js WebGLRenderer initialization error:', err);
      throw new Error(
        'WebGL no pudo inicializarse en este navegador. Verifica que la aceleración por hardware esté activada en la configuración del navegador.'
      );
    }

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // 2. Inicializar Scene y Cámaras (Ortográfica para V1/V2, Perspectiva baja FOV para V3/V4)
    this.scene = new THREE.Scene();

    const hw = this.meshData.worldWidth / 2;
    const hh = this.meshData.worldHeight / 2;

    this.orthographicCamera = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.1, 100);
    this.orthographicCamera.position.set(0, 0, 10);
    this.orthographicCamera.lookAt(0, 0, 0);

    // Cámara de perspectiva con FOV bajo (28°) para V3/V4 (elimina distorsión focal y genera paralaje 3D real)
    const initialAspect = (this.canvas.clientWidth || 512) / (this.canvas.clientHeight || 512);
    this.perspectiveCamera = new THREE.PerspectiveCamera(28, initialAspect, 0.1, 100);
    const lowFovRad = (28 * Math.PI) / 360.0;
    const camDist = hh / Math.tan(lowFovRad);
    this.perspectiveCamera.position.set(0, 0, camDist);
    this.perspectiveCamera.lookAt(0, 0, 0);

    this.camera = this.rigVersion === 'v3' || this.rigVersion === 'v4' ? this.perspectiveCamera : this.orthographicCamera;

    // 3. Conectar face3d (DepthEstimator) para reconstruir Z métrico tridimensional real en V3 y V4
    if ((this.rigVersion === 'v3' || this.rigVersion === 'v4') && this.meshData.landmarks && this.meshData.landmarks.length >= 468) {
      const metricData = DepthEstimator.estimateMetric3D({
        landmarks: this.meshData.landmarks,
        imageWidth: this.imageElement.naturalWidth || 512,
        imageHeight: this.imageElement.naturalHeight || 512,
        worldWidth: this.meshData.worldWidth,
        worldHeight: this.meshData.worldHeight,
        transformationMatrix: this.transformationMatrix,
      });

      this.isFrontalFace = metricData.isFrontal;

      const count = this.meshData.landmarkCount;
      for (let i = 0; i < count; i++) {
        const mz = metricData.metricPositions[i * 3 + 2]!;
        this.meshData.basePositions[i * 3 + 2] = mz;
        this.meshData.currentPositions[i * 3 + 2] = mz;
      }
    }

    // 3.5 Cerrar los labios en el reposo neutral para cualquier foto con umbral estricto
    closeRestingLips(this.meshData.basePositions, this.meshData.faceScale, { closureThreshold: 0.0005 });
    closeRestingLips(this.meshData.currentPositions, this.meshData.faceScale, { closureThreshold: 0.0005 });

    // 4. Crear textura fotográfica
    this.texture = new THREE.Texture(this.imageElement);
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.needsUpdate = true;

    // 5. Crear BufferGeometry con los datos de Delaunay
    this.faceGeometry = new THREE.BufferGeometry();
    this.faceGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.meshData.currentPositions, 3)
    );
    this.faceGeometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(this.meshData.uvs, 2)
    );
    this.faceGeometry.setIndex(
      new THREE.BufferAttribute(this.meshData.indices, 1)
    );

    // 6. Material del Avatar con soporte para sombreado por vértices
    this.faceMaterial = new THREE.MeshBasicMaterial({
      map: this.texture,
      side: THREE.DoubleSide,
      vertexColors: true,
    });

    this.faceMesh = new THREE.Mesh(this.faceGeometry, this.faceMaterial);
    this.scene.add(this.faceMesh);

    // 6.5 Calibrar PhotoProfile a partir de la foto y landmarks
    this.photoProfile = calibratePhotoProfile({
      landmarks: this.meshData.landmarks || [],
      worldWidth: this.meshData.worldWidth,
      worldHeight: this.meshData.worldHeight,
      imageElement: this.imageElement,
    });

    // 6.8 Sombreado de pseudo-volumen por deformación de área
    this.pseudoVolumeShading = new PseudoVolumeShading({
      basePositions: this.meshData.basePositions,
      indices: this.meshData.indices,
      vertexCount: this.meshData.vertexCount,
      regions: this.meshData.regions,
    });
    this.faceGeometry.setAttribute('color', this.pseudoVolumeShading.colorAttribute);

    // 7. Cavidad bucal como overlay geométrico recortado por el labio interior (o Mouth3D en v4)
    this.mouthInterior = new MouthInterior({ profile: this.photoProfile });
    this.scene.add(this.mouthInterior.mesh);

    if (this.rigVersion === 'v4') {
      const maxAnisotropy = this.renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
      this.mouth3d = new Mouth3D({
        profile: this.photoProfile,
        maxAnisotropy: Math.min(8, maxAnisotropy),
      });
      this.scene.add(this.mouth3d.rootGroup);
      this.mouthInterior.mesh.visible = false;
    }

    // 7.5 Motor de Párpados y Ojos (Gestión procedural y biométrica sin mallas flotantes)
    this.eyelidOverlay = new EyelidOverlay({
      texture: this.texture,
      faceScale: this.meshData.faceScale,
    });
    // Se omiten mallas extras / overlays flotantes por petición explícita:
    // El parpadeo se realiza 100% sobre la malla nativa facial.

    this.eyeEngine = new EyeEngine({
      texture: this.texture,
      basePositions: this.meshData.basePositions,
      faceScale: this.meshData.faceScale,
      profile: this.photoProfile,
      onBlinkChange: (isBlinking: boolean) => {
        if (isBlinking) {
          this.recordBlink();
        }
        options.onBlinkChange?.(isBlinking);
      },
    });
    // No se añade ninguna malla extra palpebral flotante a la escena.

    // 7.8 Motores V3 de Cinemática, Emoción, VOR y ARKit
    this.vorCoordinator = new VORCoordinator();
    this.headDirector = new HeadDirector();
    this.headDirector.setRigVersion(this.rigVersion);
    this.emotionEngine = new EmotionEngine();
    this.neuralBridge = new NeuralBridge();
    this.rigEvaluator = new RigEvaluator({
      basePositions: this.meshData.basePositions,
      landmarkCount: this.meshData.landmarkCount,
      faceScale: this.meshData.faceScale,
    });

    // 8. Analizador de audio y lip-sync en tiempo real
    this.lipsyncAnalyzer = new LipsyncAnalyzer(options.analyserNode, {
      softMaxJaw: this.rigVersion === 'v3' ? 0.92 : 0.65,
      useCalibratedCurve: this.rigVersion === 'v3',
    });

    // 8.5 Reloj de audio, detector de núcleos silábicos y programador de visemas en español (Fase 3)
    this.audioClock = new AudioClock(options.analyserNode?.context as AudioContext | undefined);
    this.syllableClock = new SyllableClock();
    this.visemeScheduler = new VisemeScheduler();
    this.syllableClock.onSyllable = (audioTime: number) => {
      this.visemeScheduler.onSyllableTick(audioTime);
    };

    // 9. Inicializar subsistemas de morphing y animación autónoma
    this.poseDeformer = new PoseDeformer({
      basePositions: this.meshData.basePositions,
      landmarkCount: this.meshData.landmarkCount,
      vertexCount: this.meshData.vertexCount,
      faceScale: this.meshData.faceScale,
      rigVersion: this.rigVersion,
      indices: this.meshData.indices,
      regions: this.meshData.regions,
    });
    this.animationState = new AnimationStateManager();
    this.idleBehavior = new IdleBehaviorController(this.animationState);
    this.idleBehavior.setRigVersion(this.rigVersion);
    this.idleBehavior.setFrontality(this.photoProfile.frontality);
    this.idleBehavior.onBlinkChange = (isBlinking: boolean) => {
      if (this.rigVersion === 'v1') {
        if (isBlinking) {
          this.recordBlink();
        }
        options.onBlinkChange?.(isBlinking);
      }
    };

    // Parpadeador V2 (log-normal, asimétrico y acoplado a sacadas)
    this.blinkController = new BlinkController();
    this.blinkController.onBlinkChange = (isBlinking: boolean) => {
      if (this.rigVersion === 'v2') {
        if (isBlinking) {
          this.recordBlink();
        }
        options.onBlinkChange?.(isBlinking);
      }
    };

    // 9.5 Director orquestador multicapa (Fase 4: Labios / Expresión / Pose)
    this.director = new Director({
      blinkController: this.blinkController,
      visemeScheduler: this.visemeScheduler,
      frontality: this.photoProfile.frontality,
    });
    this.director.gaze.onSaccade = (mag: number) => {
      if (this.rigVersion === 'v3') {
        this.eyeEngine.blinkEngine.triggerSaccadeBlink(mag);
      } else {
        this.blinkController.triggerSaccadeBlink(mag);
      }
    };
    this.director.setLayerGains(this.layerGains);
    this.director.setMood(this.currentMood);

    // 10. Listener de visibilidad de pestaña para pausar el bucle cuando está oculta
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    // 11. Preparar Overlays de Depuración si están activos
    this.setupDebugObjects();

    // 12. Ajustar tamaño inicial
    this.handleResize();

    // 13. Iniciar bucle de renderizado
    this.lastTime = performance.now();
    this.startLoop();
  }

  private handleVisibilityChange = (): void => {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      this.isTabHidden = true;
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
    } else {
      this.isTabHidden = false;
      if (!this.isDestroyed && this.animationFrameId === null) {
        this.lastTime = performance.now();
        this.startLoop();
      }
    }
  };

  private recordBlink(): void {
    const now = performance.now();
    if (this.blinkTimestampCount < this.blinkTimestamps.length) {
      this.blinkTimestamps[this.blinkTimestampCount++] = now;
    } else {
      this.blinkTimestamps.copyWithin(0, 1);
      this.blinkTimestamps[this.blinkTimestamps.length - 1] = now;
    }
  }

  private setupDebugObjects() {
    if (this.wireframeMesh) {
      this.scene.remove(this.wireframeMesh);
      this.wireframeMesh.geometry.dispose();
      (this.wireframeMesh.material as THREE.Material).dispose();
      this.wireframeMesh = null;
    }
    if (this.debugPoints) {
      this.scene.remove(this.debugPoints);
      this.debugPoints.geometry.dispose();
      (this.debugPoints.material as THREE.Material).dispose();
      this.debugPoints = null;
    }

    if (!this.isDebug) return;

    // 1. Malla Wireframe translúcida
    const wireframeMaterial = new THREE.MeshBasicMaterial({
      color: 0x06b6d4, // Cyan
      wireframe: true,
      transparent: true,
      opacity: 0.35,
    });
    this.wireframeMesh = new THREE.Mesh(this.faceGeometry, wireframeMaterial);
    this.wireframeMesh.position.z = 0.001; // ligeramente adelante
    this.scene.add(this.wireframeMesh);

    // 2. Nube de Puntos de Depuración con colores por grupo
    const pointCount = this.meshData.vertexCount;
    const colors = new Float32Array(pointCount * 3);

    for (let i = 0; i < pointCount; i++) {
      if (i >= this.meshData.anchorStartIndex) {
        // Anclas perimetrales (Magenta / Rosa)
        colors[i * 3] = 0.92;
        colors[i * 3 + 1] = 0.28;
        colors[i * 3 + 2] = 0.6;
      } else if (
        i === LANDMARK_INDICES.chinBottom ||
        i === LANDMARK_INDICES.noseTip
      ) {
        // Mentón y nariz (Amarillo)
        colors[i * 3] = 0.95;
        colors[i * 3 + 1] = 0.85;
        colors[i * 3 + 2] = 0.1;
      } else if (
        i === LANDMARK_INDICES.lipUpperInnerCenter ||
        i === LANDMARK_INDICES.lipLowerInnerCenter ||
        i === LANDMARK_INDICES.lipLeftCorner ||
        i === LANDMARK_INDICES.lipRightCorner
      ) {
        // Labios centrales y comisuras (Rojo / Naranja)
        colors[i * 3] = 0.95;
        colors[i * 3 + 1] = 0.2;
        colors[i * 3 + 2] = 0.2;
      } else if (
        i === LANDMARK_INDICES.leftIrisCenter ||
        i === LANDMARK_INDICES.rightIrisCenter
      ) {
        // Iris / Pupila (Verde brillante)
        colors[i * 3] = 0.1;
        colors[i * 3 + 1] = 0.95;
        colors[i * 3 + 2] = 0.3;
      } else {
        // Malla facial general (Cyan brillante)
        colors[i * 3] = 0.05;
        colors[i * 3 + 1] = 0.75;
        colors[i * 3 + 2] = 0.95;
      }
    }

    const pointsGeometry = new THREE.BufferGeometry();
    pointsGeometry.setAttribute(
      'position',
      this.faceGeometry.attributes.position!
    );
    pointsGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const pointsMaterial = new THREE.PointsMaterial({
      size: 4,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
    });

    this.debugPoints = new THREE.Points(pointsGeometry, pointsMaterial);
    this.debugPoints.position.z = 0.002;
    this.scene.add(this.debugPoints);
  }

  public setDebugOverlay(enabled: boolean): void {
    this.isDebug = enabled;
    this.setupDebugObjects();
  }

  public setMood(mood: AvatarMood): void {
    this.currentMood = mood;
    this.director.setMood(mood);
  }

  public setAudioAnalyser(analyser: AnalyserNode | null): void {
    if (analyser) {
      this.lipsyncAnalyzer.setAnalyser(analyser);
      if (analyser.context) {
        this.audioClock.setContext(analyser.context as AudioContext);
        this.director.prosody.setSampleRate(analyser.context.sampleRate);
      }
    }
  }

  public setAudioContext(context: AudioContext | null): void {
    if (context) {
      this.audioClock.setContext(context);
      this.director.prosody.setSampleRate(context.sampleRate);
    }
  }

  public enqueueTranscript(text: string): void {
    this.visemeScheduler.enqueueText(text);
    this.director.processText(text);
  }

  public onInterrupted(): void {
    this.visemeScheduler.flush();
    this.syllableClock.reset();
    this.audioClock.reset();
    this.director.onInterrupted();
    this.extraShapeWeights = {};
  }

  public setAnalyser(analyser: AnalyserNode | null): void {
    this.setAudioAnalyser(analyser);
  }

  public setRigVersion(version: 'v1' | 'v2' | 'v3' | 'v4'): void {
    this.rigVersion = version;
    this.metricsData.rigVersion = version;
    this.poseDeformer.setRigVersion(version === 'v4' ? 'v3' : version);
    this.idleBehavior.setRigVersion(version === 'v3' || version === 'v4' ? 'v2' : version);
    this.lipsyncAnalyzer.setSoftMaxJaw(
      version === 'v3' || version === 'v4' ? 0.92 : 0.65,
      version === 'v3' || version === 'v4'
    );
    this.camera = version === 'v3' || version === 'v4' ? this.perspectiveCamera : this.orthographicCamera;
    this.handleResize();

    if (this.mouthInterior) {
      this.mouthInterior.mesh.visible = version !== 'v4';
    }
    if (this.mouth3d) {
      this.mouth3d.rootGroup.visible = version === 'v4';
    } else if (version === 'v4') {
      const maxAnisotropy = this.renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
      this.mouth3d = new Mouth3D({
        profile: this.photoProfile,
        maxAnisotropy: Math.min(8, maxAnisotropy),
      });
      this.scene.add(this.mouth3d.rootGroup);
    }

    if (this.eyelidOverlay) {
      this.eyelidOverlay.mesh.visible = false;
    }
    if (this.eyeEngine) {
      this.eyeEngine.eyelidMesh.mesh.visible = false;
    }
  }

  public getRigVersion(): 'v1' | 'v2' | 'v3' | 'v4' {
    return this.rigVersion;
  }

  public setLayerGains(gains: Partial<LayerGains>): void {
    this.director.setLayerGains(gains);
    this.layerGains = this.director.getLayerGains();
  }

  public getLayerGains(): LayerGains {
    return this.director.getLayerGains();
  }

  public setSpeechGains(gains: Partial<SpeechGains>): void {
    this.director.setSpeechGains(gains);
  }

  public getSpeechGains(): SpeechGains {
    return this.director.getSpeechGains();
  }

  public setHeadGains(gains: Partial<HeadGains>): void {
    this.headDirector.setGains(gains);
  }

  public getHeadGains(): HeadGains {
    return this.headDirector.getGains();
  }

  public setEmotionSensitivity(s: number): void {
    this.director.setEmotionSensitivity(s);
  }

  public getEmotionSensitivity(): number {
    return this.director.getEmotionSensitivity();
  }

  public setBlinkRate(rate: number): void {
    this.eyeEngine.blinkEngine.setRateMultiplier(rate);
    this.blinkController.setRateMultiplier(rate);
  }

  public getBlinkRate(): number {
    return this.eyeEngine.blinkEngine.getRateMultiplier();
  }

  public getDirector(): Director {
    return this.director;
  }

  public triggerAction(id: ActionId, scale = 1.0): void {
    this.director.triggerAction(id, scale);
  }

  public setEmotion(valence: number, arousal: number): void {
    this.director.setEmotion(valence, arousal);
  }

  public setGazeTarget(x: number, y: number): void {
    this.director.gazeTarget[0] = x;
    this.director.gazeTarget[1] = y;
  }

  public setHeadDistance(distance: number): void {
    this.director.headDistance = distance;
  }

  public setManualChannels(channels: Partial<PoseValues> | null): void {
    this.manualChannels = channels;
  }

  public setManualVisemes(visemes: Partial<VisemeWeights> | null): void {
    this.manualVisemes = visemes;
  }

  public triggerBlink(): void {
    if (this.rigVersion === 'v3') {
      this.eyeEngine.triggerBlink();
    } else if (this.rigVersion === 'v2') {
      this.blinkController.triggerBlink();
    } else {
      this.idleBehavior.triggerBlink();
    }
  }

  public handleResize(): void {
    if (this.isDestroyed) return;
    const width = this.canvas.clientWidth || 512;
    const height = this.canvas.clientHeight || 512;

    this.renderer.setSize(width, height, false);

    // Mantener aspect ratio del avatar dentro del contenedor
    const viewAspect = width / height;
    const meshAspect = this.meshData.aspectRatio;

    let hw = this.meshData.worldWidth / 2;
    let hh = this.meshData.worldHeight / 2;

    if (viewAspect > meshAspect) {
      hw = hh * viewAspect;
    } else {
      hh = hw / viewAspect;
    }

    this.orthographicCamera.left = -hw;
    this.orthographicCamera.right = hw;
    this.orthographicCamera.top = hh;
    this.orthographicCamera.bottom = -hh;
    this.orthographicCamera.updateProjectionMatrix();

    this.perspectiveCamera.aspect = viewAspect;
    const lowFovRad = (28 * Math.PI) / 360.0;
    const camDist = hh / Math.tan(lowFovRad);
    this.perspectiveCamera.position.set(0, 0, camDist);
    this.perspectiveCamera.updateProjectionMatrix();
  }

  /**
   * Bucle principal de animación a 60 fps con cálculo dinámico de poses
   */
  private startLoop(): void {
    const renderFrame = (now: number) => {
      if (this.isDestroyed || this.isTabHidden) return;

      const deltaMs = now - this.lastTime;
      this.lastTime = now;
      const deltaSeconds = Math.min(0.1, deltaMs / 1000);

      // --- MÓDULO 1: Prosodia & Lip-sync ---
      const t0 = performance.now();
      const audioTime = this.audioClock.getAudioTime();
      const visemes = this.lipsyncAnalyzer.update(deltaSeconds);
      this.syllableClock.processSample(visemes.jawOpen, audioTime);

      const t1 = performance.now();
      const prosodyVisemesMs = t1 - t0;

      // --- MÓDULO 2: Director, Idle Behavior & Dinámica ---
      if (this.rigVersion === 'v2' || this.rigVersion === 'v3') {
        const prosody = this.director.prosody.processTimeDomain(this.lipsyncAnalyzer.getTimeData());
        const dOut = this.director.update(deltaSeconds, audioTime, visemes, prosody);

        // Control VASA-1 de distancia cefálica (zoom de cámara suave)
        if (Math.abs(this.camera.zoom - dOut.headDistance) > 0.0005) {
          this.camera.zoom = dOut.headDistance;
          this.camera.updateProjectionMatrix();
        }

        // Parpadeador V2/V3 (distribución log-normal y asimetría temporal)
        if (!this.manualChannels || (this.manualChannels.blink === undefined && this.manualChannels.blinkLeft === undefined)) {
          const bState = this.rigVersion === 'v3'
            ? this.eyeEngine.blinkEngine.update(deltaSeconds, this.currentMood)
            : this.blinkController.update(deltaSeconds, this.currentMood);
          const maxBlink = Math.max(bState.blinkLeft, bState.blinkRight);
          this.animationState.setTarget('blink', maxBlink);
          this.animationState.setTarget('blinkLeft', bState.blinkLeft);
          this.animationState.setTarget('blinkRight', bState.blinkRight);
        }

        // Asignar metas del Director al AnimationStateManager
        const p = dOut.poseTargets;
        this.animationState.setTarget('jawOpen', p.jawOpen);
        this.animationState.setTarget('mouthRound', p.mouthRound);
        this.animationState.setTarget('mouthWide', p.mouthWide);
        this.animationState.setTarget('smile', p.smile);
        this.animationState.setTarget('browRaise', p.browRaise);
        this.animationState.setTarget('gazeX', p.gazeX);
        this.animationState.setTarget('gazeY', p.gazeY);
        this.animationState.setTarget('breath', p.breath);

        // Coordinación V3: VOR, Gestos Cefálicos y Emoción Duchenne
        let autoYaw = p.headYaw;
        let autoPitch = p.headPitch;
        let autoRoll = p.headRoll;

        if (this.rigVersion === 'v3' || this.rigVersion === 'v4') {
          const isIdleMood = this.currentMood === 'idle';
          const headKin = this.headDirector.update(
            deltaSeconds,
            this.currentMood,
            prosody.isStressedSyllable || (this.currentMood === 'speaking' && Math.sin(this.audioTimeSec * 24) > 0.8),
            prosody.f0,
            this.currentMood === 'speaking' && prosody.energy < 0.05 ? 0.15 : prosody.energy,
            this.animationState.current.jawOpen
          );
          if (this.rigVersion === 'v4') {
            // V4 (H6 resuelto): el reposo no es cero. Mantiene micro-movimiento vivo suave (35% OU + respiración)
            if (isIdleMood) {
              autoYaw = headKin.yaw * 0.35 + p.gazeX * 0.04;
              autoPitch = headKin.pitch * 0.35 + p.gazeY * 0.03 + Math.sin(this.audioTimeSec * 1.5) * 0.008;
              autoRoll = headKin.roll * 0.35;
            } else {
              autoYaw = headKin.yaw + p.gazeX * 0.10;
              autoPitch = headKin.pitch + p.gazeY * 0.08;
              autoRoll = headKin.roll;
            }

            // Límites blandos de rotación (4.C): theta_render = theta_max * tanh(theta / theta_max)
            const maxYaw = (this.isFrontalFace ? 25.0 : 15.0) * (Math.PI / 180.0);
            const maxPitch = 15.0 * (Math.PI / 180.0);
            const maxRoll = 20.0 * (Math.PI / 180.0);

            autoYaw = maxYaw * Math.tanh(autoYaw / maxYaw);
            autoPitch = maxPitch * Math.tanh(autoPitch / maxPitch);
            autoRoll = maxRoll * Math.tanh(autoRoll / maxRoll);
          } else {
            // En reposo neutral (idle), la cabeza se mantiene estable en v3
            if (isIdleMood) {
              autoYaw = 0;
              autoPitch = 0;
              autoRoll = 0;
            } else {
              autoYaw = headKin.yaw + p.gazeX * 0.10;
              autoPitch = headKin.pitch + p.gazeY * 0.08;
              autoRoll = headKin.roll;
            }
          }

          const vorState = this.vorCoordinator.update(
            deltaSeconds,
            p.gazeX,
            p.gazeY,
            this.animationState.current.headYaw,
            this.animationState.current.headPitch
          );
          if (!this.manualChannels?.gazeX) this.animationState.setTarget('gazeX', vorState.compensatedGazeX);
          if (!this.manualChannels?.gazeY) this.animationState.setTarget('gazeY', vorState.compensatedGazeY);

          // Disparo de parpadeo reflejo ante sacadas oculares o cambios rápidos de mirada (Fase 3)
          const gazeDelta = Math.hypot(p.gazeX - this.lastGazeTargetX, p.gazeY - this.lastGazeTargetY);
          if (gazeDelta > 0.28) {
            this.eyeEngine.blinkEngine.triggerSaccadeBlink(gazeDelta);
          }
          this.lastGazeTargetX = p.gazeX;
          this.lastGazeTargetY = p.gazeY;

          const emotions = this.emotionEngine.update(deltaSeconds);
          if (emotions.mouthSmileLeft > 0) {
            this.extraShapeWeights['mouthSmileLeft'] = emotions.mouthSmileLeft;
            this.extraShapeWeights['mouthSmileRight'] = emotions.mouthSmileRight;
            this.extraShapeWeights['eyeSquintLeft'] = emotions.eyeSquintLeft;
            this.extraShapeWeights['eyeSquintRight'] = emotions.eyeSquintRight;
          }
        }

        // El movimiento automático se suma al manual con control elástico (Fase 2)
        const manualYaw = this.manualChannels?.headYaw ?? 0;
        const manualPitch = this.manualChannels?.headPitch ?? 0;
        const manualRoll = this.manualChannels?.headRoll ?? 0;

        this.animationState.setTarget('headYaw', (autoYaw + manualYaw) * this.layerGains.pose);
        this.animationState.setTarget('headPitch', (autoPitch + manualPitch) * this.layerGains.pose);
        this.animationState.setTarget('headRoll', (autoRoll + manualRoll) * this.layerGains.pose);

        // Extra shapes del rig (blendshapes)
        for (const k in dOut.extraShapes) {
          this.extraShapeWeights[k] = dOut.extraShapes[k]!;
        }

        // Overrides manuales si existen
        if (this.manualVisemes) {
          if (this.manualVisemes.jawOpen !== undefined) this.animationState.setTarget('jawOpen', this.manualVisemes.jawOpen);
          if (this.manualVisemes.mouthRound !== undefined) this.animationState.setTarget('mouthRound', this.manualVisemes.mouthRound);
          if (this.manualVisemes.mouthWide !== undefined) this.animationState.setTarget('mouthWide', this.manualVisemes.mouthWide);
          if (this.manualVisemes.smile !== undefined) this.animationState.setTarget('smile', this.manualVisemes.smile);
        }
        if (this.manualChannels) {
          if (this.manualChannels.jawOpen !== undefined) this.animationState.setTarget('jawOpen', this.manualChannels.jawOpen);
          if (this.manualChannels.mouthRound !== undefined) this.animationState.setTarget('mouthRound', this.manualChannels.mouthRound);
          if (this.manualChannels.mouthWide !== undefined) this.animationState.setTarget('mouthWide', this.manualChannels.mouthWide);
          if (this.manualChannels.smile !== undefined) this.animationState.setTarget('smile', this.manualChannels.smile);
          if (this.manualChannels.browRaise !== undefined) this.animationState.setTarget('browRaise', this.manualChannels.browRaise);
          if (this.manualChannels.blink !== undefined) {
            this.animationState.setTarget('blink', this.manualChannels.blink);
            this.animationState.setTarget('blinkLeft', this.manualChannels.blinkLeft ?? this.manualChannels.blink);
            this.animationState.setTarget('blinkRight', this.manualChannels.blinkRight ?? this.manualChannels.blink);
          } else {
            if (this.manualChannels.blinkLeft !== undefined) this.animationState.setTarget('blinkLeft', this.manualChannels.blinkLeft);
            if (this.manualChannels.blinkRight !== undefined) this.animationState.setTarget('blinkRight', this.manualChannels.blinkRight);
          }
          if (this.manualChannels.gazeX !== undefined) this.animationState.setTarget('gazeX', this.manualChannels.gazeX);
          if (this.manualChannels.gazeY !== undefined) this.animationState.setTarget('gazeY', this.manualChannels.gazeY);
          if (this.manualChannels.breath !== undefined) this.animationState.setTarget('breath', this.manualChannels.breath);
        }
      } else {
        // En V1 legacy: mantener comportamiento previo
        let jawTarget = 0;
        let roundTarget = 0;
        let wideTarget = 0;

        if (this.manualChannels && this.manualChannels.jawOpen !== undefined) {
          jawTarget = this.manualChannels.jawOpen;
          roundTarget = this.manualChannels.mouthRound ?? 0;
          wideTarget = this.manualChannels.mouthWide ?? 0;
        } else if (this.manualVisemes && this.manualVisemes.jawOpen !== undefined) {
          jawTarget = this.manualVisemes.jawOpen;
          roundTarget = this.manualVisemes.mouthRound ?? 0;
          wideTarget = this.manualVisemes.mouthWide ?? 0;
        } else if (visemes.jawOpen > 0.005) {
          jawTarget = visemes.jawOpen;
          roundTarget = visemes.mouthRound;
          wideTarget = visemes.mouthWide;
        } else if (this.currentMood === 'speaking') {
          const cadence = Math.max(0, Math.sin(now * 0.007) * 0.22);
          jawTarget = cadence;
        }

        this.animationState.setTarget('jawOpen', jawTarget * this.layerGains.lips);

        if (this.manualChannels && this.manualChannels.mouthRound !== undefined) {
          this.animationState.setTarget('mouthRound', this.manualChannels.mouthRound * this.layerGains.lips);
        } else if (this.manualVisemes && this.manualVisemes.mouthRound !== undefined) {
          this.animationState.setTarget('mouthRound', this.manualVisemes.mouthRound * this.layerGains.lips);
        } else {
          this.animationState.setTarget('mouthRound', roundTarget * this.layerGains.lips);
        }

        if (this.manualChannels && this.manualChannels.mouthWide !== undefined) {
          this.animationState.setTarget('mouthWide', this.manualChannels.mouthWide * this.layerGains.lips);
        } else if (this.manualVisemes && this.manualVisemes.mouthWide !== undefined) {
          this.animationState.setTarget('mouthWide', this.manualVisemes.mouthWide * this.layerGains.lips);
        } else {
          this.animationState.setTarget('mouthWide', wideTarget * this.layerGains.lips);
        }

        this.idleBehavior.update(deltaSeconds, this.currentMood);

        if (this.manualChannels) {
          if (this.manualChannels.smile !== undefined) {
            this.animationState.setTarget('smile', this.manualChannels.smile * this.layerGains.expression);
          }
          if (this.manualChannels.browRaise !== undefined) {
            this.animationState.setTarget('browRaise', this.manualChannels.browRaise * this.layerGains.expression);
          }
          if (this.manualChannels.blink !== undefined) {
            this.animationState.setTarget('blink', this.manualChannels.blink);
            this.animationState.setTarget('blinkLeft', this.manualChannels.blinkLeft ?? this.manualChannels.blink);
            this.animationState.setTarget('blinkRight', this.manualChannels.blinkRight ?? this.manualChannels.blink);
          } else {
            if (this.manualChannels.blinkLeft !== undefined) {
              this.animationState.setTarget('blinkLeft', this.manualChannels.blinkLeft);
            }
            if (this.manualChannels.blinkRight !== undefined) {
              this.animationState.setTarget('blinkRight', this.manualChannels.blinkRight);
            }
          }
          if (this.manualChannels.gazeX !== undefined) {
            this.animationState.setTarget('gazeX', this.manualChannels.gazeX * this.layerGains.pose);
          }
          if (this.manualChannels.gazeY !== undefined) {
            this.animationState.setTarget('gazeY', this.manualChannels.gazeY * this.layerGains.pose);
          }
          if (this.manualChannels.headYaw !== undefined) {
            this.animationState.setTarget('headYaw', this.manualChannels.headYaw * this.layerGains.pose);
          }
          if (this.manualChannels.headPitch !== undefined) {
            this.animationState.setTarget('headPitch', this.manualChannels.headPitch * this.layerGains.pose);
          }
          if (this.manualChannels.headRoll !== undefined) {
            this.animationState.setTarget('headRoll', this.manualChannels.headRoll * this.layerGains.pose);
          }
          if (this.manualChannels.breath !== undefined) {
            this.animationState.setTarget('breath', this.manualChannels.breath * this.layerGains.pose);
          }
        } else {
          if (this.manualVisemes?.smile !== undefined) {
            this.animationState.setTarget('smile', this.manualVisemes.smile * this.layerGains.expression);
          } else if (visemes.smile > 0.02) {
            this.animationState.setTarget('smile', visemes.smile * this.layerGains.expression);
          }
        }
      }

      this.animationState.update(deltaSeconds);
      const t2 = performance.now();
      const directorDynamicsMs = t2 - t1;

      // --- MÓDULO 3: Rig Apply (Morphing & Deformación) ---
      this.poseDeformer.apply(
        this.meshData.currentPositions,
        this.animationState.current,
        this.extraShapeWeights
      );
      const t3 = performance.now();
      const rigApplyMs = t3 - t2;

      // --- MÓDULO 4: Overlays, Boca Interior & Shading ---
      const tongueElevation = this.extraShapeWeights['tongueElevation'] ?? 0;
      const tongueProtrusion = this.extraShapeWeights['tongueProtrusion'] ?? 0;
      if (this.rigVersion === 'v4' && this.mouth3d) {
        this.mouth3d.update(
          this.meshData.currentPositions,
          this.animationState.current.jawOpen,
          this.meshData.faceScale,
          tongueElevation,
          tongueProtrusion,
          this.jawBone?.getRotationAngle() ?? 0
        );
      } else {
        this.mouthInterior.update(
          this.meshData.currentPositions,
          this.animationState.current.jawOpen,
          this.meshData.faceScale,
          tongueElevation,
          tongueProtrusion
        );
      }

      // Párpados y mirada gestionados 100% sobre la malla nativa en poseDeformer.apply
      this.pseudoVolumeShading.update(
        this.meshData.currentPositions,
        this.animationState.current.headYaw,
        this.animationState.current.headPitch
      );

      const posAttr = this.faceGeometry.attributes.position;
      if (posAttr) {
        posAttr.needsUpdate = true;
      }
      const t4 = performance.now();
      const overlaysShadingMs = t4 - t3;
      const totalJsMs = t4 - t0;

      // Acumulación de métricas de rendimiento
      this.perfAccumulator.prosodyVisemesMs += prosodyVisemesMs;
      this.perfAccumulator.directorDynamicsMs += directorDynamicsMs;
      this.perfAccumulator.rigApplyMs += rigApplyMs;
      this.perfAccumulator.overlaysShadingMs += overlaysShadingMs;
      this.perfAccumulator.totalJsMs += totalJsMs;
      this.perfFrameCounter++;
      this.perfIntervalAccumulator += deltaMs;

      // Histograma exponencial suave de jawOpen
      const curJaw = this.animationState.current.jawOpen;
      let binIdx = 0;
      if (curJaw < 0.05) binIdx = 0;
      else if (curJaw < 0.15) binIdx = 1;
      else if (curJaw < 0.35) binIdx = 2;
      else if (curJaw < 0.65) binIdx = 3;
      else binIdx = 4;

      for (let b = 0; b < 5; b++) {
        this.jawOpenHistogramBins[b] =
          this.jawOpenHistogramBins[b]! * 0.992 + (b === binIdx ? 0.008 : 0);
      }

      // RMS de movimiento de cabeza
      const yaw = this.animationState.current.headYaw;
      const pitch = this.animationState.current.headPitch;
      const roll = this.animationState.current.headRoll;
      this.headSquaresWindow[this.headWindowIndex] = (yaw * yaw + pitch * pitch + roll * roll) / 3;
      this.headWindowIndex = (this.headWindowIndex + 1) % this.headSquaresWindow.length;

      // Emisión de métricas periódica (cada 200 ms)
      if (this.perfIntervalAccumulator >= 200) {
        const count = Math.max(1, this.perfFrameCounter);
        this.metricsData.perf.prosodyVisemesMs = Number((this.perfAccumulator.prosodyVisemesMs / count).toFixed(3));
        this.metricsData.perf.directorDynamicsMs = Number((this.perfAccumulator.directorDynamicsMs / count).toFixed(3));
        this.metricsData.perf.rigApplyMs = Number((this.perfAccumulator.rigApplyMs / count).toFixed(3));
        this.metricsData.perf.overlaysShadingMs = Number((this.perfAccumulator.overlaysShadingMs / count).toFixed(3));
        this.metricsData.perf.totalJsMs = Number((this.perfAccumulator.totalJsMs / count).toFixed(3));

        this.metricsData.fps = this.currentFps;
        this.metricsData.currentJawOpen = Number(curJaw.toFixed(3));
        this.metricsData.currentYaw = Number(yaw.toFixed(4));
        this.metricsData.currentPitch = Number(pitch.toFixed(4));
        this.metricsData.currentRoll = Number(roll.toFixed(4));
        this.metricsData.currentBlink = Number((this.animationState.current.blink ?? 0).toFixed(3));
        this.metricsData.rigVersion = this.rigVersion;
        this.metricsData.currentEmotionName = this.director.emotion.currentEmotionName;
        this.metricsData.currentValence = Number(this.director.emotion.current.valence.toFixed(2));
        this.metricsData.currentArousal = Number(this.director.emotion.current.arousal.toFixed(2));

        let histSum = 0;
        for (let b = 0; b < 5; b++) histSum += this.jawOpenHistogramBins[b]!;
        for (let b = 0; b < 5; b++) {
          this.metricsData.jawOpenHistogram[b] = Math.round((this.jawOpenHistogramBins[b]! / (histSum || 1)) * 100);
        }

        const tCutoff = now - 60000;
        let validBlinks = 0;
        for (let i = 0; i < this.blinkTimestampCount; i++) {
          if (this.blinkTimestamps[i]! >= tCutoff) validBlinks++;
        }
        this.metricsData.blinksPerMinute = validBlinks;

        let sumSq = 0;
        for (let i = 0; i < this.headSquaresWindow.length; i++) {
          sumSq += this.headSquaresWindow[i]!;
        }
        this.metricsData.headMovementRms = Number(Math.sqrt(sumSq / this.headSquaresWindow.length).toFixed(4));

        this.onMetricsUpdate?.(this.metricsData);

        this.perfAccumulator.prosodyVisemesMs = 0;
        this.perfAccumulator.directorDynamicsMs = 0;
        this.perfAccumulator.rigApplyMs = 0;
        this.perfAccumulator.overlaysShadingMs = 0;
        this.perfAccumulator.totalJsMs = 0;
        this.perfFrameCounter = 0;
        this.perfIntervalAccumulator = 0;
      }

      // Cálculo de FPS
      this.frameCount++;
      this.fpsAccumulator += deltaMs;
      if (this.fpsAccumulator >= 1000) {
        this.currentFps = Math.round((this.frameCount * 1000) / this.fpsAccumulator);
        if (this.onFpsUpdate) {
          this.onFpsUpdate(this.currentFps);
        }
        this.frameCount = 0;
        this.fpsAccumulator = 0;
      }

      // Renderizar escena
      this.renderer.render(this.scene, this.camera);

      this.animationFrameId = requestAnimationFrame(renderFrame);
    };

    this.animationFrameId = requestAnimationFrame(renderFrame);
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }

    // Limpiar geometrías y materiales
    this.mouthInterior.destroy();
    this.scene.remove(this.mouthInterior.mesh);
    if (this.mouth3d) {
      this.mouth3d.destroy();
      this.scene.remove(this.mouth3d.rootGroup);
    }
    this.eyelidOverlay.destroy();
    this.scene.remove(this.eyelidOverlay.mesh);
    this.eyeEngine.destroy();
    this.scene.remove(this.eyeEngine.eyelidMesh.mesh);
    this.lipsyncAnalyzer.reset();

    this.faceGeometry.dispose();
    this.faceMaterial.dispose();
    this.texture.dispose();

    if (this.wireframeMesh) {
      this.wireframeMesh.geometry.dispose();
      (this.wireframeMesh.material as THREE.Material).dispose();
    }

    if (this.debugPoints) {
      this.debugPoints.geometry.dispose();
      (this.debugPoints.material as THREE.Material).dispose();
    }

    this.renderer.dispose();
  }
}
