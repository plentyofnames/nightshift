// The read-only inspector: an overview when nothing is selected, a source's details, or a jack's.

import { h } from '../../vendor/lilypad/js/dom.js';
import { icon, chip, KIND_NAMES } from './look.js';
import { PARAM_NAMES, noteName } from '../patch/tables.js';
import { outputNumber, internalName } from '../patch/hardware.js';

const section = (title, ...rows) => h('section', { class: 'section' }, h('h3', {}, title), rows);
const row = (k, v, ctl) => h('div', { class: 'row' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v), ctl && h('span', { class: 'ctl' }, ctl));
const ccLabel = (m) => `← ch ${m.channel + 1} · CC ${m.cc}${m.relative ? ' (relative)' : ''}`;
const param = (p) => PARAM_NAMES[p] ?? p;
const yes = (b) => (b ? 'on' : 'off');

export function renderInspector(view, colors, selected, onSelect) {
  if (selected?.source) {
    const s = view.sources.find((x) => x.id === selected.source);
    if (s) return sourceInspector(view, colors, s, onSelect);
  }
  if (selected?.output != null) return jackInspector(view, colors, view.outputs[selected.output], onSelect);
  return overview(view);
}

function overview(view) {
  const g = view.globals;
  return [
    h('div', {}, h('h2', { style: 'font-size:18px' }, g.name || 'Untitled config'),
      h('span', { class: 'kind' }, g.presetName ? `Preset “${g.presetName}”` : 'No preset loaded: open one to see levels, LFOs and patterns')),
    section('Patch',
      row('Sources', String(view.sources.length)),
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

function sourceInspector(view, colors, s, onSelect) {
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

  const settings = settingsOf(s);
  if (settings.length) parts.push(section('Settings', settings));

  if (s.controls.length) {
    parts.push(section('Controlled by MIDI', s.controls.map((m) => row(param(m.target.param), '', ccLabel(m)))));
  }
  return parts;
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

function jackInspector(view, colors, o, onSelect) {
  const parts = [
    h('div', { class: 'ins-head' }, h('div', {}, h('h2', {}, `Jack ${o.jack}`),
      h('span', { class: 'kind' }, `${o.gate ? 'Gate' : 'CV'} · ${internalName(o.index)} in the FH-2 app · output ${outputNumber(o.index)} in its menus${o.present ? '' : ' · not in your rack'}`))),
  ];
  parts.push(section('Comes out of', o.ports.length
    ? o.ports.map((p) => {
      const s = view.sources.find((x) => x.id === p.source);
      return row(h('button', { type: 'button', class: 'linkish', onclick: () => onSelect({ source: s.id }) }, s.name), chip(p.name, colors.get(s.id)));
    })
    : h('p', { class: 'note' }, o.lfo?.alone ? 'An LFO on its own (see Sources).' : 'Nothing: this jack is free.')));
  if (o.lfo && !o.lfo.alone) parts.push(section('LFO on top', row('Rate', o.lfo.rate), row('Depth', String(o.lfo.level))));
  if (!o.gate) {
    parts.push(section('Jack settings',
      row('Range', o.range),
      row('Offset (direct level)', o.directLevel == null ? '—' : String(o.directLevel)),
      row('Smoothing', o.smoothing == null ? '—' : String(o.smoothing)),
      row('Gate levels', `${o.gateLevels.low} – ${o.gateLevels.high}`),
      o.lfoReset && row('LFO restarts on', `${o.lfoReset.type}`)));
  }
  if (o.controls.length) parts.push(section('Controlled by MIDI', o.controls.map((m) => row(param(m.target.param), '', ccLabel(m)))));
  return parts;
}

