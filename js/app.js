// Night Shift: on opening, show the patch kept in this browser and read the FH-2 beside it;
// see the rack and what comes out of every jack; edit, undo, keep several scenes (presets) for
// one config, and send the result to the module or get the module's patch. Files (projects,
// .syx dumps) and the example are in the File menu.

import { h, $, replace, download, modal } from '../vendor/lilypad/js/dom.js';
import { parseDump, buildDump, splitSysex, commandOf, DUMPS, CMD } from './fh2/sysex.js';
import { diff } from './fh2/layout.js';
import { derive } from './patch/derive.js';
import { History, removePort, removeSource, setName, changesTowards, removeLfoWithCcs } from './patch/edit.js';
import { examplePatch } from './patch/example.js';
import { projectToJson, projectFromJson, PROJECT_EXTENSION } from './patch/project.js';
import { DEFAULT_HARDWARE, validHardware, blockName } from './patch/hardware.js';
import { colorsFor } from './ui/look.js';
import { renderStage } from './ui/rack.js';
import { renderInspector } from './ui/inspector.js';
import { renderMidiMap } from './ui/midimap.js';
import { addToJack } from './ui/add.js';
import { setUpPlayerDialog } from './ui/players.js';
import { fh2Ports, looksLikeFh2, pullFromFh2, sendToFh2, saveToFlash, saveAllToFlash, watchFh2, readFh2Settings, readFh2Calibrations, loadFh2Calibration, setFh2StartupCalibration, withFh2Client, ec4Port, withEc4,
  openEc4, watchEc4, fh2Output, pullPresetFromFh2 } from './ui/connect.js';
import { renderScenes } from './ui/scenes.js';
import { renderSettings } from './ui/settings.js';
import { renderGig } from './ui/gig.js';
import { checklist } from './patch/gig.js';
import { sceneDifferences, fitProblems } from './patch/scenes.js';
import { pagesOf, mapPages, toggleLive, liveKeys, choicesFor, pageNameKey, placeWithCc, takeOff, switchOn, switchOff, switchOffAll, jackKeys,
  addLivePage, removeLivePage, movePlace, toLivePage, isLive,
  wholePage, strayMappings, removeMappings, dropMapping, settingKey, objectKeys, toAbsolute, SETUP } from './ec4/pages.js';
import { readSetup, setupImage, setupState, writesFor, writeSetup, syncEntry, pagesFingerprint, SYNC_FORMAT, SYNC_MAX } from './ec4/setup.js';
import { fingerprint } from './hash.js';
import { renderEc4, ec4Sketch, sketchLines } from './ui/ec4.js';
import { Ec4Link, Cc14 } from './ec4/link.js';
import { valueOf, valueText, ccFor, fromCc, pathOf } from './ec4/values.js';
import { getPath, setPath } from './fh2/layout.js';
import { settingsByName, startAutoCalibration, watchAutoCalibration, finishAutoCalibration, saveCalibration, setStartupCalibration } from './fh2/menu.js';
import { calibrationDialog } from './ui/calibrate.js';
import { renderSteps } from './ui/steps.js';
import { scalaFiles, fileChange, asciiText, parseScl, parseKbm, SLOTS, slotLabel } from './patch/scala.js';
import { fromModule, anotherPatch, dueIn, MERGE_MAX } from './fh2/live.js';
import { checksBusy } from './fh2/checks.js';

const HW_KEY = 'nightshift.hardware';
const PATCH_KEY = 'nightshift.patch'; // the last patch, as a project, kept after every change
const FH2_SETTINGS_KEY = 'nightshift.fh2settings'; // the FH-2's own settings, as last read
const FH2_CAL_KEY = 'nightshift.fh2calibrations'; // its calibration slots and startup slots, as last read
const LIVE_KEY = 'nightshift.live'; // '0' while Live is off
const BASE_KEY = 'nightshift.onfh2'; // what the FH-2 held as Night Shift last knew it (live editing)
const PATCH_ID_KEY = 'nightshift.patchid'; // which patch the kept one is: every file, Get into nothing or example is a new one
const state = {
  config: null, // parsed dumps (sysex.js parseDump); their values are what gets edited
  preset: null, // the scene in view: scenes[scene]
  scenes: [], // parsed preset dumps, one per scene
  scene: 0,
  slots: { config: null, scenes: [] }, // flash slots (1–30) for the config and each scene, null where none
  scenesOnly: false, // while on, edits that change the config are refused
  held: {}, // what Night Shift last wrote to the FH-2's flash and the EC4, as fingerprints (patch/gig.js)
  names: {}, // Night Shift's own names beside the dumps (edit.js setName)
  from: '',
  hardware: loadHardware(),
  history: new History(),
  module: null, // the values the FH-2 holds, as last read or sent: { config, preset, scene (yours it came from) }, or null
  link: 'unknown', // 'connecting', 'connected', 'offline' (no FH-2 port) or 'no-midi' (the browser refuses)
  port: '',
  fh2Settings: storedSettings(), // { at, port, pages } as last read from the module's menus, or null
  fh2Calibrations: storedSettings(FH2_CAL_KEY), // { at, port, slots, startup } as last read (menu.js readCalibrations), or null
  sync: null, // how what you see compares with the FH-2: { kind: 'same' | 'scene' | 'differs' | 'unknown', scene }
  unsent: false, // what you see isn't what the FH-2 holds (or we don't know what it holds)
  busy: false,
  patchId: '', // the patch's (PATCH_ID_KEY), so the base is only used for the patch it belongs to
  live: { on: loadLive(), tracking: false, sending: false, first: 0, last: 0 }, // live editing: Live on, in step
  // with the FH-2 (it holds your patch or the base), a send in flight, when the edits waiting were made
  view: null,
  colors: new Map(),
  selected: null,
  tab: 'patch',
  ec4: { sel: null, note: '', link: null, thru: loadThru() }, // the EC4 tab's knob in view ({ page, knob }), a line on
  // the EC4, the live link (ec4/link.js) while the EC4 is connected, and Night Shift's thru (EC4 → FH-2)
  ec4Model: null, // the EC4 pages (ec4/pages.js pagesOf), recomputed with the view
  steps: { seq: 0, step: null, lane: 0 }, // the Steps tab: the sequencer in view, its step or lane
  banks: { notes: null, drums: null }, // the banks shown there: { name, msg } each
  status: '',
  warn: false,
};

const THRU_KEY = 'nightshift.ec4thru';
function loadThru() {
  try {
    return localStorage.getItem(THRU_KEY) === '1';
  } catch {
    return false;
  }
}

function loadLive() {
  try {
    return localStorage.getItem(LIVE_KEY) !== '0';
  } catch {
    return true;
  }
}

function storedBase() {
  try {
    return JSON.parse(localStorage.getItem(BASE_KEY)) ?? null;
  } catch {
    return null;
  }
}

// Kept while in step, so edits made offline can go out when the FH-2 comes back (not the
// example's: it isn't the patch kept in this browser).
let baseKept = null;
function storeBase() {
  if (!state.live.tracking || !state.module || state.module === baseKept || state.from === 'example') return;
  baseKept = state.module;
  try {
    localStorage.setItem(BASE_KEY, JSON.stringify({ ...state.module, patchId: state.patchId }));
  } catch {}
}

function storedPatchId() {
  try {
    return localStorage.getItem(PATCH_ID_KEY);
  } catch {
    return null;
  }
}

const newPatchId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

function storedSettings(key = FH2_SETTINGS_KEY) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? null;
  } catch {
    return null;
  }
}

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
const readModule = (r, scene = state.scene) => { state.module = { ...structuredClone({ config: r.config.values, preset: r.preset.values }), scene }; };
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
  slots: state.slots, scenesOnly: state.scenesOnly, held: state.held });
const fp = (dump) => fingerprint(buildDump(dump));

// What was just saved to the FH-2's flash: the config into `configSlot`, presets [{ dump, slot }].
function heldOnFlash(configSlot, presets) {
  const was = state.held.flash ?? { configs: {}, presets: {} };
  state.held = { ...state.held, flash: { at: new Date().toISOString(),
    configs: { ...was.configs, [configSlot]: fp(state.config) },
    presets: { ...was.presets, ...Object.fromEntries(presets.map((p) => [p.slot, fp(p.dump)])) } } };
}

