import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const publicMediapipeDir = path.join(rootDir, 'public', 'mediapipe');
const nodeModulesWasmDir = path.join(
  rootDir,
  'node_modules',
  '@mediapipe',
  'tasks-vision',
  'wasm'
);

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const MODEL_DEST = path.join(publicMediapipeDir, 'face_landmarker.task');

async function main() {
  console.log('[fetch-assets] Ensuring public/mediapipe directory exists...');
  fs.mkdirSync(publicMediapipeDir, { recursive: true });

  // 1. Copy wasm runtime files from node_modules if present
  if (fs.existsSync(nodeModulesWasmDir)) {
    console.log('[fetch-assets] Copying wasm runtime from node_modules/@mediapipe/tasks-vision/wasm...');
    const files = fs.readdirSync(nodeModulesWasmDir);
    let copiedCount = 0;
    for (const file of files) {
      const srcFile = path.join(nodeModulesWasmDir, file);
      const destFile = path.join(publicMediapipeDir, file);
      const stat = fs.statSync(srcFile);
      if (stat.isFile()) {
        fs.copyFileSync(srcFile, destFile);
        copiedCount++;
      }
    }
    console.log(`[fetch-assets] Copied ${copiedCount} WASM/JS runtime files to public/mediapipe/`);
  } else {
    console.warn(
      `[fetch-assets] Warning: ${nodeModulesWasmDir} not found yet. Run npm install first.`
    );
  }

  // 2. Download face_landmarker.task if not present
  if (fs.existsSync(MODEL_DEST) && fs.statSync(MODEL_DEST).size > 1000000) {
    const stats = fs.statSync(MODEL_DEST);
    console.log(
      `[fetch-assets] face_landmarker.task already present (${(stats.size / (1024 * 1024)).toFixed(2)} MB). Skipping download.`
    );
  } else {
    console.log(`[fetch-assets] Downloading face_landmarker.task from ${MODEL_URL}...`);
    try {
      const res = await fetch(MODEL_URL);
      if (!res.ok) {
        throw new Error(`Failed to download model: HTTP ${res.status} ${res.statusText}`);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(MODEL_DEST, buffer);
      console.log(
        `[fetch-assets] Successfully downloaded face_landmarker.task (${(buffer.length / (1024 * 1024)).toFixed(2)} MB)`
      );
    } catch (err) {
      console.error('[fetch-assets] Error downloading face_landmarker.task:', err);
      process.exit(1);
    }
  }

  console.log('[fetch-assets] All assets are ready in public/mediapipe/');
}

main().catch((err) => {
  console.error('[fetch-assets] Fatal error:', err);
  process.exit(1);
});
