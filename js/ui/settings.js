// The Settings tab: what applies to the whole patch rather than to one jack or source. The
// config's global settings (shared by all scenes), the scene's own (tempo, swing), and the MIDI
// controls of global things. The FH-2's own menu settings come later (read through its menus).

import { h } from '../../vendor/lilypad/js/dom.js';
import { numberInput, selectInput, slider, perScene } from './controls.js';
import { TAP_TYPES, START_STOP_TYPES, PARAM_NAMES, noteName } from '../patch/tables.js';

const section = (title, note, ...rows) => h('section', { class: 'settings-section' }, h('h3', {}, title), note && h('p', { class: 'note' }, note), rows);
const field = (label, control, hint) => h('div', { class: 'erow' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, control, hint && h('small', {}, hint)));
const sfield = (...a) => perScene(field(...a));
const CHANNELS = Array.from({ length: 16 }, (_, c) => [c + 1, String(c + 1)]); // these settings store channels 1–16
const ONOFF = [[0, 'Off'], [1, 'On']];
const SWING_TYPES = ['Off', '16th note', '8th note', 'Pentuplet', 'Sextuplet', 'Septuplet', 'Octuplet', 'Nonuplet'];

function nameInput(label, value, commit) {
  return h('input', { type: 'text', class: 'text', maxlength: 16, value: value.trim(), 'aria-label': label, 'data-key': label,
    onchange: (e) => commit(e.target.value.trim().slice(0, 16)) });
}

