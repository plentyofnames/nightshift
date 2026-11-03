// Night Shift: on opening, show the patch kept in this browser and read the FH-2 beside it;
// see the rack and what comes out of every jack; edit, undo, keep several scenes (presets) for
// one config, and send the result to the module or get the module's patch. Files (projects,
// .syx dumps) and the example are in the File menu.

import { h, $, replace, download, modal } from '../vendor/lilypad/js/dom.js';
import { parseDump, buildDump, splitSysex, commandOf, DUMPS } from './fh2/sysex.js';
import { diff } from './fh2/layout.js';
import { derive } from './patch/derive.js';
import { History, removePort, removeSource, setName, changesTowards } from './patch/edit.js';
import { examplePatch } from './patch/example.js';
import { projectToJson, projectFromJson, PROJECT_EXTENSION } from './patch/project.js';
import { DEFAULT_HARDWARE, validHardware, blockName } from './patch/hardware.js';
import { colorsFor } from './ui/look.js';
import { renderStage } from './ui/rack.js';
import { renderInspector } from './ui/inspector.js';
import { renderMidiMap } from './ui/midimap.js';
import { addToJack } from './ui/add.js';
import { setUpPlayerDialog } from './ui/players.js';
import { fh2Ports, looksLikeFh2, pullFromFh2, sendToFh2, saveToFlash, saveAllToFlash, watchFh2 } from './ui/connect.js';
import { renderScenes } from './ui/scenes.js';
import { sceneDifferences, fitProblems } from './patch/scenes.js';

const HW_KEY = 'nightshift.hardware';
const PATCH_KEY = 'nightshift.patch'; // the last patch, as a project, kept after every change
const state = {
  config: null, // parsed dumps (sysex.js parseDump); their values are what gets edited
  preset: null, // the scene in view: scenes[scene]
  scenes: [], // parsed preset dumps, one per scene
  scene: 0,
  slots: { config: null, scenes: [] }, // flash slots (1–30) for the config and each scene, null where none
  scenesOnly: false, // while on, edits that change the config are refused
  names: {}, // Night Shift's own names beside the dumps (edit.js setName)
  from: '',
  hardware: loadHardware(),
  history: new History(),
  module: null, // the values the FH-2 holds, as last read or sent: { config, preset }, or null
  link: 'unknown', // 'connecting', 'connected', 'offline' (no FH-2 port) or 'no-midi' (the browser refuses)
  port: '',
  sync: null, // how what you see compares with the FH-2: { kind: 'same' | 'scene' | 'differs' | 'unknown', scene }
  unsent: false, // what you see isn't what the FH-2 holds (or we don't know what it holds)
  busy: false,
  view: null,
  colors: new Map(),
  selected: null,
  tab: 'patch',
  status: '',
  warn: false,
};

function loadHardware() {
  try {
    return validHardware(JSON.parse(localStorage.getItem(HW_KEY))) ?? DEFAULT_HARDWARE;
  } catch {
    return DEFAULT_HARDWARE;
  }
}

function saveHardware(hw) {
  try {
    localStorage.setItem(HW_KEY, JSON.stringify(hw));
  } catch {}
}

function status(text, warn = false) {
  state.status = text;
  state.warn = warn;
  render();
}

const patch = () => ({ config: state.config, preset: state.preset, names: state.names });
const values = () => ({ config: state.config.values, preset: state.preset?.values ?? null, names: state.names });
const snapshot = () => structuredClone({ config: state.config?.values ?? null, preset: state.preset?.values ?? null });
const readModule = (r) => { state.module = structuredClone({ config: r.config.values, preset: r.preset.values }); };
const sceneName = (i) => state.scenes[i]?.values.name.trim() || `Scene ${'ABCDEFGHIJKLMNOP'[i] ?? i + 1}`;

// What you see against what the FH-2 holds: the same, another scene of yours, or different.
function syncOf() {
  if (!state.module) return { kind: 'unknown' };
  const same = (d, v) => diff(DUMPS[d.cmd].layout, d.values, v).length === 0;
  if (!same(state.config, state.module.config)) return { kind: 'differs' };
  if (!state.preset || same(state.preset, state.module.preset)) return { kind: 'same' };
  const other = state.scenes.findIndex((s) => same(s, state.module.preset));
  return other >= 0 ? { kind: 'scene', scene: other } : { kind: 'differs' };
}

