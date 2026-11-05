// Edits to a patch. A patch is { config, preset, names }: two parsed dumps (sysex.js
// parseDump) whose values are the truth, and Night Shift's own names beside them (sources,
// players, the gear on a port and channel), which the FH-2 has no room for. Edits change them
// in place and derive() redraws.
//
// An edit is a list of field changes, { dump: 'config' | 'preset', path, value }, or for a
// name { dump: 'names', path: [key], value: text or null }. Applying one checks every change
// first, then returns the changes that undo it, so undo and redo need nothing else.

import { getPath, setPath, diff } from '../fh2/layout.js';
import { DUMPS } from '../fh2/sysex.js';
import { freeClock, freeEuclid, freeMapping, freeConverter, freeTrigger, freeSrr } from './alloc.js';
import { isUsed, targetOf } from './mappings.js';
import { hzToLfo, LFO_RESET_EUCLID, SRR_STOP, SRR_FORWARDS } from './tables.js';

const fieldIndex = new Map(); // layout → Map(path key → field)
function fieldOf(dump, path) {
  const layout = DUMPS[dump.cmd].layout;
  if (!fieldIndex.has(layout)) fieldIndex.set(layout, new Map(layout.fields.map((fd) => [fd.path.join('.'), fd])));
  return fieldIndex.get(layout).get(path.join('.'));
}

function check(patch, c) {
  const d = patch[c.dump];
  if (!d) throw new Error(`no ${c.dump} loaded`);
  const fd = fieldOf(d, c.path);
  if (!fd) throw new Error(`${c.dump} has no field ${c.path.join('.')}`);
  const t = fd.type;
  if (t.min === undefined) {
    if (typeof c.value !== 'string') throw new Error(`${c.path.join('.')} takes text`);
  } else if (!Number.isInteger(c.value) || c.value < t.min || c.value > t.max) {
    throw new Error(`${c.path.join('.')} takes a whole number from ${t.min} to ${t.max}, not ${c.value}`);
  }
  return d.values;
}

function checkName(patch, c) {
  if (!patch.names) throw new Error('no names in this patch');
  if (c.path.length !== 1 || typeof c.path[0] !== 'string') throw new Error('a name takes one key');
  if (c.value !== null && typeof c.value !== 'string') throw new Error('a name is text');
  return patch.names;
}

// Applies `changes` and returns the changes that undo them. Nothing changes if one is invalid.
export function apply(patch, changes) {
  const targets = changes.map((c) => (c.dump === 'names' ? checkName(patch, c) : check(patch, c)));
  const undo = [];
  changes.forEach((c, i) => {
    const values = targets[i];
    const old = getPath(values, c.path) ?? (c.dump === 'names' ? null : undefined);
    if (old === c.value) return;
    undo.unshift({ dump: c.dump, path: c.path, value: old });
    if (c.dump === 'names' && c.value === null) delete values[c.path[0]];
    else setPath(values, c.path, c.value);
  });
  return undo;
}

// A name for a source or player id ('converter:2'), or for the gear on a port and channel
// (deviceKey('din', 4)); empty clears it.
export const setName = (key, name) => [{ dump: 'names', path: [key], value: name?.trim() ? name.trim() : null }];
export const deviceKey = (port, channel) => `device:${port}:${channel}`;

// The changes that make a dump's values equal `target` (the same dump's values from somewhere
// else, e.g. read from the FH-2): one per field that differs.
export const changesTowards = (kind, dump, target) => diff(DUMPS[dump.cmd].layout, dump.values, target).map((x) => ({ dump: kind, path: x.path, value: x.to }));

// Undo and redo over apply(). Each step has a label for the status line.
export class History {
  constructor() {
    this.done = [];
    this.undone = [];
  }

  // `meta` travels with the step (app.js keeps the scene it was made in there). Steps with the
  // same `meta.fold` in a row become one, so something that keeps happening by itself (values
  // the FH-2 changes on its own, taken in before each live send) doesn't fill the list.
  do(patch, label, changes, meta = {}) {
    const undo = apply(patch, changes);
    if (!undo.length) return false;
    const last = this.done.at(-1);
    if (meta.fold && last?.meta.fold === meta.fold && last.meta.scene === meta.scene && !this.undone.length) {
      last.changes.push(...changes);
      last.undo = [...undo, ...last.undo];
      return true;
    }
    this.done.push({ label, changes, undo, meta });
    this.undone = [];
    return true;
  }

