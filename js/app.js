// Night Shift: open a config and preset from .syx files, pull them from an FH-2, or try the
// example; see the rack and what comes out of every jack; edit, undo, and send the result
// back to the module.

import { h, $, replace, download, modal } from '../vendor/lilypad/js/dom.js';
import { parseDump, buildDump, splitSysex, commandOf, DUMPS } from './fh2/sysex.js';
import { diff } from './fh2/layout.js';
import { derive } from './patch/derive.js';
import { History, removePort, removeSource } from './patch/edit.js';
import { examplePatch } from './patch/example.js';
import { DEFAULT_HARDWARE, validHardware, blockName } from './patch/hardware.js';
import { colorsFor } from './ui/look.js';
import { renderStage } from './ui/rack.js';
import { renderInspector } from './ui/inspector.js';
import { renderMidiMap } from './ui/midimap.js';
import { addToJack } from './ui/add.js';
import { fh2Ports, looksLikeFh2, pullFromFh2, sendToFh2, saveToFlash } from './ui/connect.js';

const HW_KEY = 'nightshift.hardware';
const state = {
  config: null, // parsed dumps (sysex.js parseDump); their values are what gets edited
  preset: null,
  from: '',
  hardware: loadHardware(),
  history: new History(),
  sent: null, // the values the FH-2 holds, as far as we know: { config, preset }, or null
  unsent: false, // what you see differs from what the FH-2 holds (or we don't know what it holds)
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

const patch = () => ({ config: state.config, preset: state.preset });
const values = () => ({ config: state.config.values, preset: state.preset?.values ?? null });
const snapshot = () => structuredClone({ config: state.config?.values ?? null, preset: state.preset?.values ?? null });

function unsent() {
  if (!state.sent) return true;
  return ['config', 'preset'].some((k) => {
    const d = state[k];
    if (!d) return false;
    return !state.sent[k] || diff(DUMPS[d.cmd].layout, d.values, state.sent[k]).length > 0;
  });
}

function update() {
  state.view = state.config ? derive(state.config.values, state.preset?.values ?? null, state.hardware) : null;
  state.colors = state.view ? colorsFor(state.view.sources, state.colors) : new Map();
  state.unsent = state.config ? unsent() : false;
  render();
}

// `sent`: whether these are what the FH-2 holds right now (true after a pull).
function load({ config, preset }, from, sent = false) {
  if (config) state.config = config;
  if (preset) state.preset = preset;
  state.from = from;
  state.selected = null;
  state.colors = new Map(); // a new patch gets fresh colours
  state.history = new History();
  state.sent = sent ? snapshot() : null;
  update();
}

// ---- editing

function edit(label, changes) {
  try {
    if (state.history.do(patch(), label, changes)) {
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
    const r = await addToJack(values(), state.hardware, state.view.outputs[output]);
    if (r) edit(r.label, r.changes);
  } catch (e) {
    status(`Couldn’t add that: ${e.message}`, true);
  }
}

// Takes `source` off one jack (`port`), or off all of its jacks.
function remove(source, port) {
  try {
    const where = port ? ` from jack ${port.jack}` : '';
    edit(`Removed ${source.name}${port && source.ports.length > 1 ? ` ${port.name}` : ''}${where}`,
      port ? removePort(values(), source, port) : removeSource(values(), source));
    if (!port) state.selected = null;
    render();
  } catch (e) {
    status(`Couldn’t remove that: ${e.message}`, true);
  }
}

const isFree = (o) => o.present && !o.ports.some((p) => !p.standby);

function undo() {
  const label = state.history.undo(patch());
  if (label) {
    state.status = `Undid: ${label}`;
    state.warn = false;
    update();
  }
}

function redo() {
  const label = state.history.redo(patch());
  if (label) {
    state.status = `Redid: ${label}`;
    state.warn = false;
    update();
  }
}

// ---- opening .syx files

async function openFiles(files) {
  const found = {};
  const notes = [];
  for (const f of files) {
    const msgs = splitSysex(new Uint8Array(await f.arrayBuffer()));
    let used = 0;
    for (const m of msgs) {
      if (!DUMPS[commandOf(m)]) continue;
      try {
        const d = parseDump(m);
        if (!d.versionOk) notes.push(`${f.name}: ${d.kind} version ${d.values.version}, expected ${DUMPS[d.cmd].version}`);
        found[d.kind] = d;
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
  status(['Opened ' + Object.keys(found).join(' and '), ...notes].join(' · '), notes.length > 0);
}

function pickFiles() {
  const input = h('input', { type: 'file', accept: '.syx,application/octet-stream', multiple: true });
  input.onchange = () => openFiles(input.files);
  input.click();
}

// Asks before throwing away edits that haven't been sent or saved.
async function dropUnsent(what) {
  if (!state.history.canUndo || !state.unsent) return true;
  return modal($('dialog'), {
    title: 'Drop your changes?',
    body: h('p', { class: 'note' }, `${what} replaces what you see, and your changes haven’t been sent to the FH-2. Save .syx first to keep them.`),
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
    const refused = e.name === 'SecurityError' || e.name === 'NotAllowedError' || /permission/i.test(e.message);
    status(refused ? 'This browser didn’t allow MIDI access. Allow it for this page (the icon in the address bar), or use Chrome or Edge.'
      : `The FH-2 didn’t answer: ${e.message}`, true);
  } finally {
    state.busy = false;
    render();
  }
}

function pull() {
  return withFh2(async (pair) => {
    if (!(await dropUnsent('Pulling'))) return status('');
    status(`Asking ${pair.name} for its config and preset…`);
    const r = await pullFromFh2(pair);
    load(r, `${pair.name}, ${r.version}`, true);
    status(`Pulled from ${pair.name} (${r.version})` + (r.config.versionOk ? '' : ' · unexpected config version'), !r.config.versionOk);
  });
}

function send() {
  return withFh2(async (pair) => {
    status(`Sending to ${pair.name}…`);
    const r = await sendToFh2(pair, patch());
    const off = Object.entries(r).filter(([, d]) => d.length);
    if (off.length) {
      const list = off.map(([k, d]) => `${k}: ${d.slice(0, 3).map((x) => x.path.join('.')).join(', ')}${d.length > 3 ? ` and ${d.length - 3} more` : ''}`);
      state.sent = null;
      update();
      return status(`Sent, but the FH-2 holds something else for ${list.join('; ')}`, true);
    }
    state.sent = snapshot();
    update();
    status(`Sent to ${pair.name} and read back: the FH-2 now holds this patch (in RAM, not yet in flash)`);
  });
}

async function saveFlash() {
  const ok = await modal($('dialog'), {
    title: 'Save to the FH-2’s flash?',
    body: h('p', { class: 'note' }, 'This stores the config and preset the FH-2 holds now, so they survive switching off. They go into the slots they were last loaded from or saved to, replacing what is there.'),
    buttons: [{ label: 'Cancel', value: false }, { label: 'Save to flash', value: true, primary: true }],
  });
  if (!ok) return;
  await withFh2(async (pair) => {
    await saveToFlash(pair);
    status(`Saved to ${pair.name}’s flash`);
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
  const same = sel && state.selected && sel.source === state.selected.source && sel.output === state.selected.output;
  state.selected = same ? null : sel;
  render();
  // clicking a free jack asks what should come out of it
  if (!same && sel?.output != null && sel.sources && isFree(state.view.outputs[sel.output])) addTo(sel.output);
}

function bar() {
  const v = state.view;
  const tab = (id, label) => h('button', { type: 'button', 'aria-pressed': state.tab === id ? 'true' : 'false', onclick: () => { state.tab = id; render(); } }, label);
  const sync = v && h('span', { class: 'sync' + (state.unsent ? ' unsent' : '') },
    state.unsent ? (state.sent ? 'changed since sent' : 'not on the FH-2') : 'same as the FH-2');
  return h('header', { class: 'bar' },
    h('div', { class: 'brand' }, jackIcon(), 'Night Shift'),
    v && h('div', { class: 'patch-name' }, 'Config ', h('b', {}, v.globals.name || 'untitled'), v.globals.presetName ? [' · preset ', h('b', {}, v.globals.presetName)] : ''),
    sync,
    v && h('nav', { class: 'tabs', 'aria-label': 'Views' }, tab('patch', 'Patch'), tab('midi', 'MIDI map')),
    v && h('div', { class: 'undo' },
      h('button', { type: 'button', class: 'btn', disabled: !state.history.canUndo, onclick: undo, title: 'Undo (⌘Z)' }, 'Undo'),
      h('button', { type: 'button', class: 'btn', disabled: !state.history.canRedo, onclick: redo, title: 'Redo (⇧⌘Z)' }, 'Redo')),
    h('div', { class: 'grow' }),
    state.status && h('span', { class: 'status' + (state.warn ? ' warn' : ''), role: 'status' }, state.status),
    h('button', { type: 'button', class: 'btn', onclick: editHardware }, 'Rack…'),
    h('button', { type: 'button', class: 'btn', onclick: pickFiles }, 'Open .syx…'),
    v && h('button', { type: 'button', class: 'btn', onclick: saveSyx }, 'Save .syx'),
    h('button', { type: 'button', class: 'btn' + (v ? '' : ' primary'), disabled: state.busy, onclick: pull }, 'Pull from FH-2'),
    v && h('button', { type: 'button', class: 'btn' + (state.unsent ? ' primary' : ''), disabled: state.busy, onclick: send }, 'Send to FH-2'),
    v && h('button', { type: 'button', class: 'btn', disabled: state.busy || state.unsent, onclick: saveFlash,
      title: state.unsent ? 'Send to the FH-2 first: saving stores what the module holds' : 'Store what the FH-2 holds in its flash' }, 'Save to flash'));
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

function welcome() {
  const choice = (title, text, onclick) => h('button', { type: 'button', class: 'choice', onclick }, h('b', {}, title), h('span', {}, text));
  return h('section', { class: 'welcome' },
    h('h1', {}, 'Night Shift'),
    h('p', { class: 'note' }, 'An output-first editor for the Expert Sleepers FH-2. Pull your config and preset, see what comes out of every jack, change it and send it back.'),
    h('div', { class: 'choices' },
      choice('Pull from FH-2', 'Connect it over USB C. Needs Chrome or Edge. Only reads.', pull),
      choice('Open .syx', 'A config dump, with or without its preset, from the FH-2 or Expert Sleepers’ tools. Or drop it here.', pickFiles),
      choice('Try the example', 'A made-up patch for an FH-2 with two CV and two gate expanders.', () => {
        load(examplePatch(), 'example');
        status('Example patch');
      })),
    h('p', { class: 'note' }, 'Unofficial: not made or supported by Expert Sleepers.'));
}

function render() {
  const v = state.view;
  let content;
  if (!v) content = welcome();
  else if (state.tab === 'midi') content = renderMidiMap(v, state.colors);
  else {
    content = [
      h('section', { class: 'stage-wrap', 'aria-label': 'Sources and rack' }, renderStage(v, state.colors, state.selected, select)),
      h('aside', { class: 'inspector', 'aria-label': 'Inspector' }, renderInspector(v, state.colors, state.selected, select, { edit, add: addTo, remove, values })),
    ];
  }
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
window.addEventListener('beforeunload', (e) => {
  if (state.history.canUndo && state.unsent) e.preventDefault();
});

if (new URLSearchParams(location.search).has('example')) load(examplePatch(), 'example');
render();
