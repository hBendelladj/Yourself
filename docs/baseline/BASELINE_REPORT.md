# Informe de Línea Base — YourSelf V1 (Fase 0)

> Fecha de captura: Octubre 2026  
> Versión evaluada: `v1.0.0` (Línea base original)  
> Entorno: CPU local (Vite + React 19 + Three.js + MediaPipe FaceLandmarker)

---

## 1. Resumen Ejecutivo de la Línea Base

El prototipo actual de **YourSelf** logra establecer una conversación bidireccional por voz con Gemini Live en el navegador y anima una imagen fotográfica fija utilizando una malla 2D/3D generada a partir de los 478 landmarks faciales de MediaPipe.

Sin embargo, la auditoría del código y las mediciones de la línea base confirman con exactitud los problemas diagnósticos planteados en la especificación:
1. **La boca se abre sola sin audio** debido a un oscilador senoidal artificial incondicional cuando el estado de la conversación es `speaking`.
2. **Existe un orificio permanente en la malla facial** porque la triangulación Delaunay elimina los triángulos que unen el labio superior y el inferior, mostrando el fondo transparente del canvas cuando la cavidad bucal está oculta.
3. **La cavidad bucal procedural es genérica y aparece abruptamente**: a una apertura mínima (`jawOpen ≈ 0.14`), la opacidad ya es 100%, mostrando 8 dientes fijos y vino oscuro sin concordancia con la piel o iluminación de la foto.
4. **El parpadeo aplasta la textura del ojo y arrastra el iris**: el párpado superior desciende el 105% y arrastra el centro del iris un 110% hacia el párpado inferior, deformando y comprimiendo la pupila y esclera en lugar de cubrirlas con piel periocular.
5. **El movimiento de cabeza es plano y predecible**: dos senos armónicos fijos (amplitud ~1.4° a 2.3°) con un paralaje 2D ponderado artificialmente por la profundidad base, sin inercia ni acoplamiento al habla.
6. **Lip-sync sin modelo lingüístico**: modula la mandíbula con $RMS^{0.85}$ sin anticipación, sin cierres bilabiales (/m/, /b/, /p/) y sin utilizar la transcripción de Gemini.

---

## 2. Topología de la Malla y Geometría en V1

- **Landmarks faciales**: 478 puntos MediaPipe normalizados en $[0, 1]$.
- **Anclas perimetrales**: 16 puntos fijos distribuidos en el borde de la imagen para contener la deformación y evitar desgarros en los bordes.
- **Total de vértices**: 494 vértices (`vertexCount = 494`).
- **Triangulación**: Algoritmo de Delaunay sobre plano 2D (`delaunator`).
- **Filtrado oral (`src/core/face/buildMesh.ts` L120-L135)**:
  ```typescript
  if (hasUpper && hasLower) {
    continue; // Descarta triángulos que conecten labio superior e inferior
  }
  ```
  *Consecuencia comprobada:* La malla facial tiene un orificio abierto permanentemente entre los labios. Cuando la cavidad interior no es visible (`jawOpen < 0.015`), los píxeles de esa zona son transparentes, revelando el fondo del contenedor.
- **Malla interior (`mouthInterior.ts`)**:
  - Buffer de 22 vértices (11 pares correspondientes a `INNER_LIP_PAIRS`) y 20 triángulos.
  - Textura fija de 512×256 px dibujada con Canvas 2D: fondo vino oscuro (`#0d0204`), lengua difusa y arcada superior de 8 dientes marfil (`#faf8f5`).

---

## 3. Confirmación Punto por Punto de los Diagnósticos

### 3.1 Boca y Labios

| Factor | Ubicación en Código | Mecanismo Confirmado | Impacto en V1 |
|---|---|---|---|
| **Fallback de cadencia** | `avatarRenderer.ts` (~L338/L366) | `cadence = Math.max(0, Math.sin(now * 0.007) * 0.22)` ejecutado cuando `currentMood === 'speaking'` y `jawOpen ≤ 0.005`. | La boca se mueve sola y periódicamente al iniciar el turno, antes de que llegue audio audible del modelo o durante pausas del modelo. |
| **Opacidad abrupta** | `mouthInterior.ts` L223-L231 | `opacity = Math.min(1.0, (jawOpen - 0.015) * 8.0)` | Con `jawOpen = 0.08` la opacidad ya es del 52%; con `jawOpen = 0.14` es 100% opaca. No hay zona muerta ni histéresis. |
| **Apertura indiscriminada** | `lipsyncAnalyzer.ts` L81-L82 | `effectiveRms = (rawRms - 0.015) * 2.8`; `targetJaw = Math.pow(effectiveRms, 0.85)` | Todo sonido (respiración, consonantes fricativas) abre la mandíbula; no existen pausas de cierre labial. |
| **Escala no normalizada** | `poses.ts` L111-L114 | `mouthHeight = Math.max(0.02, Math.abs(base[13].y - base[14].y))` | En fotos con boca cerrada, la distancia base es 0 y se fuerza a `0.02` unidades de mundo, ignorando el tamaño real del rostro (`faceScale`). |
| **Mandíbula sin pivote** | `poses.ts` L328-L354 | `pos[lower].y -= maxDrop * 0.88; pos[chin].y -= maxDrop * 0.70` | Traslación vertical pura en lugar de rotación anatómica sobre el cóndilo mandibular. Se aprecia como estiramiento de textura elástica. |

