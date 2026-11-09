// Night Shift: on opening, show the patch kept in this browser and read the FH-2 beside it;
// see the rack and what comes out of every jack; edit, undo, keep several scenes (presets) for
// one config, and send the result to the module or get the module's patch. Files (projects,
// .syx dumps) and the example are in the File menu.

import { h, $, replace, download, modal } from '../vendor/lilypad/js/dom.js';
import { parseDump, buildDump, splitSysex, commandOf, DUMPS, CMD } from './fh2/sysex.js';
import { diff } from './fh2/layout.js';
import { derive } from './patch/derive.js';
import { History, apply, removePort, removeSource, setName, changesTowards, removeLfoWithCcs, withMarks } from './patch/edit.js';
import { examplePatch } from './patch/example.js';
import { projectToJson, projectFromJson, PROJECT_EXTENSION } from './patch/project.js';
import { DEFAULT_HARDWARE, validHardware, blockName, hasController, CONTROLLERS } from './patch/hardware.js';
import { colorsFor } from './ui/look.js';
import { renderStage } from './ui/rack.js';
import { renderInspector } from './ui/inspector.js';
import { renderMidiMap } from './ui/midimap.js';
import { addToJack } from './ui/add.js';
import { setUpPlayerDialog } from './ui/players.js';
import { fh2Ports, looksLikeFh2, pullFromFh2, sendToFh2, saveToFlash, saveAllToFlash, watchFh2, readFh2Settings, readFh2Calibrations, loadFh2Calibration, setFh2StartupCalibration, withFh2Client, ec4Port,
  openEc4, watchEc4, fh2Output, pullPresetFromFh2, bcr32Port, openBcr32, watchBcr32 } from './ui/connect.js';
import { renderScenes } from './ui/scenes.js';
import { renderSettings } from './ui/settings.js';
import { renderGig } from './ui/gig.js';
import { checklist } from './patch/gig.js';
import { sceneDifferences, fitProblems } from './patch/scenes.js';
import { pagesOf, mapPages, toggleLive, liveKeys, choicesFor, pageNameKey, placeWithCc, takeOff, switchOn, switchOff, switchOffAll, jackKeys,
  addLivePage, removeLivePage, movePlace, toLivePage, isLive,
  wholePage, strayMappings, removeMappings, dropMapping, settingKey, objectKeys, leftBehind, toAbsolute, movePage, hidePage, sharePage, splitPage, SETUP, ccsFor } from './ec4/pages.js';
import { bcrPagesOf, putObject, switchOn as bcrOn, switchOff as bcrOff, placeKnob as bcrPlace, takeOff as bcrTakeOff, movePlace as bcrMove, clearPage as bcrClear,
  choicesFor as bcrChoices, halfChoices, freeHalf, pageOfObject, pageNameKey as bcrNameKey, knobOf, halfOf, KNOBS as BCR_KNOBS } from './rotary/pages.js';
import { wanted, plan, writePlan, storeImage, readImage, emptyHeld, heldToJson, heldFromJson, foreignKnobs, pageOnBcr32, editsFor, wantedFingerprint } from './rotary/image.js';
import { midiPermission } from '../vendor/lilypad/js/midi.js';
import { mergeFromModule, changedOutside, placesText } from './patch/sync.js';
import { parseTracks, hasTracks, TRACKS_SPACE } from './rotary/tracks.js';
import { Bcr32Link } from './rotary/link.js';
import { renderBcr32 } from './ui/bcr32.js';
import { readRecord } from '../vendor/eyeofprovidence/js/model.js';
import { readSetup, setupImage, setupState, writesFor, writeSetup, syncEntry, pagesFingerprint, pageRecords, SYNC_FORMAT, SYNC_MAX, HAS_013 } from './ec4/setup.js';
import { fingerprint } from './hash.js';
import { renderEc4, ec4Sketch, sketchLines } from './ui/ec4.js';
import { speedOf, speedChange, feelChange } from './ec4/feel.js';
import { Ec4Link, Cc14 } from './ec4/link.js';
import { valueOf, valueText, ccFor, fromCc, pathOf } from './ec4/values.js';
import { getPath } from './fh2/layout.js';
import { checksBusy } from './fh2/checks.js';
import { settingsByName, startAutoCalibration, watchAutoCalibration, finishAutoCalibration, saveCalibration, setStartupCalibration } from './fh2/menu.js';
import { calibrationDialog } from './ui/calibrate.js';
import { renderSteps } from './ui/steps.js';
import { scalaFiles, fileChange, asciiText, parseScl, parseKbm, SLOTS, slotLabel } from './patch/scala.js';

const HW_KEY = 'nightshift.hardware';
const PATCH_KEY = 'nightshift.patch'; // the last patch, as a project, kept after every change
const FH2_SETTINGS_KEY = 'nightshift.fh2settings'; // the FH-2's own settings, as last read
const FH2_CAL_KEY = 'nightshift.fh2calibrations'; // its calibration slots and startup slots, as last read
const PORT_KEY = 'nightshift.fh2port'; // the port you picked as the FH-2's when none is called FH-2
const EDITED_KEY = 'nightshift.edited'; // '1' while the kept patch has edits that never reached the FH-2 (survives a reload)
const THRU_KEY = 'nightshift.ec4thru';
const BCR_THRU_KEY = 'nightshift.bcr32thru';
const BCR_HELD_KEY = 'nightshift.bcr32held'; // what Night Shift last wrote on the BCR32 (rotary/image.js): its own knobs
const CONTROLLER_KEY = 'nightshift.controller';
function loadThru(key = THRU_KEY) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function loadHeld() {
  try {
    return heldFromJson(JSON.parse(localStorage.getItem(BCR_HELD_KEY)));
  } catch {
    return emptyHeld();
  }
}
function saveHeld() {
  try {
    localStorage.setItem(BCR_HELD_KEY, JSON.stringify(heldToJson(state.bcr32.held)));
  } catch {}
}
function loadController() {
  try {
    return localStorage.getItem(CONTROLLER_KEY) === 'bcr32' ? 'bcr32' : 'ec4';
  } catch {
    return 'ec4';
  }
}

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
  module: null, // the values the FH-2 holds, as last read (also in the background) or sent: { config, preset }, or null
  base: null, // what the FH-2 held when Get or Send last read or sent it: { config, preset, scene }; kept with the patch
  link: 'unknown', // 'connecting', 'connected', 'offline' (no FH-2 port), 'silent' (a port, no answer), 'blocked' (MIDI denied) or 'no-midi' (no Web MIDI)
  port: '',
  fh2Settings: storedSettings(), // { at, port, pages } as last read from the module's menus, or null
  fh2Calibrations: storedSettings(FH2_CAL_KEY), // { at, port, slots, startup } as last read (menu.js readCalibrations), or null
  sync: null, // how what you see compares with the FH-2: { kind: 'same' | 'scene' | 'differs' | 'unknown', scene }
  unsent: false, // what you see isn't what the FH-2 holds (or we don't know what it holds)
  editedBefore: false, // the kept patch was edited before this page load and never sent since (EDITED_KEY)
  busy: false,
  view: null,
  colors: new Map(),
  selected: null,
  tab: 'patch',
  ec4: { sel: null, note: '', link: null, thru: loadThru(), stored: false }, // the EC4 tab's knob in view ({ page, knob }), a line on
  // the EC4, the live link (ec4/link.js) while the EC4 is connected, and Night Shift's thru (EC4 → FH-2)
  ec4Model: null, // the EC4 pages (ec4/pages.js pagesOf), recomputed with the view
  bcr32: { sel: { page: 0, knob: null }, note: '', link: null, linking: false, thru: loadThru(BCR_THRU_KEY), image: null, held: loadHeld(), tracks: null }, // the BCR32
  // tab's place in view, a line on it, the live link (rotary/link.js), the thru, its image as last read and what Night Shift holds on it
  bcrModel: null, // the BCR32's pages (rotary/pages.js bcrPagesOf), recomputed with the view
  bcrDevice: null, // what the BCR32 holds besides: { foreign (other apps' knobs), pages (names, keys) }, from its image
  controller: loadController(), // the controller the Patch tab's names put settings on, of those switched on (Rack…)
  steps: { seq: 0, step: null, lane: 0 }, // the Steps tab: the sequencer in view, its step or lane
  banks: { notes: null, drums: null }, // the banks shown there: { name, msg } each
  status: '',
  warn: false,
};




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