// ---- the patch kept in this browser (not the example, which would replace yours)

const project = () => ({ config: state.config, scenes: state.scenes, scene: state.scene, names: state.names, hardware: state.hardware,
  slots: state.slots, scenesOnly: state.scenesOnly });

let storeTimer = null;
function store() {
  if (!state.config || state.from === 'example') return;
  clearTimeout(storeTimer);
  storeTimer = setTimeout(() => {
    try {
      localStorage.setItem(PATCH_KEY, projectToJson(project()));
    } catch {}
  }, 300);
}

function stored() {
  try {
    const text = localStorage.getItem(PATCH_KEY);
    return text ? projectFromJson(text) : null;
  } catch {
    return null;
  }
}

function update() {
  state.view = state.config ? derive(state.config.values, state.preset?.values ?? null, state.hardware, state.names) : null;
  state.colors = state.view ? colorsFor([...state.view.sources, ...state.view.players], state.colors) : new Map();
  state.sync = state.config ? syncOf() : null;
  state.unsent = state.config ? state.sync.kind !== 'same' : false;
  store();
  render();
}

// `presets` become the scenes (`scene` the one in view); a single `preset` is one scene. What
// the FH-2 holds stays as it is: the mark compares the new patch with it.
function load({ config, preset, presets, scene = 0, names, hardware, slots, scenesOnly }, from) {
  if (config) state.config = config;
  const scenes = presets?.length ? presets : preset ? [preset] : null;
  if (scenes) {
    state.scenes = scenes;
    state.scene = Math.min(scene, scenes.length - 1);
    state.slots = slots ?? { config: null, scenes: scenes.map(() => null) };
  }
  state.scenesOnly = scenesOnly ?? state.scenes.length > 1;
  state.preset = state.scenes[state.scene] ?? null;
  if (hardware) {
    state.hardware = hardware;
    saveHardware(hardware);
  }
  state.names = names ?? (config ? {} : state.names);
  state.from = from;
  state.selected = null;
  state.colors = new Map(); // a new patch gets fresh colours
  state.history = new History();
  update();
}

// ---- editing

// `force`: for Get from FH-2 and the Scenes page, which may change the config while
// “Scenes only” is on.
function edit(label, changes, { force = false } = {}) {
  if (state.scenesOnly && !force && changes.some((c) => c.dump === 'config')) {
    state.status = 'That changes the setup, which all scenes share. Switch off “Scenes only” to change it.';
    state.warn = true;
    return render();
  }
  try {
    if (state.history.do(patch(), label, changes, { scene: state.scene })) {
      state.status = label;
      state.warn = false;
    }
  } catch (e) {
    state.status = `Couldn’t change that: ${e.message}`;
    state.warn = true;
  }
  update();
}

// The "+ add" dialog for an empty jack.
async function addTo(output) {
  try {
    const r = await addToJack(state.view, values(), state.view.outputs[output]);
    if (r) edit(r.label, r.changes);
  } catch (e) {
    status(`Couldn’t add that: ${e.message}`, true);
  }
}

// Takes `source` off one jack (`port`), or off all of its jacks.
function remove(source, port) {
  try {
    const where = port ? ` ${source.kind === 'hid' ? 'on' : 'from'} jack ${port.jack}` : '';
    edit(`${source.kind === 'hid' ? 'Switched off' : 'Removed'} ${source.name}${port && source.ports.length > 1 ? ` ${port.name}` : ''}${where}`,
      port ? removePort(values(), source, port) : removeSource(values(), source));
    if (!port) state.selected = null;
    render();
  } catch (e) {
    status(`Couldn’t remove that: ${e.message}`, true);
  }
}

// A player that sends somewhere, picked from the FH-2's unused ones (see ui/players.js).
async function setUpPlayer() {
  try {
    const r = await setUpPlayerDialog(state.view, values());
    if (!r) return;
    edit(r.label, r.changes);
    state.selected = { player: r.id };
    render();
  } catch (e) {
    status(`Couldn’t set that up: ${e.message}`, true);
  }
}