let storeTimer = null;
function store() {
  if (!state.config || state.from === 'example') return;
  clearTimeout(storeTimer);
  storeTimer = setTimeout(() => {
    try {
      localStorage.setItem(PATCH_KEY, projectToJson(project()));
      localStorage.setItem(PATCH_ID_KEY, state.patchId);
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
  if (state.sync?.kind === 'same') state.live.tracking = true;
  state.ec4Model = state.view ? pagesOf(state.view, state.names) : null;
  store();
  storeBase();
  render();
  showOnEc4();
  scheduleLive();
}

// `presets` become the scenes (`scene` the one in view); a single `preset` is one scene. What
// the FH-2 holds stays as it is: the mark compares the new patch with it.
function load({ config, preset, presets, scene = 0, names, hardware, slots, scenesOnly, held }, from) {
  if (config) state.config = config;
  state.held = held ?? (config ? {} : state.held);
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
  state.live.tracking = false; // until it's the same as the FH-2, or sent
  state.patchId = (from === 'browser' && storedPatchId()) || newPatchId();
  update();
}

// ---- editing

// `force`: for Get from FH-2 and the Scenes page, which may change the config while
// “Scenes only” is on.
function edit(label, changes, { force = false, fold = null } = {}) {
  if (state.scenesOnly && !force && changes.some((c) => c.dump === 'config')) {
    state.status = 'Setup locked: Scenes only is on';
    state.warn = true;
    return render();
  }
  try {
    if (state.history.do(patch(), label, changes, { scene: state.scene, fold })) {
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
  if (state.scenesOnly) return status('Setup locked: Scenes only is on', true);
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
    const links = !port && source.kind === 'euclid' && (source.clocks.length || source.restarts.length) ? ' · its clock links undone' : '';
    // a jack's own level, knob or LFO goes with its whole layer, off the EC4's pages too; a source
    // removed altogether takes its knobs and pushes off the EC4, LIVE pages included, with the CCs
    // Night Shift added (your call, 2026-11-06), except a shift register that plays on as notes
    const model = ec4Model();
    const own = ['level', 'knobs', 'lfo'].includes(source.kind) ? (port ? [port] : source.ports).map((p) => p.output) : [];
    const stays = source.kind === 'random' && source.sendsNotes && source.ports.length;
    const keys = [...own.flatMap((o) => jackKeys(o)), ...(!port && !stays ? objectKeys(model, source.id) : [])];
    const ec4Off = keys.length ? switchOffAll(state.names, model, keys) : [];
    edit(own.length && port ? `Cleared jack ${port.jack}` : `${source.kind === 'hid' ? 'Switched off' : 'Removed'} ${source.name}${port && source.ports.length > 1 ? ` ${port.name}` : ''}${where}${links}`,
      [...(port ? removePort(values(), source, port) : removeSource(values(), source)), ...ec4Off]);
    if (!port) state.selected = null;
    render();
  } catch (e) {
    status(`Couldn’t remove that: ${e.message}`, true);
  }
}

// An LFO off, with the CCs on its settings and its knobs on the EC4's pages.
function removeLfoOf(output, jack) {
  edit(`Removed the LFO on jack ${jack}`, [...removeLfoWithCcs(values(), output),
    ...switchOffAll(state.names, ec4Model(), jackKeys(output, (p) => p.startsWith('lfo')))]);
}

// A player that sends somewhere, picked from the FH-2's unused ones (see ui/players.js).
async function setUpPlayer() {
  try {
    const r = await setUpPlayerDialog(state.view, values());
    if (!r) return;
    edit(r.label, r.changes);
    state.selected = r.select ?? { player: r.id };
    render();
  } catch (e) {
    status(`Couldn’t set that up: ${e.message}`, true);
  }
}

// A name box in a dialog: focused, its text selected, Enter presses the dialog's main button.
// (Not `onkeydown = (e) => e.key === 'Enter' && …`: a handler that returns false cancels the
// key, so nothing could be typed.)
function nameBox(input) {
  input.focus();
  input.select();
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('dialog').querySelector('button.primary').click();
  });
}

// Renaming a source or player (or an EC4 page, in `max` 4 characters): Night Shift keeps the
// name beside the dumps.
async function rename(id, now, original, max = 40) {
  const input = h('input', { type: 'text', class: 'text', value: now, maxlength: max, 'aria-label': 'Name' });
  const ok = modal($('dialog'), {
    title: `Rename ${now}`,
    body: [input, h('p', { class: 'note' }, `Empty: back to ${original ?? 'its own name'}.`)],
    buttons: [{ label: 'Cancel', value: false }, { label: 'Rename', value: true, primary: true }],
  });
  nameBox(input);
  if (await ok) edit(input.value.trim() ? `Renamed ${now} to ${input.value.trim()}` : `${now} back to ${original ?? 'its own name'}`, setName(id, input.value));
}


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
  if (!state.preset) return status('No preset to copy', true);
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
  status(`Added scene ${letter}${lock ? ' · Scenes only on' : ''}`);
  update();
}

async function removeScene() {
  if (state.scenes.length < 2) return;
  const name = sceneName(state.scene);
  const ok = await modal($('dialog'), {
    title: `Remove scene ${name}?`,
    body: h('p', { class: 'note' }, 'This can’t be undone.'),
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
  status(state.scenesOnly ? 'Scenes only: on' : 'Scenes only: off');
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
      h('p', { class: 'note' }, `Each is sent to the FH-2 and saved; then scene ${sceneName(state.scene)} goes back onto the module. Saving interrupts what plays.`)],
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
    heldOnFlash(state.slots.config, state.scenes.map((dump, i) => ({ dump, slot: state.slots.scenes[i] })));
    Object.assign(state, { link: 'connected', port: pair.name });
    update();
    status(`Saved config and ${state.scenes.length} ${state.scenes.length === 1 ? 'scene' : 'scenes'} to flash`);
  });
}

async function renameScene() {
  const input = h('input', { type: 'text', class: 'text', value: sceneName(state.scene), maxlength: 16, 'aria-label': 'Scene name' });
  const ok = modal($('dialog'), {
    title: 'Rename this scene',
    body: [input],
    buttons: [{ label: 'Cancel', value: false }, { label: 'Rename', value: true, primary: true }],
  });
  nameBox(input);
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
        load({ config: project.config, presets: project.scenes, scene: project.scene, names: project.names, hardware: project.hardware, slots: project.slots, scenesOnly: project.scenesOnly, held: project.held }, f.name);
        return status(`Opened ${f.name}`);
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
  status('Project saved');
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
    body: h('p', { class: 'note' }, 'Your changes aren’t on the FH-2. Save the project first to keep them.'),
    buttons: [{ label: 'Cancel', value: false }, { label: 'Drop them', value: true, primary: true }],
  });
}

// ---- the FH-2

