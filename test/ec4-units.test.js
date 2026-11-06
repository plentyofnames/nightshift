// controlfrog 0.13 (docs/protocol.md in the firmware repo): table C's display codes, and EDIT.
// The codes are checked by formatting every value as the protocol describes each code and
// comparing with Night Shift's own value texts (values.js), setting by setting.

import { test, assert, eq } from './harness.js';
import { derive } from '../js/patch/derive.js';
import { examplePatch } from '../js/patch/example.js';
import { apply } from '../js/patch/edit.js';
import { pagesOf, wholePage, objectsOf, HIRES, SETUP } from '../js/ec4/pages.js';
import { valueText, displayCode } from '../js/ec4/values.js';
import { setupImage, cellRecord, pageRecords, editMessage, SYNC_DISPLAY, HAS_013, syncEntry } from '../js/ec4/setup.js';
import { Ec4Link } from '../js/ec4/link.js';
import { unpack, checksum } from '../vendor/lilypad/js/proto.js';

// Each code as the protocol's table describes it.
const DIV = { 96: '1/1', 48: '1/2', 24: '1/4', 16: '1/4T', 12: '1/8', 8: '1/8T', 6: '1/16', 4: '16T', 3: '1/32', 2: '32T', 1: '24PQ', 0: 'EXT' };
const RANGES = [[0, 10], [-5, 5], [0, 1], [0, 5], [0, 8]];
const signed = (n) => (n > 0 ? `+${n}` : String(n));
const ARP_STARTS = [0, 11, 22, 32, 43, 54, 64, 75, 86, 96, 107, 118];
const ARP_NAMES = ['OFF', 'UP', 'DOWN', 'ALT', 'ALT2', 'STUP', 'STDN', 'STPL', 'RND', 'RND2', 'RND3', 'PLAY'];
function formatCode(code, v) {
  const r = Math.round;
  const pc = (x, max) => `${r((x * 100) / max)}%`;
  switch (code) {
    case 0x01: return String(v);
    case 0x02: return v === 0 ? 'OFF' : String(v);
    case 0x03: return v ? 'ON' : 'OFF';
    case 0x04: return `x${v}`;
    case 0x05: return `${v}OCT`;
    case 0x06: return String(r((v * 360) / 128));
    case 0x07: return v / 10 < 100 ? (v / 10).toFixed(1) : String(r(v / 10));
    case 0x08: return signed(v - 64);
    case 0x09: return v === 64 ? 'LIN' : signed(v - 64);
    case 0x0a: return signed(r(((v - 64) * 100) / 63));
    case 0x0b: return signed(r(((v - 64) * 100) / 64));
    case 0x0c: return pc(v, 127);
    case 0x0d: return v === 0 ? 'TRIG' : pc(v, 127);
    case 0x0e: return v === 0 ? 'TRIG' : pc(v, 128);
    case 0x0f: return v >= 127 ? 'LOCK' : v <= 0 ? 'INV' : pc(127 - v, 127);
    case 0x10: return DIV[v] ?? String(v);
    case 0x18: case 0x19: case 0x1a: case 0x1b: case 0x1c: {
      const [lo, hi] = RANGES[code - 0x18];
      const x = lo + (v * (hi - lo)) / 16383;
      return Math.abs(x) >= 10 || x < 0 ? x.toFixed(1) : x.toFixed(2);
    }
    case 0x1d: return pc(v, 16383);
    case 0x1e: {
      const f = 0.1 * Math.pow(100, v / 16383);
      return f < 1 ? f.toFixed(2) : f < 10 ? f.toFixed(1) : String(r(f));
    }
    case 0x20: return ARP_NAMES[ARP_STARTS.filter((s) => s <= v).length - 1];
    case 0x21: return ['OFF', '16TH', '8TH', 'PENT', 'SEXT', 'SEPT', 'OCT', 'NON'][v] ?? String(v);
    case 0x22: return ['STOP', 'FWD', 'BACK'][v] ?? String(v);
    case 0x23: return ['OFF', 'CHRO', 'MAJ', 'MIN', 'TRI', 'MTRI', '5TH', 'TR+6', 'MT+6', 'TR+7', 'MT+7', '5+6', '5+7', 'PENT', 'MPEN', 'NMIN', 'HMIN', 'MIDO', 'MIDX'][v] ?? String(v);
    case 0x24: return v < 0 ? String(v) : ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][v % 12];
    default: return null;
  }
}
const four = (s) => (s == null ? null : String(s).padEnd(4).slice(0, 4));

