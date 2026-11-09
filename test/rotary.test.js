// Tests for the BCR32's pages under Rotary Club: Night Shift's own pages and knobs (templates in
// half pages, the CCs shared with the EC4), the 4 KB image it writes (only its own knobs, their
// sync entries, the header), and the live link, against Eye of Providence's mock BCR32.

import { test, assert, eq } from './harness.js';
import { derive } from '../js/patch/derive.js';
import { examplePatch } from '../js/patch/example.js';
import { apply } from '../js/patch/edit.js';
import { mappingsOf } from '../js/patch/mappings.js';
import { pagesOf, switchOn as ec4On, switchOff as ec4Off, settingKey, strayMappings, dropMapping, leftBehind } from '../js/ec4/pages.js';
import { bcrPagesOf, putObject, switchOn, switchOff, placeKnob, takeOff, movePlace, clearPage, freeHalf, knobOf, knobKeys, halfChoices, pageOfObject } from '../js/rotary/pages.js';
import { wanted, plan, writePlan, storeImage, readImage, emptyHeld, heldToJson, heldFromJson, foreignKnobs, knobBytes, editsFor, emptyKnob, KNOB_BYTES } from '../js/rotary/image.js';
import { Bcr32Link } from '../js/rotary/link.js';
import * as R from '../vendor/eyeofprovidence/js/model.js';
import { MockBcr32 } from '../vendor/eyeofprovidence/js/mock.js';
import { Device } from '../vendor/eyeofprovidence/js/device.js';
import { decodeCommand } from '../vendor/eyeofprovidence/js/proto.js';

const fresh = () => {
  const { config, preset } = examplePatch();
  return { config, preset, names: {} };
};
const viewOf = (p) => derive(p.config.values, p.preset.values, undefined, p.names);
const ec4Of = (p) => pagesOf(viewOf(p), p.names);
const bcrOf = (p) => bcrPagesOf(ec4Of(p), p.names);
const key = (kind, index, param) => settingKey({ kind, index, param });
const ok = (p, r) => {
  if (r.error) throw new Error(r.error);
  apply(p, r.changes);
  return r;
};
const put = (p, objPage, page, half, foreign) => ok(p, putObject(p.config.values, viewOf(p), p.names, ec4Of(p), bcrOf(p), objPage, page, half, foreign));
const on = (p, k, opts) => ok(p, switchOn(p.config.values, viewOf(p), p.names, ec4Of(p), bcrOf(p), k, opts));
const sync = (p) => ({ tempoMin: p.config.values.tempoMin, programChannel: p.config.values.presetProgramChannel });

// Eye of Providence's knobs: page 1 right top row sends Rytm CCs; key 1 a note.
function othersImage() {
  const img = R.blankImage();
  R.ensureHeader(img);
  for (let c = 4; c < 8; c++) {
    R.setEncoder(img, 0, c, 'type', R.T.CCAB);
    R.setEncoder(img, 0, c, 'channel', 9);
    R.setEncoder(img, 0, c, 'number', 70 + c);
    R.setName(img, 0, c, `RY${c}`);
  }
  R.setPush(img, 0, R.keyCell(0), 'type', R.PT.NOTE);
  R.setName(img, 0, R.keyCell(0), 'Kick');
  R.writeName(img, R.pageNameAddr(0), 'RYTM');
  return img;
}

test('a half page takes an object’s template; its settings get CCs shared with the EC4', () => {
  const p = fresh();
  const before = mappingsOf(p.config.values).length;
  eq(halfChoices(ec4Of(p)).some((c) => c.page === 'lfo:4'), true, 'an LFO can fill a half');
  const r = put(p, 'lfo:4', 1, 1);
  eq(r.count, 15);
  const b = bcrOf(p);
  eq(b.pages[1].cells.map((c, i) => (c ? i : null)).filter((i) => i != null), [4, 5, 6, 7, 12, 13, 14, 15, 20, 21, 22, 23, 28, 29, 30], 'the right four columns');
  eq(b.pages[1].cells[knobOf(1, 0)].short, 'SYNC');
  eq(b.unmapped, [], 'every knob has a CC');
  assert(mappingsOf(p.config.values).length > before, 'CCs were added');
  eq(b.pages[1].cells[knobOf(1, 14)].map.bits, 14, 'RATE is 14-bit');
  eq(b.count, 15);
  eq(ec4Of(p).pages.length, 0, 'the EC4 has its own pages: nothing there');
  eq(freeHalf(b, 1), 0, 'the left half is still free');
});

