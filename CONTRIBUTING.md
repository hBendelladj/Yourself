# Contributing to YourSelf 🎭

Thank you for your interest in contributing to **YourSelf**! 

Whether you are a Three.js graphics programmer, a WebGL wizard, an acoustic/DSP engineer, or an enthusiast of real-time conversational agents, your ideas and contributions are welcome.

---

## 🎯 Our Core Philosophy & Non-Negotiable Policy

### ⚡ The "VASA-1 Through Pure Mathematics" Rule

The overarching vision of **YourSelf** is to achieve the lifelike expressiveness, natural head kinematics, dynamic gaze, and conversational realism demonstrated by server-heavy diffusion models like **Microsoft's VASA-1** — **WITHOUT using heavy AI video models, neural diffusion pipelines, or dedicated cloud GPUs.**

> [!IMPORTANT]
> ### 📜 The Fundamental Policy:
> 1. **Pure Mathematics and Algorithmic Geometry Only:** All visual deformations, mesh morphing, bone kinematics, eye dynamics, and lip-sync coarticulation must be driven by pure mathematical formulas, biomechanical models, and WebGL shaders/buffers.
> 2. **No Heavy Neural Models:** Do not introduce PyTorch, ONNX video generators, diffusion models, or server-side GPU processing.
> 3. **Run on Any Everyday Laptop:** Any user with a modest, standard computer (even with integrated graphics) must be able to compile and run this project smoothly at **60 FPS**.
> 4. **Strict Performance Budget:** The render loop must respect a computation budget of $\le 4.0\text{ ms}$ of JavaScript per frame, with **zero heap allocations (`zero-allocation`)** during hot animation frames.

---

## 🤖 AI Coding Tools Are Welcomed and Encouraged!

You are completely free and encouraged to use modern AI coding assistants and code generators — including **Claude, Antigravity, Cursor, OpenAI Codex, ChatGPT, GitHub Copilot**, or any other tool.

**However, with great power comes great responsibility:**
- **Add Value, Not Bugs:** Every contribution must bring genuine improvements, cleaner mathematics, or new features. We do not accept unverified, broken, or low-effort AI dumps.
- **Understand What You Submit:** Ensure you fully understand the code you submit, verify that it adheres to our zero-allocation performance rules, and ensure all automated tests pass before opening a pull request.

---

## 🚀 High-Impact Areas Where You Can Contribute

We are actively seeking contributions in the following domains:

### 1. 🌐 Full 3D Head Rotation & Multi-Angle Depth
- **Current state:** The avatar gracefully supports head yaw up to $\pm 32^\circ$ with 5 depth layers (Face, Hair, Neck, Shoulders, Background) and multi-scale Push-Pull inpainting.
- **Contribution Opportunity:** Enhance the 3D canonical mesh or cylindrical/spherical projection so the avatar can rotate its head seamlessly in all directions (wide yaw, steep pitch, dynamic roll) with natural neck flexion and hair parallax without stretching or edge artifacts.

### 2. 🎭 Rich and Nuanced Facial Expressions
- **Current state:** Basic emotional valence/arousal mapping with core visemes and resting micro-expressions.
- **Contribution Opportunity:** Expand the procedural expression engine to support rich, distinct emotional states based on FACS (Facial Action Coding System):
  - **Sadness** (drooping eyelids, inner brow raiser, mouth corner depressor).
  - **Fear / Anxiety** (widened eyes, stretched lips, raised tense brows).
  - **Joy & Laughter** (cheek raiser, realistic crow's feet wrinkles, smile dimplers).
  - **Playful / Amused / Mischievous** (asymmetric smirks, cocked eyebrow, micro-winks).
  - **Surprise & Curiosity** (dropped jaw, arched high brows).

### 3. 📐 Advanced Procedural Mathematics & Biomechanics
- Refine spring-damper equations and critically damped responses for head and eye motion.
- Improve the mathematical modeling of skin elasticity and fold lines around the nasolabial crease during extreme smile/frown shapes.
- Improve the condylar temporomandibular joint (TMJ) kinematics and lip contact dynamics.

### 4. 👄 Enhanced Lip-Sync & Acoustic Signal Processing
- Improve Spanish (and multilingual) phonetic G2P (grapheme-to-phoneme) and acoustic formant extraction (LPC Order-12, Levinson-Durbin, Durand-Kerner).
- Enhance anticipatory coarticulation and bilabial plosive closures (/p, b, m/) for even crisper speech synchronization.

### 5. 🎙️ Natural Voice Integrations & Expressive Audio
- Explore and integrate alternative or enhanced voice APIs, real-time WebRTC/WebSocket audio pipelines, or high-fidelity conversational audio protocols that offer more emotional, nuanced, and human-sounding voices while keeping client resource consumption minimal.

---

## 🛠️ Development Setup & Standards

### 1. Setup Your Environment
```bash
# Clone your fork
git clone https://github.com/<your-username>/yourself.git
cd yourself

# Install dependencies
npm install

# Fetch local runtime assets (MediaPipe WASM and models)
npm run fetch-assets

# Start development server
npm run dev
```

### 2. Quality Verification Checklist

Before submitting any Pull Request, ensure that:

- [ ] **Tests pass 100%:** Run `npm test` (`vitest run`). All existing test suites must remain green.
- [ ] **Add new tests:** If you add a new feature or mathematical model, include unit or acceptance tests in `tests/`.
- [ ] **Linting is clean:** Run `npm run lint` (`eslint .`) with **0 errors**.
- [ ] **Production build succeeds:** Run `npm run build` (`tsc && vite build`) without TypeScript errors.
- [ ] **Zero allocations in animation loop:** Do not create objects (`new Object()`, `{}`, `[]`, `new Vector3()`, closures) inside `update()` or per-frame render routines. Preallocate reusable memory in the class constructor or module scope.

---

## 📦 Pull Request (PR) Process

1. **Create a descriptive feature branch:**
   ```bash
   git checkout -b feature/improved-3d-head-rotation
   ```
2. **Commit your changes with clear messages:**
   ```bash
   git commit -m "feat(render): enhance multi-layer depth projection for wide-angle yaw rotation"
   ```
3. **Push to your fork and submit a PR:**
   - Clearly describe what problem your PR solves or what value it adds.
   - If your change affects visual appearance or animation, include screenshots, GIFs, or short video clips showing before and after.
   - Reference any relevant issues or discussions.

---

## 🌟 Code of Conduct & Spirit

We believe in open, respectful, curious, and ambitious collaboration. Let's push the boundaries of what browser-based math and WebGL can achieve without relying on bloated server infrastructure!

Happy coding! 🚀
