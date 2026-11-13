// A BCR32 track on the FH-2 (docs/build-plan.md, "How a track shows up", your design 2026-11-09):
// one mono voice on the track's channel (Pitch, Gate, Velocity, Trigger; α or β when the track
// sends them as aftertouch or bend), CC → CV outputs (α and β as CCs, the Plaits Chords' Chord and
// Inversion) and, for the M303, its Accent and Slide as gate triggers on its gate notes (a Knights
// Sampler's Record on its record note; its play gate is the voice's Velocity gate). derive()
// shows them as one source; trackEdits lays them out in a row from a start jack. The tracks
// themselves come from the BCR32 (rotary/tracks.js parseTracks). No DOM, no MIDI.

import { converterPorts } from './derive.js';
import { isUsed } from './mappings.js';
import { setConverter, setTrigger, setRange, setSmoothing, setDirectLevel, cvPerVoice, VOICE_OUTPUTS, SHARED_OUTPUTS } from './edit.js';
import { freeConverter } from './alloc.js';

const PLUS_MINUS_FIVE = 1; // RANGES
const ZERO_TO_FIVE = 3;

// What each machine offers, what is on to start with (your call, 2026-11-09), and the ranges its
// jacks need (set with the track; another range there is a problem).
export const MACHINE_VALUES = {
  M303: { on: ['Pitch', 'Gate', 'Accent', 'Slide'], more: ['α', 'β'] },
  // Pitch ±5 V, as the Knights Sampler's (your call, 2026-11-13); Chord and Inversion: Rotary Club's
  // chord zones assume 0–5 V
  'Plaits Chords': { on: ['Pitch', 'Trigger', 'Chord', 'Inversion'], more: ['Velocity', 'Gate', 'α', 'β'],
    ranges: { Pitch: PLUS_MINUS_FIVE, Chord: ZERO_TO_FIVE, Inversion: ZERO_TO_FIVE } },
  Generic: { on: ['Pitch', 'Gate'], more: ['Velocity', 'Trigger', 'α', 'β'] },
  // the Typhoon's RAM machine (Rotary Club 0.33): Pitch to V/OCT (C4 = 0 V), the play gate with its
  // level to WET (velocity 26–127: at least 1 V), α (Start) and β (Decay) stepped, Record to TRIG
  // (firmware brief, 2026-11-12; your ranges, 2026-11-13)
  'Knights Sampler': { on: ['Pitch', 'Velocity gate', 'α', 'Record'], more: ['β'],
    ranges: { Pitch: PLUS_MINUS_FIVE, 'Velocity gate': ZERO_TO_FIVE, α: ZERO_TO_FIVE, β: ZERO_TO_FIVE } },
};
const ORDER = ['Pitch', 'Gate', 'Velocity gate', 'Velocity', 'Trigger', 'α', 'β', 'Chord', 'Inversion', 'Accent', 'Slide', 'Record'];
const VOICE = { Pitch: 'cvOut', Gate: 'gateOut', 'Velocity gate': 'velGateOut', Velocity: 'velocityOut', Trigger: 'triggerOut' };
// The values that are gates: they can go to a gate expander (a velocity gate is a level on a CV jack).
export const TRACK_GATES = new Set(['Gate', 'Trigger', 'Accent', 'Slide', 'Record']);
const GATE_TYPE = 2; // a trigger of type Gate (tables.js TRIGGER_TYPES)

// Only the tracks that reach the FH-2 show up: an M303, Plaits Chords, Generic or Knights Sampler
// track sending on USB (your call: the TD-3 and the MIDI gear are played by the BCR32 directly).
export const reachesFh2 = (t) => t.output === 'USB' && !!MACHINE_VALUES[t.machine];
export const trackName = (t) => `TR${t.index + 1} · ${t.machine}`;
export const trackId = (t) => `track:${t.index}`;

