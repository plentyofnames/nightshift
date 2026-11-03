// The inspector: an overview when nothing is selected, a source's details, or a jack's,
// with the jack's settings and adding and removing sources.

import { h } from '../../vendor/lilypad/js/dom.js';
import { icon, chip, KIND_NAMES } from './look.js';
import { PARAM_NAMES, RANGES, RANGE_VOLTS, noteName, levelToVolts, voltsToLevel } from '../patch/tables.js';
import { outputNumber, internalName } from '../patch/hardware.js';
import { setRange, setDirectLevel, setSmoothing, setGateLevels, addLfo, removeLfo } from '../patch/edit.js';
import { numberInput, voltsInput } from './controls.js';
import { lfoEditor, euclidEditor, clockEditor, knobEditor, levelEditor, voiceEditor } from './editors.js';

const section = (title, ...rows) => h('section', { class: 'section' }, h('h3', {}, title), rows);
const row = (k, v, ctl) => h('div', { class: 'row' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v), ctl && h('span', { class: 'ctl' }, ctl));
const ccLabel = (m) => `← ch ${m.channel + 1} · CC ${m.cc}${m.relative ? ' (relative)' : ''}`;
const param = (p) => PARAM_NAMES[p] ?? p;
const yes = (b) => (b ? 'on' : 'off');

// Sources that can be removed so far (M2a).
const REMOVABLE = new Set(['voice', 'level', 'knobs', 'lfo', 'clock', 'euclid', 'hid']);

// `act` is { edit(label, changes), add(output), remove(source, port?) }; each changes the
// patch through edit.js and redraws.
export function renderInspector(view, colors, selected, onSelect, act) {
  if (selected?.source) {
    const s = view.sources.find((x) => x.id === selected.source);
    if (s) return sourceInspector(view, colors, s, onSelect, act);
  }
  if (selected?.output != null) return jackInspector(view, colors, view.outputs[selected.output], onSelect, act);
  if (selected?.parked) return parkedInspector(view, colors, onSelect);
  return overview(view);
}

function overview(view) {
  const g = view.globals;
  const parked = view.sources.filter((s) => s.parked).length;
  return [
    h('div', {}, h('h2', { style: 'font-size:18px' }, g.name || 'Untitled config'),
      h('span', { class: 'kind' }, g.presetName ? `Preset “${g.presetName}”` : 'No preset loaded: open one to see levels, LFOs and patterns')),
    section('Patch',
      row('Sources', `${view.sources.length - parked}${parked ? ` (+ ${parked} outside your rack)` : ''}`),
      row('Tempo', g.tempo ? `${g.tempo.toFixed(1)} BPM` : '—'),
      row('Trigger length', `${g.triggerLength} ms`),
      row('Soft takeover', yes(g.softTakeover)),
      row('Preset program change', g.presetProgramChannel ? `ch ${g.presetProgramChannel}` : 'off')),
    view.problems.length
      ? section(`Problems (${view.problems.length})`, view.problems.map((p) => h('p', { class: 'problem' }, p.message)))
      : h('p', { class: 'note' }, 'No problems found: no two sources share a jack.'),
    h('p', { class: 'note' }, 'Select a source or a jack to see what it does.'),
  ];
}

function header(s, color) {
  return h('div', { class: 'ins-head', style: `--src:${color}` },
    h('span', { class: 'icon' }, icon(s.kind, 22)),
    h('div', {}, h('h2', {}, s.name), h('span', { class: 'kind' }, kindLine(s))));
}

function kindLine(s) {
  if (s.kind === 'voice') return `Voice · ${s.mode}${s.voices > 1 ? `, ${s.voices} voices` : ''}`;
  if (s.kind === 'lfo') return `LFO · lives on jack ${s.ports[0].jack}`;
  return KIND_NAMES[s.kind] ?? s.kind;
}