  get nextUndo() { return this.done.at(-1) ?? null; }
  get nextRedo() { return this.undone.at(-1) ?? null; }

  undo(patch) {
    const step = this.done.pop();
    if (!step) return null;
    apply(patch, step.undo);
    this.undone.push(step);
    return step.label;
  }

  redo(patch) {
    const step = this.undone.pop();
    if (!step) return null;
    apply(patch, step.changes);
    this.done.push(step);
    return step.label;
  }

  get canUndo() { return this.done.length > 0; }
  get canRedo() { return this.undone.length > 0; }
}

// ---- jack settings

export const setRange = (output, range) => [{ dump: 'config', path: ['outputRange', output, 'value'], value: range }];
export const setDirectLevel = (output, level) => [{ dump: 'preset', path: ['output', output, 'directLevel'], value: level }];
export const setSmoothing = (output, amount) => [{ dump: 'preset', path: ['output', output, 'smoothing'], value: amount }];
export const setGateLevels = (output, low, high) => [
  { dump: 'config', path: ['gateLevel', output, 'low'], value: low },
  { dump: 'config', path: ['gateLevel', output, 'high'], value: high },
];

// ---- adding sources. Each takes the patch's values ({ config, preset }) to find room, and
// throws when the FH-2 has none left.

const config = (path, value) => ({ dump: 'config', path, value });
const preset = (path, value) => ({ dump: 'preset', path, value });
const noRoom = (what) => new Error(`all the FH-2’s ${what} are in use`);

// A fixed voltage is the jack's stored level with nothing else on it.
export const addFixedVoltage = (output, level) => [...setDirectLevel(output, level), keep('level', output)];

// Night Shift's mark (beside the patch, with the names) that a jack's own level or LFO is in
// use, so it stays listed at its default values: 0 V on a 0–10 V jack, an LFO at depth 0.
export const keep = (what, output, on = true) => ({ dump: 'names', path: [`keep:${what}:${output}`], value: on ? '1' : null });

// A CC sets the jack's stored level. Below CC 32 the FH-2 takes CC n + 32 as its fine half.
export function addKnob(values, output, channel, cc, relative = false) {
  const slot = freeMapping(values.config);
  if (slot < 0) throw noRoom('384 CC mappings');
  return [
    config(['mapping', slot, 'status'], 0x30 | channel),
    config(['mapping', slot, 'cc'], cc),
    config(['mapping', slot, 'target'], relative ? 32 : 0), // 0: direct level
    config(['mapping', slot, 'index'], output),
  ];
}

export const LFO_SHAPES = { sine: 'lfoSine', triangle: 'lfoTriangle', square: 'lfoSquare', random: 'lfoRandom', noise: 'lfoNoise' };

// Every CV jack has an LFO; adding one gives it a shape. `rate` is { hz } or { pulses } (synced).
// `shape` is a key of LFO_SHAPES, or 'saw up' / 'saw down'. `depth` is 0–1.
export function addLfo(output, { shape = 'sine', rate = { hz: 1 }, depth = 1 } = {}) {
  const p = (k, v) => preset(['output', output, k], v);
  const changes = [
    ...Object.values(LFO_SHAPES).map((k) => p(k, 0)),
    p('lfoSaw', shape === 'saw up' ? 127 : shape === 'saw down' ? 0 : 64),
    p('lfoLevel', Math.round(depth * 16383)),
    p('lfoPhase', 0),
    p('lfoFade', 0),
    p('lfoSynced', rate.pulses ? 1 : 0),
  ];
  if (LFO_SHAPES[shape]) changes.push(p(LFO_SHAPES[shape], 127));
  if (rate.pulses) changes.push(p('lfoTempoBase', rate.pulses), p('lfoTempoMultiplier', 1));
  else changes.push(p('lfoSpeed', hzToLfo(rate.hz)));
  changes.push(keep('lfo', output));
  return changes;
}

// A clock (type 1) or a transport signal (types 2–8, see CLOCK_TYPES).
export function addClock(values, output, { type = 1, base = 24, multiplier = 1, length = 0 } = {}) {
  const i = freeClock(values.config);
  if (i < 0) throw noRoom('32 clocks');
  const c = (k, v) => config(['clock', i, k], v);
  return [c('type', type), c('base', base), c('multiplier', multiplier), c('length', length), c('output', output), c('shift', 0)];
}

