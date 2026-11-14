// Actions sur les cartes et les liens (partagées par le board, le graphe, la liste et l'inspecteur).
import { state, mutate, select, setView, emit } from './store.js';
import { contextMenu, toast, confirmDialog, promptDialog } from './ui.js';
import { ZONE_LABELS, ensurePile, pruneCards } from './deckops.js';
import { nameOf } from './cardview.js';

function entry(deck, oracleId, zone) { return deck.entries.find((e) => e.oracleId === oracleId && e.zone === zone); }

export function moveCard(oracleId, fromZone, toZone, { qty = null } = {}) {
  if (fromZone === toZone) return;
  mutate((d) => {
    const e = entry(d, oracleId, fromZone);
    if (!e) return;
    const n = qty === null ? e.qty : Math.min(qty, e.qty);
    const n2 = toZone === 'commander' ? 1 : n;
    const t = entry(d, oracleId, toZone);
    if (t) t.qty += n2; else d.entries.push({ oracleId, qty: n2, zone: toZone, pile: e.pile || null });
    e.qty -= n;
    if (toZone === 'commander' && n > 1) e.qty += n - 1; // un seul exemplaire part en zone de commandement
    if (e.qty <= 0) d.entries.splice(d.entries.indexOf(e), 1);
  }, { relink: true, reason: 'zone' });
}

export function setQty(oracleId, zone, qty) {
  mutate((d) => {
    const e = entry(d, oracleId, zone);
    if (!e) return;
    e.qty = Math.max(0, Math.min(250, Math.round(qty)));
    if (e.qty === 0) { d.entries.splice(d.entries.indexOf(e), 1); pruneCards(d); }
  }, { relink: true, reason: 'qty' });
}

export async function removeCard(oracleId, zone, { confirm = false } = {}) {
  const card = state.deck.cards[oracleId];
  if (!card) return;
  if (confirm) {
    const n = state.deck.links.filter((l) => (l.from === oracleId || l.to === oracleId) && (l.status === 'accepted' || l.origin === 'manual')).length;
    if (n) {
      const ok = await confirmDialog({ title: 'Retirer la carte', message: `« ${nameOf(card)} » a ${n} lien${n > 1 ? 's' : ''} validé${n > 1 ? 's' : ''}. Ils seront retirés avec la carte (Ctrl+Z pour annuler).`, confirmLabel: 'Retirer', danger: true });
      if (!ok) return;
    }
  }
  mutate((d) => {
    d.entries = d.entries.filter((e) => !(e.oracleId === oracleId && e.zone === zone));
    pruneCards(d);
  }, { relink: true, reason: 'remove' });
  toast(`« ${nameOf(card)} » retiré du deck.`, { action: { label: 'Annuler', fn: () => import('./store.js').then((m) => m.undo()) } });
}

export function setPile(oracleId, zone, pileId) {
  mutate((d) => { const e = entry(d, oracleId, zone); if (e) e.pile = pileId || null; }, { reason: 'pile' });
}

export async function newPile(assign = null) {
  const name = await promptDialog({ title: 'Nouvelle pile', label: 'Nom de la pile', placeholder: 'Ex. : Rampe, Pioche, Retraits, Conditions de victoire', confirmLabel: 'Créer la pile' });
  if (!name) return null;
  let id = null;
  mutate((d) => {
    id = ensurePile(d, name);
    if (assign) { const e = entry(d, assign.oracleId, assign.zone); if (e) e.pile = id; }
  }, { reason: 'pile' });
  return id;
}

export async function renamePile(pileId) {
  const p = state.deck.piles.find((x) => x.id === pileId);
  if (!p) return;
  const name = await promptDialog({ title: 'Renommer la pile', label: 'Nom de la pile', value: p.name, confirmLabel: 'Renommer' });
  if (name) mutate((d) => { d.piles.find((x) => x.id === pileId).name = name; }, { reason: 'pile' });
}

