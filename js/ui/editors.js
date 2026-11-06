// Editors for a source's settings, shown in the inspector: the LFO with its waveform
// (artboard 3), the Euclid pattern, clocks and transport, MIDI knobs and stored levels.
// Every change goes through act.edit(label, changes), so it can be undone.

import { TUNINGS, SLOTS, scalaFiles, slotLabel, voiceTuning, setTuning, scalaMismatch } from '../patch/scala.js';
import { h } from '../../vendor/lilypad/js/dom.js';
import { numberInput, voltsInput, selectInput, slider, perScene, ec4Label } from './controls.js';
import { lfoSamples, euclidPattern, envelopePoints } from '../patch/shapes.js';
import { DIVISIONS, CLOCK_TYPES, LFO_RESET_TYPES, ALLOCATIONS, SUSTAIN, TRIGGER_TYPES, ARP_MODES, RANGE_VOLTS, arpModeOf, lfoHz, hzToLfo, durationName, noteName,
  levelToVolts, LFO_RESET_CLOCK, LFO_RESET_EUCLID, ENVELOPE_TRIGGER, SRR_DIRECTIONS, SRR_SCALES, SRR_STOP, srrUsesMidiNotes, srrKeyText,
  srrRandomnessText } from '../patch/tables.js';
import { setLfo, setLfoRestart, setClock, setEuclid, setKnob, setDirectLevel, setConverter, setConverterPreset, cvPerVoice, fields, VOICE_OUTPUTS,
  setTrigger, setTriggerNote, setTriggerEnvSet, LEVEL_TRIGGER_TYPES, addEuclidWithoutJack, keep, setSrr, setSrrJack, setPlayer } from '../patch/edit.js';
import { freeCcs, voicePlan, freeEuclid, srrOutputs } from '../patch/alloc.js';
import { learnCc } from './connect.js';

const SVG = 'http://www.w3.org/2000/svg';
const field = (label, ...control) => h('div', { class: 'erow' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, control));
const sfield = (label, ...control) => perScene(field(label, ...control)); // kept per scene (in the preset)
const divisionOptions = (extra = []) => [...extra, ...DIVISIONS.map(([p, name]) => [p, name])];

// ---- clock sources: the external clock or a Euclid pattern, which needs no jack for this

const NEW_EUCLID = -1;
const euclidsOf = (view) => view.sources.filter((s) => s.kind === 'euclid' && (!s.parked || s.pattern?.pulses > 0)); // with a jack, without, or running outside the rack
const patternOf = (s) => (s.pattern ? ` · ${s.pattern.pulses} of ${s.pattern.steps}` : '');

// What a sequencer, shift register or arpeggiator follows at rate Ext: the external clock, a
// Euclid pattern of this patch, or a new one without a jack. `pick(clock, changes)`: `changes`
// make the new pattern, to go in the same step as linking it.
export function clockSourceInput(view, act, label, current, pick) {
  const options = [[0, 'External clock'], ...euclidsOf(view).map((s) => [s.index + 1, `${s.name}${patternOf(s)}`])];
  if (current > 0 && !options.some(([v]) => v === current)) options.push([current, `Euclid ${current} (not set up)`]);
  if (freeEuclid(act.values().config, view.hardware) >= 0) options.push([NEW_EUCLID, 'A new Euclid (no jack)']);
  return selectInput(label, current, options, (v) => {
    if (v !== NEW_EUCLID) return pick(v, []);
    const e = addEuclidWithoutJack(act.values(), view.hardware);
    pick(e.index + 1, e.changes);
  });
}

// ---- the LFO

const W = 360;
const H = 110;

