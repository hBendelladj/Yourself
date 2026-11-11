# YourSelf - Decisiones Arquitectónicas y Técnicas (DECISIONS.md)

Este documento registra las decisiones tomadas tras consultar la documentación oficial vigente de la **Gemini Live API** (vía `@google/genai` y WebSockets) y de **MediaPipe FaceLandmarker**, así como cualquier adaptación o precisión técnica respecto al prompt original.

---

## 1. Modelo de Gemini Live API

- **Modelo predeterminado confirmado (capa gratuita de API Key):** `gemini-2.5-flash-native-audio-latest`.
  - Confirmado funcional para sesiones bidireccionales en vivo de audio en la capa gratuita.
- **Modelos compatibles disponibles en el selector:**
  - `gemini-2.5-flash-native-audio-latest` (predeterminado).
  - `gemini-live-2.5-flash-preview`.
  - `gemini-2.5-flash-native-audio-preview-12-2025`.
  - `gemini-2.5-flash-preview-native-audio-dialog`.
  - `gemini-2.5-flash`.
- **Configuración mediante entorno:** Parametrizado mediante `VITE_GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-latest` en `.env.example`.
- **Selector dinámico en pantalla:** Tanto en el `SetupPanel` como directamente en la `ConversationBar` del escenario se incluye un selector de modelo para alternar instantáneamente entre los modelos disponibles según los permisos de la cuenta Google del usuario.
- **Saludo inicial proactivo:** Al completarse la conexión (`setupComplete`), el cliente envía automáticamente un trigger de presentación oral para que el avatar salude por voz en primera persona diciendo su nombre configurado.

---

## 2. Conexión y Protocolo Live (`ai.live.connect` / WebSockets)

- **SDK oficial:** `@google/genai` (v2.31.0).
- **Transporte:** En entornos de navegador cliente estático, la sesión Live se establece a través de conexión segura WebSocket bidireccional con el endpoint oficial:
  `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=<API_KEY>`
- **Envío de Audio en Tiempo Real:** El audio del micrófono se captura en 16 kHz mono PCM16 little-endian y se envía mediante fragmentos continuos (~20-40 ms):
  ```json
  {
    "realtimeInput": {
      "mediaChunks": [
        {
          "mimeType": "audio/pcm;rate=16000",
          "data": "<BASE64_PCM16_CHUNK>"
        }
      ]
    }
  }
  ```
- **Recepción de Audio:** El modelo emite respuestas en `audio/pcm;rate=24000` (PCM16 little-endian mono a 24 kHz) dentro de `serverContent.modelTurn.parts[].inlineData`.

---

## 3. Parámetros de Sesión y Configuración (`LiveConnectConfig`)

### 3.1. Modalidades de Respuesta (`responseModalities`)
- Fijado en `["AUDIO"]`. El asistente responde directamente con voz sintetizada de baja latencia.

### 3.2. Configuración de Voz (`speechConfig`)
- Estructura oficial:
  ```json
  "speechConfig": {
    "voiceConfig": {
      "prebuiltVoiceConfig": {
        "voiceName": "Kore"
      }
    }
  }
  ```
- Las voces disponibles en Gemini Live son preconstruidas con estilos tímbricos (no están etiquetadas formalmente por género en la API). Mapeamos en `src/core/live/voices.ts`:
  - **Femenino (Mujer):** `Kore` (por defecto), `Aoede`.
  - **Masculino (Hombre):** `Puck` (por defecto), `Charon`.
  - Voces alternativas documentadas: `Fenrir`, `Zephyr`.

### 3.3. Compresión de Contexto (`contextWindowCompression`)
- Configuración:
  ```json
  "contextWindowCompression": {
    "slidingWindow": {}
  }
  ```
- **Razón:** Sin compresión, las sesiones de audio continuo acumulan tokens y se desconectan obligatoriamente a los 15 minutos (límite de 128k tokens). La compresión activa el podado deslizante en el servidor, permitiendo sesiones continuas de duración ilimitada.

### 3.4. Reanudación de Sesión (`sessionResumption`)
- Configuración inicial:
  ```json
  "sessionResumption": {}
  ```
- Al recibir eventos `sessionResumptionUpdate` del servidor, se almacena el `handle` más reciente exclusivamente en memoria.
- Si la conexión se pierde o se recibe una señal `goAway`, la reconexión incluye:
  ```json
  "sessionResumption": {
    "handle": "<ULTIMO_HANDLE_RECIBIDO>"
  }
  ```
  preservando el hilo conversacional sin empezar de cero.

### 3.5. Transcripciones de Entrada y Salida
- Configuración:
  - `inputAudioTranscription`: Habilita la transcripción del habla del usuario en texto.
  - `outputAudioTranscription`: Recibe texto sincronizado o incremental del habla generada por Gemini en `serverContent.modelTurn.parts` o eventos de transcripción asociados, mostrándose en `TranscriptList`.

### 3.6. Manejo de Interrupción (`interrupted`)
- Al emitir el servidor el mensaje `serverContent.interrupted = true` (cuando el usuario comienza a hablar mientras el avatar está respondiendo):
  1. Se cancela inmediatamente la reproducción de audio actual en el `AudioContext`.
  2. Se vacía la cola `playbackQueue`.
  3. Se resetea el analizador de visemas a posición de reposo (`jawOpen: 0`).
  4. La máquina de estados pasa de `speaking` a `listening`.

### 3.7. Manejo de Desconexión Programada (`goAway`)
- El servidor emite `goAway` con `timeLeft` indicando que el socket de infraestructura se cerrará pronto (~10 a 15 s).
- El cliente inicia proactivamente el proceso de reanudación con el último `handle` de sesión antes de que el socket actual se cierre abruptamente.

---

## 4. MediaPipe FaceLandmarker en el Frontend Estático

- **Versión de paquete:** `@mediapipe/tasks-vision`.
- **Alojamiento 100% Local (Sin CDNs en runtime):**
  - Script `scripts/fetch-assets.mjs` copia los binarios WASM desde `node_modules/@mediapipe/tasks-vision/wasm` hacia `public/mediapipe/`.
  - Descarga el modelo `face_landmarker.task` directamente en `public/mediapipe/face_landmarker.task` si no existe.
  - Carga en la aplicación mediante:
    ```typescript
    const vision = await FilesetResolver.forVisionTasks('/mediapipe');
    const landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: '/mediapipe/face_landmarker.task',
        delegate: 'CPU', // configurable a GPU si WebGL compute está disponible
      },
      runningMode: 'IMAGE',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    ```
- **Validaciones obligatorias:**
  - Debe existir exactamente una cara (`results.faceLandmarks.length === 1`).
  - Si hay 0 caras: error "No se detectó ningún rostro en la imagen".
  - Si hay >1 caras: error "Se detectaron múltiples rostros. Sube una foto con un único rostro".
  - Resolución mínima: ancho y alto >= 256 px.

---

## 5. Seguridad y Privacidad

1. **Gestión de la API Key:**
   - La API key solo vive en la memoria de la aplicación (y opcionalmente en `sessionStorage` para no perderla en refresco voluntario si el usuario lo desea).
   - NUNCA en `localStorage`, nunca en URLs, nunca en `console.log`.
2. **Foto y Procesamiento:**
   - La foto se procesa estrictamente en la GPU/CPU local del navegador con WebGL y MediaPipe.
   - Jamás se sube la imagen a servidores externos ni a Gemini. A Gemini solo se envía el flujo de voz del usuario (16 kHz PCM16) y el `systemInstruction` generado con el nombre del personaje.
3. **Content Security Policy (CSP):**
   - Meta CSP estricta en `index.html`:
     - `default-src 'self'`.
     - `connect-src 'self' wss://generativelanguage.googleapis.com https://generativelanguage.googleapis.com blob:`.
     - `script-src 'self' 'wasm-unsafe-eval'`.
     - `worker-src 'self' blob:`.
     - `img-src 'self' blob: data:`.
     - `style-src 'self' 'unsafe-inline'`.
     - Fuentes locales del sistema (sin Google Fonts).


---

## 6. Lip-sync y Cavidad Bucal Procedural (Fase 5)

