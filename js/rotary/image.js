// Night Shift's knobs as bytes of Rotary Club's controller image (space 2, 4 KB; bcr32-fw
// docs/controller-protocol.md): per knob its 15-byte cell record, the same as the EC4 gets
// (controlfrog's layout, built by ec4/setup.js), and its FH-2 sync entries in tables A, B and C;
// the sync header; the page names you gave.
//
// Night Shift owns only its own knobs (your call, 2026-11-08). So a Send reads the image first and
// writes only Night Shift's bytes, in runs that never cross another's: a knob Night Shift holds
// (the BCR32 has it as Night Shift last wrote it, kept in this browser), or an empty one. A knob
// holding something else (Eye of Providence's, or one changed there since) is written over only
// after a yes. A knob Night Shift no longer wants is emptied, if it still holds what Night Shift
// wrote; if not, it is let go. What Night Shift holds changes once RELOAD has answered.

import * as R from '../../vendor/eyeofprovidence/js/model.js';
import { MAX_CHUNK } from '../../vendor/eyeofprovidence/js/proto.js';
import { pageRecords, syncEntry } from '../ec4/setup.js';
import { displayCode } from '../ec4/values.js';
import { DUMPS, CMD } from '../fh2/sysex.js';
import { fingerprint } from '../hash.js';
import { turnSummary, pushSummary } from './names.js';
import { PAGES, KNOBS } from './pages.js';

export const KNOB_BYTES = 20; // the record (15), table A (2), B (2), C (1)
const PRESET = DUMPS[CMD.INSTALL_PRESET];
const SYNC_MAGIC = [0x46, 0x48, 0x32]; // "FH2"
const SYNC_FORMAT = 2;
const SYNC_TO_USB = 1;
const BLANK = new Uint8Array(KNOB_BYTES).fill(0xff);

export const placeId = (p, i) => `${p}:${i}`;
const placeOf = (id) => id.split(':').map(Number);

// The addresses of knob `i` of page `p`: its record, then its entries in tables A, B and C.
export function knobAddrs(p, i) {
  const rec = R.cellAddr(p, i);
  return [...Array.from({ length: R.REC }, (_, k) => rec + k), R.syncAAddr(p, i), R.syncAAddr(p, i) + 1, R.syncBAddr(p, i), R.syncBAddr(p, i) + 1, R.syncCAddr(p, i)];
}
export const knobBytes = (img, p, i) => Uint8Array.from(knobAddrs(p, i), (a) => img[a]);
function setKnob(img, p, i, bytes) {
  knobAddrs(p, i).forEach((a, k) => (img[a] = bytes[k]));
}
const same = (a, b) => a.length === b.length && a.every((x, k) => x === b[k]);

// A knob nothing is on: its encoder and push off, no name, no sync entry. Writing over it loses nothing.
export function emptyKnob(bytes) {
  const rec = bytes.subarray(0, R.REC);
  const name = rec.subarray(8, 12);
  return R.decodeEncoder(rec).off && R.decodePush(rec).off && (name.every((b) => b === 0xff) || name.every((b) => b === 0x20))
    && bytes[R.REC] === 0xff && bytes[R.REC + 1] === 0xff;
}

// What the BCR32 has at a place, in a few words: { name, sends }.
export function knobSummary(bytes) {
  const rec = bytes.subarray(0, R.REC);
  const turn = turnSummary(rec);
  const push = pushSummary(rec);
  return { name: R.readName(rec, 8).trim(), sends: [turn !== 'off' && turn, push !== 'off' && `push ${push}`].filter(Boolean).join(' · ') || 'nothing' };
}

// ---- what Night Shift wants on the BCR32

// `bcr`: rotary/pages.js bcrPagesOf; `sync`: { tempoMin, programChannel } from the config.
// → { knobs: Map place → 20 bytes, names: Map page → 4 characters, header: 8 bytes or null }.
export function wanted(bcr, view, sync = {}) {
  const knobs = new Map();
  const range = (o) => view.outputs[o]?.rangeIndex ?? 0;
  let synced = 0;
  for (const pg of bcr.pages) {
    // the records as ec4/setup.js makes them for an EC4 group: 16 places at a time
    const records = [0, 1].flatMap((h) => pageRecords({ cells: pg.cells.slice(16 * h, 16 * h + 16), pushes: pg.pushes.slice(16 * h, 16 * h + 16) }, 0, view, bcr.channel));
    for (let i = 0; i < KNOBS; i++) {
      const cell = pg.cells[i];
      const push = pg.pushes[i];
      if (!cell && !push) continue;
      const rec = Uint8Array.from(records[i]);
      if (!cell) {
        rec.fill(0xff, 0, 7); // a push alone: no encoder
        R.writeName(rec, 8, push.short);
      }
      const sy = cell ? syncEntry(cell, { format: SYNC_FORMAT, tempoMin: sync.tempoMin ?? null }) : null;
      if (sy) synced++;
      const bytes = new Uint8Array(KNOB_BYTES).fill(0xff);
      bytes.set(rec, 0);
      if (sy) {
        bytes.set([sy.a >> 8, sy.a & 0xff], R.REC);
        if (sy.b) bytes.set(sy.b, R.REC + 2);
        bytes[R.REC + 4] = displayCode(cell.key, { range });
      }
      knobs.set(placeId(pg.index, i), bytes);
    }
  }
  const names = new Map(bcr.pages.filter((pg) => pg.name).map((pg) => [pg.index, R.sanitizeName(pg.name)]));
  const program = sync.programChannel >= 1 && sync.programChannel <= 16 ? sync.programChannel : 0;
  const header = synced ? Uint8Array.from([...SYNC_MAGIC, SYNC_FORMAT, 0, PRESET.version, SYNC_TO_USB, program]) : null;
  return { knobs, names, header, synced };
}

