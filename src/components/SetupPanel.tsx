import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload,
  User,
  Key,
  Volume2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Trash2,
  Cpu,
  Info,
  RefreshCw,
} from 'lucide-react';
import { useSessionStore } from '@/store/session';
import { VOICES_MAP, ALL_VOICES_METADATA } from '@/core/live/voices';
import {
  MAX_IMAGE_FILE_SIZE_BYTES,
  ACCEPTED_IMAGE_MIME_TYPES,
  ACCEPTED_IMAGE_EXTENSIONS,
  SUPPORTED_MODELS,
  MIN_FACE_IMAGE_DIMENSION,
} from '@/lib/constants';
import { detectFaceInImage } from '@/core/face/detectFace';

export const SetupPanel: React.FC = () => {
  const {
    characterName,
    apiKey,
    voiceGender,
    voiceName,
    modelName,
    hasVisitedAvatar,
    imageUrl,
    detectionStatus,
    detectionError,
    faceLandmarks,
    setCharacterName,
    setApiKey,
    setVoiceGender,
    setVoiceName,
    setModelName,
    setHasPermission,
    setImage,
    setDetectionStatus,
    setFaceLandmarks,
    setFacialTransformationMatrix,
    setStage,
    clearAll,
  } = useSessionStore();

  const [showApiKey, setShowApiKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [localFileError, setLocalFileError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasPreviewRef = useRef<HTMLCanvasElement>(null);
  const imageObjRef = useRef<HTMLImageElement | null>(null);

  // Dibuja la imagen y la malla sobre el canvas cuando los landmarks están disponibles
  const drawMeshPreview = useCallback(() => {
    const canvas = canvasPreviewRef.current;
    const img = imageObjRef.current;
    if (!canvas || !img || !img.complete || img.naturalWidth === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Ajustar dimensiones del canvas preservando aspect ratio
    const maxWidth = 340;
    const scale = Math.min(1, maxWidth / img.naturalWidth);
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);

    // Dibujar imagen base
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Si hay landmarks, dibujar puntos de la malla facial
    if (faceLandmarks && faceLandmarks.length > 0) {
      ctx.fillStyle = 'rgba(6, 182, 212, 0.75)'; // Cyan brillante
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.3)';
      ctx.lineWidth = 0.5;

      const pointRadius = Math.max(1, canvas.width / 220);

      for (let i = 0; i < faceLandmarks.length; i++) {
        const pt = faceLandmarks[i];
        if (!pt) continue;
        const px = pt.x * canvas.width;
        const py = pt.y * canvas.height;

        ctx.beginPath();
        ctx.arc(px, py, pointRadius, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }, [faceLandmarks]);

  // Asegura que si imageUrl ya existe en el store (ej. tras volver de /avatar o montaje),
  // se instancie el ImageElement correspondiente y no quede vacío
  useEffect(() => {
    if (!imageUrl) {
      imageObjRef.current = null;
      return;
    }
    if (imageObjRef.current && imageObjRef.current.src === imageUrl) {
      drawMeshPreview();
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageObjRef.current = img;
      drawMeshPreview();
    };
    img.src = imageUrl;
  }, [imageUrl, drawMeshPreview]);

  useEffect(() => {
    drawMeshPreview();
  }, [drawMeshPreview]);

  // Manejo de carga y análisis de archivo de imagen
  const processImageFile = async (file: File) => {
    setLocalFileError(null);

    // 1. Validar extensión y MIME
    const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
    const isValidMime = ACCEPTED_IMAGE_MIME_TYPES.includes(file.type);
    const isValidExt = ACCEPTED_IMAGE_EXTENSIONS.includes(ext);

    if (!isValidMime && !isValidExt) {
      setLocalFileError(
        'Formato no compatible. Por favor sube una imagen en formato PNG, JPG o JPEG.'
      );
      return;
    }

    // 2. Validar tamaño máximo de 8 MB
    if (file.size > MAX_IMAGE_FILE_SIZE_BYTES) {
      const mbSize = (file.size / (1024 * 1024)).toFixed(1);
      setLocalFileError(
        `El archivo es demasiado grande (${mbSize} MB). El tamaño máximo permitido es 8 MB.`
      );
      return;
    }

    const objectUrl = URL.createObjectURL(file);

    // Crear elemento Image para verificar dimensiones y ejecutar FaceLandmarker
    const img = new Image();
    img.crossOrigin = 'anonymous';

    setDetectionStatus('loading_model');

    img.onload = async () => {
      imageObjRef.current = img;
      setImage(file, objectUrl, {
        width: img.naturalWidth,
        height: img.naturalHeight,
      });

      if (
        img.naturalWidth < MIN_FACE_IMAGE_DIMENSION ||
        img.naturalHeight < MIN_FACE_IMAGE_DIMENSION
      ) {
        setDetectionStatus(
          'error',
          `La foto es demasiado pequeña (${img.naturalWidth}x${img.naturalHeight} px). Se requiere mínimo ${MIN_FACE_IMAGE_DIMENSION}x${MIN_FACE_IMAGE_DIMENSION} px.`
        );
        return;
      }

      setDetectionStatus('processing');
      try {
        const result = await detectFaceInImage(img);
        setFaceLandmarks(result.landmarks);
        setFacialTransformationMatrix(result.facialTransformationMatrix ?? null);
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : 'Error desconocido al procesar el rostro.';
        setDetectionStatus('error', message);
      }
    };

    img.onerror = () => {
      setLocalFileError('No se pudo decodificar el archivo de imagen seleccionado.');
      setDetectionStatus('idle');
    };

    img.src = objectUrl;
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0]) {
      processImageFile(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0 && files[0]) {
      processImageFile(files[0]);
    }
  };

  // Validaciones de formulario
  // El botón para ver el avatar animado requiere: fotografía con rostro detectado, nombre del personaje y API key
  const isNameValid = characterName.trim().length > 0;
  const isApiKeyValid = apiKey.trim().length > 0;
  const isFaceDetected = detectionStatus === 'success' && faceLandmarks !== null;
  const canStart = isFaceDetected && isNameValid && isApiKeyValid;

  const handleStart = () => {
    if (!canStart) return;
    setStage('avatar');
  };

  return (
    <div className="max-w-4xl mx-auto w-full px-4 pt-1 pb-6">
      {/* Encabezado del Setup */}
      <div className="text-center mb-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
          Configura tu Avatar en <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400">YourSelf</span>
        </h1>
        <p className="text-slate-400 text-xs sm:text-sm mt-1 max-w-xl mx-auto">
          Sube un retrato fotográfico y dale vida mediante voz en tiempo real con Gemini Live y animación local WebGL.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
        {/* Columna Izquierda: Foto y Malla (5 cols) */}
        <div className="md:col-span-5 bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl backdrop-blur-md">
          <label className="block text-sm font-semibold text-slate-200 mb-1.5">
            1. Fotografía del Rostro
          </label>
          <p className="text-xs text-slate-400 mb-3">
            Formatos PNG, JPG o JPEG (máx. 8 MB). El procesamiento es 100% local en tu navegador.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,image/png,image/jpeg"
            onChange={handleFileChange}
            className="hidden"
          />

          {!imageUrl ? (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center min-h-[260px] ${
                dragOver
                  ? 'border-indigo-400 bg-indigo-950/30'
                  : 'border-slate-700 hover:border-slate-500 bg-slate-950/40'
              }`}
            >
              <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 mb-3 shadow-inner">
                <Upload className="w-6 h-6 text-indigo-400" />
              </div>
              <p className="text-sm font-medium text-slate-200">
                Arrastra tu foto aquí o haz clic para explorar
              </p>
              <p className="text-xs text-slate-500 mt-1">PNG, JPG, JPEG hasta 8 MB</p>
            </div>
          ) : hasVisitedAvatar ? (
            /* Cuando ya subió su imagen y vuelve a ajustes: foto con blur y botón Reemplazar en el medio */
            <div className="space-y-2">
              <div className="relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center min-h-[260px] max-h-[340px]">
                <img
                  src={imageUrl}
                  alt="Rostro del Avatar"
                  className="max-h-[300px] w-auto object-contain rounded-lg filter blur-[4px] brightness-75 scale-[1.01] transition-all"
                />

                {/* Botón en medio de la imagen para reemplazar */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-xl flex items-center gap-2 border border-indigo-400/40 transition-all hover:scale-105 active:scale-95 cursor-pointer backdrop-blur-xs"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Reemplazar</span>
                  </button>
                </div>
              </div>

              {isFaceDetected && (
                <div className="flex justify-end pt-1">
                  <span className="text-[11px] text-emerald-400 flex items-center gap-1 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 478 puntos alineados
                  </span>
                </div>
              )}
            </div>
          ) : (
            /* Al seleccionar la imagen: muestra los puntos de la malla en el recuadro */
            <div className="space-y-2">
              <div className="relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center min-h-[260px] group">
                <canvas
                  ref={canvasPreviewRef}
                  className="max-h-[300px] w-auto object-contain rounded-lg shadow-md"
                />

                {/* Botón Reemplazar en hover por si desea cambiarla */}
                {detectionStatus === 'success' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-4 py-2 rounded-xl bg-indigo-600/90 hover:bg-indigo-500 text-white font-semibold text-xs shadow-xl flex items-center gap-2 border border-indigo-400/30 transition-all hover:scale-105 active:scale-95 cursor-pointer backdrop-blur-xs"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>Reemplazar</span>
                    </button>
                  </div>
                )}

                {/* Overlays de Estado de Detección */}
                {(detectionStatus === 'loading_model' || detectionStatus === 'processing') && (
                  <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xs flex flex-col items-center justify-center text-center p-4">
                    <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3"></div>
                    <p className="text-sm font-medium text-indigo-300">
                      {detectionStatus === 'loading_model'
                        ? 'Cargando FaceLandmarker local...'
                        : 'Analizando geometría facial...'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">Calculando 478 puntos de malla</p>
                  </div>
                )}
              </div>

              {isFaceDetected && (
                <div className="flex justify-end pt-1">
                  <span className="text-[11px] text-emerald-400 flex items-center gap-1 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 478 puntos alineados
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Errores de archivo o detección */}
          {localFileError && (
            <div className="mt-3 p-3 rounded-lg bg-rose-950/50 border border-rose-800/80 text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{localFileError}</span>
            </div>
          )}

          {detectionStatus === 'error' && detectionError && (
            <div className="mt-3 p-3 rounded-lg bg-rose-950/50 border border-rose-800/80 text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{detectionError}</span>
            </div>
          )}
        </div>

        {/* Columna Derecha: Parámetros del Personaje y Conexión (7 cols) */}
        <div className="md:col-span-7 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-md space-y-5">
          {/* Nombre del Personaje */}
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1.5 flex items-center gap-1.5">
              <User className="w-4 h-4 text-indigo-400" />
              <span>2. Nombre del Personaje</span>
            </label>
            <input
              type="text"
              value={characterName}
              onChange={(e) => setCharacterName(e.target.value)}
              placeholder="ej. Lucas, Sophie, Elena, Marco..."
              maxLength={40}
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm"
            />
            {characterName.trim().length === 0 && (
              <p className="text-[11px] text-slate-500 mt-1">
                El avatar adoptará este nombre en su personalidad al hablar.
              </p>
            )}
          </div>

          {/* API Key de Gemini */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
                <Key className="w-4 h-4 text-indigo-400" />
                <span>3. Gemini API Key</span>
              </label>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors inline-flex items-center gap-1"
              >
                <span>Obtener clave gratis</span>
                <Info className="w-3 h-3" />
              </a>
            </div>

            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value.trim())}
                placeholder="AIzaSy..."
                autoComplete="off"
                spellCheck="false"
                className="w-full pl-3.5 pr-10 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                title={showApiKey ? 'Ocultar clave' : 'Mostrar clave'}
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
              <Info className="w-3 h-3 shrink-0 text-slate-500" />
              <span>
                Vive solo en memoria / sesión activa. Jamás en logs ni en servidores intermediarios.
              </span>
            </p>
          </div>

          {/* Selector de Voz: Mujer / Hombre */}
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1.5 flex items-center gap-1.5">
              <Volume2 className="w-4 h-4 text-indigo-400" />
              <span>4. Voz del Avatar</span>
            </label>

            {/* Toggle Mujer / Hombre */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setVoiceGender('mujer')}
                className={`py-2 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                  voiceGender === 'mujer'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                Voz Mujer
              </button>
              <button
                type="button"
                onClick={() => setVoiceGender('hombre')}
                className={`py-2 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                  voiceGender === 'hombre'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                Voz Hombre
              </button>
            </div>

            {/* Variantes de voz disponibles para el género */}
            <div className="grid grid-cols-2 gap-2 mt-2">
              {VOICES_MAP[voiceGender].map((v) => {
                const meta = ALL_VOICES_METADATA[v];
                const isSelected = voiceName === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVoiceName(v)}
                    className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-950/40 text-indigo-200'
                        : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-bold text-white flex items-center justify-between">
                      <span>{v}</span>
                      {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">
                      {meta?.styleDescription || 'Estilo de voz HD'}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Configuración Avanzada (Desplegable) */}
          <div className="border-t border-slate-800 pt-3">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between text-xs text-slate-400 hover:text-slate-200 transition-colors py-1 cursor-pointer"
            >
              <span className="flex items-center gap-1.5 font-medium">
                <Cpu className="w-3.5 h-3.5 text-slate-500" />
                Configuración avanzada de modelo
              </span>
              {showAdvanced ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>

            {showAdvanced && (
              <div className="mt-2.5 p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-2">
                <label className="block text-[11px] font-medium text-slate-300">
                  Modelo Gemini Live (VITE_GEMINI_LIVE_MODEL)
                </label>
                <div className="flex gap-2">
                  <select
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-slate-200 focus:outline-hidden focus:border-indigo-500"
                  >
                    {SUPPORTED_MODELS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-[10px] text-slate-500">
                  Si tu cuenta o región no tiene acceso a un modelo específico, puedes alternar o
                  especificar otro identificador compatible aquí.
                </p>
              </div>
            )}
          </div>

          
          {/* Botones de Acción */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              disabled={!canStart}
              onClick={handleStart}
              className={`flex-1 py-3 px-4 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg ${
                canStart
                  ? 'bg-gradient-to-r from-indigo-500 via-indigo-600 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white cursor-pointer shadow-indigo-500/25 active:scale-[0.99]'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-70'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>Ver Avatar Animado (Comenzar)</span>
            </button>

            <button
              type="button"
              onClick={clearAll}
              title="Borrar todo y restablecer estado"
              className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 hover:text-rose-400 hover:border-rose-900/50 transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          {/* Resumen de Validaciones Pendientes si el botón está deshabilitado */}
          {!canStart && (
            <p className="text-[11px] text-slate-500 text-center pt-1">
              {!isFaceDetected
                ? 'Sube una fotografía con un rostro visible para comenzar'
                : !isNameValid
                  ? 'Introduce el nombre del personaje para continuar'
                  : 'Ingresa tu Gemini API Key para comenzar'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