export function addEuclid(values, hardware, output, pattern) {
  return newEuclid(values, hardware, output, pattern).changes;
}

// A Euclid pattern with no jack, only to clock a sequencer, shift register or arpeggiator, or
// to restart LFOs (it runs as long as it has pulses): { index, changes }. Link it in the same step.
export const addEuclidWithoutJack = (values, hardware, pattern) => newEuclid(values, hardware, null, pattern);

function newEuclid(values, hardware, output, { pulses = 4, steps = 16, rotation = 0, rate = 6 } = {}) {
  const i = freeEuclid(values.config, hardware);
  if (i < 0) throw noRoom('16 Euclid patterns');
  const changes = [
    config(['euclid', i, 'output'], output ?? 127), // 127 with the high bit: None
    config(['euclid', i, 'outputHigh'], output == null ? 1 : 0),
    config(['euclid', i, 'offOutput'], 127),
    config(['euclid', i, 'offOutputHigh'], 1),
  ];
  if (values.preset) {
    const e = (k, v) => preset(['euclid', i, k], v);
    changes.push(e('pulses', pulses), e('steps', steps), e('rotation', rotation), e('rate', rate));
  }
  return { index: i, changes };
}

// ---- shift registers (random)

// Shift register `i`'s jack for `port` ('CV', 'Change' or 'Trigger'), or none when `output` is
// null. The CV needs a CV jack; Change and Trigger are gates and go on any jack. Change and
// Trigger store "none" as 127 with a high bit in the addendum, as Euclid patterns do.
export function setSrrJack(i, port, output) {
  if (port === 'CV') return [config(['srr', i, 'cvOutput'], output == null ? 0 : output + 1)];
  const k = port === 'Change' ? 'changeOutput' : port === 'Trigger' ? 'triggerOutput' : null;
  if (!k) throw new Error(`a shift register has no ${port} output`);
  return [config(['srr', i, k], output ?? 127), config(['srr', i, k + 'High'], output == null ? 1 : 0)];
}

export const setSrr = (i, obj) => fields('preset', ['srr', i], obj);

// A new shift register on `output` as its `port` ('CV' on a CV jack, 'Change' or 'Trigger' on any),
// running forwards in the scene in view: { index, changes }.
export function addRandom(values, hardware, output, port = 'CV', { rate = 12, length = 8, randomness = 96, scale = 0, key = 12 } = {}) {
  const i = freeSrr(values.config, hardware);
  if (i < 0) throw noRoom('16 shift registers');
  const changes = [...setSrrJack(i, 'CV', null), ...setSrrJack(i, 'Change', null), ...setSrrJack(i, 'Trigger', null), ...setSrrJack(i, port, output)];
  if (values.preset) changes.push(...setSrr(i, { direction: SRR_FORWARDS, length, randomness, rate, attenuator: 127, scale, key, gateLength: 0 }));
  return { index: i, changes };
}

// A shift register that only plays notes (no jack), on `channel` to `dests` ({ internal: true,
// din: true, … }), running forwards in the scene in view: { index, changes }.
export function addRandomNotes(values, hardware, { channel, dests, rate = 12, length = 8, randomness = 96, scale = 1, key = 12 } = {}) {
  const i = freeSrr(values.config, hardware);
  if (i < 0) throw noRoom('16 shift registers');
  const changes = [...setSrrJack(i, 'CV', null), ...setSrrJack(i, 'Change', null), ...setSrrJack(i, 'Trigger', null),
    ...setPlayer(`srrNotes:${i}`, { channel, dests })];
  if (values.preset) changes.push(...setSrr(i, { direction: SRR_FORWARDS, length, randomness, rate, attenuator: 127, scale, key, gateLength: 0 }));
  return { index: i, changes };
}

// What clocks from or restarts on Euclid pattern `i` goes back to the external clock, or to
// never restarting: for removing the pattern.
function unlinkEuclid(c, i) {
  const out = [];
  c.noteSequencer.forEach((q, j) => q.clock === i + 1 && out.push(config(['noteSequencer', j, 'clock'], 0)));
  c.srr.forEach((r, j) => r.clock === i + 1 && out.push(config(['srr', j, 'clock'], 0)));
  c.converter.forEach((cv, j) => cv.arpClock === i + 1 && out.push(config(['converter', j, 'arpClock'], 0)));
  c.lfoReset.forEach((r, o) => r.type === LFO_RESET_EUCLID && r.number === i && out.push(config(['lfoReset', o, 'type'], 0)));
  return out;
}

