// Editors for a source's settings, shown in the inspector: the LFO with its waveform
// (artboard 3), the Euclid pattern, clocks and transport, MIDI knobs and stored levels.
// Every change goes through act.edit(label, changes), so it can be undone.

import { h } from '../../vendor/lilypad/js/dom.js';
import { numberInput, voltsInput, selectInput, slider, perScene } from './controls.js';
import { lfoSamples, euclidPattern, envelopePoints } from '../patch/shapes.js';
import { DIVISIONS, CLOCK_TYPES, LFO_RESET_TYPES, ALLOCATIONS, SUSTAIN, TRIGGER_TYPES, ARP_MODES, arpModeOf, lfoHz, hzToLfo, durationName, noteName } from '../patch/tables.js';
import { setLfo, setLfoRestart, setClock, setEuclid, setKnob, setDirectLevel, setConverter, setConverterPreset, cvPerVoice, fields, VOICE_OUTPUTS,
  setTrigger, setTriggerNote, setTriggerEnvSet, LEVEL_TRIGGER_TYPES } from '../patch/edit.js';
import { freeCcs, voicePlan } from '../patch/alloc.js';
import { learnCc } from './connect.js';

const SVG = 'http://www.w3.org/2000/svg';
const field = (label, ...control) => h('div', { class: 'erow' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, control));
const sfield = (label, ...control) => perScene(field(label, ...control)); // kept per scene (in the preset)
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
  const shape = (label, key) => sfield(label, slider(`${label} of the ${where}`, r[key], { min: 0, max: 127, show: (v) => `${Math.round((v / 127) * 100)}%`, preview: preview(key) },
    (v) => set(label, { [key]: v })));
  const sawShow = (v) => (v === 0 ? 'off' : v > 0 ? `rising ${Math.round((v / 63) * 100)}%` : `falling ${Math.round((-v / 64) * 100)}%`);

  const rows = [
    sfield('Timing', selectInput(`Timing of the ${where}`, r.lfoSynced ? 1 : 0, [[0, 'Free'], [1, 'Synced to the tempo']], (v) => set('Timing', { lfoSynced: v }))),
    r.lfoSynced
      ? sfield('One cycle', selectInput(`Cycle of the ${where}`, r.lfoTempoBase, divisionOptions(), (v) => set('Cycle', { lfoTempoBase: v })),
        ' × ', numberInput(`Cycle multiplier of the ${where}`, r.lfoTempoMultiplier, { min: 1, max: 127 }, (v) => set('Cycle', { lfoTempoMultiplier: v })))
      : sfield('Rate', numberInput(`Rate of the ${where}`, lfoHz(r.lfoSpeed).toFixed(2), { min: 0.1, max: 10, step: 0.01 }, (v) => set('Rate', { lfoSpeed: hzToLfo(v) })), ' Hz'),
    sfield('Depth', slider(`Depth of the ${where}`, Math.round((r.lfoLevel / 16383) * 100), { min: 0, max: 100, show: (v) => `${v}%`, preview: preview('lfoLevel', (v) => Math.round((v / 100) * 16383)) },
      (v) => set('Depth', { lfoLevel: Math.round((v / 100) * 16383) }))),
  ];
  const shapes = [
    shape('Sine', 'lfoSine'),
    shape('Triangle', 'lfoTriangle'),
    shape('Square', 'lfoSquare'),
    sfield('Pulse width', slider(`Pulse width of the ${where}`, r.lfoPulseWidth, { min: 0, max: 127, show: (v) => `${Math.round((v / 127) * 100)}%`, preview: preview('lfoPulseWidth') },
      (v) => set('Pulse width', { lfoPulseWidth: v }))),
    sfield('Saw', slider(`Saw of the ${where}`, r.lfoSaw - 64, { min: -64, max: 63, show: sawShow, preview: preview('lfoSaw', (v) => v + 64) },
      (v) => set('Saw', { lfoSaw: v + 64 }))),
    shape('Random', 'lfoRandom'),
    shape('Noise', 'lfoNoise'),
  ];
  const more = [
    sfield('Phase', slider(`Phase of the ${where}`, r.lfoPhase, { min: 0, max: 127, show: (v) => `${Math.round((v / 128) * 360)}°`, preview: preview('lfoPhase') },
      (v) => set('Phase', { lfoPhase: v }))),
    sfield('Fade in', slider(`Fade in of the ${where}`, r.lfoFade, { min: 0, max: 127, show: (v) => (v ? String(v) : 'off') }, (v) => set('Fade in', { lfoFade: v }))),
    field('Restart', restartSelect(view, o, act)),
  ];
  const notes = [];
  if (r.lfoSynced && o.lfoReset?.typeIndex === 6) {
    notes.push(h('p', { class: 'note' }, 'Synced and restarted by a clock: may jump twice per cycle (check 14).'));
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
  if (!p) return [h('p', { class: 'note' }, 'No preset loaded.')];
  const set = (what, obj) => act.edit(`${what} of ${s.name}`, setEuclid(s.index, obj));
  const num = (label, key, min, max) => sfield(label, numberInput(`${label} of ${s.name}`, p[key], { min, max }, (v) => set(label, { [key]: v })));
  return [
    stepsSvg(euclidPattern(p.pulses, p.steps, p.rotation), color),
    h('div', { class: 'erows' },
      num('Pulses', 'pulses', 0, 32),
      num('Steps', 'steps', 1, 32),
      num('Rotation', 'rotation', 0, 32),
      sfield('Step rate', selectInput(`Step rate of ${s.name}`, p.ratePulses, divisionOptions([[0, 'External clock']]), (v) => set('Step rate', { rate: v }))),
      num('Gate length', 'gate', 0, 127),
      num('Accent rate', 'accent', 0, 127),
      sfield('Reset', numberInput(`Reset of ${s.name}`, p.reset, { min: 0, max: 32 }, (v) => set('Reset', { reset: v })), ' beats (0 = never)')),
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
    const learn = async () => {
      act.status('Turn a knob on a controller connected to this computer…');
      try {
        const r = await learnCc();
        const taken = r.channel !== p.channel || r.cc !== p.cc ? !freeCcs(config, r.channel).some((c) => c.cc === r.cc) : false;
        if (taken) return act.status(`CC ${r.cc} on ch ${r.channel + 1} is already used on that channel`, true);
        act.edit(`The knob on ${p.jack} learned CC ${r.cc} on ch ${r.channel + 1} (${r.port})`, setKnob(p.slot, { channel: r.channel, cc: r.cc, relative: p.relative }));
      } catch (e) {
        act.status(/permission|SecurityError|NotAllowed/i.test(`${e.name} ${e.message}`) ? 'This browser didn’t allow MIDI access, so it can’t listen for a knob.' : `Nothing learned: ${e.message}`, true);
      }
    };
    return h('div', { class: 'subbox' }, h('h4', {}, `${p.jack}`), h('div', { class: 'erows' },
      field('Channel', selectInput(`Channel of the knob on ${p.jack}`, p.channel, Array.from({ length: 16 }, (_, c) => [c, String(c + 1)]), (v) => {
        const free = freeCcs(config, v);
        const cc = free.some((c) => c.cc === p.cc) ? p.cc : (free.find((c) => c.fine) ?? free[0])?.cc;
        if (cc != null) set('Channel', { channel: v, cc });
      })),
      field('CC', selectInput(`CC of the knob on ${p.jack}`, p.cc, ccs.map((c) => [c.cc, `${c.cc}${c.fine ? ' (14-bit)' : ''}`]), (v) => set('CC', { cc: v })),
        h('button', { type: 'button', class: 'btn small', onclick: learn, title: 'Turn a knob on a controller connected to this computer' }, 'Learn')),
      field('Relative', selectInput(`Relative knob on ${p.jack}`, p.relative ? 1 : 0, [[0, 'No: absolute'], [1, 'Yes: endless encoder']], (v) => set('Relative', { relative: !!v }))),
      sfield('Now at', voltsInput(`Level of ${p.jack}`, view.outputs[p.output].directLevel ?? 0, view.outputs[p.output].rangeIndex,
        (v) => act.edit(`Level of ${p.jack}`, setDirectLevel(p.output, v))))));
  });
}