test('a CC stays while either controller has its setting, and goes when neither does', () => {
  const p = fresh();
  const attack = key('converter', 0, 'envAttack');
  const n = mappingsOf(p.config.values).length;
  const stray = strayMappings(viewOf(p), ec4Of(p), p.names).length;
  ok(p, ec4On(p.config.values, viewOf(p), p.names, ec4Of(p), attack));
  on(p, attack);
  eq(mappingsOf(p.config.values).length, n + 1, 'one CC for both');
  eq(bcrOf(p).pages[0].cells[0].map.cc, ec4Of(p).pages[0].cells[0].map.cc, 'the same CC');
  apply(p, ec4Off(p.names, ec4Of(p), attack));
  eq(mappingsOf(p.config.values).length, n + 1, 'off the EC4: the BCR32 keeps the CC');
  eq(strayMappings(viewOf(p), ec4Of(p), p.names).length, stray, 'and it isn’t stray');
  apply(p, switchOff(p.names, ec4Of(p), attack));
  eq(mappingsOf(p.config.values).length, n, 'off both: gone');
  on(p, attack);
  ok(p, ec4On(p.config.values, viewOf(p), p.names, ec4Of(p), attack));
  apply(p, takeOff(p.names, ec4Of(p), 0, 0));
  eq(mappingsOf(p.config.values).length, n + 1, 'off the BCR32: the EC4 keeps it');
});

test('a mapping dropped, or its source gone, takes the setting off the BCR32 too', () => {
  const p = fresh();
  const attack = key('converter', 0, 'envAttack');
  on(p, attack);
  const m = mappingsOf(p.config.values).find((x) => settingKey(x.target) === attack);
  apply(p, dropMapping(p.names, ec4Of(p), m.slot, attack));
  eq(bcrOf(p).count, 0, 'off the BCR32');
  eq(mappingsOf(p.config.values).some((x) => settingKey(x.target) === attack), false);
  on(p, attack);
  const before = ec4Of(p);
  const after = { ...before, objects: before.objects.filter((o) => o.id !== 'converter:0'), known: new Map([...before.known].filter(([k]) => !k.startsWith('converter:0:'))) };
  apply(p, leftBehind(before, after, p.names));
  eq(knobKeys(p.names, 0).filter(Boolean), [], 'an object gone from the patch leaves the BCR32 too');
});

test('a setting clicked in the Patch tab goes with its object, else into a free half, never onto another’s knob', () => {
  const p = fresh();
  const others = foreignKnobs(othersImage(), emptyHeld());
  const foreign = (pg, i) => others.has(`${pg}:${i}`);
  eq(others.size, 4, 'Eye of Providence’s four knobs (keys aren’t knobs)');
  const a = on(p, key('converter', 0, 'envAttack'), { page: 0, foreign });
  eq(a.where, { page: 0, index: 0, push: false }, 'page 1’s left half is free');
  const d = on(p, key('converter', 0, 'arpMode'), { page: 0, foreign });
  const t = ec4Of(p).objects.find((o) => o.id === 'converter:0').template.cells.indexOf(key('converter', 0, 'arpMode'));
  eq(d.where.index, knobOf(0, t), 'its template’s place in the same half');
  const e = on(p, key('euclid', 0, 'pulses'), { page: 0, foreign });
  eq(e.where.page, 1, 'page 1’s right half holds the Rytm knobs: the next free half is on page 2');
  eq(e.where.index, 0);
  const add = on(p, key('converter', 0, 'arpAdd'), { page: 0, foreign });
  eq(add.where.push, true, 'a command goes on a push');
  eq(pageOfObject(ec4Of(p), bcrOf(p), 'converter:0'), 0);
  eq(pageOfObject(ec4Of(p), bcrOf(p), 'euclid:0'), 1);
});