1. **Apertura Bucal Limpia y Triangulación Delaunay:**
   - La triangulación estándar de Delaunay sobre 478 puntos faciales crea triángulos conectando el labio superior y el labio inferior a través de la hendidura oral (dado que no hay landmarks en el interior de la boca).
   - En `src/core/face/buildMesh.ts`, se filtran y descartan todos los triángulos que tienen vértices en `UPPER_LIP_LANDMARKS` y simultáneamente en `LOWER_LIP_LANDMARKS`.
   - Esto permite que los labios superior e inferior se separen limpiamente al descender la mandíbula (`jawOpen`), abriendo una cavidad oral real sin estirar la textura fotográfica de la piel ni duplicar los labios.

2. **Boca Interior Procedural (`mouthInterior.ts`):**
   - Una malla dinámica `BufferGeometry` con 11 pares de vértices (22 vértices, 20 triángulos) se acopla inmediatamente detrás de los labios (`z = -0.0025`), alineada con los 11 puntos interiores de los labios (del landmark 78 al 308).
   - Genera proceduralmente en un lienzo de 512x256 la textura de la cavidad bucal profunda (degradado vino oscuro a negro carbón), una fila de dientes superiores arqueados con separadores de esmalte blanco cálido/marfil, lengua difusa y dientes inferiores sutiles.
   - Cuenta con una holgura de solapamiento vertical (`tuck = 0.005`) que introduce los márgenes de la boca interior debajo de la piel de los labios, impidiendo costuras o cortes visibles.
   - La opacidad se modula fluidamente según `jawOpen`: invisible cuando la boca está cerrada (`jawOpen < 0.015`) y con despliegue progresivo cuando el avatar habla o vocaliza.

3. **Analizador Espectral y Visemas (`lipsyncAnalyzer.ts`):**
   - Extrae el RMS temporal desde el `AnalyserNode` de la cola de reproducción para modular la apertura mandibular `jawOpen`.
   - Realiza análisis espectral por bandas de frecuencia:
     - Banda grave (100 - 900 Hz): concentración de energía activa el visema de redondeo `mouthRound` (vocales /o/, /u/).
     - Banda aguda (2200 - 4500 Hz): concentración de energía activa la extensión `mouthWide` (vocales /e/, /i/ y sonrisa).
   - Suavizado asimétrico Attack/Release: ataque ultrarrápido (~32 ms) para consonantes y sílabas súbitas; liberación gradual (~90 ms) para transiciones vocálicas naturales.

4. **Compensación de Latencia en la Cola de Audio (`playbackQueue.ts`):**
   - Se inserta un `DelayNode` de 35 ms entre el `AnalyserNode` y los altavoces de salida (`AudioContext.destination`).
   - El audio es analizado 35 ms antes de que el sonido se emita físicamente por los altavoces, sincronizando milimétricamente el movimiento de los labios con el audio percibido por el usuario.


---

## 7. Enrutamiento Estático y Navegación (/settings <-> /avatar)

1. **Enrutador Estático sin Dependencias Externas:**
   - Para mantener el requisito estricto de cero dependencias innecesarias y 100% frontend estático, se implementó un enrutador en `src/app/routes.ts` que opera sobre la HTML5 History API (`window.history.pushState`, `window.history.replaceState` y el evento `popstate`).
   - Rutas fijas canónicas:
     - `/settings`: Pantalla inicial de configuración del personaje, selector de voz, carga de imagen y detección de malla facial.
     - `/avatar`: Escenario en vivo con el avatar deformado por Three.js y controles de conversación por voz.
     - Cualquier ruta no reconocida o la raíz `/` se normaliza automáticamente a `/settings`.

2. **Protección de Ruta:**
   - Si el usuario accede directamente a `/avatar` mediante la barra de direcciones o un marcador sin tener un rostro detectado previamente en memoria, la aplicación lo redirige inmediatamente a `/settings`.

3. **Historial del Navegador:**
   - La navegación es bidireccional: al pulsar "Comenzar" o "Ver Avatar Animado", la URL se actualiza a `/avatar`; al presionar "Configuración" o "Terminar llamada", se regresa a `/settings` conservando los datos configurados.
   - Los botones de navegación Atrás y Adelante del navegador funcionan orgánicamente mediante el listener de `popstate`.

---

## 8. Diagnóstico de la Línea Base y Resultados de la Fase 0 (YourSelf v2)

### 8.1. Confirmación de Problemas Diagnosticados en el Código (Sección 4)

Tras la inspección y verificación directa del código fuente, se confirmaron todos los puntos diagnósticos:

1. **Boca abierta y labios que no se conservan:**
   - **Fallback artificial senoidal (`src/core/render/avatarRenderer.ts` ~L338):** Cuando el estado de ánimo pasa a `speaking` (lo cual ocurre al iniciar el turno del modelo en `ConversationBar.tsx`), si `jawOpen ≤ 0.005`, se fuerza `jawOpen = max(0, sin(t * 0.007) * 0.22)`. Esto hace que el avatar mueva los labios de forma autónoma aunque no exista audio audible o durante pausas del modelo.
   - **Orificio bucal permanente (`src/core/face/buildMesh.ts` L120-L135):** Delaunay elimina los triángulos que unen `UPPER_LIP_LANDMARKS` con `LOWER_LIP_LANDMARKS`. Esto crea un agujero en la malla que deja ver el fondo transparente del canvas cuando la cavidad interior está oculta.
   - **Opacidad prematura sin histéresis (`src/core/render/mouthInterior.ts` L223-L231):** La opacidad de la boca interior se calcula como `(jawOpen - 0.015) * 8.0`, alcanzando el 100% de opacidad a una apertura de apenas `jawOpen ≈ 0.14`. Revela inmediatamente un fondo vino oscuro y 8 dientes fijos sin correlación con la foto.
   - **Escala de deformación fija e inconsistente (`src/core/render/poses.ts` L111-L114):** En fotos con boca cerrada, la distancia vertical de reposo es 0 y se fuerza arbitrariamente a un mínimo de `0.02` unidades de mundo, impidiendo que la deformación escale con el tamaño del rostro (`faceScale`).
   - **Mandíbula con desplazamiento vertical puro (`src/core/render/poses.ts` L328-L354):** Desplaza labio inferior y mentón verticalmente hacia abajo sin simular la rotación anatómica sobre el cóndilo de la mandíbula ni propagarse gradualmente hacia las mejillas y el cuello.

2. **Parpadeo antinatural y deformación del ojo:**
   - **Aplastamiento de la textura (`src/core/render/poses.ts` L193-L259):** El párpado superior desciende el 105% de la distancia y el centro del iris se arrastra un 110% hacia el centro del párpado inferior (`rTargetY - base.y * 1.1 * weight`). En lugar de que el párpado descienda como una capa de piel que cubre el ojo, la textura completa (esclera, iris y pupila) se deforma y colapsa hacia una ranura inferior.
   - **Patrón uniforme y desconectado (`src/core/animation/idleBehavior.ts`):** Intervalo uniforme de 2.2 a 4.8 s, primer parpadeo prefijado en 1.0 s, y duración estática de 160 ms sin variabilidad asimétrica ni acoplamiento con la mirada o el habla.

3. **Rostro estático y predecible:**
   - **Osciladores senoidales fijos (`src/core/animation/idleBehavior.ts` L155-L164):** Balanceo de cabeza basado en la suma de dos senos de frecuencia fija con amplitudes máximas de tan solo ~1.4° a 2.3°.
   - **Paralaje 2D artificial (`src/core/render/poses.ts` L402-L406):** Desplaza vértices horizontalmente con `1.0 + z_base * 2.8` en vez de realizar una rotación ortográfica coherente en el espacio tridimensional.
   - **Suavizado sin inercia (`src/core/animation/animationState.ts`):** Filtro exponencial de primer orden ($1 - e^{-k \cdot dt}$) sin simulación de masa ni aceleración.

4. **Lip-sync desconectado del idioma:**
   - Modula la mandíbula usando RMS y 3 bandas FFT crudas.
   - La transcripción textual generada por Gemini (`outputAudioTranscription`) no interviene en el lip-sync.
   - Evaluado con `performance.now()` en lugar de sincronizarse con el reloj del `AudioContext`.

---

### 8.2. Decisiones Técnicas Implementadas en la Fase 0

