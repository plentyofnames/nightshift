// The "+ add" flow: what should come out of an empty jack (artboard 2 of the mockups). Pick a
// kind of source, set its few main settings, and Night Shift finds room for it in the FH-2.

import { h, $, replace, modal } from '../../vendor/lilypad/js/dom.js';
import { icon } from './look.js';
import { RANGE_VOLTS, DIVISIONS, CLOCK_TYPES, voltsToLevel } from '../patch/tables.js';
import { freeCcs, suggestCc } from '../patch/alloc.js';
import { addFixedVoltage, addKnob, addLfo, addClock, addEuclid } from '../patch/edit.js';

const KINDS = [
  { id: 'fixed', group: 'Control', title: 'Fixed voltage', desc: 'Stored in the preset', icon: 'level', cv: true, preset: true },
  { id: 'knob', group: 'Control', title: 'MIDI knob', desc: 'A CC sets the voltage', icon: 'knobs', cv: true },
  { id: 'lfo', group: 'Modulation', title: 'LFO', desc: 'Free, or synced to the tempo', icon: 'lfo', cv: true, preset: true },
  { id: 'clock', group: 'Timing', title: 'Clock', desc: 'Divisions of the tempo', icon: 'clock' },
  { id: 'transport', group: 'Timing', title: 'Transport', desc: 'Run gate, start and stop pulses', icon: 'clock' },
  { id: 'euclid', group: 'Timing', title: 'Euclidean rhythm', desc: 'Pulses spread over steps', icon: 'euclid' },
];
const SHAPES = ['sine', 'triangle', 'square', 'saw up', 'saw down', 'random', 'noise'];

// Resolves with { label, changes } for app.js to apply, or null if cancelled.
// `values` is { config, preset } (the dumps' values); `o` a derive() output.
export async function addToJack(values, hardware, o) {
  const why = (k) => (k.cv && o.gate ? 'CV jacks only: gate outputs are always 10 V'
    : k.preset && !values.preset ? 'needs a preset: pull or open one' : null);
  const f = {
    kind: KINDS.find((k) => !why(k))?.id,
    volts: Math.max(0, RANGE_VOLTS[o.rangeIndex ?? 0][0]), channel: 1, cc: suggestCc(values.config, 1), relative: false,
    shape: 'sine', synced: false, hz: 1, lfoPulses: 96, depth: 100,
    base: 24, multiplier: 1, length: 0, transport: 2,
    pulses: 4, steps: 16, rotation: 0, rate: 6,
  };

  const tiles = h('div', { class: 'tiles' });
  const details = h('div', { class: 'fields' });
  const draw = () => {
    replace(tiles, ['Control', 'Modulation', 'Timing'].map((g) => h('div', { class: 'tile-group' },
      h('span', { class: 'tile-head' }, g),
      KINDS.filter((k) => k.group === g).map((k) => h('button', {
        type: 'button', class: 'tile', 'aria-pressed': f.kind === k.id ? 'true' : 'false', disabled: !!why(k),
        onclick: () => { f.kind = k.id; draw(); },
      }, icon(k.icon), h('span', {}, h('b', {}, k.title), h('span', {}, why(k) ?? k.desc)))))));
    replace(details, fieldsFor(f, values, o, draw));
  };
  draw();

  const where = `jack ${o.jack}`;
  const ok = await modal($('dialog'), {
    title: `What should come out of ${where}?`,
    body: [h('p', { class: 'note' }, `${o.gate ? 'Gate jack: clocks, transport and rhythms.' : `CV jack, ${o.range}: anything goes.`} You can change everything later.`), tiles, details],
    buttons: [{ label: 'Cancel', value: false }, { label: 'Add', value: true, primary: true }],
  });
  if (!ok || !f.kind) return null;
  return build(f, values, hardware, o, where);
}

