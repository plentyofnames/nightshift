// The BCR32's pages under Rotary Club, your own firmware (its controller from 0.23): 4 pages of
// 32 knobs in four rows of eight, and 16 keys (bcr32-fw docs/controller-protocol.md).
//
// Your calls (2026-11-08): the BCR32 has pages of its own, not the EC4's, and Night Shift owns only
// the knobs it puts there. The rest of a page, and every key, belong to whatever else writes them
// (Eye of Providence gives them other MIDI), so a page mixes the two knob by knob. A setting keeps
// one CC, which the EC4 and the BCR32 both send (ec4/pages.js hands them out and takes back the
// ones it added once neither has the setting).
//
// Stored in the patch's names: `bcr:knobs:<n>` (n = 1–4) page n's 32 knobs as setting keys
// separated by commas (empty where Night Shift has none), `bcr:push:<n>` the pushes under them,
// and `bcr:page:<n>` a page name you gave (else the BCR32 keeps its own). An object's template
// (4 × 4, as on the EC4) fills half a page: the left four columns or the right four.

import { settingOf, fourChars, ccFor, ccsFor, madeKeys, madeChange } from '../ec4/pages.js';
import { feelOf, defaultFeel, speedOf, feelIsMine } from '../ec4/feel.js';

export const PAGES = 4;
export const KNOBS = 32;
export const ROW = 8;
export const KEYS = 16;
const HALF = 16;
const knobsKey = (p) => `bcr:knobs:${p + 1}`;
const pushesKey = (p) => `bcr:push:${p + 1}`;
export const pageNameKey = (p) => `bcr:page:${p + 1}`;

// Place t (0–15) of a 4 × 4 template in half `half` (0 the left four columns, 1 the right four).
export const knobOf = (half, t) => (t >> 2) * ROW + half * 4 + (t & 3);
export const halfOf = (i) => (i % ROW) >> 2;
const halfPlaces = (half) => Array.from({ length: HALF }, (_, t) => knobOf(half, t));

const listOf = (names, key) => {
  const keys = (names?.[key] ?? '').split(',');
  return Array.from({ length: KNOBS }, (_, i) => keys[i] ?? '');
};
const listChange = (key, keys) => ({ dump: 'names', path: [key], value: keys.some(Boolean) ? keys.join(',').replace(/,+$/, '') : null });
export const knobKeys = (names, p) => listOf(names, knobsKey(p));
export const pushKeys = (names, p) => listOf(names, pushesKey(p));

// Every setting on the BCR32's pages, knob or push.
const allKeys = (names) => new Set(Array.from({ length: PAGES }, (_, p) => [...knobKeys(names, p), ...pushKeys(names, p)]).flat().filter(Boolean));

// The pages as Night Shift has them: { pages: [{ index, name (yours, or null), cells, pushes (32
// each: a cell as on the EC4's pages, with its map and feel, or null) }], on (key → [{ page,
// index, push }]), unmapped (keys without a CC), count (places holding something), channel }.
// `ec4` is pagesOf() of the same patch: the objects, the settings and their CCs are shared.
export function bcrPagesOf(ec4, names = {}) {
  const placed = (key) => (ec4.known.has(key) ? { ...ec4.known.get(key) }
    : { short: '?', label: 'Gone from the patch', key, setting: settingOf(key), source: null, gone: true });
  const on = new Map();
  const unmapped = new Set();
  let count = 0;
  const pages = Array.from({ length: PAGES }, (_, p) => {
    const own = names[pageNameKey(p)];
    const pg = { index: p, name: (own && fourChars(own)) || null,
      cells: knobKeys(names, p).map((k) => (k ? placed(k) : null)), pushes: pushKeys(names, p).map((k) => (k ? placed(k) : null)) };
    for (const [list, push] of [[pg.cells, false], [pg.pushes, true]]) {
      list.forEach((c, i) => {
        if (!c) return;
        if (!on.has(c.key)) on.set(c.key, []);
        on.get(c.key).push({ page: p, index: i, push });
        c.map = ec4.mapOf(c.key);
        c.feel = c.map && !c.map.relative ? feelOf(names, c.key, c.map.bits) : null;
        c.feelDefault = c.map && !c.map.relative ? defaultFeel(c.key, c.map.bits, speedOf(names)) : null;
        c.feelMine = feelIsMine(names, c.key);
        if (!c.map && !c.gone) unmapped.add(c.key);
      });
    }
    count += pg.cells.filter((c, i) => c || pg.pushes[i]).length;
    return pg;
  });
  return { pages, on, unmapped: [...unmapped], count, channel: ec4.channel };
}

