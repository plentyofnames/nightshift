// The note and drum sequencers' steps, as the preset holds them (fh2/preset.js, checked against
// Expert Sleepers' preset tool), and the changes that edit them. Each scene has its own: the steps
// are preset values, like everything else per scene.
//
// A note step: a degree (0–15) and an octave (0–7) for its pitch; a column of 1–8 sub-steps, each
// off, on or a tie (it plays its note too and holds it until just after the next begins), which last
// a step each, or with ratchet on share one step; reset (the sequence starts again there), skip, and
// mute (MUTE_CHANCE). A sequence: its first and last step (0-based), rate (24 ppqn pulses, 0: its
// clock source), gate length (0: a trigger; else a share of each sub-step), reset (quarter notes, 0:
// never), root (semitones added), direction and permutation. All as your FH-2 played them (checks
// S1, S5, S6, 2026-11-06): DIRECTIONS 1–3 and PERMUTATIONS 1–3 in the manual's order, the random
// directions 4–6 taken from it.
// A drum lane: 32 steps, each off, on or accented, with its own first and last step, rate, reset
// and mute; one reset for all eight.

import { noteName, NOTE_NAMES } from './tables.js';

export const GATES = ['off', 'on', 'tie'];
// How likely each mute level mutes its step: about k in 6 for 1–6 (the manual's six levels), 7 as 6.
// Measured over 33 passes (check S5): 9, 36, 52, 79, 88, 100 and 100 %.
export const MUTE_CHANCE = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1, 1];
export const muteText = (m) => (m === 0 ? 'Never' : m >= 6 ? 'Always' : `${Math.round(100 * MUTE_CHANCE[m])}%`);
export const DIRECTIONS = ['Forwards', 'Reverse', 'Alt', 'Alt2', 'Random', 'Random2', 'Random3']; // the manual's order
export const PERMUTATIONS = ['Straight', 'Odd/Even', 'Halves', 'Inwards'];
export const SEQUENCERS = 4;
export const STEPS = 32;
export const LANES = 8;

// The semitones of each degree above degree 0, as your FH-2 plays them (check S1, 2026-11-06):
// degrees 0–7 are a major scale up from the root (C D E F G A B C), 8–15 a semitone above each of
// them, the Launchpad's in-between pads (C♯ D♯ F F♯ G♯ A♯ C C♯). A step plays 12 × (octave + 1) +
// root + that: degree 0 at octave 3 with root 0 is note 48, C3; the root adds semitones (roots 2, 7, 11
// in check S5).
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

// ---- banks (decoded from checks S3 and S4 on your FH-2, 2026-11-06). A bank message is F0 00 21 27
// 2F, then 15 (note sequencers) or 17 (drum sequencer), 4096 bytes sent as 8192 nibbles (high first)
// and F7. Its 28 slots start 24 bytes in (what the first 24 hold isn't known; the first byte is 1
// in a note bank, 2 in a drum bank): a note slot takes 136 bytes, a drum slot 144. The slots are
// taken to run in order from the Launchpad's first (top left), as your two saves did.

export const BANK_SLOTS = 28;
const SLOT_AT = 24;
const NOTE_SLOT = 136;
const DRUM_SLOT = 144;

// The 4096 bytes of a bank message.
export function bankBytes(msg) {
  const out = new Uint8Array(4096);
  for (let i = 0; i < 4096; i++) out[i] = ((msg[6 + 2 * i] & 15) << 4) | (msg[7 + 2 * i] & 15);
  return out;
}
// And back: a bank message of `kind` ('notes' or 'drums') from its 4096 bytes.
export function bankMessage(bytes, kind) {
  const msg = new Uint8Array(8199);
  msg.set([0xf0, 0x00, 0x21, 0x27, 0x2f, kind === 'drums' ? 0x17 : 0x15], 0);
  bytes.forEach((b, i) => {
    msg[6 + 2 * i] = b >> 4;
    msg[7 + 2 * i] = b & 15;
  });
  msg[8198] = 0xf7;
  return msg;
}