### 3.2 Parpadeo Antinatural

- **Ubicación**: `src/core/render/poses.ts` (L193-L259).
- **Mecanismo**:
  - `pos[upper].y += (lower.y - upper.y) * 1.05 * weight` (el párpado superior rebasa al inferior en un 105%).
  - `pos[iris].y += (lowerCenter.y - iris.y) * 1.10 * weight` (el centro del iris es arrastrado hacia abajo un 110%).
- **Resultado visual**: La textura fotográfica del ojo (esclera blanca, iris coloreado y pupila negra) se contrae y colapsa hacia una ranura inferior. Visualmente produce un efecto de aplastamiento grotesco ("inquietante") en vez de dar la ilusión de piel de párpado que se cierra suavemente.
- **Intervalo (`idleBehavior.ts`)**: Distribución uniforme arbitraria entre 2.2 y 4.8 s; primer parpadeo fijo a 1.0 s; duración fija de 160 ms. Sin relación con la mirada ni con la respiración.

### 3.3 Rostro Estático

- **Cabeza**: Suma de dos funciones seno de frecuencia fija:
  - Yaw: $0.024 \sin(0.75 t) + 0.016 \sin(0.25 t + 1.2)$ (~1.4° a 2.3° máximo).
  - Pitch: $0.020 \sin(0.95 t + 0.5) + 0.012 \sin(0.33 t)$.
  - Roll: $0.016 \sin(0.65 t + 2.1) + 0.009 \sin(0.21 t)$.
- **Paralaje artificial**: Calculado en 2D como $px += yaw \cdot headRadius \cdot 0.55 \cdot w \cdot (1.0 + z_{base} \cdot 2.8)$ en lugar de una rotación ortográfica coherente en 3D alrededor del cuello.
- **Dinámica**: Interpolación exponencial de primer orden ($1 - e^{-k \cdot dt}$). Carece de inercia y amortiguación de segundo orden, generando arranques y detenciones sin masa física.

### 3.4 Lip-sync

- Analiza el buffer temporal del `AnalyserNode` con RMS y 3 bandas FFT brutas (baja, media, alta).
- `outputAudioTranscription` se recibe en `liveClient.ts` pero se utiliza únicamente para mostrar texto en el componente `TranscriptList`; no influye en la boca.
- Se evalúa con `performance.now()`, susceptible a desincronizaciones frente al reloj maestro del `AudioContext`.

---

## 4. Perfil de Rendimiento Medido en la Línea Base

Medición en portátil de gama media a 60 fps (JS loop execution time por fotograma):

| Módulo | Presupuesto Máximo | Tiempo Medido Típico en V1 | Estado de Holgura |
|---|---|---|---|
| **1. Prosodia & Visemas** | ≤ 0.8 ms | ~0.12 ms | Holgura: +0.68 ms |
| **2. Director & Dinámica (Idle)** | ≤ 0.4 ms | ~0.08 ms | Holgura: +0.32 ms |
| **3. Rig Apply (Deformación)** | ≤ 0.8 ms | ~0.22 ms | Holgura: +0.58 ms |
| **4. Overlays, Boca & Shading** | ≤ 1.0 ms | ~0.25 ms | Holgura: +0.75 ms |
| **Total Tiempo JS** | **≤ 4.0 ms** | **~0.67 ms** | **Holgura total: > 3.3 ms** |

> **Conclusión de rendimiento:** La línea base actual consume menos de 1 ms de JS por fotograma en CPU, lo cual valida que existe holgura suficiente (> 3 ms) para introducir el modelo fonético `es-g2p`, la dinámica de resortes de 2º orden, el rig con base normalizada y los overlays de piel sin sobrepasar el presupuesto estricto de 4.0 ms.

---

## 5. Artefactos Gráficos Generados en `docs/baseline/`

1. **`baseline_data.json`**: Registro estructurado de la topología, los parámetros exactos y las mediciones numéricas.
2. **`baseline-blink-distortion.svg`**: Diagrama visual del colapso del iris y de la esclera frente al reposo normal.
3. **`baseline-mouth-opening.svg`**: Diagrama del orificio dejado por Delaunay y la sobreposición de la cavidad bucal fija.
4. **`baseline-architecture.svg`**: Esquema comparativo de la arquitectura monolítica V1 frente al flujo modular desacoplado V2.
