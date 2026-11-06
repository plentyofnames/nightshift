// The note and drum sequencers' steps, as the preset holds them (fh2/preset.js, checked against
// Expert Sleepers' preset tool), and the changes that edit them. Each scene has its own: the steps
// are preset values, like everything else per scene.
//
// A note step: a degree (0–15) and an octave (0–7) for its pitch; a column of 1–8 sub-steps, each
// off, on or a tie (a note held into the next), which last a step each, or with ratchet on share
// one step; reset (the sequence starts again there), skip, and mute (0 never, 1–7 more and more
// likely; the manual has 6 levels). A sequence: its first and last step (0-based), rate (24 ppqn
// pulses, 0: its clock source), gate length (0: a trigger), reset (quarter notes, 0: never), root,
// direction and permutation.
// A drum lane: 32 steps, each off, on or accented, with its own first and last step, rate, reset
// and mute; one reset for all eight.

import { noteName, NOTE_NAMES } from './tables.js';

export const GATES = ['off', 'on', 'tie'];
export const DIRECTIONS = ['Forwards', 'Reverse', 'Alt', 'Alt2', 'Random', 'Random2', 'Random3']; // the manual's order
export const PERMUTATIONS = ['Straight', 'Odd/Even', 'Halves', 'Inwards'];
export const SEQUENCERS = 4;
export const STEPS = 32;
export const LANES = 8;

// The semitones of each degree above degree 0, as your FH-2 plays them (check S1, 2026-11-06):
// degrees 0–7 are a major scale up from the root (C D E F G A B C), 8–15 a semitone above each of
// them, the Launchpad's in-between pads (C♯ D♯ F F♯ G♯ A♯ C C♯). A step plays 12 × (octave + 1) +
// root + that: degree 0 at octave 3 with root 0 is note 48, C3. (The root was 0 in the check: that
// it adds semitones is assumed.)
export const DEGREE_SEMITONES = [0, 2, 4, 5, 7, 9, 11, 12, 1, 3, 5, 6, 8, 10, 12, 13];
export const stepNote = (s, rootNote = 0) => 12 * (s.octave + 1) + rootNote + DEGREE_SEMITONES[s.degree];
// A degree's note name within the octave, "↑" when it lands in the next one (degrees 7, 14, 15).
export const degreeName = (d, rootNote = 0) => `${NOTE_NAMES[(rootNote + DEGREE_SEMITONES[d]) % 12]}${rootNote % 12 + DEGREE_SEMITONES[d] >= 12 ? '↑' : ''}`;

const preset = (path, value) => ({ dump: 'preset', path, value });

// ---- note sequencers

// The 8 sub-step gates of a step: 2 bits each, 7 in gatesLow and the 8th in gatesHigh.
export const gatesOf = (s) => Array.from({ length: 8 }, (_, k) => (k < 7 ? (s.gatesLow >> (2 * k)) & 3 : s.gatesHigh & 3));
const gatesFields = (gates) => ({
  gatesLow: gates.slice(0, 7).reduce((v, g, k) => v | ((g & 3) << (2 * k)), 0),
  gatesHigh: gates[7] & 3,
});

// Note sequencer `j` (0–3) of the preset's values, as the editor shows it.
export function noteSequence(values, j) {
  const q = values.noteSequencer[j];
  return {
    index: j,
    steps: q.step.map((s) => ({ degree: s.degree, octave: s.octave, length: s.length + 1, ratchet: !!s.ratchet, reset: !!s.reset,
      skip: !!s.skip, mute: s.mute, gates: gatesOf(s) })),
    start: q.start, end: q.end, rate: q.rate, gateLength: q.gateLength, reset: q.reset, rootNote: q.rootNote,
    direction: q.direction, permutation: q.permutation,
    active: !!values[`noteSequencerActive${j}`], muted: !!values[`noteSequencerMute${j}`],
  };
}

