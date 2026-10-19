// Recover the frontend source shipped inside Vite source maps. This repository
// started from a portable distribution, so the maps are the authoritative source
// archive until the recovered src/ tree is committed.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../app/app/frontend');
const assets = path.join(root, 'dist/assets');
const candidates = new Map();

for (const name of fs.readdirSync(assets).filter(name => name.endsWith('.js.map')).sort()) {
  let map;
  try { map = JSON.parse(fs.readFileSync(path.join(assets, name), 'utf8')); } catch { continue; }
  (map.sources || []).forEach((source, index) => {
    const marker = '../../src/';
    const at = source.indexOf(marker);
    if (at < 0 || !map.sourcesContent?.[index]) return;
    const relative = source.slice(at + marker.length).replace(/\\/g, '/');
    const content = map.sourcesContent[index];
    const previous = candidates.get(relative);
    if (!previous || content.length > previous.content.length) candidates.set(relative, { content, name });
  });
}

for (const [relative, source] of candidates) {
  const target = path.join(root, 'src', relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) fs.writeFileSync(target, source.content, 'utf8');
}

const cssSource = path.join(root, 'dist/assets/index-BXa1oRBx.css');
const cssTarget = path.join(root, 'src/index.css');
if (!fs.existsSync(cssTarget) && fs.existsSync(cssSource)) fs.copyFileSync(cssSource, cssTarget);

const publicDir = path.join(root, 'public');
fs.mkdirSync(publicDir, { recursive: true });
for (const name of ['logo.svg', 'manifest.webmanifest', 'deck-image-import.html', 'deck-image-link.js', 'single-card-import.html', 'efficiency-tools.html', 'efficiency-tools.js', 'efficiency-link.js']) {
  const from = path.join(root, 'dist', name);
  const to = path.join(publicDir, name);
  if (fs.existsSync(from) && !fs.existsSync(to)) fs.copyFileSync(from, to);
}
console.log(`Recovered ${candidates.size} frontend source files.`);
