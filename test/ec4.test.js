// Tests for the EC4 pages: settings switched on and off (with their CCs), templates as
// positions, the LIVE page, the picker, the commands on pushes, tidying stray CCs, and setup 15
// as EC4 bytes, written to Lilypad's mock EC4 without touching any other setup.

import { test, assert, eq } from './harness.js';
import { derive } from '../js/patch/derive.js';
import { examplePatch } from '../js/patch/example.js';
import { apply } from '../js/patch/edit.js';
import { targetOf, encodeTarget, mappingsOf } from '../js/patch/mappings.js';
import { pagesOf, mapPages, toggleLive, liveKeys, placeKnob, placeWithCc, takeOff, choicesFor, switchOn, switchOff, wholePage, addLivePage, removeLivePage, movePlace, toLivePage, liveIds,
  strayMappings, removeMappings, dropMapping, objectKeys, shortName, jackShort, settingKey, HIRES, SETUP, pageNameKey, toAbsolute, switchOffAll } from '../js/ec4/pages.js';
import { setupImage, writesFor, writeSetup, readSetup, setupState, owns, pushOf, encoderOf, syncEntry, OWNED, SETUP_NAME, SYNC_HEADER, SYNC_ENTRIES, SYNC_EXTRA, SYNC_FORMAT } from '../js/ec4/setup.js';
import * as M from '../vendor/lilypad/js/model.js';
import { demoImage } from '../vendor/lilypad/js/demo.js';
import { MockDevice } from '../vendor/lilypad/js/mock.js';
import { Device } from '../vendor/lilypad/js/device.js';

const fresh = () => {
  const { config, preset } = examplePatch();
  return { config, preset, names: {} };
};
const viewOf = (p) => derive(p.config.values, p.preset.values, undefined, p.names);
const modelOf = (p) => pagesOf(viewOf(p), p.names);
const key = (kind, index, param) => settingKey({ kind, index, param });
const addedKeysOf = (p, pageId) => modelOf(p).pages.find((pg) => pg.id === pageId).cells.map((c) => c?.key ?? '');
const on = (p, k) => {
  const r = switchOn(p.config.values, viewOf(p), p.names, modelOf(p), k);
  if (r.error) throw new Error(r.error);
  apply(p, r.changes);
  return r;
};
const whole = (p, pageId) => {
  const r = wholePage(p.config.values, viewOf(p), p.names, modelOf(p), pageId);
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
    { kind: 'drumLane', index: 7, param: 'rate' }, { kind: 'global', index: 0, param: 'swingAmount' },
  ];
  for (const t of targets) {
    const code = encodeTarget(t);
    assert(code, `${settingKey(t)} encodes`);
    eq(targetOf({ target: code.target, index: code.index }), t, settingKey(t));
  }
  eq(encodeTarget({ kind: 'output', index: 1, param: 'nothing' }), null);
  eq(encodeTarget({ kind: 'drumLane', index: 8, param: 'rate' }), null, 'eight lanes: a ninth would need index 128');
});

test('the drum page: reset and position, then the eight lanes’ rates, each with its value', () => {
  const p = fresh();
  const drums = modelOf(p).objects.find((o) => o.name === 'Drum sequencer');
  eq(drums.knobs.map((c) => c.setting.index), [0, 0, 0, 1, 2, 3, 4, 5, 6, 7]);
  eq(drums.template.cells.slice(0, 12).map((k) => k && k.split(':').slice(-1)[0]), ['reset', 'position', null, null, 'rate', 'rate', 'rate', 'rate', 'rate', 'rate', 'rate', 'rate']);
  whole(p, drums.page);
  const page = modelOf(p).pages.find((pg) => pg.id === drums.page);
  const lanes = page.cells.filter((c) => c?.setting.kind === 'drumLane');
  eq(lanes.length, 8);
  eq(lanes.map((c) => mappingsOf(p.config.values).find((m) => m.cc === c.map.cc && m.channel === c.map.channel)?.target.index), [0, 1, 2, 3, 4, 5, 6, 7], 'each knob reaches its own lane');
  eq(lanes.map((c) => syncEntry(c, { format: 2 })?.a >> 12), [1, 1, 1, 1, 1, 1, 1, 1], 'each follows the FH-2 (u7 as it is)');
});

