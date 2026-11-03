// Tests for edit.js: field changes, their checks, undo and redo, and what reaches the bytes.

import { test, assert, eq, eqBytes } from './harness.js';
import { apply, History, setRange, setDirectLevel, setSmoothing, setGateLevels, addFixedVoltage, addKnob, addLfo, addClock, addEuclid,
  removePort, removeSource, addVoice, addTrigger, setTriggerNote, setTriggerEnvSet, wirePlayer, unwirePlayer, setPlayer, setPlayerRate,
  moveToChannel, setLaneNote, setName, deviceKey, changesTowards, addEuclidWithoutJack } from '../js/patch/edit.js';
import { projectToJson, projectFromJson } from '../js/patch/project.js';
import { sceneDifferences, fitProblems } from '../js/patch/scenes.js';
import { playerLine } from '../js/ui/look.js';
import { ccOf } from '../js/ui/connect.js';
import { freeClock, freeEuclid, freeMapping, freeCcs, suggestCc, suggestChannel, suggestBaseGate, voicePlan,
  suggestTriggerChannel, suggestNote, jacksInTheWay } from '../js/patch/alloc.js';
import { EXAMPLE_HARDWARE } from '../js/patch/hardware.js';
import { lfoSamples, euclidPattern, envelopePoints } from '../js/patch/shapes.js';
import { blankConfig, blankPreset } from '../js/patch/blank.js';
import { buildDump, bodyOf, parseDump, DUMPS } from '../js/fh2/sysex.js';
import { derive, playersOf } from '../js/patch/derive.js';
import { examplePatch } from '../js/patch/example.js';
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
  eq(freeEuclid(c, EXAMPLE_HARDWARE), 0);
  Object.assign(c.lfoReset[3], { type: 7, number: 0 }); // an LFO restarts on Euclid 1's pulses
  eq(freeEuclid(c, EXAMPLE_HARDWARE), 1);
  Object.assign(c.euclid[5], { output: 127, outputHigh: 1 }); // truly unused wins over parked
  eq(freeEuclid(c, EXAMPLE_HARDWARE), 5);
  eq(freeEuclid(c, { ...EXAMPLE_HARDWARE, gt: [0, 1, 6, 7] }), 5, 'with GT3 in the rack, only the unused one');
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
  const hw = EXAMPLE_HARDWARE;
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
  const hw = EXAMPLE_HARDWARE;
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

test('USB gamepad and keyboard entries are switched off, not pointed at None', () => {
  const p = patch();
  Object.assign(p.config.values.gamepad[1], { usage: 21, output: 1 });
  Object.assign(p.config.values.gamepad[2], { usage: 22, output: 2 });
  Object.assign(p.config.values.keyboard[0], { type: 1, key: 30, output: 0 });
  let v = derive(p.config.values, p.preset.values);
  const pad = v.sources.find((s) => s.id === 'gamepad');
  apply(p, removePort(values(p), pad, pad.ports[0]));
  eq(derive(p.config.values, p.preset.values).sources.find((s) => s.id === 'gamepad').ports.map((x) => x.name), ['Z'], 'one entry off');
  v = derive(p.config.values, p.preset.values);
  for (const s of v.sources) apply(p, removeSource(values(p), s));
  eq(derive(p.config.values, p.preset.values).sources, [], 'all off');
  eq([p.config.values.gamepad[1].output, p.config.values.keyboard[0].output], [1, 0], 'outputs untouched');
  assert(bodyOf(buildDump(p.config)).every((b) => b < 0x80), 'no byte outside 7 bits');
});

// ---- triggers

test('triggers: a kit on one channel, notes in a row, accents on two jacks', () => {
  const p = patch();
  const c = () => p.config.values;
  eq(suggestTriggerChannel(c()), 0, 'a quiet channel for a new kit');
  eq(suggestNote(c(), 9), 36, 'C2 to start');
  apply(p, addTrigger(values(p), { output: 64, channel: 9, note: 36 }));
  apply(p, addTrigger(values(p), { output: 65, channel: 9, note: suggestNote(c(), 9), type: 6 })); // accent gate
  apply(p, addTrigger(values(p), { output: 3, channel: 9, note: null, type: 9, envSet: 5 })); // any note → envelope on a CV jack
  eq(suggestTriggerChannel(c()), 9, 'the kit’s channel next time');
  let v = derive(c(), p.preset.values);
  eq(portsOf(v, 'triggers:9').map((x) => x.join('@')), ['C2 (36)@GT1·1', 'C♯2 (37)@GT1·2', 'C♯2 (37) accent@GT1·3', 'Any note@4']);
  eq(v.sources.find((s) => s.id === 'triggers:9').ports[3].envSet, 5);
  eq(jacksInTheWay(v, [65, 66], ['Trigger', 'Accent']).map((x) => x.message),
    ['Trigger would land on GT1·2, which Triggers · ch 10 already uses', 'Accent would land on GT1·3, which Triggers · ch 10 already uses']);
  eq(jacksInTheWay(v, [67]), []);

  // the accent trigger goes, with both its jacks
  const kit = v.sources.find((s) => s.id === 'triggers:9');
  apply(p, removePort(values(p), kit, kit.ports[2]));
  v = derive(c(), p.preset.values);
  eq(portsOf(v, 'triggers:9').map((x) => x[1]), ['GT1·1', '4']);
  apply(p, setTriggerNote(kit.ports[0].trigger, 38));
  apply(p, setTriggerEnvSet(kit.ports[3].trigger, 2));
  v = derive(c(), p.preset.values);
  eq(v.sources.find((s) => s.id === 'triggers:9').ports.map((x) => [x.name, x.envSet]), [['D2 (38)', 0], ['Any note', 2]]);
});

