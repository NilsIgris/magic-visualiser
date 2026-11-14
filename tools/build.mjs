// Construit les livrables avec electron-builder.
//   node tools/build.mjs            → Windows (installateur + portable) et Linux (AppImage + tar.gz)
//   node tools/build.mjs --win      → Windows seulement
//   node tools/build.mjs --linux    → Linux seulement
//   node tools/build.mjs --publish  → publie sur GitHub Releases (variable GH_TOKEN requise ;
//                                     MTG_RELEASE_TYPE=draft pour un brouillon, utilisé par la CI)
// Sous Linux, l'installateur Windows nécessite wine (étape de désinstallation de NSIS).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const builder = require('electron-builder');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const rel = JSON.parse(fs.readFileSync(path.join(root, 'release.config.json'), 'utf8'));
const args = new Set(process.argv.slice(2));
const publish = args.has('--publish');
const hasRepo = !!(rel.owner && rel.repo);
if (publish && !hasRepo) { console.error('release.config.json : owner et repo sont requis pour publier.'); process.exit(1); }
if (publish && !process.env.GH_TOKEN) { console.error('Variable GH_TOKEN manquante (jeton GitHub avec le droit « contents: write »).'); process.exit(1); }

const onlyWin = args.has('--win'); const onlyLinux = args.has('--linux');
const targets = new Map();
if (!onlyLinux) targets.set(builder.Platform.WINDOWS, ['nsis:x64', 'zip:x64']);
if (!onlyWin && process.platform !== 'win32') targets.set(builder.Platform.LINUX, ['AppImage:x64', 'tar.gz:x64']);

const config = {
  appId: 'fr.nils.mtgdecklab',
  productName: 'MTG Deck Lab',
  copyright: '© 2026 Nils',
  directories: { output: 'dist', buildResources: 'build' },
  files: ['src/**/*', 'package.json'],
  asar: true,
  electronLanguages: ['fr', 'en-US'],
  extraFiles: [{ from: 'README.md', to: 'LISEZMOI.md' }],
  extraMetadata: { desktopName: 'mtg-deck-lab.desktop' },
  publish: hasRepo ? [{ provider: 'github', owner: rel.owner, repo: rel.repo, releaseType: process.env.MTG_RELEASE_TYPE === 'draft' ? 'draft' : 'release' }] : null,
  win: {
    icon: 'build/icon.ico',
    artifactName: 'MTG-Deck-Lab-${version}-windows-portable.${ext}',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'MTG Deck Lab',
    deleteAppDataOnUninstall: false,
    language: '1036',
    installerLanguages: ['fr_FR'],
    artifactName: 'MTG-Deck-Lab-Setup-${version}.${ext}',
  },
  linux: {
    icon: 'build/icon.png',
    category: 'Game',
    executableName: 'mtg-deck-lab',
    synopsis: 'Préparation de decks Magic: The Gathering',
    artifactName: 'MTG-Deck-Lab-${version}-linux-x64.${ext}',
  },
  appImage: { artifactName: 'MTG-Deck-Lab-${version}-x86_64.${ext}' },
};

fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
const out = await builder.build({ projectDir: root, targets: new Map([...targets].map(([p, t]) => [p, new Map([[builder.Arch.x64, t.map((x) => x.split(':')[0])]])])), config, publish: publish ? 'always' : 'never' });
console.log(`MTG Deck Lab ${pkg.version} : ${out.length} fichiers`);
for (const f of out) if (!/\.(blockmap|yml)$/.test(f) || /latest/.test(f)) console.log(' ', path.relative(root, f), `${(fs.statSync(f).size / 1e6).toFixed(1)} Mo`);
