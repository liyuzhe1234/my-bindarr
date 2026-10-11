// Optional offline CN catalogue imported by the standalone pokemon-cn-downloader.
// It reuses Bindarr's existing pokemontcgapi ids and normalized cache schema, so
// switching between local catalogue reads and online price hydration never creates
// duplicate cards.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const readline = require('readline');
const db = require('../db');
const { parseCardRow } = require('./priceHelpers');
const languages = require('./languages');
const pokemonTranslations = require('../../../shared/pokemonTranslations.json');

const PREFIX = 'pokemontcgapi-';

const TRAINER_NAME_EXCEPTIONS = new Set([
  'Rotom Bike', 'Rotom Phone', 'Rotom Dex',
  'Rotom Dex Poké Finder Mode', 'Snorlax Doll',
]);

function normalizedCardName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/\[F\]/gi, '♀')
    .replace(/\[M\]/gi, '♂');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const pokemonNamePattern = new RegExp(
  `(?:^|[^A-Za-z])(?:${Object.keys(pokemonTranslations)
    .map(normalizedCardName)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')})(?=$|[^A-Za-z])`,
  'i',
);

function inferCnSupertype(name) {
  const normalized = normalizedCardName(name);
  if (TRAINER_NAME_EXCEPTIONS.has(normalized)) return 'Trainer';
  if (/ Energy$/i.test(normalized)) return 'Energy';
  // Older Mega cards sometimes omit the space: e.g. MGardevoir EX.
  if (pokemonNamePattern.test(normalized)
    || (/^M(?=[A-Z])/.test(normalized) && pokemonNamePattern.test(normalized.slice(1)))) {
    return 'Pokémon';
  }
  return 'Trainer';
}

async function repairCnSupertypes() {
  const language = languages.toName('zh-cn');
  const rows = await db.all(`SELECT id, name, supertype FROM card_cache
    WHERE id LIKE 'pokemontcgapi-cn-%' AND game = 'pokemon' AND language = ?`, [language]);
  const byType = new Map();
  for (const row of rows) {
    const inferred = inferCnSupertype(row.name);
    if (row.supertype === inferred) continue;
    if (!byType.has(inferred)) byType.set(inferred, []);
    byType.get(inferred).push(row.id);
  }
  let repaired = 0;
  for (const [supertype, ids] of byType) {
    for (let offset = 0; offset < ids.length; offset += 250) {
      const chunk = ids.slice(offset, offset + 250);
      await db.run(`UPDATE card_cache SET supertype = ?
        WHERE id IN (${chunk.map(() => '?').join(',')})`, [supertype, ...chunk]);
      repaired += chunk.length;
    }
  }
  return repaired;
}

function root() {
  const configured = String(process.env.POKEMON_CN_DATA_DIR || '').trim();
  return configured ? path.resolve(configured) : null;
}

function files() {
  const base = root();
  if (!base) return null;
  return {
    base,
    rawMeta: path.join(base, 'raw', 'sync-meta.json'),
    cards: path.join(base, 'raw', 'cards.jsonl'),
    sets: path.join(base, 'raw', 'sets.json'),
    translations: path.join(base, 'raw', 'translations.jsonl'),
    translationMeta: path.join(base, 'translation-sync-meta.json'),
    imageMeta: path.join(base, 'image-sync-meta.json'),
    manifest: path.join(base, 'image-manifest.jsonl'),
    imageJournal: path.join(base, '.image-sync', 'downloads.jsonl'),
    marker: path.join(__dirname, '..', '..', 'database', 'local-pokemon-cn-import.json'),
  };
}

async function json(file) {
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

async function available() {
  const f = files();
  if (!f) return false;
  try {
    const meta = await json(f.rawMeta);
    return meta.completed === true && fs.existsSync(f.cards) && fs.existsSync(f.sets);
  } catch {
    return false;
  }
}

function publicImageUrl(localPath) {
  return '/offline-pokemon-cn/' + String(localPath).split(/[\\/]+/).map(encodeURIComponent).join('/');
}

async function imageMap(f) {
  const map = new Map();
  const source = fs.existsSync(f.manifest) ? f.manifest : f.imageJournal;
  if (!fs.existsSync(source)) return map;
  const input = fs.createReadStream(source, 'utf8');
  for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.status === 'downloaded' && row.card_id && row.local_path) {
      map.set(row.card_id, publicImageUrl(row.local_path));
    }
  }
  return map;
}

async function translationMap(f) {
  const map = new Map();
  if (!fs.existsSync(f.translations)) return map;
  const input = fs.createReadStream(f.translations, 'utf8');
  for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (typeof row.id === 'string' && Array.isArray(row.translations)) map.set(row.id, row.translations);
  }
  return map;
}

function normalizeSet(set) {
  return {
    id: PREFIX + set.code,
    name: set.name || '', series: set.series || '',
    printed_total: set.printed_total || 0, total: set.total || 0,
    release_date: String(set.release_date || '').replace(/-/g, '/'),
    ptcgo_code: set.ptcgo_code || '', symbol_url: set.symbol_url || '',
    logo_url: set.logo_url || '', game: 'pokemon',
  };
}

async function listSets() {
  const f = files();
  if (!f || !await available()) return [];
  return (await json(f.sets)).filter(s => s.region === 'CN').map(normalizeSet);
}

