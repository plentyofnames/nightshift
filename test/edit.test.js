// Tests for edit.js: field changes, their checks, undo and redo, and what reaches the bytes.

import { test, assert, eq } from './harness.js';
import { apply, History, setRange, setDirectLevel, setSmoothing, setGateLevels, addFixedVoltage, addKnob, addLfo, addClock, addEuclid,
  removePort, removeSource } from '../js/patch/edit.js';
import { freeClock, freeEuclid, freeMapping, freeCcs, suggestCc } from '../js/patch/alloc.js';
import { DEFAULT_HARDWARE } from '../js/patch/hardware.js';
import { blankConfig, blankPreset } from '../js/patch/blank.js';
import { buildDump, bodyOf, parseDump, DUMPS } from '../js/fh2/sysex.js';
import { derive } from '../js/patch/derive.js';
import { levelToVolts, voltsToLevel } from '../js/patch/tables.js';

const patch = () => ({ config: blankConfig(), preset: blankPreset() });
const changedBytes = (before, after) => {
  const a = bodyOf(before), b = bodyOf(after);
  return [...a.keys()].filter((i) => a[i] !== b[i]);
};

test('an edit changes its fields and returns its undo', () => {
  const p = patch();
  const undo = apply(p, [...setRange(3, 1), ...setSmoothing(3, 40)]);
  eq(p.config.values.outputRange[3].value, 1);
  eq(p.preset.values.output[3].smoothing, 40);
  apply(p, undo);
  eq(p.config.values.outputRange[3].value, 0);
  eq(p.preset.values.output[3].smoothing, 0);
});

test('a bad change is refused and nothing changes', () => {
  const p = patch();
  for (const bad of [setSmoothing(0, 128), setDirectLevel(0, -1), setDirectLevel(0, 1.5), [{ dump: 'config', path: ['nope'], value: 1 }]]) {
    let threw = false;
    try {
      apply(p, [...setRange(0, 2), ...bad]);
    } catch {
      threw = true;
    }
    assert(threw, `should refuse ${JSON.stringify(bad)}`);
    eq(p.config.values.outputRange[0].value, 0, 'the good change before it is not applied either');
  }
  let threw = false;
  try {
    apply({ config: blankConfig(), preset: null }, setSmoothing(0, 1));
  } catch {
    threw = true;
  }
  assert(threw, 'a preset edit needs a preset');
});

test('undo and redo walk the history; a new edit drops what was undone', () => {
  const p = patch();
  const h = new History();
  h.do(p, 'Range', setRange(5, 3));
  h.do(p, 'Level', setDirectLevel(5, 9000));
  eq(h.do(p, 'Same level', setDirectLevel(5, 9000)), false, 'no step for an edit that changes nothing');
  eq(h.undo(p), 'Level');
  eq(p.preset.values.output[5].directLevel, 0);
  eq(h.redo(p), 'Level');
  eq(p.preset.values.output[5].directLevel, 9000);
  h.undo(p);
  h.undo(p);
  eq(p.config.values.outputRange[5].value, 0);
  assert(!h.canUndo && h.canRedo);
  h.do(p, 'Smoothing', setSmoothing(5, 10));
  assert(!h.canRedo, 'redo is gone after a new edit');
});

test('only the edited fields’ bytes change in the dumps', () => {
  const p = patch();
  const before = { config: buildDump(p.config), preset: buildDump(p.preset) };
  const changes = [...setRange(9, 4), ...setGateLevels(9, 100, 16000), ...setDirectLevel(9, 300)];
  apply(p, changes);
  for (const kind of ['config', 'preset']) {
    const allowed = new Set();
    for (const c of changes.filter((x) => x.dump === kind)) {
      const fd = DUMPS[p[kind].cmd].layout.fields.find((x) => x.path.join('.') === c.path.join('.'));
      for (let i = 0; i < fd.type.size; i++) allowed.add(fd.offset + i);
    }
    const changed = changedBytes(before[kind], buildDump(p[kind]));
    assert(changed.length > 0, `${kind}: something changed`);
    for (const i of changed) assert(allowed.has(i), `${kind}: byte ${i} changed outside the edited fields`);
  }
  eq(derive(p.config.values, p.preset.values).outputs[9].range, '0–8 V');
});

test('levels and volts', () => {
  eq(levelToVolts(0, 1), -5);
  eq(levelToVolts(16383, 0), 10);
  eq(voltsToLevel(0, 1), 8192);
  eq(voltsToLevel(5, 3), 16383);
  eq(voltsToLevel(12, 0), 16383, 'clamped');
  for (const r of [0, 1, 2, 3, 4]) eq(voltsToLevel(levelToVolts(1234, r), r), 1234, `range ${r}`);
});

// ---- alloc.js and adding/removing sources