// ---- players

test('players: wire a sequencer to a voice, give them their own channel, clock it from a Euclid', () => {
  const p = patch();
  apply(p, addVoice(values(p), { output: 0, channel: 2 }));
  apply(p, addEuclid(values(p), EXAMPLE_HARDWARE, 64));
  let v = derive(p.config.values, p.preset.values);
  eq(v.players, [], 'nothing plays yet');
  eq(playersOf(p.config.values, p.preset.values, { all: true }).filter((x) => x.kind === 'sequencer').length, 4, 'four sequencers to pick from');

  apply(p, wirePlayer('noteSequencer:1', 2));
  v = derive(p.config.values, p.preset.values);
  eq(v.sources.find((s) => s.id === 'converter:0').players.map((x) => x.name), ['Note sequencer 2']);
  eq(v.players[0].plays, ['converter:0']);

  // their own channel: the voice and its sequencer move together
  apply(p, moveToChannel(v.sources.find((s) => s.id === 'converter:0'), 12));
  v = derive(p.config.values, p.preset.values);
  eq([p.config.values.converter[0].channel, v.players[0].channel], [12, 12]);
  eq(v.sources.find((s) => s.id === 'converter:0').players.map((x) => x.name), ['Note sequencer 2'], 'still wired');

  // also out to DIN for a Disting, clocked by Euclid 1 at rate 0
  apply(p, setPlayer('noteSequencer:1', { dests: { din: true }, clock: 1 }));
  apply(p, setPlayerRate('noteSequencer:1', 0));
  v = derive(p.config.values, p.preset.values);
  eq([v.players[0].din, v.players[0].clock, v.players[0].rate], [true, 1, 0]);
  eq(v.sources.find((s) => s.id === 'euclid:0').clocks, [{ id: 'noteSequencer:1', name: 'Note sequencer 2', now: true, select: { player: 'noteSequencer:1' } }]);

  apply(p, unwirePlayer('noteSequencer:1'));
  v = derive(p.config.values, p.preset.values);
  eq(v.sources.find((s) => s.id === 'converter:0').players, [], 'unwired');
  eq(v.players.map((x) => [x.name, x.internal, x.din]), [['Note sequencer 2', false, true]], 'still sends to DIN');

  let msg = '';
  try {
    setPlayer('drumSequencer', { clock: 1 });
  } catch (e) {
    msg = e.message;
  }
  eq(msg, 'drumSequencer has no clock source');
});

test('drum sequencer lanes play a trigger kit', () => {
  const p = patch();
  apply(p, addTrigger(values(p), { output: 64, channel: 9, note: 36 }));
  apply(p, addTrigger(values(p), { output: 65, channel: 9, note: 38 }));
  apply(p, wirePlayer('drumSequencer', 9));
  apply(p, setLaneNote(0, 36));
  apply(p, setLaneNote(1, 38));
  const v = derive(p.config.values, p.preset.values);
  eq(v.sources.find((s) => s.id === 'triggers:9').players.map((x) => x.name), ['Drum sequencer']);
  eq(v.players[0].notes.slice(0, 2), [36, 38]);
});

test('shift-register notes and an input in note mode can play a voice too', () => {
  const p = patch();
  apply(p, addVoice(values(p), { output: 0, channel: 4 }));
  Object.assign(p.config.values.srr[2], { cvOutput: 6 }); // a shift register in use, on jack 6
  Object.assign(p.config.values.cvMidi[0], { enable: 1, type: 2 }); // input X as notes
  apply(p, wirePlayer('srrNotes:2', 4));
  apply(p, wirePlayer('cvMidi:0', 4));
  const v = derive(p.config.values, p.preset.values);
  eq(v.sources.find((s) => s.id === 'converter:0').players.map((x) => x.name), ['Random 3 notes', 'Input X → Note']);
});

