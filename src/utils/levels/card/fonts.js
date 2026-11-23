import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const FAMILIES = [
  ['Inter Latin', 'latin'],
  ['Inter Latin Ext', 'latin-ext'],
  ['Inter Cyrillic', 'cyrillic'],
];
const WEIGHTS = [400, 600, 700];

export const FONT_STACK = FAMILIES.map(([family]) => `"${family}"`).join(', ');

let registered = false;

export function registerFonts(globalFonts) {
  if (registered) return;
  for (const [family, subset] of FAMILIES) {
    for (const weight of WEIGHTS) {
      const file = require.resolve(`@fontsource/inter/files/inter-${subset}-${weight}-normal.woff`);
      if (!globalFonts.registerFromPath(file, family)) throw new Error(`Could not register font ${file}`);
    }
  }
  registered = true;
}
