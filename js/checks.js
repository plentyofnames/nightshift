// The hardware checks page (checks.html): runs the checks in fh2/checks.js on the FH-2 one at a
// time, shows what each does as it goes, and keeps the results in the browser, to copy into
// docs/build-plan.md. While a check runs it marks itself busy in the browser's storage, so a
// Night Shift tab open beside it doesn't send its live edits into the test (app.js liveReady).

import { h, $, replace } from '../vendor/lilypad/js/dom.js';
import { midiTransport } from '../vendor/lilypad/js/midi.js';
import { Fh2 } from './fh2/client.js';
import { fh2Ports, looksLikeFh2 } from './ui/connect.js';
import { check17, check18, check19, check23, CHECKS_BUSY_KEY as BUSY_KEY } from './fh2/checks.js';
import { DEFAULT_HARDWARE, validHardware } from './patch/hardware.js';
import { projectFromJson } from './patch/project.js';

const RESULTS_KEY = 'nightshift.checks';

const CHECKS = [
  { id: 17, title: 'Program changes and preset slots', question: 'Does program change N load preset slot N or N + 1? Is every scene in its slot?',
    before: ['Save all from the Scenes tab first, so your scenes are in their slots.', 'The FH-2 loads presets during the check: outputs change.'],
    run: (rig) => check17(rig, keptScenes()) },
  { id: 19, title: 'CC scaling on small ranges', question: 'How does a CC 0–127 land on Euclid pulses, steps, rotation, reset, arp range, latch and swing type?',
    before: ['Uses Euclid 16 and Voice 16 (usually unused) and the swing type: stop the music.'],
    run: check19 },
  { id: 18, title: 'Tempo CC', question: 'What tempo does each value of a CC mapped to tempo mean?',
    before: ['The tempo changes during the check: stop the music.'],
    run: check18 },
  { id: 23, title: 'Soft takeover with 14-bit', question: 'With Soft takeover on, does a 14-bit knob that disagrees with the FH-2 jump, or wait and pick up?',
    before: ['Uses an output outside your rack, so nothing changes on your jacks.'],
    run: check23 },
  { id: 3, title: '“Send CCs on preset ld” to USB A', question: 'When a preset loads, do the FH-2’s mapped values reach a controller on its USB A?',
    before: ['Plug the EC4 (controlfrog debug build) into the FH-2’s USB A, with “Send CCs on preset ld” on.', 'Load a preset on the FH-2 and watch the EC4’s counters (Func).'],
    manual: ['Values arrived', 'Nothing arrived'] },
];

const state = { running: null, log: [], results: load(RESULTS_KEY) ?? {}, port: '', error: '' };

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function save() {
  try {
    localStorage.setItem(RESULTS_KEY, JSON.stringify(state.results));
  } catch {}
}

const hardware = () => validHardware(load('nightshift.hardware')) ?? DEFAULT_HARDWARE;

// The scenes of the patch kept in Night Shift, with their flash slots, for check 17.
function keptScenes() {
  try {
    const p = projectFromJson(localStorage.getItem('nightshift.patch'));
    return p.scenes.map((d, i) => ({ name: d.values.name, slot: p.slots?.scenes?.[i] ?? null, values: d.values }));
  } catch {
    return [];
  }
}

function log(text) {
  state.log.push(text);
  render();
}

async function runCheck(c) {
  if (state.running) return;
  state.running = c.id;
  state.log = [];
  state.error = '';
  const busy = setInterval(() => markBusy(true), 1000);
  markBusy(true);
  render();
  let client = null;
  try {
    const pair = (await fh2Ports()).find(looksLikeFh2);
    if (!pair) throw new Error('no FH-2 port: is it connected over USB C?');
    state.port = pair.name;
    const transport = midiTransport(pair.in, pair.out);
    client = new Fh2(transport);
    const rig = { client, send: (bytes) => transport.send(Uint8Array.from(bytes)), log, wait: (ms) => new Promise((r) => setTimeout(r, ms)), hardware: hardware() };
    const r = await c.run(rig);
    state.results[c.id] = { at: new Date().toISOString(), ...r };
    save();
  } catch (e) {
    state.error = e.message;
    log(`Stopped: ${e.message}`);
  } finally {
    client?.close();
    clearInterval(busy);
    markBusy(false);
    state.running = null;
    render();
  }
}

function markBusy(on) {
  try {
    if (on) localStorage.setItem(BUSY_KEY, String(Date.now()));
    else localStorage.removeItem(BUSY_KEY);
  } catch {}
}

function answer(c, text) {
  state.results[c.id] = { at: new Date().toISOString(), summary: text, lines: [] };
  save();
  render();
}

// The results as Markdown, for the build plan's hardware table.
function resultsText() {
  const day = new Date().toISOString().slice(0, 10);
  return CHECKS.filter((c) => state.results[c.id]).map((c) => {
    const r = state.results[c.id];
    return [`- Check ${c.id} (${c.title}, ${r.at.slice(0, 10)}): ${r.summary}`, ...r.lines.map((l) => `  - ${l}`)].join('\n');
  }).join('\n') || `No results yet (${day}).`;
}

async function copy() {
  try {
    await navigator.clipboard.writeText(resultsText());
    state.error = 'Copied';
  } catch {
    state.error = 'Copying was refused: select the results below instead';
  }
  render();
}

function card(c) {
  const r = state.results[c.id];
  const running = state.running === c.id;
  return h('section', { class: 'check-card' + (running ? ' running' : '') },
    h('h2', {}, h('span', { class: 'n' }, String(c.id)), c.title),
    h('p', {}, c.question),
    h('ul', { class: 'note' }, c.before.map((b) => h('li', {}, b))),
    h('div', { class: 'actions' }, c.manual
      ? c.manual.map((a) => h('button', { type: 'button', class: 'btn', onclick: () => answer(c, a) }, a))
      : h('button', { type: 'button', class: 'btn primary', disabled: !!state.running, onclick: () => runCheck(c) }, running ? 'Running…' : r ? 'Run again' : 'Run')),
    r && h('div', { class: 'result' }, h('b', {}, r.summary), r.lines.length ? h('ul', {}, r.lines.map((l) => h('li', {}, l))) : null,
      h('span', { class: 'note' }, new Date(r.at).toLocaleString())),
    running && h('pre', { class: 'log' }, state.log.join('\n')));
}

function render() {
  replace($('#app'),
    h('header', { class: 'bar' },
      h('div', { class: 'brand' }, 'Night Shift · hardware checks'),
      h('span', { class: 'note' }, state.port ? `FH-2 on “${state.port}”` : 'Each check puts your config and preset back; nothing goes to flash'),
      h('div', { class: 'grow' }),
      state.error && h('span', { class: 'status' }, state.error),
      h('button', { type: 'button', class: 'btn', onclick: copy }, 'Copy results'),
      h('a', { class: 'btn', href: 'index.html' }, 'Night Shift')),
    h('main', { class: 'checks' }, CHECKS.map(card),
      h('section', { class: 'check-card' }, h('h2', {}, 'Results'), h('pre', { class: 'log' }, resultsText()))));
}

render();