// Renaming a source or player: Night Shift keeps the name beside the dumps.
async function rename(id, now, original) {
  const input = h('input', { type: 'text', class: 'text', value: now, maxlength: 40, 'aria-label': 'Name' });
  const ok = modal($('dialog'), {
    title: `Rename ${now}`,
    body: [input, h('p', { class: 'note' }, `Leave it empty for the FH-2’s own name${original ? ` (${original})` : ''}. Names are kept in the project file, not on the module.`)],
    buttons: [{ label: 'Cancel', value: false }, { label: 'Rename', value: true, primary: true }],
  });
  input.focus();
  input.select();
  input.onkeydown = (e) => e.key === 'Enter' && $('dialog').querySelector('button.primary').click();
  if (await ok) edit(input.value.trim() ? `Renamed ${now} to ${input.value.trim()}` : `${now} back to ${original ?? 'its own name'}`, setName(id, input.value));
}

const isFree = (o) => o.present && !o.ports.some((p) => !p.standby);

// Undo and redo go back to the scene a step was made in first.
function toStepScene(step) {
  const i = step?.meta?.scene;
  if (i != null && i !== state.scene && state.scenes[i]) {
    state.scene = i;
    state.preset = state.scenes[i];
  }
}

function undo() {
  toStepScene(state.history.nextUndo);
  const label = state.history.undo(patch());
  if (label) {
    state.status = `Undid: ${label}`;
    state.warn = false;
    update();
  }
}

function redo() {
  toStepScene(state.history.nextRedo);
  const label = state.history.redo(patch());
  if (label) {
    state.status = `Redid: ${label}`;
    state.warn = false;
    update();
  }
}

// ---- scenes: several presets for one config

function setScene(i) {
  if (!state.scenes[i] || i === state.scene) return;
  state.scene = i;
  state.preset = state.scenes[i];
  state.status = `Scene ${sceneName(i)}`;
  state.warn = false;
  update();
}

// A new scene starts as a copy of the one in view.
function addScene() {
  if (!state.preset) return status('Open or get a preset first: scenes are presets.', true);
  const copy = structuredClone(state.preset);
  const letter = 'ABCDEFGHIJKLMNOP'[state.scenes.length] ?? String(state.scenes.length + 1);
  copy.values.name = `Scene ${letter}`;
  state.scenes.splice(state.scene + 1, 0, copy);
  state.slots.scenes.splice(state.scene + 1, 0, null);
  shiftSteps(state.scene + 1, 1);
  state.scene += 1;
  state.preset = copy;
  const lock = state.scenes.length === 2 && !state.scenesOnly;
  if (lock) state.scenesOnly = true;
  status(`Added scene ${letter}, a copy of ${sceneName(state.scene - 1)}${lock ? '. “Scenes only” is on: the config stays as it is' : ''}`);
  update();
}

async function removeScene() {
  if (state.scenes.length < 2) return;
  const name = sceneName(state.scene);
  const ok = await modal($('dialog'), {
    title: `Remove scene ${name}?`,
    body: h('p', { class: 'note' }, 'Its levels, LFOs, patterns and voice settings go with it. This can’t be undone.'),
    buttons: [{ label: 'Cancel', value: false }, { label: 'Remove', value: true, primary: true }],
  });
  if (!ok) return;
  const gone = state.scene;
  state.scenes.splice(gone, 1);
  state.slots.scenes.splice(gone, 1);
  // steps made in the removed scene can't be undone any more; later scenes move down one
  state.history.done = state.history.done.filter((s) => s.meta?.scene !== gone);
  state.history.undone = state.history.undone.filter((s) => s.meta?.scene !== gone);
  shiftSteps(gone + 1, -1);
  state.scene = Math.min(gone, state.scenes.length - 1);
  state.preset = state.scenes[state.scene];
  status(`Removed scene ${name}`);
  update();
}

// Undo steps remember their scene by number; inserting or removing a scene renumbers them.
function shiftSteps(from, by) {
  for (const s of [...state.history.done, ...state.history.undone]) if (s.meta?.scene >= from) s.meta.scene += by;
}

function toggleScenesOnly() {
  state.scenesOnly = !state.scenesOnly;
  status(state.scenesOnly ? '“Scenes only” is on: only what a scene holds can change' : '“Scenes only” is off: the config can change too, for every scene');
  update();
}

function setSlot(which, slot) {
  if (which === 'config') state.slots.config = slot;
  else state.slots.scenes[which] = slot;
  update();
}