// `c` and `p` are the config's and the scene's values; `act.edit(label, changes)`.
export function renderSettings(view, c, p, sceneName, act) {
  const cfg = (label, key) => (v) => act.edit(`${label}: ${v}`, [{ dump: 'config', path: [key], value: v }]);
  const pre = (label, key) => (v) => act.edit(`${label}: ${v}`, [{ dump: 'preset', path: [key], value: v }]);
  const numberOrNote = (type, isNote) => (isNote(type) ? Array.from({ length: 128 }, (_, n) => [n, `${noteName(n)} (${n})`]) : Array.from({ length: 128 }, (_, n) => [n, `CC ${n}`]));

  const config = section(`Config “${c.name.trim() || 'untitled'}”`, 'Shared by every scene of this config.',
    h('div', { class: 'erows' },
      field('Name', nameInput('Config name', c.name, cfg('Config name', 'name')), '16 characters, shown on the FH-2'),
      field('Trigger length', numberInput('Trigger length', c.triggerLength, { min: 1, max: 100 }, cfg('Trigger length (ms)', 'triggerLength')), ' ms, for every trigger'),
      field('Global transpose', numberInput('Global transpose', c.transpose, { min: -48, max: 48 }, cfg('Global transpose', 'transpose')), ' semitones, every voice'),
      field('Legato velocity', selectInput('Legato velocity', c.legatoVelocity, [[0, 'Each note’s own'], [1, 'First note of a phrase']], cfg('Legato velocity', 'legatoVelocity')), 'mono voices'),
      field('Soft takeover', selectInput('Soft takeover', c.softTakeover, ONOFF, cfg('Soft takeover', 'softTakeover')), 'a CC acts only once it passes the stored value'),
      field('Euclid accent', numberInput('Euclid accent', c.euclidAccent, { min: 0, max: 127 }, cfg('Euclid accent', 'euclidAccent')), 'level of the unaccented pulses, when accents are on'),
      field('Scenes by program change', selectInput('Preset program change channel', c.presetProgramChannel, [[0, 'off'], ...CHANNELS.map(([v, t]) => [v, `ch ${t}`])], cfg('Preset program change channel', 'presetProgramChannel')))),
    h('h4', {}, 'External clock'),
    h('div', { class: 'erows' },
      field('Multiplier', numberInput('External clock multiplier', c.extClockMultiplier, { min: 1, max: 96 }, cfg('External clock multiplier', 'extClockMultiplier')), '24: quarter-note clocks on X, 1: 24 ppqn'),
      field('Run control', selectInput('External clock run control', c.extClockRunControl, [[0, 'None: runs while pulses come'], [1, 'Run/stop on Y']], cfg('External clock run control', 'extClockRunControl')))),
    h('h4', {}, 'Tap tempo and start/stop by MIDI'),
    h('div', { class: 'erows' },
      field('Tap tempo', selectInput('Tap tempo by', c.tapType, TAP_TYPES.map((t, i) => [i, t || 'None']), cfg('Tap tempo by', 'tapType'))),
      c.tapType ? field('Tap on', [selectInput('Tap tempo channel', c.tapChannel, CHANNELS.map(([v, t]) => [v, `ch ${t}`]), cfg('Tap tempo channel', 'tapChannel')),
        selectInput('Tap tempo note or CC', c.tapNumber, numberOrNote(c.tapType, (t) => t === 1), cfg('Tap tempo note or CC', 'tapNumber'))]) : null,
      field('Start/stop', selectInput('Start/stop by', c.startStopType, START_STOP_TYPES.map((t, i) => [i, t || 'None']), cfg('Start/stop by', 'startStopType'))),
      c.startStopType >= 1 && c.startStopType <= 4 ? field('Start/stop on', [selectInput('Start/stop channel', c.startStopChannel, CHANNELS.map(([v, t]) => [v, `ch ${t}`]), cfg('Start/stop channel', 'startStopChannel')),
        selectInput('Start/stop note or CC', c.startStopNumber, numberOrNote(c.startStopType, (t) => t === 1 || t === 3), cfg('Start/stop note or CC', 'startStopNumber'))]) : null),
    h('h4', {}, 'Tempo by CC'),
    h('div', { class: 'erows' },
      field('At CC 0', numberInput('Tempo at CC 0', c.tempoMin + 1, { min: 1, max: 128 }, (v) => cfg('Tempo at CC 0', 'tempoMin')(v - 1))),
      field('At CC 127', numberInput('Tempo at CC 127', c.tempoMax + 1, { min: 1, max: 128 }, (v) => cfg('Tempo at CC 127', 'tempoMax')(v - 1)),
        'numbered as Expert Sleepers’ tool does; what they are in BPM is check 18')));

  // the MIDI controls of global things (tempo, swing, display…), from the CC mappings
  const globals = view.mappings.filter((m) => m.target.kind === 'global');
  const controls = section('Controlled by MIDI', null, globals.length
    ? globals.map((m) => field(PARAM_NAMES[m.target.param] ?? m.target.param, h('span', { class: 'dim' }, `ch ${m.channel + 1} · CC ${m.cc}${m.relative ? ' (relative)' : ''}`)))
    : h('p', { class: 'note' }, 'No CC controls the tempo, swing or display.'));

  const tuplet = p?.swingType >= 3;
  const scene = p && section(`Scene “${sceneName}”`, 'Kept per scene (in the preset).',
    h('div', { class: 'erows' },
      sfield('Name', nameInput('Scene name', p.name, pre('Scene name', 'name')), 'the preset’s name on the FH-2'),
      sfield('Tempo', numberInput('Tempo', (p.tempo / 10).toFixed(1), { min: 10, max: 400, step: 0.1 }, (v) => pre('Tempo (BPM)', 'tempo')(Math.round(v * 10))), ' BPM'),
      sfield('Swing', selectInput('Swing type', p.swingType, SWING_TYPES.map((t, i) => [i, t]), pre('Swing type', 'swingType'))),
      p.swingType ? sfield('Swing amount', slider('Swing amount', p.swingAmount, { min: 0, max: 127, show: (v) => (v ? String(v) : 'none') }, pre('Swing amount', 'swingAmount'))) : null,
      tuplet ? sfield('16th positions', [1, 2, 3].map((n) => numberInput(`Swing position ${n}`, p[`swingPosition${n}`], { min: 0, max: 127 }, pre(`Swing position ${n}`, `swingPosition${n}`)))) : null),
    h('p', { class: 'note' }, 'Swing applies to everything on the FH-2’s own clock: clocks, Euclid patterns, sequencers.' + (tuplet ? ' With a tuplet swing, the three numbers place the 2nd, 3rd and 4th 16th notes within the beat.' : '')));

  const module = section('The FH-2’s own settings', 'Settings in the module’s Settings menu (MIDI routing, USB, clock sources, the display, the left button…) aren’t in the config or the preset, so no file or dump carries them. Night Shift will read them through the module’s remote control next; until then, set them on the module.');

  return h('div', { class: 'settings-page' }, scene, config, controls, module);
}
