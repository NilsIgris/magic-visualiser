// Pont sécurisé entre l'interface et le processus principal.
const { contextBridge, ipcRenderer } = require('electron');

const call = async (channel, ...args) => {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r || !r.ok) throw new Error((r && r.error) || 'Erreur inconnue');
  return r.value;
};

contextBridge.exposeInMainWorld('mtg', {
  info: () => call('app:info'),
  closeReady: () => call('app:close-ready'),
  onBeforeClose: (fn) => ipcRenderer.on('app:before-close', () => fn()),
  settings: { get: () => call('settings:get'), set: (p) => call('settings:set', p) },
  decks: {
    list: () => call('decks:list'),
    load: (id) => call('decks:load', id),
    save: (deck) => call('decks:save', deck),
    newId: () => call('decks:newId'),
    remove: (id) => call('decks:delete', id),
    importFile: () => call('decks:importFile'),
    usage: () => call('decks:usage'),
  },
  files: {
    openText: () => call('dialog:openText'),
    save: (opts) => call('file:save', opts),
  },
  shell: { openExternal: (u) => call('shell:openExternal', u), openDataFolder: () => call('shell:openDataFolder') },
  cache: { info: () => call('cache:info'), clear: () => call('cache:clear'), searchNames: (q) => call('cache:searchNames', q) },
  spellbook: { analyze: (req) => call('spellbook:analyze', req) },
  versions: {
    list: (deckId) => call('versions:list', deckId),
    save: (deckId, payload) => call('versions:save', deckId, payload),
    load: (deckId, vid) => call('versions:load', deckId, vid),
    remove: (deckId, vid) => call('versions:delete', deckId, vid),
  },
  collection: { get: () => call('collection:get'), save: (c) => call('collection:save', c) },
  updates: {
    support: () => call('update:support'),
    check: () => call('update:check'),
    download: () => call('update:download'),
    install: () => call('update:install'),
    onEvent: (fn) => { const h = (_e, s) => fn(s); ipcRenderer.on('update:event', h); return () => ipcRenderer.removeListener('update:event', h); },
  },
  scryfall: {
    resolve: (items, opts) => call('scryfall:resolve', items, opts),
    autocomplete: (q) => call('scryfall:autocomplete', q),
    symbology: () => call('scryfall:symbology'),
    prints: (card) => call('scryfall:prints', card),
    diagnose: () => call('scryfall:diagnose'),
    onProgress: (fn) => {
      const h = (_e, p) => fn(p);
      ipcRenderer.on('scryfall:progress', h);
      return () => ipcRenderer.removeListener('scryfall:progress', h);
    },
  },
});