// The scenes and their slots, for the Scenes page.
function scenesModel(v) {
  const onModule = (i) => (state.sync?.kind === 'same' ? i === state.scene : state.sync?.kind === 'scene' && state.sync.scene === i);
  return {
    configName: v.globals.name || 'untitled', configSlot: state.slots.config,
    programChannel: state.config.values.presetProgramChannel, scenesOnly: state.scenesOnly,
    scenes: state.scenes.map((s, i) => ({
      name: sceneName(i), slot: state.slots.scenes[i], current: i === state.scene, onModule: onModule(i),
      differences: i ? sceneDifferences(state.scenes[0].values, s.values, state.hardware) : [],
      fit: fitProblems(i === state.scene ? v : derive(state.config.values, s.values, state.hardware, state.names), state.config.values, s.values),
    })),
  };
}

async function saveAll() {
  const list = state.scenes.map((_, i) => `${sceneName(i)} → preset slot ${state.slots.scenes[i]}`);
  const ok = await modal($('dialog'), {
    title: 'Save everything to the FH-2’s flash?',
    body: [h('p', { class: 'note' }, 'This replaces what is in these slots now:'),
      h('ul', { class: 'note' }, h('li', {}, `the config → config slot ${state.slots.config}`), list.map((t) => h('li', {}, t))),
      h('p', { class: 'note' }, `Each is sent to the FH-2 and saved; then scene ${sceneName(state.scene)} goes back onto the module.`)],
    buttons: [{ label: 'Cancel', value: false }, { label: 'Save all', value: true, primary: true }],
  });
  if (!ok) return;
  await withFh2(async (pair) => {
    status(`Saving to ${pair.name}’s flash…`);
    const r = await saveAllToFlash(pair, {
      config: state.config, configSlot: state.slots.config,
      scenes: state.scenes.map((dump, i) => ({ dump, slot: state.slots.scenes[i] })), back: state.preset,
    });
    readModule(r);
    Object.assign(state, { link: 'connected', port: pair.name });
    update();
    status(`Saved the config to slot ${state.slots.config} and ${state.scenes.length} ${state.scenes.length === 1 ? 'scene' : 'scenes'} to their slots on ${pair.name}`);
  });
}

async function renameScene() {
  const input = h('input', { type: 'text', class: 'text', value: sceneName(state.scene), maxlength: 16, 'aria-label': 'Scene name' });
  const ok = modal($('dialog'), {
    title: 'Rename this scene',
    body: [input, h('p', { class: 'note' }, 'It is the preset’s name on the FH-2 too (16 characters).')],
    buttons: [{ label: 'Cancel', value: false }, { label: 'Rename', value: true, primary: true }],
  });
  input.focus();
  input.select();
  input.onkeydown = (e) => e.key === 'Enter' && $('dialog').querySelector('button.primary').click();
  if (await ok) edit(`Scene renamed to ${input.value.trim()}`, [{ dump: 'preset', path: ['name'], value: input.value.trim().slice(0, 16) }]);
}

// ---- opening files: .syx dumps (several presets become scenes) or a project

async function openFiles(files) {
  const found = { presets: [] };
  const notes = [];
  for (const f of files) {
    if (/\.json$/i.test(f.name)) {
      try {
        const project = projectFromJson(await f.text());
        if (!(await dropUnsent('Opening'))) return;
        load({ config: project.config, presets: project.scenes, scene: project.scene, names: project.names, hardware: project.hardware, slots: project.slots, scenesOnly: project.scenesOnly }, f.name);
        return status(`Opened project ${f.name}: ${project.scenes.length} ${project.scenes.length === 1 ? 'scene' : 'scenes'}`);
      } catch (e) {
        return status(`${f.name}: ${e.message}`, true);
      }
    }
    const msgs = splitSysex(new Uint8Array(await f.arrayBuffer()));
    let used = 0;
    for (const m of msgs) {
      if (!DUMPS[commandOf(m)]) continue;
      try {
        const d = parseDump(m);
        if (!d.versionOk) notes.push(`${f.name}: ${d.kind} version ${d.values.version}, expected ${DUMPS[d.cmd].version}`);
        if (d.kind === 'preset') found.presets.push(d);
        else found.config = d;
        used++;
      } catch (e) {
        notes.push(`${f.name}: ${e.message}`);
      }
    }
    if (!used) notes.push(`${f.name}: no FH-2 config or preset in it`);
  }
  if (!found.config && !state.config) {
    status(notes.join(' · ') || 'Open a config dump (it may come with a preset).', true);
    return;
  }
  if (!(await dropUnsent('Opening'))) return;
  load(found, [...files].map((f) => f.name).join(', '));
  const what = [found.config && 'config', found.presets.length && `${found.presets.length} ${found.presets.length === 1 ? 'preset' : 'presets (one scene each)'}`].filter(Boolean);
  status(['Opened ' + what.join(' and '), ...notes].join(' · '), notes.length > 0);
}

