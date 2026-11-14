// The Settings tab: what applies to the whole patch rather than to one jack or source. The
// scene's own settings (tempo, swing), the config's (shared by all scenes), the MIDI controls of
// global things, and the FH-2's own settings as last read from its menus (menu.js).

import { h } from '../../vendor/lilypad/js/dom.js';
import { numberInput, selectInput, slider, perScene, ec4Label } from './controls.js';
import { TAP_TYPES, START_STOP_TYPES, PARAM_NAMES, noteName } from '../patch/tables.js';
import { settingsByName, settingsWarnings, settingText, calibrationOf } from '../fh2/menu.js';
import { scalaFiles, voiceTuning } from '../patch/scala.js';

const section = (title, ...rows) => h('section', { class: 'settings-section' }, h('h3', {}, title), rows);
const field = (label, control, unit, title) => h('div', { class: 'erow', title }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, control, unit));
const always = (row) => (row.classList.add('always'), row); // editable under Scenes only too (as on the Scenes tab)
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

  const tuplet = p?.swingType >= 3;
  const L = (text, param) => ec4Label(text, `global:0:${param}`, act.ec4);
  const scene = p && section(`Scene “${sceneName}”`,
    h('div', { class: 'erows' },
      sfield('Name', nameInput('Scene name', p.name, pre('Scene name', 'name'))),
      sfield(L('Tempo', 'tempo'), numberInput('Tempo', (p.tempo / 10).toFixed(1), { min: 10, max: 400, step: 0.1 }, (v) => pre('Tempo (BPM)', 'tempo')(Math.round(v * 10))), ' BPM'),
      sfield(L('Swing', 'swingType'), selectInput('Swing type', p.swingType, SWING_TYPES.map((t, i) => [i, t]), pre('Swing type', 'swingType'))),
      act.ec4 && field(`On the ${act.ec4.name ?? 'EC4'}`, h('span', { class: 'ec4-cmds' }, [['nudgeSlower', 'Nudge −'], ['nudgeFaster', 'Nudge +'], ['tempoDown', 'Tempo −0.1'],
        ['tempoUp', 'Tempo +0.1'], ['displayMode', 'Display'], ['displayItem', 'Display item']].map(([q, t]) => L(t, q)))),
      p.swingType ? sfield(L('Swing amount', 'swingAmount'), slider('Swing amount', p.swingAmount, { min: 0, max: 127, show: (v) => (v ? String(v) : 'none') }, pre('Swing amount', 'swingAmount'))) : null,
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
      always(field('Scenes by program change', selectInput('Preset program change channel', c.presetProgramChannel, [[0, 'off'], ...CHANNELS],
        (v) => act.edit(v ? `Scenes switch by program change on ch ${v}` : 'No scene switching by program change', [{ dump: 'config', path: ['presetProgramChannel'], value: v }], { force: true })), null, 'A program change on this channel loads a preset'))),
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
    globals.map((m) => field(PARAM_NAMES[m.target.param] ?? m.target.param, [h('span', { class: 'dim' }, `ch ${m.channel + 1} · CC ${m.cc}${m.relative ? ' (relative)' : ''}`), ' ',
      act.removeMapping && h('button', { type: 'button', class: 'remove', 'aria-label': `Remove CC ${m.cc} on ch ${m.channel + 1} for ${PARAM_NAMES[m.target.param] ?? m.target.param}`,
        title: 'Remove this CC mapping (off the EC4 too)', onclick: () => act.removeMapping(m) }, '×')]))) : null;

  // the FH-2's own settings, as last read (read only for now: change them on the module); read
  // from here, as its calibrations are
  const module = section('FH-2 settings',
    h('div', { class: 'settings-head' },
      h('button', { type: 'button', class: 'btn', disabled: act.busy, onclick: act.readFh2,
        title: 'Steps through the FH-2’s Settings pages and reads them; changes nothing' }, read ? 'Read FH-2 settings again' : 'Read FH-2 settings'),
      h('span', { class: 'note' }, read ? `Read ${new Date(read.at).toLocaleString()}` : 'Not read yet')),
    read ? [settingsWarnings(settingsByName(read.pages), view).map((w) => h('p', { class: w.level === 'warn' ? 'problem' : 'note' }, w.text)),
      read.pages.map((pg) => readPage(pg))] : null);

  // its calibrations, as last read: each CV jack's startup slot and the slots saved for it
  const cal = act.cal;
  const jacks = view.outputs.filter((o) => o.present && !o.gate);
  const calRows = cal ? jacks.map((o) => [o, calibrationOf(cal, o.index)]).filter(([, c]) => c.startup || c.saved.length)
    .map(([o, c]) => field(`Jack ${o.jack}`, h('span', { class: 'dim' }, calibrationText(c)))) : [];
  // every saved one (a saved slot names its output), with its name, and whether it loads at power-on
  const savedRows = cal ? cal.slots.filter((x) => x.output != null).map((x) => {
    const atPowerOn = cal.startup.some((st) => st.output === x.output && st.slot === x.slot);
    return field(`Slot ${x.slot}`, h('span', { class: x.name ? '' : 'dim' }, [x.name ? `“${x.name}”` : 'unnamed',
      `jack ${view.outputs[x.output]?.jack ?? x.output + 1}`, atPowerOn ? 'at power-on' : null].filter(Boolean).join(' · ')));
  }) : [];
  const calibrations = section('Calibrations',
    h('div', { class: 'settings-head' },
      h('button', { type: 'button', class: 'btn', disabled: act.busy, onclick: act.readCal, title: 'Turns through its calibration pages; loads and changes nothing' },
        cal ? 'Read calibrations again' : 'Read calibrations'),
      h('span', { class: 'note' }, cal ? `${cal.slots.filter((x) => x.output != null).length} of 70 slots used · read ${new Date(cal.at).toLocaleString()}` : 'Not read yet')),
    cal ? (calRows.length ? h('div', { class: 'erows' }, calRows) : h('p', { class: 'note' }, 'No calibration for the jacks in your rack.')) : null,
    savedRows.length ? [h('h4', {}, 'Saved'), h('div', { class: 'erows' }, savedRows)] : null);

  // the Scala files Night Shift installed (the FH-2 can't say what its slots hold), and the voices of
  // this scene using them
  const users = (kind, slot) => (p?.converter ?? []).flatMap((cv, i) => {
    const t = voiceTuning(cv);
    const v = view.sources.find((x) => x.kind === 'voice' && x.index === i);
    return v && t.enable === 1 && t[kind] === slot ? [v.name] : [];
  });
  const scalaRows = (kind) => scalaFiles(act.names, kind).filter(Boolean).map((f) => field(`.${kind} ${f.slot}`, [
    h('span', {}, f.name), users(kind, f.slot).length ? h('span', { class: 'dim' }, ` · ${users(kind, f.slot).join(', ')}`) : null, ' ',
    h('button', { type: 'button', class: 'btn small', disabled: act.busy, onclick: () => act.scala.resend(kind, f.slot), title: 'Into its slot again (on another FH-2, say)' }, 'Send again'), ' ',
    h('button', { type: 'button', class: 'btn small', onclick: () => act.scala.forget(kind, f.slot), title: 'Out of the project only: the FH-2 keeps it' }, 'Forget')]));
  const scala = act.scala && section('Scala files',
    h('div', { class: 'settings-head' },
      h('button', { type: 'button', class: 'btn', disabled: act.busy, onclick: () => act.scala.install('scl') }, 'Install .scl…'),
      h('button', { type: 'button', class: 'btn', disabled: act.busy, onclick: () => act.scala.install('kbm') }, 'Install .kbm…'),
      h('span', { class: 'note' }, '32 slots each, in the FH-2’s flash')),
    [...scalaRows('scl'), ...scalaRows('kbm')].length ? h('div', { class: 'erows' }, scalaRows('scl'), scalaRows('kbm'))
      : h('p', { class: 'note' }, 'None installed from Night Shift yet. A voice picks its scale in its panel (Tuning).'));

  return h('div', { class: 'settings-page masonry' }, scene, config, module, calibrations, scala, controls);
}