// A fingerprint of what wanted() holds, for the Gig tab (patch/gig.js): changed since Send to BCR32?
export function wantedFingerprint(want) {
  const parts = [...want.knobs].sort(([a], [b]) => a.localeCompare(b)).map(([id, b]) => `${id}=${hex(b)}`);
  parts.push(...[...want.names].sort(([a], [b]) => a - b).map(([p, n]) => `n${p}=${n}`), `h=${want.header ? hex(want.header) : ''}`);
  return fingerprint(new TextEncoder().encode(parts.join(';')));
}

// ---- what Night Shift holds: as it last wrote it, kept in this browser

export const emptyHeld = () => ({ knobs: new Map(), names: new Map() });
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
export const heldToJson = (held) => ({ knobs: Object.fromEntries([...held.knobs].map(([id, b]) => [id, hex(b)])), names: Object.fromEntries(held.names) });
export function heldFromJson(j) {
  const held = emptyHeld();
  for (const [id, h] of Object.entries(j?.knobs ?? {})) {
    const [p, i] = placeOf(id);
    if (p >= 0 && p < PAGES && i >= 0 && i < KNOBS && /^[0-9a-f]{40}$/.test(h)) held.knobs.set(placeId(p, i), unhex(h));
  }
  for (const [p, n] of Object.entries(j?.names ?? {})) if (Number(p) >= 0 && Number(p) < PAGES && typeof n === 'string' && n.length === 4) held.names.set(Number(p), n);
  return held;
}

// The knobs the BCR32 holds that aren't Night Shift's: Map place → { name, sends }.
export function foreignKnobs(img, held) {
  const out = new Map();
  if (!img) return out;
  for (let p = 0; p < PAGES; p++) {
    for (let i = 0; i < KNOBS; i++) {
      const now = knobBytes(img, p, i);
      const h = held.knobs.get(placeId(p, i));
      if (!emptyKnob(now) && !(h && same(now, h))) out.set(placeId(p, i), knobSummary(now));
    }
  }
  return out;
}

// What the BCR32 has on page `p`: its name, its keys ([{ name, sends }], never Night Shift's), and
// whether its knobs reach USB (the page's outputs: Night Shift's go to the FH-2 there).
export function pageOnBcr32(img, p) {
  if (!img) return null;
  const keys = Array.from({ length: R.KEYS }, (_, j) => {
    const rec = R.readRecord(img, p, R.keyCell(j));
    const sends = pushSummary(rec, true); // a key: the push types it ignores read as off
    return { name: R.readName(rec, 8).trim(), sends: sends === 'off' ? '' : sends };
  });
  return { name: R.pageName(img, p), keys, usb: (R.readOutputs(img, p) & 1) === 1 };
}

// ---- a Send

const nameBytes = (img, p) => img.slice(R.pageNameAddr(p), R.pageNameAddr(p) + 4);
const emptyName = (b) => b.every((x) => x === 0xff) || b.every((x) => x === 0x20);