function saveProject() {
  const name = (state.view.globals.name || 'fh2').trim().replace(/[^\w.-]+/g, '_');
  download(projectToJson(project()), name + PROJECT_EXTENSION);
  status(`Saved the project: config, ${state.scenes.length} ${state.scenes.length === 1 ? 'scene' : 'scenes'}, names`);
}

function pickFiles() {
  const input = h('input', { type: 'file', accept: '.syx,.json,application/json,application/octet-stream', multiple: true });
  input.onchange = () => openFiles(input.files);
  input.click();
}

// Asks before a file or the example replaces edits that aren't on the FH-2.
async function dropUnsent(what) {
  if (!state.history.canUndo || !state.unsent) return true;
  return modal($('dialog'), {
    title: 'Replace your changes?',
    body: h('p', { class: 'note' }, `${what} replaces what you see, and your changes aren’t on the FH-2. Save the project first to keep them.`),
    buttons: [{ label: 'Cancel', value: false }, { label: 'Drop them', value: true, primary: true }],
  });
}

// ---- the FH-2

async function pickFh2() {
  status('Looking for the FH-2…');
  const pairs = await fh2Ports();
  if (!pairs.length) {
    status('No MIDI ports found. Is the FH-2 connected over USB C?', true);
    return null;
  }
  if (looksLikeFh2(pairs[0])) return pairs[0];
  const pick = await modal($('dialog'), {
    title: 'Which port is the FH-2?',
    body: h('p', { class: 'note' }, 'No port is called “FH-2”. Pick the one it is connected to (it may have been renamed in its settings).'),
    buttons: [...pairs.map((p, i) => ({ label: p.name, value: i })), { label: 'Cancel', value: null }],
  });
  if (pick == null) {
    status('');
    return null;
  }
  return pairs[pick];
}

async function withFh2(work) {
  if (state.busy) return;
  state.busy = true;
  try {
    const pair = await pickFh2();
    if (pair) await work(pair);
  } catch (e) {
    status(refused(e) ? 'This browser didn’t allow MIDI access. Allow it for this page (the icon in the address bar), or use Chrome or Edge.'
      : `The FH-2 didn’t answer: ${e.message}`, true);
  } finally {
    state.busy = false;
    render();
  }
}

// Get from FH-2: the module's config and preset become what you see, in the scene in view.
// It's an edit of the fields that differ, so undo takes you back.

function get() {
  return withFh2(async (pair) => {
    status(`Asking ${pair.name} for its config and preset…`);
    const r = await pullFromFh2(pair);
    readModule(r);
    Object.assign(state, { link: 'connected', port: pair.name });
    const odd = r.config.versionOk ? '' : ' · unexpected config version';
    if (!state.config || !state.preset) {
      load({ config: r.config, preset: r.preset }, `${pair.name}, ${r.version}`);
      return status(`Got the patch from ${pair.name} (${r.version})${odd}`, !!odd);
    }
    const changes = [...changesTowards('config', state.config, r.config.values), ...changesTowards('preset', state.preset, r.preset.values)];
    if (!changes.length) {
      update();
      return status(`Already the same as ${pair.name}`);
    }
    edit(`Got the patch from ${pair.name}${state.scenes.length > 1 ? ` into scene ${sceneName(state.scene)}` : ''}`, changes, { force: true });
  });
}

// Reading the FH-2 in the background, on opening and when it's plugged in: nothing you see
// changes, only the mark. With nothing to show yet, its patch is shown.
async function connect() {
  if (state.busy) return;
  state.busy = true;
  state.link = 'connecting';
  render();
  try {
    const pair = (await fh2Ports()).find(looksLikeFh2);
    if (!pair) {
      Object.assign(state, { link: 'offline', module: null });
      return;
    }
    const r = await pullFromFh2(pair);
    readModule(r);
    Object.assign(state, { link: 'connected', port: pair.name });
    if (!state.config) {
      load({ config: r.config, preset: r.preset }, `${pair.name}, ${r.version}`);
      state.status = `Got the patch from ${pair.name} (${r.version})`;
    }
  } catch (e) {
    Object.assign(state, { link: refused(e) ? 'no-midi' : 'offline', module: null });
  } finally {
    state.busy = false;
    update();
  }
}