// ---- names and project files

test('names sit beside the dumps, show up in derive, and undo like any edit', () => {
  const p = { ...patch(), names: {} };
  apply(p, addVoice(values(p), { output: 0, channel: 0 }));
  apply(p, setPlayer('noteSequencer:0', { channel: 4, dests: { din: true } }));
  const h = new History();
  h.do(p, 'Rename', [...setName('converter:0', '  Bass  '), ...setName(deviceKey('din', 4), 'Disting mk4')]);
  let v = derive(p.config.values, p.preset.values, EXAMPLE_HARDWARE, p.names);
  eq([v.sources[0].name, v.sources[0].defaultName], ['Bass', 'Voice 1']);
  eq(v.players[0].devices, { din: 'Disting mk4' });
  eq(playerLine(v.players[0]), 'ch 5 → Disting mk4 (DIN)');
  h.undo(p);
  eq(p.names, {}, 'undo takes the names away again');
  apply(p, setName('converter:0', 'Lead'));
  apply(p, setName('converter:0', ''));
  eq(p.names, {}, 'an empty name clears it');
  let threw = false;
  try {
    apply(p, [{ dump: 'names', path: ['x'], value: 5 }]);
  } catch {
    threw = true;
  }
  assert(threw, 'a name is text');
});

test('a project file holds the config, every scene, the names and the rack, byte for byte', () => {
  const p = patch();
  apply(p, addVoice(values(p), { output: 0, channel: 0 }));
  const b = blankPreset('Chorus');
  const hw = { ...EXAMPLE_HARDWARE, cv: [1] };
  const text = projectToJson({ config: p.config, scenes: [p.preset, b], scene: 1, names: { 'converter:0': 'Bass' }, hardware: hw });
  const back = projectFromJson(text);
  eqBytes(buildDump(back.config), buildDump(p.config), 'config');
  eqBytes(buildDump(back.scenes[1]), buildDump(b), 'scene B');
  eq([back.scenes.length, back.scene, back.names, back.hardware], [2, 1, { 'converter:0': 'Bass' }, hw]);
  const withSlots = projectFromJson(projectToJson({ config: p.config, scenes: [p.preset, b], scene: 0, names: {}, hardware: hw,
    slots: { config: 3, scenes: [5, 31] }, scenesOnly: true }));
  eq([withSlots.slots, withSlots.scenesOnly], [{ config: 3, scenes: [5, null] }, true], 'slots kept, a slot past 30 dropped');
  eq(back.slots, { config: null, scenes: [null, null] }, 'no slots: none chosen');
  for (const bad of ['{', '{"x":1}', JSON.stringify({ nightshift: 99, config: '' })]) {
    let threw = false;
    try {
      projectFromJson(bad);
    } catch {
      threw = true;
    }
    assert(threw, `refuses ${bad}`);
  }
});

test('learning a knob reads control changes, not notes or mode messages', () => {
  eq(ccOf(Uint8Array.of(0xb1, 20, 64)), { channel: 1, cc: 20, value: 64 });
  eq(ccOf(Uint8Array.of(0x91, 60, 100)), null, 'a note');
  eq(ccOf(Uint8Array.of(0xb0, 123, 0)), null, 'all notes off');
  eq(ccOf(Uint8Array.of(0xb0, 7)), null, 'too short');
});

test('getting the FH-2’s patch is an edit: it matches the module byte for byte, and undoes', () => {
  const p = patch();
  const before = { config: buildDump(p.config), preset: buildDump(p.preset) };
  // the module holds something else
  const module = { config: blankConfig(), preset: blankPreset('On the FH-2') };
  apply({ config: module.config, preset: module.preset, names: {} }, [...addVoice({ config: module.config.values, preset: module.preset.values }, { output: 2, channel: 5 }), ...setSmoothing(7, 33)]);
  const h = new History();
  h.do(p, 'Get', [...changesTowards('config', p.config, module.config.values), ...changesTowards('preset', p.preset, module.preset.values)]);
  eqBytes(bodyOf(buildDump(p.config)), bodyOf(buildDump(module.config)), 'config now as on the FH-2');
  eqBytes(bodyOf(buildDump(p.preset)), bodyOf(buildDump(module.preset)), 'preset now as on the FH-2');
  h.undo(p);
  eqBytes(buildDump(p.config), before.config, 'undo brings the config back');
  eqBytes(buildDump(p.preset), before.preset, 'and the preset');
});

// ---- scenes

