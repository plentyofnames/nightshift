// The "+ add" flow: what should come out of an empty jack (artboard 2 of the mockups). Pick a
// kind of source, set its few main settings, and Night Shift finds room for it in the FH-2.

import { h, $, replace, modal } from '../../vendor/lilypad/js/dom.js';
import { icon } from './look.js';
import { learnCc } from './connect.js';
import { RANGE_VOLTS, DIVISIONS, CLOCK_TYPES, TRIGGER_TYPES, voltsToLevel, noteName, SRR_SCALES, srrRandomnessText } from '../patch/tables.js';
import { freeCcs, suggestCc, suggestChannel, suggestBaseGate, suggestStart, voicePlan, suggestTriggerChannel, suggestNote, jacksInTheWay } from '../patch/alloc.js';
import { addFixedVoltage, addKnob, addLfo, addClock, addEuclid, addVoice, addTrigger, addRandom, VOICE_OUTPUTS, SHARED_OUTPUTS, LEVEL_TRIGGER_TYPES, isAccentType } from '../patch/edit.js';

const KINDS = [
  { id: 'voice', group: 'Notes', title: 'Pitch & gate', desc: 'A voice: mono or poly', icon: 'voice', cv: true },
  { id: 'trigger', group: 'Notes', title: 'Trigger', desc: 'A MIDI note fires a trigger, gate or level', icon: 'triggers' },
  { id: 'fixed', group: 'Control', title: 'Fixed voltage', desc: 'Stored in the preset', icon: 'level', cv: true, preset: true },
  { id: 'knob', group: 'Control', title: 'MIDI knob', desc: 'A CC sets the voltage', icon: 'knobs', cv: true },
  { id: 'lfo', group: 'Modulation', title: 'LFO', desc: 'Free, or synced to the tempo', icon: 'lfo', cv: true, preset: true },
  { id: 'random', group: 'Modulation', title: 'Random', desc: 'A shift register: a looping random CV, or random gates', icon: 'random', preset: true },
  { id: 'clock', group: 'Timing', title: 'Clock', desc: 'Divisions of the tempo', icon: 'clock' },
  { id: 'transport', group: 'Timing', title: 'Transport', desc: 'Run gate, start and stop pulses', icon: 'clock' },
  { id: 'euclid', group: 'Timing', title: 'Euclidean rhythm', desc: 'Pulses spread over steps', icon: 'euclid' },
];
const SHAPES = ['sine', 'triangle', 'square', 'saw up', 'saw down', 'random', 'noise'];

// Resolves with { label, changes } for app.js to apply, or null if cancelled.
// `view` is derive()'s result, `values` the dumps' values ({ config, preset }), `o` the jack's output.
export async function addToJack(view, values, o) {
  const hardware = view.hardware;
  const why = (k) => (k.cv && o.gate ? 'CV jacks only: gate outputs are always 10 V'
    : k.preset && !values.preset ? 'needs a preset: pull or open one' : null);
  const f = {
    kind: KINDS.find((k) => !why(k))?.id,
    volts: Math.max(0, RANGE_VOLTS[o.rangeIndex ?? 0][0]), channel: 1, cc: suggestCc(values.config, 1), relative: false,
    shape: 'sine', synced: false, hz: 1, lfoPulses: 96, depth: 100,
    base: 24, multiplier: 1, length: 0, transport: 2,
    pulses: 4, steps: 16, rotation: 0, rate: 6,
    srrPort: o.gate ? 'Trigger' : 'CV', srrRate: 12, srrLength: 8, srrRandomness: 96, srrScale: 0,
    trigChannel: suggestTriggerChannel(values.config), trigType: 1, envSet: 0,
    voiceType: 0, voices: 2, voiceChannel: suggestChannel(values.config), outs: { cvOut: 1, gateOut: 1 }, gatesOnExpander: false, start: o.index,
  };

  f.trigNote = suggestNote(values.config, f.trigChannel);
  const tiles = h('div', { class: 'tiles' });
  const details = h('div', { class: 'fields' });
  const draw = () => {
    replace(tiles, ['Notes', 'Control', 'Modulation', 'Timing'].map((g) => h('div', { class: 'tile-group' },
      h('span', { class: 'tile-head' }, g),
      KINDS.filter((k) => k.group === g).map((k) => h('button', {
        type: 'button', class: 'tile', 'aria-pressed': f.kind === k.id ? 'true' : 'false', disabled: !!why(k),
        onclick: () => { f.kind = k.id; draw(); },
      }, icon(k.icon), h('span', {}, h('b', {}, k.title), h('span', {}, why(k) ?? k.desc)))))));
    replace(details, fieldsFor(f, values, o, draw, view));
    // nothing is added on top of another source: Add waits until the voice fits
    const add = $('dialog').querySelector('button.primary');
    if (add) add.disabled = (f.kind === 'voice' && !voiceFits(f, o, view)) || (f.kind === 'trigger' && triggerProblems(f, o, view).length > 0);
  };
  draw();

  const where = `jack ${o.jack}`;
  const pending = modal($('dialog'), {
    title: `What should come out of ${where}?`,
    body: [h('p', { class: 'note' }, o.gate ? 'Gate jack' : `CV jack, ${o.range}`), tiles, details],
    buttons: [{ label: 'Cancel', value: false }, { label: 'Add', value: true, primary: true }],
  });
  draw();
  const ok = await pending;
  if (!ok || !f.kind) return null;
  return build(f, values, hardware, o, where, view);
}

