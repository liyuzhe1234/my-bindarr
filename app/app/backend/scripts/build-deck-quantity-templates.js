const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const source = process.argv[2];
if (!source) throw new Error('Pass a 集换社 deck image');
const labels = [
  [1, 1, 2, 2, 2, 2, 1],
  [1, 1, 1, 1, 4, 4, 1],
  [4, 1, 1, 1, 1, 4, 3],
  [2, 1, 1, 1, 1, 1, 2],
  [2, 5, 5],
];
const secondSource = process.argv[3];
const secondLabels = [
  [2, 2, 1, 1, 2, 1, 1],
  [1, 4, 4, 3, 1, 3, 4],
  [4, 1, 1, 3, 1, 3, 4],
  [2, 4, 1, 2, 1, 3],
];
const W = 24;
const H = 28;

(async () => {
  const groups = new Map();
  const samples = [{ file: source, labels, firstCardTop: 527 }];
  if (secondSource) samples.push({ file: secondSource, labels: secondLabels, firstCardTop: 497 });
  for (const sample of samples) {
    const meta = await sharp(sample.file).metadata();
    const scale = meta.width / 898;
    for (let row = 0; row < sample.labels.length; row++) {
      for (let col = 0; col < sample.labels[row].length; col++) {
        const { data } = await sharp(sample.file).extract({
          left: Math.round((43 + col * 117 + 84) * scale),
          top: Math.round((sample.firstCardTop + row * 164 + 127) * scale),
          width: Math.round(24 * scale), height: Math.round(28 * scale),
        }).greyscale().resize(W, H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
        const label = sample.labels[row][col];
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(data);
      }
    }
  }
  const templates = {};
  for (const [label, samples] of groups) {
    // Preserve every exemplar. The translucent badge includes a little of the
    // underlying artwork, so an average can blur a 4 into a 1 on bright cards.
    templates[label] = samples.map(sample => Buffer.from(sample).toString('base64'));
  }
  const out = path.join(__dirname, '..', 'data', 'deck-image', 'quantity-templates.json');
  fs.writeFileSync(out, JSON.stringify({ width: W, height: H, templates }, null, 2));
  console.log(`Wrote ${out}`);
})().catch(error => { console.error(error); process.exit(1); });
