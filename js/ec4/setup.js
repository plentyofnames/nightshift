// The EC4 pages as EC4 setup 15, in the stock EEPROM layout (Lilypad's model.js), and writing
// it over controlfrog's protocol (Lilypad's device.js). Night Shift reads and writes only
// that setup's bytes and its name: every write is checked against them before it is sent.
//
// Each page is a group: its name, and per knob the encoder that sends the setting's CC. A
// 14-bit setting is CC absolute 14-bit (CCAh, MSB first, so the FH-2 needs "14 bit CC byte
// order" = MSB first) with acceleration; the rest CC absolute, or CC relative where the
// config's mapping is relative. Free knobs send CC 119 relative on the pages channel, which
// nothing maps, so turning one does nothing. Pushes carry the FH-2's commands; the rest are off.
//
// With the pages goes controlfrog's FH-2 sync table (its docs/protocol.md "FH-2 sync table"):
// where each knob's value sits in the FH-2's preset dump and how it maps onto the knob, so that
// the EC4, plugged into the FH-2 without a computer, asks the FH-2 for those values, its knobs
// start where the FH-2 is, and it can show them. Format 1 (controlfrog 0.11) has only the 14-bit
// knobs; format 2 (0.12) the 7-bit ones too. These are the only bytes Night Shift writes outside
// setup 15.

import * as M from '../../vendor/lilypad/js/model.js';
import { SETUP, GROUPS, KNOBS, SWITCHES, DEAD_CC, HIRES } from './pages.js';
import { pathOf, bandsOf, displayCode } from './values.js';
import { MODE_NAMES } from './feel.js';
import { frame, pack, checksum } from '../../vendor/lilypad/js/proto.js';
import { DUMPS, CMD } from '../fh2/sysex.js';
import { fingerprint } from '../hash.js';

export const SETUP_NAME = 'FH-2';
const BLANK = '    ';
const SCALE = { off: 0, n127: 1, n1000: 3, pm500: 6, onoff: 7 };
const MODE = { acc0: 3, acc1: 4, acc2: 5 };

export const SYNC_HEADER = 0x05c0; // 8 bytes; the rest of its page stays blank
export const SYNC_ENTRIES = 0x0600; // table A: 2 bytes per knob of setup 15 at + 32·group + 2·knob, MSB first; FFFF: none
export const SYNC_EXTRA = 0x0200; // table B (format 2): per knob the same way, how a banded value or the tempo maps
export const SYNC_DISPLAY = 0x0400; // table C (controlfrog 0.13): 1 byte per knob at + 16·group + knob, how its value shows (values.js displayCode)
// What controlfrog 0.13 adds: table C, and EDIT, a cell of the page in view set in RAM only
export const HAS_013 = (info) => !!info && (info.fwMajor > 0 || info.fwMinor >= 13);
const EDIT = 0x2c;
const SYNC_MAGIC = [0x46, 0x48, 0x32]; // "FH2", then the format
const SYNC_TO_USB = 1; // where the EC4 sends its requests: USB (the FH-2's USB A)
export const SYNC_FORMAT = (info) => (info && (info.fwMajor > 0 || info.fwMinor >= 12) ? 2 : 1); // 7-bit knobs from controlfrog 0.12
// From 0.12 one dump sets the knobs of every page (at power-on and on Func + Group), up to this many,
// in page and knob order; the rest don't follow the FH-2 (your call, 2026-11-04: 3 or 4 pages at most).
export const SYNC_MAX = 64;

// The byte ranges [addr, len] that are Night Shift's: setup 15, its name, and the FH-2 sync table.
export const OWNED = [...M.setupRanges(SETUP), [M.setupNameAddr(SETUP), 4], [SYNC_HEADER, 64], [SYNC_ENTRIES, 512], [SYNC_EXTRA, 512], [SYNC_DISPLAY, 256]];
export const owns = (addr) => OWNED.some(([a, n]) => addr >= a && addr < a + n);

// What a knob's encoder sends: { type, channel, number, mode, scale, lower, upper, name }.
export function encoderOf(cell, view, channel) {
  if (!cell || !cell.map || cell.gone) {
    return { type: M.T.CCR1, channel: channel ?? 0, number: DEAD_CC, mode: MODE.acc0, scale: SCALE.off, lower: 0, upper: 127, name: BLANK };
  }
  const { map } = cell;
  const name = M.sanitizeName(cell.short);
  if (map.relative) return { type: M.T.CCR1, channel: map.channel, number: map.cc, mode: MODE.acc1, scale: SCALE.n127, lower: 0, upper: 127, name };
  // its mode: how it turns (feel.js, from pagesOf), else as before
  const feel = cell.feel ? MODE_NAMES.indexOf(cell.feel) : -1;
  if (map.bits === 14) {
    const bipolar = cell.setting.param === 'directLevel' && view.outputs[cell.setting.index]?.rangeIndex === 1; // ±5 V
    return { type: M.T.CCAH, channel: map.channel, number: map.cc, mode: feel >= 0 ? feel : MODE.acc2, scale: bipolar ? SCALE.pm500 : SCALE.n1000, lower: 0, upper: M.HIRES_MAX, name };
  }
  return { type: M.T.CCAB, channel: map.channel, number: map.cc, mode: feel >= 0 ? feel : MODE.acc1, scale: SWITCHES.has(cell.setting.param) ? SCALE.onoff : SCALE.n127, lower: 0, upper: 127, name };
}