let watchTimer = null;
function watch() {
  watchFh2((portState) => {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      if (portState === 'connected') connect();
      else {
        Object.assign(state, { link: 'offline', module: null });
        update();
      }
    }, 600);
  }).catch(() => {});
}

const refused = (e) => e.name === 'SecurityError' || e.name === 'NotAllowedError' || /permission|webmidi/i.test(e.message);

function send() {
  return withFh2(async (pair) => {
    status(`Sending to ${pair.name}…`);
    const r = await sendToFh2(pair, patch());
    const off = Object.entries(r).filter(([, d]) => d.length);
    if (off.length) {
      const list = off.map(([k, d]) => `${k}: ${d.slice(0, 3).map((x) => x.path.join('.')).join(', ')}${d.length > 3 ? ` and ${d.length - 3} more` : ''}`);
      state.module = null;
      update();
      return status(`Sent, but the FH-2 holds something else for ${list.join('; ')}`, true);
    }
    state.module = snapshot();
    Object.assign(state, { link: 'connected', port: pair.name });
    update();
    status(`Sent to ${pair.name} and read back: the FH-2 now holds this patch (in RAM, not yet in flash)`);
  });
}

async function saveFlash() {
  const configSlot = state.slots.config ?? 0;
  const presetSlot = state.slots.scenes[state.scene] ?? 0;
  const where = (n, what) => (n ? `${what} slot ${n}` : `the ${what} slot it was last loaded from or saved to`);
  const ok = await modal($('dialog'), {
    title: 'Save to the FH-2’s flash?',
    body: h('p', { class: 'note' }, `This stores the config and the preset the FH-2 holds now (scene ${sceneName(state.scene)}), so they survive switching off: into ${where(configSlot, 'config')} and ${where(presetSlot, 'preset')}, replacing what is there. To save every scene into a slot of its own, use Save all on the Scenes page.`),
    buttons: [{ label: 'Cancel', value: false }, { label: 'Save to flash', value: true, primary: true }],
  });
  if (!ok) return;
  await withFh2(async (pair) => {
    await saveToFlash(pair, { configSlot, presetSlot });
    status(`Saved to ${pair.name}’s flash: ${where(configSlot, 'config')}, ${where(presetSlot, 'preset')}`);
  });
}

// ---- rack setup

async function editHardware() {
  const hw = structuredClone(state.hardware);
  const box = (list, a) => h('input', { type: 'checkbox', checked: list.includes(a), onchange: (e) => {
    const i = list.indexOf(a);
    if (e.target.checked && i < 0) list.push(a);
    if (!e.target.checked && i >= 0) list.splice(i, 1);
  } });
  const body = h('div', { class: 'hw-list' },
    h('b', {}, 'FHX-8CV expanders, by jumper address'),
    h('div', { class: 'hw-row' }, [1, 2, 3, 4, 5, 6, 7].map((a) => h('label', {}, box(hw.cv, a), `${a}/1–8`))),
    h('b', {}, 'Gate modules, by the outputs they give'),
    h('div', { class: 'hw-row' }, [0, 1, 2, 3, 4, 5, 6, 7].map((b) => h('label', {}, box(hw.gt, b), `${blockName(b)} (${b & 1 ? 'ESX-8GT' : 'FHX-8GT'})`))));
  const ok = await modal($('dialog'), {
    title: 'Your rack',
    body: [h('p', { class: 'note' }, 'Tick what is connected. In the rack they are called CV1, CV2… and GT1, GT2… in this order. An FHX-8GT gives the first 8 outputs of its jumper address (GT0/1–8 for address 0); an ESX-8GT on its “To ESX-8GT” header gives the other 8 (GT0/9–16).'), body],
    buttons: [{ label: 'Cancel', value: false }, { label: 'Use this', value: true, primary: true }],
  });
  if (!ok) return;
  hw.cv.sort((a, b) => a - b);
  hw.gt.sort((a, b) => a - b);
  state.hardware = hw;
  saveHardware(hw);
  update();
}

// ---- rendering