// ---- removing what comes out of a jack

// An LFO is off when no shape is turned up; its other settings stay for next time.
export const removeLfo = (output) => [
  ...Object.values(LFO_SHAPES).map((k) => preset(['output', output, k], 0)),
  preset(['output', output, 'lfoSaw'], 64),
  keep('lfo', output, false),
];

// The CC mappings that set something of output `o` (its level, smoothing or LFO), removed;
// `only` picks by the setting's name.
function unmapOutput(cfg, o, only = () => true) {
  const out = [];
  cfg.mapping.forEach((m, n) => {
    if (!isUsed(m)) return;
    const t = targetOf(m);
    if (t.kind === 'output' && t.index === o && only(t.param)) out.push(config(['mapping', n, 'status'], 0x7f));
  });
  return out;
}

// A jack's own layer back to how an unused jack is: its level at the bottom of its range, its
// LFO off, no smoothing, no CC on any of them, and no marks (your call, 2026-11-04: removing
// one of them clears it all, else a CC left behind keeps it listed).
export function clearJack(values, o) {
  const presetPart = values.preset ? [...setDirectLevel(o, 0), ...removeLfo(o), ...setSmoothing(o, 0)] : [keep('lfo', o, false)];
  return [...presetPart, keep('level', o, false), ...unmapOutput(values.config, o)];
}

// An LFO off, with the CCs on its settings: with one left, it would still count as on.
export const removeLfoWithCcs = (values, o) => [...removeLfo(o), ...unmapOutput(values.config, o, (p) => p.startsWith('lfo'))];

// The changes that take `port` of `source` (from derive) off its jack. Sources that span
// several jacks (clocks, knobs on one channel) lose only that port. A jack's own level, knob
// or LFO goes with the rest of its layer (clearJack).
export function removePort(values, source, port) {
  const o = port.output;
  switch (source.kind) {
    case 'level':
    case 'knobs':
    case 'lfo':
      return clearJack(values, o);
    case 'clock':
      return [config(['clock', port.clock, 'type'], 0)];
    case 'triggers':
      return setTrigger(port.trigger, { type: 0 }); // with an accent type, its second jack goes too
    case 'euclid': {
      // off its last jack it stops (no pulses), unless something still follows it
      const k = port.name === 'Pulses' ? 'output' : 'offOutput';
      const stop = source.ports.length === 1 && !source.used && values.preset ? [preset(['euclid', source.index, 'pulses'], 0)] : [];
      return [config(['euclid', source.index, k], 127), config(['euclid', source.index, k + 'High'], 1), ...stop];
    }
    case 'random': {
      // off its last jack it stops, unless it still sends its notes somewhere
      const stop = source.ports.length === 1 && !source.sendsNotes && values.preset ? setSrr(source.index, { direction: SRR_STOP }) : [];
      return [...setSrrJack(source.index, port.name, null), ...stop];
    }
    case 'hid':
      // Usage (gamepad) or Type (keyboard) "--" switches an entry off; its output stays as it is.
      // (Setting the output to None is what breaks in Expert Sleepers' tool: it sends 0xFF.)
      return [source.id === 'gamepad' ? config(['gamepad', port.slot, 'usage'], 0) : config(['keyboard', port.slot, 'type'], 0)];
    case 'voice': {
      // A voice's outputs come as a set: turning one off moves the ones after it up.
      const k = outputSwitch(port.role);
      if (!k) throw new Error(`can’t turn off ${port.name}`);
      return setConverter(source.index, { [k]: 0 });
    }
    default:
      throw new Error(`removing a ${source.kind} isn’t possible yet`);
  }
}