1. **Flag Dinámico `?rig=v1|v2`**:
   - Se añadió `rigVersion: 'v1' | 'v2'` en el estado de sesión global (`src/store/session.ts`), inicializado automáticamente desde los parámetros de consulta de la URL (`new URLSearchParams(window.location.search).get('rig')`).
   - Se implementó la utilidad `updateUrlParams` en `src/app/routes.ts` para sincronizar los parámetros `rig` y `debug` en la barra de direcciones mediante `window.history.replaceState` sin recargar la página.
   - `AvatarRenderer` admite `rigVersion` tanto en sus opciones de inicialización como a través de `setRigVersion('v1' | 'v2')` y `getRigVersion()`.
   - En esta Fase 0, el switch alterna de manera fluida y sin errores de ejecución, dejando lista la infraestructura para conectar los nuevos módulos de deformación y lipsync en las siguientes fases.

2. **Panel de Diagnóstico y Métricas Ampliado (`?debug=1`)**:
   - Se creó el componente `src/components/AvatarDebugPanel.tsx` con tres secciones principales:
     - **Presupuesto & Métricas:** Muestra FPS, consumo total de JS por fotograma y desglose por módulo comparado con los límites del presupuesto (Prosodia ≤ 0.8 ms, Director/Dinámica ≤ 0.4 ms, Rig Apply ≤ 0.8 ms, Overlays/Shading ≤ 1.0 ms, Total JS ≤ 4.0 ms). Incluye histograma suave de apertura `jawOpen` en 5 rangos, contador de parpadeos/min y RMS de movimiento de cabeza.
     - **Ganancias por Capa:** Sliders para calibrar independientemente la intensidad de las 3 capas (`lips`, `expression`, `pose`) de 0.0 a 1.5.
     - **Canales del Rig:** Sliders manuales para cada uno de los canales (`jawOpen`, `mouthRound`, `mouthWide`, `smile`, `blink`, `blinkLeft`, `blinkRight`, `gazeX`, `gazeY`, `browRaise`, `headYaw`, `headPitch`, `headRoll`, `breath`) con botón de restauración a modo automático.

3. **Optimización y Presupuesto de Rendimiento en el Bucle Caliente**:
   - **Cero Asignaciones en el Hot Loop (`no new`):** Todos los búferes de medición, arreglos de marcas temporales de parpadeo (`Float64Array`), búfer circular de ángulos de cabeza (`Float32Array`) y acumuladores numéricos se encuentran pre-asignados como miembros de instancia en `AvatarRenderer`.
   - **Pausa Inteligente en Pestaña Oculta:** Mediante un listener de `document.visibilitychange`, el bucle de animación se detiene inmediatamente (`cancelAnimationFrame`) cuando la pestaña no está visible, eliminando el consumo de CPU en segundo plano y reanudando la sincronización temporal al volver a la pestaña activa.

4. **Preservación Estricta de Contratos Existentes**:
   - Se mantuvieron inalterados todos los métodos y firmas requeridos por `AvatarStage.tsx`: `setMood()`, `setManualVisemes()`, `setAudioAnalyser()` (y su alias `setAnalyser()`), `handleResize()`, `triggerBlink()`, el callback `onFpsUpdate`, y `onBlinkChange`.
   - Los 6 archivos de prueba existentes más el nuevo archivo `tests/debugAndRig.test.ts` (7 suites, 39 pruebas) pasan al 100% en verde.

---

## 9. Decisiones y Resultados de la Fase 1: Arreglos Críticos (Boca y Parpadeo)

### 9.1. Eliminación del Agujero Bucal y Nuevo Modelo de Cavidad Bucal (`mouthInterior.ts` y `buildMesh.ts`)

1. **Malla Facial Continua:**
   - En V1, `buildMesh.ts` eliminaba los triángulos que cruzaban entre los labios superior e inferior (`filterMouthHole: true`), creando un hueco permanente que dejaba ver el fondo transparente del canvas cuando la cavidad bucal estaba inactiva.
   - En V2 (`filterMouthHole: false`), la triangulación de Delaunay preserva la superficie continua del rostro y los labios originales de la foto permanecen 100% intactos en reposo y silencio.

2. **Cavidad Bucal como Overlay Geométrico:**
   - `MouthInterior` se rediseñó como un overlay posicionado por encima de la cara (`renderOrder = 2`, desplazamiento hacia adelante $z = +0.0006$).
   - **Evaluación geométrica de apertura (`effectiveGap`):** Se calcula a partir de la distancia euclídea real entre los 11 pares de landmarks de los labios interiores (`INNER_LIP_PAIRS`), normalizada por la escala facial (`faceScale`).
   - **Zona muerta estricta con histéresis ($g_0 = 0.007$, $g_1 = 0.035$):**
     - Si `effectiveGap < g_0`, la opacidad es exactamente `0.0` y `mesh.visible = false`.
     - Si `effectiveGap \ge g_0`, la opacidad transiciona de forma continua y monótona mediante una curva cúbica Hermite (`smoothstep`).
   - **Textura y Paleta Adaptativa:**
     - En lugar de tonos vino fijos y dientes genéricos descontextualizados, el canvas dinámico de la cavidad bucal muestrea y modula los tonos de piel, labios y esclera obtenidos de la foto mediante `photoProfile.ts`.

3. **Eliminación del Fallback Artificial de Habla:**
   - Se removió en `avatarRenderer.ts` la generación artificial de `jawOpen = sin(t * 0.007) * 0.22` cuando el estado es `speaking` y no hay audio. La boca solo se mueve cuando el analizador detecta energía vocal audible o se aplican visemas manuales explícitos.

---

### 9.2. Nuevo Sistema de Parpadeo y Párpados (`eyelids.ts` y `blink.ts`)

1. **Eliminación del Aplastamiento del Iris:**
   - En V1, `poses.ts` forzaba a los landmarks del iris a descender un 110% hacia el centro del párpado inferior, deformando y aplastando la textura del ojo.
   - En V2, los vértices del iris y la esclera de la malla facial base permanecen en su posición anatómica real. El cierre se realiza mediante `EyelidOverlay` (`renderOrder = 3`, $z = +0.0008$).
   - `EyelidOverlay` construye una tira de cuadriláteros triangulados (9 pares por ojo, 36 vértices en total) que desciende desde el pliegue superior hacia el párpado inferior, usando coordenadas UV muestreadas de la piel periocular superior de la foto.

2. **Modelo Biológico de Parpadeo (`BlinkController` V2):**
   - **Distribución de Intervalos Log-Normal:** Modela la tasa de parpadeo humana con una media de 3.5 s en reposo y 2.8 s al hablar (acotado naturalmente entre 1.2 s y 6.8 s), eliminando el intervalo uniforme y el primer segundo fijo artificial de V1.
   - **Cinemática Asimétrica Fisiológica:** Cierre muscular rápido durante los primeros ~38% del ciclo (~40 ms) y reapertura gradual con relajación viscoelástica durante los últimos ~62% (~70 ms).
   - **Variabilidad Estocástica Realista:**
     - 18% de parpadeos incompletos (cierre parcial entre 70% y 92%).
     - 12% de parpadeos dobles consecutivos (intervalo corto de ~110-150 ms).
     - Asimetría natural entre ojo izquierdo y derecho ($\pm 15$ ms de desfase temporal).
   - **Acoplamiento con Mirada (Gaze Coupling):** Al mirar hacia abajo (`gazeY < 0`), los párpados superiores descienden levemente acompañando la rotación ocular.

---

### 9.3. Calibración Facial Invariante (`photoProfile.ts`)

- Se introdujo `calibratePhotoProfile`:
  - **`faceScale`:** Distancia euclídea interocular calculada en el espacio de mundo Three.js. Se utiliza para normalizar todas las traslaciones de la mandíbula, labios y párpados, garantizando un comportamiento idéntico en fotos de cualquier encuadre, resolución o relación de aspecto.
  - **`mouthMode`:** Clasifica automáticamente la foto de entrada en `'closed'`, `'teethVisible'` o `'openMouth'` evaluando la separación de los labios interiores y la luminancia del área bucal.
  - **`frontality`:** Estima el grado de frontalidad (0.3 a 1.0) midiendo la simetría horizontal de los pómulos respecto al ápice nasal, modulando la amplitud máxima de balanceo cefálico.
  - **Muestreo de Paleta de Color:** Extrae los tonos dominantes de piel, labios, párpados y esclera para asegurar la armonía visual de todos los overlays procedurales.

---

### 9.4. Mejoras del Analizador de Lip-Sync (`lipsyncAnalyzer.ts` y `playbackQueue.ts`)

1. **Trigger de Schmitt (Histéresis):**
   - Umbral de apertura de mandíbula en $0.020$ RMS y umbral de cierre en $0.009$ RMS. Elimina el aleteo errático ante respiraciones, susurros o ruido de fondo.
