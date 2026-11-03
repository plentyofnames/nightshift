// Edits to a patch. A patch is { config, preset }, each a parsed dump (sysex.js parseDump)
// whose values are the truth; edits change those values in place and derive() redraws.
//
// An edit is a list of field changes, { dump: 'config' | 'preset', path, value }. Applying
// one checks every change against the dump's layout first, then returns the changes that
// undo it, so undo and redo need nothing else.

import { getPath, setPath } from '../fh2/layout.js';
import { DUMPS } from '../fh2/sysex.js';
import { freeClock, freeEuclid, freeMapping } from './alloc.js';
import { isUsed, targetOf } from './mappings.js';
import { hzToLfo } from './tables.js';

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
  return d;
}

// Applies `changes` and returns the changes that undo them. Nothing changes if one is invalid.
export function apply(patch, changes) {
  const dumps = changes.map((c) => check(patch, c));
  const undo = [];
  changes.forEach((c, i) => {
    const values = dumps[i].values;
    const old = getPath(values, c.path);
    if (old === c.value) return;
    undo.unshift({ dump: c.dump, path: c.path, value: old });
    setPath(values, c.path, c.value);
  });
  return undo;
}

// Undo and redo over apply(). Each step has a label for the status line.
export class History {
  constructor() {
    this.done = [];
    this.undone = [];
  }

  do(patch, label, changes) {
    const undo = apply(patch, changes);
    if (!undo.length) return false;
    this.done.push({ label, changes, undo });
    this.undone = [];
    return true;
  }

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
export const addFixedVoltage = (output, level) => setDirectLevel(output, level);

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
  return changes;
}

// A clock (type 1) or a transport signal (types 2–8, see CLOCK_TYPES).
export function addClock(values, output, { type = 1, base = 24, multiplier = 1, length = 0 } = {}) {
  const i = freeClock(values.config);
  if (i < 0) throw noRoom('32 clocks');
  const c = (k, v) => config(['clock', i, k], v);
  return [c('type', type), c('base', base), c('multiplier', multiplier), c('length', length), c('output', output), c('shift', 0)];
}

export function addEuclid(values, hardware, output, { pulses = 4, steps = 16, rotation = 0, rate = 6 } = {}) {
  const i = freeEuclid(values.config, hardware);
  if (i < 0) throw noRoom('16 Euclid patterns');
  const changes = [
    config(['euclid', i, 'output'], output),
    config(['euclid', i, 'outputHigh'], 0),
    config(['euclid', i, 'offOutput'], 127),
    config(['euclid', i, 'offOutputHigh'], 1),
  ];
  if (values.preset) {
    const e = (k, v) => preset(['euclid', i, k], v);
    changes.push(e('pulses', pulses), e('steps', steps), e('rotation', rotation), e('rate', rate));
  }
  return changes;
}

// ---- removing what comes out of a jack

// The changes that take `port` of `source` (from derive) off its jack. Sources that span
// several jacks (clocks, knobs on one channel) lose only that port.
export function removePort(values, source, port) {
  const o = port.output;
  switch (source.kind) {
    case 'level':
      return setDirectLevel(o, 0);
    case 'knobs': {
      const slots = [];
      values.config.mapping.forEach((m, n) => {
        if (!isUsed(m)) return;
        const t = targetOf(m);
        if (t.kind === 'output' && t.index === o && t.param === 'directLevel') slots.push(n);
      });
      return slots.map((n) => config(['mapping', n, 'status'], 0x7f));
    }
    case 'lfo':
      return [...Object.values(LFO_SHAPES).map((k) => preset(['output', o, k], 0)), preset(['output', o, 'lfoSaw'], 64)];
    case 'clock':
      return [config(['clock', port.clock, 'type'], 0)];
    case 'euclid': {
      const k = port.name === 'Pulses' ? 'output' : 'offOutput';
      return [config(['euclid', source.index, k], 127), config(['euclid', source.index, k + 'High'], 1)];
    }
    default:
      throw new Error(`removing a ${source.kind} isn’t possible yet`);
  }
}

export const removeSource = (values, source) => source.ports.flatMap((p) => removePort(values, source, p));