test('places move across pages with their pushes; a page clears', () => {
  const p = fresh();
  put(p, 'converter:0', 0, 0);
  const b = bcrOf(p);
  const at = b.pages[0].pushes.findIndex(Boolean);
  const k = b.pages[0].cells[at].key;
  apply(p, movePlace(p.names, { page: 0, index: at }, { page: 2, index: 31 }));
  eq(bcrOf(p).pages[2].cells[31].key, k);
  eq(bcrOf(p).pages[2].pushes[31].setting.param, 'arpAdd', 'the push went with it');
  eq(bcrOf(p).pages[0].cells[at], null);
  const n = mappingsOf(p.config.values).length;
  apply(p, clearPage(p.names, ec4Of(p), 0));
  eq(bcrOf(p).pages[0].cells.filter(Boolean).length, 0);
  assert(mappingsOf(p.config.values).length < n, 'their CCs went with them');
  eq(bcrOf(p).pages[2].cells[31].key, k, 'the moved one stays, with its CC');
  assert(bcrOf(p).pages[2].cells[31].map, 'its CC');
});

test('the image: only Night Shift’s knobs, their records as the EC4’s, sync entries, the header', () => {
  const p = fresh();
  put(p, 'lfo:4', 0, 0);
  put(p, 'clock', 1, 1);
  const view = viewOf(p);
  const want = wanted(bcrOf(p), view, sync(p));
  const img = othersImage();
  const pl = plan(img, want, emptyHeld());
  eq(pl.conflicts, [], 'nothing in the way');
  eq(pl.changed, 15 + 4, 'the LFO’s knobs, the clock’s four places (three knobs, four pushes under them)');
  for (let a = 0; a < R.SIZE; a++) {
    const p0 = R.locate(a);
    const night = p0.cell != null && p0.cell < 32 && want.knobs.has(`${p0.page}:${p0.cell}`);
    if (!night && a >= R.A.SYNC + 8 && pl.next[a] !== img[a]) throw new Error(`0x${a.toString(16)} changed`);
  }
  for (let c = 4; c < 8; c++) eq(R.readCell(pl.next, 0, c).name, `RY${c}`, 'Eye of Providence’s knob as it was');
  eq(R.readCell(pl.next, 0, R.keyCell(0)).name, 'Kick', 'the key as it was');
  eq(R.pageName(pl.next, 0), 'RYTM', 'the page’s name as it was: you gave none');
  const rate = R.readCell(pl.next, 0, knobOf(0, 14));
  eq([rate.enc.type, rate.name], [R.T.CCAH, 'RATE'], 'a 14-bit knob');
  const s = R.readSync(pl.next, 0, knobOf(0, 14));
  eq(s.type, 0, 'a u14 entry');
  eq(R.readSync(pl.next, 0, knobOf(0, 4)).type, 1, 'SINE: u7');
  assert(pl.next[R.syncCAddr(0, knobOf(0, 14))] !== 0xff, 'table C: how it shows');
  eq(Array.from(pl.next.slice(R.A.SYNC, R.A.SYNC + 8)).slice(0, 7), [0x46, 0x48, 0x32, 2, 0, 8, 1], 'the header: FH2, format 2, dump 8, asks on USB');
  const push = R.readCell(pl.next, 1, knobOf(1, 0));
  eq(push.enc.type, R.T.CCAB, 'tempo on a knob');
  const cmd = bcrOf(p).pages[1].pushes.findIndex(Boolean);
  const only = R.readCell(pl.next, 1, cmd);
  if (!bcrOf(p).pages[1].cells[cmd]) eq([only.enc.off, only.push.type], [true, R.PT.CC], 'a push alone: no encoder');
  for (const w of pl.writes) for (let a = w.addr; a < w.addr + w.data.length; a++) assert(R.writable(a), 'only spec bytes');
  assert(pl.writes.every((w) => w.data.length <= 256), 'at most 256 bytes a WRITE');
});