function select(sel) {
  if (sel?.addPlayer) return setUpPlayer();
  const same = sel && state.selected && sel.source === state.selected.source && sel.output === state.selected.output && sel.player === state.selected.player;
  state.selected = same ? null : sel;
  render();
  // clicking a free jack asks what should come out of it
  if (!same && sel?.output != null && sel.sources && isFree(state.view.outputs[sel.output])) {
    if (state.scenesOnly) status('Adding a source changes the setup, which all scenes share. Switch off “Scenes only” to add one.', true);
    else addTo(sel.output);
  }
}

function bar() {
  const v = state.view;
  const tab = (id, label) => h('button', { type: 'button', 'aria-pressed': state.tab === id ? 'true' : 'false', onclick: () => { state.tab = id; render(); } }, label);
  const k = state.sync?.kind;
  const sync = v && h('span', { class: 'sync' + (state.unsent ? ' unsent' : ''), title: state.port ? `FH-2 on port “${state.port}”` : '' },
    state.link === 'connecting' ? 'reading the FH-2…'
      : k === 'same' ? 'same as the FH-2'
      : k === 'scene' ? `scene ${sceneName(state.sync.scene)} is on the FH-2`
      : k === 'differs' ? 'differs from the FH-2'
      : state.link === 'no-midi' ? 'no MIDI in this browser'
      : state.link === 'offline' ? 'FH-2 not connected' : 'not on the FH-2');
  const scenes = v && state.scenes.length > 0 && h('div', { class: 'scenes', role: 'group', 'aria-label': 'Scenes' },
    state.scenes.map((_, i) => h('button', {
      type: 'button', 'aria-pressed': i === state.scene ? 'true' : 'false', title: i === state.scene ? 'Click to rename' : 'Show this scene',
      onclick: () => (i === state.scene ? renameScene() : setScene(i)),
    }, sceneName(i))),
    h('button', { type: 'button', class: 'scene-add', title: 'Add a scene (a copy of this one)', 'aria-label': 'Add a scene', onclick: addScene }, '+'),
    state.scenes.length > 1 && h('button', { type: 'button', class: 'scene-add', title: 'Remove this scene', 'aria-label': 'Remove this scene', onclick: removeScene }, '−'),
    h('button', { type: 'button', class: 'scenes-only-toggle', 'aria-pressed': state.scenesOnly ? 'true' : 'false', onclick: toggleScenesOnly,
      title: 'While on, only what a scene holds can change (levels, LFOs, patterns, envelopes, arps, sequences, tempo); the config stays as it is' }, 'Scenes only'));
  return h('header', { class: 'bar' },
    h('div', { class: 'brand' }, jackIcon(), 'Night Shift'),
    v && h('div', { class: 'patch-name' }, 'Config ', h('b', {}, v.globals.name || 'untitled')),
    scenes,
    sync,
    v && h('nav', { class: 'tabs', 'aria-label': 'Views' }, tab('patch', 'Patch'), tab('scenes', 'Scenes'), tab('midi', 'MIDI map')),
    v && h('div', { class: 'undo' },
      h('button', { type: 'button', class: 'btn', disabled: !state.history.canUndo, onclick: undo, title: 'Undo (⌘Z)' }, 'Undo'),
      h('button', { type: 'button', class: 'btn', disabled: !state.history.canRedo, onclick: redo, title: 'Redo (⇧⌘Z)' }, 'Redo')),
    h('div', { class: 'grow' }),
    state.status && h('span', { class: 'status' + (state.warn ? ' warn' : ''), role: 'status' }, state.status),
    h('button', { type: 'button', class: 'btn', onclick: editHardware }, 'Rack…'),
    fileMenu(v),
    h('button', { type: 'button', class: 'btn' + (v ? '' : ' primary'), disabled: state.busy, onclick: get, title: 'Its config and preset become what you see (undoable)' }, 'Get from FH-2'),
    v && h('button', { type: 'button', class: 'btn' + (state.unsent ? ' primary' : ''), disabled: state.busy, onclick: send }, 'Send to FH-2'),
    v && h('button', { type: 'button', class: 'btn', disabled: state.busy || state.unsent, onclick: saveFlash,
      title: state.unsent ? 'Send to the FH-2 first: saving stores what the module holds' : 'Store what the FH-2 holds in its flash' }, 'Save to flash'));
}