const project = () => ({ config: state.config, scenes: state.scenes, scene: state.scene, names: state.names, hardware: state.hardware, base: state.base,
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
      localStorage.setItem(EDITED_KEY, state.unsent && (state.history.canUndo || state.editedBefore) ? '1' : '');
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
  state.view = state.config ? derive(state.config.values, state.preset?.values ?? null, state.hardware, withMarks(state.names, state.preset)) : null;
  state.colors = state.view ? colorsFor([...state.view.sources, ...state.view.players], state.colors) : new Map();
  state.sync = state.config ? syncOf() : null;
  state.unsent = state.config ? state.sync.kind !== 'same' : false;
  state.ec4Model = state.view ? pagesOf(state.view, state.names) : null;
  state.bcrModel = state.view ? bcrPagesOf(state.ec4Model, state.names) : null;
  store();
  render();
  showOnEc4();
  showOnBcr32();
}

// `presets` become the scenes (`scene` the one in view); a single `preset` is one scene. A
// project (`whole`) brings its scenes even when it has none. What the FH-2 holds stays as it is:
// the mark compares the new patch with it.
function load({ config, preset, presets, scene = 0, names, hardware, slots, scenesOnly, held, whole = false, base = null }, from) {
  if (config) state.config = config;
  if (config) state.base = base; // what the FH-2 held for this patch, if it says
  state.held = held ?? (config ? {} : state.held);
  const scenes = whole ? presets ?? [] : presets?.length ? presets : preset ? [preset] : null;
  if (scenes) {
    state.scenes = scenes;
    state.scene = Math.max(0, Math.min(scene, scenes.length - 1));
    state.slots = slots ?? { config: config ? null : state.slots.config, scenes: scenes.map(() => null) }; // presets alone: the config keeps its slot
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
  state.editedBefore = from === 'browser' && storedEdited();
  update();
}

function storedEdited() {
  try {
    return localStorage.getItem(EDITED_KEY) === '1';
  } catch {
    return false;
  }
}

// ---- editing

// `force`: for Get from FH-2 and the Scenes page, which may change the config while
// “Scenes only” is on.
// Returns whether it changed anything.
function edit(label, changes, { force = false } = {}) {
  if (state.scenesOnly && !force && changes.some((c) => c.dump === 'config')) {
    state.status = 'Setup locked: Scenes only is on';
    state.warn = true;
    render();
    return false;
  }
  let done = false;
  try {
    done = state.history.do(patch(), label, [...changes, ...leftOnEc4(changes)], { scene: state.scene });
    if (done) {
      state.status = label;
      state.warn = false;
    }
  } catch (e) {
    state.status = `Couldn’t change that: ${e.message}`;
    state.warn = true;
  }
  update();
  return done;
}

// An edit of the setup that takes something out of the patch (a player stopped, a shift register's
// last jack cleared) takes its knobs off the EC4 too, in the same step (pages.js leftBehind). The
// scene's values don't count: a Euclid without a jack at 0 pulses is gone from this scene only.
function leftOnEc4(changes) {
  const before = state.ec4Model;
  const setup = changes.filter((c) => c.dump !== 'preset' && c.dump !== 'marks');
  if (!before || !setup.some((c) => c.dump === 'config')) return [];
  const p = patch();
  const undo = apply(p, setup);
  try {
    return leftBehind(before, pagesOf(derive(p.config.values, p.preset?.values ?? null, state.hardware, withMarks(p.names, p.preset)), p.names), p.names);
  } finally {
    apply(p, undo);
  }
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
    const ec4Off = keys.length ? switchOffAll(state.names, model, keys, { everywhere: true }) : [];
    const done = edit(own.length && port ? `Cleared jack ${port.jack}` : `${source.kind === 'hid' ? 'Switched off' : 'Removed'} ${source.name}${port && source.ports.length > 1 ? ` ${port.name}` : ''}${where}${links}`,
      [...(port ? removePort(values(), source, port) : removeSource(values(), source)), ...ec4Off]);
    if (!port && done) state.selected = null;
    render();
  } catch (e) {
    status(`Couldn’t remove that: ${e.message}`, true);
  }
}

// An LFO off, with the CCs on its settings and its knobs on the EC4's pages.
function removeLfoOf(output, jack) {
  edit(`Removed the LFO on jack ${jack}`, [...removeLfoWithCcs(values(), output),
    ...switchOffAll(state.names, ec4Model(), jackKeys(output, (p) => p.startsWith('lfo')), { everywhere: true })]);
}

// A player that sends somewhere, picked from the FH-2's unused ones (see ui/players.js).
async function setUpPlayer() {
  if (state.scenesOnly) return status('Setup locked: Scenes only is on', true);
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
  state.history.shiftScenes(state.scene + 1, 1);
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
  // its own values' steps go; config steps made while it was in view stay (edit.js History.dropScene)
  state.history.dropScene(gone);
  state.scene = Math.min(gone, state.scenes.length - 1);
  state.preset = state.scenes[state.scene];
  status(`Removed scene ${name}`);
  update();
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
      fit: fitProblems(i === state.scene ? v : derive(state.config.values, s.values, state.hardware, withMarks(state.names, s)), state.config.values, s.values),
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
        load({ config: project.config, presets: project.scenes, scene: project.scene, names: project.names, hardware: project.hardware, slots: project.slots, scenesOnly: project.scenesOnly, held: project.held, base: project.base, whole: true }, f.name);
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
        if (d.masked) notes.push(`${f.name}: ${d.masked} byte${d.masked === 1 ? '' : 's'} not 7-bit, cleared (a “None” output from the official tool?)`);
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

// Asks before a file or the example replaces edits that aren't on the FH-2: edits made here,
// or before a reload (the history is new then, but EDITED_KEY remembers).
async function dropUnsent(what) {
  if (!state.unsent || !(state.history.canUndo || state.editedBefore)) return true;
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
  const known = pairs.find((p) => p.name === storedPort());
  if (known) return known;
  const pick = await modal($('dialog'), {
    title: 'Which port is the FH-2?',
    body: h('p', { class: 'note' }, 'No port is called “FH-2”.'),
    buttons: [...pairs.map((p, i) => ({ label: p.name, value: i })), { label: 'Cancel', value: null }],
  });
  if (pick == null) {
    status('');
    return null;
  }
  try {
    localStorage.setItem(PORT_KEY, pairs[pick].name);
  } catch {}
  return pairs[pick];
}

function storedPort() {
  try {
    return localStorage.getItem(PORT_KEY);
  } catch {
    return null;
  }
}

async function withFh2(work) {
  if (state.busy) return status('Busy with the FH-2…', true);
  state.busy = true;
  try {
    const pair = await pickFh2();
    if (pair) await work(pair);
  } catch (e) {
    status(midiProblem(e) ?? `The FH-2 didn’t answer: ${e.message}`, true);
  } finally {
    state.busy = false;
    render();
  }
}

// ---- one Get and one Send, for the FH-2 and the controllers switched on (docs/build-plan.md, "One
// Get and one Send", your design 2026-11-09). Every device there is read first; Send then asks what
// needs asking, and only then writes. A device that isn't there is skipped, and the status says so.

const controllerOn = (id) => hasController(state.hardware, id);
const layoutOf = (d) => DUMPS[d.cmd].layout;

// The FH-2 for Get and Send: a port named like it, or the one you picked once; no question here.
async function fh2ForAll() {
  const pairs = await fh2Ports();
  return pairs.find(looksLikeFh2) ?? pairs.find((p) => p.name === storedPort()) ?? null;
}

// A controller for the length of a Get or Send: its live link's device, else its port opened now.
async function openController(id) {
  const link = id === 'ec4' ? state.ec4.link : state.bcr32.link;
  if (link) return { device: link.device, info: link.info, link, close: () => {} };
  const pair = await (id === 'ec4' ? ec4Port() : bcr32Port());
  if (!pair) return null;
  const { device, info } = await (id === 'ec4' ? openEc4(pair, () => {}) : openBcr32(pair, () => {}));
  return { device, info, link: null, close: () => device.close() };
}
const controllerName = (id) => (id === 'ec4' ? 'EC4' : 'BCR32');

// Get: the FH-2's patch into what you see (your unsent edits stay), and the controllers' state.
async function get() {
  if (state.busy) return status('Busy…', true);
  state.busy = true;
  const said = [];
  let warn = false;
  try {
    const pair = await fh2ForAll();
    said.push(pair ? await getFh2(pair) : 'FH-2 not connected');
    for (const id of ['bcr32', 'ec4']) {
      if (!controllerOn(id)) continue;
      try {
        said.push(await getController(id));
      } catch (e) {
        warn = true;
        said.push(`${controllerName(id)}: ${midiProblem(e) ?? e.message}`);
      }
    }
  } catch (e) {
    warn = true;
    said.push(midiProblem(e) ?? `The FH-2 didn’t answer: ${e.message}`);
  } finally {
    state.busy = false;
  }
  status(said.filter(Boolean).join(' · '), warn);
  showOnEc4();
  showOnBcr32();
}

// The FH-2's changes since Night Shift last read or sent it come in as one undoable step; edits made
// here and not sent stay, also where the module changed the same field (named in the status).
async function getFh2(pair) {
  status(`Reading ${pair.name}…`);
  const r = await pullFromFh2(pair);
  readModule(r);
  Object.assign(state, { link: 'connected', port: pair.name });
  const theirs = { config: r.config.values, preset: r.preset.values };
  const odd = r.config.versionOk ? '' : ' (unexpected config version)';
  if (!state.config || !state.preset) {
    load({ config: r.config, preset: r.preset }, `${pair.name}, ${r.version}`);
    state.base = { ...structuredClone(theirs), scene: 0 };
    store();
    return `Got the patch from the FH-2${odd}`;
  }
  if (state.from === 'example') state.from = `${pair.name}, ${r.version}`; // the module's patch in the example's place: yours now, so kept
  // the FH-2 holds another of your scenes: show it, rather than copy it into this one
  const same = (d, v) => diff(layoutOf(d), d.values, v).length === 0;
  const other = same(state.config, theirs.config) && !same(state.preset, theirs.preset) ? state.scenes.findIndex((x) => same(x, theirs.preset)) : -1;
  if (other >= 0) {
    state.scene = other;
    state.preset = state.scenes[other];
    state.base = { ...structuredClone(theirs), scene: other };
    update();
    return `Scene ${sceneName(other)} is on the FH-2`;
  }
  // with no record of what the FH-2 held (a file, another browser), the module's patch is taken whole
  const merge = (d, base, v) => (base ? mergeFromModule(layoutOf(d), base, d.values, v)
    : { take: diff(layoutOf(d), d.values, v).map((x) => ({ path: x.path, value: x.to })), kept: [] });
  const c = merge(state.config, state.base?.config, theirs.config);
  const p = merge(state.preset, state.base?.scene === state.scene ? state.base.preset : null, theirs.preset);
  state.base = { ...structuredClone(theirs), scene: state.scene };
  const changes = [...c.take.map((x) => ({ dump: 'config', ...x })), ...p.take.map((x) => ({ dump: 'preset', ...x }))];
  const kept = [...c.kept, ...p.kept];
  const keptText = kept.length ? ` · yours kept: ${placesText(kept)}` : '';
  if (!changes.length) {
    update();
    return `FH-2: nothing new${keptText}`;
  }
  edit(`Got from the FH-2${state.scenes.length > 1 ? ` into scene ${sceneName(state.scene)}` : ''}`, changes, { force: true });
  return `Got from the FH-2${odd}${keptText}`;
}

// A controller's state read: the BCR32's image (other apps' knobs, the pages' names and outputs)
// and its tracks; whether EC4 setup 15 holds Night Shift's pages. Nothing changes on either.
async function getController(id) {
  const c = await openController(id);
  if (!c) return `${controllerName(id)} not connected`;
  try {
    if (id === 'bcr32') {
      status('Reading the BCR32…');
      sawBcr32(await readImage(c.device));
      if (hasTracks(c.info)) state.bcr32.tracks = parseTracks(Uint8Array.from([...await c.device.read(0, 256, TRACKS_SPACE), ...await c.device.read(256, 16, TRACKS_SPACE)]));
      return bcr32Unstored() ? 'BCR32: Night Shift’s knobs not stored' : 'BCR32 read';
    }
    status(`Reading EC4 setup ${SETUP + 1}…`);
    const model = state.ec4Model;
    const base = await readSetup(c.device);
    const sync = syncFor(c.info);
    const stored = !writesFor(setupImage(base, model.pages, state.view, model.channel, sync), base).length;
    if (stored) heldOnEc4(model, sync, c.info);
    const now = setupState(base);
    return stored ? 'EC4 read' : now.ours || now.free ? 'EC4: pages not stored' : `EC4 setup ${SETUP + 1} holds “${now.name.trim()}”`;
  } finally {
    c.close();
  }
}

function heldOnEc4(model, sync, info) {
  state.held = { ...state.held, ec4: { at: new Date().toISOString(), fp: pagesFingerprint(model.pages, state.view, model.channel, sync), fw: [info.fwMajor, info.fwMinor] } };
  state.ec4.stored = true; // the EC4's EEPROM is known from here on
  store();
}

// Send: every device read first; asked where the FH-2's config changed outside since Night Shift last
// read or sent it (its preset is overwritten silently), where another app's knob is in the BCR32's way,
// and where EC4 setup 15 holds someone else's; then what you see to the FH-2's RAM and Night Shift's
// knobs to the controllers (only its own; never their other knobs, keys or sequencer).
async function send() {
  if (state.busy) return status('Busy…', true);
  state.busy = true;
  const opened = [];
  const said = [];
  let warn = false;
  try {
    const pair = state.config ? await fh2ForAll() : null;
    let module = null;
    if (pair) {
      status(`Reading ${pair.name}…`);
      module = await pullFromFh2(pair);
      readModule(module);
      Object.assign(state, { link: 'connected', port: pair.name });
    } else if (state.config) said.push('FH-2 not connected');
    const bcr = controllerOn('bcr32') ? await readBcr32ForSend(opened, said) : null;
    const ec4 = controllerOn('ec4') ? await readEc4ForSend(opened, said) : null;
    // what needs asking, before anything is written
    if (module && state.base) {
      const outside = changedOutside(layoutOf(state.config), state.base.config, state.config.values, module.config.values);
      if (outside.length && !await modal($('dialog'), {
        title: 'The FH-2’s config changed',
        body: h('p', { class: 'note' }, `Since Night Shift last read or sent it: ${placesText(outside.map((d) => d.path))}. Send replaces it.`),
        buttons: [{ label: 'Cancel', value: false }, { label: 'Send anyway', value: true, primary: true }],
      })) return status('Nothing sent');
    }
    if (bcr?.pl.conflicts.length) {
      const answer = await askBcr32(bcr.pl);
      if (!answer) return status('Nothing sent');
      if (answer === 'over') bcr.pl = plan(bcr.img, bcr.want, state.bcr32.held, { over: new Set(bcr.pl.conflicts.map((c) => (c.i != null ? `${c.p}:${c.i}` : `name:${c.p}`))) });
    }
    if (ec4?.foreign && !await askEc4(ec4)) return status('Nothing sent');
    // written
    if (module) {
      const r = await sendFh2(pair);
      said.unshift(r.text);
      warn ||= !!r.warn;
    }
    for (const [id, part, write] of [['bcr32', bcr, writeBcr32], ['ec4', ec4, writeEc4]]) {
      if (!part) continue;
      try {
        said.push(await write(part));
      } catch (e) {
        warn = true;
        // Rotary Club 0.24 on: RELOAD answers an error when the BCR32 uses the image but couldn't keep it
        said.push(id === 'bcr32' && e.cmd === 0x24 && e.code != null ? 'BCR32 plays the knobs but couldn’t keep them: Send again'
          : `${controllerName(id)}: ${midiProblem(e) ?? e.message}`);
      }
    }
  } catch (e) {
    warn = true;
    said.push(midiProblem(e) ?? `Send stopped: ${e.message}`);
  } finally {
    opened.forEach((c) => c.close());
    state.busy = false;
    render();
  }
  status(said.filter(Boolean).join(' · ') || 'Nothing to send', warn);
  showOnEc4();
  showOnBcr32();
}

async function sendFh2(pair) {
  status(`Sending to ${pair.name}…`);
  const r = await sendToFh2(pair, patch());
  const off = offText(r.off);
  if (off) {
    state.module = null;
    update();
    return { text: off, warn: true };
  }
  state.module = { ...r.sent };
  state.base = { ...structuredClone(r.sent), scene: state.scene }; // what the FH-2 holds now, kept with the patch
  update();
  return { text: 'Sent to the FH-2' };
}

// The BCR32 read for a Send, and Night Shift's knobs planned against it; null when it has nothing of
// Night Shift's to write or take off, or isn't there (said).
async function readBcr32ForSend(opened, said) {
  const model = bcrModel();
  if (model.unmapped.length) return said.push('BCR32: give every knob a CC first'), null;
  if (!model.count && !state.bcr32.held.knobs.size) return null;
  try {
    const c = await openController('bcr32');
    if (!c) return said.push('BCR32 not connected'), null;
    opened.push(c);
    status('Reading the BCR32…');
    const img = await readImage(c.device);
    sawBcr32(img);
    const want = wanted(model, state.view, bcrSync());
    return { c, img, want, pl: plan(img, want, state.bcr32.held) };
  } catch (e) {
    return said.push(`BCR32: ${midiProblem(e) ?? e.message}`), null;
  }
}

function askBcr32(pl) {
  const n = pl.conflicts.length;
  const list = pl.conflicts.map((c) => (c.i != null ? `page ${c.p + 1} knob ${c.i + 1}: ${c.now.name || '····'} (${c.now.sends})` : `page ${c.p + 1}’s name ${c.name}`));
  return modal($('dialog'), {
    title: `${n} place${n === 1 ? '' : 's'} on the BCR32 hold knobs not written from this browser`,
    body: h('p', { class: 'note' }, `${list.slice(0, 8).join('; ')}${list.length > 8 ? ` and ${list.length - 8} more` : ''}.`),
    buttons: [{ label: 'Cancel', value: false }, { label: 'Leave them', value: 'keep' }, { label: 'Write over', value: 'over', primary: true }],
  });
}

// Night Shift's knobs to the BCR32, then RELOAD: it uses and stores them, and only then does Night Shift hold them.
async function writeBcr32({ c, pl, want }) {
  const left = pl.conflicts.length;
  const leftText = left ? ` · ${left} left as they were` : '';
  if (!pl.writes.length && sameHeld(pl.held, state.bcr32.held)) return `BCR32 has these knobs${leftText}`;
  if (pl.writes.length) await writePlan(c.device, pl, (k, n) => status(`Writing the BCR32… ${k}/${n}`));
  else await storeImage(c.device); // the image has them already: stored
  state.bcr32.held = pl.held;
  saveHeld();
  state.held = { ...state.held, bcr32: { at: new Date().toISOString(), fp: wantedFingerprint(want) } }; // for the Gig tab
  store();
  sawBcr32(pl.next);
  state.bcr32.link?.forget();
  return `BCR32 stored${leftText}`;
}

// EC4 setup 15 read for a Send; null when Night Shift has no pages there and never had, or it isn't there (said).
async function readEc4ForSend(opened, said) {
  const model = ec4Model();
  if (model.unmapped.length) return said.push('EC4: give every knob and push a CC first'), null;
  if (!model.pages.length && !state.held.ec4) return null;
  try {
    const c = await openController('ec4');
    if (!c) return said.push('EC4 not connected'), null;
    opened.push(c);
    status(`Reading EC4 setup ${SETUP + 1}…`);
    const base = await readSetup(c.device, (k, n) => status(`Reading EC4 setup ${SETUP + 1}… ${Math.round((100 * k) / n)} %`));
    const sync = syncFor(c.info);
    const img = setupImage(base, model.pages, state.view, model.channel, sync);
    const writes = writesFor(img, base);
    const now = setupState(base);
    return { c, model, base, img, sync, writes, now, foreign: writes.length > 0 && !now.ours && !now.free };
  } catch (e) {
    return said.push(`EC4: ${midiProblem(e) ?? e.message}`), null;
  }
}

function askEc4({ now }) {
  return modal($('dialog'), {
    title: `EC4 setup ${SETUP + 1} holds “${now.name.trim()}”`,
    body: h('p', { class: 'note' }, `Its pages: ${now.groups.slice(0, 4).map((g) => g.trim()).filter(Boolean).join(', ') || 'none named'}. Send puts Night Shift’s pages there instead; the other setups stay as they are.`),
    buttons: [{ label: 'Cancel', value: false }, { label: 'Write', value: true, primary: true }],
  });
}

async function writeEc4({ c, model, base, img, sync, writes }) {
  const synced = model.pages.reduce((n, pg) => n + pg.cells.filter((x) => syncEntry(x, sync)).length, 0);
  const capped = sync.format > 1 && synced > SYNC_MAX ? ` · only ${SYNC_MAX} of its knobs follow the FH-2` : '';
  if (!writes.length) {
    heldOnEc4(model, sync, c.info);
    return `EC4 has these pages${capped}`;
  }
  await writeSetup(c.device, img, base, (k, n) => status(`Writing the EC4… ${k}/${n}`), c.link?.ours ? c.link.group : 0);
  heldOnEc4(model, sync, c.info);
  return `EC4 setup ${SETUP + 1} written${capped}`;
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
    let r;
    try {
      r = await pullFromFh2(pair);
    } catch (e) { // the port is there but nothing answers: another app holding it, the module in a menu
      if (midiProblem(e)) throw e;
      Object.assign(state, { link: 'silent', port: pair.name, module: null });
      return;
    }
    Object.assign(state, { link: 'connected', port: pair.name });
    if (!state.config) {
      readModule(r);
      load({ config: r.config, preset: r.preset }, `${pair.name}, ${r.version}`);
      state.status = `Got the patch from ${pair.name}`;
    } else readModule(r);
  } catch (e) {
    Object.assign(state, { link: noWebMidi() ? 'no-midi' : refused(e) ? 'blocked' : 'offline', module: null });
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

const noWebMidi = () => typeof navigator === 'undefined' || !navigator.requestMIDIAccess;
const refused = (e) => e.name === 'SecurityError' || e.name === 'NotAllowedError' || /permission|webmidi/i.test(e.message);
// Why MIDI itself failed, or null when it was the device that didn't answer.
const midiProblem = (e) => (noWebMidi() ? 'No MIDI in this browser (use Chrome or Edge)' : refused(e) ? 'MIDI access blocked: allow it for this site' : null);

// What came back different after a send, for the status line; '' when nothing did.
function offText(off) {
  const list = Object.entries(off).filter(([, d]) => d.length)
    .map(([k, d]) => `${k}: ${d.slice(0, 3).map((x) => x.path.join('.')).join(', ')}${d.length > 3 ? ` and ${d.length - 3} more` : ''}`);
  return list.length ? `Sent, but the FH-2 holds something else for ${list.join('; ')}` : '';
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
    if (r) status({ saved: `Jack ${jack} calibrated and saved${state.fh2Calibrations ? '' : ' · Read calibrations to see it'}`, accepted: `Jack ${jack} calibrated, until power-off`, abandoned: `Calibration of jack ${jack} abandoned` }[r]);
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
    status(`Checking ${pair.name}…`); // the FH-2 saves what it holds: make sure that is what you see
    readModule(await pullFromFh2(pair));
    update();
    if (state.sync.kind !== 'same') return status('The FH-2 holds something else: Send first', true);
    status(`Saving to ${pair.name}’s flash…`);
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
const inputsOf = (key) => state.view.players.filter((p) => p.kind === 'input' && p.targets?.some((t) => settingKey(t.target) === key)).map((p) => 'XY'[p.index]);
const ec4 = {
  name: 'EC4',
  state(key) {
    const model = state.ec4Model;
    const c = model?.known.get(key);
    if (!c) return null;
    const where = model.on.get(key) ?? [];
    const m = model.mapOf(key);
    const cc = m ? `ch ${m.channel + 1} · CC ${m.cc}` : '';
    const inputs = inputsOf(key);
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

// The same for the BCR32's pages (rotary/pages.js): a setting goes with its object's others, else
// into a free half; never onto another app's knob.
const bcr32Labels = {
  name: 'BCR32',
  state(key) {
    const c = state.ec4Model?.known.get(key);
    if (!c) return null;
    const where = state.bcrModel.on.get(key) ?? [];
    const m = state.ec4Model.mapOf(key);
    const cc = m ? `ch ${m.channel + 1} · CC ${m.cc}` : '';
    return { on: where.length > 0, inputs: inputsOf(key), title: where.length
      ? `On the BCR32: ${where.map((w) => `page ${w.page + 1} ${w.push ? 'push' : 'knob'} ${w.index + 1}`).join(', ')} · ${cc}. Click to take it off`
      : `Click to put it on the BCR32${cc ? ` (${cc})` : ''}` };
  },
  toggle(key) {
    const model = ec4Model();
    const bcr = bcrPagesOf(model, state.names);
    const c = model.known.get(key);
    if (bcr.on.has(key)) return edit(`Off the BCR32: ${c ? c.label.toLowerCase() : 'a setting gone from the patch'}`, bcrOff(state.names, model, key));
    const r = bcrOn(state.config.values, state.view, state.names, model, bcr, key, { page: bcrPageInView(), foreign: foreignAt });
    if (r.error) return status(r.error, true);
    edit(`On the BCR32: page ${r.where.page + 1} ${r.where.push ? 'push' : 'knob'} ${r.where.index + 1}`, r.changes);
    state.bcr32.sel = { page: r.where.page, knob: r.where.index };
    state.bcr32.link?.select(r.where.page).catch(() => {});
  },
};

// The controller the Patch tab's names act on: the one whose tab you opened last, of those switched
// on in Rack…; none, while both are off.
function target() {
  const on = ['ec4', 'bcr32'].filter((id) => hasController(state.hardware, id));
  return on.includes(state.controller) ? state.controller : on[0] ?? null;
}
const labels = () => ({ ec4, bcr32: bcr32Labels }[target()] ?? null);

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
  const stray = strayMappings(state.view, ec4Model(), state.names);
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
// The sync table's settings for firmware `info` (IDENTIFY): its format, the tempo's CC base, the
// scene channel, and from controlfrog 0.13 table C (FH-2 units on the EC4 by itself).
const syncFor = (info) => ({ format: SYNC_FORMAT(info), tempoMin: state.config.values.tempoMin, programChannel: state.config.values.presetProgramChannel, display: HAS_013(info) });

function gigList() {
  const model = state.ec4Model;
  const fw = state.held.ec4?.fw;
  const sync = syncFor(fw && { fwMajor: fw[0], fwMinor: fw[1] });
  return checklist({
    config: { slot: state.slots.config, fp: fp(state.config), values: state.config.values },
    scenes: state.scenes.map((s, i) => ({ name: sceneName(i), slot: state.slots.scenes[i], fp: fp(s) })),
    view: state.view, fh2: state.fh2Settings, held: state.held,
    ec4: hasController(state.hardware, 'ec4') ? { pages: model.pages.length, fp: model.pages.length ? pagesFingerprint(model.pages, state.view, model.channel, sync) : null,
      synced: model.pages.reduce((n, pg) => n + pg.cells.filter((c) => syncEntry(c, sync)).length, 0), max: SYNC_MAX } : null,
    bcr32: hasController(state.hardware, 'bcr32') ? bcr32Gig() : null,
  });
}

// The BCR32's line on the Gig tab: Night Shift's knobs as they would be sent now, and the pages
// holding some that don't send on USB (as the BCR32 was last read).
function bcr32Gig() {
  const bcr = state.bcrModel;
  const noUsb = state.bcrDevice ? bcr.pages.filter((pg, p) => state.bcrDevice.pages[p] && !state.bcrDevice.pages[p].usb && [...pg.cells, ...pg.pushes].some(Boolean)).map((pg) => pg.index) : [];
  return { knobs: bcr.count, fp: bcr.count ? wantedFingerprint(wanted(bcr, state.view, bcrSync())) : null, noUsb };
}

// ---- the live link (ec4/link.js): the EC4 and Night Shift follow each other's page, the
// EC4 shows values in FH-2 units, a touched knob shows its setting, and Night Shift's thru
// passes the knobs on to the FH-2 (off while Logic does that).

let fh2Out = null; // the FH-2's output port, for the thru
const cc14 = new Cc14();

async function linkEc4() {
  if (state.ec4.link || state.ec4.linking || !hasController(state.hardware, 'ec4')) return;
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
  // controlfrog 0.13: the page as Night Shift has it, into the EC4's RAM (its EEPROM only on Store)
  if (link.edits) link.edit(pageRecords(page, link.group, state.view, state.ec4Model.channel), state.ec4.stored && !ec4Unstored()).catch(() => {});
}

// Whether Night Shift's pages differ from what it last stored on the EC4.
function ec4Unstored() {
  const model = state.ec4Model;
  const info = state.ec4.link?.info;
  return !state.held.ec4?.fp || state.held.ec4.fp !== pagesFingerprint(model.pages, state.view, model.channel, syncFor(info));
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
      turnedOn = 'EC4';
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
let turnedOn = 'EC4'; // the controller they were turned on
let readBackTimer = null;
async function readBack() {
  readBackTimer = null;
  const keys = [...turned];
  turned.clear();
  // not while the hardware checks page runs a check: the FH-2 holds a test config then
  if (state.busy || state.link !== 'connected' || !state.preset || state.sync?.kind === 'scene' || checksBusy(localStorage)) return;
  state.busy = true;
  render(); // Get, Send and Save rest meanwhile
  try {
    const pair = (await fh2Ports()).find(looksLikeFh2);
    if (!pair) return;
    const preset = await pullPresetFromFh2(pair);
    const changes = [];
    for (const k of keys) {
      const path = pathOf(state.ec4Model.known.get(k)?.setting ?? { kind: '' });
      if (!path) continue;
      const v = getPath(preset.values, path);
      if (v !== getPath(state.preset.values, path)) changes.push({ dump: 'preset', path, value: v });
    }
    if (state.module) state.module = { ...state.module, preset: structuredClone(preset.values) }; // what the FH-2 holds now
    const labels = keys.map((k) => state.ec4Model.known.get(k)?.label.toLowerCase()).filter(Boolean);
    state.busy = false;
    if (changes.length) edit(`From the ${turnedOn}: ${labels.slice(0, 3).join(', ')}${labels.length > 3 ? '…' : ''}`, changes, { force: true });
    else update();
  } catch {
    // the knobs still changed the FH-2; the mark says so at the next read
  } finally {
    if (state.busy) {
      state.busy = false;
      render();
    }
  }
}

function toggleThru() {
  state.ec4.thru = !state.ec4.thru;
  try {
    localStorage.setItem(THRU_KEY, state.ec4.thru ? '1' : '0');
  } catch {}
  status(state.ec4.thru ? 'Thru on: the EC4’s knobs go on to the FH-2' : 'Thru off');
}

// ---- the BCR32 under Rotary Club (rotary/): Night Shift's own knobs on its four pages; the rest of
// each page and the keys stay as another app (Eye of Providence) left them (your calls, 2026-11-08)

const bcrModel = () => bcrPagesOf(ec4Model(), state.names);
const foreignAt = (p, i) => !!state.bcrDevice?.foreign.has(`${p}:${i}`);
const bcrPageInView = () => state.bcr32.link?.page ?? state.bcr32.sel?.page ?? 0;
const bcrSync = () => ({ tempoMin: state.config.values.tempoMin, programChannel: state.config.values.presetProgramChannel });

// The BCR32's image as just read or written: other apps' knobs, the pages' names and keys from it.
function sawBcr32(img) {
  state.bcr32.image = img;
  state.bcrDevice = img ? { foreign: foreignKnobs(img, state.bcr32.held), pages: [0, 1, 2, 3].map((p) => pageOnBcr32(img, p)) } : null;
}

function mapBcr32() {
  const want = bcrModel().unmapped;
  const r = ccsFor(state.config.values, state.view, state.names, ec4Model(), want);
  if (!r.changes.length) return status(r.left.length ? `No room for ${r.left.length} more CCs` : 'Every knob has a CC', r.left.length > 0);
  const n = want.length - r.left.length;
  edit(`${n} CC${n === 1 ? '' : 's'} added${r.left.length ? `; no room for ${r.left.length}` : ''}`, r.changes);
}

// A free knob (or another app's, which Send then asks about): any setting.
async function pickBcr32(p, i) {
  const model = ec4Model();
  const groups = bcrChoices(model, bcrPagesOf(model, state.names), p);
  if (!groups.length) return status('Every setting is on this page already');
  const select = h('select', { 'aria-label': 'Setting' }, groups.map((g) => h('optgroup', { label: g.name },
    g.cells.map((c) => h('option', { value: c.key }, `${c.label} (${c.short})`)))));
  const ok = await modal($('dialog'), {
    title: `Knob ${i + 1} of page ${p + 1}`,
    body: select,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Put it here', value: true, primary: true }],
  });
  if (!ok) return;
  const r = bcrPlace(state.config.values, state.view, state.names, model, p, i, select.value);
  if (r.error) return status(r.error, true);
  state.bcr32.sel = { page: p, knob: i };
  edit(`Put on page ${p + 1}`, r.changes);
}

function takeOffBcr32(p, i, push) {
  edit(`Taken off page ${p + 1}`, bcrTakeOff(state.names, ec4Model(), p, i, push));
}

function moveBcr32(from, to) {
  if (from.page === to.page && from.index === to.index) return;
  state.bcr32.sel = { page: to.page, knob: to.index };
  edit(from.page === to.page ? `Knob ${from.index + 1} to place ${to.index + 1}` : `Knob to page ${to.page + 1}`, bcrMove(state.names, from, to));
}

// A knob onto page `q`: the same place if it is free there, else a free one in the same half, else any.
function toPageBcr32(from, q) {
  if (from.page === q) return;
  const bcr = bcrModel();
  const free = (i) => !bcr.pages[q].cells[i] && !bcr.pages[q].pushes[i] && !foreignAt(q, i);
  const half = Array.from({ length: 16 }, (_, t) => knobOf(halfOf(from.index), t));
  const i = free(from.index) ? from.index : half.find(free) ?? [...Array(BCR_KNOBS).keys()].find(free);
  if (i == null) return status(`Page ${q + 1} is full`, true);
  moveBcr32(from, { page: q, index: i });
}

// "+ Half for…": an object's template into a free half of the page in view.
function putHalfBcr32(objPage) {
  const p = state.bcr32.sel?.page ?? 0;
  const model = ec4Model();
  const bcr = bcrPagesOf(model, state.names);
  const half = freeHalf(bcr, p, foreignAt);
  if (half < 0) return status(`No free half on page ${p + 1}`, true);
  const r = putObject(state.config.values, state.view, state.names, model, bcr, objPage, p, half, foreignAt);
  if (r.error) return status(r.error, true);
  state.bcr32.sel = { page: p, knob: knobOf(half, 0) };
  edit(`${r.count} on page ${p + 1}`, r.changes);
}

function renameBcr32Page(p) {
  const theirs = state.bcrDevice?.pages[p]?.name ?? '';
  rename(bcrNameKey(p), state.bcrModel.pages[p].name ?? (theirs || `P${p + 1}`), theirs ? `the BCR32’s ${theirs}` : 'none', 4);
}

const sameHeld = (a, b) => a.knobs.size === b.knobs.size && [...a.knobs].every(([id, x]) => b.knobs.get(id)?.every((v, k) => v === x[k]))
  && a.names.size === b.names.size && [...a.names].every(([p, n]) => b.names.get(p) === n);

// Whether the BCR32 lacks some of Night Shift's knobs as you see them (as its image was last read).
let unstoredFor = null; // [model, image, held, answer]: one plan per change, not per redraw
function bcr32Unstored() {
  const img = state.bcr32.image;
  if (!img || !state.bcrModel) return false;
  if (unstoredFor?.[0] === state.bcrModel && unstoredFor[1] === img && unstoredFor[2] === state.bcr32.held) return unstoredFor[3];
  const pl = plan(img, wanted(state.bcrModel, state.view, bcrSync()), state.bcr32.held);
  unstoredFor = [state.bcrModel, img, state.bcr32.held, pl.writes.length > 0 || pl.conflicts.length > 0];
  return unstoredFor[3];
}

// ---- its live link (rotary/link.js): the BCR32 and Night Shift follow each other's page, the BCR32
// shows values in FH-2 units and starts its knobs where the FH-2 is, a touched knob shows its setting,
// and Night Shift's thru passes its knobs (only those) on to the FH-2.

const bcrCc14 = new Cc14();

async function linkBcr32() {
  if (state.bcr32.link || state.bcr32.linking || !hasController(state.hardware, 'bcr32')) return;
  state.bcr32.linking = true;
  try {
    const pair = await bcr32Port();
    if (!pair) return;
    const { device, info } = await openBcr32(pair, onBcr32Midi);
    const link = new Bcr32Link(device, info);
    link.addEventListener('state', (e) => onBcr32State(e.detail));
    link.addEventListener('touch', (e) => onBcr32Touch(e.detail));
    state.bcr32.link = link;
    state.bcr32.note = `Rotary Club ${info.fwMajor}.${info.fwMinor}`;
    await link.start();
    if (!state.busy) sawBcr32(await readImage(device));
  } catch (e) {
    state.bcr32.note = refused(e) ? '' : `BCR32: ${e.message}`;
    state.bcr32.link?.close();
    state.bcr32.link = null;
  } finally {
    state.bcr32.linking = false;
    render();
    showOnBcr32();
  }
}

function unlinkBcr32() {
  state.bcr32.link?.close();
  state.bcr32.link = null;
  state.bcr32.note = '';
  render();
}

// The object a selection in the Patch tab is about, as the pages name it.
const objectOfSelection = () => {
  const sel = state.selected;
  const id = sel?.source ?? sel?.player ?? (sel?.output != null ? `lfo:${sel.output}` : null);
  return id === 'clocks' ? 'clock' : id;
};
const selectionOf = (id) => (state.view.sources.some((s) => s.id === id) ? { source: id }
  : state.view.players.some((p) => p.id === id) ? { player: id }
  : id === 'clock' ? { source: 'clocks' } : id?.startsWith('lfo:') ? { output: Number(id.slice(4)) } : null);
const objectOfKey = (key) => state.ec4Model?.objects.find((o) => o.knobs.some((c) => c.key === key) || o.commands.some((c) => c.key === key))?.id ?? null;

// Night Shift → BCR32: the page holding most of what you selected.
function followOnBcr32() {
  const link = state.bcr32.link;
  if (!link || state.tab !== 'patch' || !state.bcrModel) return;
  const id = objectOfSelection();
  const q = id && pageOfObject(state.ec4Model, state.bcrModel, id);
  if (q != null) link.select(q).catch(() => {});
}

// BCR32 → Night Shift: its page shows in the BCR32 tab; in the Patch tab, the object most of its
// knobs are about, unless what you selected has knobs there.
function onBcr32State({ page, moved }) {
  if (moved && page != null && state.bcrModel) {
    if (state.tab === 'bcr32') state.bcr32.sel = { page, knob: null };
    else if (state.tab === 'patch' && target() === 'bcr32') {
      const pg = state.bcrModel.pages[page];
      const count = new Map();
      for (const c of [...pg.cells, ...pg.pushes]) {
        const id = c && objectOfKey(c.key);
        if (id) count.set(id, (count.get(id) ?? 0) + 1);
      }
      const best = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (best && !count.has(objectOfSelection())) state.selected = selectionOf(best) ?? state.selected;
    }
  }
  render();
  showOnBcr32();
}

// A knob turned or pushed on the BCR32 (not a key: those aren't Night Shift's): its setting shows.
function onBcr32Touch({ kind, index, page }) {
  const pg = state.bcrModel?.pages[page];
  if (!pg || kind > 1) return;
  const c = kind === 1 ? pg.pushes[index] ?? pg.cells[index] : pg.cells[index] ?? pg.pushes[index];
  if (!c || foreignAt(page, index)) return;
  if (state.tab === 'bcr32') {
    state.bcr32.sel = { page, knob: index };
    return render();
  }
  const row = document.querySelector(`[data-ec4="${c.key}"]`);
  if (row) {
    row.scrollIntoView({ block: 'nearest' });
    row.classList.remove('touched');
    void row.offsetWidth;
    row.classList.add('touched');
  }
}

// What the page in view should show: Night Shift's knobs' values as texts and as the CCs that put
// them there, and its knobs in the BCR32's RAM until stored (EDIT). Never another app's knob.
let bcrImageRead = null; // a read of its image in flight
// The BCR32's image read again (other apps' knobs, the pages' outputs and names), when Night Shift
// isn't busy: after a link-up it was too busy for, and whenever its tab opens, so what Eye of
// Providence changed since shows (hardware check B14, 2026-11-09).
function readBcr32Again() {
  const link = state.bcr32.link;
  if (!link || state.busy || state.bcr32.linking || bcrImageRead) return;
  bcrImageRead = readImage(link.device).then((i) => {
    sawBcr32(i);
    render();
    showOnBcr32();
  }).catch(() => {}).finally(() => { bcrImageRead = null; });
}
function showOnBcr32() {
  const link = state.bcr32.link;
  const img = state.bcr32.image;
  if (link && !img) return readBcr32Again();
  if (!link || link.page == null || !img || !state.preset || !state.bcrModel) return;
  const p = link.page;
  const page = state.bcrModel.pages[p];
  const want = wanted({ ...state.bcrModel, pages: [page] }, state.view, bcrSync());
  const edits = editsFor(img, want, state.bcr32.held, p);
  const range = (o) => state.view.outputs[o]?.rangeIndex ?? 0;
  link.show(Array.from({ length: BCR_KNOBS }, (_, i) => {
    if (!want.knobs.has(`${p}:${i}`) || !edits.has(i)) return null;
    const c = page.cells[i];
    if (!c?.map) return { text: null };
    const v = valueOf(state.preset.values, c.key);
    return { text: valueText(c.key, v, { range }), cc: c.map.relative ? null
      : { channel: c.map.channel, number: c.map.cc, value: ccFor(c.key, v, c.map.bits, { tempoMin: state.config.values.tempoMin }), bits: c.map.bits } };
  })).catch(() => {});
  link.edit(edits, (i) => readRecord(img, p, i)).catch(() => {});
}

// The MIDI addresses of Night Shift's knobs and pushes on the BCR32: what the thru passes on.
function bcrAddresses() {
  const out = new Set();
  for (const pg of state.bcrModel?.pages ?? []) {
    for (const c of [...pg.cells, ...pg.pushes]) {
      if (!c?.map) continue;
      out.add(`${c.map.channel}:${c.map.cc}`);
      if (c.map.bits === 14) out.add(`${c.map.channel}:${c.map.cc + 32}`);
    }
  }
  return out;
}

// The BCR32's MIDI (its knobs, keys and sequencer tracks share the port): Night Shift's knobs go on to
// the FH-2 (thru), their value shows right away, and the FH-2 is read back once they rest.
function onBcr32Midi(bytes) {
  const model = state.bcrModel;
  if (!model) return;
  if (state.bcr32.thru && (bytes[0] & 0xf0) === 0xb0 && bcrAddresses().has(`${bytes[0] & 15}:${bytes[1]}`)) {
    if (fh2Out?.state === 'connected') fh2Out.send(bytes);
    else fh2Output().then((o) => { fh2Out = o; o?.send(bytes); }).catch(() => {});
  }
  const link = state.bcr32.link;
  const page = link?.page != null && model.pages[link.page];
  if (!page) return;
  const hires = (ch, cc) => page.cells.some((c) => c?.map?.channel === ch && c.map.cc === cc && c.map.bits === 14);
  const range = (o) => state.view.outputs[o]?.rangeIndex ?? 0;
  for (const m of bcrCc14.take(bytes, hires)) {
    page.cells.forEach((c, i) => {
      if (!c?.map || c.map.channel !== m.channel || c.map.cc !== m.cc || foreignAt(link.page, i)) return;
      if (!c.map.relative) link.showOne(i, valueText(c.key, fromCc(c.key, m.value, m.bits, { tempoMin: state.config.values.tempoMin }), { range })).catch(() => {});
      link.sent.set(i, `${m.channel}:${m.cc}:${m.value}`);
      turned.add(c.key);
      turnedOn = 'BCR32';
    });
  }
  if (turned.size) {
    clearTimeout(readBackTimer);
    readBackTimer = setTimeout(readBack, 500);
  }
}

function toggleBcr32Thru() {
  state.bcr32.thru = !state.bcr32.thru;
  try {
    localStorage.setItem(BCR_THRU_KEY, state.bcr32.thru ? '1' : '0');
  } catch {}
  status(state.bcr32.thru ? 'Thru on: Night Shift’s BCR32 knobs go on to the FH-2' : 'Thru off');
}

// ---- rack setup

async function editHardware() {
  const hw = structuredClone(state.hardware);
  if (!Array.isArray(hw.controllers)) hw.controllers = CONTROLLERS.map(([id]) => id);
  const box = (list, a) => h('input', { type: 'checkbox', checked: list.includes(a), onchange: (e) => {
    const i = list.indexOf(a);
    if (e.target.checked && i < 0) list.push(a);
    if (!e.target.checked && i >= 0) list.splice(i, 1);
  } });
  const body = h('div', { class: 'hw-list' },
    h('b', {}, 'FHX-8CV expanders, by jumper address'),
    h('div', { class: 'hw-row' }, [1, 2, 3, 4, 5, 6, 7].map((a) => h('label', {}, box(hw.cv, a), `${a}/1–8`))),
    h('b', {}, 'Gate modules, by the outputs they give'),
    h('div', { class: 'hw-row' }, [0, 1, 2, 3, 4, 5, 6, 7].map((b) => h('label', {}, box(hw.gt, b), `${blockName(b)} (${b & 1 ? 'ESX-8GT' : 'FHX-8GT'})`))),
    h('b', {}, 'Controllers'),
    h('div', { class: 'hw-row' }, CONTROLLERS.map(([id, name]) => h('label', {}, box(hw.controllers, id), name))));
  const ok = await modal($('dialog'), {
    title: 'Your rack',
    body: [h('p', { class: 'note' }, 'In rack order: CV1, CV2… and GT1, GT2…'), body],
    buttons: [{ label: 'Cancel', value: false }, { label: 'Use this', value: true, primary: true }],
  });
  if (!ok) return;
  hw.cv.sort((a, b) => a - b);
  hw.gt.sort((a, b) => a - b);
  hw.controllers = CONTROLLERS.map(([id]) => id).filter((id) => hw.controllers.includes(id));
  state.hardware = hw;
  saveHardware(hw);
  // a controller switched off is let go; one switched on is looked for
  if (hasController(hw, 'ec4')) linkEc4();
  else unlinkEc4();
  if (hasController(hw, 'bcr32')) linkBcr32();
  else unlinkBcr32();
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
  followOnBcr32();
  // below the stage (a narrow window), the inspector would open out of sight
  const panel = state.selected && document.querySelector('aside.inspector');
  if (panel && panel.getBoundingClientRect().top > innerHeight * 0.7) panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
  // a free jack shows its own level, LFO and smoothing; "Add a source…" there adds a driver
}

// A tab; a controller's tab makes it the one the Patch tab's names act on.
function openTab(id) {
  state.tab = id;
  if (id === 'bcr32') readBcr32Again();
  if (id === 'ec4' || id === 'bcr32') {
    state.controller = id;
    try {
      localStorage.setItem(CONTROLLER_KEY, id);
    } catch {}
  }
  render();
}

const MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');
const KEYS = MAC ? { undo: '⌘Z', redo: '⇧⌘Z' } : { undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z' };

function bar() {
  const v = state.view;
  const tab = (id, label) => h('button', { type: 'button', 'data-key': `tab:${id}`, 'aria-pressed': state.tab === id ? 'true' : 'false', onclick: () => openTab(id) }, label);
  const k = state.sync?.kind;
  const mark = state.link === 'connecting' ? 'reading the FH-2…'
      : k === 'same' ? 'same as the FH-2'
      : k === 'scene' ? `scene ${sceneName(state.sync.scene)} is on the FH-2`
      : k === 'differs' ? 'differs from the FH-2'
      : state.link === 'ask' ? 'not connected'
      : state.link === 'no-midi' ? 'no MIDI in this browser'
      : state.link === 'blocked' ? 'MIDI access blocked'
      : state.link === 'silent' ? `FH-2 on “${state.port}” didn’t answer`
      : state.link === 'offline' ? 'FH-2 not connected' : 'not on the FH-2';
  // on a narrow window only its dot shows; the words are on hover
  const sync = v && h('span', { class: 'sync' + (state.unsent ? ' unsent' : ''),
    title: `${mark}${state.port && state.link === 'connected' ? ` · FH-2 on port “${state.port}”` : ''}${state.from === 'example' ? ' · the example: not kept in this browser' : ''}` },
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
    v && h('nav', { class: 'tabs', 'aria-label': 'Views' }, tab('patch', 'Patch'), tab('scenes', 'Scenes'), tab('steps', 'Steps'), tab('settings', 'Settings'), tab('midi', 'MIDI map'), hasController(state.hardware, 'ec4') && tab('ec4', 'EC4'), hasController(state.hardware, 'bcr32') && tab('bcr32', 'BCR32'), tab('gig', 'Gig')),
    v && h('div', { class: 'undo' },
      h('button', { type: 'button', class: 'btn', 'data-key': 'undo', disabled: !state.history.canUndo, onclick: undo, title: `Undo (${KEYS.undo})`, 'aria-label': 'Undo' }, '↶'),
      h('button', { type: 'button', class: 'btn', 'data-key': 'redo', disabled: !state.history.canRedo, onclick: redo, title: `Redo (${KEYS.redo})`, 'aria-label': 'Redo' }, '↷')),
    h('div', { class: 'grow' }),
    state.status && h('span', { class: 'status' + (state.warn ? ' warn' : ''), title: state.status }, state.status),
    fileMenu(v),
    h('div', { class: 'fh2-group', role: 'group', 'aria-label': 'FH-2' }, h('span', { class: 'lbl' }, 'FH-2'),
      v && state.link === 'ask' && h('button', { type: 'button', class: 'btn primary', 'data-key': 'connect', onclick: start, title: 'The browser asks to allow MIDI, then Night Shift reads the FH-2' }, 'Connect'),
      h('button', { type: 'button', class: 'btn' + (v ? '' : ' primary'), disabled: state.busy, onclick: get, 'data-key': 'get', title: 'Get: the FH-2’s changes into what you see (yours not sent stay; undoable), and the controllers’ state' }, 'Get'),
      v && h('button', { type: 'button', class: 'btn' + (state.unsent ? ' primary' : ''), disabled: state.busy, onclick: send, 'data-key': 'send', title: 'Send: what you see to the FH-2’s memory, Night Shift’s knobs to the controllers; asks first if something changed there' }, 'Send'),
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
  const name = `${(state.view.globals.name || 'fh2').replace(/[^\w.-]+/g, '_')}.syx`;
  download(all, name);
  status(`Saved ${name}`);
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
    : state.link === 'ask' ? 'Connect the FH-2 over USB C.'
    : state.link === 'no-midi' ? 'No MIDI in this browser (use Chrome or Edge).'
    : state.link === 'blocked' ? 'MIDI access is blocked for this site: allow it in the browser.'
    : state.link === 'silent' ? `The FH-2 on “${state.port}” didn’t answer. Is another app using it?`
    : 'No FH-2 found. Connect it over USB C.';
  return h('section', { class: 'empty' }, h('p', {}, why),
    h('p', { class: 'note' }, 'Unofficial: not made or supported by Expert Sleepers.'),
    h('div', { class: 'actions' },
      state.link === 'ask' && h('button', { type: 'button', class: 'btn primary', onclick: start, title: 'The browser asks to allow MIDI, then Night Shift reads the FH-2' }, 'Connect'),
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
  if ((state.tab === 'ec4' || state.tab === 'bcr32') && !hasController(state.hardware, state.tab)) state.tab = 'patch';
  const sketchPage = v && state.tab === 'patch' && target() === 'ec4' ? pageOfSelection(state.ec4Model) : null;
  let content;
  if (!v) content = empty();
  else if (state.tab === 'midi') content = renderMidiMap(v, state.colors);
  else if (state.tab === 'ec4') content = renderEc4(v, state.ec4Model, state.colors, state.ec4.sel, {
    select: (page, knob) => { state.ec4.sel = { page, knob }; render(); followOnEc4(); },
    pick: pickEc4, takeOff: takeOffEc4, off: offEc4, addPage: wholeEc4, whole: wholeEc4, map: mapEc4, live: liveEc4,
    addLive: addLiveEc4, removeLive: removeLiveEc4, move: moveEc4, toLive: toLiveEc4,
    movePage: (id, d) => edit('Page moved', movePage(state.names, ec4Model(), id, d)),
    speed: speedOf(state.names), setSpeed: (v) => edit(`Knob speed ${v}`, [speedChange(v)]),
    setFeel: (key, mode) => edit(mode ? `Knob feel ${mode}` : 'Knob feel back to its default', [feelChange(key, mode)]),
    hide: (id, on) => edit(on ? 'Page hidden' : 'Page back on the EC4', hidePage(state.names, id, on)),
    share: (a, b) => ec4Edit('Two pages in one group', sharePage(state.names, ec4Model(), a, b)),
    split: (a) => edit('Page split again', splitPage(state.names, ec4Model(), a)),
    rename: renameEc4Page, stray: strayMappings(v, state.ec4Model, state.names), tidy: tidyEc4, busy: state.busy, note: state.ec4.note,
    link: state.ec4.link && { ours: state.ec4.link.ours, setup: state.ec4.link.setup, group: state.ec4.link.group, edits: state.ec4.link.edits }, thru: state.ec4.thru, toggleThru,
    unstored: !!state.ec4.link?.edits && !!state.ec4Model?.pages.length && ec4Unstored(),
    relative: toAbsolute(state.config.values, state.ec4Model, state.names), makeAbsolute: (r) => edit(`Made ${r.keys.length} knob${r.keys.length === 1 ? '' : 's'} absolute`, r.changes),
    softTakeover: !!state.config.values.softTakeover, turnOffSoftTakeover: () => edit('Soft takeover off', [{ dump: 'config', path: ['softTakeover'], value: 0 }], { force: true }) });
  else if (state.tab === 'bcr32') content = renderBcr32(v, state.bcrModel, state.colors, state.bcr32.sel, {
    select: (page, knob) => { state.bcr32.sel = { page, knob }; render(); state.bcr32.link?.select(page).catch(() => {}); },
    pick: pickBcr32, takeOff: takeOffBcr32, move: moveBcr32, toPage: toPageBcr32, putHalf: putHalfBcr32, halves: halfChoices(state.ec4Model),
    clear: (p) => edit(`Night Shift’s knobs off page ${p + 1}`, bcrClear(state.names, ec4Model(), p)), rename: renameBcr32Page, map: mapBcr32,
    busy: state.busy, note: state.bcr32.note, link: state.bcr32.link && { page: state.bcr32.link.page, controller: state.bcr32.link.controller },
    unstored: !!state.bcr32.link && bcr32Unstored(), thru: state.bcr32.thru, toggleThru: toggleBcr32Thru, held: state.bcr32.held.knobs.size > 0,
    speed: speedOf(state.names), setSpeed: (s) => edit(`Knob speed ${s}`, [speedChange(s)]),
    setFeel: (key, mode) => edit(mode ? `Knob feel ${mode}` : 'Knob feel back to its default', [feelChange(key, mode)]), device: state.bcrDevice });
  else if (state.tab === 'steps') content = renderSteps(v, values(), state.steps, { edit, busy: state.busy,
    select: (sel) => { state.steps = { seq: state.steps.seq, lane: state.steps.lane, ...sel }; render(); },
    banks: { shown: state.banks, read: readBank, open: openBank, save: saveBank, install: installBank } });
  else if (state.tab === 'settings') content = renderSettings(v, state.config.values, state.preset?.values ?? null, sceneName(state.scene),
    { edit, fh2: state.fh2Settings, readFh2: readModuleSettings, cal: state.fh2Calibrations, readCal: readModuleCalibrations, busy: state.busy, ec4: labels(), removeMapping: removeMappingOf,
      names: state.names, scala: { install: installScala, resend: resendScala, forget: forgetScala } });
  else if (state.tab === 'gig') content = renderGig(gigList(), { readFh2: readModuleSettings, saveAll, send,
    scenes: () => { state.tab = 'scenes'; render(); }, checks: () => open('checks.html', '_blank'), busy: state.busy });
  else if (state.tab === 'scenes') content = renderScenes(scenesModel(v), { setScene, setSlot, saveAll, toggleScenesOnly,
    setProgramChannel: (ch) => edit(ch ? `Scenes switch by program change on ch ${ch}` : 'No scene switching by program change', [{ dump: 'config', path: ['presetProgramChannel'], value: ch }], { force: true }) });
  else {
    content = [
      h('section', { class: 'stage-wrap', 'aria-label': 'Sources and rack' }, renderStage(v, state.colors, state.selected, select),
        sketchPage && ec4Sketch(sketchPage, state.colors, state.ec4.link?.ours && state.ec4.link.group === sketchPage.group)),
      h('aside', { class: 'inspector', 'aria-label': 'Inspector' }, renderInspector(v, state.colors, state.selected, select, { edit, add: addTo, remove, removeLfo: removeLfoOf, removeMapping: removeMappingOf, values, rename, status, ec4: labels(), fh2: state.fh2Settings, calibrations: state.fh2Calibrations, loadCalibration: loadCalibrationNow, setPowerOnCalibration, calibrate: calibrateJack,
        loadDirect: !!state.fh2Settings && (settingsByName(state.fh2Settings.pages)['Always load direct'] ?? '').trim().startsWith('1') })),
    ];
  }
  document.body.classList.toggle('scenes-only', !!(v && state.scenesOnly));
  replace($('#app'), bar(), h('main', {}, content));
  // the status for screen readers: one region outside the redrawn app, told only what's new
  const said = document.getElementById('announce');
  if (said && state.status && said.textContent !== state.status) said.textContent = state.status;
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
  load({ config: kept.config, presets: kept.scenes, scene: kept.scene, names: kept.names, hardware: kept.hardware, slots: kept.slots, scenesOnly: kept.scenesOnly, held: kept.held, base: kept.base, whole: true }, 'browser');
  state.status = 'Last patch restored';
}
render();
// the browser would ask for MIDI access before you did anything: then a button asks first
function start() {
  state.link = 'unknown';
  return connect().then(watch).then(() => {
    linkEc4();
    watchEc4((portState) => (portState === 'connected' ? setTimeout(linkEc4, 600) : unlinkEc4())).catch(() => {});
    linkBcr32();
    watchBcr32((portState) => (portState === 'connected' ? setTimeout(linkBcr32, 600) : unlinkBcr32())).catch(() => {});
  });
}
midiPermission().then((p) => {
  if (p === 'prompt') {
    state.link = 'ask';
    render();
  } else start();
});
// another Night Shift tab keeps its patch in the same place: the last one changed wins
addEventListener('storage', (e) => {
  if (e.key === PATCH_KEY && e.newValue) status('Night Shift is open in another tab too: the patch changed last is kept', true);
});