// From `img` (the BCR32's image as just read), `want` (wanted()) and `held`; `over`: the places
// (and 'name:p') you said to write over. → { next (the image as it will be), writes ([{ addr, data }]),
// conflicts ([{ p, i, now: { name, sends } }] or { p, name }), held (what Night Shift holds once
// stored), changed (places written), cleared (places emptied) }.
export function plan(img, want, held, { over = new Set() } = {}) {
  const next = Uint8Array.from(img);
  const own = new Set();
  const mine = (addrs) => addrs.forEach((a) => own.add(a));
  const conflicts = [];
  const keep = emptyHeld();
  let changed = 0;
  let cleared = 0;
  for (const id of new Set([...want.knobs.keys(), ...held.knobs.keys()])) {
    const [p, i] = placeOf(id);
    const now = knobBytes(img, p, i);
    const w = want.knobs.get(id);
    const h = held.knobs.get(id);
    const ours = !!h && same(now, h);
    if (w) {
      if (same(now, w)) {
        keep.knobs.set(id, w);
        continue;
      }
      if (!ours && !emptyKnob(now) && !over.has(id)) {
        conflicts.push({ p, i, now: knobSummary(now) });
        continue;
      }
      setKnob(next, p, i, w);
      mine(knobAddrs(p, i));
      keep.knobs.set(id, w);
      changed++;
    } else if (ours && !emptyKnob(now)) {
      setKnob(next, p, i, BLANK);
      mine(knobAddrs(p, i));
      cleared++;
    }
    // a knob it held that changed there since: let go, as it is
  }
  for (const [p, name] of want.names) {
    const now = nameBytes(img, p);
    const w = Uint8Array.from(name, (c) => c.charCodeAt(0));
    const h = held.names.get(p);
    if (same(now, w)) {
      keep.names.set(p, name);
      continue;
    }
    const ours = h != null && same(now, Uint8Array.from(h, (c) => c.charCodeAt(0)));
    if (!ours && !emptyName(now) && !over.has(`name:${p}`)) {
      conflicts.push({ p, name: R.readName(img, R.pageNameAddr(p)).trim() });
      continue;
    }
    next.set(w, R.pageNameAddr(p));
    mine([0, 1, 2, 3].map((k) => R.pageNameAddr(p) + k));
    keep.names.set(p, name);
  }
  if (want.header && !same(img.slice(R.A.SYNC, R.A.SYNC + 8), want.header)) {
    next.set(want.header, R.A.SYNC);
    mine(Array.from({ length: 8 }, (_, k) => R.A.SYNC + k));
  }
  // a blank image gets the controller's header with Night Shift's first knob
  if (own.size && img.subarray(0, 16).every((b) => b === 0xff)) {
    R.ensureHeader(next);
    mine(Array.from({ length: 16 }, (_, k) => k));
  }
  return { next, writes: writesFor(next, img, own), conflicts, held: keep, changed, cleared };
}

// The WRITEs that turn `base` into `img`: runs of changed bytes, every one in `own`, joined over
// a gap of up to 8 unchanged bytes only when those are `own` too, at most 256 bytes each. Throws
// if anything else would change.
export function writesFor(img, base, own) {
  const runs = [];
  for (let a = 0; a < R.SIZE; a++) {
    if (img[a] === base[a]) continue;
    if (!own.has(a)) throw new Error(`refusing to write 0x${a.toString(16)}: not Night Shift’s`);
    const last = runs.at(-1);
    let joinable = last && a - last.end <= 8;
    for (let k = last?.end ?? 0; joinable && k < a; k++) if (!own.has(k)) joinable = false;
    if (joinable) last.end = a + 1;
    else runs.push({ start: a, end: a + 1 });
  }
  const out = [];
  for (const r of runs) {
    for (let s = r.start; s < r.end; s += MAX_CHUNK) out.push({ addr: s, data: img.slice(s, Math.min(r.end, s + MAX_CHUNK)) });
  }
  return out;
}

// Reads the whole image (16 READs of 256 bytes) with Eye of Providence's Device.
export const readImage = (device, onStep = () => {}) => device.readAll(onStep);

// Writes the plan, then RELOAD: the BCR32 uses the image and stores it. Resolves once RELOAD has
// answered; only then does Night Shift hold what it wrote.
export async function writePlan(device, pl, onStep = () => {}) {
  for (const [k, w] of pl.writes.entries()) {
    await device.write(w.addr, w.data);
    onStep(k + 1, pl.writes.length);
  }
  await storeImage(device);
}

const ERR_STORE = 4; // 7F 24 04 (Rotary Club 0.24 on): the image is in use but couldn't be kept

// RELOAD, and its real outcome. A page change on the unit (a T key) sends a STATE that can answer
// RELOAD before its own reply does; one GET_STATE more comes back only after that, so a late
// 7F 24 04 is seen here (as Eye of Providence does since 7f4936c). Throws the store error then.
export async function storeImage(device) {
  let unkept = null;
  const late = (e) => e.detail.cmd === 0x24 && e.detail.code === ERR_STORE && (unkept = e.detail);
  device.addEventListener('deviceerror', late);
  try {
    await device.reload();
    await device.getState().catch(() => {});
  } finally {
    device.removeEventListener('deviceerror', late);
  }
  if (unkept) throw Object.assign(new Error('the BCR32 could not keep the image'), { cmd: 0x24, code: ERR_STORE });
}

// The page in view as Night Shift wants it in the BCR32's RAM (EDIT): Map place index → 15-byte
// record, for its knobs and for those it empties; none where the BCR32 holds another's knob.
export function editsFor(img, want, held, p) {
  const out = new Map();
  if (!img) return out;
  for (let i = 0; i < KNOBS; i++) {
    const id = placeId(p, i);
    const now = knobBytes(img, p, i);
    const w = want.knobs.get(id);
    const h = held.knobs.get(id);
    const ours = !!h && same(now, h);
    if (w && (ours || emptyKnob(now) || same(now, w))) out.set(i, w.slice(0, R.REC));
    else if (!w && ours) out.set(i, BLANK.slice(0, R.REC));
  }
  return out;
}
