// Tests for the BCR32's tracks on the FH-2 (patch/bcrtracks.js, docs/build-plan.md "How a track
// shows up"): which tracks show, the row their outputs make, the edits that make it, and derive()
// showing a track's voice, CC → CV outputs and gate triggers as one source.

import { test, assert, eq } from './harness.js';
import { apply, setConverter } from '../js/patch/edit.js';
import { derive } from '../js/patch/derive.js';
import { blankConfig, blankPreset } from '../js/patch/blank.js';
import { reachesFh2, trackValues, firstValues, trackPlan, trackEdits, trackLayout, trackStart, claimsOf } from '../js/patch/bcrtracks.js';
import { mappingsOf } from '../js/patch/mappings.js';
import { projectToJson, projectFromJson } from '../js/patch/project.js';
import { pagesOf, ccsFor } from '../js/ec4/pages.js';
import { parseTracks, trackLine } from '../js/rotary/tracks.js';

const track = (index, machine, { channel = index, output = 'USB', a = { type: 'CC', cc: 74 }, b = { type: 'CC', cc: 71 } } = {}) => ({
  index, channel, machine, output, a, b, muted: false,
  plaits: machine === 'Plaits Chords' ? { chordCc: 20, chordTrim: 0, timbreCc: 21, timbreTrim: 0 } : null,
  m303: machine === 'M303' ? { slide: 0, accent: 2 } : null,
  knights: machine === 'Knights Sampler' ? { record: 0 } : null,
});
const blank = () => ({ config: blankConfig(), preset: blankPreset(), names: {} });
const vals = (p) => ({ config: p.config.values, preset: p.preset.values });
const view = (p, tracks) => derive(p.config.values, p.preset.values, undefined, p.names, tracks);
const rowOf = (plan) => plan.ports.map((x) => `${x.value}@${x.output}`).join(' ');
const sourceOf = (v, t) => v.sources.find((s) => s.track?.index === t.index);

test('only M303, Plaits Chords, Generic and Knights Sampler tracks on USB reach the FH-2 (your call: not the TD-3, not the MIDI gear)', () => {
  assert(reachesFh2(track(0, 'M303')));
  assert(reachesFh2(track(1, 'Plaits Chords')));
  assert(reachesFh2(track(2, 'Generic')));
  assert(reachesFh2(track(8, 'Knights Sampler')));
  assert(!reachesFh2(track(9, 'Knights Sampler', { output: 'DIN A' })), 'a Knights Sampler on DIN');
  assert(!reachesFh2(track(3, 'TD-3')), 'TD-3');
  assert(!reachesFh2(track(4, 'Generic', { output: 'DIN A' })), 'a TX81Z on DIN');
  assert(!reachesFh2(track(5, 'Off')), 'off (Rotary Club 0.30, a fresh unit’s tracks)');
  assert(!reachesFh2(track(6, 'TX81Z')), 'a TX81Z, even on USB (Rotary Club 0.32)');
  assert(!reachesFh2(track(7, 'Proteus 2000')), 'a Proteus 2000, even on USB');
});

test('TX81Z (5) and Proteus 2000 (6, Rotary Club 0.32) read by name, and neither shows nor counts on the FH-2', () => {
  const bytes = new Uint8Array(272);
  bytes.set([1, 16, 16, 1]);
  for (let t = 0; t < 16; t++) bytes.set([t, t % 2 ? 6 : 5, 0, 1, 2, 1, 21, 0, 20, 0, 21, 0, 0, 2], 16 + 16 * t);
  const tracks = parseTracks(bytes).tracks;
  eq([trackLine(tracks[0]), trackLine(tracks[1])], ['TR1 ch 1 TX81Z → USB · α CC 2 · β CC 21', 'TR2 ch 2 Proteus 2000 → USB · α CC 2 · β CC 21']);
  eq([tracks[0].plaits, tracks[0].m303], [null, null], 'bytes 8–13 are Plaits Chords’ and the M303’s only');
  const v = view(blank(), tracks);
  eq(v.channels.map((c) => c.tracks.length), Array(16).fill(0), 'no channel has a track');
});

test('a track whose machine is off (4, Rotary Club 0.30) reads as Off, and neither shows nor counts on the FH-2', () => {
  const bytes = new Uint8Array(272);
  bytes.set([1, 16, 16, 1]);
  for (let t = 0; t < 16; t++) bytes.set([t, 4, 0, 1, 74, 1, 71, 0, 20, 0, 21, 0, 0, 2], 16 + 16 * t);
  const tracks = parseTracks(bytes).tracks;
  eq(trackLine(tracks[1]), 'TR2 ch 2 Off → USB · α CC 74 · β CC 71');
  const v = view(blank(), tracks);
  eq(v.channels.map((c) => c.tracks.length), Array(16).fill(0), 'no channel has a track');
});

