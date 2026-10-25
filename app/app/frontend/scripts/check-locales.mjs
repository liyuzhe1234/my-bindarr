import { readFile } from 'node:fs/promises';

const locale = async (name) => JSON.parse(await readFile(new URL(`../src/locales/${name}.json`, import.meta.url), 'utf8'));
const [english, chinese] = await Promise.all([locale('en'), locale('zh-Hans')]);

const missing = Object.keys(english).filter((key) => !(key in chinese));
const placeholderMismatches = Object.keys(english).filter((key) => {
  if (!(key in chinese)) return false;
  const tokens = (value) => [...String(value).matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort().join('|');
  return tokens(english[key]) !== tokens(chinese[key]);
});

if (missing.length || placeholderMismatches.length) {
  if (missing.length) console.error(`Simplified Chinese is missing ${missing.length} key(s):\n${missing.join('\n')}`);
  if (placeholderMismatches.length) console.error(`Placeholder mismatch in ${placeholderMismatches.length} key(s):\n${placeholderMismatches.join('\n')}`);
  process.exit(1);
}

console.log(`Simplified Chinese locale covers all ${Object.keys(english).length} English keys.`);
