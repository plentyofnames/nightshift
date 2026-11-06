// Tests for the note and drum sequencers' steps (js/patch/steps.js), on your own patch (test/local)
// and the example.

import { test, assert, eq } from './harness.js';
import { examplePatch } from '../js/patch/example.js';
import { apply } from '../js/patch/edit.js';
import { parseDump } from '../js/fh2/sysex.js';
import { noteSequence, setStep, setSequence, gatesOf, drumSequence, setDrumStep, setLane, nextGate, nextDrum, stepPitch, stepNote, degreeName,
  bankBytes, bankMessage, noteSlot, drumSlot, loadNoteSlot, loadDrumSlot, slotSummary } from '../js/patch/steps.js';
import { bankTestSequence, bankTestDrums } from '../js/fh2/checks.js';
import { NOTE_SLOT_SAVED, DRUM_SLOT_SAVED, bankWith } from './fixtures-banks.js';

const local = () => parseDump(Deno.readFileSync(new URL('./local/preset.syx', import.meta.url))).values;

test('your note sequences as the editor reads them', () => {
  const q = noteSequence(local(), 0);
  eq([q.start, q.end, q.rate, q.gateLength, q.reset, q.rootNote, q.active], [0, 7, 24, 48, 16, 0, true]);
  eq(q.steps[0], { degree: 5, octave: 1, length: 1, ratchet: false, reset: false, skip: false, mute: 0, gates: [1, 0, 0, 0, 0, 0, 0, 0] });
  eq(noteSequence(local(), 1).steps[0].gates[0], 2, 'sequence 2 starts on a tie');
  eq(stepPitch(q.steps[0]), 'A1', 'degree 5 (A) at octave 1: note 33');
  eq([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((d) => stepNote({ degree: d, octave: 3 })), [48, 50, 52, 53, 55, 57, 59, 60, 49, 51, 53, 54, 56, 58, 60, 61], 'as your FH-2 played them (check S1)');
  eq([degreeName(0), degreeName(7), degreeName(8), degreeName(10), degreeName(15), degreeName(0, 2)], ['C', 'C↑', 'C♯', 'F', 'C♯↑', 'D']);
});

test('editing a note step: gates over both fields, length, flags; nothing else moves', () => {
  const { config, preset } = examplePatch();
  const p = { config, preset, names: {} };
  const before = structuredClone(p.preset.values.noteSequencer[2].step[5]);
  apply(p, setStep(2, 5, { degree: 9, octave: 4, length: 4, ratchet: true, skip: true, mute: 3, gates: [1, 2, 0, 1, 0, 0, 0, 2] }));
  const s = noteSequence(p.preset.values, 2).steps[5];
  eq(s, { degree: 9, octave: 4, length: 4, ratchet: true, reset: false, skip: true, mute: 3, gates: [1, 2, 0, 1, 0, 0, 0, 2] });
  eq(gatesOf(p.preset.values.noteSequencer[2].step[5]), [1, 2, 0, 1, 0, 0, 0, 2]);
  eq(p.preset.values.noteSequencer[2].step[6], structuredClone(p.preset.values.noteSequencer[2].step[6]), 'its neighbour untouched');
  assert(JSON.stringify(before) !== JSON.stringify(p.preset.values.noteSequencer[2].step[5]));
  apply(p, setSequence(2, { start: 2, end: 13, direction: 2 }));
  const q = noteSequence(p.preset.values, 2);
  eq([q.start, q.end, q.direction], [2, 13, 2]);
  eq([nextGate(0), nextGate(1), nextGate(2)], [1, 2, 0], 'off, on, tie, off');
  eq(setStep(0, 0, { length: 12 })[0].value, 7, 'length 8 at most');
});

test('drum steps: hits and accents in their 4-bit halves', () => {
  const v = local();
  const d = drumSequence(v, null);
  // lane 1: hitsLow [3, 9, …] (steps 1, 2 · 9, 12), hitsHigh [1, 1, …] (5 · 13), accents on 1, 9 and 13
  eq(d.lanes[0].steps.slice(0, 16).join(''), '2100100020012000');
  eq([d.lanes[0].start, d.lanes[0].end, d.lanes[0].rate, d.lanes[0].reset], [0, 15, 6, 4]);
  const { config, preset } = examplePatch();
  const p = { config, preset, names: {} };
  apply(p, setDrumStep(p.preset.values, 3, 6, 2)); // lane 4, step 7: accent (high half)
  apply(p, setDrumStep(p.preset.values, 3, 17, 1)); // step 18: on (low half of the third byte)
  let lane = drumSequence(p.preset.values, p.config.values).lanes[3];
  eq([lane.steps[6], lane.steps[17], lane.note], [2, 1, p.config.values.drumSequencer[0].laneNote[3].value]);
  apply(p, setDrumStep(p.preset.values, 3, 6, 0));
  lane = drumSequence(p.preset.values, p.config.values).lanes[3];
  eq([lane.steps[6], lane.steps[17]], [0, 1], 'off again, its neighbour kept');
  apply(p, setLane(3, { end: 11, mute: true }));
  lane = drumSequence(p.preset.values, p.config.values).lanes[3];
  eq([lane.end, lane.mute], [11, true]);
  eq([nextDrum(0), nextDrum(1), nextDrum(2)], [1, 2, 0], 'off, on, accent, off');
});

test('a note bank slot as your FH-2 saved the test sequence: every field read back, and loaded into a sequencer', () => {
  const msg = bankWith(NOTE_SLOT_SAVED, 'notes');
  const bytes = bankBytes(msg);
  eq([...bankMessage(bytes, 'notes')], [...msg], 'bytes and message, both ways');
  const slot = noteSlot(bytes, 0);
  const { config, preset } = examplePatch();
  const want = noteSequence(bankTestSequence(preset.values, 0), 0);
  const fields = (q) => ({ steps: q.steps, start: q.start, end: q.end, rate: q.rate, gateLength: q.gateLength, reset: q.reset, rootNote: q.rootNote, direction: q.direction, permutation: q.permutation });
  eq(fields(slot), fields(want), 'all 32 steps and the settings');
  eq(slotSummary(slot), `steps 3–30 · ${want.steps.slice(2, 30).reduce((n, s) => n + s.gates.slice(0, s.length).filter(Boolean).length, 0)} notes`);
  eq(slotSummary(noteSlot(bytes, 1)), null, 'the next slot is empty here');
  const p = { config, preset, names: {} };
  apply(p, loadNoteSlot(slot, 2));
  eq(fields(noteSequence(p.preset.values, 2)), fields(want), 'loaded into note sequencer 3');
});

test('a drum bank slot as your FH-2 saved the test pattern, and loaded into the drum sequencer', () => {
  const bytes = bankBytes(bankWith(DRUM_SLOT_SAVED, 'drums'));
  const slot = drumSlot(bytes, 0);
  const { config, preset } = examplePatch();
  const want = drumSequence(bankTestDrums(preset.values), config.values);
  const lanes = (d) => d.lanes.map(({ steps, start, end, rate, reset, mute }) => ({ steps, start, end, rate, reset, mute }));
  eq(lanes(slot), lanes(want));
  eq(slot.reset, 9);
  const p = { config, preset, names: {} };
  apply(p, loadDrumSlot(slot));
  const d = drumSequence(p.preset.values, p.config.values);
  eq([lanes(d), d.reset], [lanes(want), 9]);
});