// Files: a menu, so the bar keeps the FH-2's buttons in front.
function fileMenu(v) {
  const item = (label, onclick, title) => h('button', { type: 'button', title, onclick: (e) => {
    e.target.closest('details').open = false;
    onclick();
  } }, label);
  return h('details', { class: 'menu' }, h('summary', { class: 'btn' }, 'File'),
    h('div', { class: 'menu-items' },
      item('Open…', pickFiles, 'A project, or .syx dumps (several presets become scenes)'),
      v && item('Save project', saveProject, 'Config, every scene and your names, in one file'),
      v && item('Save .syx', saveSyx, 'The config and this scene’s preset, for the FH-2 or Expert Sleepers’ tools'),
      item('Example patch', loadExample, 'A made-up patch for an FH-2 with two CV and two gate expanders')));
}

async function loadExample() {
  if (!(await dropUnsent('The example'))) return;
  load(examplePatch(), 'example');
  status('Example patch (not kept in this browser: Save project to keep it)');
}

function saveSyx() {
  const parts = [state.config, state.preset].filter(Boolean).map((d) => buildDump(d));
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  download(all, `${(state.view.globals.name || 'fh2').replace(/[^\w.-]+/g, '_')}.syx`);
}

function jackIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', 22);
  svg.setAttribute('height', 22);
  svg.setAttribute('viewBox', '0 0 22 22');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<circle cx="11" cy="11" r="9" fill="#9EA3AB" stroke="#D3D6DB" stroke-width="2"/><circle cx="11" cy="11" r="4" fill="#050506"/>';
  return svg;
}

// Nothing to show: no patch kept in this browser, and no FH-2 (yet).
function empty() {
  const why = state.link === 'connecting' ? 'Reading the FH-2…'
    : state.link === 'no-midi' ? 'This browser doesn’t allow MIDI, so it can’t reach the FH-2. Use Chrome or Edge, and allow MIDI for this page.'
    : 'No FH-2 found. Connect it over USB C: Night Shift reads it as soon as it appears.';
  return h('section', { class: 'empty' }, h('p', {}, why),
    h('p', { class: 'note' }, 'Or open a project or .syx dumps (File, or drop them here), or look at the example patch. Unofficial: not made or supported by Expert Sleepers.'),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: pickFiles }, 'Open…'),
      h('button', { type: 'button', class: 'btn', onclick: loadExample }, 'Example patch')));
}

function render() {
  const v = state.view;
  let content;
  if (!v) content = empty();
  else if (state.tab === 'midi') content = renderMidiMap(v, state.colors);
  else if (state.tab === 'scenes') content = renderScenes(scenesModel(v), { setScene, setSlot, saveAll, toggleScenesOnly,
    setProgramChannel: (ch) => edit(ch ? `Scenes switch by program change on ch ${ch}` : 'No scene switching by program change', [{ dump: 'config', path: ['presetProgramChannel'], value: ch }], { force: true }) });
  else {
    content = [
      h('section', { class: 'stage-wrap', 'aria-label': 'Sources and rack' }, renderStage(v, state.colors, state.selected, select)),
      h('aside', { class: 'inspector', 'aria-label': 'Inspector' }, renderInspector(v, state.colors, state.selected, select, { edit, add: addTo, remove, values, rename, status })),
    ];
  }
  document.body.classList.toggle('scenes-only', !!(v && state.scenesOnly));
  replace($('#app'), bar(), h('main', {}, content));
}

// ---- drop files anywhere, keys

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('drop');
});
document.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) document.body.classList.remove('drop');
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('drop');
  if (e.dataTransfer.files.length) openFiles(e.dataTransfer.files);
});
// a click anywhere else closes the File menu
document.addEventListener('click', (e) => {
  for (const m of document.querySelectorAll('details.menu[open]')) if (!m.contains(e.target)) m.open = false;
});
document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if (e.key === 'Escape' && state.selected) select(null);
});
// ---- start: the example if asked for, else the patch kept in this browser; then the FH-2

const kept = stored();
if (new URLSearchParams(location.search).has('example')) load(examplePatch(), 'example');
else if (kept) {
  load({ config: kept.config, presets: kept.scenes, scene: kept.scene, names: kept.names, hardware: kept.hardware, slots: kept.slots, scenesOnly: kept.scenesOnly }, 'browser');
  state.status = 'Your last patch, kept in this browser';
}
render();
connect().then(watch);