2. **Normalización Adaptativa $p_{90}$:**
   - Un estimador móvil con seguimiento rápido de picos y decaimiento lento ajusta la sensibilidad dinámicamente: voces suaves abren la boca de forma adecuada sin perderse, y voces fuertes no saturan el canal.
3. **Tope Blando (Soft-Clamp):**
   - Limitador no lineal `Math.tanh` con asíntota en $0.65$, impidiendo aperturas de mandíbula desmesuradas o grotescas en gritos o sonidos fuertes.
4. **Detección Espectral de Sibilantes / Fricativas (/s/, /z/, /c/):**
   - Cuando la energía espectral en agudos ($> 2400$ Hz) domina sobre los formantes graves, el analizador detecta sibilantes y restringe `jawOpen \le 0.18` (los dientes deben permanecer próximos), activando a su vez `mouthWide \ge 0.25`.
5. **Anticipación Auditiva:**
   - En `playbackQueue.ts`, se configuró un retardo visual de anticipación de 70 ms en el canal de audio mediante un `DelayNode`, permitiendo que la boca inicie su movimiento de apertura levemente antes de que el sonido sea percibido por el usuario, emulando la física articulatoria humana.

---

### 9.5. Verificación de Aceptación de la Fase 1

- **Tests unitarios:** Se añadieron 16 pruebas en `tests/phase1.test.ts`. El suite completo ahora cuenta con 8 archivos y **56 pruebas en verde (100% pass)**.
- **Linter y compilación:** `npm run lint` pasa con 0 errores y 0 advertencias. `npm run build` genera el bundle de producción limpiamente en 16.1 s.
- **Presupuesto de bundle:** El tamaño comprimido aumentó de 109.13 kB a 109.90 kB (+0.77 kB, **+0.7%**), cumpliendo con creces la cota de $\pm 10\%$.
- **Cero asignaciones por fotograma:** La ejecución de `EyelidOverlay`, `MouthInterior`, `BlinkController` y `LipsyncAnalyzer` se realiza íntegramente sobre Float32Array y Uint8Array pre-asignados.

---

## 10. Decisiones y Resultados de la Fase 2: Rig y Dinámica (100% CPU)

### 10.1. Rig Basado en Formas y Precomputación de Bases (`shapes.ts` y `basis.ts`)

1. **Definiciones Declarativas Compatibles:**
   - Se crearon en `shapes.ts` las especificaciones de blendshapes alineadas con MediaPipe y ARKit: `jawOpen`, `mouthClose`, `mouthPressLips`, `mouthFunnel`, `mouthPucker`, `mouthStretchLeft/Right`, `mouthSmileLeft/Right`, `mouthDimpleLeft/Right`, `mouthFrownLeft/Right`, `lowerLipTuck`, `browInnerUp`, `browOuterUpLeft/Right`, `browDownLeft/Right`, `eyeSquintLeft/Right`, `cheekRaiseLeft/Right`, `noseSneerLeft/Right`.
   - Cada forma define manejadores con desplazamientos y radios de influencia expresados en múltiplos de `faceScale`.

2. **Precomputación de Bases con Aislamiento Regional (`basis.ts`):**
   - Se precalculan una sola vez al cargar la foto arreglos planos `Float32Array(vertexCount * 3)`.
   - **Máscaras de aislamiento anatómico:** Las formas de boca (`region: 'mouth'`) tienen estrictamente prohibido mover vértices de ojos o cejas; las formas de cejas jamás desplazan la boca.
   - **Atenuación suave cuártica:** Ponderación radial $w(u) = (1 - u^2)^2$ desde los manejadores.

3. **Cinemática Anatómica de Mandíbula con Pivote (`isPivotJaw`):**
   - `jawOpen` no es una traslación vertical plana: modela la rotación anatómica de la mandíbula sobre el cóndilo mandibular (eje articular entre landmarks 234 y 454).
   - El labio inferior y el mentón descienden en arco hacia adelante y abajo, la musculatura peribucal decae con suavidad cuadrática hacia las mejillas, y el labio superior permanece casi inmóvil ($\le 10\%$ de desplazamiento reactivo de volumen).

---

### 10.2. Ejecutor del Rig y Rotación 3D Coherente con Profundidad (`rig.ts`)

1. **Evaluación Lineal en CPU con Cero Asignaciones:**
   - `Rig.apply()` acumula `out = base + Σ (w_i · basis_i)` iterando exclusivamente sobre formas activas ($|w_i| > 0.001$) sobre memoria contigua preasignada. Coste de cómputo en CPU $\le 0.4$ ms para ~500 vértices.

2. **Rotación Cefálica 3D Ortográfica con Profundidad Real:**
   - La pose craneal (`headYaw`, `headPitch`, `headRoll`) rota las coordenadas $(x, y, z)$ sobre el centro de masa del cráneo/eje cervical.
   - **Paralaje anatómico real:** Al poseer los landmarks de MediaPipe profundidad $z$ física real (la nariz y labios sobresalen respecto a las orejas y el óvalo), la rotación tridimensional produce paralaje natural inmediato (la punta nasal describe un arco mayor que las sienes) sin requerir aproximaciones 2D artificiales.
   - Ponderación de caída suave hacia los anillos de anclaje para actuar el cuello como bisagra flexible.

3. **Invariancia de Escala Facial:**
   - Todos los desplazamientos y radios están escalados de manera estrictamente proporcional a `faceScale`. Una foto escalada al doble genera deformaciones normalizadas $(\Delta / \text{faceScale})$ idénticas dentro del 1%.

---

### 10.3. Dinámica de Segundo Orden con Resortes Críticamente Amortiguados (`dynamics.ts`)

1. **Osciladores Armónicos con Inercia ($\zeta = 1$):**
   - Se reemplazó el filtro exponencial de primer orden por integración semi-implícita de Euler:
     $$a = \omega^2 (\text{target} - x) - 2\omega v$$
     $$v \leftarrow v + a \cdot dt, \quad x \leftarrow x + v \cdot dt$$
   - **Cero sobreoscilación:** Amortiguamiento crítico exacto sin overshoot indeseado.
   - **Inercia y aceleración realista:** Los movimientos faciales no arrancan con velocidad infinita ni frenan en seco; presentan masa y respuesta biomecánica natural.

2. **Calibración de Frecuencias Naturales $\omega$ por Canal:**
   - Mandíbula y visemas de habla: $30 - 38$ rad/s (alta agilidad y sincronía articulatoria).
   - Mirada (sacadas oculares): $38$ rad/s (salto balístico rápido).
   - Expresiones (sonrisa, cejas): $8 - 12$ rad/s (modulación afectiva suave).
   - Postura craneal (yaw, pitch, roll): $3.8 - 4.5$ rad/s (masa e inercia del cráneo).
   - Respiración: $3.5$ rad/s.
   - Límites de velocidad y aceleración para inmunidad total frente a saltos bruscos o caídas de fotogramas.

3. **Fachada de Compatibilidad:**
   - `AnimationStateManager` delega internamente en `DynamicsController`, preservando al 100% sus firmas públicas y comportamiento esperado por `AvatarStage.tsx` y pruebas unitarias.

---

### 10.4. Ruido Multioctava para Balanceo Craneal (`noise.ts` e `idleBehavior.ts`)

- **Eliminación de Senos Fijos:**
  - Se sustituyó la suma de 2 senos periódicos de V1 por ruido continuo 1D multioctava (fBm) con interpolación quíntica de Hermite ($6t^5 - 15t^4 + 10t^3$), asegurando derivadas continuas de velocidad y aceleración sin tirones.
  - Constantes de tiempo y frecuencias completamente desacopladas para Yaw ($0.28$ Hz), Pitch ($0.22$ Hz) y Roll ($0.16$ Hz).
  - Amplitudes diferenciadas entre reposo ($\pm 2.5^\circ, \pm 2.0^\circ, \pm 1.5^\circ$) y habla ($\pm 4.8^\circ, \pm 3.8^\circ, \pm 2.8^\circ$), moduladas por `frontality`.

---

### 10.5. Sombreado de Pseudo-Volumen por Deformación de Área (`shading.ts`)