// Where a sample (−1…1, scaled by depth) is drawn. An LFO on its own swings around the jack's
// stored level, within the jack's range and cut off where the range ends (full depth taken as
// half the range either way, a guess); on top of another source, around the middle.
function waveY(o) {
  const mid = (v) => H / 2 - v * (H / 2 - 8);
  if (!o.lfo?.alone || o.directLevel == null || o.rangeIndex == null) return mid;
  const [lo, hi] = RANGE_VOLTS[o.rangeIndex] ?? RANGE_VOLTS[0];
  const centre = levelToVolts(o.directLevel, o.rangeIndex);
  return (v) => H - 8 - ((Math.max(lo, Math.min(hi, centre + (v * (hi - lo)) / 2)) - lo) / (hi - lo)) * (H - 16);
}

function wavePath(samples, y) {
  return samples.map((v, i) => `${i ? 'L' : 'M'} ${((i / (samples.length - 1)) * W).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
}

function waveSvg(samples, color, y) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'wave');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Two cycles of the LFO, as mixed from its shapes');
  svg.innerHTML = `<path d="M 0 ${y(0).toFixed(1)} H ${W}" class="centre"/><path class="trace" stroke="${color}"/>`;
  svg.lastChild.setAttribute('d', wavePath(samples, y));
  return svg;
}

// `o` is a derive() output; its LFO may be on its own or on top of another source.
export function lfoEditor(view, o, act, color) {
  const r = o.lfoRaw;
  const where = `LFO on jack ${o.jack}`;
  const set = (what, obj) => act.edit(`${what} of the ${where}`, [...setLfo(o.index, obj), keep('lfo', o.index)]); // edited here, it stays on even at depth 0
  const L = (text, param) => ec4Label(text, `output:${o.index}:${param}`, act.ec4);
  const y = waveY(o);
  const svg = waveSvg(lfoSamples(r), color, y);
  const preview = (key, map = (v) => v) => (v) => svg.lastChild.setAttribute('d', wavePath(lfoSamples({ ...r, [key]: map(v) }), y));
  const shape = (label, key) => sfield(L(label, key), slider(`${label} of the ${where}`, r[key], { min: 0, max: 127, show: (v) => `${Math.round((v / 127) * 100)}%`, preview: preview(key) },
    (v) => set(label, { [key]: v })));
  const sawShow = (v) => (v === 0 ? 'off' : v > 0 ? `rising ${Math.round((v / 63) * 100)}%` : `falling ${Math.round((-v / 64) * 100)}%`);

  const rows = [
    sfield('Timing', selectInput(`Timing of the ${where}`, r.lfoSynced ? 1 : 0, [[0, 'Free'], [1, 'Synced to the tempo']], (v) => set('Timing', { lfoSynced: v }))),
    ...(r.lfoSynced
      ? [sfield(L('One cycle', 'lfoTempoBase'), selectInput(`Cycle of the ${where}`, r.lfoTempoBase, divisionOptions(), (v) => set('Cycle', { lfoTempoBase: v }))),
        sfield(L('Times', 'lfoTempoMultiplier'), numberInput(`Cycle multiplier of the ${where}`, r.lfoTempoMultiplier, { min: 1, max: 127 }, (v) => set('Cycle', { lfoTempoMultiplier: v })))]
      : [sfield(L('Rate', 'lfoSpeed'), numberInput(`Rate of the ${where}`, lfoHz(r.lfoSpeed).toFixed(2), { min: 0.1, max: 10, step: 0.01 }, (v) => set('Rate', { lfoSpeed: hzToLfo(v) })), ' Hz')]),
    // the other timing's knobs, when they are on the EC4: the FH-2 takes whichever rate was set
    // last, so turning one switches the timing (code review, 2026-11-05)
    ...(() => {
      const on = (p) => act.ec4?.state(`output:${o.index}:${p}`)?.on;
      if (r.lfoSynced && on('lfoSpeed')) return [field(L('Free rate', 'lfoSpeed'), h('span', { class: 'note' }, 'on the EC4: turning it makes the LFO free'))];
      if (!r.lfoSynced && (on('lfoTempoBase') || on('lfoTempoMultiplier'))) {
        return [field(h('span', {}, L('One cycle', 'lfoTempoBase'), ' ', L('Times', 'lfoTempoMultiplier')), h('span', { class: 'note' }, 'on the EC4: turning one syncs the LFO'))];
      }
      return [];
    })(),
    sfield(L('Depth', 'lfoLevel'), slider(`Depth of the ${where}`, Math.round((r.lfoLevel / 16383) * 100), { min: 0, max: 100, show: (v) => `${v}%`, preview: preview('lfoLevel', (v) => Math.round((v / 100) * 16383)) },
      (v) => set('Depth', { lfoLevel: Math.round((v / 100) * 16383) }))),
    // on its own it swings around the jack's stored level: that is its offset
    o.lfo?.alone && o.directLevel != null && sfield(L('Centre', 'directLevel'), voltsInput(`Centre of the ${where}`, o.directLevel, o.rangeIndex,
      (v) => act.edit(`Centre of the ${where}`, setDirectLevel(o.index, v)))),
  ];
  const shapes = [
    shape('Sine', 'lfoSine'),
    shape('Triangle', 'lfoTriangle'),
    shape('Square', 'lfoSquare'),
    sfield(L('Pulse width', 'lfoPulseWidth'), slider(`Pulse width of the ${where}`, r.lfoPulseWidth, { min: 0, max: 127, show: (v) => `${Math.round((v / 127) * 100)}%`, preview: preview('lfoPulseWidth') },
      (v) => set('Pulse width', { lfoPulseWidth: v }))),
    sfield(L('Saw', 'lfoSaw'), slider(`Saw of the ${where}`, r.lfoSaw - 64, { min: -64, max: 63, show: sawShow, preview: preview('lfoSaw', (v) => v + 64) },
      (v) => set('Saw', { lfoSaw: v + 64 }))),
    shape('Random', 'lfoRandom'),
    shape('Noise', 'lfoNoise'),
  ];
  const more = [
    sfield(L('Phase', 'lfoPhase'), slider(`Phase of the ${where}`, r.lfoPhase, { min: 0, max: 127, show: (v) => `${Math.round((v / 128) * 360)}°`, preview: preview('lfoPhase') },
      (v) => set('Phase', { lfoPhase: v }))),
    sfield(L('Fade in', 'lfoFade'), slider(`Fade in of the ${where}`, r.lfoFade, { min: 0, max: 127, show: (v) => (v ? String(v) : 'off') }, (v) => set('Fade in', { lfoFade: v }))),
    field('Restart', restartSelect(view, o, act)),
  ];
  const notes = [];
  if (r.lfoSynced && o.lfoReset?.typeIndex === 6) {
    notes.push(h('p', { class: 'note' }, 'Synced and restarted by a clock: may jump twice per cycle (check 14).'));
  }
  return [h('div', { class: 'wave-box' }, svg, h('span', { class: 'wave-cap' }, o.lfo?.alone ? `Two cycles in ${o.range}, approximate` : 'Two cycles, approximate')),
    h('div', { class: 'erows' }, rows), h('h4', {}, 'Shape mix'), h('div', { class: 'erows' }, shapes), h('div', { class: 'erows' }, more), notes];
}

// What restarts the LFO: never, a clock or a Euclid pattern of this patch, or what the config
// already says (a CC, a note…), which is kept as it is.
function restartSelect(view, o, act) {
  const now = o.lfoReset;
  const key = (t, ch, n) => `${t}:${ch}:${n}`;
  const options = [[key(0, 0, 0), 'Never (free running)']];
  const clocks = view.sources.find((s) => s.id === 'clocks');
  for (const p of clocks?.ports ?? []) options.push([key(LFO_RESET_CLOCK, 0, p.clock), `On ${p.name} (clock ${p.clock + 1}, ${p.jack})`]);
  for (const s of euclidsOf(view)) options.push([key(LFO_RESET_EUCLID, 0, s.index), `On ${s.name}’s pulses${patternOf(s)}`]);
  const current = now ? key(now.typeIndex, now.channel, now.number) : key(0, 0, 0);
  if (!options.some(([k]) => k === current)) {
    const what = LFO_RESET_TYPES[now.typeIndex] ?? `type ${now.typeIndex}`;
    options.push([current, `${what}${now.typeIndex <= 3 ? `, ch ${now.channel + 1}` : ''}${now.typeIndex === 1 || now.typeIndex === 2 ? ` · ${now.number}` : ''} (as set)`]);
  }
  if (freeEuclid(act.values().config, view.hardware) >= 0) options.push(['new', 'On a new Euclid’s pulses (no jack)']);
  return selectInput(`Restart of the LFO on jack ${o.jack}`, current, options, (k) => {
    if (k === 'new') {
      const e = addEuclidWithoutJack(act.values(), view.hardware);
      return act.edit(`LFO on jack ${o.jack} restarts on a new Euclid ${e.index + 1}`, [...e.changes, ...setLfoRestart(o.index, { type: LFO_RESET_EUCLID, channel: 0, number: e.index })]);
    }
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
  const L = (text, param) => ec4Label(text, `euclid:${s.index}:${param}`, act.ec4);
  const num = (label, key, min, max) => sfield(L(label, key), numberInput(`${label} of ${s.name}`, p[key], { min, max }, (v) => set(label, { [key]: v })));
  return [
    stepsSvg(euclidPattern(p.pulses, p.steps, p.rotation), color),
    h('div', { class: 'erows' },
      num('Pulses', 'pulses', 0, 32),
      num('Steps', 'steps', 1, 32),
      num('Rotation', 'rotation', 0, 32),
      sfield(L('Step rate', 'rate'), selectInput(`Step rate of ${s.name}`, p.ratePulses, divisionOptions([[0, 'External clock']]), (v) => set('Step rate', { rate: v }))),
      num('Gate length', 'gate', 0, 127),
      num('Accent rate', 'accent', 0, 127),
      sfield(L('Reset', 'reset'), numberInput(`Reset of ${s.name}`, p.reset, { min: 0, max: 32 }, (v) => set('Reset', { reset: v })), ' beats (0 = never)')),
  ];
}

// ---- shift register (random)

const SRR_JACKS = [['CV', 'CV', 'The random voltage'], ['Change', 'Change', 'A gate whenever the CV changes'], ['Trigger', 'Trigger', 'A gate whenever its first bit is set']];
const pctOf = (v) => Math.round((v / 127) * 100);

// Shift register `i` (0–15): its settings in the scene in view, its jacks, and its MIDI notes in
// and out. From the dumps themselves, so it works for one that only sends notes and has no jack.
export function srrEditor(view, i, act) {
  const values = act.values();
  const t = values.preset?.srr[i];
  const r = values.config.srr[i];
  const name = view.sources.find((x) => x.id === `srr:${i}`)?.name ?? `Random ${i + 1}`;
  const set = (what, obj) => act.edit(`${what} of ${name}`, setSrr(i, obj));
  const L = (text, param) => ec4Label(text, `srr:${i}:${param}`, act.ec4);
  const num = (label, key, min, max, note) => sfield(L(label, key), numberInput(`${label} of ${name}`, t[key], { min, max }, (v) => set(label, { [key]: v })), note);
  const midi = t && srrUsesMidiNotes(t.scale);
  const parts = [];
  if (!t) parts.push(h('p', { class: 'note' }, 'No preset loaded.'));
  else {
    if (t.direction === SRR_STOP) parts.push(h('p', { class: 'problem' }, 'Stopped: nothing changes until it has a direction.'));
    parts.push(h('div', { class: 'erows' },
      sfield(L('Direction', 'direction'), selectInput(`Direction of ${name}`, t.direction, SRR_DIRECTIONS.map((n, k) => [k, n]), (v) => set('Direction', { direction: v }))),
      num('Length', 'length', 1, 32, ' steps, then it loops'),
      num('Randomness', 'randomness', 0, 127, ` · ${srrRandomnessText(t.randomness)}`),
      num('Depth', 'attenuator', 0, 127, ` · ${pctOf(t.attenuator)} % of the jack’s range`),
      sfield(L('Scale', 'scale'), selectInput(`Scale of ${name}`, t.scale, SRR_SCALES.map((n, k) => [k, n]), (v) => set('Scale', { scale: v }))),
      t.scale ? sfield(L(midi ? 'Transpose' : 'Key', 'key'), selectInput(`${midi ? 'Transpose' : 'Key'} of ${name}`, t.key,
        // a scale takes the key as a note (0–11; 12–24 are the same notes again), the MIDI scales as a transposition
        (midi ? Array.from({ length: 25 }, (_, k) => k) : [...Array.from({ length: 12 }, (_, k) => k), ...(t.key > 11 ? [t.key] : [])])
          .map((k) => [k, srrKeyText(k, t.scale)]), (v) => set(midi ? 'Transpose' : 'Key', { key: v }))) : null,
      num('Gate length', 'gateLength', 0, 127, t.gateLength ? ` · ${pctOf(t.gateLength)} % of a step` : ' · 0: the trigger length')));
  }

  // its jacks: the CV on a free CV jack, the two gates on any free jack
  const left = srrOutputs(r).length;
  const sends = !!(r.toInternal || r.toUsbC || r.toUsbA || r.toDin || r.toSelect);
  const jackOf = { CV: r.cvOutput ? r.cvOutput - 1 : null, Change: r.changeOutputHigh ? null : r.changeOutput, Trigger: r.triggerOutputHigh ? null : r.triggerOutput };
  const jackRow = ([port, label, title]) => {
    const now = jackOf[port];
    const free = view.outputs.filter((o) => o.present && !o.ports.length && (port !== 'CV' || !o.gate)).map((o) => [o.index, o.jack]);
    const options = [[-1, '—'], ...(now != null ? [[now, view.outputs[now].jack]] : []), ...free];
    return h('div', { class: 'erow', title }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, selectInput(`${label} jack of ${name}`, now ?? -1, options, (v) => {
      if (v === -1) {
        // off its last jack it stops, unless its notes still play
        const stop = left === 1 && !sends && t ? setSrr(i, { direction: SRR_STOP }) : [];
        act.edit(`${name}: ${label} off jack ${view.outputs[now].jack}`, [...setSrrJack(i, port, null), ...stop]);
      } else act.edit(`${name}: ${label} on jack ${view.outputs[v].jack}`, setSrrJack(i, port, v));
    })));
  };
  parts.push(h('h3', {}, 'Jacks'), h('div', { class: 'erows' }, SRR_JACKS.map(jackRow)));

  // MIDI: the notes it quantises to (the MIDI scales), and its own notes out (a player)
  const CH = Array.from({ length: 16 }, (_, c) => [c + 1, `ch ${c + 1}`]);
  parts.push(h('h3', {}, 'MIDI'), h('div', { class: 'erows' },
    midi || r.notesChannel ? field('Notes in', selectInput(`Notes in of ${name}`, r.notesChannel, [[0, 'none'], ...CH],
      (v) => act.edit(v ? `${name} listens for notes on ch ${v}` : `${name} listens for no notes`, [{ dump: 'config', path: ['srr', i, 'notesChannel'], value: v }])),
    midi && !r.notesChannel ? ' · needed for this scale' : null) : null,
    field('Notes out', selectInput(`Notes out of ${name}`, sends ? r.channel + 1 : 0, [[0, 'off'], ...CH], (v) => act.edit(
      v ? `${name} sends notes on ch ${v}` : `${name} sends no notes`,
      v ? setPlayer(`srrNotes:${i}`, { channel: v - 1, dests: sends ? {} : { internal: true } })
        : setPlayer(`srrNotes:${i}`, { dests: { internal: false, usbC: false, usbA: false, din: false, select: false } }))),
    null)));
  return parts;
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

// `only`: just the knob on that output (for a jack's own inspector).
export function knobEditor(view, s, act, only = null) {
  const config = act.values().config;
  return s.ports.filter((p) => only == null || p.output === only).map((p) => {
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
      sfield(ec4Label('Now at', `output:${p.output}:directLevel`, act.ec4), voltsInput(`Level of ${p.jack}`, view.outputs[p.output].directLevel ?? 0, view.outputs[p.output].rangeIndex,
        (v) => act.edit(`Level of ${p.jack}`, setDirectLevel(p.output, v))))));
  });
}

export function levelEditor(view, s, act) {
  return h('div', { class: 'erows' }, s.ports.map((p) => {
    const o = view.outputs[p.output];
    return sfield(ec4Label(p.jack, `output:${p.output}:directLevel`, act.ec4), voltsInput(`Level of ${p.jack}`, o.directLevel, o.rangeIndex, (v) => act.edit(`Level of ${p.jack}`, [...setDirectLevel(p.output, v), keep('level', p.output)])));
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

// A voice's tuning (preset, per scene): off, a Scala scale with its keyboard mapping (slots 1–32,
// named where Night Shift installed them), or the FH-2's MTS tuning (patch/scala.js).
function tuningRows(s, act) {
  const values = act.values();
  const c = values.preset?.converter[s.index];
  if (!c) return [];
  const t = voiceTuning(c);
  const tset = (what, obj) => act.edit(`${what} of ${s.name}`, setTuning(s.index, obj));
  const slots = (kind) => {
    const files = scalaFiles(values.names, kind);
    return Array.from({ length: SLOTS }, (_, i) => [i + 1, slotLabel(files, i + 1)]);
  };
  const known = TUNINGS.some(([v]) => v === t.enable);
  // a pair Night Shift knows both of, that may not play together
  const sclFile = scalaFiles(values.names, 'scl')[t.scl - 1];
  const kbmFile = scalaFiles(values.names, 'kbm')[t.kbm - 1];
  const clash = t.enable === 1 && kbmFile ? scalaMismatch(sclFile?.text ?? null, kbmFile.text) : null;
  return [
    sfield('Tuning', h('span', { class: 'tuning-buttons' }, TUNINGS.map(([v, name]) => h('button', { type: 'button', class: 'btn small', 'aria-pressed': v === t.enable ? 'true' : 'false',
      onclick: () => v !== t.enable && act.edit(v ? `${s.name} tuned by ${name}` : `${s.name}: no tuning`, setTuning(s.index, { enable: v })) }, name)), known ? null : h('span', { class: 'dim' }, ` value ${t.enable}`))),
    t.enable === 1 && sfield('Scale', selectInput(`.scl of ${s.name}`, t.scl, slots('scl'), (v) => tset('Scale', { scl: v })),
      selectInput(`.kbm of ${s.name}`, t.kbm, slots('kbm'), (v) => tset('Keyboard mapping', { kbm: v })), h('span', { class: 'dim', title: 'Slots of the .scl and .kbm files (Settings tab)' }, ' .scl · .kbm')),
    clash && field('', h('span', { class: 'problem' }, `May show Scala Error: ${clash}`)),
    (t.enable === 2 || t.enable === 3) && field('', h('span', { class: 'dim' }, t.enable === 3 ? 'The FH-2’s MTS tuning, from MTS SysEx (MTSMIDIClient, say)' : 'The FH-2’s MTS tuning, from MIDI (MTS-ESP)')),
  ].filter(Boolean);
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
  const L = (text, param) => ec4Label(text, `converter:${s.index}:${param}`, act.ec4);
  // glide and legato only happen where one voice plays one note after another: mono and Unison
  const oneLine = cv.type === 0 || cv.allocation === 2 || cv.allocation === 3;
  // the Random output's depth, which its EC4 page has too (code review, 2026-11-05)
  if (pf && cv.randomOut) {
    parts.push(h('div', { class: 'erows' }, sfield(L('Random depth', 'randomDepth'), slider(`Random depth of ${s.name}`, pf.randomDepth,
      { min: 0, max: 127, show: (v) => `${Math.round((v / 127) * 100)}%` }, (v) => pset('Random depth', { randomDepth: v })))));
  }
  parts.push(h('h4', {}, 'Pitch'), h('div', { class: 'erows' },
    pf && sfield(L('Transpose', 'transpose'), numberInput(`Transpose of ${s.name}`, pf.transpose - 64, { min: -64, max: 63 }, (v) => pset('Transpose', { transpose: v + 64 })), ' semitones'),
    pf && oneLine && sfield(L('Glide', 'portamento'), slider(`Glide of ${s.name}`, pf.portamento, { min: 0, max: 127, show: (v) => (v ? String(v) : 'off') }, (v) => pset('Glide', { portamento: v }))),
    field('Bend range', numberInput(`Bend range of ${s.name}`, cv.bendRange, { min: 0, max: 48 }, (v) => set('Bend range', { bendRange: v })), ' semitones'),
    cv.bendRange > 0 && field('Bend down', selectInput(`Bend down of ${s.name}`, cv.bendDown, [[0, 'Same as up'], ...Array.from({ length: 48 }, (_, i) => [i + 2, `${i + 1} semitones`])], (v) => set('Bend down', { bendDown: v }))),
    ...tuningRows(s, act)));
  parts.push(h('h4', {}, 'Notes'), h('div', { class: 'erows' },
    field('Sustain pedal', selectInput(`Sustain of ${s.name}`, cv.sustain, SUSTAIN.map((n, i) => [i, n]), (v) => set('Sustain pedal', { sustain: v }))),
    oneLine && field('Legato gate', selectInput(`Interrupt gate of ${s.name}`, cv.interruptGate, [[0, 'Stays high'], [1, 'Short dip on legato notes']], (v) => set('Legato gate', { interruptGate: v }))),
    cv.type === 0 && field('Returning note', selectInput(`Mono retrigger of ${s.name}`, cv.monoRetrigger, [[0, 'Fires trigger and envelope'], [1, 'Doesn’t fire them']], (v) => set('Returning note', { monoRetrigger: v }))),
    cv.type === 0 && field('Legato velocity', selectInput('Legato velocity (all mono voices)', act.values().config.legatoVelocity, [[0, 'Each note’s own'], [1, 'First note of a phrase']],
      (v) => act.edit('Legato velocity (all mono voices)', fields('config', [], { legatoVelocity: v }))))));

  // the arpeggiator: it takes over the notes this voice hears and plays them on its jacks. Its
  // settings live in the preset, its clock source in the config. Its copy out as MIDI (USB C,
  // USB A, DIN) isn't offered; one set elsewhere is shown, with a way to switch it off.
  if (pf) {
    const a = pf.arpRaw;
    const heard = `${s.channels.length > 1 ? `ch ${s.channels[0] + 1}–${s.channels.at(-1) + 1}` : `ch ${s.channel + 1}`}, ${noteName(s.notes[0])}–${noteName(s.notes[1])}`;
    const rows = [sfield(L('Mode', 'arpMode'), selectInput(`Arp mode of ${s.name}`, arpModeOf(a.mode)[0], ARP_MODES, (v) => pset('Arp mode', { arpMode: v })))];
    if (a.mode > 10) {
      const o = s.arpOut;
      rows.push(field('Arpeggiates', `notes on ${heard}`),
        sfield(L('Range', 'arpRange'), selectInput(`Arp range of ${s.name}`, Math.max(1, Math.min(3, a.range)), [[1, '1 octave'], [2, '2 octaves'], [3, '3 octaves']], (v) => pset('Arp range', { arpRange: v }))),
        sfield(L('Rate', 'arpRate'), selectInput(`Arp rate of ${s.name}`, a.rate, [[0, 'Ext: its clock source'], ...DIVISIONS], (v) => pset('Arp rate', { arpRate: v }))),
        a.rate === 0 ? field('Clock source', clockSourceInput(view, act, `Arp clock source of ${s.name}`, cv.arpClock,
          (v, made) => act.edit(made.length ? `${s.name}’s arp clocked by a new Euclid ${v}` : `Arp clock source of ${s.name}`, [...made, ...setConverter(s.index, { arpClock: v })]))) : null,
        sfield(L('Gate', 'arpGate'), slider(`Arp gate of ${s.name}`, a.gate, { min: 0, max: 127, show: (v) => (v ? `${Math.round((v / 128) * 100)}%` : 'trigger') }, (v) => pset('Arp gate', { arpGate: v }))),
        sfield(L('Latch', 'arpLatch'), selectInput(`Arp latch of ${s.name}`, a.latch ? 1 : 0, [[0, 'Off'], [1, 'On: holds until a new chord']], (v) => pset('Arp latch', { arpLatch: v }))),
        sfield(L('Reset', 'arpReset'), numberInput(`Arp reset of ${s.name}`, a.reset, { min: 0, max: 127 }, (v) => pset('Arp reset', { arpReset: v })), ' quarter notes (0 = never)'),
        o && field('Also sends out', `ch ${o.channel + 1} → ${[o.usbC && 'USB C', o.usbA && 'USB A', o.din && 'DIN'].filter(Boolean).join(', ')}`,
          h('button', { type: 'button', class: 'btn small', onclick: () => set('Arp MIDI out', { arpToUsbC: 0, arpToUsbA: 0, arpToDin: 0 }) }, 'Switch off')),
        // the commands (pushes on the EC4) and truncate (a knob): no stored value, only the EC4
        act.ec4 && field('On the EC4', h('span', { class: 'ec4-cmds' }, [['arpAdd', 'Add'], ['arpRemove', 'Remove'], ['arpRest', 'Rest'],
          ['arpTranspose', 'Transpose'], ['arpTransposeInKey', 'In key'], ['arpSetRoot', 'Set root'], ['arpTruncate', 'Truncate']].map(([p, t]) => L(t, p)))));
    }
    parts.push(h('h4', {}, 'Arpeggiator'), h('div', { class: 'erows' }, rows),
      null);
  }

  // the envelope: only while it comes out, or a trigger of type Envelope borrows its settings
  const borrowed = view.sources.filter((x) => x.kind === 'triggers')
    .flatMap((t) => t.ports.filter((p) => p.typeIndex === ENVELOPE_TRIGGER && p.envSet === s.index).map((p) => p.jack));
  if (pf && (cv.envelopeOut || borrowed.length)) {
    const e = pf.envelope;
    const svg = envelopeSvg(e, color);
    const preview = (key) => (v) => svg.redraw({ ...e, [key]: v });
    const env = (label, key, field2, show = pct) => sfield(L(label, field2), slider(`${label} of ${s.name}`, e[key], { min: 0, max: 127, show, preview: preview(key) }, (v) => pset(label, { [field2]: v })));
    parts.push(h('h4', {}, 'Envelope'), h('div', { class: 'wave-box' }, svg, h('span', { class: 'wave-cap' },
      cv.envelopeOut ? 'Shape only, times approximate' : `Used by the trigger${borrowed.length > 1 ? 's' : ''} on ${borrowed.join(', ')}`)),
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
        sfield(L('Time range', 'envRange'), numberInput(`Envelope time range of ${s.name}`, e.range, { min: 0, max: 127 }, (v) => pset('Envelope time range', { envRange: v }))),
        field('Each note', selectInput(`Envelope start of ${s.name}`, cv.envZeroStart, [[0, 'Rises from where it is'], [1, 'Starts from zero']], (v) => set('Envelope start', { envZeroStart: v })))));
  } else if (!pf) {
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
      p.typeIndex === ENVELOPE_TRIGGER ? field('Envelope from', selectInput(`Envelope of ${name}`, p.envSet, Array.from({ length: 16 }, (_, i) => [i, `Voice ${i + 1}’s settings`]),
        (v) => act.edit(`Envelope of ${name}`, setTriggerEnvSet(p.trigger, v)))) : null));
  });
  return [h('div', { class: 'erows' }, kit), boxes];
}
