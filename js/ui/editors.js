// Editors for a source's settings, shown in the inspector: the LFO with its waveform
// (artboard 3), the Euclid pattern, clocks and transport, MIDI knobs and stored levels.
// Every change goes through act.edit(label, changes), so it can be undone.

import { h } from '../../vendor/lilypad/js/dom.js';
import { numberInput, voltsInput, selectInput, slider } from './controls.js';
import { lfoSamples, euclidPattern } from '../patch/shapes.js';
import { DIVISIONS, CLOCK_TYPES, LFO_RESET_TYPES, lfoHz, hzToLfo, durationName } from '../patch/tables.js';
import { setLfo, setLfoRestart, setClock, setEuclid, setKnob, setDirectLevel } from '../patch/edit.js';
import { freeCcs } from '../patch/alloc.js';

const SVG = 'http://www.w3.org/2000/svg';
const field = (label, ...control) => h('div', { class: 'erow' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, control));
const divisionOptions = (extra = []) => [...extra, ...DIVISIONS.map(([p, name]) => [p, name])];

// ---- the LFO

const W = 360;
const H = 110;

function wavePath(samples) {
  return samples.map((v, i) => `${i ? 'L' : 'M'} ${((i / (samples.length - 1)) * W).toFixed(1)} ${(H / 2 - v * (H / 2 - 8)).toFixed(1)}`).join(' ');
}

function waveSvg(samples, color) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'wave');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Two cycles of the LFO, as mixed from its shapes');
  svg.innerHTML = `<path d="M 0 ${H / 2} H ${W}" class="centre"/><path class="trace" stroke="${color}"/>`;
  svg.lastChild.setAttribute('d', wavePath(samples));
  return svg;
}

// `o` is a derive() output; its LFO may be on its own or on top of another source.
export function lfoEditor(view, o, act, color) {
  const r = o.lfoRaw;
  const where = `LFO on jack ${o.jack}`;
  const set = (what, obj) => act.edit(`${what} of the ${where}`, setLfo(o.index, obj));
  const svg = waveSvg(lfoSamples(r), color);
  const preview = (key, map = (v) => v) => (v) => svg.lastChild.setAttribute('d', wavePath(lfoSamples({ ...r, [key]: map(v) })));
  const shape = (label, key) => field(label, slider(`${label} of the ${where}`, r[key], { min: 0, max: 127, show: (v) => `${Math.round((v / 127) * 100)}%`, preview: preview(key) },
    (v) => set(label, { [key]: v })));
  const sawShow = (v) => (v === 0 ? 'off' : v > 0 ? `rising ${Math.round((v / 63) * 100)}%` : `falling ${Math.round((-v / 64) * 100)}%`);

  const rows = [
    field('Timing', selectInput(`Timing of the ${where}`, r.lfoSynced ? 1 : 0, [[0, 'Free'], [1, 'Synced to the tempo']], (v) => set('Timing', { lfoSynced: v }))),
    r.lfoSynced
      ? field('One cycle', selectInput(`Cycle of the ${where}`, r.lfoTempoBase, divisionOptions(), (v) => set('Cycle', { lfoTempoBase: v })),
        ' × ', numberInput(`Cycle multiplier of the ${where}`, r.lfoTempoMultiplier, { min: 1, max: 127 }, (v) => set('Cycle', { lfoTempoMultiplier: v })))
      : field('Rate', numberInput(`Rate of the ${where}`, lfoHz(r.lfoSpeed).toFixed(2), { min: 0.1, max: 10, step: 0.01 }, (v) => set('Rate', { lfoSpeed: hzToLfo(v) })), ' Hz'),
    field('Depth', slider(`Depth of the ${where}`, Math.round((r.lfoLevel / 16383) * 100), { min: 0, max: 100, show: (v) => `${v}%`, preview: preview('lfoLevel', (v) => Math.round((v / 100) * 16383)) },
      (v) => set('Depth', { lfoLevel: Math.round((v / 100) * 16383) }))),
  ];
  const shapes = [
    shape('Sine', 'lfoSine'),
    shape('Triangle', 'lfoTriangle'),
    shape('Square', 'lfoSquare'),
    field('Pulse width', slider(`Pulse width of the ${where}`, r.lfoPulseWidth, { min: 0, max: 127, show: (v) => `${Math.round((v / 127) * 100)}%`, preview: preview('lfoPulseWidth') },
      (v) => set('Pulse width', { lfoPulseWidth: v }))),
    field('Saw', slider(`Saw of the ${where}`, r.lfoSaw - 64, { min: -64, max: 63, show: sawShow, preview: preview('lfoSaw', (v) => v + 64) },
      (v) => set('Saw', { lfoSaw: v + 64 }))),
    shape('Random', 'lfoRandom'),
    shape('Noise', 'lfoNoise'),
  ];
  const more = [
    field('Phase', slider(`Phase of the ${where}`, r.lfoPhase, { min: 0, max: 127, show: (v) => `${Math.round((v / 128) * 360)}°`, preview: preview('lfoPhase') },
      (v) => set('Phase', { lfoPhase: v }))),
    field('Fade in', slider(`Fade in of the ${where}`, r.lfoFade, { min: 0, max: 127, show: (v) => (v ? String(v) : 'off') }, (v) => set('Fade in', { lfoFade: v }))),
    field('Restart', restartSelect(view, o, act)),
  ];
  const notes = [];
  if (r.lfoSynced && o.lfoReset?.typeIndex === 6) {
    notes.push(h('p', { class: 'note' }, 'A synced LFO restarted by a clock at its own rate may jump twice per cycle: once at the end of its cycle and again at the restart (hardware check 14).'));
  }
  return [h('div', { class: 'wave-box' }, svg, h('span', { class: 'wave-cap' }, 'Two cycles, approximate')),
    h('div', { class: 'erows' }, rows), h('h4', {}, 'Shape mix'), h('div', { class: 'erows' }, shapes), h('div', { class: 'erows' }, more), notes];
}

