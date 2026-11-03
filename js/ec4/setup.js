// The EC4 pages as EC4 setup 15, in the stock EEPROM layout (Lilypad's model.js), and writing
// it over controlfrog's protocol (Lilypad's device.js). Night Shift reads and writes only
// that setup's bytes and its name: every write is checked against them before it is sent.
//
// Each page is a group: its name, and per knob the encoder that sends the setting's CC. A
// 14-bit setting is CC absolute 14-bit (CCAh, MSB first, so the FH-2 needs "14 bit CC byte
// order" = MSB first) with acceleration; the rest CC absolute, or CC relative where the
// config's mapping is relative. Free knobs send CC 119 relative on the pages channel, which
// nothing maps, so turning one does nothing. Pushes carry the FH-2's commands; the rest are off.

import * as M from '../../vendor/lilypad/js/model.js';
import { SETUP, GROUPS, KNOBS, SWITCHES, DEAD_CC } from './pages.js';

export const SETUP_NAME = 'FH-2';
const BLANK = '    ';
const SCALE = { off: 0, n127: 1, n1000: 3, pm500: 6, onoff: 7 };
const MODE = { acc0: 3, acc1: 4, acc2: 5 };

// The byte ranges [addr, len] that are Night Shift's: setup 15 and its name.
export const OWNED = [...M.setupRanges(SETUP), [M.setupNameAddr(SETUP), 4]];
export const owns = (addr) => OWNED.some(([a, n]) => addr >= a && addr < a + n);

// What a knob's encoder sends: { type, channel, number, mode, scale, lower, upper, name }.
export function encoderOf(cell, view, channel) {
  if (!cell || !cell.map || cell.gone) {
    return { type: M.T.CCR1, channel: channel ?? 0, number: DEAD_CC, mode: MODE.acc0, scale: SCALE.off, lower: 0, upper: 127, name: BLANK };
  }
  const { map } = cell;
  const name = M.sanitizeName(cell.short);
  if (map.relative) return { type: M.T.CCR1, channel: map.channel, number: map.cc, mode: MODE.acc1, scale: SCALE.n127, lower: 0, upper: 127, name };
  if (map.bits === 14) {
    const bipolar = cell.setting.param === 'directLevel' && view.outputs[cell.setting.index]?.rangeIndex === 1; // ±5 V
    return { type: M.T.CCAH, channel: map.channel, number: map.cc, mode: MODE.acc2, scale: bipolar ? SCALE.pm500 : SCALE.n1000, lower: 0, upper: M.HIRES_MAX, name };
  }
  return { type: M.T.CCAB, channel: map.channel, number: map.cc, mode: MODE.acc1, scale: SWITCHES.has(cell.setting.param) ? SCALE.onoff : SCALE.n127, lower: 0, upper: 127, name };
}

// What a push sends: a command's CC, 127 while held and 0 on release (key mode), with the
// display mark on while it is held; else nothing.
export function pushOf(push) {
  if (!push || !push.map || push.gone) return { type: M.PT.OFF, channel: 0, mode: 0, number: 0, display: 0, lower: 0, upper: 0 };
  return { type: M.PT.CC, channel: push.map.channel, mode: 0, number: push.map.cc, display: 1, lower: 0, upper: 127 };
}

// `base` (64 KB, what the EC4 holds) with setup 15 replaced by the pages.
export function setupImage(base, pages, view, channel) {
  const img = Uint8Array.from(base);
  M.writeName(img, M.setupNameAddr(SETUP), SETUP_NAME);
  for (let g = 0; g < GROUPS; g++) {
    const page = pages[g];
    M.writeName(img, M.groupNameAddr(SETUP, g), page ? page.name : BLANK);
    for (let i = 0; i < KNOBS; i++) {
      const e = encoderOf(page?.cells[i], view, channel);
      // type and scale first: they decide how lower and upper are stored
      for (const f of ['type', 'scale', 'channel', 'number', 'mode', 'lower', 'upper', 'name']) M.setEncoder(img, SETUP, g, i, f, e[f]);
      M.setEncoder(img, SETUP, g, i, 'numberHigh', 0);
      if (i < 15) M.setEncoder(img, SETUP, g, i, 'link', 0);
      const p = pushOf(page?.pushes[i]);
      for (const f of ['type', 'channel', 'mode', 'number', 'display', 'lower', 'upper']) M.setPush(img, SETUP, g, i, f, p[f]);
      if (i < 15) M.setPush(img, SETUP, g, i, 'link', 0);
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

// Writes the changes, has the EC4 re-read its settings and turns it to setup 15, page 1.
export async function writeSetup(device, img, base, onStep = () => {}) {
  const writes = writesFor(img, base);
  for (const [k, w] of writes.entries()) {
    for (let a = w.addr; a < w.addr + w.data.length; a++) if (!owns(a)) throw new Error(`refusing to write 0x${a.toString(16)}`);
    await device.write(w.addr, w.data);
    onStep(k + 1, writes.length);
  }
  await device.reload();
  await device.select(SETUP, 0);
  return writes.length;
}