test('names in four characters', () => {
  eq(['Voice 1', 'Euclid 12', 'LFO 5', 'Wobble', 'Clock', 'CC 2'].map(shortName), ['VOI1', 'EU12', 'LFO5', 'WOBB', 'CLOC', 'CC2']);
  eq(['CV2·1', '5', 'GT1·3'].map(jackShort), ['C2.1', 'OUT5', 'G1.3']);
});

test('nothing is on the EC4 until it is switched on; then it gets its page, its place and a CC', () => {
  const p = fresh();
  eq(modelOf(p).pages.length, 0, 'no pages at first, though the config has mappings');
  const before = mappingsOf(p.config.values).length;
  const attack = key('converter', 0, 'envAttack');
  const r = on(p, attack);
  eq(r.where, { page: 'converter:0', name: 'VOI1', index: 0, push: false }, 'where the template has it');
  let m = modelOf(p);
  eq(m.pages.map((pg) => pg.name), ['VOI1']);
  eq(m.pages[0].cells[0].map.channel, 1, 'a CC on ch 2');
  eq(mappingsOf(p.config.values).length, before + 1);
  on(p, key('converter', 0, 'arpMode'));
  m = modelOf(p);
  const arpAt = m.pages[0].cells.findIndex((c) => c?.setting.param === 'arpMode');
  eq(arpAt, m.objects.find((o) => o.id === 'converter:0').template.cells.indexOf(key('converter', 0, 'arpMode')), 'the arp row of the template');
  apply(p, switchOff(p.names, modelOf(p), attack));
  m = modelOf(p);
  eq(m.pages[0].cells[0], null, 'switched off: the knob is free again');
  eq(mappingsOf(p.config.values).length, before + 1, 'and the CC Night Shift added for it is gone');
});

test('a setting the config already maps keeps its CC, and keeps it when switched off', () => {
  const p = fresh();
  const pulses = key('euclid', 0, 'pulses');
  const before = mappingsOf(p.config.values).length;
  on(p, pulses);
  eq(mappingsOf(p.config.values).length, before, 'no new mapping');
  eq(modelOf(p).pages[0].cells[0].map.cc, 16, 'the config’s own ch 2 CC 16');
  apply(p, switchOff(p.names, modelOf(p), pulses));
  eq(mappingsOf(p.config.values).length, before, 'its mapping stays: Night Shift didn’t make it');
  eq(modelOf(p).pages.length, 0);
});

test('a whole page takes its template: 14-bit for levels, LFO rate and depth, commands on the pushes', () => {
  const p = fresh();
  eq(whole(p, 'lfo:4').count, 15);
  eq(whole(p, 'converter:0').count, 21, 'its envelope, glide and arp (15 knobs) and the 6 arp commands');
  eq(whole(p, 'clock').count, 7, 'tempo, swing and the four commands');
  const m = modelOf(p);
  const lfo = m.pages.find((pg) => pg.id === 'lfo:4');
  eq(lfo.cells.filter(Boolean).map((c) => c.short), ['SYNC', 'MULT', 'DPTH', 'OFFS', 'SINE', 'TRI', 'SAW', 'SQR', 'PW', 'RAND', 'NOIS', 'SMTH', 'PHAS', 'FADE', 'RATE']);
  for (const c of lfo.cells.filter(Boolean)) if (HIRES.has(c.setting.param)) eq(c.map.bits, 14, `${c.short} is 14-bit`);
  eq(lfo.cells[1].map.channel, 1, 'the multiplier gets a knob CC of its own: ch 14 CC 20 is input X’s, which moves it');
  const voice = m.pages.find((pg) => pg.id === 'converter:0');
  const arpAt = voice.cells.findIndex((c) => c?.setting.param === 'arpMode');
  eq(voice.pushes.slice(arpAt, arpAt + 6).map((c) => c.setting.param), ['arpAdd', 'arpRemove', 'arpRest', 'arpTranspose', 'arpTransposeInKey', 'arpSetRoot']);
  eq(m.pages.find((pg) => pg.id === 'clock').pushes.slice(0, 4).map((c) => c.label), ['Nudge slower', 'Nudge faster', 'Tempo −0.1', 'Tempo +0.1']);
  eq(m.unmapped, [], 'every knob and push has a CC');
  const seen = new Set();
  for (const x of mappingsOf(p.config.values)) {
    const k = `${x.channel}:${x.cc}`;
    assert(!seen.has(k), `${k} used once`);
    seen.add(k);
  }
  eq(whole(p, 'lfo:4').count, 0, 'a second time adds nothing');
});

