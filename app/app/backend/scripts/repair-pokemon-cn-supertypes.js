const path = require('path');
const sqlite3 = require('../node_modules/sqlite3');
const pokemonTranslations = require('../../shared/pokemonTranslations.json');

const dbPath = path.join(__dirname, '..', 'backend', 'database', 'bindarr.db');
const trainerNameExceptions = new Set([
  'Rotom Bike',
  'Rotom Phone',
  'Rotom Dex',
  'Rotom Dex Poké Finder Mode',
  'Snorlax Doll',
]);

function normalizeName(value) {
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
    .map(normalizeName)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')})(?=$|[^A-Za-z])`,
  'i',
);

function inferSupertype(name) {
  const normalized = normalizeName(name);
  if (trainerNameExceptions.has(normalized)) return 'Trainer';
  if (/ Energy$/i.test(normalized)) return 'Energy';
  if (
    pokemonNamePattern.test(normalized)
    || (/^M(?=[A-Z])/.test(normalized) && pokemonNamePattern.test(normalized.slice(1)))
  ) {
    return 'Pokémon';
  }
  return 'Trainer';
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this.changes || 0);
    });
  });
}

async function main() {
  const db = new sqlite3.Database(dbPath);
  try {
    const rows = await all(db, `SELECT id, name, supertype FROM card_cache
      WHERE id LIKE 'pokemontcgapi-cn-%'
        AND game = 'pokemon'
        AND language = 'Chinese (Simplified)'`);
    const byType = new Map();
    for (const row of rows) {
      const inferred = inferSupertype(row.name);
      if (row.supertype === inferred) continue;
      if (!byType.has(inferred)) byType.set(inferred, []);
      byType.get(inferred).push(row.id);
    }
    let repaired = 0;
    for (const [supertype, ids] of byType) {
      for (let offset = 0; offset < ids.length; offset += 250) {
        const chunk = ids.slice(offset, offset + 250);
        repaired += await run(
          db,
          `UPDATE card_cache SET supertype = ? WHERE id IN (${chunk.map(() => '?').join(',')})`,
          [supertype, ...chunk],
        );
      }
    }
    if (repaired) console.log(`Repaired ${repaired} Pokemon CN supertypes.`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exitCode = 1;
});