// What restarts the LFO: never, a clock or a Euclid pattern of this patch, or what the config
// already says (a CC, a note…), which is kept as it is.
function restartSelect(view, o, act) {
  const now = o.lfoReset;
  const key = (t, ch, n) => `${t}:${ch}:${n}`;
  const options = [[key(0, 0, 0), 'Never (free running)']];
  const clocks = view.sources.find((s) => s.id === 'clocks');
  for (const p of clocks?.ports ?? []) options.push([key(6, 0, p.clock), `On ${p.name} (clock ${p.clock + 1}, ${p.jack})`]);
  for (const s of view.sources.filter((x) => x.kind === 'euclid')) options.push([key(7, 0, s.index), `On ${s.name}’s pulses`]);
  const current = now ? key(now.typeIndex, now.channel, now.number) : key(0, 0, 0);
  if (!options.some(([k]) => k === current)) {
    const what = LFO_RESET_TYPES[now.typeIndex] ?? `type ${now.typeIndex}`;
    options.push([current, `${what}${now.typeIndex <= 3 ? `, ch ${now.channel + 1}` : ''}${now.typeIndex === 1 || now.typeIndex === 2 ? ` · ${now.number}` : ''} (as set)`]);
  }
  return selectInput(`Restart of the LFO on jack ${o.jack}`, current, options, (k) => {
    const [type, channel, number] = k.split(':').map(Number);
    act.edit(`Restart of the LFO on jack ${o.jack}`, setLfoRestart(o.index, { type, channel, number }));
  });
}

// ---- Euclid