function sourceInspector(view, colors, s, onSelect, act) {
  const color = colors.get(s.id);
  const parts = [header(s, color)];

  if (s.kind === 'voice' || s.kind === 'triggers') {
    const ch = s.channels.length > 1 ? `ch ${s.channels[0] + 1} (MPE ${s.channels[1] + 1}–${s.channels[s.channels.length - 1] + 1})` : `ch ${s.channel + 1}`;
    const internal = s.players.map((p) => h('div', { class: 'box' }, p.name, h('div', { class: 'sub' }, `internal MIDI ${ch}${p.din || p.usbA || p.usbC ? ' · also sent out' : ''}`)));
    parts.push(section('Played by',
      internal,
      h('div', { class: 'box' }, `MIDI ${ch} from outside`, h('div', { class: 'sub' },
        s.kind === 'voice' ? `notes ${noteName(s.notes[0])}–${noteName(s.notes[1])} · USB A, USB C, DIN or Select Bus` : 'USB A, USB C, DIN or Select Bus'))));
    if (s.players.length) parts.push(h('p', { class: 'note' }, 'An internal player makes MIDI, not voltage: it reaches this source over the FH-2’s own MIDI on the channel above.'));
  }

  parts.push(section('Comes out of', s.ports.map((p) => row(portName(s, p), chip(p.jack ?? '?', color, p.present === false)))));
  if (s.ports.some((p) => p.present === false)) parts.push(h('p', { class: 'note' }, 'Crossed-out jacks are on expanders that aren’t in your rack (set it under Rack…). Clocks there often only restart LFOs.'));
  if (s.standby) parts.push(h('p', { class: 'note' }, `Only does something while a USB ${s.id === 'gamepad' ? 'gamepad' : 'keyboard'} is plugged into USB A; then it sets these jacks on top of what else is there. The FH-2’s Init config sets these up. Switching one off here sets its ${s.id === 'gamepad' ? 'Usage' : 'Type'} to “--” (setting its output to None in Expert Sleepers’ config tool doesn’t work).`));

  const editor = editorOf(view, s, act, color);
  if (editor) parts.push(h('section', { class: 'section' }, h('h3', {}, 'Settings'), editor));
  else {
    const settings = settingsOf(s);
    if (settings.length) parts.push(section('Settings', settings));
  }

  if (s.controls.length) {
    parts.push(section('Controlled by MIDI', s.controls.map((m) => row(param(m.target.param), '', ccLabel(m)))));
  }
  if (REMOVABLE.has(s.kind)) {
    parts.push(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => act.remove(s) },
      s.kind === 'voice' ? 'Remove this voice' : s.kind === 'hid' ? `Switch all ${s.ports.length} off` : s.ports.length > 1 ? `Remove from all ${s.ports.length} jacks` : 'Remove')));
  }
  return parts;
}

// The editable sources (M2a); the others keep the read-only settings below.
function editorOf(view, s, act, color) {
  switch (s.kind) {
    case 'voice': return voiceEditor(view, s, act, color);
    case 'lfo': return lfoEditor(view, view.outputs[s.index], act, color);
    case 'euclid': return euclidEditor(s, act, color);
    case 'clock': return clockEditor(s, act);
    case 'knobs': return knobEditor(view, s, act);
    case 'level': return levelEditor(view, s, act);
    default: return null;
  }
}

function portName(s, p) {
  if (s.kind === 'triggers') return `${p.name}${p.type ? ` · ${p.type}` : ''}`;
  if (s.kind === 'clock') return `${p.name}${p.shift ? `, shifted ${p.shift}` : ''}`;
  return p.name;
}

