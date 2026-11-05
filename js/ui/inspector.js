// The inspector: an overview when nothing is selected, a source's details, or a jack's,
// with the jack's settings and adding and removing sources.

import { h } from '../../vendor/lilypad/js/dom.js';
import { icon, chip, KIND_NAMES } from './look.js';
import { PARAM_NAMES, RANGES, RANGE_VOLTS, noteName, levelToVolts, voltsToLevel } from '../patch/tables.js';
import { outputNumber, internalName } from '../patch/hardware.js';
import { replacesLevel } from '../patch/derive.js';
import { setRange, setDirectLevel, setSmoothing, setGateLevels, addLfo, keep } from '../patch/edit.js';
import { numberInput, voltsInput, perScene, ec4Label } from './controls.js';
import { lfoEditor, euclidEditor, clockEditor, knobEditor, levelEditor, voiceEditor, triggerEditor, srrEditor } from './editors.js';
import { playerInspector, playedBy, euclidClocks, randomClock, playerSends } from './players.js';
import { calibrationOf } from '../fh2/menu.js';
import { calibrationText } from './settings.js';

const section = (title, ...rows) => h('section', { class: 'section' }, h('h3', {}, title), rows);
const row = (k, v, ctl) => h('div', { class: 'row' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v), ctl && h('span', { class: 'ctl' }, ctl));
const ccLabel = (m) => `← ch ${m.channel + 1} · CC ${m.cc}${m.relative ? ' (relative)' : ''}`;
// a CC mapping with an × to remove it (a setting on the EC4 comes off it too)
const mappingRow = (m, act) => row(param(m.target.param), '', [ccLabel(m), ' ', act.removeMapping && h('button', { type: 'button', class: 'remove',
  'aria-label': `Remove CC ${m.cc} on ch ${m.channel + 1} for ${param(m.target.param)}`, title: 'Remove this CC mapping (off the EC4 too)', onclick: () => act.removeMapping(m) }, '×')]);
const param = (p) => PARAM_NAMES[p] ?? p;
const yes = (b) => (b ? 'on' : 'off');

// Sources that can be removed so far (M2a).
const REMOVABLE = new Set(['voice', 'triggers', 'level', 'knobs', 'lfo', 'clock', 'euclid', 'hid', 'random']);