// The converter settings the voice fields describe; `baseGate` 64 stands for "on a gate expander".
function voiceSettings(f, o, baseGate) {
  return { type: f.voiceType, voices: f.voiceType ? f.voices : 1, baseOutput: f.start, baseGate, stride: 0, ...f.outs };
}

const gatesFor = (f, o, view) => (f.gatesOnExpander ? gateStart(f, o, view) ?? 0 : 0);
// A trigger uses its jack, and an accent type the next one up too.
const triggerJacks = (f, o) => (isAccentType(f.trigType) ? [o.index, o.index + 1] : [o.index]);
const triggerProblems = (f, o, view) => jacksInTheWay(view, triggerJacks(f, o), ['The trigger', 'Its accent']);

const voiceFits = (f, o, view) => Object.values(f.outs).some(Boolean) && !voicePlan(view, voiceSettings(f, o, gatesFor(f, o, view))).problems.length;

// Where the gates go: the first run of free gate jacks long enough for them, or none.
function gateStart(f, o, view) {
  const gates = voicePlan(view, voiceSettings(f, o, 64)).ports.filter((p) => p.output >= 64).length;
  return gates ? suggestBaseGate(view, gates) : null;
}

function build(f, values, hardware, o, where, view) {
  const division = (p) => DIVISIONS.find(([n]) => n === p)?.[1] ?? `${p}/24`;
  switch (f.kind) {
    case 'trigger': {
      const note = f.trigNote < 0 ? null : f.trigNote;
      return { label: `${TRIGGER_TYPES[f.trigType]} for ${note == null ? 'any note' : noteName(note)} on ch ${f.trigChannel + 1} at ${where}`,
        changes: addTrigger(values, { output: o.index, channel: f.trigChannel, note, type: f.trigType, envSet: f.envSet }) };
    }
    case 'voice': {
      const baseGate = gatesFor(f, o, view);
      return { label: `${f.voiceType ? `${f.voices}-voice poly` : 'Mono voice'} on ch ${f.voiceChannel + 1} from jack ${view.outputs[f.start].jack}`,
        changes: addVoice(values, { output: f.start, channel: f.voiceChannel, type: f.voiceType, voices: f.voiceType ? f.voices : 1, outs: f.outs, baseGate }) };
    }
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
    case 'random':
      return { label: `Random ${f.srrPort === 'CV' ? 'CV' : f.srrPort.toLowerCase() + ' gates'} on ${where}`,
        changes: addRandom(values, hardware, o.index, f.srrPort, { rate: f.srrRate, length: f.srrLength, randomness: f.srrRandomness, scale: f.srrScale }).changes };
    case 'euclid':
      return { label: `Euclid ${f.pulses} of ${f.steps} on ${where}`,
        changes: addEuclid(values, hardware, o.index, { pulses: f.pulses, steps: f.steps, rotation: f.rotation, rate: f.rate }) };
  }
  return null;
}

// ---- the settings below the tiles, for the chosen kind

const field = (label, control, note) => h('label', { class: 'field' }, h('span', {}, label),
  Array.isArray(control) ? h('span', { class: 'with-unit' }, control) : control, note && h('small', {}, note));