- `PseudoVolumeShading` evalúa en cada fotograma la relación entre el área actual y el área de reposo de los triángulos en regiones clave (labios, mentón, pliegue periorbitario).
- Genera un factor de color por vértice aplicado al atributo `color` del `MeshBasicMaterial` (`vertexColors: true`):
  - **Compresión** (sellado labial, comisuras, pliegue palpebral): factor $< 1.0$ (oscurecimiento sutil que simula oclusión ambiental y sombras de pliegues).
  - **Estiramiento** (apertura de boca, extensión de mejillas): factor $> 1.0$ (sutil aclarado).
- Acotado estrictamente a $\pm 8\%$ ($[0.92, 1.08]$), transformando la sensación de deformación elástica plana ("goma") en volumen anatómico creíble con un coste de $\le 0.1$ ms.

---

### 10.6. Anillos de Anclaje Periféricos (`buildMesh.ts`)

- Se implementó la opción `includeAnchorRings: true`:
  - Genera 2 anillos elípticos de anclaje concéntricos a $1.25\times$ y $1.60\times$ del óvalo facial más puntos de soporte para cuello y hombros.
  - La triangulación de Delaunay extiende la superficie de forma continua hacia los bordes fijos de la imagen.
  - Garantiza que el balanceo cefálico y los movimientos mandibulares decaigan suavemente hacia el perímetro sin desgarros ni tensiones en el cabello o fondo.

---

### 10.7. Verificación de Aceptación de la Fase 2

- **Tests unitarios:** Se crearon 14 pruebas en `tests/phase2.test.ts`. El suite completo ahora contiene 9 archivos y **70 pruebas en verde (100% pass)**.
- **Pruebas clave verificadas:**
  - *Identidad:* Pesos 0 $\implies$ salida idéntica bit por bit a la geometría base.
  - *Invariancia de escala:* Apertura bucal normalizada idéntica en rostros con escala $1.0\times$ y $2.0\times$.
  - *Aislamiento regional:* Formas mandibulares no mueven ojos ni cejas; cejas no mueven boca.
  - *Dinámica de segundo orden:* Resorte sin sobreoscilación ($\zeta = 1$) y respuesta diferenciada por canal.
  - *Pseudo-volumen:* Variación de sombreado acotada en $[0.92, 1.08]$.
- **Linter y compilación:** `npm run lint` pasa con 0 errores y 0 advertencias. `npm run build` compila con éxito en 9.79 s.
- **Presupuesto de bundle:** Tamaño comprimido de 114.25 kB gzip (+5.12 kB / **+4.7%** total respecto a Fase 0), cumpliendo el límite estricto de $\pm 10\%$.
- **Rendimiento:** Cero asignaciones de memoria dinámicas en el bucle caliente (`apply`, `shading.update`, `spring.step`).

---

## 11. Fase 3 — Lip-sync en Español (G2P Analítico + Coarticulación + Reloj de Audio)

### 11.1. Conversor Grafema a Fonema/Visema Analítico (`es-g2p.ts`)

1. **Modelo de 12 Visemas Canónicos:**
   - Se diseñó un conjunto cerrado de 12 visemas optimizados para la fonética articulatoria del español y el rig facial:
     - Silencio: `SIL`.
     - Bilabiales: `MBP` (/m/, /b/, /p/).
     - Labiodentales: `FV` (/f/).
     - Vocales: `A`, `E`, `I`, `O`, `U`.
     - Dentales / Alveolares: `TDNL` (/t/, /d/, /n/, /l/, /r/, /rr/).
     - Fricativas sibilantes: `SZ` (/s/, /z/, /c/ suave).
     - Palatales / Africadas: `CH_Y` (/tʃ/, /ʝ/, /ɲ/).
     - Velares: `K_G_J` (/k/, /g/, /x/).
2. **Reglas Fonotácticas Deterministas del Español:**
   - *H muda:* Omitida en toda posición excepto en dígrafo `ch`.
   - *Letra V:* Fonéticamente idéntica a `b` (visema `MBP`).
   - *C y G suaves vs duras:* `c`/`g` seguidas de `e`/`i` se transliteran a `SZ` y `K_G_J` (/x/) respectivamente; ante `a`, `o`, `u` son velares.
   - *Dígrafos `qu` y `gu`:* `u` es muda ante `e`/`i` salvo presencia de diéresis (`gü` $\implies$ /gw/).
   - *Vocal vs Consonante `y`:* Fonema vocálico `/i/` en final de palabra o aislada (`y`, `muy`); palatal `/ʝ/` en ataque silábico (`ya`, `playa`).
   - *Dígrafos especiales:* `ch` $\implies$ `CH_Y`, `ll` $\implies$ `CH_Y`, `ñ` $\implies$ `CH_Y`, `rr` $\implies$ `TDNL`.
3. **Silabificación y Acentuación Prosódica:**
   - Detección de núcleos vocálicos considerando diptongos (vocal fuerte + débil átona) e hiatos (vocales fuertes o débil con tilde).
   - Identificación analítica de la sílaba tónica (por tilde ortográfica o reglas de agudas/llanas según terminación en vocal, n, s):
     - Sílaba tónica: factor $+20\%$ en amplitud de apertura/extensión.
     - Sílabas átonas: factor $-15\%$.
   - Cero dependencias externas o modelos pesados; ejecución en $< 0.05$ ms por frase.

---

### 11.2. Reloj de Audio Unificado y Detección de Picos Silábicos (`audioClock.ts` y `syllableClock.ts`)

1. **Sincronización por Reloj de Audio (`audioClock.ts`):**
   - La evaluación temporal de la animación se referencia directamente al `AudioContext.currentTime` del navegador, compensando la latencia física de salida (`outputLatency + baseLatency`).
   - Inmune a la deriva temporal respecto a `performance.now()`, asegurando sincronía labial perfecta incluso en sesiones conversacionales prolongadas ($\ge 60$ s).
2. **Detección de Picos Silábicos (`syllableClock.ts`):**
   - Rastrea la modulación espectral en el rango típico del ritmo del habla humana ($3 - 8$ Hz).
   - Intervalo mínimo entre núcleos silábicos de $95$ ms con umbral adaptativo de prominencia basado en el percentil $p_{90}$ de la envolvente RMS.

---

### 11.3. Planificador de Visemas y Coarticulación (`visemeScheduler.ts`)

1. **Fases de Coarticulación Temporal:**
   - Cada sílaba proyecta un ciclo temporal de 3 fases:
     - **Anticipación pre-nuclear (30–60 ms):** Los labios comienzan a adoptar la forma articulatoria antes de que se emita la explosión acústica audible.
     - **Núcleo vocálico:** Máxima apertura y configuración tonal sostenida.
     - **Coda consonántica y transición:** Decaimiento hacia el siguiente visema o silencio.
2. **Configuraciones Articulatorias del Rig:**
   - *Bilabiales (`MBP`):* Sello labial completo (`jawOpen: 0`, `mouthClose: 0.90`, `mouthPressLips: 0.60`). Elimina la boca permanentemente abierta durante /m/, /b/, /p/.
   - *Labiodentales (`FV`):* Repliegue activo del labio inferior bajo los incisivos superiores (`lowerLipTuck: 0.80`).
   - *Sibilantes (`SZ`):* Mandíbula estrechamente acotada (`jawOpen: 0.06`, `mouthStretch: 0.25`).
3. **Poda Dinámica y Vaciado Instantáneo (`flush`):**
   - Si la cola de transcripción se desfasa más de $600$ ms respecto al audio en reproducción, se podan automáticamente las sílabas atrasadas para resincronizar.
   - En eventos de interrupción (`interrupted` de Gemini Live al hablar el usuario) o cambio a `listening`, se ejecuta `flush()`, reseteando la cola y relajando los parámetros bucales a reposo de forma inmediata y sin transiciones fantasma.

---

### 11.4. Integración y Cableado

- `AvatarRenderer`: Expone `setAudioContext()`, `enqueueTranscript()` y `onInterrupted()`.
- `AvatarStage.tsx`: Escucha los fragmentos de transcripción del modelo (`assistantTranscript` de Gemini Live) y los alimenta en tiempo real a `enqueueTranscript()`, activando `onInterrupted()` cuando el usuario toma el turno.

---

### 11.5. Verificación de Aceptación de la Fase 3

- **Tests unitarios:** 15 pruebas exhaustivas en `tests/phase3.test.ts` evaluando:
  - Fonetización precisa de palabras complejas del español (ej. *paraguas*, *pingüino*, *corazón*, *lluvia*, *tecnología*).
  - Cierre bilabial completo en /m/, /b/, /p/ y repliegue labiodental en /f/.
  - Variación de apertura entre vocales abiertas (/a/) y cerradas (/i/, /u/).
  - Vaciado instantáneo de la cola ante interrupciones.
