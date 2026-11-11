/**
 * detectFace.ts
 * Inicialización y ejecución local de MediaPipe FaceLandmarker en modo IMAGE.
 * Sin CDNs en tiempo de ejecución: consume /mediapipe/... directamente.
 */

import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import { FaceLandmarkPoint, DetectionResult } from '@/lib/types';
import { MIN_FACE_IMAGE_DIMENSION } from '@/lib/constants';

let faceLandmarkerInstance: FaceLandmarker | null = null;
let initPromise: Promise<FaceLandmarker> | null = null;

export async function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (faceLandmarkerInstance) {
    return faceLandmarkerInstance;
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      // Carga Wasm local desde /public/mediapipe
      const vision = await FilesetResolver.forVisionTasks('/mediapipe');

      const landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/mediapipe/face_landmarker.task',
          delegate: 'CPU', // Seguro y universal sin requerir WebGL compute
        },
        runningMode: 'IMAGE',
        numFaces: 1, // Solo permitimos un rostro
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });

      faceLandmarkerInstance = landmarker;
      return landmarker;
    } catch (err) {
      console.error('Error al inicializar FaceLandmarker:', err);
      initPromise = null;
      throw new Error(
        'No se pudo inicializar el modelo facial local. Verifica que los archivos WASM y el modelo existan en /public/mediapipe/.'
      );
    }
  })();

  return initPromise;
}

/**
 * Procesa un elemento <img> cargado y retorna los 478 landmarks normalizados
 * o lanza un error descriptivo si la imagen no cumple los requisitos.
 */
export async function detectFaceInImage(
  imageElement: HTMLImageElement
): Promise<DetectionResult> {
  const width = imageElement.naturalWidth || imageElement.width;
  const height = imageElement.naturalHeight || imageElement.height;

  // 1. Validación de resolución mínima
  if (width < MIN_FACE_IMAGE_DIMENSION || height < MIN_FACE_IMAGE_DIMENSION) {
    throw new Error(
      `La imagen es demasiado pequeña (${width}x${height} px). Sube una foto de al menos ${MIN_FACE_IMAGE_DIMENSION}x${MIN_FACE_IMAGE_DIMENSION} px.`
    );
  }

  // 2. Obtener el landmarker
  const landmarker = await getFaceLandmarker();

  // 3. Ejecutar detección
  const result = landmarker.detect(imageElement);

  if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
    throw new Error(
      'No se detectó ningún rostro en la imagen. Por favor, sube una foto frontal bien iluminada.'
    );
  }

  if (result.faceLandmarks.length > 1) {
    throw new Error(
      'Se detectaron múltiples rostros en la foto. Sube una imagen que contenga un único rostro.'
    );
  }

  const rawLandmarks = result.faceLandmarks[0];
  if (!rawLandmarks || rawLandmarks.length < 468) {
    throw new Error(
      'La detección facial no pudo identificar suficientes puntos característicos del rostro.'
    );
  }

  // Convertir a formato de puntos de nuestro dominio
  const landmarks: FaceLandmarkPoint[] = rawLandmarks.map((pt) => ({
    x: pt.x,
    y: pt.y,
    z: pt.z,
  }));

  // Extraer matriz 4x4 y blendshapes si MediaPipe los generó
  const matrix = result.facialTransformationMatrixes?.[0]?.data
    ? Array.from(result.facialTransformationMatrixes[0].data)
    : undefined;

  const blendshapes = result.faceBlendshapes?.[0]?.categories
    ? result.faceBlendshapes[0].categories.map((c) => ({
        categoryName: c.categoryName,
        score: c.score,
      }))
    : undefined;

  return {
    landmarks,
    imageWidth: width,
    imageHeight: height,
    facialTransformationMatrix: matrix,
    faceBlendshapes: blendshapes,
  };
}