async function pickFh2() {
  status('Looking for the FH-2…');
  const pairs = await fh2Ports();
  if (!pairs.length) {
    status('No MIDI ports: is the FH-2 connected?', true);
    return null;
  }
  if (looksLikeFh2(pairs[0])) return pairs[0];
  const pick = await modal($('dialog'), {
    title: 'Which port is the FH-2?',
    body: h('p', { class: 'note' }, 'No port is called “FH-2”.'),
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
    status(refused(e) ? 'No MIDI access in this browser'
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
    status(`Reading ${pair.name}…`);
    const r = await pullFromFh2(pair);
    readModule(r);
    Object.assign(state, { link: 'connected', port: pair.name });
    const odd = r.config.versionOk ? '' : ' · unexpected config version';
    if (!state.config || !state.preset) {
      load({ config: r.config, preset: r.preset }, `${pair.name}, ${r.version}`);
      return status(`Got the patch from ${pair.name}${odd}`, !!odd);
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
    Object.assign(state, { link: 'connected', port: pair.name });
    if (!state.config) {
      readModule(r);
      load({ config: r.config, preset: r.preset }, `${pair.name}, ${r.version}`);
      state.status = `Got the patch from ${pair.name}`;
    } else {
      const base = storedBase();
      catchUp(r, base?.patchId === state.patchId ? { ...base, scene: base.scene ?? state.scene } : null, { strict: true });
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

// What came back different after a send, for the status line; '' when nothing did.
function offText(off) {
  const list = Object.entries(off).filter(([, d]) => d.length)
    .map(([k, d]) => `${k}: ${d.slice(0, 3).map((x) => x.path.join('.')).join(', ')}${d.length > 3 ? ` and ${d.length - 3} more` : ''}`);
  return list.length ? `Sent, but the FH-2 holds something else for ${list.join('; ')}` : '';
}

function send() {
  return withFh2(async (pair) => {
    status(`Sending to ${pair.name}…`);
    const scene = state.scene;
    const r = await sendToFh2(pair, patch());
    const off = offText(r.off);
    if (off) {
      state.module = null;
      state.live.tracking = false;
      update();
      return status(off, true);
    }
    state.module = { ...r.sent, scene };
    state.live.tracking = true;
    Object.assign(state, { link: 'connected', port: pair.name });
    update();
    status(`Sent to ${pair.name}`);
  });
}

// ---- live editing (fh2/live.js): while Night Shift and the FH-2 are in step, edits go to the
// FH-2's RAM a few seconds after you make them (that doesn't interrupt what plays).

// The FH-2 as just read (`r`), against what Night Shift last knew it held (`base`). Holding the
// same patch with a few changes, those come into yours as one undoable step, and live editing
// goes on; else it waits for Get or Send. `strict` (the FH-2 just came back): no changes at all.
// Returns whether in step.
function catchUp(r, base, { strict = false } = {}) {
  const theirs = { config: r.config.values, preset: r.preset.values };
  readModule(r, base?.scene ?? state.scene);
  const there = !base || anotherPatch(base, theirs) ? Infinity
    : diff(DUMPS[r.config.cmd].layout, base.config, theirs.config).length + diff(DUMPS[r.preset.cmd].layout, base.preset, theirs.preset).length;
  if (there > (strict ? 0 : MERGE_MAX)) {
    state.live.tracking = false;
    return false;
  }
  state.live.tracking = true;
  const take = [...fromModule(DUMPS[state.config.cmd].layout, base.config, state.config.values, theirs.config).map((c) => ({ dump: 'config', ...c })),
    ...(state.preset && base.scene === state.scene ? fromModule(DUMPS[state.preset.cmd].layout, base.preset, state.preset.values, theirs.preset) : [])
      .map((c) => ({ dump: 'preset', ...c }))];
  if (take.length) edit('From the FH-2', take, { force: true, fold: 'fh2' }); // one step while it keeps coming
  return true;
}

let liveTimer = null;

const liveReady = () => state.live.on && state.live.tracking && state.link === 'connected' && !!state.config && !!state.preset;

// After every change: sends QUIET_MS after the last edit, at most MAX_WAIT_MS after the first.
function scheduleLive() {
  if (state.live.sending) return; // sendLive looks again when it's done
  clearTimeout(liveTimer);
  liveTimer = null;
  if (!liveReady() || !state.unsent) {
    state.live.first = 0;
    return;
  }
  const now = Date.now();
  state.live.first ||= now;
  state.live.last = now;
  liveTimer = setTimeout(sendLive, dueIn(now, state.live.first, state.live.last));
}

// Reads the FH-2, takes its own changes, then sends what differs (config, scene in view, or both).
async function sendLive() {
  liveTimer = null;
  if (!liveReady() || !state.unsent) return;
  // after the EC4's knobs are read back, and not while the hardware checks page runs a check (the
  // FH-2 holds a test config then)
  if (state.busy || turned.size || readBackTimer || checksBusy(localStorage)) {
    liveTimer = setTimeout(sendLive, 1000);
    return;
  }
  state.busy = true;
  state.live.sending = true;
  render();
  try {
    const pair = (await fh2Ports()).find(looksLikeFh2);
    if (!pair) return;
    const r = await pullFromFh2(pair);
    if (!catchUp(r, state.module)) return status('Another patch is on the FH-2: Get or Send', true);
    if (!liveReady()) return; // Live switched off meanwhile
    const scene = state.scene;
    const differs = (d, v) => diff(DUMPS[d.cmd].layout, d.values, v).length > 0;
    const out = { config: differs(state.config, state.module.config) ? state.config : null, preset: differs(state.preset, state.module.preset) ? state.preset : null };
    if (!out.config && !out.preset) return;
    const s = await sendToFh2(pair, out);
    const off = offText(s.off);
    if (off) {
      state.module = null;
      state.live.tracking = false;
      return status(off, true);
    }
    state.module = { ...state.module, ...s.sent, scene: s.sent.preset ? scene : state.module.scene };
  } catch (e) {
    state.live.tracking = false;
    status(refused(e) ? 'No MIDI access in this browser' : `The FH-2 didn’t answer: ${e.message}`, true);
  } finally {
    state.busy = false;
    state.live.sending = false;
    state.live.first = 0;
    update();
  }
}

function switchLive() {
  state.live.on = !state.live.on;
  try {
    localStorage.setItem(LIVE_KEY, state.live.on ? '1' : '0');
  } catch {}
  status(state.live.on ? 'Live: edits go to the FH-2' : 'Live off: Send sends');
  scheduleLive();
}

// The FH-2's own settings (its Settings menu), read by walking the menus: it moves the display
// for half a minute or so, changing nothing.
async function readModuleSettings() {
  const ok = await modal($('dialog'), {
    title: 'Read the FH-2’s settings?',
    body: h('p', { class: 'note' }, 'Night Shift steps through the FH-2’s Settings pages without changing anything (about half a minute). Don’t touch the module meanwhile.'),
    buttons: [{ label: 'Cancel', value: false }, { label: 'Read them', value: true, primary: true }],
  });
  if (!ok) return;
  await withFh2(async (pair) => {
    status('Reading settings…');
    const pages = await readFh2Settings(pair, (s) => status(`Reading ${s}`));
    state.fh2Settings = { at: new Date().toISOString(), port: pair.name, pages };
    try {
      localStorage.setItem(FH2_SETTINGS_KEY, JSON.stringify(state.fh2Settings));
    } catch {}
    status(`Read ${pages.reduce((n, p) => n + p.items.length, 0)} settings`);
  });
}

// The FH-2's calibrations, read from its menus without loading or changing anything (about a
// minute): every flash slot, and the startup slot of each CV jack in the rack.
async function readModuleCalibrations() {
  const ok = await modal($('dialog'), {
    title: 'Read the FH-2’s calibrations?',
    body: h('p', { class: 'note' }, 'Night Shift turns through its Calibrations and Startup pages without loading or changing anything (about a minute). Don’t touch the module meanwhile.'),
    buttons: [{ label: 'Cancel', value: false }, { label: 'Read them', value: true, primary: true }],
  });
  if (!ok) return;
  const outputs = Math.max(0, ...state.view.outputs.filter((o) => o.present && !o.gate).map((o) => o.index + 1));
  await withFh2(async (pair) => {
    status('Reading calibrations…');
    const r = await readFh2Calibrations(pair, outputs, (s) => status(`Reading ${s}`));
    state.fh2Calibrations = { at: new Date().toISOString(), port: pair.name, ...r };
    try {
      localStorage.setItem(FH2_CAL_KEY, JSON.stringify(state.fh2Calibrations));
    } catch {}
    status(`Read ${r.slots.filter((x) => x.output != null).length} calibrations`);
  });
}

// A calibration slot onto its jack now (RAM): Calibrations › Load calibration, checked step by step.
async function loadCalibrationNow(output, slot) {
  const jack = state.view.outputs[output].jack;
  const ok = await modal($('dialog'), {
    title: `Load calibration ${slot} onto jack ${jack}?`,
    body: h('p', { class: 'note' }, 'Now, in the FH-2’s RAM; what loads at power-on stays as it is. Don’t touch the module meanwhile.'),
    buttons: [{ label: 'Cancel', value: false }, { label: 'Load', value: true, primary: true }],
  });
  if (!ok) return;
  await withFh2(async (pair) => {
    status(`Loading calibration ${slot}…`);
    try {
      await loadFh2Calibration(pair, slot, output);
      status(`Calibration ${slot} loaded onto jack ${jack}`);
    } catch (e) {
      status(`Stopped: ${e.message}`, true);
    }
  });
}

// Which calibration a jack loads at power-on: the first FH-2 setting Night Shift changes (Settings ›
// Calibration › Startup, checked step by step; whether it survives a power cycle is check 9).
async function setPowerOnCalibration(output, slot) {
  const jack = state.view.outputs[output].jack;
  const ok = await modal($('dialog'), {
    title: `Jack ${jack}: ${slot ? `calibration ${slot}` : 'no calibration'} at power-on?`,
    body: h('p', { class: 'note' }, 'Night Shift changes this one FH-2 setting through its menus, checking each step, and reads it back. Don’t touch the module meanwhile.'),
    buttons: [{ label: 'Cancel', value: false }, { label: 'Change it', value: true, primary: true }],
  });
  if (!ok) return render();
  await withFh2(async (pair) => {
    status('Changing the power-on calibration…');
    // what the page shows afterwards goes into the panel, also when it stopped after the turn
    try {
      noteCalibrations({ startup: await setFh2StartupCalibration(pair, output, slot) });
      status(`Jack ${jack}: ${slot ? `calibration ${slot}` : 'none'} at power-on`);
    } catch (e) {
      if (e.shown) noteCalibrations({ startup: e.shown });
      status(`Stopped: ${e.message}`, true);
    }
  });
}

// A change Night Shift made into the calibrations as last read (none read yet: nothing to note):
// a slot saved ({ slot, output, name }) or a jack's power-on slot ({ output, slot, match }).
function noteCalibrations({ saved, startup }) {
  const cal = state.fh2Calibrations;
  if (!cal) return;
  if (saved) cal.slots = [...cal.slots.filter((x) => x.slot !== saved.slot), saved].sort((a, b) => a.slot - b.slot);
  if (startup) cal.startup = [...cal.startup.filter((x) => x.output !== startup.output), startup].sort((a, b) => a.output - b.output);
  try {
    localStorage.setItem(FH2_CAL_KEY, JSON.stringify(cal));
  } catch {}
}

// The guided auto-calibration of a jack, its curve shown once it asks "Accept?" (ui/calibrate.js): accepted, it is in
// use on the jack until power-off, and can be named and saved into an empty slot (or over one of
// the jack's own) and loaded at power-on, all in the same dialog.
async function calibrateJack(output) {
  const jack = state.view.outputs[output].jack;
  const slots = state.fh2Calibrations?.slots;
  const free = slots?.filter((x) => x.output == null).map((x) => x.slot) ?? null;
  const own = slots?.filter((x) => x.output === output).map(({ slot, name }) => ({ slot, name })) ?? [];
  await withFh2((pair) => withFh2Client(pair, async (client) => {
    const r = await calibrationDialog({
      jack,
      free,
      own,
      start: () => startAutoCalibration(client, { output }),
      watch: () => watchAutoCalibration(client),
      finish: (accept) => finishAutoCalibration(client, { accept }),
      save: async ({ name, slot, replace, onStep }) => {
        const saved = await saveCalibration(client, { output, slot, name, replace, onStep });
        noteCalibrations({ saved });
        return saved;
      },
      powerOn: async (slot) => {
        try {
          noteCalibrations({ startup: await setStartupCalibration(client, { output, slot }) });
        } catch (e) {
          if (e.shown) noteCalibrations({ startup: e.shown });
          throw e;
        }
      },
    });
    if (r) status({ saved: `Jack ${jack} calibrated and saved`, accepted: `Jack ${jack} calibrated, until power-off`, abandoned: `Calibration of jack ${jack} abandoned` }[r]);
  }));
}

// ---- sequencer banks (their layout from checks S3 and S4: patch/steps.js)

const BANKS = { notes: { what: 'note sequencer bank', file: 'seqbank', install: CMD.INSTALL_SEQ_BANK },
  drums: { what: 'drum sequencer bank', file: 'drumbank', install: CMD.INSTALL_DRUM_BANK } };

// Bank `index` (0 the active one, 1–8 in flash) from the FH-2, shown with its slots.
function readBank(kind, index) {
  const b = BANKS[kind];
  return withFh2((pair) => withFh2Client(pair, async (client) => {
    status(`Reading the ${b.what}…`);
    const msg = kind === 'notes' ? await client.sequencerBank(index) : await client.drumBank(index);
    state.banks[kind] = { name: index ? `Bank ${index}` : 'Active bank', msg };
    status(`${index ? `Bank ${index}` : 'The active bank'} read`);
  }));
}

// A bank from a .syx file, shown with its slots.
function openBank(kind) {
  const b = BANKS[kind];
  const input = h('input', { type: 'file', accept: '.syx,application/octet-stream' });
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const msg = new Uint8Array(await file.arrayBuffer());
    if (commandOf(msg) !== b.install || msg.length !== 8199) return status(`${file.name} isn’t a ${b.what}`, true);
    state.banks[kind] = { name: file.name, msg };
    render();
  };
  input.click();
}

function saveBank(kind) {
  const shown = state.banks[kind];
  download(shown.msg, `${BANKS[kind].file}-${shown.name.replace(/\.syx$/i, '').replace(/[^\w.-]+/g, '_').toLowerCase()}.syx`);
}

// The bank shown made the FH-2's active bank (RAM), after a question.
async function installBank(kind) {
  const b = BANKS[kind];
  const shown = state.banks[kind];
  const ok = await modal($('dialog'), {
    title: `Make ${shown.name} the active ${b.what}?`,
    body: h('p', { class: 'note' }, 'It replaces the 28 sequences in use, in the FH-2’s RAM. Save it on the FH-2 to keep it: Sequencer Banks › Save.'),
    buttons: [{ label: 'Cancel', value: false }, { label: 'Install', value: true, primary: true }],
  });
  if (!ok) return;
  await withFh2((pair) => withFh2Client(pair, async (client) => {
    await client.installBank(shown.msg);
    status(`${shown.name} is the active ${b.what}`);
  }));
}

// ---- Scala files: installed into the FH-2's slots (11H, 12H) and kept in the project, since the
// FH-2 can't say what a slot holds (patch/scala.js)

// Resolves to true once sent (withFh2 reports a failure itself).
async function sendScala(kind, slot, text) {
  let sent = false;
  await withFh2((pair) => withFh2Client(pair, async (client) => {
    await (kind === 'scl' ? client.installScl(slot, text) : client.installKbm(slot, text));
    sent = true;
  }));
  return sent;
}

// A .scl or .kbm file picked, checked, given a slot (after a question), installed and recorded.
function installScala(kind) {
  const input = h('input', { type: 'file', accept: kind === 'scl' ? '.scl,text/plain' : '.kbm,text/plain' });
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const text = asciiText(await file.text());
    const r = kind === 'scl' ? parseScl(text) : parseKbm(text);
    if (!r.ok) return status(`${file.name}: ${r.error}`, true);
    const files = scalaFiles(state.names, kind);
    const free = files.findIndex((f) => !f) + 1 || 1;
    const slot = h('select', { 'aria-label': 'Slot' }, Array.from({ length: SLOTS }, (_, i) => h('option', { value: String(i + 1), selected: i + 1 === free }, slotLabel(files, i + 1))));
    const what = kind === 'scl' ? `${r.description || 'no description'} · ${r.count} notes` : `${r.size ? `${r.size} keys` : 'linear'} · note ${r.reference} at ${r.frequency} Hz`;
    const warn = kind === 'kbm' && r.size === 0 ? 'A linear map (size 0) gave Scala Error on your FH-2: one with its keys listed works.' : null;
    const ok = await modal($('dialog'), {
      title: `Install ${file.name}?`,
      body: [h('p', { class: 'note' }, what), warn && h('p', { class: 'problem' }, warn), h('label', { class: 'field' }, h('span', {}, `.${kind} slot`), slot),
        h('p', { class: 'note' }, 'Replaces what’s there: the FH-2 can’t say what that is.')],
      buttons: [{ label: 'Cancel', value: false }, { label: 'Install', value: true, primary: true }],
    });
    if (!ok) return;
    const n = Number(slot.value);
    const name = file.name.replace(/\.(scl|kbm)$/i, '');
    if (!(await sendScala(kind, n, text))) return;
    edit(`${file.name} in .${kind} slot ${n}`, [fileChange(kind, n, { name, text })]);
  };
  input.click();
}

async function resendScala(kind, slot) {
  const f = scalaFiles(state.names, kind)[slot - 1];
  if (f && (await sendScala(kind, slot, f.text))) status(`${f.name} sent into .${kind} slot ${slot} again`);
}

function forgetScala(kind, slot) {
  const f = scalaFiles(state.names, kind)[slot - 1];
  if (f) edit(`Forgot ${f.name} in .${kind} slot ${slot}`, [fileChange(kind, slot, null)]);
}

async function saveFlash() {
  const configSlot = state.slots.config ?? 0;
  const presetSlot = state.slots.scenes[state.scene] ?? 0;
  const where = (n, what) => (n ? `${what} slot ${n}` : `the ${what} slot it was last loaded from or saved to`);
  const ok = await modal($('dialog'), {
    title: 'Save to the FH-2’s flash?',
    body: h('p', { class: 'note' }, `Config → ${where(configSlot, 'config')}; scene ${sceneName(state.scene)} → ${where(presetSlot, 'preset')}. Replaces what is there, and interrupts what plays.`),
    buttons: [{ label: 'Cancel', value: false }, { label: 'Save to flash', value: true, primary: true }],
  });
  if (!ok) return;
  await withFh2(async (pair) => {
    await saveToFlash(pair, { configSlot, presetSlot });
    // only where the slots are known (else the FH-2 used the ones it last loaded from)
    if (configSlot && presetSlot && state.sync?.kind === 'same') {
      heldOnFlash(configSlot, [{ dump: state.preset, slot: presetSlot }]);
      store();
    }
    status('Saved to flash');
  });
}

// ---- the EC4 pages (setup 15)

const ec4Model = () => pagesOf(state.view, state.names);
const ec4Edit = (label, r) => (r.error ? status(r.error, true) : edit(label, r.changes));

// Gives every knob without one a CC mapping (one undoable edit of the config).
function mapEc4() {
  const r = mapPages(state.config.values, state.view, ec4Model(), state.names);
  if (!r.changes.length) return status(r.left.length ? `No room for ${r.left.length} more CCs` : 'Every knob has a CC', r.left.length > 0);
  edit(`${r.mapped} CCs added${r.left.length ? `; no room for ${r.left.length}` : ''}`, r.changes);
}

// Puts a setting on a LIVE page, or takes it off there; `pageId` null makes a new LIVE page for it.
function liveEc4(key, pageId) {
  const made = pageId ? null : addLivePage(state.names);
  const id = pageId ?? made.id;
  const names = made ? { ...state.names, 'ec4:lives': made.changes[0].value } : state.names;
  const changes = toggleLive(names, key, id);
  const name = livePageName(id);
  if (!changes) return status(`${name} is full`, true);
  edit(liveKeys(state.names, id).includes(key) ? `Taken off ${name}` : `Put on ${name}`, [...(made?.changes ?? []), ...changes]);
}
const livePageName = (id) => ec4Model().lives.find((l) => l.id === id)?.name ?? (id === 'live' ? 'LIVE' : `LIV${id.split(':')[1]}`);

function addLiveEc4() {
  const r = addLivePage(state.names);
  state.ec4.sel = { page: r.id, knob: null };
  edit('New LIVE page', r.changes);
}

function removeLiveEc4(pageId) {
  const name = livePageName(pageId);
  state.ec4.sel = null;
  edit(`Removed page ${name}`, removeLivePage(state.names, ec4Model(), pageId));
}

// A knob (with its push) to another place on its page; the one there takes its place.
function moveEc4(pageId, from, to) {
  if (from === to) return;
  state.ec4.sel = { page: pageId, knob: to };
  edit(`Knob ${from + 1} to place ${to + 1}`, movePlace(state.names, pageId, from, to));
}

// A knob onto a LIVE page: moved from another LIVE page, put there too from its own page.
function toLiveEc4(fromId, i, toId) {
  const r = toLivePage(state.names, fromId, i, toId);
  if (r.error) return status(r.error, true);
  if (!r.changes.length) return;
  edit(`${isLive(fromId) ? 'Moved' : 'Put'} on ${livePageName(toId)}`, r.changes);
}

// A free knob: pick any other setting of the page's object (on LIVE, of any object).
async function pickEc4(pageId, i) {
  const model = ec4Model();
  const page = model.pages.find((p) => p.id === pageId);
  const groups = choicesFor(model.objects, page);
  if (!groups.length) return status('Every setting is on this page already');
  const select = h('select', { 'aria-label': 'Setting' }, groups.map((g) => h('optgroup', { label: g.name },
    g.cells.map((c) => h('option', { value: c.key }, `${c.label} (${c.short})`)))));
  const ok = await modal($('dialog'), {
    title: `Knob ${i + 1} of ${page.name}`,
    body: select,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Put it here', value: true, primary: true }],
  });
  if (!ok) return;
  state.ec4.sel = { page: pageId, knob: i };
  ec4Edit(`Put on ${page.name}`, placeWithCc(state.config.values, state.view, state.names, model, pageId, i, select.value));
}

function takeOffEc4(pageId, i) {
  const page = ec4Model().pages.find((p) => p.id === pageId);
  edit(`Taken off ${page.name}`, takeOff(state.names, ec4Model(), pageId, i));
}

// Clicking a setting's name in the Patch tab: on the EC4, or off again.
const ec4 = {
  state(key) {
    const model = state.ec4Model;
    const c = model?.known.get(key);
    if (!c) return null;
    const where = model.on.get(key) ?? [];
    const m = model.mapOf(key);
    const cc = m ? `ch ${m.channel + 1} · CC ${m.cc}` : '';
    const inputs = state.view.players.filter((p) => p.kind === 'input' && p.targets?.some((t) => settingKey(t.target) === key)).map((p) => 'XY'[p.index]);
    return { on: where.length > 0, inputs, title: where.length
      ? `On the EC4: ${where.map((w) => `${w.name} ${w.push ? 'push' : 'knob'} ${w.index + 1}`).join(', ')} · ${cc}. Click to take it off`
      : `Click to put it on the EC4${cc ? ` (${cc})` : ''}` };
  },
  toggle(key) {
    const model = ec4Model();
    const c = model.known.get(key); // none for a setting gone from the patch, which can still be taken off
    if (model.on.has(key)) return edit(`Off the EC4: ${c ? c.label.toLowerCase() : 'a setting gone from the patch'}`, switchOff(state.names, model, key));
    const r = switchOn(state.config.values, state.view, state.names, model, key);
    ec4Edit(r.where ? `On the EC4: ${r.where.name} ${r.where.push ? 'push' : 'knob'} ${r.where.index + 1}` : '', r);
  },
};

function offEc4(key) {
  ec4.toggle(key);
}

// A page with its whole template: for "+ Page for…" and "Whole page".
function wholeEc4(pageId) {
  const r = wholePage(state.config.values, state.view, state.names, ec4Model(), pageId);
  if (!r.count) return status('Nothing more on its template');
  state.ec4.sel = { page: pageId, knob: null };
  edit(`${r.count} on the EC4`, r.changes);
}

// One CC mapping removed, from "Controlled by MIDI" (undoable); a setting on the EC4 comes off it too.
function removeMappingOf(m) {
  if (m.input != null) return edit(`Input ${'XY'[m.input]} no longer moves it`, [{ dump: 'config', path: ['mapping', m.slot, 'status'], value: 0x7f }]); // its EC4 knob stays
  edit(`CC ${m.cc} on ch ${m.channel + 1} removed`, dropMapping(state.names, ec4Model(), m.slot, settingKey(m.target)));
}

// Mappings on the pages channels that are on no page: listed, then removed after a yes.
async function tidyEc4() {
  const stray = strayMappings(state.view, ec4Model());
  if (!stray.length) return;
  const ok = await modal($('dialog'), {
    title: `Remove ${stray.length} CCs?`,
    body: h('p', { class: 'note' }, `On no EC4 page: ${stray.slice(0, 12).map((s) => s.label).join(', ')}${stray.length > 12 ? ` and ${stray.length - 12} more` : ''}.`),
    buttons: [{ label: 'Cancel', value: false }, { label: 'Remove', value: true, primary: true }],
  });
  if (ok) edit(`${stray.length} CCs removed`, removeMappings(state.names, stray));
}

function renameEc4Page(id) {
  const page = ec4Model().pages.find((p) => p.id === id);
  if (page) rename(pageNameKey(id), page.name, page.defaultName, 4);
}

// Reads setup 15 from the EC4, says what it holds, and after a yes writes the pages there.
// The pre-gig checklist for the patch as it is: fingerprints of what you see, against what Night
// Shift last wrote to the FH-2's flash and the EC4 (state.held).
function gigList() {
  const model = state.ec4Model;
  const fw = state.held.ec4?.fw;
  const sync = { format: SYNC_FORMAT(fw && { fwMajor: fw[0], fwMinor: fw[1] }), tempoMin: state.config.values.tempoMin,
    programChannel: state.config.values.presetProgramChannel };
  return checklist({
    config: { slot: state.slots.config, fp: fp(state.config), values: state.config.values },
    scenes: state.scenes.map((s, i) => ({ name: sceneName(i), slot: state.slots.scenes[i], fp: fp(s) })),
    view: state.view, fh2: state.fh2Settings, held: state.held,
    ec4: { pages: model.pages.length, fp: model.pages.length ? pagesFingerprint(model.pages, state.view, model.channel, sync) : null,
      synced: model.pages.reduce((n, pg) => n + pg.cells.filter((c) => syncEntry(c, sync)).length, 0), max: SYNC_MAX },
  });
}

async function sendEc4() {
  const model = ec4Model();
  if (state.busy) return;
  if (model.unmapped.length) return status('Give every knob and push a CC first', true);
  state.busy = true;
  try {
    const link = state.ec4.link;
    const pair = link ? null : await ec4Port();
    if (!link && !pair) return status('No EC4 found', true);
    status(`Reading EC4 setup ${SETUP + 1}…`);
    const withDevice = (work) => (link ? work(link.device, link.info) : withEc4(pair, work));
    await withDevice(async (device, info) => {
      if (!link) state.ec4.note = `controlfrog ${info.fwMajor}.${info.fwMinor} on “${pair.name}”`;
      const base = await readSetup(device, (k, n) => status(`Reading EC4 setup ${SETUP + 1}… ${Math.round((100 * k) / n)} %`));
      const sync = { format: SYNC_FORMAT(info), tempoMin: state.config.values.tempoMin, programChannel: state.config.values.presetProgramChannel };
      const img = setupImage(base, model.pages, state.view, model.channel, sync);
      const writes = writesFor(img, base);
      const synced = model.pages.reduce((n, pg) => n + pg.cells.filter((c) => syncEntry(c, sync)).length, 0);
      const sent = () => {
        state.held = { ...state.held, ec4: { at: new Date().toISOString(), fp: pagesFingerprint(model.pages, state.view, model.channel, sync), fw: [info.fwMajor, info.fwMinor] } };
        store();
      };
      if (!writes.length) {
        sent();
        return status('The EC4 has these pages already');
      }
      const now = setupState(base);
      const holds = now.ours ? 'Night Shift’s pages' : now.free ? 'nothing of yours' : `“${now.name.trim()}” (${now.groups.slice(0, 4).map((g) => g.trim()).join(', ')}…)`;
      const ok = await modal($('dialog'), {
        title: `Write the pages to EC4 setup ${SETUP + 1}?`,
        body: h('p', { class: 'note' }, `Setup ${SETUP + 1} holds ${holds}; it is replaced. The other setups stay as they are. `
          + `With it goes the table that lets the EC4 ask the FH-2 for its ${sync.format > 1 ? '' : '14-bit '}values (controlfrog ${sync.format > 1 ? '0.12' : '0.11'}${synced ? `, ${synced} knob${synced === 1 ? '' : 's'}` : ', none on the pages yet'}).`
          + (sync.format > 1 && synced > SYNC_MAX ? ` The EC4 keeps only the first ${SYNC_MAX} in step.` : '')),
        buttons: [{ label: 'Cancel', value: false }, { label: 'Write', value: true, primary: true }],
      });
      if (!ok) return status('');
      await writeSetup(device, img, base, (k, n) => status(`Writing the EC4… ${k}/${n}`));
      sent();
      status(`Pages on the EC4, setup ${SETUP + 1}`);
    });
  } catch (e) {
    status(refused(e) ? 'No MIDI access in this browser' : `The EC4 didn’t answer: ${e.message}`, true);
  } finally {
    state.busy = false;
    render();
  }
}

// ---- the live link (ec4/link.js): the EC4 and Night Shift follow each other's page, the
// EC4 shows values in FH-2 units, a touched knob shows its setting, and Night Shift's thru
// passes the knobs on to the FH-2 (off while Logic does that).

let fh2Out = null; // the FH-2's output port, for the thru
const cc14 = new Cc14();

async function linkEc4() {
  if (state.ec4.link || state.ec4.linking) return;
  state.ec4.linking = true;
  try {
    const pair = await ec4Port();
    if (!pair) return;
    const { device, info } = await openEc4(pair, onEc4Midi);
    const link = new Ec4Link(device, info);
    link.addEventListener('state', (e) => onEc4State(e.detail));
    link.addEventListener('touch', (e) => onEc4Touch(e.detail));
    state.ec4.link = link;
    state.ec4.note = `controlfrog ${info.fwMajor}.${info.fwMinor}`;
    await link.start();
  } catch (e) {
    state.ec4.note = refused(e) ? '' : `EC4: ${e.message}`;
    state.ec4.link?.close();
    state.ec4.link = null;
  } finally {
    state.ec4.linking = false;
    render();
  }
}

function unlinkEc4() {
  state.ec4.link?.close();
  state.ec4.link = null;
  state.ec4.note = '';
  render();
}

// The page a selection in the Patch tab belongs to (a source, a player, a jack with an LFO).
function pageOfSelection(model) {
  const sel = state.selected;
  if (!sel || !model) return null;
  const id = sel.source ?? sel.player ?? (sel.output != null ? `lfo:${sel.output}` : null);
  return model.pages.find((p) => p.objects.includes(id) || (id === 'clocks' && p.id === 'clock')) ?? null;
}

// Night Shift → EC4: the page of what you selected (only while the EC4 is on setup 15).
function followOnEc4() {
  const link = state.ec4.link;
  if (!link?.ours) return;
  const page = state.tab === 'ec4' ? state.ec4Model?.pages.find((p) => p.id === state.ec4.sel?.page) : pageOfSelection(state.ec4Model);
  if (page) link.select(page.group).catch(() => {});
}

// EC4 → Night Shift: its page selects that source (Patch tab) or page (EC4 tab).
function onEc4State({ setup, group, moved }) {
  if (setup !== SETUP || !moved) return render();
  const page = state.ec4Model?.pages[group];
  if (page) {
    if (state.tab === 'ec4') state.ec4.sel = { page: page.id, knob: null };
    else if (!page.live && page !== pageOfSelection(state.ec4Model)) {
      const id = page.objects[0];
      state.selected = state.view.sources.some((s) => s.id === id) ? { source: id }
        : state.view.players.some((p) => p.id === id) ? { player: id }
        : id === 'clock' ? { source: 'clocks' } : id.startsWith('lfo:') ? { output: Number(id.slice(4)) } : state.selected;
    }
  }
  render();
  showOnEc4();
}

// A knob touched on the EC4: its setting shows (and is outlined for a moment) in Night Shift.
function onEc4Touch({ index, group }) {
  const page = state.ec4Model?.pages[group];
  const c = page?.cells[index];
  if (!c) return;
  if (state.tab === 'ec4') {
    state.ec4.sel = { page: page.id, knob: index };
    return render();
  }
  const row = document.querySelector(`[data-ec4="${c.key}"]`);
  if (row) {
    row.scrollIntoView({ block: 'nearest' });
    row.classList.remove('touched');
    void row.offsetWidth; // restart the outline's fade
    row.classList.add('touched');
  }
}

// What the page the EC4 shows should look like: each knob's value as text and as the CC that
// puts the knob there.
function showOnEc4() {
  const link = state.ec4.link;
  const page = link?.ours && state.ec4Model?.pages[link.group];
  if (!page || !state.preset) return;
  const range = (o) => state.view.outputs[o]?.rangeIndex ?? 0;
  link.show(page.cells.map((c) => {
    if (!c?.map) return null;
    const v = valueOf(state.preset.values, c.key);
    return { text: valueText(c.key, v, { range }), cc: c.map.relative ? null : { channel: c.map.channel, number: c.map.cc, value: ccFor(c.key, v, c.map.bits, { tempoMin: state.config.values.tempoMin }), bits: c.map.bits } };
  })).catch(() => {});
}

// The EC4's knobs: passed on to the FH-2 (thru), their value shown right away (an estimate
// where the FH-2 scales the CC), and read back from the FH-2 once they rest.
function onEc4Midi(bytes) {
  if (state.ec4.thru && bytes[0] >= 0x80 && bytes[0] < 0xf0) {
    if (fh2Out?.state === 'connected') fh2Out.send(bytes);
    else fh2Output().then((o) => { fh2Out = o; o?.send(bytes); }).catch(() => {});
  }
  const link = state.ec4.link;
  const page = link?.ours && state.ec4Model?.pages[link.group];
  if (!page) return;
  const hires = (ch, cc) => page.cells.some((c) => c?.map?.channel === ch && c.map.cc === cc && c.map.bits === 14);
  const range = (o) => state.view.outputs[o]?.rangeIndex ?? 0;
  for (const m of cc14.take(bytes, hires)) {
    page.cells.forEach((c, i) => {
      if (!c?.map || c.map.channel !== m.channel || c.map.cc !== m.cc) return;
      // a relative knob sends steps, not where it is: its text waits for the read-back
      if (!c.map.relative) link.showOne(i, valueText(c.key, fromCc(c.key, m.value, m.bits, { tempoMin: state.config.values.tempoMin }), { range })).catch(() => {});
      link.sent.set(i, `${m.channel}:${m.cc}:${m.value}`);
      turned.add(c.key);
    });
  }
  if (turned.size) {
    clearTimeout(readBackTimer);
    readBackTimer = setTimeout(readBack, 500);
  }
}

// After the knobs rest: the FH-2's preset is read and the settings they turned take its values,
// as one step (undo goes back to before the knobs). Only while the FH-2 holds the scene in view.
const turned = new Set();
let readBackTimer = null;
async function readBack() {
  readBackTimer = null;
  const keys = [...turned];
  turned.clear();
  if (state.busy || state.link !== 'connected' || !state.preset || state.sync?.kind === 'scene') return;
  state.busy = true;
  try {
    const pair = (await fh2Ports()).find(looksLikeFh2);
    if (!pair) return;
    const preset = await pullPresetFromFh2(pair);
    const changes = [];
    const known = state.module && structuredClone(state.module.preset); // the knobs' settings only: live editing
    for (const k of keys) { // takes the FH-2's other changes when it next sends
      const path = pathOf(state.ec4Model.known.get(k)?.setting ?? { kind: '' });
      if (!path) continue;
      const v = getPath(preset.values, path);
      if (known) setPath(known, path, v);
      if (v !== getPath(state.preset.values, path)) changes.push({ dump: 'preset', path, value: v });
    }
    if (known) state.module = { ...state.module, preset: known };
    const labels = keys.map((k) => state.ec4Model.known.get(k)?.label.toLowerCase()).filter(Boolean);
    state.busy = false;
    if (changes.length) edit(`From the EC4: ${labels.slice(0, 3).join(', ')}${labels.length > 3 ? '…' : ''}`, changes, { force: true });
    else update();
  } catch {
    // the knobs still changed the FH-2; the mark says so at the next read
  } finally {
    state.busy = false;
  }
}

function toggleThru() {
  state.ec4.thru = !state.ec4.thru;
  try {
    localStorage.setItem(THRU_KEY, state.ec4.thru ? '1' : '0');
  } catch {}
  status(state.ec4.thru ? 'Thru on: the EC4’s knobs go on to the FH-2' : 'Thru off');
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
    body: [h('p', { class: 'note' }, 'In rack order: CV1, CV2… and GT1, GT2…'), body],
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
  // a shift register's notes are part of it: its own panel has them
  const srr = /^srrNotes:(\d+)$/.exec(sel?.player ?? '');
  if (srr) sel = { source: `srr:${srr[1]}` };
  const same = sel && state.selected && sel.source === state.selected.source && sel.output === state.selected.output && sel.player === state.selected.player && sel.input === state.selected.input;
  state.selected = same ? null : sel;
  render();
  followOnEc4();
  // a free jack shows its own level, LFO and smoothing; "Add a source…" there adds a driver
}

function bar() {
  const v = state.view;
  const tab = (id, label) => h('button', { type: 'button', 'aria-pressed': state.tab === id ? 'true' : 'false', onclick: () => { state.tab = id; render(); } }, label);
  const k = state.sync?.kind;
  const live = state.live;
  const inStep = live.tracking && state.link === 'connected';
  const mark = state.link === 'connecting' ? 'reading the FH-2…'
      : k === 'same' ? 'same as the FH-2'
      : live.sending ? 'sending…'
      : inStep ? (live.on ? 'sending soon' : 'not sent')
      : k === 'scene' ? `scene ${sceneName(state.sync.scene)} is on the FH-2`
      : k === 'differs' ? 'differs from the FH-2'
      : state.link === 'no-midi' ? 'no MIDI in this browser'
      : state.link === 'offline' ? 'FH-2 not connected' : 'not on the FH-2';
  // on a narrow window only its dot shows; the words are on hover
  const sync = v && h('span', { class: 'sync' + (state.unsent ? ' unsent' : ''), title: `${mark}${state.port ? ` · FH-2 on port “${state.port}”` : ''}` },
    h('i', { class: 'sync-dot', 'aria-hidden': 'true' }), h('span', { class: 'sync-text' }, mark));
  const scenes = v && state.scenes.length > 0 && h('div', { class: 'scenes', role: 'group', 'aria-label': 'Scenes' },
    state.scenes.map((_, i) => h('button', {
      type: 'button', 'aria-pressed': i === state.scene ? 'true' : 'false', title: i === state.scene ? 'Click to rename' : 'Show this scene',
      onclick: () => (i === state.scene ? renameScene() : setScene(i)),
    }, sceneName(i))),
    h('button', { type: 'button', class: 'scene-add', title: 'Add a scene (a copy of this one)', 'aria-label': 'Add a scene', onclick: addScene }, '+'),
    state.scenes.length > 1 && h('button', { type: 'button', class: 'scene-add', title: 'Remove this scene', 'aria-label': 'Remove this scene', onclick: removeScene }, '−'),
    h('button', { type: 'button', class: 'scenes-only-toggle', 'aria-pressed': state.scenesOnly ? 'true' : 'false', onclick: toggleScenesOnly,
      title: 'While on, only what a scene holds can change (levels, LFOs, patterns, envelopes, arps, sequences, tempo); the config stays as it is' }, 'Scenes only'));
  // one row at any width: what can shrink does (name, scenes, the mark, the status), the rest keeps its size
  return h('header', { class: 'bar' },
    h('div', { class: 'brand' }, jackIcon(), h('span', { class: 'brand-name' }, 'Night Shift')),
    v && h('div', { class: 'patch-name', title: `Config ${v.globals.name || 'untitled'}` }, h('span', { class: 'lbl' }, 'Config '), h('b', {}, v.globals.name || 'untitled')),
    scenes,
    sync,
    v && h('nav', { class: 'tabs', 'aria-label': 'Views' }, tab('patch', 'Patch'), tab('scenes', 'Scenes'), tab('steps', 'Steps'), tab('settings', 'Settings'), tab('midi', 'MIDI map'), tab('ec4', 'EC4'), tab('gig', 'Gig')),
    v && h('div', { class: 'undo' },
      h('button', { type: 'button', class: 'btn', disabled: !state.history.canUndo, onclick: undo, title: 'Undo (⌘Z)', 'aria-label': 'Undo' }, '↶'),
      h('button', { type: 'button', class: 'btn', disabled: !state.history.canRedo, onclick: redo, title: 'Redo (⇧⌘Z)', 'aria-label': 'Redo' }, '↷')),
    h('div', { class: 'grow' }),
    state.status && h('span', { class: 'status' + (state.warn ? ' warn' : ''), role: 'status', title: state.status }, state.status),
    fileMenu(v),
    h('div', { class: 'fh2-group', role: 'group', 'aria-label': 'FH-2' }, h('span', { class: 'lbl' }, 'FH-2'),
      v && h('button', { type: 'button', class: 'btn live-toggle', 'aria-pressed': live.on ? 'true' : 'false', onclick: switchLive,
        title: 'On: edits go to the FH-2’s memory (not its flash) a few seconds after you make them. Off: only Send sends.' }, 'Live'),
      h('button', { type: 'button', class: 'btn' + (v ? '' : ' primary'), disabled: state.busy, onclick: get, title: 'Get from the FH-2: its config and preset become what you see (undoable)' }, 'Get'),
      v && h('button', { type: 'button', class: 'btn' + (state.unsent && !(live.on && inStep) ? ' primary' : ''), disabled: state.busy, onclick: send, title: 'Send to the FH-2: what you see goes into its memory' }, 'Send'),
      v && h('button', { type: 'button', class: 'btn', disabled: state.busy || state.unsent, onclick: saveFlash,
        title: state.unsent ? 'Send to the FH-2 first: saving stores what the module holds' : 'Save to flash: store what the FH-2 holds' }, 'Save')));
}

// Files: a menu, so the bar keeps the FH-2's buttons in front.
function fileMenu(v) {
  const item = (label, onclick, title) => h('button', { type: 'button', title, onclick: (e) => {
    e.target.closest('details').open = false;
    onclick();
  } }, label);
  // the list is fixed under its button, so the bar (which scrolls sideways when it must) can't cut it off
  const place = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const width = document.documentElement.clientWidth; // without the page's scrollbar, as `right` counts
    Object.assign(e.currentTarget.nextElementSibling.style, { top: `${r.bottom + 4}px`, right: `${Math.max(8, width - r.right)}px` });
  };
  return h('details', { class: 'menu' }, h('summary', { class: 'btn', onclick: place }, 'File'),
    h('div', { class: 'menu-items' },
      item('Open…', pickFiles, 'A project, or .syx dumps (several presets become scenes)'),
      item('Rack…', editHardware, 'Which expanders your FH-2 has'),
      v && item('Save project', saveProject, 'Config, every scene and your names, in one file'),
      v && item('Save .syx', saveSyx, 'The config and this scene’s preset, for the FH-2 or Expert Sleepers’ tools'),
      item('Example patch', loadExample, 'A made-up patch for an FH-2 with two CV and two gate expanders'),
      item('Hardware checks', () => open('checks.html', '_blank'), 'Answers to the build plan’s hardware questions, measured on your FH-2')));
}

async function loadExample() {
  if (!(await dropUnsent('The example'))) return;
  load(examplePatch(), 'example');
  status('Example patch (not kept)');
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
    : state.link === 'no-midi' ? 'No MIDI in this browser (use Chrome or Edge).'
    : 'No FH-2 found. Connect it over USB C.';
  return h('section', { class: 'empty' }, h('p', {}, why),
    h('p', { class: 'note' }, 'Unofficial: not made or supported by Expert Sleepers.'),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: pickFiles }, 'Open…'),
      h('button', { type: 'button', class: 'btn', onclick: loadExample }, 'Example patch')));
}