// What a push sends: a command's CC, 127 while held and 0 on release (key mode), with the
// display mark on while it is held; else nothing.
export function pushOf(push) {
  if (!push || !push.map || push.gone) return { type: M.PT.OFF, channel: 0, mode: 0, number: 0, display: 0, lower: 0, upper: 0 };
  return { type: M.PT.CC, channel: push.map.channel, mode: 0, number: push.map.cc, display: 1, lower: 0, upper: 127 };
}

// A knob's entry in the sync table, or null (a relative knob needs none): { a, b } with a =
// type << 12 | the value's offset in the preset dump body, b = table B's two bytes. Types: 0 a
// 14-bit knob (u14); 1 a 7-bit one the FH-2 takes as it is (u7); 2 a banded one (u7; b: bands
// n, 0x40 if held at 1, and the value of the first band as a signed byte; hardware check 19); 3
// the tempo (u28 in tenths; b: the BPM of CC 0, tempoMin + 1, check 18). Format 1 has type 0
// only. controlfrog takes type 0 only on CCAh knobs and 1–3 only on CCAb ones, as encoderOf makes them.
const PRESET = DUMPS[CMD.INSTALL_PRESET];
export function syncEntry(cell, { format = 2, tempoMin = null } = {}) {
  const m = cell?.map;
  if (!m || cell.gone || m.relative) return null;
  const path = pathOf(cell.setting);
  const f = path && PRESET.layout.fields.find((x) => x.path.length === path.length && x.path.every((p, i) => p === path[i]));
  if (!f) return null;
  const t = cell.setting;
  if (m.bits === 14 && HIRES.has(t.param) && f.type.size === 2) return { a: f.offset, b: null };
  if (format < 2) return null;
  if (t.kind === 'global' && t.param === 'tempo') return tempoMin == null ? null : { a: (3 << 12) | f.offset, b: [tempoMin + 1, 0] };
  if (f.type.size !== 1) return null;
  const bands = bandsOf(t);
  return bands ? { a: (2 << 12) | f.offset, b: [bands.n | (bands.min === 1 ? 0x40 : 0), bands.from & 0xff] } : { a: (1 << 12) | f.offset, b: null };
}

// A knob and the push under it, as setup 15's group `g` holds them, into `img`.
function writeCell(img, g, i, cell, push, view, channel) {
  const e = encoderOf(cell, view, channel);
  // type and scale first: they decide how lower and upper are stored
  for (const f of ['type', 'scale', 'channel', 'number', 'mode', 'lower', 'upper', 'name']) M.setEncoder(img, SETUP, g, i, f, e[f]);
  M.setEncoder(img, SETUP, g, i, 'numberHigh', 0);
  if (i < 15) M.setEncoder(img, SETUP, g, i, 'link', 0);
  const p = pushOf(push);
  for (const f of ['type', 'channel', 'mode', 'number', 'display', 'lower', 'upper']) M.setPush(img, SETUP, g, i, f, p[f]);
  if (i < 15) M.setPush(img, SETUP, g, i, 'link', 0);
}

// A cell's 15-byte record, as controlfrog's EDIT takes it (docs/protocol.md, "RAM edits"): its 8
// data planes, its name, push key 1, and push key 2's two bytes, from the stock EEPROM layout.
export function cellRecord(img, s, g, i) {
  const d = M.dataBase(s, g);
  return [...Array.from({ length: 8 }, (_, k) => img[d + 16 * k + i]), ...img.slice(M.encNameAddr(s, g, i), M.encNameAddr(s, g, i) + 4),
    img[M.key1Base(s, g) + i], img[M.key2Base(s, g) + i], img[M.key2Base(s, g) + 16 + i]];
}
// The records of a page as group `g` of setup 15, one per cell.
export function pageRecords(page, g, view, channel) {
  const img = new Uint8Array(65536);
  for (let i = 0; i < KNOBS; i++) writeCell(img, g, i, page?.cells[i], page?.pushes[i], view, channel);
  return Array.from({ length: KNOBS }, (_, i) => cellRecord(img, SETUP, g, i));
}
// EDIT (controlfrog 0.13): cell `i` of group `g` of setup 15 set to `record`, in RAM only.
export const editMessage = (g, i, record) => frame(EDIT, [SETUP, g, i, ...pack(record), checksum(record)]);

