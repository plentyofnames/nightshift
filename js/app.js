// Night Shift, read-only patch view (milestone M1): open a config and preset from .syx
// files, pull them from an FH-2, or try the example; see the rack and what comes out of
// every jack.

import { h, $, replace, download, modal } from '../vendor/lilypad/js/dom.js';
import { parseDump, buildDump, splitSysex, commandOf, DUMPS } from './fh2/sysex.js';
import { derive } from './patch/derive.js';
import { examplePatch } from './patch/example.js';
import { DEFAULT_HARDWARE, validHardware, blockName } from './patch/hardware.js';
import { colorsFor } from './ui/look.js';
import { renderStage } from './ui/rack.js';
import { renderInspector } from './ui/inspector.js';
import { renderMidiMap } from './ui/midimap.js';
import { fh2Ports, pullFromFh2 } from './ui/connect.js';

const HW_KEY = 'nightshift.hardware';
const state = {
  config: null, // parsed dumps (sysex.js parseDump)
  preset: null,
  from: '',
  hardware: loadHardware(),
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

function update() {
  state.view = state.config ? derive(state.config.values, state.preset?.values ?? null, state.hardware) : null;
  state.colors = state.view ? colorsFor(state.view.sources) : new Map();
  render();
}

function load({ config, preset }, from) {
  if (config) state.config = config;
  if (preset) state.preset = preset;
  state.from = from;
  state.selected = null;
  update();
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
  load(found, [...files].map((f) => f.name).join(', '));
  status(['Opened ' + Object.keys(found).join(' and '), ...notes].join(' · '), notes.length > 0);
}

function pickFiles() {
  const input = h('input', { type: 'file', accept: '.syx,application/octet-stream', multiple: true });
  input.onchange = () => openFiles(input.files);
  input.click();
}

// ---- pulling from the FH-2

async function pull() {
  try {
    status('Looking for the FH-2…');
    const pairs = await fh2Ports();
    if (!pairs.length) return status('No MIDI ports found. Is the FH-2 connected over USB C?', true);
    let pair = pairs[0];
    if (!/fh-?2/i.test(pair.name)) {
      const pick = await modal($('dialog'), {
        title: 'Which port is the FH-2?',
        body: h('p', { class: 'note' }, 'No port is called “FH-2”. Pick the one it is connected to (it may have been renamed in its settings).'),
        buttons: [...pairs.map((p, i) => ({ label: p.name, value: i })), { label: 'Cancel', value: null }],
      });
      if (pick == null) return status('');
      pair = pairs[pick];
    }
    status(`Asking ${pair.name} for its config and preset…`);
    const r = await pullFromFh2(pair);
    load(r, `${pair.name}, ${r.version}`);
    status(`Pulled from ${pair.name} (${r.version})` + (r.config.versionOk ? '' : ' · unexpected config version'), !r.config.versionOk);
  } catch (e) {
    status(`Couldn’t pull from the FH-2: ${e.message}`, true);
  }
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
}

function bar() {
  const v = state.view;
  const tab = (id, label) => h('button', { type: 'button', 'aria-pressed': state.tab === id ? 'true' : 'false', onclick: () => { state.tab = id; render(); } }, label);
  return h('header', { class: 'bar' },
    h('div', { class: 'brand' }, jackIcon(), 'Night Shift'),
    v && h('div', { class: 'patch-name' }, 'Config ', h('b', {}, v.globals.name || 'untitled'), v.globals.presetName ? [' · preset ', h('b', {}, v.globals.presetName)] : ''),
    v && h('nav', { class: 'tabs', 'aria-label': 'Views' }, tab('patch', 'Patch'), tab('midi', 'MIDI map')),
    h('div', { class: 'grow' }),
    state.status && h('span', { class: 'status' + (state.warn ? ' warn' : ''), role: 'status' }, state.status),
    h('button', { type: 'button', class: 'btn', onclick: editHardware }, 'Rack…'),
    h('button', { type: 'button', class: 'btn', onclick: pickFiles }, 'Open .syx…'),
    v && h('button', { type: 'button', class: 'btn', onclick: saveSyx }, 'Save .syx'),
    h('button', { type: 'button', class: 'btn primary', onclick: pull }, 'Pull from FH-2'));
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
    h('p', { class: 'note' }, 'An output-first editor for the Expert Sleepers FH-2. This first version shows what your config and preset do, jack by jack. It doesn’t change anything on the module yet.'),
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
      h('aside', { class: 'inspector', 'aria-label': 'Inspector' }, renderInspector(v, state.colors, state.selected, select)),
    ];
  }
  replace($('#app'), bar(), h('main', {}, content));
}

// ---- drop files anywhere

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
  if (e.key === 'Escape' && state.selected && !document.querySelector('dialog[open]')) select(null);
});

if (new URLSearchParams(location.search).has('example')) load(examplePatch(), 'example');
render();