test('the LIVE page shares its knobs’ CCs; a free knob takes any other setting', () => {
  const p = fresh();
  whole(p, 'euclid:0');
  const pulses = key('euclid', 0, 'pulses');
  apply(p, toggleLive(p.names, pulses));
  let m = modelOf(p);
  eq(m.pages[0].name, 'LIVE');
  eq(m.pages[0].cells[0].map, m.pages.find((pg) => pg.id === 'euclid:0').cells[0].map);
  const offered = choicesFor(m.objects, m.pages[0]);
  assert(offered.length >= 10 && offered.some((g) => g.name === 'Drum sequencer') && offered.some((g) => g.name === 'Stored levels'),
    'LIVE offers every object, including those without a page');
  const truncate = key('converter', 0, 'arpTruncate');
  assert(offered.find((g) => g.name === 'Voice 1').cells.some((c) => c.key === truncate));
  const before = mappingsOf(p.config.values).length;
  apply(p, placeWithCc(p.config.values, viewOf(p), p.names, m, 'live', 5, truncate).changes);
  m = modelOf(p);
  eq([m.pages[0].cells[5].short, mappingsOf(p.config.values).length], ['TRNC', before + 1], 'on LIVE only, with a new CC');
  apply(p, takeOff(p.names, m, 'live', 5));
  eq(mappingsOf(p.config.values).length, before, 'taken off LIVE, on no page: its CC goes');
  apply(p, takeOff(p.names, modelOf(p), 'live', 0));
  eq(mappingsOf(p.config.values).length, before, 'pulses is still on its own page: its CC stays');
  eq(p.names['ec4:live'], undefined);
  const page = modelOf(p).pages.find((pg) => pg.id === 'euclid:0');
  eq(choicesFor(modelOf(p).objects, page), [], 'the Euclid page has every Euclid setting already');
});

test('leftover CCs on no page show as stray and can be removed', () => {
  const p = fresh();
  const before = mappingsOf(p.config.values).length;
  eq(whole(p, 'srr:0').count, 8);
  for (const k of Object.keys(p.names)) delete p.names[k]; // as if made by the earlier "every knob a CC"
  const stray = strayMappings(viewOf(p), modelOf(p));
  assert(stray.length >= 7, 'the random source’s CCs are on no page');
  assert(!stray.some((s) => s.key.startsWith('output:16:')), 'the CC knobs are not stray: their mapping is the source');
  apply(p, removeMappings(p.names, stray));
  eq(mappingsOf(p.config.values).length, before + 7 - stray.length);
  eq(strayMappings(viewOf(p), modelOf(p)), []);
});

test('a knob whose object is gone shows as gone and gets no CC', () => {
  const p = fresh();
  apply(p, placeKnob(p.names, 'live', 2, 'euclid:9:pulses'));
  const model = modelOf(p);
  eq(model.pages[0].cells[2].gone, true);
  assert(!model.unmapped.includes('euclid:9:pulses'));
});

test('mapping the pages gives a knob without a CC a new one', () => {
  const p = fresh();
  apply(p, placeKnob(p.names, 'euclid:0', 1, key('euclid', 0, 'steps'))); // placed without a CC
  const m = modelOf(p);
  eq(m.unmapped, [key('euclid', 0, 'steps')]);
  const r = mapPages(p.config.values, viewOf(p), m, p.names);
  apply(p, r.changes);
  eq([r.mapped, modelOf(p).unmapped], [1, []]);
});