test('another app’s knob in the way is asked about; one Night Shift holds is rewritten; one changed elsewhere is let go', () => {
  const p = fresh();
  const pulses = key('euclid', 0, 'pulses');
  ok(p, placeKnob(p.config.values, viewOf(p), p.names, ec4Of(p), 0, 4, pulses)); // onto RY4
  let want = wanted(bcrOf(p), viewOf(p), sync(p));
  const img = othersImage();
  let pl = plan(img, want, emptyHeld());
  eq(pl.conflicts.map((c) => [c.p, c.i, c.now.name]), [[0, 4, 'RY4']], 'asked first');
  eq(pl.writes.some((w) => w.addr <= R.cellAddr(0, 4) && w.addr + w.data.length > R.cellAddr(0, 4)), false, 'not written without a yes');
  pl = plan(img, want, emptyHeld(), { over: new Set(['0:4']) });
  eq(pl.conflicts, []);
  eq(R.readCell(pl.next, 0, 4).name, 'PULS', 'written over after a yes');
  let held = pl.held;
  let now = pl.next;
  // the knob moves elsewhere: Night Shift empties what it held
  apply(p, movePlace(p.names, { page: 0, index: 4 }, { page: 3, index: 0 }));
  want = wanted(bcrOf(p), viewOf(p), sync(p));
  pl = plan(now, want, held);
  eq(pl.cleared, 1);
  assert(emptyKnob(knobBytes(pl.next, 0, 4)), 'page 1 knob 5 emptied');
  eq(R.readCell(pl.next, 3, 0).name, 'PULS');
  held = pl.held;
  now = pl.next;
  // Eye of Providence changes Night Shift's knob: it is let go, and asked about if wanted again
  R.setName(now, 3, 0, 'MINE');
  apply(p, takeOff(p.names, ec4Of(p), 3, 0));
  pl = plan(now, wanted(bcrOf(p), viewOf(p), sync(p)), held);
  eq([pl.cleared, pl.writes.length], [0, 0], 'left as it is');
  eq(pl.held.knobs.has('3:0'), false, 'and no longer Night Shift’s');
  // a held one, unchanged: rewritten without asking
  ok(p, placeKnob(p.config.values, viewOf(p), p.names, ec4Of(p), 2, 9, pulses));
  pl = plan(now, wanted(bcrOf(p), viewOf(p), sync(p)), held);
  held = pl.held;
  now = pl.next;
  ok(p, placeKnob(p.config.values, viewOf(p), p.names, ec4Of(p), 2, 9, key('euclid', 0, 'steps')));
  pl = plan(now, wanted(bcrOf(p), viewOf(p), sync(p)), held);
  eq([pl.conflicts.length, pl.changed], [0, 1], 'its own knob, rewritten');
  eq(heldFromJson(JSON.parse(JSON.stringify(heldToJson(pl.held)))).knobs.get('2:9'), pl.held.knobs.get('2:9'), 'kept in this browser as hex');
});

test('a page name you give is written; one another app set is asked about', () => {
  const p = fresh();
  put(p, 'lfo:4', 0, 0);
  p.names['bcr:page:1'] = 'WOBL';
  p.names['bcr:page:2'] = 'MINE';
  const pl = plan(othersImage(), wanted(bcrOf(p), viewOf(p), sync(p)), emptyHeld());
  eq(pl.conflicts.filter((c) => c.name != null).map((c) => [c.p, c.name]), [[0, 'RYTM']]);
  eq(R.pageName(pl.next, 1), 'MINE', 'a blank name is free');
  eq(R.pageName(pl.next, 0), 'RYTM');
});

test('Send to the mock BCR32: Night Shift’s knobs written and stored, every other byte as it was', async () => {
  const p = fresh();
  put(p, 'lfo:4', 0, 0);
  put(p, 'converter:0', 2, 1);
  const mock = new MockBcr32(othersImage(), { speed: 'fast' });
  const dev = new Device(mock.transport());
  const img = await readImage(dev);
  const want = wanted(bcrOf(p), viewOf(p), sync(p));
  const pl = plan(img, want, emptyHeld());
  await writePlan(dev, pl);
  eq(mock.stats.reloads, 1);
  for (let a = 0; a < R.SIZE; a++) if (mock.store[a] !== pl.next[a]) throw new Error(`0x${a.toString(16)}: ${mock.store[a]} != ${pl.next[a]}`);
  const log = mock.stats.log;
  const before = othersImage();
  const touched = new Set(log.flatMap((w) => w.data.map((_, k) => w.addr + k)));
  for (const a of touched) {
    const l = R.locate(a);
    const ours = (l.cell != null && l.cell < 32 && want.knobs.has(`${l.page}:${l.cell}`)) || (a >= R.A.SYNC && a < R.A.SYNC + 8);
    if (!ours) throw new Error(`wrote 0x${a.toString(16)}, not Night Shift’s`);
  }
  for (let c = 4; c < 8; c++) eq(Array.from(R.readRecord(mock.store, 0, c)), Array.from(R.readRecord(before, 0, c)), `RY${c} untouched`);
  eq(Array.from(R.readRecord(mock.store, 0, R.keyCell(0))), Array.from(R.readRecord(before, 0, R.keyCell(0))), 'key 1 untouched');
  // again: nothing to write
  const again = plan(await readImage(dev), want, pl.held);
  eq(again.writes.length, 0, 'the BCR32 has these knobs already');
  // RELOAD unanswered: the write fails, so nothing counts as stored
  apply(p, takeOff(p.names, ec4Of(p), 0, 0));
  const third = plan(await readImage(dev), wanted(bcrOf(p), viewOf(p), sync(p)), pl.held);
  eq(third.cleared, 1);
  mock.faults.dropReplies = 3;
  let failed = false;
  try {
    await writePlan(dev, third);
  } catch {
    failed = true;
  }
  eq(failed, true, 'no answer, no stored state');
  dev.close();
});