// How value `v` of track `t` is made on the FH-2: { how: 'voice', key } (a voice output switch),
// { how: 'knob', cc } (a CC → CV output), { how: 'trigger', note } (a gate trigger), or
// { how: null, why } when the track doesn't send it.
export function valueHow(t, v) {
  if (VOICE[v]) return { how: 'voice', key: VOICE[v] };
  if (v === 'α' || v === 'β') {
    const s = v === 'α' ? t.a : t.b;
    if (s.type === 'CC') return { how: 'knob', cc: s.cc };
    if (s.type === 'AT') return { how: 'voice', key: 'aftertouchOut' };
    if (s.type === 'PB') return { how: 'voice', key: 'bendOut' };
    return { how: null, why: s.type === 'PC' ? 'a program change: no CV' : 'off on the BCR32' };
  }
  if (v === 'Chord') return t.plaits ? { how: 'knob', cc: t.plaits.chordCc } : { how: null, why: '' };
  if (v === 'Inversion') return t.plaits?.timbreCc != null ? { how: 'knob', cc: t.plaits.timbreCc } : { how: null, why: 'no CC on the BCR32' };
  if (v === 'Accent' || v === 'Slide') return t.m303 ? { how: 'trigger', note: v === 'Accent' ? t.m303.accent : t.m303.slide } : { how: null, why: '' };
  if (v === 'Record') return t.knights ? { how: 'trigger', note: t.knights.record } : { how: null, why: '' };
  return { how: null, why: '' };
}

// The values track `t` offers, in the row's order: [{ value, how, …, first (on to start with),
// range (the RANGES index its jack needs, or null) }].
export function trackValues(t) {
  const m = MACHINE_VALUES[t.machine];
  if (!m) return [];
  return ORDER.filter((v) => m.on.includes(v) || m.more.includes(v)).map((v) => ({ value: v, ...valueHow(t, v), first: m.on.includes(v), range: m.ranges?.[v] ?? null }));
}

// The jacks of track source `s` (derive's voice with `track`) whose range isn't the one its value
// needs: [{ value, output, jack, now, want }] (RANGES indexes).
export function rangesOff(view, s) {
  const want = new Map(trackValues(s.track.data).filter((v) => v.range != null).map((v) => [v.value, v.range]));
  return s.ports.filter((p) => want.has(p.value) && p.output >= 0 && p.output < 64 && view.outputs[p.output].rangeIndex !== want.get(p.value))
    .map((p) => ({ value: p.value, output: p.output, jack: view.outputs[p.output].jack, now: view.outputs[p.output].rangeIndex, want: want.get(p.value) }));
}
export const rangeEdits = (off) => off.flatMap((x) => setRange(x.output, x.want));

// The values a new track starts with: the machine's, as far as the track sends them.
export const firstValues = (t) => new Set(trackValues(t).filter((v) => v.first && v.how).map((v) => v.value));

// The CCs track `t` sends that land on FH-2 settings when it reaches the FH-2.
export const trackCcs = (t) => (reachesFh2(t) ? trackValues(t).filter((v) => v.how === 'knob').map((v) => ({ value: v.value, cc: v.cc })) : []);

// Which FH-2 parts belong to which track: the first mono voice on its channel; with it, the
// absolute CC → CV outputs on that channel on the track's CCs, and the triggers on its gate notes
// (an M303's). `mappings` from mappingsOf. A track without its voice there claims nothing.
// → { voices: Map(converter → track), knobs: Map(mapping slot → { track, value }), triggers: Map(trigger → { track, value }) }
export function claimsOf(config, mappings, tracks) {
  const voices = new Map();
  const knobs = new Map();
  const triggers = new Map();
  for (const t of tracks ?? []) {
    if (!reachesFh2(t)) continue;
    const i = config.converter.findIndex((cv, k) => cv.enable && cv.type === 0 && cv.channel === t.channel && !voices.has(k));
    if (i < 0) continue;
    voices.set(i, t);
    for (const v of trackValues(t)) {
      if (v.how === 'knob') {
        const m = mappings.find((x) => x.channel === t.channel && x.cc === v.cc && !x.relative && x.target.kind === 'output' && x.target.param === 'directLevel' && !knobs.has(x.slot));
        if (m) knobs.set(m.slot, { track: t, value: v.value });
      } else if (v.how === 'trigger') {
        const k = config.trigger.findIndex((x, n) => x.type && x.channel === t.channel && !x.anyNote && x.note === v.note && !triggers.has(n));
        if (k >= 0) triggers.set(k, { track: t, value: v.value });
      }
    }
  }
  return { voices, knobs, triggers };
}

// A track as it is on the FH-2 now, from its source (derive's voice with `track`): { on: Set of
// values, start, gatesFrom (0: gates on CV jacks) }.
export function trackLayout(s) {
  return { on: new Set(s.ports.map((p) => p.value).filter(Boolean)), start: s.raw.baseOutput, gatesFrom: s.raw.baseGate >= 64 ? s.raw.baseGate : 0 };
}