test('the pages become EC4 setup 15, and nothing else changes', () => {
  const p = fresh();
  whole(p, 'euclid:0');
  whole(p, 'knobs:1');
  whole(p, 'converter:0');
  const view = viewOf(p);
  const { pages, channel } = pagesOf(view, p.names);
  eq(pages.map((pg) => pg.name), ['VOI1', 'EUC1', 'CC2']);
  const base = demoImage();
  const img = setupImage(base, pages, view, channel);
  eq(M.readName(img, M.setupNameAddr(SETUP)), SETUP_NAME);
  eq(M.groupName(img, SETUP, 1), 'EUC1');
  eq(M.groupName(img, SETUP, 12), '    ', 'unused groups are blank');
  const e = M.readEncoder(img, SETUP, 2, 0);
  eq([e.type, e.channel, e.number, e.lower, e.upper, e.name], [M.T.CCAH, 1, 12, 0, 16383, 'C2.1']);
  const pulses = M.readEncoder(img, SETUP, 1, 0);
  eq([pulses.type, pulses.channel, pulses.number, pulses.upper, pulses.name], [M.T.CCAB, 1, 16, 127, 'PULS']);
  const free = M.readEncoder(img, SETUP, 1, 15);
  eq([free.type, free.number, free.name], [M.T.CCR1, 119, '    '], 'a free knob sends nothing anyone maps');
  const voice = pages[0];
  const arpAt = voice.cells.findIndex((c) => c?.setting.param === 'arpMode');
  const push = M.readPush(img, SETUP, 0, arpAt);
  eq([push.type, push.mode, push.number, push.lower, push.upper], [M.PT.CC, 0, voice.pushes[arpAt].map.cc, 0, 127], 'a key-mode CC push: 127 held, 0 released');
  eq(M.readPush(img, SETUP, 1, 0).type, M.PT.OFF, 'pushes without a command are off');
  eq(pushOf(null).type, M.PT.OFF);
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
  eq(OWNED.reduce((n, [, len]) => n + len, 0), 256 + 64 + 3072 + 512 + 4 + 64 + 512 + 512, 'setup 15, its name, and the FH-2 sync table (A and B)');
});

test('with the pages goes the FH-2 sync table: where each 14-bit knob’s value sits in the preset dump', () => {
  const p = fresh();
  whole(p, 'euclid:0');
  whole(p, 'knobs:1');
  const view = viewOf(p);
  const { pages, channel } = pagesOf(view, p.names);
  const img = setupImage(demoImage(), pages, view, channel);
  eq([...img.slice(SYNC_HEADER, SYNC_HEADER + 8)], [0x46, 0x48, 0x32, 0x01, SETUP, 8, 1, 0], '"FH2" format 1, setup 15, dump version 8, requests to USB');
  assert(img.slice(SYNC_HEADER + 8, SYNC_HEADER + 64).every((b) => b === 0xff), 'the rest of its page blank');
  const entry = (g, k) => (img[SYNC_ENTRIES + 32 * g + 2 * k] << 8) | img[SYNC_ENTRIES + 32 * g + 2 * k + 1];
  const g = pages.findIndex((pg) => pg.id === 'knobs:1');
  const c = pages[g].cells[0];
  eq([c.setting.param, c.map.bits], ['directLevel', 14]);
  eq(entry(g, 0), 24 + 2 * c.setting.index, 'a direct level: 24 + 2·output in the body');
  eq(syncEntry(c, { format: 1 }).a, entry(g, 0));
  const e = pages.findIndex((pg) => pg.id === 'euclid:0');
  eq(entry(e, 0), 0xffff, 'a 7-bit knob has none');
  eq(entry(15, 15), 0xffff, 'nor a free one');
});