// The changes that set the BCR32's lists to `lists` ([names key, 32 keys]) and drop the CCs
// Night Shift added for settings then on neither the EC4 nor the BCR32.
function withLists(names, ec4, lists) {
  const changes = lists.map(([k, keys]) => listChange(k, keys));
  const after = { ...names };
  for (const c of changes) after[c.path[0]] = c.value ?? '';
  const still = allKeys(after);
  const made = madeKeys(names);
  const gone = [...allKeys(names)].filter((k) => !still.has(k) && !ec4.on.has(k) && made.has(k));
  for (const k of gone) {
    const m = ec4.mapOf(k);
    if (m) changes.push({ dump: 'config', path: ['mapping', m.slot, 'status'], value: 0x7f });
    made.delete(k);
  }
  if (gone.length) changes.push(madeChange(made));
  return changes;
}

// Puts setting `key` on knob `i` of page `p` (null takes it off there), with a CC if it has none.
// { changes } or { error }.
export function placeKnob(config, view, names, ec4, p, i, key) {
  const keys = knobKeys(names, p);
  keys[i] = key ?? '';
  const changes = withLists(names, ec4, [[knobsKey(p), keys]]);
  if (!key) return { changes };
  const cc = ccFor(config, view, names, ec4, key);
  return cc ? { changes: [...changes, ...cc] } : { error: 'No CC left for it' };
}

// Takes the knob (or with `push`, the push) at page `p`, place `i` off; its CC goes once neither
// controller has the setting, if Night Shift added it.
export function takeOff(names, ec4, p, i, push = false) {
  const keys = push ? pushKeys(names, p) : knobKeys(names, p);
  if (!keys[i]) return [];
  keys[i] = '';
  return withLists(names, ec4, [[push ? pushesKey(p) : knobsKey(p), keys]]);
}

// Everything of Night Shift's off page `p`.
export function clearPage(names, ec4, p) {
  const empty = Array(KNOBS).fill('');
  return withLists(names, ec4, [[knobsKey(p), empty], [pushesKey(p), [...empty]]]);
}

// A knob and the push under it to another place, on this page or another: the one there (if
// any) takes its place.
export function movePlace(names, from, to) {
  if (from.page === to.page && from.index === to.index) return [];
  const lists = new Map();
  const get = (key, p) => {
    if (!lists.has(key)) lists.set(key, listOf(names, key));
    return lists.get(key);
  };
  for (const keyOf of [knobsKey, pushesKey]) {
    const a = get(keyOf(from.page), from.page);
    const b = get(keyOf(to.page), to.page);
    [a[from.index], b[to.index]] = [b[to.index], a[from.index]];
  }
  const before = (key) => listOf(names, key).join(',');
  return [...lists].filter(([k, keys]) => keys.join(',') !== before(k)).map(([k, keys]) => listChange(k, keys));
}

// Whether place `i` of page `p` is free for a knob (or a push): Night Shift has nothing there,
// and the BCR32 holds no other knob there (`foreign(p, i)`, from the image last read).
const freeAt = (bcr, foreign, p, i, push) => !(push ? bcr.pages[p].pushes[i] : bcr.pages[p].cells[i]) && !foreign(p, i);
const emptyAt = (bcr, foreign, p, i) => !bcr.pages[p].cells[i] && !bcr.pages[p].pushes[i] && !foreign(p, i);

// The half of a page where nothing is, Night Shift's or another's: 0, 1, or -1.
export function freeHalf(bcr, p, foreign = () => false) {
  return [0, 1].find((h) => halfPlaces(h).every((i) => emptyAt(bcr, foreign, p, i))) ?? -1;
}

// The objects whose settings sit with object page `objPage` (the note sequencers share one).
const objectsOn = (ec4, objPage) => ec4.objects.filter((o) => o.page === objPage);

// An object's template into half `half` of page `p`: each of its settings not on the BCR32 yet,
// where that place is free. { changes, count } or { error }.
export function putObject(config, view, names, ec4, bcr, objPage, p, half, foreign = () => false) {
  const knobs = knobKeys(names, p);
  const pushes = pushKeys(names, p);
  const taken = [];
  for (const o of objectsOn(ec4, objPage)) {
    for (const [tpl, list, push] of [[o.template.cells, knobs, false], [o.template.pushes, pushes, true]]) {
      tpl.forEach((key, t) => {
        const i = knobOf(half, t);
        if (!key || bcr.on.has(key) || taken.includes(key) || list[i] || !freeAt(bcr, foreign, p, i, push)) return;
        list[i] = key;
        taken.push(key);
      });
    }
  }
  if (!taken.length) return { error: 'Nothing of it fits there' };
  const cc = ccsFor(config, view, names, ec4, taken);
  if (cc.left.length) return { error: `No CC left for ${cc.left.length}` };
  return { changes: [listChange(knobsKey(p), knobs), listChange(pushesKey(p), pushes), ...cc.changes], count: taken.length };
}

