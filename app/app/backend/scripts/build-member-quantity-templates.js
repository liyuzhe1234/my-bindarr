const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const source = process.argv[2];
if (!source) throw new Error('Pass a 宝可梦会员小程序 deck image');
const labels = [
  [2, 1, 2, 1, 1, 3, 1, 1],
  [2, 4, 1, 6, 4, 4, 2, 2],
  [1, 1, 1, 1, 2, 2, 2, 2],
  [2, 1, 2, 2, 2, 1, 1],
];
const W = 29;
const H = 35;

(async () => {
  const meta = await sharp(source).metadata();
  const scale = meta.width / 1053;
  const groups = new Map();
  for (let row = 0; row < labels.length; row++) {
    for (let col = 0; col < labels[row].length; col++) {
      const { data } = await sharp(source).extract({
        left: Math.round((48 + col * 120 + 78) * scale),
        top: Math.round((482 + row * 168 + 108) * scale),
        width: Math.round(29 * scale), height: Math.round(35 * scale),
      }).greyscale().resize(W, H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
      const label = labels[row][col];
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(data.toString('base64'));
    }
  }
  const out = path.join(__dirname, '..', 'data', 'deck-image', 'quantity-templates-member.json');
  fs.writeFileSync(out, JSON.stringify({ width: W, height: H, templates: Object.fromEntries(groups) }, null, 2));
  console.log(`Wrote ${out}`);
})().catch(error => { console.error(error); process.exit(1); });