export function deletePile(pileId) {
  mutate((d) => {
    d.piles = d.piles.filter((p) => p.id !== pileId);
    for (const e of d.entries) if (e.pile === pileId) e.pile = null;
  }, { reason: 'pile' });
}

export function toggleCommander(oracleId) {
  const d = state.deck;
  const inCmd = entry(d, oracleId, 'commander');
  if (inCmd) { moveCard(oracleId, 'commander', 'main'); return; }
  const from = ['main', 'maybe', 'side'].find((z) => entry(d, oracleId, z));
  if (from) moveCard(oracleId, from, 'commander', { qty: 1 });
}

export function canBeCommander(card) {
  return /\blegendary\b/i.test(card.typeLine || '') || /can be your commander/i.test(card.oracleText || '');
}

export function cardMenu(x, y, oracleId, zone) {
  const d = state.deck;
  const card = d.cards[oracleId];
  const e = entry(d, oracleId, zone);
  if (!card || !e) return;
  const isCmd = zone === 'commander';
  const canCmd = canBeCommander(card);
  const items = [
    { heading: nameOf(card) },
    { label: isCmd ? 'Retirer du commandement' : 'Définir comme commandant', onClick: () => toggleCommander(oracleId), disabled: !isCmd && !canCmd, hint: !isCmd && !canCmd ? 'pas légendaire' : '' },
    { label: 'Créer un lien depuis cette carte…', onClick: () => import('./linkdialog.js').then((m) => m.openLinkDialog({ from: oracleId })) },
    { label: 'Voir dans le graphe', onClick: () => { select(oracleId); setView('graph'); } },
    'sep',
    ...Object.entries(ZONE_LABELS).filter(([z]) => z !== zone && z !== 'commander').map(([z, l]) => ({ label: `Déplacer vers ${l}`, onClick: () => moveCard(oracleId, zone, z) })),
    'sep',
    { label: 'Ajouter un exemplaire', onClick: () => setQty(oracleId, zone, e.qty + 1), disabled: isCmd },
    { label: 'Retirer un exemplaire', onClick: () => setQty(oracleId, zone, e.qty - 1), disabled: e.qty <= 1 },
    d.piles.length ? { heading: 'Pile' } : null,
    ...d.piles.map((p) => ({ label: p.name, checked: e.pile === p.id, onClick: () => setPile(oracleId, zone, e.pile === p.id ? null : p.id) })),
    { label: 'Nouvelle pile…', onClick: () => newPile({ oracleId, zone }) },
    'sep',
    { label: 'Ouvrir sur Scryfall', onClick: () => card.scryfallUri && window.mtg.shell.openExternal(card.scryfallUri), disabled: !card.scryfallUri },
    { label: 'Retirer du deck', danger: true, onClick: () => removeCard(oracleId, zone, { confirm: true }) },
  ];
  contextMenu(x, y, items);
}

// ------------------------------------------------------------------ liens
export function setLinkStatus(ids, status) {
  const set = new Set(Array.isArray(ids) ? ids : [ids]);
  if (!set.size) return;
  mutate((d) => { for (const l of d.links) if (set.has(l.id)) l.status = status; }, { reason: 'links' });
}

export function deleteLink(id) {
  mutate((d) => { d.links = d.links.filter((l) => l.id !== id); }, { reason: 'links' });
}

export function addManualLink({ from, to, kind, note }) {
  if (from === to) { toast('Une carte ne peut pas être liée à elle-même.', { kind: 'error' }); return; }
  mutate((d) => {
    d.links.push({ id: `m:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, from, to, kind, origin: 'manual', status: 'accepted', reasons: [], note: note || '' });
  }, { reason: 'links' });
}

export function updateLink(id, patch) {
  mutate((d) => { const l = d.links.find((x) => x.id === id); if (l) Object.assign(l, patch); }, { reason: 'links' });
}

export function focusLink(link) {
  select(link.from, { linkId: link.id });
  emit('focus-link', link);
}