// Clicking a setting's name in the Patch tab while the BCR32 is the controller in hand: it goes
// with its object's other settings (its place in the template, in the half they are in), else
// into a free half of page `page` (then of the others), else onto the first free place. With a
// CC if it has none. { changes, where: { page, index, push } } or { error }.
export function switchOn(config, view, names, ec4, bcr, key, { page = 0, foreign = () => false } = {}) {
  const o = ec4.objects.find((x) => x.knobs.some((c) => c.key === key) || x.commands.some((c) => c.key === key));
  if (!o) return { error: 'A knob can’t control that' };
  const push = o.commands.some((c) => c.key === key);
  const there = (bcr.on.get(key) ?? []).find((w) => w.push === push);
  if (there) return { changes: [], where: there };
  const t = (push ? o.template.pushes : o.template.cells).indexOf(key);
  const order = [page, ...[0, 1, 2, 3].filter((q) => q !== page)];
  const mine = new Set(objectsOn(ec4, o.page).flatMap((x) => [...x.knobs, ...x.commands].map((c) => c.key)));
  const firstFree = (q, places) => places.find((i) => freeAt(bcr, foreign, q, i, push));
  let at = null;
  // the half its object's settings are in
  for (const q of order) {
    const pg = bcr.pages[q];
    const h = [0, 1].find((x) => halfPlaces(x).some((i) => mine.has(pg.cells[i]?.key) || mine.has(pg.pushes[i]?.key)));
    if (h == null) continue;
    const want = t >= 0 ? knobOf(h, t) : null;
    const i = want != null && freeAt(bcr, foreign, q, want, push) ? want : firstFree(q, halfPlaces(h));
    if (i != null) {
      at = { page: q, index: i };
      break;
    }
  }
  // a free half
  for (const q of order) {
    if (at) break;
    const h = freeHalf(bcr, q, foreign);
    if (h >= 0) at = { page: q, index: t >= 0 ? knobOf(h, t) : halfPlaces(h)[0] };
  }
  // any free place
  for (const q of order) {
    if (at) break;
    const i = firstFree(q, [...Array(KNOBS).keys()]);
    if (i != null) at = { page: q, index: i };
  }
  if (!at) return { error: 'The BCR32’s pages are full' };
  const keys = push ? pushKeys(names, at.page) : knobKeys(names, at.page);
  keys[at.index] = key;
  const cc = ccFor(config, view, names, ec4, key);
  if (!cc) return { error: 'No CC left for it' };
  return { changes: [listChange(push ? pushesKey(at.page) : knobsKey(at.page), keys), ...cc], where: { ...at, push } };
}

// Takes `key` off every place on the BCR32, with its CC if the EC4 hasn't got it and Night Shift added it.
export function switchOff(names, ec4, key) {
  const lists = [];
  for (let p = 0; p < PAGES; p++) {
    for (const keyOf of [knobsKey, pushesKey]) {
      const keys = listOf(names, keyOf(p));
      if (keys.includes(key)) lists.push([keyOf(p), keys.map((k) => (k === key ? '' : k))]);
    }
  }
  return lists.length ? withLists(names, ec4, lists) : [];
}

// What the picker offers for a free knob: [{ name, cells }] by object, without the settings on that page already.
export function choicesFor(ec4, bcr, p) {
  const here = new Set(bcr.pages[p].cells.filter(Boolean).map((c) => c.key));
  return ec4.objects.map((o) => ({ name: o.name, cells: o.knobs.filter((c) => !here.has(c.key)) })).filter((g) => g.cells.length);
}

// The objects a half page can be filled with: [{ page, name }] (one per object page with a template).
export function halfChoices(ec4) {
  const seen = new Map();
  for (const o of ec4.objects) {
    if (!seen.has(o.page) && [...o.template.cells, ...o.template.pushes].some(Boolean)) seen.set(o.page, o.page === 'sequencers' ? 'Note sequencers' : o.name);
  }
  return [...seen].map(([page, name]) => ({ page, name }));
}

// The page holding most of an object's settings (for following a selection), or null.
export function pageOfObject(ec4, bcr, id) {
  const keys = new Set(ec4.objects.filter((o) => o.id === id || (id === 'clocks' && o.id === 'clock')).flatMap((o) => [...o.knobs, ...o.commands].map((c) => c.key)));
  if (!keys.size) return null;
  const n = bcr.pages.map((pg) => [...pg.cells, ...pg.pushes].filter((c) => c && keys.has(c.key)).length);
  const best = Math.max(...n);
  return best ? n.indexOf(best) : null;
}