test('the live link: pages and touches come in; texts, values and RAM edits go out for Night Shift’s knobs only', async () => {
  const p = fresh();
  put(p, 'lfo:4', 0, 0);
  const mock = new MockBcr32(othersImage(), { speed: 'fast' });
  const sent = [];
  const t = mock.transport();
  const send = t.send.bind(t);
  t.send = (bytes) => {
    sent.push(Uint8Array.from(bytes));
    send(bytes);
  };
  const dev = new Device(t);
  const link = new Bcr32Link(dev, await dev.identify());
  const events = [];
  link.addEventListener('state', (e) => events.push(['state', e.detail.page, e.detail.mode]));
  link.addEventListener('touch', (e) => events.push(['touch', e.detail.kind, e.detail.index, e.detail.page]));
  await link.start();
  eq([link.page, link.controller], [0, true]);
  assert(mock.touchOn, 'touch events on');
  const b = bcrOf(p);
  const knobs = b.pages[0].cells.map((c, i) => (c ? { text: `${i}`.padStart(4), cc: { channel: c.map.channel, number: c.map.cc, value: 5, bits: c.map.bits } } : null));
  await link.show(knobs);
  await dev.getState();
  eq([...mock.texts[1].keys()].sort((a, c) => a - c), b.pages[0].cells.map((c, i) => (c ? i : null)).filter((i) => i != null), 'value texts on Night Shift’s knobs only');
  const ccs = sent.filter((m) => (m[0] & 0xf0) === 0xb0);
  assert(ccs.length >= 15, 'their values as CCs');
  assert(ccs.every((m) => (m[0] & 15) === b.channel), 'on the pages channel');
  // pacing: never more than 512 bytes without a reply in between
  let run = 0;
  for (const m of sent) {
    const c = decodeCommand(m);
    if (c?.cmd === 0x20) run = 0;
    else run += m.length;
    assert(run <= 512, 'paced');
  }
  // RAM edits: only places Night Shift may write
  const img = await readImage(dev);
  const want = wanted(b, viewOf(p), sync(p));
  const edits = editsFor(img, want, emptyHeld(), 0);
  eq([...edits.keys()].every((i) => want.knobs.has(`0:${i}`)), true);
  eq(edits.has(4), false, 'RY4 isn’t edited');
  await link.edit(edits, (i) => R.readRecord(img, 0, i));
  await dev.getState();
  eq(mock.edits.size, edits.size);
  eq(R.readName(mock.record(0), 8), 'SYNC', 'the BCR32 plays Night Shift’s knob from RAM');
  eq(R.readName(mock.record(4), 8), 'RY4 ');
  // the BCR32 turns a page, and a knob is touched
  mock.setPage(2);
  mock.touch(0, 3, 1000);
  await dev.getState(); // (answered by the page change's own 21: one more for the touch)
  await dev.getState();
  eq(events.filter((e) => e[0] !== 'state' || e[1] === 2), [['state', 2, 1], ['touch', 0, 3, 2]]);
  eq(link.shown.size, 0, 'a new page shows no texts of Night Shift’s');
  await link.select(1);
  eq(mock.page, 1, 'Night Shift turns the page');
  mock.setMode(0);
  await dev.getState();
  eq(link.controller, false, 'the sequencer shows');
  dev.close();
});

test('held knobs survive JSON; bad entries are dropped', () => {
  const held = heldFromJson({ knobs: { '0:1': 'ff'.repeat(KNOB_BYTES), '9:1': 'ff'.repeat(KNOB_BYTES), '0:2': 'zz' }, names: { 0: 'ABCD', 7: 'X' } });
  eq([...held.knobs.keys()], ['0:1']);
  eq([...held.names], [[0, 'ABCD']]);
});