test('each machine offers its values, and starts with yours', () => {
  eq(trackValues(track(0, 'M303')).map((v) => v.value), ['Pitch', 'Gate', 'α', 'β', 'Accent', 'Slide']);
  eq([...firstValues(track(0, 'M303'))], ['Pitch', 'Gate', 'Accent', 'Slide']);
  eq([...firstValues(track(1, 'Plaits Chords'))], ['Pitch', 'Trigger', 'Chord', 'Inversion']);
  eq([...firstValues(track(2, 'Generic'))], ['Pitch', 'Gate']);
  const pc = trackValues(track(3, 'Generic', { a: { type: 'PC', cc: 0 }, b: { type: 'off', cc: 0 } }));
  eq(pc.filter((v) => !v.how).map((v) => `${v.value}: ${v.why}`), ['α: a program change: no CV', 'β: off on the BCR32']);
});

test('the row: the voice in the FH-2’s order from the start, then α, β, Chord, Inversion, then Accent and Slide', () => {
  const v = view(blank(), null);
  const m303 = track(0, 'M303');
  eq(rowOf(trackPlan(v, m303, { on: firstValues(m303), start: 0 })), 'Pitch@0 Gate@1 Accent@2 Slide@3');
  eq(rowOf(trackPlan(v, m303, { on: new Set(['Pitch', 'Gate', 'α', 'Accent', 'Slide']), start: 8, gatesFrom: 64 })), 'Pitch@8 Gate@64 α@9 Accent@65 Slide@66');
  const plaits = track(1, 'Plaits Chords');
  eq(rowOf(trackPlan(v, plaits, { on: firstValues(plaits), start: 2 })), 'Pitch@2 Trigger@3 Chord@4 Inversion@5');
  eq(rowOf(trackPlan(v, plaits, { on: new Set([...firstValues(plaits), 'Velocity']), start: 2 })), 'Pitch@2 Velocity@3 Trigger@4 Chord@5 Inversion@6', 'Velocity comes before Trigger, as the FH-2 has it');
  // α as aftertouch comes from the voice, after its own outputs
  const gen = track(2, 'Generic', { a: { type: 'AT', cc: 0 }, b: { type: 'CC', cc: 30 } });
  eq(rowOf(trackPlan(v, gen, { on: new Set(['Pitch', 'Gate', 'α', 'β']), start: 0 })), 'Pitch@0 Gate@1 α@2 β@3');
});

test('a row that doesn’t fit says where, and the first start where it does is offered', () => {
  const p = blank();
  const m303 = track(0, 'M303');
  apply(p, trackEdits(vals(p), view(p, [m303]), m303, null, { on: firstValues(m303), start: 0 }));
  const plaits = track(1, 'Plaits Chords');
  const v = view(p, [m303, plaits]);
  const plan = trackPlan(v, plaits, { on: firstValues(plaits), start: 2 });
  eq(plan.problems.map((x) => x.message), ['Pitch would land on 3, which TR1 · M303 already uses', 'Trigger would land on 4, which TR1 · M303 already uses']);
  eq(trackStart(v, plaits, { on: firstValues(plaits) }), 4);
});

test('a track added from a jack is one source: its voice, CC → CV outputs and gate triggers, named by the track', () => {
  const p = blank();
  const m303 = track(2, 'M303', { channel: 5 });
  apply(p, trackEdits(vals(p), view(p, [m303]), m303, null, { on: new Set(['Pitch', 'Gate', 'α', 'Accent', 'Slide']), start: 0 }));
  const v = view(p, [m303]);
  const s = sourceOf(v, m303);
  eq(s.name, 'TR3 · M303');
  eq(s.ports.map((x) => `${x.name}@${x.output}`), ['Pitch@0', 'Gate@1', 'α@2', 'Accent@3', 'Slide@4']);
  eq(s.raw.minNote, 3, 'the gate notes C-2 and D-2 aren’t pitches');
  assert(!v.sources.some((x) => x.kind === 'triggers' || x.kind === 'knobs'), 'no separate triggers or CC → CV source');
  eq(p.config.values.trigger.filter((t) => t.type).map((t) => [t.type, t.channel, t.note, t.output]), [[2, 5, 2, 3], [2, 5, 0, 4]], 'Accent and Slide as gates on its notes');
  eq(v.problems, []);
  // without the tracks, the same parts are a voice, a CC → CV knob and triggers again
  const plain = view(p, null);
  eq(plain.sources.map((x) => x.kind).sort(), ['knobs', 'triggers', 'voice']);
});