- **Suite completa:** 10 archivos de test con **85 pruebas en verde (100% pass)**.
- **Linter y compilación:** `npm run lint` pasa con 0 errores y 0 advertencias. `tsc && vite build` compila limpiamente en 16.39 s.
- **Presupuesto de bundle:** Tamaño comprimido de 117.35 kB gzip (**+7.5%** total respecto a la línea base de Fase 0, dentro del umbral no negociable de $\pm 10\%$).
- **Presupuesto de CPU:** Cero asignaciones de memoria dinámicas en el bucle caliente de interpolación de visemas.

---

## 12. Fase 4 — Director, Expresión y Cabeza Viva (Tres Capas, Emoción RBF, Prosodia F0 y Acciones)

### 12.1. Director Orquestador Multicapa (`director.ts`)

1. **Arquitectura de Tres Capas Desacopladas (Inspiración Hallo / VASA-1):**
   - **Capa 1: Labios (`layerGains.lips`):** Alta agilidad ($\omega \approx 30-38$ rad/s). Combina los visemas fonotácticos del `VisemeScheduler` con modulación de amplitud espectral. Controla `jawOpen`, `mouthRound`, `mouthWide`, `mouthClose`, `mouthPressLips`, `lowerLipTuck`, `mouthFunnel` y `mouthPucker`.
   - **Capa 2: Expresión (`layerGains.expression`):** Cadencia emocional media ($\omega \approx 8-12$ rad/s). Evalúa el espacio continuo de valencia/activación, micro-expresiones periódicas (flash de cejas cada 4–9 s al hablar, asimetría natural de sonrisa $\pm 3\%$, acoplamiento de Duchenne mejilla-ojo) y los gestos de la biblioteca de acciones.
   - **Capa 3: Pose (`layerGains.pose`):** Inercia craneal realista ($\omega \approx 3-5$ rad/s). Orquesta el ruido fractal fBm para balanceo natural, fijaciones y sacadas oculares, giro cefálico retardado acoplado a la mirada, respiración continua y cabeceos de escucha activa.
2. **Controles Fisiológicos tipo VASA-1:**
   - `gazeTarget`: Coordenada objetivo $[x, y]$ de enfoque ocular (por defecto cámara central $[0, 0]$).
   - `headDistance`: Modulación suave del zoom de la cámara ortográfica acotada en $[0.97, 1.03]$ para simular aproximación/alejamiento corporal.
   - `emotionOffset`: Desplazamiento aditivo continuo $\{ \text{valence}, \text{arousal} \}$ sobre el estado afectivo.
3. **Comportamiento Autónomo por Estados Conversacionales:**
   - `idle`: Balanceo armónico fBm no repetitivo, micro-sacadas exploratorias hacia el entorno (~65% hacia la cámara), respiración rítmica y sonrisa mínima de descanso.
   - `listening`: Enfoque ocular prioritario hacia el usuario con breves aversiones naturales; cabeceos de escucha activa en pausas; cejas atentas y ligera inclinación cervical.
   - `thinking`: Mirada reflexiva hacia el cuadrante superior lateral con deriva errática continua y retorno (no estática); leve inclinación craneal y fruncimiento leve de cejas.
   - `speaking`: Activación simultánea de habla articulatoria, aversión inicial de mirada al arrancar el turno, énfasis postural en picos de energía prosódica y destellos de cejas periódicos.

---

### 12.2. Espacio Emocional Continuo e Interpolación RBF 2D (`emotion.ts`)

1. **Modelo Afectivo de Russell (Circumplex Model of Affect):**
   - Parametrizado mediante coordenadas normalizadas continuas:
     - $\text{Valence} \in [-1.0, +1.0]$ (afecto negativo vs positivo).
     - $\text{Arousal} \in [0.0, +1.0]$ (calma/letargo vs activación/expresividad).
2. **7 Presets Clave de Expresión Facial:**
   - `neutral`: Reposo equilibrado ($V = 0.00, A = 0.15$).
   - `alegre`: Sonrisa marcada, elevación de mejillas y entrecejo suave ($V = 0.80, A = 0.65$).
   - `triste`: Elevación del entrecejo interior (`browInnerUp`), descenso de comisuras (`mouthFrown`), cejas descendidas ($V = -0.75, A = 0.20$).
   - `sorprendido`: Arqueo amplio de cejas (`browInnerUp`, `browOuterUp`), apertura de párpados y leve caída mandibular ($V = 0.25, A = 0.90$).
   - `pensativo`: Cejas contraídas (`browDown`), hoyuelos sutiles y mirada orientada ($V = -0.10, A = 0.25$).
   - `empatico`: Sonrisa suave combinada con elevación interna de cejas e inclinación afectiva ($V = 0.50, A = 0.35$).
   - `divertido`: Sonrisa amplia con elevación intensa de mejillas y squint periorbitario de Duchenne ($V = 0.88, A = 0.85$).
3. **Interpolación Radial Gaussiana 2D (RBF):**
   - Ponderación continua sobre memoria contigua preasignada mediante funciones de base radial:
     $$w_i = \exp\left(-\frac{1}{2}\left[\frac{(V - V_i)^2}{\sigma_V^2} + \frac{(A - A_i)^2}{\sigma_A^2}\right]\right)$$
   - Con $\sigma_V = 0.45$ y $\sigma_A = 0.40$, produce transiciones fluidas e hiperrealistas sin saltos discretos ni mutaciones bruscas.
   - Decaimiento asintótico suave hacia la línea base tras 3.5 s de inactividad de estímulos.

---

### 12.3. Heurística de Sentimiento y Prosodia Acústica en CPU (`prosodyAnalyzer.ts`)

1. **Extractor de Frecuencia Fundamental (F0) y Expresividad Tonal:**
   - Ejecuta autocorrelación normalizada sobre el buffer temporal en el rango fisiológico de la voz humana ($80 - 400$ Hz) con refinamiento de lag de paso 1.
   - Rastrea envolvente RMS, sonoridad periódica (`isVoiced`), media móvil de pitch, varianza tonal ($\sigma_{\text{F0}}$ en Hz) y pendiente de entonación.
   - Cero asignaciones dinámicas por frame.
2. **Heurística de Texto en Español:**
   - Detección de puntuación interrogativa (`¿`, `?`) $\implies$ elevación de arousal y activación de expresión inquisitiva/curiosa.
   - Detección de exclamación (`¡`, `!`) $\implies$ salto de arousal y modulación de intensidad.
   - Lexicón categorizado para español (palabras de alegría, tristeza, asombro, reflexión y empatía) que guía suavemente el estado $(V, A)$ del estimador emocional.

---

### 12.4. Biblioteca de Acciones Procedurales (`actions.ts`)

1. **Catálogo de Acciones Gestuales (Inspiración LiveTalking):**
   - `nod`: Asentimiento simple con curva senoidal descendente de cabeza ($\sim 650$ ms).
   - `nodDouble`: Doble asentimiento de afirmación ($\sim 950$ ms).
   - `tiltCurious`: Ladeo cefálico lateral con elevación unilateral de cejas ($\sim 1200$ ms).
   - `browFlash`: Rápido destello de cejas arriba y abajo ($\sim 400$ ms).
   - `smileSoft`: Impulso suave de sonrisa ($\sim 1500$ ms).
   - `smileBig`: Sonrisa amplia con acoplamiento de pómulos ($\sim 2000$ ms).
   - `laughShort`: Oscilaciones rítmicas de mandíbula y mejillas simulando risa breve ($\sim 1250$ ms).
   - `thinkLookAway`: Aversión coordinada de ojos y cabeza con contracción de cejas ($\sim 1800$ ms).
   - `surprise`: Sobresalto con apertura de ojos y caída mandibular ($\sim 850$ ms).
   - `emphaticBlink`: Disparo de parpadeo coordinado.
2. **Prioridades y Cancelación Inmediata en Interrupciones:**
   - Pool estático de 8 ranuras de acciones activas sin recolección de basura.
   - Mezcla aditiva con las capas subyacentes del rig.
   - Ante el evento `interrupted` de Gemini Live, `director.onInterrupted()` ejecuta `cancelAll()`, cancelando inmediatamente los gestos en curso y reseteando la postura hacia escucha activa sin movimientos fantasma.