// A whole source. A Euclid pattern loses its jacks and its links too (what it clocks goes back
// to the external clock), and stops in the scene in view, else it would stay without a jack.
export function removeSource(values, source) {
  if (source.kind === 'voice') return setConverter(source.index, { enable: 0 }); // its settings stay, for when it comes back
  if (source.kind === 'euclid') {
    const i = source.index;
    return [config(['euclid', i, 'output'], 127), config(['euclid', i, 'outputHigh'], 1),
      config(['euclid', i, 'offOutput'], 127), config(['euclid', i, 'offOutputHigh'], 1), ...unlinkEuclid(values.config, i),
      ...(values.preset ? [preset(['euclid', i, 'pulses'], 0)] : [])];
  }
  if (source.kind === 'random') {
    // off its jacks it plays on as a player, if it sends notes; one with no jack (only notes) stops
    if (!source.ports.length) {
      return [...setPlayer(`srrNotes:${source.index}`, { dests: { internal: false, usbC: false, usbA: false, din: false, select: false } }),
        ...(values.preset ? setSrr(source.index, { direction: SRR_STOP }) : [])];
    }
    const stop = !source.sendsNotes && values.preset ? setSrr(source.index, { direction: SRR_STOP }) : [];
    return [...source.ports.flatMap((p) => setSrrJack(source.index, p.name, null)), ...stop];
  }
  return source.ports.flatMap((p) => removePort(values, source, p));
}

// ---- changing a source's settings

// Changes for several fields under one path, e.g. fields('preset', ['euclid', 2], { pulses: 5 }).
export const fields = (dump, base, obj) => Object.entries(obj).map(([k, value]) => ({ dump, path: [...base, k], value }));

export const setLfo = (output, obj) => fields('preset', ['output', output], obj);
export const setClock = (clock, obj) => fields('config', ['clock', clock], obj);
export const setEuclid = (euclid, obj) => fields('preset', ['euclid', euclid], obj);

// What restarts an output's LFO: { type, channel, number } as in LFO_RESET_TYPES (0 = never).
export const setLfoRestart = (output, { type, channel = 0, number = 0 }) => fields('config', ['lfoReset', output], { type, channel, number });

// A knob's mapping slot (from derive's port.slot): its channel, CC and relative flag.
export const setKnob = (slot, { channel, cc, relative }) => fields('config', ['mapping', slot], {
  status: 0x30 | channel, cc, target: relative ? 32 : 0,
});

// ---- voices (MIDI/CV converters)

// The converter's output switches, and the derive() port roles they make.
export const VOICE_OUTPUTS = [
  ['cvOut', 'Pitch'], ['gateOut', 'Gate'], ['velGateOut', 'Velocity gate'], ['velocityOut', 'Velocity'],
  ['releaseVelocityOut', 'Release velocity'], ['triggerOut', 'Trigger'], ['pressureOut', 'Pressure'],
  ['envelopeOut', 'Envelope'], ['randomOut', 'Random'],
];
export const SHARED_OUTPUTS = [['aftertouchOut', 'Aftertouch'], ['paraGateOut', 'Para gate'], ['bendOut', 'Bend']];
const ALL_OUTPUTS = [...VOICE_OUTPUTS, ...SHARED_OUTPUTS, ['mpeYcc', 'MPE Y']];

export const setConverter = (i, obj) => fields('config', ['converter', i], obj);
export const setConverterPreset = (i, obj) => fields('preset', ['converter', i], obj);

// A new voice from `output` (a CV jack). `outs` holds the output switches to turn on
// (e.g. { cvOut: 1, gateOut: 1 }); all others are turned off. `baseGate` 0 keeps gates on CV
// jacks, otherwise it is the first gate output.
export function addVoice(values, { output, channel, type = 0, voices = 1, outs = { cvOut: 1, gateOut: 1 }, baseGate = 0, minNote = 0, maxNote = 127 }) {
  const i = freeConverter(values.config);
  if (i < 0) throw noRoom('16 MIDI/CV converters');
  const switches = Object.fromEntries(ALL_OUTPUTS.map(([k]) => [k, outs[k] ?? 0]));
  return setConverter(i, { enable: 1, channel, type, voices, minNote, maxNote, baseOutput: output, baseGate, stride: cvPerVoice(switches, baseGate), ...switches });
}

// How many CV jacks one voice takes: its per-voice outputs, less Gate and Trigger when they go
// to a gate expander. Written as the stride, so voices sit back to back without relying on
// stride 0 meaning that (hardware check 11); the Init config does the same.
export function cvPerVoice(cv, baseGate = cv.baseGate) {
  const onGates = baseGate >= 64;
  return Math.max(1, VOICE_OUTPUTS.filter(([k]) => cv[k] && !(onGates && (k === 'gateOut' || k === 'triggerOut'))).length
    + (cv.type === 2 && cv.mpeYcc ? 1 : 0));
}