// the EC4 sketch's lines follow the page as it scrolls or resizes
let linesFrame = 0;
const drawLines = () => {
  cancelAnimationFrame(linesFrame);
  linesFrame = requestAnimationFrame(sketchLines);
};
addEventListener('scroll', drawLines, { passive: true });
addEventListener('resize', drawLines);

function render() {
  const v = state.view;
  const sketchPage = v && state.tab === 'patch' ? pageOfSelection(state.ec4Model) : null;
  let content;
  if (!v) content = empty();
  else if (state.tab === 'midi') content = renderMidiMap(v, state.colors);
  else if (state.tab === 'ec4') content = renderEc4(v, state.ec4Model, state.colors, state.ec4.sel, {
    select: (page, knob) => { state.ec4.sel = { page, knob }; render(); followOnEc4(); },
    pick: pickEc4, takeOff: takeOffEc4, off: offEc4, addPage: wholeEc4, whole: wholeEc4, map: mapEc4, send: sendEc4, live: liveEc4,
    addLive: addLiveEc4, removeLive: removeLiveEc4, move: moveEc4, toLive: toLiveEc4,
    rename: renameEc4Page, stray: strayMappings(v, state.ec4Model), tidy: tidyEc4, busy: state.busy, note: state.ec4.note,
    link: state.ec4.link && { ours: state.ec4.link.ours, setup: state.ec4.link.setup, group: state.ec4.link.group }, thru: state.ec4.thru, toggleThru,
    relative: toAbsolute(state.config.values, state.ec4Model, state.names), makeAbsolute: (r) => edit(`Made ${r.keys.length} knob${r.keys.length === 1 ? '' : 's'} absolute`, r.changes),
    softTakeover: !!state.config.values.softTakeover, turnOffSoftTakeover: () => edit('Soft takeover off', [{ dump: 'config', path: ['softTakeover'], value: 0 }], { force: true }) });
  else if (state.tab === 'steps') content = renderSteps(v, values(), state.steps, { edit, busy: state.busy,
    select: (sel) => { state.steps = { seq: state.steps.seq, lane: state.steps.lane, ...sel }; render(); },
    banks: { shown: state.banks, read: readBank, open: openBank, save: saveBank, install: installBank } });
  else if (state.tab === 'settings') content = renderSettings(v, state.config.values, state.preset?.values ?? null, sceneName(state.scene),
    { edit, fh2: state.fh2Settings, readFh2: readModuleSettings, cal: state.fh2Calibrations, readCal: readModuleCalibrations, busy: state.busy, ec4, removeMapping: removeMappingOf,
      names: state.names, scala: { install: installScala, resend: resendScala, forget: forgetScala } });
  else if (state.tab === 'gig') content = renderGig(gigList(), { readFh2: readModuleSettings, saveAll, sendEc4,
    scenes: () => { state.tab = 'scenes'; render(); }, checks: () => open('checks.html', '_blank'), busy: state.busy });
  else if (state.tab === 'scenes') content = renderScenes(scenesModel(v), { setScene, setSlot, saveAll, toggleScenesOnly,
    setProgramChannel: (ch) => edit(ch ? `Scenes switch by program change on ch ${ch}` : 'No scene switching by program change', [{ dump: 'config', path: ['presetProgramChannel'], value: ch }], { force: true }) });
  else {
    content = [
      h('section', { class: 'stage-wrap', 'aria-label': 'Sources and rack' }, renderStage(v, state.colors, state.selected, select),
        sketchPage && ec4Sketch(sketchPage, state.colors, state.ec4.link?.ours && state.ec4.link.group === sketchPage.group)),
      h('aside', { class: 'inspector', 'aria-label': 'Inspector' }, renderInspector(v, state.colors, state.selected, select, { edit, add: addTo, remove, removeLfo: removeLfoOf, removeMapping: removeMappingOf, values, rename, status, ec4, fh2: state.fh2Settings, calibrations: state.fh2Calibrations, loadCalibration: loadCalibrationNow, setPowerOnCalibration, calibrate: calibrateJack,
        loadDirect: !!state.fh2Settings && (settingsByName(state.fh2Settings.pages)['Always load direct'] ?? '').trim().startsWith('1') })),
    ];
  }
  document.body.classList.toggle('scenes-only', !!(v && state.scenesOnly));
  replace($('#app'), bar(), h('main', {}, content));
  drawLines();
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
// a click anywhere else closes the File menu; so does anything that moves its button away from
// the list (which sits at a fixed place): resizing the window, scrolling the bar or the page
document.addEventListener('click', (e) => {
  for (const m of document.querySelectorAll('details.menu[open]')) if (!m.contains(e.target)) m.open = false;
});
const closeMenus = () => {
  for (const m of document.querySelectorAll('details.menu[open]')) m.open = false;
};
addEventListener('resize', closeMenus);
document.addEventListener('scroll', closeMenus, true);
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
  load({ config: kept.config, presets: kept.scenes, scene: kept.scene, names: kept.names, hardware: kept.hardware, slots: kept.slots, scenesOnly: kept.scenesOnly, held: kept.held }, 'browser');
  state.status = 'Last patch restored';
}
render();
connect().then(watch).then(() => {
  linkEc4();
  watchEc4((portState) => (portState === 'connected' ? setTimeout(linkEc4, 600) : unlinkEc4())).catch(() => {});
});