const num = (f, key, min, max, step = 1, redraw = null) => h('input', {
  type: 'number', class: 'num', min, max, step, value: f[key],
  onchange: (e) => {
    const v = parseFloat(e.target.value);
    f[key] = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : f[key];
    e.target.value = f[key];
    redraw?.();
  },
});
const pick = (f, key, options, redraw) => h('select', {
  onchange: (e) => {
    const v = e.target.value;
    f[key] = typeof f[key] === 'number' ? +v : v === 'true' ? true : v === 'false' ? false : v;
    redraw?.();
  },
}, options.map(([value, label]) => h('option', { value: String(value), selected: String(value) === String(f[key]) }, label)));
const divisions = DIVISIONS.map(([p, name]) => [p, name]);

// Learn: the next knob turned on any controller connected to this computer sets channel and CC.
async function learnInto(f, values, redraw) {
  f.learning = true;
  f.learnNote = 'Turn a knob on a controller connected to this computer…';
  redraw();
  try {
    const r = await learnCc();
    const free = freeCcs(values.config, r.channel).some((c) => c.cc === r.cc);
    if (free) Object.assign(f, { channel: r.channel, cc: r.cc });
    f.learnNote = free ? `Learned CC ${r.cc} on ch ${r.channel + 1} from ${r.port}.` : `CC ${r.cc} on ch ${r.channel + 1} (from ${r.port}) is already used on that channel: pick another knob or set it by hand.`;
  } catch (e) {
    f.learnNote = /permission|SecurityError|NotAllowed/i.test(`${e.name} ${e.message}`) ? 'This browser didn’t allow MIDI access, so it can’t listen for a knob.' : `Nothing learned: ${e.message}.`;
  }
  f.learning = false;
  redraw();
}