// "slot 1 at power-on · saved: 1, 5", from calibrationOf.
export function calibrationText(c) {
  const start = c.startup == null ? null : c.startup ? `slot ${c.startup} at power-on${c.match ? '' : ' (another jack’s)'}` : 'none at power-on';
  const saved = c.saved.length ? `saved: ${c.saved.join(', ')}` : null;
  return [start, saved].filter(Boolean).join(' · ') || '—';
}

// One page of the FH-2's settings as read. MIDI Forwarding gets a row per source, the USB device
// types one row each under a single heading; the rest a row per setting, in words.
const shown = (name, value) => h('span', { class: 'dim', title: `As read: ${value}` }, settingText(name, value));
function readPage(pg) {
  if (pg.page === 'MIDI Forwarding') {
    const bySource = new Map();
    for (const i of pg.items) {
      const [src, dst] = i.name.split(' → ');
      if (!bySource.has(src)) bySource.set(src, []);
      bySource.get(src).push(`${dst} ${i.value}`);
    }
    return [h('h4', {}, 'MIDI forwarding'), h('div', { class: 'erows' }, [...bySource].map(([src, list]) => field(`From ${src}`, h('span', { class: 'dim' }, list.join(' · ')))))];
  }
  if (pg.page.startsWith('USB: ')) {
    const device = pg.page.slice(5);
    const row = field(device, h('span', { class: 'dim' }, pg.items.map((i) => `${i.name} ${settingText(i.name, i.value)}`).join(' · ')));
    return device === 'Generic' ? [h('h4', {}, 'USB devices'), h('div', { class: 'erows' }, row)] : h('div', { class: 'erows' }, row);
  }
  return [h('h4', {}, pg.page), h('div', { class: 'erows' }, pg.items.map((i) => field(i.name, shown(i.name, i.value))))];
}