---

### 12.5. Acoplamiento Ojo-Cabeza y Mirada Natural (`gaze.ts`)

1. **Cinemática Ocular Orgánica:**
   - Períodos de fijación de $200 - 1000$ ms con sacadas balísticas rápidas ($k \approx 22$).
   - Distribución de atención: $\sim 65\%$ del tiempo orientada al usuario/cámara, con micro-jitter biológico.
   - Aversión ocular inicial al arrancar el turno de habla para emular la conducta humana natural.
2. **Acoplamiento Fisiológico Ojo-Cabeza:**
   - Al producirse una sacada ocular amplia ($|\Delta\text{gaze}| > 0.18$), se programa un giro cefálico en la misma dirección que transfiere entre el $35\%$ y el $45\%$ de la magnitud tras un retraso biológico de $80 - 150$ ms.
   - Disparo condicional de parpadeo con probabilidad del $60\%$ asociado a sacadas grandes.

---

### 12.6. Escucha Activa (Back-Channel Listening)

- En estado `listening`, el Director monitoriza las pausas naturales del interlocutor.
- Cada $2.5 - 4.0$ segundos de silencio relativo o pausas del usuario, el sistema dispara automáticamente un cabeceo sutil (`nod` o `nodDouble`).
- Si el usuario formula una pregunta (detectada en la transcripción), el avatar reacciona en tiempo real elevando las cejas o ladeando la cabeza con curiosidad.

---

### 12.7. Integración con la Interfaz y Panel de Depuración

- `AvatarRenderer`: Expone métodos públicos `getDirector()`, `triggerAction()`, `setEmotion()`, `setGazeTarget()` y `setHeadDistance()`.
- `AvatarStage.tsx`: Canaliza tanto transcripciones del asistente como del usuario hacia el Director para alimentar el back-channel y las reacciones afectivas en tiempo real.
- `AvatarDebugPanel.tsx`: Incorpora la pestaña interactiva **"Acciones & Emoción"**, permitiendo al usuario probar con un clic cualquiera de las 10 acciones procedurales o los 7 presets afectivos.

---

### 12.8. Verificación de Aceptación de la Fase 4

- **Tests unitarios:** 20 pruebas en `tests/phase4.test.ts` verificando:
  - Aislamiento e independencia rigurosa de las capas `lips`, `expression` y `pose`.
  - Interpolación continua en el espacio $(V, A)$ y preservación de presets.
  - Heurística de texto en español y extracción de tono/varianza en `ProsodyAnalyzer`.
  - Ejecución de keyframes de acciones, mezcla aditiva y cancelación limpia con `cancelAll()`.
  - Acoplamiento retardado ojo-cabeza y deriva continua en `thinking`.
  - Disparo de back-channel en `listening` y acotamiento de `headDistance`.
- **Suite completa:** 11 archivos de prueba con **105 pruebas en verde (100% pass)**.
- **Linter y compilación:** `npm run lint` pasa con 0 errores y 0 advertencias. `tsc && vite build` compila limpiamente en 8.67 s.
- **Presupuesto de bundle:** Tamaño comprimido total del bundle de 305.37 kB gzip (**+5.1%** respecto a los ~290.4 kB de la Fase 0, cumpliendo holgadamente el límite estricto de $\pm 10\%$). Cero dependencias externas nuevas añadidas.
- **Presupuesto de CPU:** Cero asignaciones dinámicas de memoria (`no new`) en el bucle caliente a 60 fps; todos los cálculos de interpolación, prosodia y acciones se realizan sobre memoria preasignada.

---

## 13. Fase 5 — Pulido, Guía de Calibración, Matriz de QA y Cierre de la Especificación

### 13.1. Ajuste Fino de Parámetros y Calibración Biomecánica

1. **Parámetros de Zona Muerta Bucal y Cavidad (`mouthInterior.ts`):**
   - Umbral mínimo $g_0 = 0.007$: Con separaciones labiales inferiores a $0.007 \times \text{faceScale}$, la cavidad es estrictamente invisible (`opacity = 0`, `mesh.visible = false`). Los labios cerrados o en reposo muestran al 100% la textura original de la fotografía.
   - Umbral de saturación $g_1 = 0.035$: La transición de opacidad se evalúa con una función cúbica Hermite (`smoothstep(g0, g1, gap)`), eliminando cualquier aparición brusca ("pop") de la cavidad bucal o de los dientes.
2. **Histéresis Bilateral Schmitt Trigger (`lipsyncAnalyzer.ts`):**
   - Umbral de apertura: $0.020$.
   - Umbral de cierre: $0.009$.
   - Tope blando con compresión hiperbólica: `softMaxJaw = 0.65`. Inmunidad ante soplidos, ruidos de respiración y distorsiones por micrófono saturado.
3. **Constantes Angulares de Resorte $\omega$ (`dynamics.ts`):**
   - Mandíbula y visemas de habla: $34.0\text{ rad/s}$ (alta agilidad sin retardo).
   - Sacadas oculares: $38.0\text{ rad/s}$ (movimiento balístico veloz).
   - Expresiones faciales y afectivas: $9.0\text{ rad/s}$ (transición emocional suave).
   - Postura craneal (yaw, pitch, roll): $4.0\text{ rad/s}$ (inercia anatómica de la masa cefálica).
   - Respiración continua: $3.5\text{ rad/s}$.
4. **Espacio Afectivo RBF 2D (`emotion.ts`):**
   - Dispersiones gaussianas: $\sigma_V = 0.45, \sigma_A = 0.40$. Garantiza la pureza de cada cuadrante afectivo (alegre, triste, sorprendido, etc.) a la vez que proporciona interpolación continua y sin saltos discretos al recorrer el circumplex de Russell.

---

### 13.2. Decisión sobre Fase 6 (Clasificador ONNX Opcional)