// The switch behind a voice port's role ('Velocity (inverted)' → velocityOut, 'Bend up' → bendOut).
export function outputSwitch(role) {
  const r = role.replace(/ \(inverted\)$/, '').replace(/^Bend (up|down)$/, 'Bend');
  return ALL_OUTPUTS.find(([, name]) => name === r)?.[0] ?? null;
}

// ---- triggers (a note fires a trigger, gate or level)

// Trigger types that put out a level (from velocity or an envelope): they need a CV jack.
export const LEVEL_TRIGGER_TYPES = new Set([3, 4, 9, 10]);
export const isAccentType = (type) => type === 5 || type === 6; // these also use the next jack up

export const setTrigger = (i, obj) => fields('config', ['trigger', i], obj);

// A note (or any note, `note` null) on `channel` fires `type` on `output`. `envSet` (0–15) is
// the voice whose envelope settings an Envelope trigger borrows.
export function addTrigger(values, { output, channel, note = 36, type = 1, envSet = 0 }) {
  const i = freeTrigger(values.config);
  if (i < 0) throw noRoom('64 triggers');
  return setTrigger(i, { type, channel, note: note ?? 0, anyNote: note == null ? 1 : 0, output, envSetHigh: envSet >> 1, envSetLow: envSet & 1 });
}

export const setTriggerNote = (i, note) => setTrigger(i, { note: note ?? 0, anyNote: note == null ? 1 : 0 });
export const setTriggerEnvSet = (i, envSet) => setTrigger(i, { envSetHigh: envSet >> 1, envSetLow: envSet & 1 });

// ---- players: the FH-2's own MIDI makers (see derive's playersOf)

const DESTS = { internal: 'toInternal', usbC: 'toUsbC', usbA: 'toUsbA', din: 'toDin', select: 'toSelect' };

// Where a player's settings live. `id` is a player id from derive ('noteSequencer:1', 'srrNotes:3'…).
export function playerFields(id) {
  const [kind, n] = id.split(':');
  const i = Number(n) || 0;
  switch (kind) {
    case 'noteSequencer': return { base: ['noteSequencer', i], channel: 'channel', dests: DESTS, clock: 'clock', rate: ['noteSequencer', i, 'rate'] };
    case 'drumSequencer': return { base: ['drumSequencer', 0], channel: 'channel', dests: DESTS };
    case 'srrNotes': return { base: ['srr', i], channel: 'channel', dests: DESTS, clock: 'clock', rate: ['srr', i, 'rate'] };
    case 'cvMidi': return { base: ['cvMidi', i], channel: 'channel', dests: DESTS };
    default: throw new Error(`no player ${id}`);
  }
}

// Changes a player's channel, destinations ({ din: true, … }) and clock source (0 external,
// n Euclid pattern n); whatever is left out stays as it is.
export function setPlayer(id, { channel, dests = {}, clock } = {}) {
  const f = playerFields(id);
  const obj = {};
  if (channel != null) obj[f.channel] = channel;
  for (const [d, on] of Object.entries(dests)) {
    if (!f.dests[d]) throw new Error(`${id} can’t send to ${d}`);
    obj[f.dests[d]] = on ? 1 : 0;
  }
  if (clock != null) {
    if (!f.clock) throw new Error(`${id} has no clock source`);
    obj[f.clock] = clock;
  }
  return fields('config', f.base, obj);
}

// The rate in 24 ppqn pulses (preset); 0 hands the player to its clock source.
export function setPlayerRate(id, rate) {
  const f = playerFields(id);
  if (!f.rate) throw new Error(`${id} has no rate`);
  return [preset(f.rate, rate)];
}

// A player plays a voice or trigger kit inside the FH-2 when it sends to internal on their channel.
export const wirePlayer = (id, channel) => setPlayer(id, { channel, dests: { internal: true } });
export const unwirePlayer = (id) => setPlayer(id, { dests: { internal: false } });

export const setLaneNote = (lane, note) => [config(['drumSequencer', 0, 'laneNote', lane, 'value'], note)];

// Moves a voice or trigger kit (`source` from derive) and the players playing it to `channel`,
// e.g. one nothing outside uses, so only the FH-2's own players reach it.
export function moveToChannel(source, channel) {
  const changes = source.kind === 'voice'
    ? setConverter(source.index, { channel })
    : source.ports.filter((p) => !p.accent).flatMap((p) => setTrigger(p.trigger, { channel }));
  for (const p of source.players ?? []) changes.push(...setPlayer(p.id, { channel }));
  return changes;
}
