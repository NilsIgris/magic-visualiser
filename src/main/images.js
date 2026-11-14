// Cache disque des images Scryfall, servi au rendu via le protocole mtgimg://
// Seuls les hôtes d'images Scryfall sont autorisés.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

export class ImageCache {
  constructor({ dir, fetchImpl, allowedHosts }) {
    this.dir = dir;
    this.fetch = fetchImpl;
    this.allowed = allowedHosts; // tableau de suffixes d'hôte ou d'origines exactes
    this.inflight = new Map();
    this.active = 0;
    this.queue = [];
  }

  isAllowed(u) {
    let url;
    try { url = new URL(u); } catch { return false; }
    return this.allowed.some((a) => (a.startsWith('http') ? u.startsWith(a) : url.protocol === 'https:' && (url.hostname === a || url.hostname.endsWith(`.${a}`))));
  }

  fileFor(u) {
    const ext = (path.extname(new URL(u).pathname).toLowerCase() || '.jpg').replace(/[^.a-z]/g, '');
    return path.join(this.dir, crypto.createHash('sha1').update(u).digest('hex') + (TYPES[ext] ? ext : '.jpg'));
  }

  async _slot(fn) {
    if (this.active >= 6) await new Promise((r) => this.queue.push(r));
    this.active++;
    try { return await fn(); } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  /** Renvoie { body: Buffer, type } ou lance une erreur. */
  async get(u) {
    if (!this.isAllowed(u)) throw Object.assign(new Error('Hôte non autorisé'), { status: 403 });
    const file = this.fileFor(u);
    const type = TYPES[path.extname(file)] || 'image/jpeg';
    try { return { body: await fs.readFile(file), type }; } catch { /* pas en cache */ }
    if (this.inflight.has(file)) return this.inflight.get(file);
    const p = this._slot(async () => {
      const res = await this.fetch(u);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      const buf = Buffer.from(await res.arrayBuffer());
      const tmp = `${file}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, buf);
      await fs.rename(tmp, file).catch(() => {});
      return { body: buf, type: res.headers.get('content-type') || type };
    }).finally(() => this.inflight.delete(file));
    this.inflight.set(file, p);
    return p;
  }
}