test('the rack says which controllers are on; a rack kept from before has both', async () => {
  const { validHardware, hasController, DEFAULT_HARDWARE } = await import('../js/patch/hardware.js');
  eq([hasController(DEFAULT_HARDWARE, 'ec4'), hasController(DEFAULT_HARDWARE, 'bcr32')], [true, true]);
  const old = { version: 2, cv: [1], gt: [0, 1] };
  eq(validHardware(old) === old && hasController(old, 'bcr32'), true, 'kept from before: both');
  const ec4Only = { ...old, controllers: ['ec4'] };
  eq([hasController(ec4Only, 'ec4'), hasController(ec4Only, 'bcr32')], [true, false]);
  eq(validHardware({ ...old, controllers: [] }) != null, true, 'none is fine');
  eq(validHardware({ ...old, controllers: ['mpk'] }), null, 'an unknown one isn’t');
});

test('RELOAD that couldn’t keep the image counts as not stored, also when a T key’s STATE answered first', async () => {
  const p = fresh();
  put(p, 'lfo:4', 0, 0);
  const want = wanted(bcrOf(p), viewOf(p), sync(p));
  // answered directly: 7F 24 04
  let mock = new MockBcr32(othersImage(), { speed: 'fast' });
  let dev = new Device(mock.transport());
  mock.faults.reloadStatus = 4;
  let err = null;
  await writePlan(dev, plan(await readImage(dev), want, emptyHeld())).catch((e) => (err = e));
  eq([err?.cmd, err?.code], [0x24, 4], 'thrown, so nothing is held');
  dev.close();
  // a page change on the unit while it stores: its STATE answers RELOAD, the 7F 24 04 comes later
  mock = new MockBcr32(othersImage(), { speed: 'usb', timeScale: 1 });
  dev = new Device(mock.transport());
  const pl = plan(await readImage(dev), want, emptyHeld());
  for (const w of pl.writes) await dev.write(w.addr, w.data);
  mock.faults.reloadStatus = 4;
  err = null;
  const storing = storeImage(dev).catch((e) => (err = e));
  setTimeout(() => mock.setPage(1), 5);
  await storing;
  eq([err?.cmd, err?.code], [0x24, 4], 'the late error is seen');
  dev.close();
});

test('the BCR32 tab names what a control sends as Rotary Club 0.28 does, not in the EC4’s four letters', async () => {
  const { turnSummary, pushSummary, modeFull, modeShort } = await import('../js/rotary/names.js');
  const cell = (fn) => {
    const img = R.blankImage();
    fn(img);
    return R.readRecord(img, 0, 0);
  };
  const turn = (type, set = {}) => cell((img) => {
    R.setEncoder(img, 0, 0, 'type', type);
    R.setEncoder(img, 0, 0, 'channel', 15);
    for (const [k, v] of Object.entries(set)) R.setEncoder(img, 0, 0, k, v);
  });
  eq([turnSummary(turn(R.T.CCAB, { number: 20 })), turnSummary(turn(R.T.CCAH, { number: 1 })), turnSummary(turn(R.T.CCR1, { number: 20 })),
    turnSummary(turn(R.T.PRGC)), turnSummary(turn(R.T.PBND)), turnSummary(turn(R.T.AFTT)), turnSummary(turn(R.T.NOTE, { number: 60 })),
    turnSummary(turn(R.T.NRPN, { number: 20, numberHigh: 1 }))],
  ['CC 20 ch16', 'CC 14-bit 1 ch16', 'CC rel 20 ch16', 'Prog change ch16', 'Pitch bend ch16', 'Aftertouch ch16', 'Note C3 ch16', 'NRPN 1:20 ch16']);
  const push = (type, set = {}, c = 0) => cell((img) => {
    R.setPush(img, 0, c, 'type', type);
    for (const [k, v] of Object.entries(set)) R.setPush(img, 0, c, k, v);
  });
  eq([pushSummary(push(R.PT.CC, { number: 64, mode: 1 })), pushSummary(push(R.PT.GRP, { channel: 1 })), pushSummary(push(R.PT.ACC3)), pushSummary(push(R.PT.MIN))],
    ['CC 64 ch1 toggle', 'Page 2', 'max accel held', 'to lower']);
  eq(pushSummary(push(R.PT.MAX), true), 'off', 'a key takes no Max');
  eq([modeShort('Div8'), modeFull('Acc1'), modeFull('LSp6')], ['÷8', 'Acceleration low', 'Steps of 6']);
});

// ---- the checks page's B9 and B15 (rotary/checks.js), against a stand-in unit