async function importSets(f) {
  const sets = (await json(f.sets)).filter(s => s.region === 'CN').map(normalizeSet);
  for (const set of sets) {
    await db.run(`INSERT INTO sets
      (id, name, series, printed_total, total, release_date, ptcgo_code, symbol_url, logo_url, game)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pokemon')
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, series=excluded.series,
        printed_total=excluded.printed_total, total=excluded.total,
        release_date=excluded.release_date, ptcgo_code=excluded.ptcgo_code,
        symbol_url=excluded.symbol_url, logo_url=excluded.logo_url, game='pokemon'`,
    [set.id, set.name, set.series, set.printed_total, set.total, set.release_date,
      set.ptcgo_code, set.symbol_url, set.logo_url]);
  }
  return sets.length;
}

async function sync() {
  const f = files();
  if (!f || !await available()) return { enabled: false, cards: 0, sets: 0, images: 0 };
  const rawMeta = await json(f.rawMeta);
  const imageMeta = fs.existsSync(f.imageMeta) ? await json(f.imageMeta).catch(() => ({})) : {};
  const translationMeta = fs.existsSync(f.translationMeta) ? await json(f.translationMeta).catch(() => ({})) : {};
  const fingerprint = `${rawMeta.completed_at || ''}|${imageMeta.completed_at || ''}|${translationMeta.completed_at || ''}|${rawMeta.cards_count || 0}`;
  const cachedCount = await db.get(`SELECT COUNT(*) AS n FROM card_cache
    WHERE id LIKE 'pokemontcgapi-cn-%' AND language = ?`, [languages.toName('zh-cn')]);
  let marker = {};
  try { marker = await json(f.marker); } catch {}

  const sets = await importSets(f);
  let cards = Number(cachedCount?.n || 0);
  const images = await imageMap(f);
  const translations = translationMeta.completed === true ? await translationMap(f) : new Map();
  if (marker.fingerprint !== fingerprint || cards < Number(rawMeta.cards_count || 0)) {
    const provider = require('../pokemontcgapi');
    const input = fs.createReadStream(f.cards, 'utf8');
    let batch = [];
    cards = 0;
    for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      const raw = JSON.parse(line);
      if (raw.print_region !== 'CN') continue;
      const imageUrl = images.get(raw.id);
      const augmented = {
        ...raw,
        translations: translations.get(raw.id) || raw.translations || [],
        ...(imageUrl ? { images: [{ face: 'FRONT', size: 'NORMAL', locale: 'zh-cn', url: imageUrl }] } : {}),
      };
      batch.push(provider.normalizeCard(augmented));
      cards++;
      if (batch.length >= 250) {
        await provider.cacheListedCards(batch);
        batch = [];
      }
    }
    if (batch.length) await provider.cacheListedCards(batch);
    await fsp.mkdir(path.dirname(f.marker), { recursive: true });
    await fsp.writeFile(f.marker, JSON.stringify({ fingerprint, cards, sets, images: images.size, translations: translations.size, imported_at: new Date().toISOString() }, null, 2) + '\n');
  }

  // The existing provider already understands these ids, language and card shape.
  // Selecting it makes every normal Bindarr search use the imported local cache.
  await db.run(`UPDATE app_settings SET pokemon_provider = 'pokemontcgapi' WHERE id = 1`);

  // Rarebit currently publishes many mainland-China rows with rarity = null.
  // normalizeCard has to give missing values a display-safe fallback, so those
  // rows arrive in card_cache as Common. For Scarlet & Violet-era cards whose
  // canonical name ends in lowercase " ex", the ordinary printing is Double
  // Rare. Higher-rarity and promo variants already carry an explicit upstream
  // rarity and are therefore deliberately left untouched here.
  //
  // Keep this correction idempotent and local to the imported CN namespace so a
  // restart/re-sync cannot undo it and no English/JP card is inferred by name.
  await db.run(`UPDATE card_cache SET rarity = 'Double Rare'
    WHERE id LIKE 'pokemontcgapi-cn-%'
      AND game = 'pokemon'
      AND language = ?
      AND rarity = 'Common'
      AND LOWER(name) LIKE '% ex'`,
  [languages.toName('zh-cn')]);

  // Local supplements cover clearly identified cards that appear in exported
  // CN deck images before the upstream CN catalogue publishes their rows.
  const manualFile = path.join(f.base, 'manual-deck-cards.json');
  if (fs.existsSync(manualFile)) {
    const provider = require('../pokemontcgapi');
    const manual = (await json(manualFile)).map(card => provider.normalizeCard({
      ...card, print_region: 'CN', rarity: null,
      images: [{ face: 'FRONT', size: 'NORMAL', locale: 'zh-cn', url: publicImageUrl(card.local_path) }],
    }));
    await provider.cacheListedCards(manual);
    for (const card of manual) {
      await db.run(`UPDATE card_cache SET printed_name = ?, supertype = 'Trainer' WHERE id = ?`,
      [(await json(manualFile)).find(x => `pokemontcgapi-${x.id}` === card.id)?.printed_name || card.name, card.id]);
    }
  }
  // The CN feed currently leaves most supertypes empty and also publishes a
  // substantial number with the wrong value. Rebuild the classification from
  // the canonical card name after every import so Deck Builder remains correct
  // after both upgrades and repeated syncs.
  await repairCnSupertypes();
  return { enabled: true, cards, sets, images: images.size };
}

async function getCardsBySet(setId) {
  const rows = await db.all(`SELECT * FROM card_cache
    WHERE set_id = ? AND language = ?
    ORDER BY CAST(number AS INTEGER), number`, [PREFIX + String(setId || '').replace(/^pokemontcgapi-/, ''), languages.toName('zh-cn')]);
  return rows.map(parseCardRow);
}

module.exports = { root, available, sync, listSets, getCardsBySet, repairCnSupertypes };