// `base` (64 KB, what the EC4 holds) with setup 15 replaced by the pages, and the sync table in
// `sync.format` (1 for controlfrog 0.11, 2 from 0.12; `sync.tempoMin` from the config). Format 2's
// header byte 7 is `sync.programChannel`, the config's preset program change channel (1–16, 0 off):
// a program change there makes the EC4 ask the FH-2 again, as the scene changes (your call, 2026-11-04).
// With `sync.display` (controlfrog 0.13) table C too, so the EC4 shows the values in FH-2 units by
// itself (your idea, 2026-11-06).
export function setupImage(base, pages, view, channel, sync = {}) {
  const img = Uint8Array.from(base);
  const format = sync.format ?? 1;
  const program = format > 1 ? sync.programChannel ?? 0 : 0;
  img.set([...SYNC_MAGIC, format, SETUP, PRESET.version, SYNC_TO_USB, program >= 1 && program <= 16 ? program : 0], SYNC_HEADER);
  img.fill(0xff, SYNC_HEADER + 8, SYNC_HEADER + 64);
  M.writeName(img, M.setupNameAddr(SETUP), SETUP_NAME);
  for (let g = 0; g < GROUPS; g++) {
    const page = pages[g];
    M.writeName(img, M.groupNameAddr(SETUP, g), page ? page.name : BLANK);
    for (let i = 0; i < KNOBS; i++) {
      writeCell(img, g, i, page?.cells[i], page?.pushes[i], view, channel);
      const sy = syncEntry(page?.cells[i], { format, tempoMin: sync.tempoMin });
      img.set(sy ? [sy.a >> 8, sy.a & 0xff] : [0xff, 0xff], SYNC_ENTRIES + 32 * g + 2 * i);
      img.set(sy?.b ?? [0xff, 0xff], SYNC_EXTRA + 32 * g + 2 * i);
      if (sync.display) img[SYNC_DISPLAY + 16 * g + i] = sy ? displayCode(page.cells[i].key, { range: (o) => view.outputs[o]?.rangeIndex ?? 0 }) : 0xff;
    }
  }
  return img;
}

// What setup 15 holds now: its name, and whether it looks like Night Shift's or unused
// (blank, the default "SE15", or "FH-2"). Anything else is asked about before writing.
export function setupState(img) {
  const blank = M.isBlankName(img, M.setupNameAddr(SETUP));
  const name = blank ? '' : M.readName(img, M.setupNameAddr(SETUP));
  const groups = Array.from({ length: GROUPS }, (_, g) => M.groupName(img, SETUP, g));
  return { name, groups, ours: name === SETUP_NAME, free: blank || name.trim() === 'SE15' || name.trim() === '' };
}

// The 64-byte pages holding setup 15 and its name.
export const SETUP_PAGES = M.pagesOf(OWNED);

// A fingerprint of what Send to EC4 writes for these pages (Night Shift's bytes only, over a blank
// EC4), so the pre-gig checklist can tell whether the EC4 still holds the pages you see.
export function pagesFingerprint(pages, view, channel, sync = {}) {
  const img = setupImage(new Uint8Array(M.SIZE).fill(0xff), pages, view, channel, sync);
  return fingerprint(Uint8Array.from(SETUP_PAGES.flatMap((p) => [...img.subarray(p * M.PAGE, (p + 1) * M.PAGE)])));
}

// Reads setup 15 from the EC4 into a 64 KB image (0xFF elsewhere).
export async function readSetup(device, onStep = () => {}) {
  const img = new Uint8Array(M.SIZE).fill(0xFF);
  for (const [k, p] of SETUP_PAGES.entries()) {
    img.set(await device.read(p * M.PAGE, M.PAGE), p * M.PAGE);
    onStep(k + 1, SETUP_PAGES.length);
  }
  return img;
}

// The writes that turn `base` into `img`: runs of changed bytes, each inside one 64-byte page
// and inside setup 15. Throws if anything else would change.
export function writesFor(img, base) {
  const out = [];
  for (let a = 0; a < M.SIZE; a++) {
    if (img[a] === base[a]) continue;
    if (!owns(a)) throw new Error(`refusing to write 0x${a.toString(16)}: not part of EC4 setup ${SETUP + 1}`);
  }
  for (const p of SETUP_PAGES) {
    const end = (p + 1) * M.PAGE;
    for (let a = p * M.PAGE; a < end;) {
      if (img[a] === base[a]) {
        a++;
        continue;
      }
      const start = a;
      while (a < end && img[a] !== base[a]) a++;
      out.push({ addr: start, data: img.slice(start, a) });
    }
  }
  return out;
}

// Writes the changes, has the EC4 re-read its settings and turns it to setup 15, page `group` + 1
// (the page it showed, so a Store doesn't move it).
export async function writeSetup(device, img, base, onStep = () => {}, group = 0) {
  const writes = writesFor(img, base);
  for (const [k, w] of writes.entries()) {
    for (let a = w.addr; a < w.addr + w.data.length; a++) if (!owns(a)) throw new Error(`refusing to write 0x${a.toString(16)}`);
    await device.write(w.addr, w.data);
    onStep(k + 1, writes.length);
  }
  await device.reload();
  await device.select(SETUP, group);
  return writes.length;
}