// Note slot `n` (0–27): 32 steps of 4 bytes, the gates (16 bits, little-endian, 2 per sub-step), then
// degree (bits 0–3), octave (4–6) and skip (7), then length − 1 (bits 0–2), ratchet (3), reset (4)
// and mute (5–7); then start, end, rate, gate length, reset, root, and direction + 8 × permutation.
// Shaped as noteSequence's.
export function noteSlot(bytes, n) {
  const o = SLOT_AT + NOTE_SLOT * n;
  const steps = Array.from({ length: STEPS }, (_, k) => {
    const [g0, g1, p, f] = bytes.slice(o + 4 * k, o + 4 * k + 4);
    const g = g0 | (g1 << 8);
    return { degree: p & 15, octave: (p >> 4) & 7, length: (f & 7) + 1, ratchet: !!((f >> 3) & 1), reset: !!((f >> 4) & 1), skip: !!(p >> 7), mute: f >> 5,
      gates: Array.from({ length: 8 }, (_, m) => (g >> (2 * m)) & 3) };
  });
  const [start, end, rate, gateLength, reset, rootNote, dp] = bytes.slice(o + 128, o + 135);
  return { slot: n, steps, start, end, rate, gateLength, reset, rootNote, direction: dp & 7, permutation: dp >> 3 };
}

// Drum slot `n`: 8 lanes of 16 bytes, the hits and the accents (32 bits each, little-endian, step k at
// bit k), start, end, rate, reset, mute and 3 unused; then the reset of all eight.
export function drumSlot(bytes, n) {
  const o = SLOT_AT + DRUM_SLOT * n;
  const u32 = (at) => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
  const lanes = Array.from({ length: LANES }, (_, i) => {
    const at = o + 16 * i;
    const hits = u32(at);
    const accents = u32(at + 4);
    const [start, end, rate, reset, mute] = bytes.slice(at + 8, at + 13);
    return { index: i, steps: Array.from({ length: STEPS }, (_, k) => ((hits >>> k) & 1 ? ((accents >>> k) & 1 ? 2 : 1) : 0)), start, end, rate, reset, mute: !!mute };
  });
  return { slot: n, lanes, reset: bytes[o + 128] };
}

// The changes that load a note slot into note sequencer `j` of the scene, as the Launchpad's load does.
export function loadNoteSlot(slot, j) {
  const { start, end, rate, gateLength, reset, rootNote, direction, permutation } = slot;
  return [...slot.steps.flatMap((s, k) => setStep(j, k, { degree: s.degree, octave: s.octave, length: s.length, ratchet: s.ratchet, reset: s.reset, skip: s.skip, mute: s.mute, gates: s.gates })),
    ...setSequence(j, { start, end, rate, gateLength, reset, rootNote, direction, permutation })];
}

// The drum sequencer's lane fields for 32 steps (0 off, 1 on, 2 accent): 4 bits per field, steps m·8 + 0…3
// in the low ones, + 4…7 in the high ones.
function laneFields(steps) {
  const nib = (from, f) => [0, 1, 2, 3].reduce((v, n) => v | (f(steps[from + n]) ? 1 << n : 0), 0);
  const out = {};
  for (const [which, f] of [['hits', (v) => v > 0], ['accents', (v) => v === 2]]) {
    out[`${which}Low`] = [0, 1, 2, 3].map((m) => nib(m * 8, f));
    out[`${which}High`] = [0, 1, 2, 3].map((m) => nib(m * 8 + 4, f));
  }
  return out;
}
// The changes that load a drum slot into the drum sequencer of the scene.
export function loadDrumSlot(slot) {
  const changes = slot.lanes.flatMap((l) => {
    const fields = Object.entries(laneFields(l.steps)).flatMap(([key, list]) => list.map((v, m) => preset(['drumSequencer', 0, 'lane', l.index, key, m, 'value'], v)));
    return [...fields, ...setLane(l.index, { start: l.start, end: l.end, rate: l.rate, reset: l.reset, mute: l.mute })];
  });
  return [...changes, ...setDrums({ reset: slot.reset })];
}

// What a slot holds, in a few words: "steps 3–30 · 21 notes", or null when no step plays.
export function slotSummary(slot) {
  if (slot.lanes) {
    const hits = slot.lanes.reduce((n, l) => n + l.steps.filter(Boolean).length, 0);
    return hits ? `${hits} hits · ${slot.lanes.filter((l) => l.steps.some(Boolean)).length} lanes` : null;
  }
  const notes = slot.steps.slice(slot.start, slot.end + 1).reduce((n, s) => n + s.gates.slice(0, s.length).filter(Boolean).length, 0);
  return notes ? `steps ${slot.start + 1}–${slot.end + 1} · ${notes} notes` : null;
}