export function levelEditor(view, s, act) {
  return h('div', { class: 'erows' }, s.ports.map((p) => {
    const o = view.outputs[p.output];
    return sfield(p.jack, voltsInput(`Level of ${p.jack}`, o.directLevel, o.rangeIndex, (v) => act.edit(`Level of ${p.jack}`, setDirectLevel(p.output, v))));
  }));
}

// ---- voices (MIDI/CV converters)

const NOTES = Array.from({ length: 128 }, (_, n) => [n, `${noteName(n)} (${n})`]);
const pct = (v) => `${Math.round((v / 127) * 100)}%`;
const bipolar = (v) => `${v >= 64 ? '+' : '−'}${Math.round((Math.abs(v - 64) / 63) * 100)}%`;

function envelopeSvg(env, color) {
  const svg = document.createElementNS(SVG, 'svg');
  const h0 = 90;
  svg.setAttribute('viewBox', `0 0 ${W} ${h0}`);
  svg.setAttribute('class', 'wave');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'The envelope of one note: attack, decay, sustain, release');
  const draw = (e) => {
    const pts = envelopePoints(e);
    const base = e.depth >= 64 ? h0 - 8 : 8;
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${(x * W).toFixed(1)} ${(base - y * (h0 - 16)).toFixed(1)}`).join(' ');
    svg.innerHTML = `<path d="M 0 ${base} H ${W}" class="centre"/><path class="trace" stroke="${color}" d="${d}"/>`;
  };
  draw(env);
  svg.redraw = draw;
  return svg;
}

export function voiceEditor(view, s, act, color) {
  const cv = s.raw;
  const set = (what, obj) => act.edit(`${what} of ${s.name}`, setConverter(s.index, obj));
  const parts = [];
  // the gap between voices follows the outputs while it is "back to back"
  const autoStride = !cv.stride || cv.stride === cvPerVoice(cv);
  const relayout = (obj) => {
    const next = { ...cv, ...obj };
    return autoStride ? { ...obj, stride: cvPerVoice(next) } : obj; // kept up to date in mono too, for when it turns poly
  };

  // mode and voices
  const mode = [field('Mode', selectInput(`Mode of ${s.name}`, cv.type, [[0, 'Mono'], [1, 'Poly'], [2, 'MPE']], (v) => set('Mode', relayout({ type: v, voices: v ? Math.max(2, cv.voices) : cv.voices }))))];
  if (cv.type) {
    mode.push(
      field('Voices', numberInput(`Voices of ${s.name}`, cv.voices, { min: 1, max: 16 }, (v) => set('Voices', { voices: v }))),
      field('Allocation', selectInput(`Allocation of ${s.name}`, cv.allocation, ALLOCATIONS.map((n, i) => [i, n]), (v) => set('Allocation', { allocation: v }))),
      field('Steal voices', selectInput(`Voice stealing of ${s.name}`, cv.noStealing, [[0, 'Yes'], [1, 'No: ignore extra notes']], (v) => set('Voice stealing', { noStealing: v }))));
  }
  parts.push(h('div', { class: 'erows' }, mode));

  // what it listens to
  const listens = [
    field(cv.type === 2 ? 'Global channel' : 'MIDI channel', selectInput(`Channel of ${s.name}`, cv.channel, Array.from({ length: 16 }, (_, c) => [c, String(c + 1)]), (v) => set('Channel', { channel: v }))),
  ];
  if (cv.type === 2) listens.push(field('Last channel', selectInput(`Last MPE channel of ${s.name}`, cv.lastMpeChannel, Array.from({ length: 16 }, (_, c) => [c, String(c + 1)]), (v) => set('Last MPE channel', { lastMpeChannel: v }))));
  listens.push(
    field('Lowest note', selectInput(`Lowest note of ${s.name}`, cv.minNote, NOTES, (v) => set('Lowest note', { minNote: v }))),
    field('Highest note', selectInput(`Highest note of ${s.name}`, cv.maxNote, NOTES, (v) => set('Highest note', { maxNote: v }))));
  const others = (view.channels[cv.channel]?.listeners ?? []).filter((l) => l.name !== s.name && !l.name.startsWith(`${s.name} `)).map((l) => l.name);
  parts.push(h('h4', {}, 'Listens to'), h('div', { class: 'erows' }, listens),
    others.length ? h('p', { class: 'note' }, `Also on this channel: ${[...new Set(others)].join(', ')}. Different note ranges make a keyboard split.`) : null);

  // outputs and where they go
  const toggle = (k, name) => h('label', { class: 'check' }, h('input', {
    type: 'checkbox', checked: !!cv[k], 'data-key': `${s.name} ${k}`,
    onchange: (e) => set(`${name} output`, relayout({ [k]: e.target.checked ? 1 : 0 })),
  }), name);
  const triple = (k, name) => selectInput(`${name} output of ${s.name}`, cv[k], [[0, `${name}: off`], [1, name], [2, `${name}, inverted`]], (v) => set(`${name} output`, relayout({ [k]: v })));
  const cvJacks = view.outputs.slice(0, 64).filter((o) => o.present).map((o) => [o.index, o.jack]);
  const gateJacks = view.outputs.slice(64).filter((o) => o.present).map((o) => [o.index, `gate expander, from ${o.jack}`]);
  parts.push(h('h4', {}, 'Outputs'),
    h('div', { class: 'checks' }, VOICE_OUTPUTS.filter(([k]) => k !== 'velocityOut' && k !== 'releaseVelocityOut').map(([k, n]) => toggle(k, n))),
    h('div', { class: 'checks' }, triple('velocityOut', 'Velocity'), triple('releaseVelocityOut', 'Release velocity')),
    h('div', { class: 'checks' }, toggle('aftertouchOut', 'Aftertouch'), toggle('paraGateOut', 'Para gate'),
      selectInput(`Bend output of ${s.name}`, cv.bendOut, [[0, 'Bend: off'], [1, 'Bend'], [2, 'Bend up and down']], (v) => set('Bend output', { bendOut: v }))),
    h('div', { class: 'erows' },
      field('Starts at', selectInput(`Start jack of ${s.name}`, cv.baseOutput, cvJacks, (v) => set('Start jack', { baseOutput: v }))),
      field('Gates go to', selectInput(`Gates of ${s.name}`, cv.baseGate >= 64 ? cv.baseGate : 0, [[0, 'CV jacks, after the pitch'], ...gateJacks],
        (v) => set('Gates', relayout({ baseGate: v })))),
      cv.type ? field('Gap', selectInput(`Gap between voices of ${s.name}`, autoStride ? 0 : cv.stride, [[0, `Back to back (${cvPerVoice(cv)})`], ...Array.from({ length: 16 }, (_, i) => [i + 1, `${i + 1} jacks`])],
        (v) => set('Gap between voices', { stride: v || cvPerVoice(cv) }))) : null));
  const plan = voicePlan(view, cv, s.index);
  const byVoice = new Map();
  for (const p of plan.ports) {
    const k = p.voice == null ? 'Shared' : `Voice ${p.voice + 1}`;
    if (!byVoice.has(k)) byVoice.set(k, []);
    byVoice.get(k).push(p);
  }
  parts.push(h('div', { class: 'layout' }, [...byVoice].map(([k, ps]) => h('div', { class: 'layout-row' }, h('span', { class: 'k' }, cv.type ? k : ''),
    h('span', { class: 'checks' }, ps.map((p) => h('span', { class: 'chip' + (p.taken.length || !p.present ? ' clash' : ''), style: `--src:${color}` }, `${p.jack} ${p.role.replace(/ \(inverted\)$/, ' inv.')}`)))))),
  plan.problems.map((x) => h('p', { class: 'problem' }, x.message)));

  // pitch and switches (config), performance (preset)
  const pf = s.performance;
  const pset = (what, obj) => act.edit(`${what} of ${s.name}`, setConverterPreset(s.index, obj));
  parts.push(h('h4', {}, 'Pitch'), h('div', { class: 'erows' },
    field('Bend range', numberInput(`Bend range of ${s.name}`, cv.bendRange, { min: 0, max: 48 }, (v) => set('Bend range', { bendRange: v })), ' semitones'),
    field('Bend down', selectInput(`Bend down of ${s.name}`, cv.bendDown, [[0, 'Same as up'], ...Array.from({ length: 48 }, (_, i) => [i + 2, `${i + 1} semitones`])], (v) => set('Bend down', { bendDown: v }))),
    pf && sfield('Transpose', numberInput(`Transpose of ${s.name}`, pf.transpose - 64, { min: -64, max: 63 }, (v) => pset('Transpose', { transpose: v + 64 })), ' semitones'),
    pf && sfield('Glide', slider(`Glide of ${s.name}`, pf.portamento, { min: 0, max: 127, show: (v) => (v ? String(v) : 'off') }, (v) => pset('Glide', { portamento: v }))),
    field('Sustain pedal', selectInput(`Sustain of ${s.name}`, cv.sustain, SUSTAIN.map((n, i) => [i, n]), (v) => set('Sustain pedal', { sustain: v }))),
    field('Legato gate', selectInput(`Interrupt gate of ${s.name}`, cv.interruptGate, [[0, 'Stays high'], [1, 'Short dip on legato notes']], (v) => set('Legato gate', { interruptGate: v }))),
    cv.type === 0 && field('Returning note', selectInput(`Mono retrigger of ${s.name}`, cv.monoRetrigger, [[0, 'Fires trigger and envelope'], [1, 'Doesn’t fire them']], (v) => set('Returning note', { monoRetrigger: v }))),
    cv.type === 0 && field('Legato velocity', selectInput('Legato velocity (all mono voices)', act.values().config.legatoVelocity, [[0, 'Each note’s own'], [1, 'First note of a phrase']],
      (v) => act.edit('Legato velocity (all mono voices)', fields('config', [], { legatoVelocity: v }))))));
  const unison = cv.allocation === 2 || cv.allocation === 3;
  if (cv.type !== 0 && !unison) parts.push(h('p', { class: 'note' }, 'Glide works on mono voices and in Unison only.'));

  // the arpeggiator: its settings live in the preset, its clock source and MIDI out in the config
  if (pf) {
    const a = pf.arpRaw;
    const rows = [sfield('Mode', selectInput(`Arp mode of ${s.name}`, arpModeOf(a.mode)[0], ARP_MODES, (v) => pset('Arp mode', { arpMode: v })))];
    if (a.mode > 10) {
      const out = (k, name) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!cv[k], 'data-key': `${s.name} ${k}`,
        onchange: (e) => set(`Arp MIDI out to ${name}`, { [k]: e.target.checked ? 1 : 0 }) }), name);
      rows.push(
        sfield('Range', selectInput(`Arp range of ${s.name}`, Math.max(1, Math.min(3, a.range)), [[1, '1 octave'], [2, '2 octaves'], [3, '3 octaves']], (v) => pset('Arp range', { arpRange: v }))),
        sfield('Rate', selectInput(`Arp rate of ${s.name}`, a.rate, [[0, 'Ext: its clock source'], ...DIVISIONS], (v) => pset('Arp rate', { arpRate: v }))),
        a.rate === 0 ? field('Clock source', selectInput(`Arp clock source of ${s.name}`, cv.arpClock, [[0, 'External clock'], ...Array.from({ length: 16 }, (_, i) => [i + 1, `Euclid ${i + 1}`])],
          (v) => set('Arp clock source', { arpClock: v }))) : null,
        sfield('Gate', slider(`Arp gate of ${s.name}`, a.gate, { min: 0, max: 127, show: (v) => (v ? `${Math.round((v / 128) * 100)}%` : 'trigger') }, (v) => pset('Arp gate', { arpGate: v }))),
        sfield('Latch', selectInput(`Arp latch of ${s.name}`, a.latch ? 1 : 0, [[0, 'Off'], [1, 'On: holds until a new chord']], (v) => pset('Arp latch', { arpLatch: v }))),
        sfield('Reset', numberInput(`Arp reset of ${s.name}`, a.reset, { min: 0, max: 127 }, (v) => pset('Arp reset', { arpReset: v })), ' quarter notes (0 = never)'),
        field('MIDI out', selectInput(`Arp MIDI channel of ${s.name}`, cv.arpChannel, Array.from({ length: 16 }, (_, c) => [c, `ch ${c + 1}`]), (v) => set('Arp MIDI channel', { arpChannel: v }))),
        h('div', { class: 'checks' }, out('arpToUsbC', 'USB C'), out('arpToUsbA', 'USB A'), out('arpToDin', 'DIN')));
    }
    parts.push(h('h4', {}, 'Arpeggiator'), h('div', { class: 'erows' }, rows),
      null);
  }

  // the envelope
  if (pf) {
    const e = pf.envelope;
    const svg = envelopeSvg(e, color);
    const preview = (key) => (v) => svg.redraw({ ...e, [key]: v });
    const env = (label, key, field2, show = pct) => sfield(label, slider(`${label} of ${s.name}`, e[key], { min: 0, max: 127, show, preview: preview(key) }, (v) => pset(label, { [field2]: v })));
    parts.push(h('h4', {}, 'Envelope'), h('div', { class: 'wave-box' }, svg, h('span', { class: 'wave-cap' }, cv.envelopeOut ? 'Shape only, times approximate' : 'Turn on the Envelope output to use it')),
      h('div', { class: 'erows' },
        env('Attack', 'attack', 'envAttack', String),
        env('Decay', 'decay', 'envDecay', String),
        env('Sustain', 'sustain', 'envSustain'),
        env('Release', 'release', 'envRelease', String),
        env('Depth', 'depth', 'envDepth', bipolar),
        env('Velocity depth', 'velocityDepth', 'envVelocityDepth', bipolar),
        env('Attack shape', 'attackShape', 'envAttackShape', (v) => (v === 64 ? 'straight' : String(v - 64))),
        env('Decay shape', 'decayShape', 'envDecayShape', (v) => (v === 64 ? 'straight' : String(v - 64))),
        env('Release shape', 'releaseShape', 'envReleaseShape', (v) => (v === 64 ? 'straight' : String(v - 64))),
        sfield('Time range', numberInput(`Envelope time range of ${s.name}`, e.range, { min: 0, max: 127 }, (v) => pset('Envelope time range', { envRange: v }))),
        field('Each note', selectInput(`Envelope start of ${s.name}`, cv.envZeroStart, [[0, 'Rises from where it is'], [1, 'Starts from zero']], (v) => set('Envelope start', { envZeroStart: v })))));
  } else {
    parts.push(h('p', { class: 'note' }, 'No preset loaded.'));
  }
  return parts;
}

// ---- triggers (one source per MIDI channel)

export function triggerEditor(view, s, act) {
  const config = act.values().config;
  const triggers = s.ports.filter((p) => !p.accent);
  const kit = [
    field('MIDI channel', selectInput(`Channel of ${s.name}`, s.channel, Array.from({ length: 16 }, (_, c) => [c, String(c + 1)]),
      (v) => act.edit(`Channel of ${s.name}: ${v + 1}`, triggers.flatMap((p) => setTrigger(p.trigger, { channel: v }))))),
    field('Trigger length', numberInput('Trigger length (all triggers)', config.triggerLength, { min: 1, max: 100 },
      (v) => act.edit(`Trigger length (all triggers): ${v} ms`, fields('config', [], { triggerLength: v }))), ' ms, all triggers'),
  ];
  const boxes = triggers.map((p) => {
    const name = `the trigger on ${p.jack}`;
    const gate = view.outputs[p.output]?.gate;
    const types = TRIGGER_TYPES.map((n, i) => [i, n]).slice(1).filter(([i]) => !(gate && LEVEL_TRIGGER_TYPES.has(i)) || i === p.typeIndex);
    const accent = s.ports.find((x) => x.accent && x.trigger === p.trigger);
    return h('div', { class: 'subbox' }, h('h4', {}, `${p.jack}${accent ? ` + ${accent.jack} (accent)` : ''}`), h('div', { class: 'erows' },
      field('Note', selectInput(`Note of ${name}`, p.note ?? -1, [[-1, 'Any note'], ...NOTES], (v) => act.edit(`Note of ${name}`, setTriggerNote(p.trigger, v < 0 ? null : v)))),
      field('Type', selectInput(`Type of ${name}`, p.typeIndex, types, (v) => act.edit(`Type of ${name}: ${TRIGGER_TYPES[v]}`, setTrigger(p.trigger, { type: v })))),
      p.typeIndex === 9 ? field('Envelope from', selectInput(`Envelope of ${name}`, p.envSet, Array.from({ length: 16 }, (_, i) => [i, `Voice ${i + 1}’s settings`]),
        (v) => act.edit(`Envelope of ${name}`, setTriggerEnvSet(p.trigger, v)))) : null));
  });
  return [h('div', { class: 'erows' }, kit), boxes];
}