function settingsOf(s) {
  const r = [];
  if (s.kind === 'voice') {
    const st = s.settings;
    r.push(row('Bend range', st.bendDown == null ? `±${st.bendRange}` : `+${st.bendRange} / −${st.bendDown}`));
    if (s.voices > 1) r.push(row('Voice allocation', st.allocation), row('Don’t steal voices', yes(st.noStealing)));
    r.push(row('Sustain pedal', st.sustain));
    const pf = s.performance;
    if (pf) {
      r.push(row('Glide', String(pf.portamento)), row('Transpose', String(pf.transpose)));
      const e = pf.envelope;
      r.push(row('Envelope', `A ${e.attack} · D ${e.decay} · S ${e.sustain} · R ${e.release}`));
      r.push(row('Arpeggiator', pf.arp ? `mode ${pf.arp.mode} · ${pf.arp.rate}${pf.arp.latch ? ' · latch' : ''}` : 'off'));
    }
    if (s.arpOut) r.push(row('Arp MIDI out', `ch ${s.arpOut.channel + 1} → ${['usbC', 'usbA', 'din'].filter((k) => s.arpOut[k]).map((k) => ({ usbC: 'USB C', usbA: 'USB A', din: 'DIN' })[k]).join(', ')}`));
  }
  if (s.kind === 'lfo') {
    const l = s.lfo;
    r.push(row('Rate', `${l.rate}${l.synced ? ' (synced)' : ''}`));
    r.push(row('Shape', Object.entries(l.shapes).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ')));
    r.push(row('Depth', String(l.level)), row('Centre', String(s.centre)), row('Phase', String(l.phase)), row('Fade in', String(l.fade)));
  }
  if (s.kind === 'euclid' && s.pattern) {
    const p = s.pattern;
    r.push(row('Pattern', `${p.pulses} of ${p.steps}, rotated ${p.rotation}`), row('Step rate', p.rate), row('Accent', p.accent ? String(p.accent) : 'off'), row('Reset every', p.reset ? `${p.reset} beats` : 'never'));
  }
  if (s.kind === 'random' && s.settings) {
    const t = s.settings;
    r.push(row('Loop length', String(t.length)), row('Randomness', String(t.randomness)), row('Scale / key', `${t.scale} / ${t.key}`), row('Direction', String(t.direction)));
  }
  if (s.kind === 'clock') {
    for (const p of s.ports) r.push(row(p.name, `${p.length ? `${p.length} ms pulse` : 'square'}`));
  }
  return r;
}

function parkedInspector(view, colors, onSelect) {
  const parked = view.sources.filter((s) => s.parked);
  return [
    h('div', { class: 'ins-head' }, h('div', {}, h('h2', {}, 'Outside your rack'),
      h('span', { class: 'kind' }, `${parked.length} ${parked.length === 1 ? 'source' : 'sources'} on jacks you don’t have`))),
    section('Sources', parked.map((s) => row(
      h('button', { type: 'button', class: 'linkish', onclick: () => onSelect({ source: s.id }) }, s.name),
      [...new Set(s.ports.map((p) => p.jack))].map((j) => chip(j, colors.get(s.id), true))))),
    h('p', { class: 'note' }, 'Their outputs are on expanders that aren’t in your rack (set it under Rack…), so nothing comes out. The FH-2’s Init config parks its unused Euclid patterns on GT3/16 this way. They can still restart an LFO, or clock an arpeggiator, sequencer or shift register.'),
  ];
}

function jackSettings(o, edit) {
  const r = o.rangeIndex;
  const where = `jack ${o.jack}`;
  const rangeSelect = h('select', { 'aria-label': `Range of ${where}`, 'data-key': `range ${where}`, onchange: (e) => edit(`Range of ${where}: ${RANGES[+e.target.value]}`, setRange(o.index, +e.target.value)) },
    RANGES.map((name, i) => h('option', { value: i, selected: i === r }, name)));
  const preset = o.directLevel != null;
  const rows = [
    row('Range', rangeSelect),
    row('Stored level', preset ? voltsInput(`Stored level of ${where}`, o.directLevel, r, (v) => edit(`Stored level of ${where}`, setDirectLevel(o.index, v))) : '—',
      preset ? `code ${o.directLevel}` : null),
    row('Smoothing', preset ? numberInput(`Smoothing of ${where}`, o.smoothing, { min: 0, max: 127 }, (v) => edit(`Smoothing of ${where}: ${v}`, setSmoothing(o.index, v))) : '—'),
    row('Gate low', voltsInput(`Gate low level of ${where}`, o.gateLevels.low, r, (v) => edit(`Gate levels of ${where}`, setGateLevels(o.index, v, o.gateLevels.high)))),
    row('Gate high', voltsInput(`Gate high level of ${where}`, o.gateLevels.high, r, (v) => edit(`Gate levels of ${where}`, setGateLevels(o.index, o.gateLevels.low, v)))),
  ];
  if (o.lfoReset) rows.push(row('LFO restarts on', `${o.lfoReset.type}`));
  return [
    section('Jack settings', rows),
    h('p', { class: 'note' }, (preset ? 'The stored level is what comes out when nothing else drives this jack; it’s kept in the preset. ' : 'Open or pull a preset to set the stored level and smoothing. ')
      + 'Gate levels are used when the jack carries gates, triggers or clocks. Volts assume an uncalibrated output.'),
  ];
}

function jackInspector(view, colors, o, onSelect, act) {
  const parts = [
    h('div', { class: 'ins-head' }, h('div', {}, h('h2', {}, `Jack ${o.jack}`),
      h('span', { class: 'kind' }, `${o.gate ? 'Gate' : 'CV'} · ${internalName(o.index)} in the FH-2 app · output ${outputNumber(o.index)} in its menus${o.present ? '' : ' · not in your rack'}`))),
  ];
  const portRow = (p) => {
    const s = view.sources.find((x) => x.id === p.source);
    const port = s.ports.find((x) => x.output === o.index && x.name === p.name);
    const remove = REMOVABLE.has(s.kind) && port
      && h('button', { type: 'button', class: 'remove', 'aria-label': `Remove ${s.name} ${p.name} from jack ${o.jack}`,
        title: s.kind === 'voice' ? 'Turn this output off, for every voice; the outputs after it move up'
          : s.kind === 'hid' ? 'Switch this entry off' : 'Remove from this jack', onclick: () => act.remove(s, port) }, '×');
    return row(h('button', { type: 'button', class: 'linkish', onclick: () => onSelect({ source: s.id }) }, s.name), [chip(p.name, colors.get(s.id)), remove]);
  };
  const active = o.ports.filter((p) => !p.standby);
  const standby = o.ports.filter((p) => p.standby);
  parts.push(section('Comes out of', active.length
    ? active.map(portRow)
    : [h('p', { class: 'note' }, 'Nothing: this jack is free.'),
      o.present && h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary', onclick: () => act.add(o.index) }, 'Add a source…'))]));
  if (standby.length) parts.push(section('With a USB device on USB A', standby.map(portRow)));
  if (o.lfo && !o.lfo.alone) {
    parts.push(h('section', { class: 'section' }, h('h3', {}, 'LFO on top'), lfoEditor(view, o, act, '#3DD6C6'),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => act.edit(`Removed the LFO on jack ${o.jack}`, removeLfo(o.index)) }, 'Remove the LFO'))));
  } else if (!o.lfo && !o.gate && active.length && o.lfoRaw) {
    parts.push(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', title: 'Vibrato on a pitch, wobble on a level',
      onclick: () => act.edit(`LFO on top of jack ${o.jack}`, addLfo(o.index, { shape: 'sine', rate: { hz: 5 }, depth: 0.05 })) }, 'Add an LFO on top')));
  }
  if (!o.gate) parts.push(...jackSettings(o, act.edit));
  if (o.controls.length) parts.push(section('Controlled by MIDI', o.controls.map((m) => row(param(m.target.param), '', ccLabel(m)))));
  return parts;
}