function build(f, values, hardware, o, where) {
  const division = (p) => DIVISIONS.find(([n]) => n === p)?.[1] ?? `${p}/24`;
  switch (f.kind) {
    case 'fixed':
      return { label: `Fixed ${f.volts} V on ${where}`, changes: addFixedVoltage(o.index, voltsToLevel(f.volts, o.rangeIndex)) };
    case 'knob':
      return { label: `CC ${f.cc} on ch ${f.channel + 1} sets ${where}`, changes: addKnob(values, o.index, f.channel, f.cc, f.relative) };
    case 'lfo':
      return {
        label: `LFO on ${where}`,
        changes: addLfo(o.index, { shape: f.shape, rate: f.synced ? { pulses: f.lfoPulses } : { hz: f.hz }, depth: f.depth / 100 }),
      };
    case 'clock':
      return { label: `Clock ${division(f.base)}${f.multiplier > 1 ? ` × ${f.multiplier}` : ''} on ${where}`,
        changes: addClock(values, o.index, { base: f.base, multiplier: f.multiplier, length: f.length }) };
    case 'transport':
      return { label: `${CLOCK_TYPES[f.transport]} on ${where}`, changes: addClock(values, o.index, { type: f.transport }) };
    case 'euclid':
      return { label: `Euclid ${f.pulses} of ${f.steps} on ${where}`,
        changes: addEuclid(values, hardware, o.index, { pulses: f.pulses, steps: f.steps, rotation: f.rotation, rate: f.rate }) };
  }
  return null;
}

// ---- the settings below the tiles, for the chosen kind

const field = (label, control, note) => h('label', { class: 'field' }, h('span', {}, label),
  Array.isArray(control) ? h('span', { class: 'with-unit' }, control) : control, note && h('small', {}, note));
const num = (f, key, min, max, step = 1) => h('input', {
  type: 'number', class: 'num', min, max, step, value: f[key],
  onchange: (e) => {
    const v = parseFloat(e.target.value);
    f[key] = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : f[key];
    e.target.value = f[key];
  },
});
const pick = (f, key, options, redraw) => h('select', {
  onchange: (e) => {
    const v = e.target.value;
    f[key] = typeof f[key] === 'number' ? +v : v === 'true' ? true : v === 'false' ? false : v;
    redraw?.();
  },
}, options.map(([value, label]) => h('option', { value, selected: String(value) === String(f[key]) }, label)));
const divisions = DIVISIONS.map(([p, name]) => [p, name]);

function fieldsFor(f, values, o, redraw) {
  switch (f.kind) {
    case 'fixed': {
      const [lo, hi] = RANGE_VOLTS[o.rangeIndex ?? 0];
      return [field('Voltage', [num(f, 'volts', lo, hi, 0.01), ' V'], `${o.range}. Kept in the preset, so each scene can have its own.`)];
    }
    case 'knob': {
      const ccs = freeCcs(values.config, f.channel);
      if (!ccs.some((c) => c.cc === f.cc)) f.cc = suggestCc(values.config, f.channel);
      return [
        field('MIDI channel', pick(f, 'channel', Array.from({ length: 16 }, (_, c) => [c, String(c + 1)]), redraw)),
        field('CC', pick(f, 'cc', ccs.map((c) => [c.cc, `${c.cc}${c.fine ? ` (14-bit with ${c.cc + 32})` : ''}`])),
          'Only CCs nothing else uses on this channel. Below 32, the FH-2 takes CC n + 32 as the fine half, for 14-bit control.'),
        field('Relative', pick(f, 'relative', [[false, 'No: absolute'], [true, 'Yes: an endless encoder']]), 'Relative CCs move in 7-bit steps (128 per step).'),
      ];
    }
    case 'lfo':
      return [
        field('Shape', pick(f, 'shape', SHAPES.map((s) => [s, s[0].toUpperCase() + s.slice(1)])), 'Shapes can be mixed later.'),
        field('Timing', pick(f, 'synced', [[false, 'Free (Hz)'], [true, 'Synced to the tempo']], redraw)),
        f.synced ? field('One cycle', pick(f, 'lfoPulses', divisions)) : field('Rate', [num(f, 'hz', 0.1, 10, 0.01), ' Hz']),
        field('Depth', [num(f, 'depth', 0, 100), ' %']),
      ];
    case 'clock':
      return [
        field('Every', pick(f, 'base', divisions)),
        field('Times', num(f, 'multiplier', 1, 127), '2 with 1/4 gives half notes, and so on.'),
        field('Pulse', [num(f, 'length', 0, 127), ' ms'], '0 = half the period (a square wave).'),
      ];
    case 'transport':
      return [field('Signal', pick(f, 'transport', CLOCK_TYPES.map((n, i) => [i, n]).slice(2)))];
    case 'euclid':
      return [
        field('Pulses', num(f, 'pulses', 0, 32)),
        field('Steps', num(f, 'steps', 1, 32)),
        field('Rotation', num(f, 'rotation', 0, 31)),
        field('Step rate', pick(f, 'rate', divisions)),
      ];
  }
  return [];
}
