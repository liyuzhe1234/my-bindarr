const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const readline = require('readline');
const sharp = require('sharp');

const root = path.resolve(process.env.POKEMON_CN_DATA_DIR || process.argv[2] || '');
if (!root) throw new Error('Set POKEMON_CN_DATA_DIR or pass the CN data directory');
const manifestFile = path.join(root, 'image-manifest.jsonl');
const manifest = fs.existsSync(manifestFile)
  ? manifestFile
  : path.join(root, '.image-sync', 'downloads.jsonl');
const outDir = path.join(__dirname, '..', 'data', 'deck-image');
// 12x16 was quick but collapsed similarly composed full-art supporters (for
// example Lillie's Determination and Iono) into almost the same colour block.
// 24x32 remains a small ~26 MB index while retaining faces, borders and props.
const W = 24;
const H = 32;

async function rows() {
  const result = [];
  const seen = new Set();
  const input = fs.createReadStream(manifest, 'utf8');
  for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.status !== 'downloaded' || !row.card_id || seen.has(row.card_id)) continue;
    seen.add(row.card_id);
    result.push(row);
  }
  const manualFile = path.join(root, 'manual-deck-cards.json');
  if (fs.existsSync(manualFile)) {
    for (const row of JSON.parse(await fsp.readFile(manualFile, 'utf8'))) {
      if (!row.id || !row.local_path || seen.has(row.id)) continue;
      seen.add(row.id);
      result.push({ card_id: row.id, local_path: row.match_path || row.local_path, manual: true });
    }
  }
  return result;
}

(async () => {
  const items = await rows();
  const vectors = Buffer.alloc(items.length * W * H * 3);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      const file = path.join(root, items[i].local_path);
      const { data } = await sharp(file).removeAlpha().resize(W, H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
      data.copy(vectors, i * W * H * 3);
      if ((i + 1) % 500 === 0) console.log(`${i + 1}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: 24 }, worker));
  await fsp.mkdir(outDir, { recursive: true });
  await fsp.writeFile(path.join(outDir, 'pokemon-cn.rgb'), vectors);
  await fsp.writeFile(path.join(outDir, 'pokemon-cn.json'), JSON.stringify({
    width: W, height: H, builtAt: new Date().toISOString(),
    cards: items.map(x => ({ id: `pokemontcgapi-${x.card_id}`, sourceId: x.card_id, image: x.local_path })),
  }));
  console.log(`Wrote ${items.length} cards to ${outDir}`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