const values = (p) => ({ config: p.config.values, preset: p.preset?.values ?? null });
const sourcesAt = (p, output) => derive(p.config.values, p.preset?.values ?? null).outputs[output].ports.map((x) => `${x.source} ${x.name}`);

test('free slots: a parked Euclid counts as free unless an LFO restarts from it', () => {
  const p = patch();
  const c = p.config.values;
  for (const e of c.euclid) Object.assign(e, { output: 127, outputHigh: 0 }); // the Init config: all on GT3/16
  eq(freeEuclid(c, DEFAULT_HARDWARE), 0);
  Object.assign(c.lfoReset[3], { type: 7, number: 0 }); // an LFO restarts on Euclid 1's pulses
  eq(freeEuclid(c, DEFAULT_HARDWARE), 1);
  Object.assign(c.euclid[5], { output: 127, outputHigh: 1 }); // truly unused wins over parked
  eq(freeEuclid(c, DEFAULT_HARDWARE), 5);
  eq(freeEuclid(c, { ...DEFAULT_HARDWARE, gt: [0, 1, 6, 7] }), 5, 'with GT3 in the rack, only the unused one');
  eq(freeClock(c), 0);
  eq(freeMapping(c), 0);
});

test('free CCs keep 14-bit pairs together', () => {
  const p = patch();
  eq(suggestCc(p.config.values, 1), 1, 'CC 0 is bank select');
  apply(p, addKnob(values(p), 0, 1, 1));
  const free = freeCcs(p.config.values, 1);
  assert(!free.some((f) => f.cc === 1 || f.cc === 33), 'CC 1 and its fine half 33 are taken');
  eq(suggestCc(p.config.values, 1), 2);
  apply(p, addKnob(values(p), 1, 1, 34)); // someone mapped 34 on its own
  assert(free.find((f) => f.cc === 2).fine, 'CC 2 was 14-bit before');
  eq(freeCcs(p.config.values, 1).find((f) => f.cc === 2).fine, false, 'CC 2 is 7-bit now');
  eq(suggestCc(p.config.values, 1), 3);
  eq(suggestCc(p.config.values, 0), 1, 'other channels are untouched');
});

test('each source kind can be added to a jack and removed again', () => {
  const p = patch();
  const hw = DEFAULT_HARDWARE;
  const add = (changes) => apply(p, changes);
  add(addFixedVoltage(0, 12000));
  add(addKnob(values(p), 1, 1, 20));
  add(addLfo(2, { shape: 'saw down', rate: { pulses: 96 }, depth: 0.5 }));
  add(addClock(values(p), 64, { base: 6 }));
  add(addClock(values(p), 65, { type: 2 }));
  add(addEuclid(values(p), hw, 66, { pulses: 5, steps: 8 }));
  const v = derive(p.config.values, p.preset.values);
  eq([0, 1, 2, 64, 65, 66].map((o) => sourcesAt(p, o)),
    [['levels Level 12000'], ['knobs:1 CC 20'], ['lfo:2 LFO'], ['clocks Clock 1/16'], ['clocks Run gate'], ['euclid:0 Pulses']]);
  eq(v.sources.find((s) => s.id === 'lfo:2').lfo.rate, '1 bar');
  eq(v.sources.find((s) => s.id === 'lfo:2').lfo.shapes.saw, -64, 'falling saw');
  eq(v.sources.find((s) => s.id === 'euclid:0').pattern.pulses, 5);
  eq(v.problems, []);

  // through the bytes and back: the FH-2 sees the same thing
  const again = derive(parseDump(buildDump(p.config)).values, parseDump(buildDump(p.preset)).values);
  eq(again.sources.map((s) => s.id), v.sources.map((s) => s.id));

  for (const s of v.sources) apply(p, removeSource(values(p), s));
  eq(derive(p.config.values, p.preset.values).sources.map((s) => s.id), [], 'all gone');
});

test('removing one jack of a shared source keeps the others', () => {
  const p = patch();
  apply(p, addClock(values(p), 64));
  apply(p, addClock(values(p), 65, { base: 12 }));
  const clocks = derive(p.config.values, p.preset.values).sources.find((s) => s.id === 'clocks');
  apply(p, removePort(values(p), clocks, clocks.ports[0]));
  eq(derive(p.config.values, p.preset.values).sources.find((s) => s.id === 'clocks').ports.map((x) => x.jack), ['GT1·2']);
});

test('adding fails cleanly when the FH-2 is full', () => {
  const p = patch();
  for (let i = 0; i < 32; i++) apply(p, addClock(values(p), 64));
  let msg = '';
  try {
    addClock(values(p), 65);
  } catch (e) {
    msg = e.message;
  }
  eq(msg, 'all the FH-2’s 32 clocks are in use');
});
