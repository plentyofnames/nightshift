// Tests for the EC4 pages: templates, CCs for every knob, the LIVE page, and setup 15 as
// EC4 bytes, written to Lilypad's mock EC4 without touching any other setup.

import { test, assert, eq } from './harness.js';
import { derive } from '../js/patch/derive.js';
import { examplePatch } from '../js/patch/example.js';
import { apply } from '../js/patch/edit.js';
import { targetOf, encodeTarget, mappingsOf } from '../js/patch/mappings.js';
import { pagesOf, mapPages, toggleLive, liveKeys, shortName, jackShort, settingKey, HIRES, SETUP, pageNameKey } from '../js/ec4/pages.js';
import { setupImage, writesFor, writeSetup, readSetup, setupState, owns, OWNED, SETUP_NAME } from '../js/ec4/setup.js';
import * as M from '../vendor/lilypad/js/model.js';
import { demoImage } from '../vendor/lilypad/js/demo.js';
import { MockDevice } from '../vendor/lilypad/js/mock.js';
import { Device } from '../vendor/lilypad/js/device.js';

const fresh = () => {
  const { config, preset } = examplePatch();
  return { config, preset, names: {} };
};
const viewOf = (p) => derive(p.config.values, p.preset.values, undefined, p.names);
const mapAll = (p) => {
  const view = viewOf(p);
  const r = mapPages(p.config.values, view, pagesOf(view, p.names));
  apply(p, r.changes);
  return r;
};

test('every mappable setting encodes back to itself', () => {
  const targets = [
    { kind: 'output', index: 5, param: 'directLevel' }, { kind: 'output', index: 63, param: 'lfoTempoMultiplier' },
    { kind: 'output', index: 7, param: 'lfoSaw' }, { kind: 'output', index: 0, param: 'lfoFade' },
    { kind: 'converter', index: 3, param: 'arpGate' }, { kind: 'converter', index: 15, param: 'arpSetRoot' },
    { kind: 'converter', index: 2, param: 'envRelease' }, { kind: 'converter', index: 1, param: 'envDecayShape' },
    { kind: 'euclid', index: 15, param: 'reset' }, { kind: 'srr', index: 3, param: 'gateLength' },
    { kind: 'noteSequencer', index: 3, param: 'position' }, { kind: 'drumSequencer', index: 0, param: 'position' },
    { kind: 'drumLane', index: 12, param: 'rate' }, { kind: 'global', index: 0, param: 'swingAmount' },
  ];
  for (const t of targets) {
    const code = encodeTarget(t);
    assert(code, `${settingKey(t)} encodes`);
    eq(targetOf({ target: code.target, index: code.index }), t, settingKey(t));
  }
  eq(encodeTarget({ kind: 'output', index: 1, param: 'nothing' }), null);
});

test('names in four characters', () => {
  eq(['Voice 1', 'Euclid 12', 'LFO 5', 'Wobble', 'Clock', 'CC 2'].map(shortName), ['VOI1', 'EU12', 'LFO5', 'WOBB', 'CLOC', 'CC2']);
  eq(['CV2·1', '5', 'GT1·3'].map(jackShort), ['C2.1', 'OUT5', 'G1.3']);
});

