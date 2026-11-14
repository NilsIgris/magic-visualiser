// Copie les bibliothèques et polices nécessaires dans src/renderer (fonctionnement hors ligne).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = (p) => path.join(root, 'node_modules', p);
const out = (p) => path.join(root, 'src', 'renderer', p);
const copies = [
  ['layout-base/layout-base.js', 'vendor/layout-base.js'],
  ['cose-base/cose-base.js', 'vendor/cose-base.js'],
  ['cytoscape/dist/cytoscape.min.js', 'vendor/cytoscape.min.js'],
  ['cytoscape-fcose/cytoscape-fcose.js', 'vendor/cytoscape-fcose.js'],
];
for (const w of ['400', '600', '700']) for (const sub of ['latin', 'latin-ext']) copies.push([`@fontsource/alegreya/files/alegreya-${sub}-${w}-normal.woff2`, `fonts/alegreya-${sub}-${w}.woff2`]);
copies.push(['@fontsource/alegreya/files/alegreya-latin-400-italic.woff2', 'fonts/alegreya-latin-400-italic.woff2']);
for (const w of ['400', '500', '700']) for (const sub of ['latin', 'latin-ext']) copies.push([`@fontsource/alegreya-sans/files/alegreya-sans-${sub}-${w}-normal.woff2`, `fonts/alegreya-sans-${sub}-${w}.woff2`]);
for (const [a, b] of copies) { fs.copyFileSync(nm(a), out(b)); }
const lic = ['cytoscape', 'cytoscape-fcose', 'cose-base', 'layout-base', '@fontsource/alegreya', '@fontsource/alegreya-sans']
  .map((p) => `===== ${p} =====\n` + fs.readFileSync(nm(`${p}/LICENSE`), 'utf8')).join('\n\n');
fs.writeFileSync(out('vendor/LICENSES.txt'), lic);
console.log(`${copies.length} fichiers copiés`);