function stepsSvg(pattern, color) {
  const svg = document.createElementNS(SVG, 'svg');
  const n = pattern.length || 1;
  const cols = Math.min(n, 16);
  const rows = Math.ceil(n / 16);
  const step = W / 16;
  svg.setAttribute('viewBox', `0 0 ${W} ${rows * step}`);
  svg.setAttribute('class', 'steps');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Pattern: ${pattern.map((x) => (x ? 'x' : '.')).join('')}`);
  svg.innerHTML = pattern.map((on, i) => {
    const cx = (i % cols) * step + step / 2;
    const cy = Math.floor(i / cols) * step + step / 2;
    return `<circle cx="${cx}" cy="${cy}" r="${step / 2 - 4}" class="${on ? 'on' : 'off'}"${on ? ` fill="${color}"` : ''}/>`;
  }).join('');
  return svg;
}

export function euclidEditor(s, act, color) {
  const p = s.pattern;
  if (!p) return [h('p', { class: 'note' }, 'The pattern lives in the preset: open or pull one to edit it.')];
  const set = (what, obj) => act.edit(`${what} of ${s.name}`, setEuclid(s.index, obj));
  const num = (label, key, min, max) => field(label, numberInput(`${label} of ${s.name}`, p[key], { min, max }, (v) => set(label, { [key]: v })));
  return [
    stepsSvg(euclidPattern(p.pulses, p.steps, p.rotation), color),
    h('div', { class: 'erows' },
      num('Pulses', 'pulses', 0, 32),
      num('Steps', 'steps', 1, 32),
      num('Rotation', 'rotation', 0, 32),
      field('Step rate', selectInput(`Step rate of ${s.name}`, p.ratePulses, divisionOptions([[0, 'External clock']]), (v) => set('Step rate', { rate: v }))),
      num('Gate length', 'gate', 0, 127),
      num('Accent rate', 'accent', 0, 127),
      field('Reset', numberInput(`Reset of ${s.name}`, p.reset, { min: 0, max: 32 }, (v) => set('Reset', { reset: v })), ' beats (0 = never)')),
  ];
}

// ---- clocks and transport

const TYPE_OPTIONS = CLOCK_TYPES.map((n, i) => [i, n]).slice(1);

export function clockEditor(s, act) {
  return s.ports.map((p) => {
    const name = `clock ${p.clock + 1}`;
    const set = (what, obj) => act.edit(`${what} of ${name} (${p.jack})`, setClock(p.clock, obj));
    const rows = [field('Signal', selectInput(`Signal of ${name}`, p.type, TYPE_OPTIONS, (v) => set('Signal', { type: v })))];
    if (p.type === 1) {
      rows.push(
        field('Every', selectInput(`Rate of ${name}`, p.base, divisionOptions(), (v) => set('Rate', { base: v })),
          ' × ', numberInput(`Multiplier of ${name}`, p.multiplier, { min: 1, max: 127 }, (v) => set('Rate', { multiplier: v }))),
        field('Pulse', numberInput(`Pulse length of ${name}`, p.length, { min: 0, max: 127 }, (v) => set('Pulse length', { length: v })), ' ms (0 = square)'),
        field('Shift', numberInput(`Shift of ${name}`, p.shift, { min: 0, max: 127 }, (v) => set('Shift', { shift: v })), ` pulses${p.shift ? ` (${durationName(p.shift)})` : ''}`),
      );
    } else {
      rows.push(field('Pulse', numberInput(`Pulse length of ${name}`, p.length, { min: 0, max: 127 }, (v) => set('Pulse length', { length: v })), ' ms'));
    }
    return h('div', { class: 'subbox' }, h('h4', {}, `${p.name} → ${p.jack}`), h('div', { class: 'erows' }, rows));
  });
}

// ---- MIDI knobs and stored levels

export function knobEditor(view, s, act) {
  const config = act.values().config;
  return s.ports.map((p) => {
    const set = (what, obj) => act.edit(`${what} of the knob on ${p.jack}`, setKnob(p.slot, { channel: p.channel, cc: p.cc, relative: p.relative, ...obj }));
    const ccs = [{ cc: p.cc, fine: false }, ...freeCcs(config, p.channel)].sort((a, b) => a.cc - b.cc);
    return h('div', { class: 'subbox' }, h('h4', {}, `${p.jack}`), h('div', { class: 'erows' },
      field('Channel', selectInput(`Channel of the knob on ${p.jack}`, p.channel, Array.from({ length: 16 }, (_, c) => [c, String(c + 1)]), (v) => {
        const free = freeCcs(config, v);
        const cc = free.some((c) => c.cc === p.cc) ? p.cc : (free.find((c) => c.fine) ?? free[0])?.cc;
        if (cc != null) set('Channel', { channel: v, cc });
      })),
      field('CC', selectInput(`CC of the knob on ${p.jack}`, p.cc, ccs.map((c) => [c.cc, `${c.cc}${c.fine ? ' (14-bit)' : ''}`]), (v) => set('CC', { cc: v }))),
      field('Relative', selectInput(`Relative knob on ${p.jack}`, p.relative ? 1 : 0, [[0, 'No: absolute'], [1, 'Yes: endless encoder']], (v) => set('Relative', { relative: !!v }))),
      field('Now at', voltsInput(`Level of ${p.jack}`, view.outputs[p.output].directLevel ?? 0, view.outputs[p.output].rangeIndex,
        (v) => act.edit(`Level of ${p.jack}`, setDirectLevel(p.output, v))))));
  });
}

export function levelEditor(view, s, act) {
  return h('div', { class: 'erows' }, s.ports.map((p) => {
    const o = view.outputs[p.output];
    return field(p.jack, voltsInput(`Level of ${p.jack}`, o.directLevel, o.rangeIndex, (v) => act.edit(`Level of ${p.jack}`, setDirectLevel(p.output, v))));
  }));
}
