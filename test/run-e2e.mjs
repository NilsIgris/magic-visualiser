// Lance le faux Scryfall puis l'application Electron sous le scénario e2e.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMock } from './mock-scryfall.mjs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mock = await startMock();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgdl-e2e-'));
const out = process.env.MTG_E2E_OUT || path.join(root, 'test-output');
fs.rmSync(out, { recursive: true, force: true });
// MTG_E2E_BIN : binaire empaqueté à tester à la place des sources
// (le paquet « electron » exporte le chemin du binaire, sous Windows comme sous Linux)
const bin = process.env.MTG_E2E_BIN || createRequire(import.meta.url)('electron');
const args = process.env.MTG_E2E_BIN ? ['--no-sandbox', '--disable-gpu'] : ['.', '--no-sandbox', '--disable-gpu'];
const child = spawn(bin, args, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, MTG_USERDATA: userData, MTG_SCRYFALL_BASE: mock.base, MTG_IMAGE_ORIGINS: mock.base, MTG_CSB_BASE: `${mock.base}/csb`, MTG_E2E: path.join(root, 'test', 'e2e.mjs'), MTG_E2E_OUT: out },
});
const timer = setTimeout(() => { console.error('E2E : délai global dépassé'); child.kill('SIGKILL'); }, 240000);
child.on('exit', async (code) => {
  clearTimeout(timer);
  await mock.close();
  let res = { results: [], errors: ['results.json absent'] };
  try { res = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')); } catch { /* absent */ }
  const decks = fs.readdirSync(path.join(userData, 'decks')).filter((f) => f.endsWith('.json'));
  const saved = decks.map((f) => JSON.parse(fs.readFileSync(path.join(userData, 'decks', f), 'utf8')));
  res.results.push({ ok: saved.length === 2 && saved.some((d) => d.name === 'Ghave renommé') && saved.some((d) => d.built), label: `modification enregistrée à la fermeture (${saved.map((d) => d.name)})` });
  res.results.push({ ok: code === 0, label: `fermeture propre de l'application (code ${code})` });
  const failed = res.results.filter((r) => !r.ok);
  console.log(`E2E : ${res.results.length - failed.length}/${res.results.length} vérifications réussies, ${res.errors.length} erreur(s) console`);
  for (const f of failed) console.log('  ÉCHEC :', f.label);
  for (const e of res.errors) console.log('  CONSOLE :', e);
  console.log(`API Scryfall (factice) : ${mock.log.length} requêtes`);
  process.exit(failed.length || res.errors.length ? 1 : 0);
});