const { parseTracks, trackLine, trackChanges } = await import('../js/rotary/tracks.js');
const { rcStored, rcTracks } = await import('../js/rotary/checks.js');
const P = await import('../vendor/eyeofprovidence/js/proto.js');

function tracksImage() {
  const img = new Uint8Array(272).fill(0xff);
  img.set([1, 16, 16, 0], 0);
  for (let t = 0; t < 16; t++) img.set([t, 0, 0, 1, 74, 1, 71, 0, 20, 0, 21, 0, 0, 2, 0xff, 0xff], 16 + 16 * t);
  return img;
}
// answers IDENTIFY and READ from `spaces`; `answers` play the person at the unit, in turn
function standIn(spaces, answers) {
  const listeners = new Set();
  const out = (bytes) => setTimeout(() => [...listeners].forEach((f) => f(bytes)), 0);
  const rig = {
    log: () => {}, wait: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))),
    ask: async (text, options) => (answers.length ? answers.shift()(rig) : options[0]),
    send(bytes) {
      const c = P.decodeCommand(Uint8Array.from(bytes));
      if (c.cmd === P.CMD.IDENTIFY) out(P.device.identify(1, 0, 29, [0x52, 0x43]));
      if (c.cmd === P.CMD.READ) out(P.device.readReply(c.space, c.addr, spaces[c.space].slice(c.addr, c.addr + c.len)));
    },
    listen: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    next: (filter, ms) => new Promise((resolve) => {
      const f = (m) => {
        const r = filter(m);
        if (r == null) return;
        clearTimeout(t);
        listeners.delete(f);
        resolve(r);
      };
      const t = setTimeout(() => (listeners.delete(f), resolve(null)), ms);
      listeners.add(f);
    }),
    emit: out,
  };
  return rig;
}

test('the tracks as Rotary Club 0.29 tells them: read, in words, and what changed', () => {
  const img = tracksImage();
  const first = parseTracks(img);
  eq([first.version, first.tracks.length, trackLine(first.tracks[0])], [1, 16, 'TR1 ch 1 M303 → USB · α CC 74 · β CC 71']);
  eq(first.tracks[0].m303, { slide: 0, accent: 2 });
  img.set([7, 3, 0, 1, 30, 4, 0, 0, 20, 0xfe, 128, 0], 16 + 16 * 2);
  const second = parseTracks(img);
  eq(trackLine(second.tracks[2]), 'TR3 ch 8 Plaits → USB · α CC 30 · β PB');
  eq(second.tracks[2].plaits, { chordCc: 20, chordTrim: -2, timbreCc: null, timbreTrim: 0 });
  eq(trackChanges(first, second), ['TR3 ch 3 M303 → USB · α CC 74 · β CC 71  →  ch 8 Plaits → USB · α CC 30 · β PB']);
});

test('B15: a track changed at the unit comes as 35 and reads back', async () => {
  const spaces = { 3: tracksImage() };
  const rig = standIn(spaces, [(r) => {
    spaces[3].set([7, 3], 16 + 16 * 2);
    spaces[3][3] = 1;
    r.emit(P.frame(0x35, [1]));
    return 'Changed it';
  }]);
  const res = await rcTracks(rig);
  eq(res.summary, '16 tracks read; the change came as 35 1, 1 track differ');
});

test('B9: only Night Shift’s bytes change with its Send, and they are kept through a power cycle', async () => {
  const p = fresh();
  put(p, 'lfo:4', 0, 0);
  const before = othersImage();
  const spaces = { 2: Uint8Array.from(before) };
  let held = emptyHeld();
  const send = (also) => () => {
    const pl = plan(spaces[2], wanted(bcrOf(p), viewOf(p), sync(p)), held);
    spaces[2] = pl.next;
    if (also) spaces[2][R.cellAddr(0, 4) + 8] = 0x41; // another app's knob renamed too: not Night Shift's
    held = pl.held;
    return 'Sent';
  };
  let res = await rcStored(standIn(spaces, [send(false), () => 'Done']), { heldNow: () => held });
  eq(res.summary, 'Only Night Shift’s bytes changed; 15/15 knobs; stored: all of it after the power cycle');
  spaces[2] = Uint8Array.from(before);
  held = emptyHeld();
  res = await rcStored(standIn(spaces, [send(true), () => 'Skip']), { heldNow: () => held });
  eq(res.summary.startsWith('Something else changed'), true, res.summary);
});