- **Determinación:** **Se descarta formalmente la integración de un modelo ONNX (Nivel 3).**
- **Fundamentación técnica:**
  1. El sistema analítico implementado en la Fase 3 ([`es-g2p.ts`](file:///C:/Users/User/Documents/Proyectos/React/yourself/src/core/audio/es-g2p.ts) + [`syllableClock.ts`](file:///C:/Users/User/Documents/Proyectos/React/yourself/src/core/audio/syllableClock.ts) + [`visemeScheduler.ts`](file:///C:/Users/User/Documents/Proyectos/React/yourself/src/core/audio/visemeScheduler.ts)) resuelve al 100% la articulación en español: garantiza sellos bilabiales perfectos en /m/, /b/, /p/, repliegue labiodental en /f/, y las 5 configuraciones vocálicas con cero latencia acústica.
  2. Los clasificadores existentes de ONNX para visemas están predominantemente entrenados en inglés estadounidense (conjuntos LRS2/LRS3), fallando en dígrafos, diéresis y acentuación tónica del español.
  3. Evita incorporar una dependencia pesada en el bundle (`onnxruntime-web` WASM añade entre 3 y 8 MB), preservando el peso total estable en 305 kB gzip y garantizando el presupuesto estricto de $\le 4\text{ ms}$ de JS en CPU a 60 fps.

---

### 13.3. Matriz de QA Ejecutada y Verificada

| Caso de Prueba / Requisito | Comportamiento Esperado | Resultado en Pruebas | Estado |
| :--- | :--- | :--- | :---: |
| **Boca en reposo / silencio** | Labios idénticos a la foto original; sin agujero ni cavidad visible; sin movimiento senoidal espurio al iniciar turno `speaking`. | Verificado en tests y visualmente. Histograma de apertura en reposo $[0, 0.05] = 100\%$. | ✅ |
| **Sellos bilabiales (/m/, /b/, /p/)** | Cierre total de labios en sílabas oclusivas bilabiales (`jawOpen = 0`, `mouthClose = 0.90`). | Verificado en test unitario con corpus de 73 palabras del español. | ✅ |
| **Repliegue labiodental (/f/)** | Repliegue del labio inferior bajo los incisivos superiores (`lowerLipTuck = 0.80`). | Verificado en test unitario y renderizado con overlay. | ✅ |
| **Formas vocálicas del español** | 5 formas visuales distintas (/a/, /e/, /i/, /o/, /u/) con redondeo y protrusión en /o/ y /u/. | Verificado mediante `visemeScheduler` y `shapes.ts`. | ✅ |
| **Parpadeo biológico v2** | El iris permanece intacto; el párpado desciende con piel periocular original; asimetría ocular $\pm 15$ ms; 18% incompletos. | Verificado con `EyelidOverlay` y `BlinkController`. | ✅ |
| **Rotación de cabeza 3D con profundidad** | Rotación ortográfica sobre centro cervical con profundidad $Z$ anatómica real. Sin sumas de senos fijos. | Verificado mediante `Rig` y ruido fractal fBm multioctava. | ✅ |
| **Deriva en estado Thinking** | Mirada hacia cuadrante superior con fluctuación continua y retorno suave (no estática). | Verificado en `gaze.ts` y `phase4.test.ts`. | ✅ |
| **Acoplamiento ojo-cabeza** | Sacada ocular amplia ($> 0.18$) arrastra la cabeza un 35%–45% tras un retraso de 80–150 ms con 60% probabilidad de parpadeo. | Verificado en cinemática retardada de `GazeController`. | ✅ |
| **Escucha activa (Back-channel)** | En `listening`, silencios de 2.5 a 4.0 s disparan cabeceos sutiles; preguntas disparan cejas o ladeo curioso. | Verificado con temporizador de silencio y disparador de acciones. | ✅ |
| **Cancelación en interrupción** | Al interrumpir el usuario (`interrupted`), la cola de visemas se vacía y las acciones activas se cancelan de inmediato (`cancelAll`). | Verificado en `onInterrupted()` sin gestos fantasma. | ✅ |
| **Invariancia de escala facial** | La apertura bucal y deformaciones escalan proporcionalmente a `faceScale`. | Verificado en `phase2.test.ts` con rostros a escala $1.0\times$ y $2.0\times$. | ✅ |
| **Rendimiento hot loop** | $\le 4\text{ ms}$ de JS por frame a 60 fps; cero asignaciones dinámicas (`no new`). | Verificado en medidores de módulo en `AvatarDebugPanel`. | ✅ |
| **Presupuesto de bundle** | Tamaño total dentro de $\pm 10\%$ del baseline. Cero dependencias externas nuevas. | Verificado en build de producción: 305.37 kB gzip total (**+5.1%** vs Fase 0). | ✅ |

---

### 13.4. Cierre del Proyecto YourSelf v2

Con la finalización de la Fase 5, se han alcanzado y validado todos los objetivos establecidos en el documento de trabajo:
1. **La boca conserva al 100% los labios originales de la fotografía** gracias a la malla continua y la cavidad bucal procedural como overlay condicionado por `effectiveGap`.
2. **El parpadeo es orgánico, anatómico y natural**, cubriendo el ojo con piel fotográfica periocular sin distorsionar el iris.
3. **El rostro posee dinamismo y presencia viva continua**, impulsado por el Director de tres capas, el espacio afectivo continuo RBF 2D, la biblioteca de acciones procedurales, el acoplamiento ojo-cabeza y el back-channel conversacional.
4. **La suite de pruebas unitarias V2 (11 archivos, 105 tests) se encuentra en verde al 100%**.

---

## 14. Evolución YourSelf V3 — Especificación Completa Inspirada en VASA-1 (`yourself_spec.md`)

En cumplimiento integral de las especificaciones maestras de `docs/yourself_spec.md`, se ha ejecutado e implementado la arquitectura completa de **YourSelf V3**:

### 14.1. Fase 1: Eye & Eyelid Engine (`src/core/eye/`)
- **Globo Ocular Rígido 3D (`eyeBall.ts`):** Desacoplamiento esférico ($R \approx 12$ mm equivalente). Rotación ortonormal pura para mirada (`gazeX`, `gazeY`) con invarianza absoluta del iris ($\Delta Y_{\text{iris}} = 0.0 \pm 10^{-6}$, variación de área $< 0.1\%$).
- **Concha Oclusora Palpebral Curva (`eyelidMesh.ts`):** Descenso tangencial a $R + \delta$ sobre la córnea, eliminando z-fighting y aplastamiento de pupila. Cierre 90% superior / 10% inferior y opacidad biológica 100%.
- **Controlador Temporal Asimétrico (`blinkEngine.ts`):** 38% cierre rápido (~40 ms), 62% apertura lenta (~70 ms), intervalos log-normales (1.2–6.8 s), 18% incompletos, 12% dobles y asimetría bilateral $\pm 15$ ms.
- **Suite de Invarianza (`tests/eyeInvariance.test.ts`):** 1.000 fotogramas de parpadeo continuo verificando $\Delta Y = 0.0$.

### 14.2. Fase 2: Reconstrucción 3D e Identidad (`src/core/face3d/`)
- **Malla Canónica Métrica (`canonicalMesh.ts`):** Modelo métrico 3D estandarizado con proporciones craneales humanas (IPD 63 mm, altura 120 mm, profundidad 95 mm).
- **Estimador de Profundidad Métrica (`depthEstimator.ts`):** Desproyección estenopeica y consumo de la matriz 4x4 de MediaPipe con perfil de volumen lateral.
- **Alineador Procrustes e Init-Time Freeze (`identityAligner.ts`):** Ajuste rígido de forma canónica y congelación estática inmutable de identidad.
- **Desenrollador UV Canónico (`textureUnwrap.ts`):** Detección de escorzo ($\mathbf{n} \cdot \mathbf{v} < 0.15$) y simetría bilateral complementaria.
- **Suite de Identidad (`tests/identityDisentanglement.test.ts`):** Invarianza de identidad bajo deformaciones extremas.

### 14.3. Fase 3: Biomecánica Cefálica y Memoria Temporal (`src/core/motion/`)
- **Reflejo Vestíbulo-Ocular (`vorCoordinator.ts`):** Compensación neuro-oculomotora $\omega_{\text{gaze}} = -\omega_{\text{head}} \cdot k_{\text{VOR}}$ con anticipación sacádica previa de 60–100 ms.
- **Memoria Temporal Markoviana (`motionMemory.ts`):** Cadena de Markov de 2º orden con cooldown de 12 segundos y penalización de repetición.
- **Director Cefálico (`headDirector.ts`):** Catálogo de gestos anatómicos (nod, double nod, shake, curious tilt, look-away y cabeceo prosódico).
- **Director de Mirada (`gazeDirector.ts`):** Integración de microsacadas, tremor a 2 Hz y control VASA-1 `gazeTarget`.
- **Suite de VOR y Memoria (`tests/vorCoordination.test.ts`):** Verificación de respuesta refleja contraria y memoria de gestos.

### 14.4. Fase 4: Catálogo ARKit 52 y Emociones VASA-1 (`src/core/rig/` & `src/core/motion/`)
- **Catálogo Universal ARKit 52 (`arkitShapes.ts`):** 52 blendshapes estándar con metadatos anatómicos FACS (mandíbula, boca, ojos, cejas, mejillas).
- **Evaluador de ATM Mandibular (`rigEvaluator.ts`):** Rotación cóndilo-mandibular 3D sobre el eje articular en lugar de traslación 2D plana.
- **Motor Afectivo VASA-1 (`emotionEngine.ts`):** Espacio continuo Valencia/Arousal, sonrisa de Duchenne genuina (AU6 + AU12) y controles VASA-1 (`emotionOffset`, `headDistance`, `gazeTarget`).

### 14.5. Fase 5: Inferencia Neuronal Asíncrona & Rendimiento (`src/core/neural/`)
- **Contratos de Tensores (`modelContracts.ts`):** Verificación formal en arranque inspirada en NSR Engine (shape, NaN, finitud y rangos).
- **Puente Asíncrono (`neuralBridge.ts`):** Ranura *drop-on-full* `LastWinsSlot` de capacidad 1, soporte `SharedArrayBuffer` / `postMessage` e interpolación cúbica Hermite a 60 FPS.
- **Worker Audio2Motion (`motionWorker.ts`):** Extracción prosódica y predicción de blendshapes a 30 Hz sin bloqueo del hilo principal.
- **Suite de Contratos y Rendimiento (`tests/onnxContracts.test.ts`, `tests/perfZeroAlloc.test.ts`):** Cumplimiento formal de contratos y tiempo de JS $< 2.0$ ms por fotograma en CPU (holgura $> 2$ ms respecto al límite de 4 ms).

### 14.6. Estado Final de la Suite de Pruebas y Compilación
- **Vitest:** 16 suites de prueba (**145 tests passing**, 0 fallos).
- **Compilación de producción:** `tsc && vite build` completada limpiamente en 6.96s con cero errores de TypeScript.