// `act` is { edit(label, changes), add(output), remove(source, port?) }; each changes the
// patch through edit.js and redraws.
export function renderInspector(view, colors, selected, onSelect, act) {
  if (selected?.source) {
    const s = view.sources.find((x) => x.id === selected.source);
    if (s) return sourceInspector(view, colors, s, onSelect, act);
  }
  if (selected?.output != null) return jackInspector(view, colors, view.outputs[selected.output], onSelect, act);
  if (selected?.parked) return parkedInspector(view, colors, onSelect);
  if (selected?.player) return playerInspector(view, colors, selected.player, onSelect, act);
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

function header(s, color, act) {
  return h('div', { class: 'ins-head', style: `--src:${color}` },
    h('span', { class: 'icon' }, icon(s.kind, 22)),
    h('div', { class: 'grow' }, h('h2', {}, s.name), h('span', { class: 'kind' }, kindLine(s))),
    act && h('button', { type: 'button', class: 'btn small', onclick: () => act.rename(s.id, s.name, s.defaultName) }, 'Rename…'));
}

function kindLine(s) {
  if (s.kind === 'voice') return `Voice · ${s.mode}${s.voices > 1 ? `, ${s.voices} voices` : ''}`;
  if (s.kind === 'lfo') return `LFO · lives on jack ${s.ports[0].jack}`;
  return KIND_NAMES[s.kind] ?? s.kind;
}

function sourceInspector(view, colors, s, onSelect, act) {
  const color = colors.get(s.id);
  const parts = [header(s, color, act)];

  if (s.arpWaits) {
    parts.push(h('p', { class: 'problem' }, s.arpWaits.stopped
      ? `Its arp follows ${s.arpWaits.clock}, which has no pulses: it plays nothing.`
      : `Its arp is on at rate Ext: it plays only while ${s.arpWaits.clock} runs.`));
  }
  if (s.kind === 'voice' || s.kind === 'triggers') parts.push(playedBy(view, s, act, onSelect, colors));

  parts.push(section('Comes out of', s.ports.length ? s.ports.map((p) => row(portName(s, p), chip(p.jack ?? '?', color, p.present === false)))
    : h('p', { class: 'note' }, s.kind === 'random' ? 'No jack: it plays its notes only.' : 'No jack: it runs as long as it has pulses.')));
  if (s.ports.some((p) => p.present === false)) parts.push(h('p', { class: 'note' }, 'Crossed out: not in your rack.'));
  if (s.standby) parts.push(h('p', { class: 'note' }, `Only with a USB ${s.id === 'gamepad' ? 'gamepad' : 'keyboard'} on USB A.`));

  if (s.kind === 'euclid') parts.push(...euclidClocks(view, s, onSelect));
  if (s.kind === 'random' && act) parts.push(randomClock(view, s, act));
  const editor = editorOf(view, s, act, color);
  if (editor) parts.push(h('section', { class: 'section' }, h('h3', {}, 'Settings'), editor));
  // a shift register's notes: where they go and what they play, as a player's panel has it
  const notes = s.kind === 'random' && act && view.players.find((p) => p.id === s.player);
  if (notes) parts.push(...playerSends(view, colors, notes, onSelect, act));
  else {
    const settings = settingsOf(s, act);
    if (settings.length) parts.push(section('Settings', settings));
  }

  if (s.controls.length) {
    parts.push(section('Controlled by MIDI', s.controls.map((m) => mappingRow(m, act))));
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
    case 'triggers': return triggerEditor(view, s, act);
    case 'lfo': return lfoEditor(view, view.outputs[s.index], act, color);
    case 'euclid': return euclidEditor(s, act, color);
    case 'random': return act ? srrEditor(view, s.index, act) : null;
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

function settingsOf(s, act) {
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
    const L = (text, param) => ec4Label(text, `srr:${s.index}:${param}`, act?.ec4);
    r.push(row(L('Loop length', 'length'), String(t.length)), row(L('Randomness', 'randomness'), String(t.randomness)),
      row(L('Scale', 'scale'), String(t.scale)), row(L('Key', 'key'), String(t.key)), row(L('Direction', 'direction'), String(t.direction)));
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
    h('p', { class: 'note' }, 'Nothing comes out; they may still restart an LFO or clock a player.'),
  ];
}

// `driver`: what drives the jack besides its stored level, or null: { name, replaces } where
// `replaces` says the stored level isn't used there. A voice's pitch replaces it, and gate-type
// outputs have their gate levels instead; to the others (envelope, velocity, pressure, a random
// CV…) it is added, as to an LFO: an offset (your tests, 2026-11-03/04: every CV-type output but pitch).
// With the FH-2's "Always load direct" on (`loadDirect`, as last read), a preset load puts it on
// the others too, until what drives the jack sends something.
function jackSettings(o, edit, ec4, { driver = null, loadDirect = false, calibrations = null, act = {} } = {}) {
  const r = o.rangeIndex;
  const where = `jack ${o.jack}`;
  const rangeSelect = h('select', { 'aria-label': `Range of ${where}`, 'data-key': `range ${where}`, onchange: (e) => edit(`Range of ${where}: ${RANGES[+e.target.value]}`, setRange(o.index, +e.target.value)) },
    RANGES.map((name, i) => h('option', { value: i, selected: i === r }, name)));
  const preset = o.directLevel != null;
  const rows = [
    row('Range', rangeSelect),
    // where it's replaced it would only last until the next note, so it's offered only with "Always load direct"
    (!driver?.replaces || loadDirect) && perScene(row(ec4Label(driver && !driver.replaces ? 'Offset' : 'Stored level', `output:${o.index}:directLevel`, ec4),
      // set here on a jack nothing drives, it stays listed even at the bottom of its range
      preset ? voltsInput(`Stored level of ${where}`, o.directLevel, r, (v) => edit(`${driver && !driver.replaces ? 'Offset' : 'Stored level'} of ${where}`,
        driver ? setDirectLevel(o.index, v) : [...setDirectLevel(o.index, v), keep('level', o.index)])) : '—',
      driver?.replaces ? h('span', { class: 'unused', title: 'With the FH-2’s “Always load direct” on, a preset load puts the stored level on this jack too.' }, `until ${driver.name} sends`)
        : driver ? h('span', { class: 'dim', title: 'The jack’s stored level, added to what comes out' }, `+ ${driver.name}`)
        : preset ? `code ${o.directLevel}` : null)),
    perScene(row(ec4Label('Smoothing', `output:${o.index}:smoothing`, ec4), preset ? numberInput(`Smoothing of ${where}`, o.smoothing, { min: 0, max: 127 }, (v) => edit(`Smoothing of ${where}: ${v}`, setSmoothing(o.index, v))) : '—')),
    row('Gate low', voltsInput(`Gate low level of ${where}`, o.gateLevels.low, r, (v) => edit(`Gate levels of ${where}`, setGateLevels(o.index, v, o.gateLevels.high)))),
    row('Gate high', voltsInput(`Gate high level of ${where}`, o.gateLevels.high, r, (v) => edit(`Gate levels of ${where}`, setGateLevels(o.index, o.gateLevels.low, v)))),
  ];
  if (o.lfoReset) rows.push(row('LFO restarts on', `${o.lfoReset.type}`));
  // its calibration on the FH-2, as last read (Settings tab)
  if (calibrations) {
    const c = calibrationOf(calibrations, o.index);
    rows.push(row('Calibration', h('span', { class: 'dim', title: `Read ${new Date(calibrations.at).toLocaleString()}` }, calibrationText(c))));
    // the slots saved for this jack: which loads at power-on, and loading one now
    if (c.startup != null && (c.saved.length || c.startup)) {
      const options = [[0, 'none'], ...[...new Set([...c.saved, ...(c.startup ? [c.startup] : [])])].sort((a, b) => a - b).map((s) => [s, `slot ${s}`])];
      rows.push(row('At power-on', h('select', { 'aria-label': `Power-on calibration of ${where}`, 'data-key': `poweron ${where}`,
        onchange: (e) => act.setPowerOnCalibration?.(o.index, Number(e.target.value)) },
      options.map(([v, t]) => h('option', { value: String(v), selected: v === c.startup }, t)))));
    }
    if (c.saved.length) {
      rows.push(row('Load now', h('span', { class: 'actions' }, c.saved.map((s) => h('button', { type: 'button', class: 'btn small',
        onclick: () => act.loadCalibration?.(o.index, s), title: 'Into the FH-2’s RAM; the power-on slot stays' }, `Slot ${s}`)))));
    }
  }
  // the FH-2's auto-calibration of this jack, with its curve shown live (ui/calibrate.js)
  if (o.present && act.calibrate) {
    rows.push(row(calibrations ? '' : 'Calibration', h('button', { type: 'button', class: 'btn small', onclick: () => act.calibrate(o.index),
      title: 'The FH-2 measures a VCO on input X and draws its curve; you accept it or not' }, 'Calibrate…')));
  }
  return [
    section('Jack settings', rows),
    preset ? null : h('p', { class: 'note' }, 'No preset loaded: no stored level or smoothing.'),
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
          : s.kind === 'hid' ? 'Switch this entry off'
          : ['level', 'knobs', 'lfo'].includes(s.kind) ? 'Clear the jack: level, LFO, smoothing and their CCs' : 'Remove from this jack', onclick: () => act.remove(s, port) }, '×');
    return row(h('button', { type: 'button', class: 'linkish', onclick: () => onSelect({ source: s.id }) }, s.name), [chip(p.name, colors.get(s.id)), remove]);
  };
  const active = o.ports.filter((p) => !p.standby);
  const standby = o.ports.filter((p) => p.standby);
  // what drives the jack besides its own level, LFO and smoothing (a knob or an LFO on its own uses
  // the level), and whether it replaces the level: a voice's pitch does, gate-type outputs have their gate levels
  const d = active.map((p) => ({ p, s: view.sources.find((x) => x.id === p.source) })).find(({ s }) => s && !['level', 'knobs', 'lfo'].includes(s.kind));
  const replaces = !!d && replacesLevel(d.s, d.p.name);
  parts.push(section('Comes out of', active.length ? active.map(portRow) : h('p', { class: 'note' }, 'Nothing: this jack is free.'),
    !d && o.present && h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn' + (active.length ? '' : ' primary'), onclick: () => act.add(o.index) }, 'Add a source…'))));
  if (standby.length) parts.push(section('With a USB device on USB A', standby.map(portRow)));
  // a MIDI knob on this jack: its channel, CC and relative here too, not only on its channel's source
  // (on a jack with an LFO on its own, the CC on its level moves the LFO's centre: the same knob)
  const dc = o.controls.find((m) => m.target.param === 'directLevel');
  const knobs = view.sources.find((x) => x.kind === 'knobs' && x.ports.some((p) => p.output === o.index))
    ?? (dc && { kind: 'knobs', ports: [{ name: `CC ${dc.cc}`, output: o.index, jack: o.jack, cc: dc.cc, channel: dc.channel, relative: dc.relative, slot: dc.slot }] });
  if (knobs) parts.push(h('section', { class: 'section' }, h('h3', {}, 'MIDI knob'), knobEditor(view, knobs, act, o.index)));
  // every CV jack has an LFO: its editor while it's on, else a way to turn it on
  if (o.lfo) {
    parts.push(h('section', { class: 'section' }, h('h3', {}, o.lfo.alone ? 'LFO' : 'LFO on top'), lfoEditor(view, o, act, o.lfo.alone ? colors.get(`lfo:${o.index}`) ?? '#3DD6C6' : '#3DD6C6'),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn per-scene', title: 'With the CCs on its settings', onclick: () => act.removeLfo(o.index, o.jack) }, 'Remove the LFO'))));
  } else if (!o.gate && o.lfoRaw) {
    parts.push(h('div', { class: 'actions' }, d
      ? h('button', { type: 'button', class: 'btn per-scene', title: 'Vibrato on a pitch, wobble on a level',
        onclick: () => act.edit(`LFO on top of jack ${o.jack}`, addLfo(o.index, { shape: 'sine', rate: { hz: 5 }, depth: 0.05 })) }, 'Add an LFO on top')
      : h('button', { type: 'button', class: 'btn per-scene', title: 'A sine at 1 Hz, full depth: change it below',
        onclick: () => act.edit(`LFO on jack ${o.jack}`, addLfo(o.index)) }, 'Add an LFO')));
  }
  if (!o.gate) parts.push(...jackSettings(o, act.edit, act.ec4, { driver: d ? { name: d.s.name, replaces } : null, loadDirect: act.loadDirect, calibrations: act.calibrations, act }));
  if (o.controls.length) parts.push(section('Controlled by MIDI', o.controls.map((m) => mappingRow(m, act))));
  return parts;
}

