// The Settings tab: what applies to the whole patch rather than to one jack or source. The
// scene's own settings (tempo, swing), the config's (shared by all scenes), the MIDI controls of
// global things, and the FH-2's own settings as last read from its menus (menu.js).

import { h } from '../../vendor/lilypad/js/dom.js';
import { numberInput, selectInput, slider, perScene } from './controls.js';
import { TAP_TYPES, START_STOP_TYPES, PARAM_NAMES, noteName } from '../patch/tables.js';
import { settingsByName, settingsWarnings } from '../fh2/menu.js';

const section = (title, ...rows) => h('section', { class: 'settings-section' }, h('h3', {}, title), rows);
const field = (label, control, unit, title) => h('div', { class: 'erow', title }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, control, unit));
const sfield = (...a) => perScene(field(...a));
const CHANNELS = Array.from({ length: 16 }, (_, c) => [c + 1, `ch ${c + 1}`]); // these settings store channels 1–16
const ONOFF = [[0, 'Off'], [1, 'On']];
const SWING_TYPES = ['Off', '16th note', '8th note', 'Pentuplet', 'Sextuplet', 'Septuplet', 'Octuplet', 'Nonuplet'];
const NOTES = Array.from({ length: 128 }, (_, n) => [n, `${noteName(n)} (${n})`]);
const CCS = Array.from({ length: 128 }, (_, n) => [n, `CC ${n}`]);

function nameInput(label, value, commit) {
  return h('input', { type: 'text', class: 'text', maxlength: 16, value: value.trim(), 'aria-label': label, 'data-key': label,
    onchange: (e) => commit(e.target.value.trim().slice(0, 16)) });
}