test('a Plaits Chords track’s Chord follows the chord CC it sends (Rotary Club 0.31: set on EDIT knob 22)', () => {
  const p = blank();
  const plaits = { ...track(0, 'Plaits Chords'), plaits: { chordCc: 25, chordTrim: 0, timbreCc: 21, timbreTrim: 0 } };
  apply(p, trackEdits(vals(p), view(p, [plaits]), plaits, null, { on: firstValues(plaits), start: 0 }));
  eq(mappingsOf(p.config.values).map((m) => m.cc), [25, 21]);
  const s = sourceOf(view(p, [plaits]), plaits);
  eq(s.ports.map((x) => `${x.name}@${x.output}`), ['Pitch@0', 'Trigger@1', 'Chord@2', 'Inversion@3']);
});

test('a Knights Sampler (7, Rotary Club 0.33) reads its record note from byte 12', () => {
  const bytes = new Uint8Array(272);
  bytes.set([1, 16, 16, 1]);
  for (let t = 0; t < 16; t++) bytes.set([t, 4, 0, 1, 74, 1, 71, 0, 20, 0, 21, 0, 0, 2], 16 + 16 * t);
  bytes.set([3, 7, 0, 1, 16, 1, 17, 0, 0, 0, 0, 0, 0, 0xff], 16 + 16 * 3);
  const t = parseTracks(bytes).tracks[3];
  eq(trackLine(t), 'TR4 ch 4 Knights Sampler → USB · α CC 16 · β CC 17');
  eq([t.knights, t.m303, t.plaits], [{ record: 0 }, null, null]);
});

test('a Knights Sampler is a voice with its velocity gate, Start and Decay as CC → CV, and Record as a gate on its note', () => {
  const ks = track(3, 'Knights Sampler', { a: { type: 'CC', cc: 16 }, b: { type: 'CC', cc: 17 } });
  eq(trackValues(ks).map((v) => v.value), ['Pitch', 'Velocity gate', 'α', 'β', 'Record']);
  eq([...firstValues(ks)], ['Pitch', 'Velocity gate', 'α', 'Record']);
  const v0 = view(blank(), null);
  eq(rowOf(trackPlan(v0, ks, { on: firstValues(ks), start: 0, gatesFrom: 64 })), 'Pitch@0 Velocity gate@1 α@2 Record@64', 'Record goes to the gate expander, the velocity gate stays a level');
  const p = blank();
  apply(p, trackEdits(vals(p), view(p, [ks]), ks, null, { on: new Set([...firstValues(ks), 'β']), start: 0 }));
  const cv = p.config.values.converter.find((c) => c.enable);
  eq([cv.channel, cv.cvOut, cv.gateOut, cv.velGateOut, cv.minNote], [3, 1, 0, 1, 1], 'the record note C-2 isn’t a pitch');
  eq(mappingsOf(p.config.values).map((m) => [m.cc, m.target.index]), [[16, 2], [17, 3]]);
  eq(p.config.values.trigger.filter((x) => x.type).map((x) => [x.type, x.channel, x.note, x.output]), [[2, 3, 0, 4]], 'Record as a gate on note 0');
  const v = view(p, [ks]);
  eq(sourceOf(v, ks).ports.map((x) => `${x.name}@${x.output}`), ['Pitch@0', 'Velocity gate@1', 'α@2', 'β@3', 'Record@4']);
  eq(v.problems, []);
});