// Changes to step `k` of sequencer `j`: any of degree, octave, length (1–8), ratchet, reset, skip
// (booleans), mute (0–7), gates (8 values of GATES' indexes).
export function setStep(j, k, obj) {
  const path = (f) => ['noteSequencer', j, 'step', k, f];
  const out = [];
  for (const [key, v] of Object.entries(obj)) {
    if (key === 'gates') for (const [f, x] of Object.entries(gatesFields(v))) out.push(preset(path(f), x));
    else if (key === 'length') out.push(preset(path('length'), Math.max(1, Math.min(8, v)) - 1));
    else if (['ratchet', 'reset', 'skip'].includes(key)) out.push(preset(path(key), v ? 1 : 0));
    else if (['degree', 'octave', 'mute'].includes(key)) out.push(preset(path(key), v));
    else throw new Error(`no step field ${key}`);
  }
  return out;
}

// A sequence's settings: start and end (0–31, start ≤ end), rate, gateLength, reset, rootNote,
// direction, permutation.
export const setSequence = (j, obj) => Object.entries(obj).map(([key, v]) => preset(['noteSequencer', j, key], v));
export const setSequenceOn = (j, { active, muted }) => [
  ...(active != null ? [preset([`noteSequencerActive${j}`], active ? 1 : 0)] : []),
  ...(muted != null ? [preset([`noteSequencerMute${j}`], muted ? 1 : 0)] : []),
];

// The next gate of a sub-step when clicked: off → on → tie → off.
export const nextGate = (g) => (g + 1) % 3;

// A step's note in two short lines for its column: the name, and the octave number.
export function pitchLines(s, rootNote = 0) {
  const n = noteName(stepNote(s, rootNote));
  return [n.replace(/-?\d+$/, ''), n.match(/-?\d+$/)[0]];
}

// A step's note by name, "E3".
export const stepPitch = (s, rootNote = 0) => noteName(stepNote(s, rootNote));

// ---- the drum sequencer: hits and accents in 4-bit fields, steps m·8 + 0…3 low, + 4…7 high

const bitOf = (lane, which, k) => {
  const m = k >> 3;
  const n = k & 7;
  return n < 4 ? (lane[`${which}Low`][m].value >> n) & 1 : (lane[`${which}High`][m].value >> (n - 4)) & 1;
};

// The drum sequencer of the preset's values: { lanes: [{ steps (0 off, 1 on, 2 accent) ×32, start,
// end, rate, reset, mute, note }], reset, active, muted }. `config` gives each lane's note.
export function drumSequence(values, config) {
  const d = values.drumSequencer[0];
  return {
    lanes: d.lane.map((l, i) => ({
      index: i,
      steps: Array.from({ length: STEPS }, (_, k) => (bitOf(l, 'hits', k) ? (bitOf(l, 'accents', k) ? 2 : 1) : 0)),
      start: l.start, end: l.end, rate: l.rate, reset: l.reset, mute: !!l.mute,
      note: config?.drumSequencer[0].laneNote[i].value ?? 36 + i,
    })),
    reset: d.reset,
    active: !!values.drumSequencerActive, muted: !!values.drumSequencerMute,
  };
}

// Step `k` of lane `i` set to `v` (0 off, 1 on, 2 accent): its hit and accent bits.
export function setDrumStep(values, i, k, v) {
  const l = values.drumSequencer[0].lane[i];
  const m = k >> 3;
  const n = k & 7;
  const half = n < 4 ? 'Low' : 'High';
  const bit = 1 << (n < 4 ? n : n - 4);
  const field = (which, on) => {
    const now = l[`${which}${half}`][m].value;
    return preset(['drumSequencer', 0, 'lane', i, `${which}${half}`, m, 'value'], on ? now | bit : now & ~bit);
  };
  return [field('hits', v > 0), field('accents', v === 2)];
}

export const nextDrum = (v) => (v + 1) % 3;
export const setLane = (i, obj) => Object.entries(obj).map(([key, v]) => preset(['drumSequencer', 0, 'lane', i, key], key === 'mute' ? (v ? 1 : 0) : v));
export const setDrums = (obj) => Object.entries(obj).map(([key, v]) => (key === 'reset' ? preset(['drumSequencer', 0, 'reset'], v)
  : preset([key === 'active' ? 'drumSequencerActive' : 'drumSequencerMute'], v ? 1 : 0)));