const OFF = Object.fromEntries([...VOICE_OUTPUTS, ...SHARED_OUTPUTS, ['mpeYcc']].map(([k]) => [k, 0]));

// Where each value of track `t` lands with `layout` ({ on, start, gatesFrom }): the voice's
// outputs in the FH-2's order from `start` (its gates from `gatesFrom` when that is a gate jack),
// then the CC → CV outputs on the next CV jacks, then Accent and Slide after the gates (or the CVs).
// `own`: the track's source id, whose jacks don't count as taken. → { cv (the voice's converter
// settings, or null with nothing on), ports: [{ value, output, jack, present, taken }], problems }
export function trackPlan(view, t, { on, start, gatesFrom = 0 }, own = null) {
  const values = trackValues(t).filter((v) => v.how && on.has(v.value));
  if (!values.length) return { cv: null, ports: [], problems: [] };
  const cv = { ...OFF, type: 0, voices: 1, baseOutput: start, baseGate: gatesFrom >= 64 ? gatesFrom : 0 };
  for (const v of values) if (v.how === 'voice') cv[v.key] = 1;
  cv.stride = cvPerVoice(cv);
  const byKey = (k) => values.find((v) => v.key === k)?.value;
  const ports = converterPorts(cv).map((p) => ({ value: p.role === 'Aftertouch' ? byKey('aftertouchOut') : p.role === 'Bend' ? byKey('bendOut') : p.role, output: p.output }));
  let next = Math.max(start - 1, ...ports.filter((p) => p.output < 64).map((p) => p.output)) + 1;
  let gate = cv.baseGate ? Math.max(cv.baseGate - 1, ...ports.filter((p) => p.output >= 64).map((p) => p.output)) + 1 : null;
  for (const v of values) if (v.how === 'knob') ports.push({ value: v.value, output: next++ });
  for (const v of values) if (v.how === 'trigger') ports.push({ value: v.value, output: gate != null ? gate++ : next++ });
  const problems = [];
  for (const p of ports) {
    const o = p.output >= 0 && p.output < 128 ? view.outputs[p.output] : null;
    p.jack = o?.jack ?? '—';
    p.present = !!o?.present;
    p.taken = o ? [...new Set(o.ports.filter((x) => !x.standby && x.source !== own).map((x) => view.sources.find((s) => s.id === x.source)?.name ?? x.source))] : [];
    if (!o || (!TRACK_GATES.has(p.value) && p.output >= 64)) problems.push({ output: p.output, message: `${p.value} would land past the last CV output` });
    else if (!p.present) problems.push({ output: p.output, message: `${p.value} would land on ${p.jack}, which isn’t in your rack` });
    else if (p.taken.length) problems.push({ output: p.output, message: `${p.value} would land on ${p.jack}, which ${p.taken.join(' and ')} already uses` });
  }
  ports.sort((a, b) => ORDER.indexOf(a.value) - ORDER.indexOf(b.value));
  return { cv, ports, problems };
}

// The first CV jack from which track `t`'s row fits with nothing in the way, or null.
export function trackStart(view, t, layout, own = null) {
  for (let o = 0; o < 64; o++) {
    if (!view.outputs[o].present) continue;
    if (!trackPlan(view, t, { ...layout, start: o }, own).problems.length) return o;
  }
  return null;
}

// The first gate jack from which `count` gate jacks in a row are free (the track's own count as free).
export function trackGateStart(view, count, own = null) {
  const free = (o) => view.outputs[o]?.present && !view.outputs[o].ports.some((x) => !x.standby && x.source !== own);
  for (let o = 64; o + count <= 128; o++) {
    let ok = true;
    for (let k = 0; k < count && ok; k++) ok = free(o + k);
    if (ok) return o;
  }
  return null;
}