test('each source gets a page from its template, then the sequencers and the clock', () => {
  const p = fresh();
  const { pages, extra } = pagesOf(viewOf(p), p.names);
  eq(pages.map((pg) => pg.name), ['VOI1', 'VOI2', 'VOI3', 'EUC1', 'RAN1', 'LFO5', 'LFO6', 'CC2', 'SEQ', 'CLK']);
  eq(extra.length, 0);
  eq(pages.map((pg) => pg.group), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const euclid = pages.find((pg) => pg.id === 'euclid:0');
  eq(euclid.cells.filter(Boolean).map((c) => c.short), ['PULS', 'STEP', 'ROT', 'RATE', 'GATE', 'ACNT', 'RSET']);
  eq(euclid.cells[0].map, { channel: 1, cc: 16, relative: false, bits: 7, slot: euclid.cells[0].map.slot }, 'pulses keeps the config’s own mapping');
  eq(euclid.cells[1].map, null, 'steps has none yet');
  const knobs = pages.find((pg) => pg.id === 'knobs:1');
  eq(knobs.cells.filter(Boolean).map((c) => [c.short, c.map.cc, c.map.bits]), [['C2.1', 12, 14], ['C2.2', 13, 14], ['C2.3', 14, 14], ['C2.4', 15, 14]]);
  const lfo = pages.find((pg) => pg.id === 'lfo:4');
  eq(lfo.cells.filter(Boolean).length, 15);
  eq(lfo.cells[1].map?.channel, 13, 'the LFO’s multiplier keeps its mapping on ch 14');
  const renamed = pagesOf(viewOf(p), { [pageNameKey('lfo:4')]: 'Wobble' }).pages.find((pg) => pg.id === 'lfo:4');
  eq(renamed.name, 'Wobb', 'a page can be renamed');
});

test('mapping the pages gives every knob a CC on ch 2 (then ch 3), 14-bit where the FH-2 takes it', () => {
  const p = fresh();
  const before = mappingsOf(p.config.values).length;
  const r = mapAll(p);
  eq(r.left, []);
  const view = viewOf(p);
  const after = pagesOf(view, p.names);
  eq(after.unmapped, [], 'nothing left unmapped');
  eq(mappingsOf(p.config.values).length, before + r.mapped);
  const added = mappingsOf(p.config.values).slice(before);
  assert(added.every((m) => !m.relative), 'all absolute');
  const channels = [...new Set(added.map((m) => m.channel))];
  eq(channels, [1, 2], 'ch 2 until it is full, then ch 3 (the example has 76 settings on its pages)');
  // no CC is used twice on a channel, counting the fine halves of 14-bit ones
  const seen = new Set();
  for (const m of mappingsOf(p.config.values)) {
    const k = `${m.channel}:${m.cc}`;
    assert(!seen.has(k), `${k} used once`);
    seen.add(k);
  }
  for (const pg of after.pages) for (const c of pg.cells) {
    if (!c) continue;
    assert(![0, 6, 64, 66, 119, 120, 121, 122, 123, 124, 125, 126, 127].includes(c.map.cc), `${c.label} avoids reserved CC ${c.map.cc}`);
    if (HIRES.has(c.setting.param) && added.some((m) => m.slot === c.map.slot)) {
      eq(c.map.bits, 14, `${pg.name} ${c.short} is 14-bit`);
      assert(!seen.has(`1:${c.map.cc + 32}`), `${c.short}: its fine half is free`);
    }
  }
  eq(mapPages(p.config.values, view, after).changes, [], 'mapping again changes nothing');
});

test('the LIVE page shares its knobs’ CCs with their own pages', () => {
  const p = fresh();
  mapAll(p);
  const pulses = settingKey({ kind: 'euclid', index: 0, param: 'pulses' });
  const depth = settingKey({ kind: 'output', index: 4, param: 'lfoLevel' });
  apply(p, toggleLive(p.names, pulses));
  apply(p, toggleLive(p.names, depth));
  eq(liveKeys(p.names).slice(0, 3), [pulses, depth, '']);
  const { pages } = pagesOf(viewOf(p), p.names);
  eq(pages[0].name, 'LIVE');
  eq(pages[0].cells[0].map, pages.find((pg) => pg.id === 'euclid:0').cells[0].map);
  assert(pages.find((pg) => pg.id === 'euclid:0').cells[0].onLive, 'marked as on LIVE');
  apply(p, toggleLive(p.names, pulses));
  eq(liveKeys(p.names).slice(0, 2), ['', depth], 'taken off, the other knob stays where it was');
  apply(p, toggleLive(p.names, depth));
  eq(p.names['ec4:live'], undefined, 'an empty LIVE page is cleared');
});

test('the pages become EC4 setup 15, and nothing else changes', () => {
  const p = fresh();
  mapAll(p);
  const view = viewOf(p);
  const { pages, channel } = pagesOf(view, p.names);
  const base = demoImage();
  const img = setupImage(base, pages, view, channel);
  eq(M.readName(img, M.setupNameAddr(SETUP)), SETUP_NAME);
  eq(M.groupName(img, SETUP, 3), 'EUC1');
  eq(M.groupName(img, SETUP, 12), '    ', 'unused groups are blank');
  const knobs = pages.findIndex((pg) => pg.id === 'knobs:1');
  const e = M.readEncoder(img, SETUP, knobs, 0);
  eq([e.type, e.channel, e.number, e.lower, e.upper, e.name], [M.T.CCAH, 1, 12, 0, 16383, 'C2.1']);
  const pulses = M.readEncoder(img, SETUP, 3, 0);
  eq([pulses.type, pulses.channel, pulses.number, pulses.upper, pulses.name], [M.T.CCAB, 1, 16, 127, 'PULS']);
  const free = M.readEncoder(img, SETUP, 3, 15);
  eq([free.type, free.number, free.name], [M.T.CCR1, 119, '    '], 'a free knob sends nothing anyone maps');
  eq(M.readPush(img, SETUP, 3, 0).type, M.PT.OFF);
  for (let a = 0; a < M.SIZE; a++) if (img[a] !== base[a]) assert(owns(a), `0x${a.toString(16)} belongs to setup 15`);
  const writes = writesFor(img, base);
  assert(writes.every((w) => w.data.length <= 64 && (w.addr >> 6) === ((w.addr + w.data.length - 1) >> 6)), 'each write stays inside one page');
  const other = Uint8Array.from(img);
  other[M.dataBase(13, 0)] ^= 1; // setup 14
  let refused = false;
  try {
    writesFor(other, base);
  } catch {
    refused = true;
  }
  assert(refused, 'a change outside setup 15 is refused');
  eq(OWNED.reduce((n, [, len]) => n + len, 0), 256 + 64 + 3072 + 512 + 4);
});

test('writing setup 15 to the mock EC4 leaves every other setup as it was', async () => {
  const p = fresh();
  mapAll(p);
  const view = viewOf(p);
  const { pages, channel } = pagesOf(view, p.names);
  const mock = new MockDevice(demoImage(), { speed: 'fast' });
  const dev = new Device(mock.transport());
  const before = Uint8Array.from(mock.eeprom);
  const base = await readSetup(dev);
  const state = setupState(base);
  eq([state.name, state.free, state.ours], ['SE15', true, false], 'the demo’s setup 15 is unused');
  const img = setupImage(base, pages, view, channel);
  const n = await writeSetup(dev, img, base);
  assert(n > 0);
  for (let a = 0; a < M.SIZE; a++) {
    if (owns(a)) assert(mock.eeprom[a] === img[a], `0x${a.toString(16)} written`);
    else if (mock.eeprom[a] !== before[a]) throw new Error(`0x${a.toString(16)} changed outside setup 15`);
  }
  eq([mock.setup, mock.group], [SETUP, 0], 'the EC4 is on setup 15, page 1');
  const again = await readSetup(dev);
  eq(setupState(again).ours, true);
  eq(writesFor(setupImage(again, pages, view, channel), again).length, 0, 'sending again writes nothing');
  dev.close();
});