function fieldsFor(f, values, o, redraw, view) {
  switch (f.kind) {
    case 'voice':
      return voiceFields(f, values, o, redraw, view);
    case 'trigger':
      return triggerFields(f, values, o, redraw, view);
    case 'fixed': {
      const [lo, hi] = RANGE_VOLTS[o.rangeIndex ?? 0];
      return [field('Voltage', [num(f, 'volts', lo, hi, 0.01), ' V'], `${o.range}. Kept in the preset, so each scene can have its own.`)];
    }
    case 'knob': {
      const ccs = freeCcs(values.config, f.channel);
      if (!ccs.some((c) => c.cc === f.cc)) f.cc = suggestCc(values.config, f.channel);
      return [
        field('MIDI channel', pick(f, 'channel', Array.from({ length: 16 }, (_, c) => [c, String(c + 1)]), redraw)),
        field('CC', [pick(f, 'cc', ccs.map((c) => [c.cc, `${c.cc}${c.fine ? ` (14-bit with ${c.cc + 32})` : ''}`])),
          h('button', { type: 'button', class: 'btn small', onclick: () => learnInto(f, values, redraw) }, f.learning ? 'Turn a knob…' : 'Learn')],
          f.learnNote ?? 'Only CCs nothing else uses on this channel. Below 32, the FH-2 takes CC n + 32 as the fine half, for 14-bit control. Learn: turn a knob on a controller connected to this computer.'),
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
    case 'random':
      return [
        o.gate ? field('Gives', pick(f, 'srrPort', [['Trigger', 'Trigger: when its first bit is set'], ['Change', 'Change: whenever its CV changes']])) : null,
        field('Steps at', pick(f, 'srrRate', divisions)),
        field('Length', [num(f, 'srrLength', 1, 32), ' steps'], 'Then it loops.'),
        field('Randomness', num(f, 'srrRandomness', 0, 127, 1, redraw), `${srrRandomnessText(f.srrRandomness)}; 127 locks the loop.`),
        o.gate ? null : field('Scale', pick(f, 'srrScale', SRR_SCALES.slice(0, 17).map((n, k) => [k, n]))),
      ];
  }
  return [];
}

// ---- a voice: mode, channel, outputs, where the gates go, and a preview of the jacks

function voiceFields(f, values, o, redraw, view) {
  const listeners = (ch) => view.channels[ch]?.listeners.map((l) => l.name) ?? [];
  const box = (k, name) => h('label', { class: 'check' }, h('input', {
    type: 'checkbox', checked: !!f.outs[k],
    onchange: (e) => { f.outs = { ...f.outs, [k]: e.target.checked ? 1 : 0 }; redraw(); },
  }), name);
  const start = gateStart(f, o, view);
  const plan = voicePlan(view, voiceSettings(f, o, gatesFor(f, o, view)));
  const elsewhere = plan.problems.length ? suggestStart(view, voiceSettings(f, o, gatesFor(f, o, view))) : null;
  return [
    field('Mode', pick(f, 'voiceType', [[0, 'Mono'], [1, 'Poly']], redraw)),
    f.voiceType ? field('Voices', num(f, 'voices', 2, 16, 1, redraw)) : null,
    field('MIDI channel', pick(f, 'voiceChannel', Array.from({ length: 16 }, (_, c) => [c, `${c + 1}${listeners(c).length ? ` · ${listeners(c).join(', ')}` : ''}`])),
      'Played from outside on this channel, or by a sequencer later.'),
    field('Gates and triggers', pick(f, 'gatesOnExpander', [[false, 'On CV jacks, after the pitch'], [true, start != null ? `On the gate expander, from ${view.outputs[start].jack}` : 'On the gate expander (no free run)']], redraw)),
    h('div', { class: 'field wide' }, h('span', {}, 'Each voice gets'), h('div', { class: 'checks' }, VOICE_OUTPUTS.map(([k, name]) => box(k, name)))),
    h('div', { class: 'field wide' }, h('span', {}, 'Shared by all voices'), h('div', { class: 'checks' }, SHARED_OUTPUTS.map(([k, name]) => box(k, name)))),
    h('div', { class: 'field wide plan' }, h('span', {}, 'Will use'),
      h('div', { class: 'checks' }, plan.ports.map((p) => h('span', { class: 'chip' + (p.taken.length || !p.present ? ' clash' : '') }, `${p.jack} · ${p.name}`))),
      plan.problems.map((x) => h('small', { class: 'warn' }, x.message)),
      f.gatesOnExpander && start == null ? h('small', { class: 'warn' }, 'No gate jacks in a row are free for these gates, so they stay on CV jacks.') : null,
      plan.ports.length ? null : h('small', { class: 'warn' }, 'Tick at least one output.'),
      plan.problems.length && elsewhere == null ? h('small', { class: 'warn' }, 'There’s no free run of CV jacks long enough for this voice. Fewer voices or outputs, or gates on the gate expander, may fit.') : null,
      elsewhere != null && elsewhere !== f.start ? h('button', { type: 'button', class: 'btn', onclick: () => { f.start = elsewhere; redraw(); } },
        `Start at ${view.outputs[elsewhere].jack} instead: it fits there`) : null,
      f.start !== o.index ? h('button', { type: 'button', class: 'btn', onclick: () => { f.start = o.index; redraw(); } }, `Back to jack ${o.jack}`) : null),
  ];
}

// ---- a trigger: channel, note, type, and the jacks it takes

function triggerFields(f, values, o, redraw, view) {
  const listeners = (ch) => view.channels[ch]?.listeners.map((l) => l.name) ?? [];
  const types = TRIGGER_TYPES.map((n, i) => [i, n]).slice(1).filter(([i]) => !(o.gate && LEVEL_TRIGGER_TYPES.has(i)));
  if (!types.some(([i]) => i === f.trigType)) f.trigType = 1;
  const problems = triggerProblems(f, o, view);
  const jacks = triggerJacks(f, o).map((x, k) => [x, `${view.outputs[x]?.jack ?? '—'} · ${k ? 'accent' : TRIGGER_TYPES[f.trigType].toLowerCase()}`]);
  return [
    field('MIDI channel', h('select', {
      onchange: (e) => { f.trigChannel = +e.target.value; f.trigNote = suggestNote(values.config, f.trigChannel); redraw(); },
    }, Array.from({ length: 16 }, (_, c) => h('option', { value: String(c), selected: c === f.trigChannel }, `${c + 1}${listeners(c).length ? ` · ${listeners(c).join(', ')}` : ''}`))),
    'Triggers on one channel show up together, as one source (a drum kit, say).'),
    field('Note', pick(f, 'trigNote', [[-1, 'Any note'], ...Array.from({ length: 128 }, (_, n) => [n, `${noteName(n)} (${n})`])]), 'The next free note on this channel is suggested.'),
    field('Type', pick(f, 'trigType', types, redraw), o.gate ? 'Velocity, envelope and level types need a CV jack: gate jacks are always 10 V.' : 'Accent types also use the next jack up, for hits at velocity 96 and above.'),
    f.trigType === 9 ? field('Envelope from', pick(f, 'envSet', Array.from({ length: 16 }, (_, i) => [i, `Voice ${i + 1}’s envelope settings`]))) : null,
    h('div', { class: 'field wide plan' }, h('span', {}, 'Will use'),
      h('div', { class: 'checks' }, jacks.map(([x, j]) => h('span', { class: 'chip' + (problems.some((p) => p.output === x) ? ' clash' : '') }, j))),
      problems.map((x) => h('small', { class: 'warn' }, x.message))),
  ];
}