// The changes that make track `t`'s FH-2 parts be `layout` ({ on, start, gatesFrom }), as one
// edit: its voice (a free converter for a new track), its CC → CV outputs (stepped: no smoothing in
// the scene in view; the Plaits Chords' at 0–5 V) and its gate triggers, each moved to its place in
// the row; what is switched off goes. With nothing on, the track leaves the FH-2. `s`: the track's
// source now (derive's voice with `track`), or null. Throws when the FH-2 has no room.
export function trackEdits(values, view, t, s, layout) {
  const cfg = values.config;
  const plan = trackPlan(view, t, layout, s?.id ?? null);
  const at = new Map(plan.ports.map((p) => [p.value, p.output]));
  const had = new Map((s?.ports ?? []).filter((p) => p.value).map((p) => [p.value, p]));
  const changes = [];
  const c = (path, value) => ({ dump: 'config', path, value });
  const levelOff = (o) => (values.preset && o < 64 ? setDirectLevel(o, 0) : []);

  // the voice: there as long as anything of the track is
  if (plan.cv) {
    const i = s ? s.index : freeConverter(cfg);
    if (i < 0) throw new Error('all the FH-2’s 16 MIDI/CV converters are in use');
    const obj = { enable: 1, channel: t.channel, ...plan.cv };
    if (!s) Object.assign(obj, { minNote: 0, maxNote: 127, arpClock: 0 });
    // an M303's gate notes (slide C-2, accent D-2) and a Knights Sampler's record note (C-2) aren't pitches
    const low = t.m303 ? Math.max(t.m303.slide, t.m303.accent) : t.knights ? t.knights.record : null;
    if (low != null && low < 12) obj.minNote = Math.max(s ? s.raw.minNote : 0, low + 1);
    changes.push(...setConverter(i, obj));
  } else if (s) changes.push(...setConverter(s.index, { enable: 0, arpClock: 0 }));

  // the CC → CV outputs
  const freeSlots = cfg.mapping.map((m, n) => (isUsed(m) ? -1 : n)).filter((n) => n >= 0);
  const freeTriggers = cfg.trigger.map((x, n) => (x.type ? -1 : n)).filter((n) => n >= 0);
  for (const v of trackValues(t)) {
    const o = at.get(v.value);
    const old = had.get(v.value);
    if (v.how === 'knob') {
      if (o == null) {
        if (old?.slot != null) changes.push(c(['mapping', old.slot, 'status'], 0x7f), ...levelOff(old.output));
        continue;
      }
      const slot = old?.slot ?? freeSlots.shift();
      if (slot == null) throw new Error('all the FH-2’s 384 CC mappings are in use');
      changes.push(c(['mapping', slot, 'status'], 0x30 | t.channel), c(['mapping', slot, 'cc'], v.cc), c(['mapping', slot, 'target'], 0), c(['mapping', slot, 'index'], o));
      if (old?.output !== o) {
        if (values.preset) changes.push(...setSmoothing(o, 0));
        if (old) changes.push(...levelOff(old.output));
      }
    } else if (v.how === 'trigger') {
      if (o == null) {
        if (old?.trigger != null) changes.push(...setTrigger(old.trigger, { type: 0 }));
        continue;
      }
      const k = old?.trigger ?? freeTriggers.shift();
      if (k == null) throw new Error('all the FH-2’s 64 triggers are in use');
      changes.push(...setTrigger(k, { type: GATE_TYPE, channel: t.channel, note: v.note, anyNote: 0, output: o }));
    }
  }
  // each jack at the range its value needs (the Knights Sampler's pitch ±5 V, say)
  const ranges = new Map(trackValues(t).filter((v) => v.range != null).map((v) => [v.value, v.range]));
  for (const p of plan.ports) if (ranges.has(p.value) && p.output < 64) changes.push(...setRange(p.output, ranges.get(p.value)));
  // a part of a value the track no longer sends (its α turned from a CC to bend, say) goes too
  for (const [v, p] of had) {
    if (trackValues(t).some((x) => x.value === v && x.how && (x.how === 'knob') === (p.slot != null) && (x.how === 'trigger') === (p.trigger != null))) continue;
    if (p.slot != null) changes.push(c(['mapping', p.slot, 'status'], 0x7f), ...levelOff(p.output));
    if (p.trigger != null) changes.push(...setTrigger(p.trigger, { type: 0 }));
  }
  return changes;
}

// What a CC mapping moves, in a few words: "Euclid 3 pulses", "the level of CV1/4".
export function movesText(m, view, names = {}) {
  const t = m.target;
  if (t.kind === 'output') return `${t.param === 'directLevel' ? 'the level' : t.param} of ${view.outputs[t.index]?.jack ?? `output ${t.index + 1}`}`;
  if (t.kind === 'converter') return `${view.sources.find((s) => s.id === `converter:${t.index}`)?.name ?? names[`converter:${t.index}`] ?? `Voice ${t.index + 1}`} ${t.param}`;
  if (t.kind === 'global') return t.param;
  if (t.kind === 'unknown') return 'something';
  return `${t.kind} ${t.index + 1} ${t.param}`;
}