test('switching outputs on and off lays the row out again; nothing on takes the track off the FH-2', () => {
  const p = blank();
  const plaits = track(0, 'Plaits Chords');
  apply(p, trackEdits(vals(p), view(p, [plaits]), plaits, null, { on: firstValues(plaits), start: 0 }));
  let s = sourceOf(view(p, [plaits]), plaits);
  eq(s.ports.map((x) => `${x.name}@${x.output}`), ['Pitch@0', 'Trigger@1', 'Chord@2', 'Inversion@3']);
  eq([2, 3].map((o) => p.config.values.outputRange[o].value), [3, 3], 'Chord and Inversion at 0–5 V');
  // Velocity on: everything after it moves up one
  let v = view(p, [plaits]);
  apply(p, trackEdits(vals(p), v, plaits, s, { ...trackLayout(s), on: new Set([...trackLayout(s).on, 'Velocity']) }));
  s = sourceOf(view(p, [plaits]), plaits);
  eq(s.ports.map((x) => `${x.name}@${x.output}`), ['Pitch@0', 'Velocity@1', 'Trigger@2', 'Chord@3', 'Inversion@4']);
  eq(mappingsOf(p.config.values).length, 2, 'the same two mappings, moved');
  // Chord off: its mapping goes
  v = view(p, [plaits]);
  apply(p, trackEdits(vals(p), v, plaits, s, { ...trackLayout(s), on: new Set([...trackLayout(s).on].filter((x) => x !== 'Chord')) }));
  s = sourceOf(view(p, [plaits]), plaits);
  eq(s.ports.map((x) => `${x.name}@${x.output}`), ['Pitch@0', 'Velocity@1', 'Trigger@2', 'Inversion@3']);
  eq(mappingsOf(p.config.values).map((m) => m.cc), [21]);
  // nothing on
  v = view(p, [plaits]);
  apply(p, trackEdits(vals(p), v, plaits, s, { ...trackLayout(s), on: new Set() }));
  v = view(p, [plaits]);
  assert(!sourceOf(v, plaits), 'gone');
  eq(mappingsOf(p.config.values).length, 0);
  eq(p.config.values.converter.filter((c) => c.enable).length, 0);
});

test('only the first mono voice on the track’s channel is the track’s; a poly voice there stays a voice', () => {
  const p = blank();
  apply(p, setConverter(0, { enable: 1, channel: 4, type: 1, voices: 2, baseOutput: 0, cvOut: 1, gateOut: 0, stride: 1 }));
  const gen = track(4, 'Generic');
  eq(claimsOf(p.config.values, mappingsOf(p.config.values), [gen]).voices.size, 0);
  apply(p, trackEdits(vals(p), view(p, [gen]), gen, null, { on: firstValues(gen), start: 4 }));
  const v = view(p, [gen]);
  eq(v.sources.filter((s) => s.kind === 'voice').map((s) => s.track ? s.name : 'voice'), ['voice', 'TR5 · Generic']);
});

test('a track’s CC landing on another mapping on its channel is a problem; new knobs never get its CCs there', () => {
  const p = blank();
  const m303 = track(1, 'M303'); // ch 2, Night Shift's pages channel, α CC 74, β CC 71
  // a setting on CC 74, ch 2
  apply(p, [{ dump: 'config', path: ['mapping', 0, 'status'], value: 0x31 }, { dump: 'config', path: ['mapping', 0, 'cc'], value: 74 },
    { dump: 'config', path: ['mapping', 0, 'target'], value: 10 }, { dump: 'config', path: ['mapping', 0, 'index'], value: 0 }]);
  const v = view(p, [m303]);
  eq(v.problems.filter((x) => x.kind === 'track-cc').map((x) => x.message), ['TR2 · M303 sends α as CC 74 on ch 2: it also moves euclid 1 pulses']);
  eq(v.channels[1].tracks.map((t) => [t.name, t.ccs]), [['TR2 · M303', [74, 71]]]);
  // the pages hand out CCs from 64 up on ch 2: 65, 67… but not the track's 71 (74 is taken anyway)
  const model = pagesOf(v, {});
  eq(model.channel, 1, 'the pages channel stays');
  const keys = Array.from({ length: 12 }, (_, i) => `euclid:${i + 1}:steps`);
  const { changes } = ccsFor(p.config.values, v, {}, model, keys);
  const ccs = changes.filter((c) => c.path[2] === 'cc').map((c) => c.value);
  eq(ccs.length, 12);
  assert(!ccs.includes(71) && !ccs.includes(74), `CCs ${ccs}`);
});

test('a project keeps the BCR32’s tracks, so they show without the unit', () => {
  const bytes = new Uint8Array(272);
  bytes.set([1, 16, 16, 7]);
  for (let t = 0; t < 16; t++) bytes.set([t, t === 2 ? 3 : 0, 0, 1, 74, 1, 71, 0, 20, 0, 21, 0, 0, 2], 16 + 16 * t);
  const p = blank();
  const j = projectToJson({ config: p.config, scenes: [p.preset], scene: 0, names: {}, hardware: null, tracks: bytes });
  const back = projectFromJson(j);
  eq(back.tracks.counter, 7);
  eq(back.tracks.tracks[2].machine, 'Plaits Chords');
  eq([...back.tracks.bytes], [...bytes]);
  eq(projectFromJson(projectToJson({ config: p.config, scenes: [p.preset], scene: 0, names: {}, hardware: null })).tracks, null);
});
