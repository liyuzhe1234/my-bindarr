import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
const src = path.join(import.meta.dirname, '..', 'node_modules', 'onnxruntime-web', 'dist');
const dst = path.join(import.meta.dirname, '..', 'public', 'ort');
const keep = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'];
mkdirSync(dst, { recursive: true });
for (const file of readdirSync(dst)) if (!keep.includes(file)) rmSync(path.join(dst, file), { recursive: true, force: true });
for (const file of keep) {
  const from = path.join(src, file); const to = path.join(dst, file);
  try { if (statSync(to).size === statSync(from).size) continue; } catch {}
  copyFileSync(from, to);
}
