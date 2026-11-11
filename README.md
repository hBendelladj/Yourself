# YourSelf 🎭 — Real-Time 3D Conversational Avatar from a Single Photo

[![Live Demo on Netlify](https://img.shields.io/badge/Live_Demo-Netlify-00C7B7?style=for-the-badge&logo=netlify&logoColor=white)](https://creative-sawine-ce7b5b.netlify.app/settings)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Contributions Welcome](https://img.shields.io/badge/Contributions-Welcome-brightgreen.svg)](CONTRIBUTING.md)
[![React 19](https://img.shields.io/badge/React-19.0-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-0.186-black?logo=three.js&logoColor=white)](https://threejs.org/)
[![Gemini Multimodal Live API](https://img.shields.io/badge/Gemini-Multimodal_Live_API-4285F4?logo=google&logoColor=white)](https://ai.google.dev/)
[![MediaPipe](https://img.shields.io/badge/MediaPipe-FaceLandmarker-00A98F?logo=google&logoColor=white)](https://developers.google.com/mediapipe)
[![Tests Passing](https://img.shields.io/badge/Tests-267%20Passing%20(33%20suites)-34D399)](#-automated-testing-and-acceptance-criteria)

> **Transform a single 2D photograph into an expressive, photorealistic 3D conversational avatar powered by real-time voice through Gemini Live — running 100% locally on the browser's CPU and WebGL at 60 FPS.**

🚀 **Try the Live Web Demo:** **[https://creative-sawine-ce7b5b.netlify.app/settings](https://creative-sawine-ce7b5b.netlify.app/settings)** 🚀

---

## 🎬 Demo Video in Action

Watch **YourSelf** animate with live bidirectional voice conversation, realistic lipsync, natural head movement, and procedural teeth & eyes:

<a href="https://youtu.be/N2AnW9WavoM" target="_blank" rel="noopener noreferrer">
  <img src="https://img.youtube.com/vi/N2AnW9WavoM/maxresdefault.jpg" alt="YourSelf Demo Video" width="100%" />
</a>

<p align="center">
  👉 <a href="https://youtu.be/N2AnW9WavoM" target="_blank" rel="noopener noreferrer"><b>Click here to watch the full demo on YouTube</b></a> 👈
</p>

---

## 💖 Support the Project / Donate via Binance

If you find **YourSelf** impressive and want to support its continued open-source development, improvements, and research, you can support the creator directly via Binance Pay using the Binance ID: **[<u>987988644</u>](https://www.binance.com)**.

*Every donation helps maintain this project completely open-source, serverless, and privacy-first. Thank you immensely for your generosity!* 🙏

---

## 💡 What Makes YourSelf Unique?

Unlike massive server-side video diffusion models (such as VASA-1, EMO, or Hallo) that demand expensive cloud GPUs, high latency, and heavy bandwidth, **YourSelf v4** executes its entire pipeline **locally inside the user's browser on CPU and integrated GPU**:

- **Zero Server Latency for Animation**: Visual morphing, bone deformation, and acoustic analysis run client-side in real time at **60 FPS**.
- **Ultra-Strict Performance Budget**: $\le 4.0\text{ ms}$ of JavaScript computation per frame with **zero memory allocations** (`zero-allocation`) during the hot animation loop.
- **Privacy First (100% Local Processing)**: Your uploaded photograph never leaves your device. Only streaming microphone PCM audio is sent securely and directly to Google's Gemini Multimodal Live API.
- **Biomechanical Anatomical Realism**: Not just 2D image morphing — a true multi-layered 3D head model with condylar TMJ jaw rotation, acoustic LPC formant tracking, physiological eyelids, and a 3D mouth cavity with stencil buffer occlusion.

---

## 🌟 Rig v4 Architecture & Key Features

YourSelf v4 introduces major biomechanical and acoustic breakthroughs:

### 1. 🦴 Bone-Based Condylar TMJ Jaw (Algorithm A)
- Real temporomandibular joint (TMJ) rotation around the anatomical condylar hinge axis:
  $$c = \frac{1}{2}(\mathbf{L}_{234} + \mathbf{L}_{454}) + (0, 0.05W, -0.10W)$$
- True vertical lever arm radius $r = \|\mathbf{L}_{152} - c\|$ with condylar forward translation $\tau_z$.
- **Linear Blend Skinning (LBS)** with Laplacian weight diffusion — eliminates unnatural spherical chin swelling.

### 2. 🌌 Multi-Layer 3D Head & Push-Pull Inpainting (Algorithm C)
- 5 stratified depth layers: Face (1.0), Hair with ellipsoid depth (0.95), Cervical neck cylinder (0.50), Shoulders (0.15), and Static Background (0.0).
- Multi-scale **Push-Pull Inpainting on CPU**: dynamically fills occluded regions revealed during yaw turns up to $\pm 32^\circ$ with zero seams.
- **Umeyama SVD Metric Alignment**: exact orthonormal 4×4 decomposition from MediaPipe landmarks, preserving natural facial proportions.

### 3. 🦷 Realistic Procedural Teeth Atlas & 3D Stencil Mouth (Algorithm D)
- High-fidelity **pure procedural teeth atlas** (`teethAtlas.ts`): continuous ivory enamel band with zero transparent interdental gaps (`alpha = 255`).
- **Subtle Gaussian valleys** ($8\text{--}15\%$ darkening, minimum valley luminance $\ge 80\%$) that fade smoothly toward the gum line.
- **Anatomical 10-tooth arch grids**: 25 columns × 4 rows (upper) and 21 columns × 4 rows (lower) that continuously follow the natural curvature of the inner lip smile line via piecewise linear interpolation.
- **3D Stencil Buffer Cavity**: Upper teeth anchored to the cranium, lower teeth anchored to the jaw, and a 2-DOF 3D tongue (elevation + protrusion) rendered behind the teeth with 0% edge clipping at $45^\circ$ angles.
- Robust color correction guaranteeing clean warm ivory enamel (`#F3EEE4`), even when using low-light or mouth-closed photos.

### 4. 🎙️ Order-12 LPC Formant Acoustics & Coarticulation (Algorithms E & F)
- Real-time Linear Predictive Coding (**LPC Order-12**) via Levinson-Durbin recursion and Durand-Kerner polynomial root-finding for F1 and F2 formant extraction in Spanish phonemes.
- Fricative energy band detection ($> 4\text{ kHz}$) for sibilants (/s, θ, f/).
- **Cohen-Massaro continuous coarticulation** with anticipatory bilabial closures (/p, b, m/) achieving $\ge 90\%$ lip closure before acoustic release.

### 5. 🧠 Alive Stochastic Head Kinematics (Algorithm G)
- **Coupled Pitch-Jaw dynamics** ($r_{p,j} \approx 0.34$): nodding gestures naturally synchronize with spoken emphasis.
- **Ornstein-Uhlenbeck stochastic drift**: subtle micro-movements (40% amplitude during idle periods) so the avatar never feels frozen or artificial during silence.
- **Laplace leptokurtic distribution**: natural velocity bursts (kurtosis $> 3.0$) calibrated against 2,950 ground-truth video frames.

### 6. 👁️ Biomechanical Eyelid Shell & Corneal Decoupling (Algorithm H)
- Continuous periocular skin mesh with $\ge 1.5\text{ px}$ feathering and safety overlap ($0.003 \cdot \text{faceScale}$), completely preventing black clearColor leaks on eye closure.
- **Gaze-eyelid synergy**: $\Delta\text{lid} \approx 0.5 \cdot \max(0, -gazeY)$.
- Log-normal stochastic blinking with physiological durations ($100\text{--}200\text{ ms}$).

---

## 🗂️ Project Directory Structure

```
yourself/
├─ public/
│  ├─ mediapipe/              # Local MediaPipe FaceLandmarker task and WASM runtime
│  └─ favicon.svg             # App icon
├─ src/
│  ├─ app/
│  │  ├─ App.tsx              # Main application shell with navbar routing (/settings <-> /avatar)
│  │  └─ routes.ts            # URL query and static path synchronization
│  ├─ components/
│  │  ├─ AvatarStage.tsx      # WebGL Three.js canvas, perspective camera, and live session stream
│  │  ├─ AvatarDebugPanel.tsx # Comprehensive real-time telemetry and diagnostics panel
│  │  ├─ SetupPanel.tsx       # Photo upload, landmark alignment, and character configuration
│  │  └─ ConversationBar.tsx  # Gemini Live bidirectional voice controls and audio visualizer
│  ├─ core/
│  │  ├─ animation/           # Head director, blink controller, gaze, and Russell emotion engine
│  │  ├─ audio/               # LPC Formants, Cohen-Massaro coarticulation, G2P, and syllable clock
│  │  ├─ eye/                 # Biomechanical eyelid mesh, pupil invariance, and eye engine
│  │  ├─ face/                # Photo profile calibrator, landmark groups, and resting lips
│  │  ├─ face3d/              # Canonical mesh, layers, depth estimator, and CPU inpainting worker
│  │  ├─ live/                # Gemini Multimodal Live client, Spanish voice personas, and PCM streaming
│  │  ├─ render/              # Mouth3D with stencil buffer, procedural teeth atlas, and avatar renderer
│  │  └─ rig/                 # Jaw bone, TMJ kinematics, and Newton-Raphson closed loop
│  ├─ lib/                    # Shared constants, types, and math utilities
│  └─ store/
│     └─ session.ts           # Centralized Zustand reactive application state
├─ docs/
│  ├─ V4_ALGORITMOS.md        # Comprehensive mathematical specifications and algorithmic derivations
│  └─ reference_stats.json    # Calibrated empirical statistics from video ground-truth
└─ tests/                     # 33 unit and acceptance test suites (267 passing tests, 100% green)
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v18.0.0 or higher (v20 or v22 LTS recommended).
- **npm**: v9.0.0 or higher.
- A modern web browser with **WebGL 2.0** and **Web Audio API** support (Chrome, Edge, Firefox, Brave, Safari).
- A free **Google Gemini API Key** from [Google AI Studio](https://aistudio.google.com/app/apikey).

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/jhordy2004/Yourself.git
   cd yourself
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Fetch MediaPipe model assets & WASM files:**
   *(Runs automatically via `predev` / `prebuild`, or execute manually)*:
   ```bash
   npm run fetch-assets
   ```

4. **Launch development server:**
   ```bash
   npm run dev
   ```

5. Open your browser at:
   ```
   http://localhost:5173
   ```

---

## ⚙️ Usage & Navigation

1. **Step 1 — Upload a Portrait Photo**:
   - Go to `/settings`.
   - Drag & drop or select a front-facing portrait (PNG, JPG, JPEG up to 8 MB).
   - MediaPipe automatically detects 478 3D landmarks in under 300 ms.
2. **Step 2 — Set Character Name & Voice**:
   - Give your avatar a name (e.g. *Sophie*, *Lucas*, *Elena*).
   - Select the avatar's voice: **Kore** (warm, expressive female), **Aoede** (soft, melodic female), **Puck** (natural male), or **Fenrir** (deep male).
3. **Step 3 — Enter Your Gemini API Key**:
   - Paste your free Gemini API Key (`AIzaSy...`). It stays exclusively in local browser memory and is never logged or transmitted to third-party servers.
4. **Step 4 — Start Conversing**:
   - Click **"Ver Avatar Animado (Comenzar)"**.
   - Speak naturally through your microphone. Gemini responds with instant low-latency speech, while YourSelf synchronizes realistic lipsync, blinking, teeth display, and expressive head gestures in real time!

### 🔧 Useful URL Query Parameters
- `http://localhost:5173/avatar?v4=&rig=v4`: Loads the avatar directly with the advanced Rig v4 engine.
- `http://localhost:5173/avatar?teethDebug=1`: **Teeth Inspection Mode** — cycles mouth opening between small, medium, and wide every 2 seconds without requiring audio or an API key.
- `http://localhost:5173/avatar?debug=1`: Opens the full real-time diagnostics HUD overlay (`AvatarDebugPanel`).

---

## 🧪 Automated Testing and Acceptance Criteria

YourSelf features a rigorous test suite covering all biomechanical algorithms, mathematical derivations, zero-allocation memory constraints, and acceptance criteria:

```bash
# Run the complete test suite (33 test files, 267 tests)
npm test

# Run the strict Rig v4 Acceptance Criteria test
npx vitest run tests/v4_acceptance.test.ts

# Run ESLint validation (0 errors)
npm run lint

# Production build and bundle size verification
npm run build
```

### Verified Acceptance Criteria (`tests/v4_acceptance.test.ts`):
1. **Pure Vertical Mandibular Descent**: Pure vertical jaw drop without radial bulging; cheekbones and nose remain completely still.
2. **Newton-Raphson Closed-Loop Lip Aperture**: At `jawOpen = 0.3`, normalized lip opening $c_{\text{lip}} / W \in [0.07, 0.10]$; resting lips close hermetically ($g < 0.004 \cdot W$).
3. **Bilabial Occlusion & Formant Tracking**: $\ge 90\%$ lip closure during /p, b, m/; F1 and F2 formants recovered with $< 8\%$ relative error.
4. **Physiological Cephalic Kinematics**: RMS Yaw 2–10°, Pitch 4.5–8°, Roll 3–8.5°; pitch-jaw correlation $0.20\text{--}0.50$; living non-frozen resting drift.
5. **Photorealistic Eyelid Action**: 100–200 ms blink duration; 0% exposed clearColor pixels on full closure; gaze-eyelid synergy verified.
6. **3D Multi-Layer Yaw Turns**: At $\pm 20^\circ$ yaw and $\pm 12^\circ$ pitch, 0 inverted triangles and mesh stretch $\le 2.5\times$; Push-Pull inpainting seamlessly fills newly exposed background regions.
7. **3D Stencil Mouth Cavity**: At $45^\circ$ profile view, teeth and tongue remain strictly confined within the mouth cavity with zero light leaks; $Z$-axis lip protrusion in pucker verified within $[0.10, 0.15] \cdot IOD$.
8. **CPU Budget & Bundle Size**: JavaScript computation time $< 4.0\text{ ms}$ per frame at 60 FPS; zero heap allocations during animation; production bundle gzip size well within budget.

---

## 🤝 Contributing

We welcome contributions from graphics engineers, audio specialists, and developers worldwide! You are fully encouraged to use AI coding assistants (**Claude, Antigravity, Cursor, Codex**, etc.).

**Our Core Policy:** We aim to match the fidelity of systems like Microsoft's VASA-1 **using pure mathematics, geometry, and algorithms — strictly without heavy neural diffusion models** — so anyone can run it on everyday hardware at 60 FPS.

Please review our [**Contributing Guidelines (CONTRIBUTING.md)**](CONTRIBUTING.md) for architecture details, high-impact areas, and code standards.

---

## Author's Words

Why did I create this project? Well, one day, out of nowhere, I started imagining what it would be like to talk to Sweetie Fox, and that's where the idea came from. So I thought, why not make it a reality? Hahaha!

Actually, the test image I used throughout the entire development of this project was a picture of this actress, and well, that's pretty much why I created this project. :)

---

## 📄 License

This project is open-source and licensed under the **[MIT License](LICENSE)**.
