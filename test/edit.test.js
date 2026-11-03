// Tests for edit.js: field changes, their checks, undo and redo, and what reaches the bytes.

import { test, assert, eq } from './harness.js';
import { apply, History, setRange, setDirectLevel, setSmoothing, setGateLevels, addFixedVoltage, addKnob, addLfo, addClock, addEuclid,
  removePort, removeSource, addVoice } from '../js/patch/edit.js';
import { freeClock, freeEuclid, freeMapping, freeCcs, suggestCc, suggestChannel, suggestBaseGate, voicePlan } from '../js/patch/alloc.js';
import { DEFAULT_HARDWARE } from '../js/patch/hardware.js';
import { lfoSamples, euclidPattern, envelopePoints } from '../js/patch/shapes.js';
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
const portsOf = (view, id) => view.sources.find((s) => s.id === id).ports.map((x) => [x.name, x.jack]);
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

// ---- shapes.js

test('Euclid patterns spread pulses evenly and rotate', () => {
  const show = (a) => a.map((x) => (x ? 'x' : '.')).join('');
  eq(show(euclidPattern(3, 8)), 'x..x..x.');
  eq(show(euclidPattern(3, 8, 1)), '..x..x.x');
  eq(show(euclidPattern(5, 8)), 'x.x.xx.x', 'E(5,8), starting on a pulse');
  eq(show(euclidPattern(0, 4)), '....');
  eq(show(euclidPattern(9, 4)), 'xxxx', 'more pulses than steps');
});

test('LFO drawings follow the shape mix and depth', () => {
  const raw = { lfoLevel: 16383, lfoSine: 127, lfoSquare: 0, lfoTriangle: 0, lfoPulseWidth: 64, lfoSaw: 64, lfoRandom: 0, lfoNoise: 0, lfoPhase: 0 };
  const sine = lfoSamples(raw, 240, 1);
  assert(Math.abs(Math.max(...sine) - 1) < 0.01 && Math.abs(Math.min(...sine) + 1) < 0.01, 'full-depth sine spans ±1');
  eq(sine[60] > 0.99, true, 'a quarter in, at the top');
  const half = lfoSamples({ ...raw, lfoLevel: 8192 }, 240, 1);
  assert(Math.abs(Math.max(...half) - 0.5) < 0.01, 'half depth');
  const square = lfoSamples({ ...raw, lfoSine: 0, lfoSquare: 127, lfoPulseWidth: 32 }, 128, 1);
  assert(Math.abs(square.filter((x) => x > 0).length - 32) <= 1, 'pulse width 32 of 127 is a quarter');
  const falling = lfoSamples({ ...raw, lfoSine: 0, lfoSaw: 0 }, 100, 1);
  assert(falling[0] > 0.9 && falling[99] < -0.9, 'a saw below 64 falls');
  eq(lfoSamples({ ...raw, lfoSine: 0 }, 10).every((x) => x === 0), true, 'no shape, no wave');
});

// ---- voices

test('a voice can be added, laid out and checked before it lands', () => {
  const p = patch();
  const hw = DEFAULT_HARDWARE;
  apply(p, addClock(values(p), 65)); // something on GT1·2
  let v = derive(p.config.values, p.preset.values);
  eq(suggestChannel(p.config.values), 0);
  eq(suggestBaseGate(v, 3), 66, 'GT1·1 is free but GT1·2 is not, so three in a row start at GT1·3');

  // a three-voice poly with gates on the expander, previewed first
  const cv = { type: 1, voices: 3, baseOutput: 4, baseGate: 64, stride: 0, cvOut: 1, gateOut: 1, velocityOut: 1 };
  const plan = voicePlan(v, cv);
  eq(plan.ports.map((x) => `${x.name}@${x.jack}`), ['Pitch 1@5', 'Velocity 1@6', 'Pitch 2@7', 'Velocity 2@8', 'Pitch 3@CV1·1', 'Velocity 3@CV1·2',
    'Gate 1@GT1·1', 'Gate 2@GT1·2', 'Gate 3@GT1·3']);
  eq(plan.problems.map((x) => x.message), ['Gate 2 would land on GT1·2, which Clock & transport already uses']);

  apply(p, addVoice(values(p), { output: 4, channel: 0, type: 1, voices: 3, outs: { cvOut: 1, gateOut: 1 }, baseGate: 66 }));
  v = derive(p.config.values, p.preset.values);
  eq(portsOf(v, 'converter:0').map((x) => x.join('@')), ['Pitch 1@5', 'Pitch 2@6', 'Pitch 3@7', 'Gate 1@GT1·3', 'Gate 2@GT1·4', 'Gate 3@GT1·5']);
  eq(v.problems, []);
  eq(suggestChannel(p.config.values), 1, 'channel 1 is taken now');
  eq(voicePlan(v, p.config.values.converter[0], 0).problems, [], 'a voice doesn’t collide with itself');
});

test('a voice’s outputs come off one switch at a time, and the voice can go', () => {
  const p = patch();
  apply(p, addVoice(values(p), { output: 0, channel: 2, outs: { cvOut: 1, gateOut: 1, velocityOut: 2, bendOut: 2 } }));
  let v = derive(p.config.values, p.preset.values);
  const s = v.sources.find((x) => x.id === 'converter:0');
  eq(s.ports.map((x) => x.name), ['Pitch', 'Gate', 'Velocity (inverted)', 'Bend up', 'Bend down']);
  apply(p, removePort(values(p), s, s.ports[2])); // inverted velocity off
  apply(p, removePort(values(p), s, s.ports[4])); // bend down: both bend outputs go
  v = derive(p.config.values, p.preset.values);
  eq(portsOf(v, 'converter:0').map((x) => x.join('@')), ['Pitch@1', 'Gate@2']);
  apply(p, removeSource(values(p), v.sources.find((x) => x.id === 'converter:0')));
  eq(derive(p.config.values, p.preset.values).sources, []);
  eq(p.config.values.converter[0].cvOut, 1, 'its settings stay for next time');
});

test('a voice past the last CV jack, or outside the rack, is caught', () => {
  const p = patch();
  const v = derive(p.config.values, p.preset.values);
  const far = voicePlan(v, { type: 1, voices: 4, baseOutput: 62, baseGate: 0, stride: 0, cvOut: 1, gateOut: 1 });
  assert(far.problems.some((x) => x.message === 'Pitch 2 would land past the last CV output'), JSON.stringify(far.problems));
  const away = voicePlan(v, { type: 0, voices: 1, baseOutput: 40, baseGate: 0, stride: 0, cvOut: 1 });
  eq(away.problems.map((x) => x.message), ['Pitch would land on 5/1, which isn’t in your rack']);
});

test('envelope drawings rise, fall to sustain, and release', () => {
  const env = { attack: 0, decay: 64, sustain: 64, release: 127, depth: 127, attackShape: 64, decayShape: 64, releaseShape: 64 };
  const pts = envelopePoints(env, 10);
  eq(pts[0], [0, 0]);
  eq(Math.max(...pts.map(([, y]) => y)), 1, 'peaks at full depth');
  eq(pts.at(-1)[1], 0, 'ends at zero');
  assert(Math.abs(pts[20][1] - 64 / 127) < 1e-9, 'decays to the sustain level');
  assert(pts.at(-1)[0] === 1, 'fills the width');
  const inverted = envelopePoints({ ...env, depth: 1 }, 10);
  eq(Math.min(...inverted.map(([, y]) => y)), -1, 'depth below 64 turns it upside down');
});