test('writing setup 15 to the mock EC4 leaves every other setup as it was', async () => {
  const p = fresh();
  whole(p, 'lfo:4');
  whole(p, 'clock');
  const view = viewOf(p);
  const { pages, channel } = pagesOf(view, p.names);
  const mock = new MockDevice(demoImage(), { speed: 'fast' });
  const dev = new Device(mock.transport());
  const before = Uint8Array.from(mock.eeprom);
  const base = await readSetup(dev);
  const state = setupState(base);
  eq([state.name, state.free, state.ours], ['SE15', true, false], 'the demo’s setup 15 is unused');
  const img = setupImage(base, pages, view, channel);
  assert((await writeSetup(dev, img, base)) > 0);
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

test('page names', () => {
  const p = fresh();
  on(p, key('output', 4, 'lfoLevel'));
  eq(pagesOf(viewOf(p), { ...p.names, [pageNameKey('lfo:4')]: 'Wobble' }).pages[0].name, 'Wobb', 'a page can be renamed');
  eq(liveKeys(p.names), Array(16).fill(''));
});

test('knobs Night Shift maps are absolute again: the sync keeps them in step', () => {
  const p = fresh();
  const pick = (k) => {
    eq(modelOf(p).mapOf(k), null, `${k} has no CC yet`);
    on(p, k);
    return modelOf(p).mapOf(k);
  };
  const gate = pick(key('euclid', 0, 'gate'));
  eq([gate.relative, gate.bits], [false, 7], 'a 7-bit setting: absolute');
  const cell = modelOf(p).pages.flatMap((pg) => pg.cells).find((c) => c?.key === key('euclid', 0, 'gate'));
  eq(encoderOf(cell, viewOf(p), 1).type, M.T.CCAB, 'and so is its EC4 knob');
  const depth = pick(key('output', 5, 'lfoLevel'));
  eq([depth.relative, depth.bits], [false, 14], '14-bit');
  // one made while 7-bit knobs were relative can be made absolute
  apply(p, [{ dump: 'config', path: ['mapping', gate.slot, 'target'], value: p.config.values.mapping[gate.slot].target | 32 }]);
  const r = toAbsolute(p.config.values, modelOf(p), p.names);
  eq(r.keys, [key('euclid', 0, 'gate')], 'only Night Shift’s relative knobs');
  apply(p, r.changes);
  eq(modelOf(p).mapOf(key('euclid', 0, 'gate')).relative, false);
});

test('every CV jack’s level and smoothing can go on the EC4: a free jack’s, and a voice’s offset', () => {
  const p = fresh();
  const v = viewOf(p);
  const model = modelOf(p);
  const free = v.outputs.find((o) => o.index < 64 && o.present && !o.gate && !o.ports.length && !o.lfo);
  const lvl = key('output', free.index, 'directLevel');
  assert(model.known.has(lvl) && model.known.has(key('output', free.index, 'smoothing')), 'a free jack’s level and smoothing');
  const r = on(p, lvl);
  const m = modelOf(p).mapOf(lvl);
  eq([r.where.page, m.channel], [`knobs:${modelOf(p).channel}`, modelOf(p).channel], 'it gets a CC on the pages channel, on that channel’s CC → CV page');
  eq(viewOf(p).outputs[free.index].ports.map((x) => x.source), [`knobs:${m.channel}`], 'and the jack is a MIDI knob now');
  // a voice's velocity jack: its offset and smoothing go with the voice; its pitch jack only smoothing
  const voice = v.sources.find((s) => s.kind === 'voice' && s.ports.some((x) => x.name === 'Velocity' && x.present));
  const vel = voice.ports.find((x) => x.name === 'Velocity');
  const pitch = voice.ports.find((x) => /^Pitch/.test(x.name) && x.present && !v.outputs[x.output].lfo);
  const page = (k) => model.objects.find((o) => o.knobs.some((c) => c.key === k))?.page;
  eq(page(key('output', vel.output, 'directLevel')), voice.id, 'velocity: an offset, on the voice’s page');
  if (pitch) {
    eq(page(key('output', pitch.output, 'directLevel')), undefined, 'pitch replaces the level: no offset');
    eq(page(key('output', pitch.output, 'smoothing')), voice.id, 'but its smoothing');
  }
});

test('several settings come off the EC4 in one step, with the CCs Night Shift added', () => {
  const p = fresh();
  const a = key('euclid', 0, 'gate');
  const b = key('euclid', 0, 'accent');
  on(p, a);
  on(p, b);
  const before = modelOf(p);
  assert(before.on.has(a) && before.on.has(b));
  apply(p, switchOffAll(p.names, before, [a, b]));
  const after = modelOf(p);
  eq([after.on.has(a), after.on.has(b), after.mapOf(a), after.mapOf(b)], [false, false, null, null], 'both off, neither undoing the other');
});

test('an LFO on top of a pitch offers no Centre; a knob on LIVE too counts once', () => {
  const p = fresh();
  const v = viewOf(p);
  const vib = v.outputs.find((o) => o.lfo && !o.lfo.alone && o.ports.some((x) => /^Pitch/.test(x.name)));
  if (vib) {
    const obj = modelOf(p).objects.find((o) => o.id === `lfo:${vib.index}`);
    assert(!obj.knobs.some((c) => c.setting.param === 'directLevel'), 'the pitch replaces the level: no Centre');
    assert(obj.knobs.some((c) => c.setting.param === 'lfoLevel'));
  }
  const k = key('euclid', 0, 'gate');
  on(p, k);
  apply(p, toggleLive(p.names, k));
  const slot = modelOf(p).mapOf(k).slot;
  apply(p, [{ dump: 'config', path: ['mapping', slot, 'target'], value: p.config.values.mapping[slot].target | 32 }]);
  eq(toAbsolute(p.config.values, modelOf(p), p.names).keys, [k], 'once, though on its page and on LIVE');
});

test('sync table format 2: 7-bit knobs as they are, banded ones, the tempo', () => {
  const p = fresh();
  for (const param of ['pulses', 'steps', 'gate']) on(p, key('euclid', 0, param));
  on(p, key('global', 0, 'tempo'));
  const view = viewOf(p);
  const { pages, channel } = pagesOf(view, p.names);
  const img = setupImage(demoImage(), pages, view, channel, { format: 2, tempoMin: 59 });
  eq(img[SYNC_HEADER + 3], 2, 'format 2');
  eq(img[SYNC_HEADER + 7], 0, 'no scene program change channel given: 0');
  eq(setupImage(demoImage(), pages, view, channel, { format: 2, programChannel: 5 })[SYNC_HEADER + 7], 5, 'scenes by program change on ch 5');
  eq(setupImage(demoImage(), pages, view, channel, { format: 1, programChannel: 5 })[SYNC_HEADER + 7], 0, 'format 1 keeps 0');
  const at = (k, image = img) => {
    const g = pages.findIndex((pg) => pg.cells.some((c) => c?.key === k));
    const i = pages[g].cells.findIndex((c) => c?.key === k);
    const o = 32 * g + 2 * i;
    return { a: (image[SYNC_ENTRIES + o] << 8) | image[SYNC_ENTRIES + o + 1], b: [image[SYNC_EXTRA + o], image[SYNC_EXTRA + o + 1]] };
  };
  const pulses = at(key('euclid', 0, 'pulses'));
  eq([pulses.a >> 12, pulses.b], [2, [33, 0]], 'pulses: banded, 33 bands from 0');
  eq(at(key('euclid', 0, 'steps')).b, [33 | 0x40, 0], 'steps: the same, held at 1');
  const gate = at(key('euclid', 0, 'gate'));
  eq([gate.a >> 12, gate.b], [1, [0xff, 0xff]], 'gate length: as it is');
  const tempo = at(key('global', 0, 'tempo'));
  eq([tempo.a >> 12, tempo.b], [3, [60, 0]], 'the tempo: CC 0 is 60 BPM');
  // format 1 (controlfrog 0.11) has only the 14-bit knobs
  const one = setupImage(demoImage(), pages, view, channel, { format: 1 });
  eq([one[SYNC_HEADER + 3], at(key('euclid', 0, 'pulses'), one).a, at(key('global', 0, 'tempo'), one).a], [1, 0xffff, 0xffff], 'format 1: no 7-bit entries');
  eq([SYNC_FORMAT({ fwMajor: 0, fwMinor: 11 }), SYNC_FORMAT({ fwMajor: 0, fwMinor: 12 })], [1, 2]);
});

test('more LIVE pages: made empty, filled, knobs moved between them, removed with their knobs', () => {
  const p = fresh();
  whole(p, 'euclid:0');
  const pulses = key('euclid', 0, 'pulses');
  const steps = key('euclid', 0, 'steps');
  let r = addLivePage(p.names);
  eq(r.id, 'live', 'the first is LIVE');
  apply(p, r.changes);
  r = addLivePage(p.names);
  eq(r.id, 'live:2');
  apply(p, r.changes);
  let m = modelOf(p);
  eq(m.pages.slice(0, 3).map((pg) => [pg.id, pg.name, pg.cells.some(Boolean)]), [['live', 'LIVE', false], ['live:2', 'LIV2', false], ['euclid:0', 'EUC1', true]],
    'empty LIVE pages stay, in front');
  apply(p, toggleLive(p.names, pulses, 'live:2'));
  m = modelOf(p);
  eq(m.pages.find((pg) => pg.id === 'euclid:0').cells[0].lives, ['live:2']);
  eq(m.pages[1].cells[0].map, m.pages.find((pg) => pg.id === 'euclid:0').cells[0].map, 'the same CC as on its own page');
  // from its own page onto LIVE: it stays on its page too; from one LIVE page to another: it moves
  const euclidPage = m.pages.find((pg) => pg.id === 'euclid:0');
  const at = euclidPage.cells.findIndex((c) => c?.key === steps);
  apply(p, toLivePage(p.names, 'euclid:0', at, 'live').changes);
  eq([liveKeys(p.names, 'live')[0], addedKeysOf(p, 'euclid:0').includes(steps)], [steps, true]);
  apply(p, toLivePage(p.names, 'live', 0, 'live:2').changes);
  eq([liveKeys(p.names, 'live')[0], liveKeys(p.names, 'live:2').slice(0, 2)], ['', [pulses, steps]], 'moved, not copied');
  // removing LIV2: its knobs come off it; those also on their own page keep their CC
  const before = mappingsOf(p.config.values).length;
  apply(p, removeLivePage(p.names, modelOf(p), 'live:2'));
  eq([liveIds(p.names), mappingsOf(p.config.values).length], [['live'], before]);
});

test('moving a place swaps the knob and the push under it', () => {
  const p = fresh();
  whole(p, 'converter:0');
  const m = modelOf(p);
  const pg = m.pages.find((x) => x.id === 'converter:0');
  const withPush = pg.pushes.findIndex(Boolean);
  const free = pg.cells.findIndex((c, i) => !c && !pg.pushes[i]);
  assert(withPush >= 0 && free >= 0, 'a voice page has arp pushes and a free place');
  const [k, push] = [pg.cells[withPush]?.key ?? null, pg.pushes[withPush].key];
  apply(p, movePlace(p.names, 'converter:0', withPush, free));
  const after = modelOf(p).pages.find((x) => x.id === 'converter:0');
  eq([after.cells[free]?.key ?? null, after.pushes[free]?.key, after.cells[withPush], after.pushes[withPush]], [k, push, null, null]);
  eq(movePlace(p.names, 'converter:0', 3, 3), [], 'onto itself: nothing');
});

test('a push comes off the EC4 like a knob, its CC too; a page of pushes only goes with them', () => {
  const p = fresh();
  const nudge = key('global', 0, 'nudgeSlower');
  const slots = () => p.config.values.mapping.filter((m) => m.status !== 0x7f).length;
  const [before, stray] = [slots(), strayMappings(viewOf(p), modelOf(p))];
  const r = on(p, nudge);
  eq([r.where.page, r.where.push, slots()], ['clock', true, before + 1], 'on a push of the clock page, with a CC');
  eq(modelOf(p).pages.find((pg) => pg.id === 'clock').cells.every((c) => !c), true, 'no knob on that page, only the push');
  apply(p, switchOff(p.names, modelOf(p), nudge));
  const m = modelOf(p);
  eq([m.on.has(nudge), m.pages.some((pg) => pg.id === 'clock'), slots(), strayMappings(viewOf(p), m)], [false, false, before, stray], 'no CC left behind');
});

test('a setting gone from the patch can still come off the EC4', () => {
  const p = fresh();
  const pulses = key('euclid', 9, 'pulses'); // Euclid 10, not in the patch (any more)
  p.names['ec4:live'] = [pulses, ...Array(15).fill('')].join(',');
  let m = modelOf(p);
  const cell = m.pages.find((pg) => pg.id === 'live').cells.find((c) => c?.key === pulses);
  eq([cell?.gone, m.known.has(pulses), m.on.has(pulses)], [true, false, true], 'still on LIVE, marked gone');
  apply(p, switchOff(p.names, m, pulses));
  m = modelOf(p);
  eq([m.on.has(pulses), liveKeys(p.names).includes(pulses)], [false, false]);
});

test('one CC mapping removed: off the EC4 too, also when Night Shift didn’t add it', () => {
  const p = fresh();
  const view = viewOf(p);
  const own = view.mappings.find((m) => m.target.kind === 'global' && m.target.param === 'tempo'); // the config's own
  assert(own, 'the example maps the tempo');
  const tempo = settingKey(own.target);
  on(p, tempo); // on the clock page, with the config's mapping
  apply(p, dropMapping(p.names, modelOf(p), own.slot, tempo));
  const m = modelOf(p);
  eq([p.config.values.mapping[own.slot].status, m.on.has(tempo), m.mapOf(tempo)], [0x7f, false, null]);
  // a mapping of a setting on no page: just gone
  const other = viewOf(p).mappings.find((x) => x.target.kind !== 'unknown' && !m.on.has(settingKey(x.target)));
  apply(p, dropMapping(p.names, m, other.slot, settingKey(other.target)));
  eq(p.config.values.mapping[other.slot].status, 0x7f);
});

test('pages past the 16th can be opened: their CCs are known, but they need none', () => {
  const p = fresh();
  for (const o of modelOf(p).objects) if (o.knobs[0]) on(p, o.knobs[0].key);
  p.names['ec4:lives'] = 'live,live:2,live:3,live:4,live:5';
  const m = modelOf(p);
  eq([m.pages.length, m.extra.length], [16, 1]);
  const last = m.extra[0];
  const c = last.cells.find(Boolean);
  eq([last.group, !!c.map, m.unmapped.includes(c.key)], [undefined, true, false]);
});

test('a source removed takes its whole page off the EC4, LIVE included, and the CCs Night Shift added', () => {
  const p = fresh();
  whole(p, 'converter:0');
  const attack = key('converter', 0, 'envAttack');
  apply(p, toggleLive(p.names, attack));
  const slots = () => p.config.values.mapping.filter((m) => m.status !== 0x7f).length;
  const [before, stray] = [slots(), strayMappings(viewOf(p), modelOf(p))];
  const m = modelOf(p);
  const keys = objectKeys(m, 'converter:0');
  assert(keys.includes(attack) && keys.includes(key('converter', 0, 'arpAdd')), 'its knobs and its pushes');
  apply(p, switchOffAll(p.names, m, keys));
  const after = modelOf(p);
  eq([after.pages.some((pg) => pg.id === 'converter:0'), after.on.has(attack), liveKeys(p.names).some(Boolean)], [false, false, false]);
  assert(slots() < before, 'the CCs it added are gone');
  eq(strayMappings(viewOf(p), after), stray, 'none left behind');
  eq(Object.keys(p.names).filter((k) => k.includes('converter:0')), [], 'nothing of its page left in the names');
});