// `c` and `p` are the config's and the scene's values. `act`: { edit, fh2 (as last read, or
// null), readFh2(), busy }.
export function renderSettings(view, c, p, sceneName, act) {
  const cfg = (label, key) => (v) => act.edit(`${label}: ${v}`, [{ dump: 'config', path: [key], value: v }]);
  const pre = (label, key) => (v) => act.edit(`${label}: ${v}`, [{ dump: 'preset', path: [key], value: v }]);

  const read = act.fh2;
  const head = h('div', { class: 'settings-head' },
    h('button', { type: 'button', class: 'btn', disabled: act.busy, onclick: act.readFh2,
      title: 'Steps through the FH-2’s Settings pages and reads them; changes nothing' }, read ? 'Read FH-2 settings again' : 'Read FH-2 settings'),
    h('span', { class: 'note' }, read ? `Last read ${new Date(read.at).toLocaleString()}` : 'Not read yet'));

  const tuplet = p?.swingType >= 3;
  const scene = p && section(`Scene “${sceneName}”`,
    h('div', { class: 'erows' },
      sfield('Name', nameInput('Scene name', p.name, pre('Scene name', 'name'))),
      sfield('Tempo', numberInput('Tempo', (p.tempo / 10).toFixed(1), { min: 10, max: 400, step: 0.1 }, (v) => pre('Tempo (BPM)', 'tempo')(Math.round(v * 10))), ' BPM'),
      sfield('Swing', selectInput('Swing type', p.swingType, SWING_TYPES.map((t, i) => [i, t]), pre('Swing type', 'swingType'))),
      p.swingType ? sfield('Swing amount', slider('Swing amount', p.swingAmount, { min: 0, max: 127, show: (v) => (v ? String(v) : 'none') }, pre('Swing amount', 'swingAmount'))) : null,
      tuplet ? sfield('16th positions', [1, 2, 3].map((n) => numberInput(`Swing position ${n}`, p[`swingPosition${n}`], { min: 0, max: 127 }, pre(`Swing position ${n}`, `swingPosition${n}`))),
        null, 'Where the 2nd, 3rd and 4th 16th notes fall within the beat') : null));

  const config = section(`Config “${c.name.trim() || 'untitled'}”`,
    h('div', { class: 'erows' },
      field('Name', nameInput('Config name', c.name, cfg('Config name', 'name'))),
      field('Trigger length', numberInput('Trigger length', c.triggerLength, { min: 1, max: 100 }, cfg('Trigger length (ms)', 'triggerLength')), ' ms'),
      field('Global transpose', numberInput('Global transpose', c.transpose, { min: -48, max: 48 }, cfg('Global transpose', 'transpose')), ' semitones'),
      field('Legato velocity', selectInput('Legato velocity', c.legatoVelocity, [[0, 'Each note’s own'], [1, 'First note of a phrase']], cfg('Legato velocity', 'legatoVelocity')), null, 'Mono voices'),
      field('Soft takeover', selectInput('Soft takeover', c.softTakeover, ONOFF, cfg('Soft takeover', 'softTakeover'))),
      field('Euclid accent', numberInput('Euclid accent', c.euclidAccent, { min: 0, max: 127 }, cfg('Euclid accent', 'euclidAccent')), null, 'Level of unaccented pulses when accents are on'),
      field('Scenes by PC', selectInput('Preset program change channel', c.presetProgramChannel, [[0, 'off'], ...CHANNELS], cfg('Preset program change channel', 'presetProgramChannel')), null, 'Program change switches presets')),
    h('h4', {}, 'External clock'),
    h('div', { class: 'erows' },
      field('Multiplier', numberInput('External clock multiplier', c.extClockMultiplier, { min: 1, max: 96 }, cfg('External clock multiplier', 'extClockMultiplier')), null, '24: quarter-note clocks; 1: 24 ppqn'),
      field('Run control', selectInput('External clock run control', c.extClockRunControl, [[0, 'None'], [1, 'Run/stop on Y']], cfg('External clock run control', 'extClockRunControl')))),
    h('h4', {}, 'Tap tempo and start/stop'),
    h('div', { class: 'erows' },
      field('Tap tempo', selectInput('Tap tempo by', c.tapType, TAP_TYPES.map((t, i) => [i, t || 'None']), cfg('Tap tempo by', 'tapType'))),
      c.tapType ? field('Tap on', [selectInput('Tap tempo channel', c.tapChannel, CHANNELS, cfg('Tap tempo channel', 'tapChannel')),
        selectInput('Tap tempo note or CC', c.tapNumber, c.tapType === 1 ? NOTES : CCS, cfg('Tap tempo note or CC', 'tapNumber'))]) : null,
      field('Start/stop', selectInput('Start/stop by', c.startStopType, START_STOP_TYPES.map((t, i) => [i, t || 'None']), cfg('Start/stop by', 'startStopType'))),
      c.startStopType >= 1 && c.startStopType <= 4 ? field('Start/stop on', [selectInput('Start/stop channel', c.startStopChannel, CHANNELS, cfg('Start/stop channel', 'startStopChannel')),
        selectInput('Start/stop note or CC', c.startStopNumber, c.startStopType === 1 || c.startStopType === 3 ? NOTES : CCS, cfg('Start/stop note or CC', 'startStopNumber'))]) : null),
    h('h4', {}, 'Tempo by CC'),
    h('div', { class: 'erows' },
      field('At CC 0', numberInput('Tempo at CC 0', c.tempoMin + 1, { min: 1, max: 128 }, (v) => cfg('Tempo at CC 0', 'tempoMin')(v - 1)), null, 'As Expert Sleepers’ tool numbers it (check 18)'),
      field('At CC 127', numberInput('Tempo at CC 127', c.tempoMax + 1, { min: 1, max: 128 }, (v) => cfg('Tempo at CC 127', 'tempoMax')(v - 1)), null, 'As Expert Sleepers’ tool numbers it (check 18)')));

  // the MIDI controls of global things (tempo, swing, display…), from the CC mappings
  const globals = view.mappings.filter((m) => m.target.kind === 'global');
  const controls = globals.length ? section('Controlled by MIDI',
    globals.map((m) => field(PARAM_NAMES[m.target.param] ?? m.target.param, h('span', { class: 'dim' }, `ch ${m.channel + 1} · CC ${m.cc}${m.relative ? ' (relative)' : ''}`)))) : null;

  // the FH-2's own settings, as last read (read only for now: change them on the module)
  const module = read && section('FH-2 settings',
    settingsWarnings(settingsByName(read.pages), view).map((w) => h('p', { class: w.level === 'warn' ? 'problem' : 'note' }, w.text)),
    read.pages.map((pg) => [h('h4', {}, pg.page), h('div', { class: 'erows' }, pg.items.map((i) => field(i.name, h('span', { class: 'dim' }, i.value))))]));

  return h('div', { class: 'settings-page' }, head, scene, config, module, controls);
}
