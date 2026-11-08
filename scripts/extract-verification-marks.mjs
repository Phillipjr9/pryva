/** Generate the exact-name index of real Simple Icons marks used by OTP cards.
 * Run after installing dependencies: node scripts/extract-verification-marks.mjs
 * Only default CC0 and explicit CC0 entries are included; the pinned upstream
 * package retains each mark's source and trademark information. No names are
 * guessed from slugs, aliases, or supplier-provided URLs.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const icons = JSON.parse(readFileSync('node_modules/simple-icons/data/simple-icons.json', 'utf8'));
const version = JSON.parse(readFileSync('node_modules/simple-icons/package.json', 'utf8')).version;
const index = {};
for (const icon of icons) {
  if (icon.license && icon.license.type !== 'CC0-1.0') continue;
  const key = icon.title.trim().replace(/\s+/g, ' ').toLowerCase();
  if (key.length < 4 || !/^[a-z0-9]+$/.test(icon.slug) || !/^[A-Fa-f0-9]{6}$/.test(icon.hex)) continue;
  // Skip any ambiguous duplicate title rather than assigning the wrong mark.
  if (Object.hasOwn(index, key)) index[key] = null;
  else index[key] = [icon.slug, icon.hex];
}
for (const key of Object.keys(index)) if (index[key] === null) delete index[key];
writeFileSync('src/lib/services/numbers/verification-mark-index.json', JSON.stringify({ version, marks: index }) + '\n');
console.log(`Indexed ${Object.keys(index).length} Simple Icons v${version} marks.`);