test('what a scene changes against another, in a few words', () => {
  const p = patch();
  const b = structuredClone(p.preset);
  const vb = b.values;
  Object.assign(vb.output[4], { lfoSine: 127, smoothing: 10 });
  vb.euclid[1].pulses = 5;
  Object.assign(vb.converter[0], { arpMode: 11, envAttack: 10 });
  vb.tempo = 1300;
  vb.name = 'Chorus';
  eq(sceneDifferences(p.preset.values, vb, EXAMPLE_HARDWARE), ['jack 5 (LFO, smoothing)', 'Voice 1 (arp, envelope)', 'tempo', 'Euclid 2'], 'in the preset’s own order');
  const c = structuredClone(p.preset.values);
  c.noteSequencerMute2 = 1;
  eq(sceneDifferences(p.preset.values, c, EXAMPLE_HARDWARE), ['sequence 3 (mute)']);
  eq(sceneDifferences(p.preset.values, structuredClone(p.preset.values), EXAMPLE_HARDWARE), []);
});

test('the fit check finds what a preset sets that this config doesn’t use', () => {
  const p = patch();
  apply(p, addEuclid(values(p), EXAMPLE_HARDWARE, 64, { pulses: 3 })); // Euclid 1 on a jack: fine
  const pv = p.preset.values;
  pv.euclid[4].pulses = 5; // Euclid 5: no jack
  pv.converter[2].arpMode = 11; // no Voice 3
  pv.noteSequencerActive1 = 1; // sequencer 2 sends nowhere
  Object.assign(pv.output[40], { lfoSine: 127 }); // an LFO on 5/1, not in the rack
  const v = derive(p.config.values, pv);
  eq(fitProblems(v, p.config.values, pv), [
    'Euclid 5 has a pattern, but no jack and nothing it clocks',
    'Voice 3’s arpeggiator is on, but there’s no Voice 3',
    'Note sequencer 2 is running, but sends nowhere',
    'An LFO on 5/1, which isn’t in your rack',
  ]);
  apply(p, setPlayer('noteSequencer:1', { dests: { din: true }, clock: 5 })); // now it sends, and Euclid 5 clocks it
  eq(fitProblems(derive(p.config.values, pv), p.config.values, pv).length, 2);
});

test('a Euclid without a jack clocks a shift register or restarts an LFO, and goes with its links', () => {
  const p = examplePatch();
  const vals = () => ({ config: p.config.values, preset: p.preset.values, names: {} });
  const euclid = (v, i) => v.sources.find((s) => s.id === `euclid:${i}`);
  // the usual case: Random 1 stepped by a pattern that needs no jack
  const e = addEuclidWithoutJack(vals(), EXAMPLE_HARDWARE, { pulses: 5, steps: 16 });
  apply(p, [...e.changes, { dump: 'config', path: ['srr', 0, 'clock'], value: e.index + 1 }, { dump: 'preset', path: ['srr', 0, 'rate'], value: 0 }]);
  let v = derive(p.config.values, p.preset.values);
  let s = euclid(v, e.index);
  eq([s.ports, s.jackless, s.parked, s.pattern.pulses], [[], true, false, 5]);
  eq(s.clocks, [{ id: 'srr:0', name: 'Random 1', now: true, select: { source: 'srr:0' } }], 'the random source, not a player');
  assert(freeEuclid(p.config.values, EXAMPLE_HARDWARE) !== e.index, 'a clock source is not free');
  // a pattern alone (it is in the preset) is not a Euclid of this config
  apply(p, [{ dump: 'config', path: ['srr', 0, 'clock'], value: 0 }]);
  eq(euclid(derive(p.config.values, p.preset.values), e.index), undefined);
  // restarting an LFO is a use too; parked outside the rack, it shows without a jack as well
  apply(p, [{ dump: 'config', path: ['lfoReset', 3, 'type'], value: 7 }, { dump: 'config', path: ['lfoReset', 3, 'number'], value: e.index },
    { dump: 'config', path: ['euclid', e.index, 'output'], value: 127 }, { dump: 'config', path: ['euclid', e.index, 'outputHigh'], value: 0 }]);
  v = derive(p.config.values, p.preset.values);
  s = euclid(v, e.index);
  eq([s.restarts, s.jackless, s.parked, s.ports.map((x) => x.jack)], [[3], true, false, ['GT3/16']]);
  // removing it takes its jacks and links: the LFO doesn't restart any more
  apply(p, [{ dump: 'config', path: ['srr', 0, 'clock'], value: e.index + 1 }]);
  apply(p, removeSource(vals(), euclid(derive(p.config.values, p.preset.values), e.index)));
  v = derive(p.config.values, p.preset.values);
  eq([euclid(v, e.index), p.config.values.srr[0].clock, p.config.values.lfoReset[3].type, p.config.values.euclid[e.index].outputHigh], [undefined, 0, 0, 1]);
});