test('table C: every setting’s code shows each value as Night Shift’s own text does', () => {
  const { config, preset } = examplePatch();
  const view = derive(config.values, preset.values);
  const keys = [...new Set(objectsOf(view).flatMap((o) => o.knobs.map((c) => c.key)))];
  let checked = 0;
  for (const key of keys) {
    for (const range of [0, 1, 2, 3, 4]) {
      const ctx = { range: () => range };
      const code = displayCode(key, ctx);
      const param = key.split(':')[2];
      if (range && param !== 'directLevel') continue;
      const top = HIRES.has(param) ? 16383 : param === 'tempo' ? 4000 : 127;
      for (let v = 0; v <= top; v += top > 127 ? 37 : 1) {
        const want = four(valueText(key, v, ctx));
        if (want == null) continue;
        const got = four(formatCode(code, v));
        if (got !== want) throw new Error(`${key} (range ${range}) at ${v}: code ${code.toString(16)} shows “${got}”, Night Shift “${want}”`);
        checked++;
      }
    }
  }
  assert(checked > 10000, `${checked} values`);
});

test('table C goes in only from controlfrog 0.13, for the knobs the sync sets', () => {
  const { config, preset } = examplePatch();
  const p = { config, preset, names: {} };
  const view = () => derive(p.config.values, p.preset.values, undefined, p.names);
  const model = () => pagesOf(view(), p.names);
  apply(p, wholePage(p.config.values, view(), p.names, model(), 'lfo:4').changes);
  apply(p, wholePage(p.config.values, view(), p.names, model(), 'clock').changes);
  const m = model();
  const base = new Uint8Array(65536).fill(0xee);
  const old = setupImage(base, m.pages, view(), m.channel, { format: 2, tempoMin: 59 });
  eq([...old.slice(SYNC_DISPLAY, SYNC_DISPLAY + 256)].every((b) => b === 0xee), true, '0.12: table C untouched');
  const img = setupImage(base, m.pages, view(), m.channel, { format: 2, tempoMin: 59, display: true });
  m.pages.forEach((pg, g) => pg.cells.forEach((c, i) => {
    const synced = syncEntry(c, { format: 2, tempoMin: 59 });
    eq(img[SYNC_DISPLAY + 16 * g + i], synced ? displayCode(c.key, { range: (o) => view().outputs[o]?.rangeIndex ?? 0 }) : 0xff, `${pg.id} knob ${i + 1}`);
  }));
  const clock = m.pages.findIndex((pg) => pg.id === 'clock');
  eq(img[SYNC_DISPLAY + 16 * clock], 0x07, 'the tempo knob shows BPM');
  eq([HAS_013({ fwMajor: 0, fwMinor: 12 }), HAS_013({ fwMajor: 0, fwMinor: 13 }), HAS_013({ fwMajor: 1, fwMinor: 0 })], [false, true, true]);
});

test('EDIT: a cell’s 15-byte record as Send writes it, packed with its checksum', () => {
  const { config, preset } = examplePatch();
  const p = { config, preset, names: {} };
  const view = () => derive(p.config.values, p.preset.values, undefined, p.names);
  apply(p, wholePage(p.config.values, view(), p.names, pagesOf(view(), p.names), 'converter:0').changes);
  const m = pagesOf(view(), p.names);
  const img = setupImage(new Uint8Array(65536), m.pages, view(), m.channel, { format: 2 });
  const recs = pageRecords(m.pages[0], 0, view(), m.channel);
  for (let i = 0; i < 16; i++) eq(recs[i], cellRecord(img, SETUP, 0, i), `cell ${i + 1} as Send writes it`);
  eq(recs[0].slice(8, 12).map((c) => String.fromCharCode(c)).join(''), m.pages[0].cells[0].short.padEnd(4).slice(0, 4), 'its name in bytes 8–11');
  const msg = editMessage(3, 5, recs[0]);
  eq([...msg.slice(0, 9)], [0xf0, 0x7d, 0x45, 0x43, 0x34, 0x2c, SETUP, 3, 5]);
  eq(msg.length - 7, 22, '22 payload bytes');
  eq([...unpack(msg, 9, 15)], recs[0], 'the record, unpacked');
  eq(msg[msg.length - 2], checksum(recs[0]));
});

test('the live link sends a page’s cells to the EC4’s RAM: none while it holds them, the changed ones after', async () => {
  const sent = [];
  const device = new EventTarget();
  Object.assign(device, { chain: Promise.resolve(), transport: { send: (b) => sent.push(b) }, getState: async () => ({ setup: SETUP, group: 2 }), touchEvents: async () => {} });
  const link = new Ec4Link(device, { fwMajor: 0, fwMinor: 13 });
  await link.start();
  const rec = (n) => Array.from({ length: 15 }, (_, k) => (k === 0 ? n : 0));
  const page = Array.from({ length: 16 }, () => rec(1));
  await link.edit(page, true);
  eq(sent.length, 0, 'stored: the EEPROM has them');
  page[4] = rec(9);
  await link.edit(page, false);
  eq([sent.length, sent[0][8]], [1, 4], 'only cell 5');
  device.dispatchEvent(new CustomEvent('state', { detail: { setup: SETUP, group: 3 } }));
  await link.edit(page, false);
  eq(sent.length, 17, 'a new page, not as stored: all 16');
  const old = new Ec4Link(device, { fwMajor: 0, fwMinor: 12 });
  await old.start();
  await old.edit(page, false);
  eq(sent.length, 17, 'nothing for controlfrog 0.12');
});
