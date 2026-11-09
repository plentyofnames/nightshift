// The hardware checks page (checks.html): runs the checks in fh2/checks.js on the FH-2 (and those
// in bcr32/checks.js on the BCR32) one at a time, shows what each does as it goes, and keeps the
// results in the browser, to copy into docs/build-plan.md. While an FH-2 check runs it marks
// itself busy in the browser's storage, so a Night Shift tab open beside it doesn't read the test's
// values back as its knobs' (app.js readBack).

import { h, $, replace } from '../vendor/lilypad/js/dom.js';
import { midiTransport, midiAccess } from '../vendor/lilypad/js/midi.js';
import { bcrIdentify, bcr14bit, bcrRelative, bcrRings, bcr14Rings, bcrPreset } from './bcr32/checks.js';
import { rcStored, rcTracks } from './rotary/checks.js';
import { Fh2 } from './fh2/client.js';
import { fh2Ports, looksLikeFh2 } from './ui/connect.js';
import { check17, check18, check19, check23, sceneReload, checkSteps, checkBanks, checkNoteBank, checkDrumBank, checkPlay, checkOrders, checkTuning, checkTuningSlots, CHECKS_BUSY_KEY as BUSY_KEY } from './fh2/checks.js';
import { DEFAULT_HARDWARE, validHardware } from './patch/hardware.js';
import { projectFromJson } from './patch/project.js';

const RESULTS_KEY = 'nightshift.checks';

const CHECKS = [
  { id: 17, title: 'Program changes and preset slots', question: 'Does program change N load preset slot N or N + 1? Is every scene in its slot?',
    before: ['Save all from the Scenes tab first, so your scenes are in their slots.', 'The FH-2 loads presets during the check: outputs change.'],
    run: (rig) => check17(rig, keptScenes()) },
  { id: 19, title: 'CC scaling on small ranges', question: 'How does a CC 0–127 land on Euclid pulses, steps, rotation, reset, arp range, latch, swing type and a shift register’s direction, length, scale and key? And what does the FH-2 call those?',
    before: ['Uses Euclid 16, Voice 16 and Random 16 (usually unused) and the swing type: stop the music.', 'Leave the FH-2 on its overview: it then shows the shift register a CC changes.'],
    run: check19 },
  { id: 18, title: 'Tempo CC', question: 'What tempo does each value of a CC mapped to tempo mean?',
    before: ['The tempo changes during the check: stop the music.'],
    run: check18 },
  { id: 23, title: 'Soft takeover', question: 'With Soft takeover on, does a knob that disagrees with the FH-2 jump, or wait and pick up? A 14-bit one, and a 7-bit one.',
    before: ['Turns Soft takeover on in its test config only: yours comes back as it was.', 'Uses an output outside your rack, so nothing changes on your jacks.'],
    run: check23 },
  // before a gig: the EC4 on the FH-2's USB A, the Mac on USB C (your call, 2026-11-04)
  { id: 3, gig: true, title: 'Send CCs on preset load', question: 'With “Send CCs on preset ld” on, does a scene change reach the EC4\'s knobs?',
    before: ['FH-2: Send CCs on preset ld on, no MIDI forwarding to USB A.', 'EC4 on the FH-2\'s USB A: turn a knob there first. The check reloads the scene the FH-2 is in.'],
    run: (rig) => sceneReload(rig, keptScenes(), 'The scene is reloaded. Did the knob you turned go back?') },
  { id: 25, gig: true, title: 'The EC4 hears the program change', question: 'With the program change forwarded to USB A, does the EC4 ask the FH-2 again?',
    before: ['controlfrog 0.12. FH-2: MIDI forwarding USB C → USB A on, Send CCs on preset ld off.', 'EC4 on the FH-2\'s USB A: turn a knob there first. The check reloads the scene the FH-2 is in.'],
    run: (rig) => sceneReload(rig, keptScenes(), 'The scene is reloaded. Did the knob you turned go back?') },
  { id: 26, gig: true, title: 'Values at power-on', question: 'Power the FH-2 and the EC4 on together: do the knobs take the FH-2\'s values within about 20 s, without Func + Group?',
    before: ['controlfrog 0.12. The EC4 asks the first time setup 15 is open after power-on (an earlier 0.12 build: only if it starts there).'],
    manual: ['Yes', 'Only after Func + Group'] },
  { id: 28, gig: true, title: 'Func + Group while playing', question: 'With the music running, press Func + Group a few times: do the knobs update, and does the music go on evenly?',
    before: ['controlfrog 0.12.'],
    manual: ['Fine', 'Stutters', 'No update'] },
  // for the step editor (build plan, M4)
  { id: 'S1', steps: true, title: 'Steps into notes', question: 'Which note does each of a step’s 16 degrees and 8 octaves play?',
    before: ['Note sequencer 4 plays a test sequence to the Mac (USB C) only; the others don’t send there meanwhile.', 'You start and stop the clock when it asks.'],
    run: checkSteps },
  { id: 'S2', steps: true, title: 'Sequencer banks', question: 'How long is a note and a drum sequencer bank dump?',
    before: ['Reads the active banks and bank 1; changes nothing.'], run: checkBanks },
  { id: 'S3', steps: true, title: 'What a note bank holds', question: 'Where in a bank dump does a saved sequence go, and how is it stored?',
    before: ['Note sequencer 1 gets a test sequence; you save it into two slots on the Launchpad when it asks.', 'Your active bank, config and preset come back afterwards.'],
    run: checkNoteBank },
  { id: 'S4', steps: true, title: 'What a drum bank holds', question: 'The same for a drum sequencer bank.',
    before: ['The drum sequencer gets a test pattern; you save it into two slots on the Launchpad when it asks.', 'Your active bank, config and preset come back afterwards.'],
    run: checkDrumBank },
  { id: 'S5', steps: true, title: 'Root, directions, mutes', question: 'What does the root do, which direction is each of values 1–3, and how often does each mute level mute?',
    before: ['Stop the clock before Run.', 'All four note sequencers play test sequences to the Mac (USB C) only, on ch 13–16; you run the clock about 30 s.'],
    run: checkPlay },
  { id: 'S6', steps: true, title: 'Orders, length and ratchet', question: 'Which order is each permutation 1–3, and how do a step’s length, ratchet and tie play (with a short gate, note-offs too)?',
    before: ['Stop the clock before Run.', 'As S5; you run the clock about 15 s.'],
    run: checkOrders },
  // for tunings (build plan, M4: Scala/MTS)
  { id: 'T1', tuning: true, title: 'Tuning choices', question: 'What does each of a voice’s tuning values do, and do its .scl and .kbm numbers count from 0 or from 1?',
    before: ['Replaces .scl and .kbm slot 32 with a test scale: the FH-2 can’t say what’s there now.', 'A voice outside your rack plays a note per choice; leave the FH-2 on its overview.'],
    run: checkTuning },
  { id: 'T2', tuning: true, title: 'Scala slots', question: 'With ordinary scale files, which slot does each .scl / .kbm number reach, and did T1’s kind of map cause its Scala Error?',
    before: ['Replaces .scl and .kbm slots 1, 2 and 32: the FH-2 can’t say what’s there now.', 'A voice outside your rack plays a note per number; leave the FH-2 on its overview.'],
    run: checkTuningSlots },
  // the BCR32 on its first day, on the stock firmware (build plan, M4): nothing is written to it
  { id: 'B1', bcr: true, title: 'Firmware and ports', question: 'Which firmware does it run, and which MIDI ports does it show?',
    before: ['BCR32 on the Mac over USB.'], run: bcrIdentify },
  { id: 'B2', bcr: true, title: '14-bit order', question: 'With a knob on absolute 14-bit, which half of the CC pair comes first?',
    before: ['Set a knob to absolute 14-bit on a CC below 32 (front panel or BCR32 Studio).'], run: bcr14bit },
  { id: 'B3', bcr: true, title: 'Relative modes', question: 'What does each relative mode send for one notch, and which does the FH-2 take?',
    before: ['You set a knob to Rel1, Rel2 and Rel3 in turn; the check says when.'], run: bcrRelative },
  { id: 'B4', bcr: true, title: 'LED rings', question: 'When a knob’s CC comes in, does its ring move, and does turning go on from there?',
    before: ['A knob on absolute 7-bit, its LED ring on (any mode but Off).', 'Not on the sequencer’s remote channel: CCs there could change it.'], run: bcrRings },
  { id: 'B5', bcr: true, title: 'Display', question: 'Turn a knob: what does the OLED show?',
    before: ['Controller mode, the knob’s Show value on.'], manual: ['Value only', 'Name and value', 'Nothing'] },
  { id: 'B6', bcr: true, title: 'Read a preset', question: 'Does it hand over its working preset as BCL text?',
    before: ['Controller mode, sequencer stopped. A read: nothing is written.'], run: bcrPreset },
  { id: 'B7', bcr: true, title: 'On the FH-2’s USB A', question: 'Plugged into the FH-2’s USB A (beside the EC4, through the hub), does the FH-2 react to its knobs?',
    before: ['Give a knob the channel and CC of a knob on an EC4 page: the FH-2 maps that one.'], manual: ['Reacts', 'Nothing'] },
  { id: 'B8', bcr: true, title: '14-bit rings', question: 'When a 14-bit knob’s pair comes in, does its ring move, and does turning go on from there?',
    before: ['A knob on absolute 14-bit on a CC below 32, its LED ring on.', 'Not on the sequencer’s remote channel.'], run: bcr14Rings },
  // the BCR32 with Rotary Club and Night Shift's BCR32 tab (build plan: B9–B14, and the tracks of 0.29)
  { id: 'B9', rc: true, title: 'Send beside other knobs', question: 'Does Send to BCR32 change only Night Shift’s knobs, ask before writing over another’s, and keep them after a power cycle?',
    before: ['BCR32 on the Mac; Night Shift open in another tab, the BCR32 linked there; Eye of Providence closed.', 'Another app’s knobs and a key on the unit, and a Night Shift setting on one of those knobs (Send should ask).', 'Reads only: Night Shift’s tab does the writing.'],
    run: rcStored },
  { id: 'B10', rc: true, title: 'The live link', question: 'Does the BCR32’s page follow what you select and back, a touched knob select its setting, the values show in FH-2 units, the knobs start where the FH-2 is?',
    before: ['FH-2 and BCR32 on the Mac, Night Shift’s knobs stored on the BCR32, the controller showing.'], manual: ['All of it', 'Some of it', 'None'] },
  { id: 'B11', rc: true, title: 'Thru', question: 'With Thru on in the BCR32 tab, do Night Shift’s knobs reach the FH-2, and nothing else (other knobs, keys, the tracks’ notes)?',
    before: ['A track playing; Logic not passing the BCR32 on.'], manual: ['Only its knobs', 'Other MIDI too', 'Nothing'] },
  { id: 'B12', rc: true, title: 'Knob feel', question: 'Does a knob turn as far per setting as on the EC4 (a slow, a stepped and a 14-bit one)?',
    before: ['The same settings on both controllers.'], manual: ['Same', 'Different'] },
  { id: 'B13', rc: true, title: 'Without the computer', question: 'On the FH-2’s USB A, does the BCR32 take the FH-2’s values by itself (within 10 s, and after a scene’s program change) and show them in FH-2 units?',
    before: ['Night Shift’s knobs stored on the BCR32, then the BCR32 on the FH-2’s USB A.'], manual: ['Yes', 'Only some', 'No'] },
  { id: 'B14', rc: true, title: 'A page without USB', question: 'With a page’s outputs on DIN only (Eye of Providence), does the BCR32 tab warn, and do Night Shift’s knobs there stay away from the FH-2?',
    before: ['Night Shift’s knobs on that page.'], manual: ['Warns, nothing arrives', 'Something else'] },
  { id: 'B15', rc: true, title: 'The tracks', question: 'Does Rotary Club tell its 16 tracks, and does a change at the unit come through?',
    before: ['BCR32 on the Mac, Rotary Club 0.29 or later.', 'Reads only: nothing is written.'], run: rcTracks },
];

const state = { running: null, log: [], results: load(RESULTS_KEY) ?? {}, failed: {}, port: '', error: '', asking: null }; // failed: a check's last stop, with its log, until it runs again

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

// A question in the running check's card; resolves to the answer clicked.
function ask(text, answers) {
  return new Promise((resolve) => {
    state.asking = { text, answers, resolve };
    render();
  });
}

function reply(a) {
  const q = state.asking;
  state.asking = null;
  log(`${q.text} ${a}`);
  q.resolve(a);
}

function log(text) {
  state.log.push(text);
  render();
}

// The BCR32's ports: its CTRL port to send to, every port of it to listen on.
async function bcrRig() {
  const access = await midiAccess();
  const live = (p) => p.state !== 'disconnected' && /bcr/i.test(p.name);
  const ins = [...access.inputs.values()].filter(live);
  const outs = [...access.outputs.values()].filter(live);
  // never a guess: CCs on the ZAQ port could change the sequencer
  if (!outs.length) throw new Error('no BCR32 port: is it connected over USB?');
  const ctrl = outs.find((p) => /ctrl/i.test(p.name)) ?? (outs.length === 1 ? outs[0] : null);
  if (!ctrl) throw new Error(`which BCR32 port is CTRL? None is named so: ${outs.map((p) => p.name).join(', ')}`);
  state.port = ctrl.name;
  const listeners = new Set();
  for (const i of ins) i.onmidimessage = (e) => [...listeners].forEach((f) => f(e.data));
  return {
    ports: { ins: ins.map((p) => p.name), outs: outs.map((p) => p.name), ctrl: ctrl.name },
    send: (bytes) => ctrl.send(Uint8Array.from(bytes)),
    listen: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    next: (filter, ms) => new Promise((resolve) => {
      const f = (m) => {
        const r = filter(m);
        if (r == null) return;
        clearTimeout(t);
        listeners.delete(f);
        resolve(r);
      };
      const t = setTimeout(() => {
        listeners.delete(f);
        resolve(null);
      }, ms);
      listeners.add(f);
    }),
    close: () => ins.forEach((i) => { i.onmidimessage = null; }),
    log, ask, wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

async function runCheck(c) {
  if (state.running) return;
  state.running = c.id;
  state.log = [];
  state.error = '';
  if (c.bcr || c.rc) return runBcrCheck(c);
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
    const heard = []; // CCs the FH-2 sends to USB C, for checks 3 and 25
    const notes = []; // and its note-ons, for checks S1, S5, S6
    const offs = []; // its note-offs, for S6
    const toClient = transport.onmessage;
    transport.onmessage = (bytes) => {
      if (bytes.length === 3 && (bytes[0] & 0xf0) === 0xb0) heard.push([...bytes]);
      if (bytes.length === 3 && (bytes[0] & 0xf0) === 0x90 && bytes[2] > 0) notes.push([...bytes, performance.now()]);
      else if (bytes.length === 3 && ((bytes[0] & 0xf0) === 0x80 || (bytes[0] & 0xf0) === 0x90)) offs.push([...bytes, performance.now()]);
      toClient(bytes);
    };
    const rig = { client, send: (bytes) => transport.send(Uint8Array.from(bytes)), log, wait: (ms) => new Promise((r) => setTimeout(r, ms)), hardware: hardware(), ask,
      heard: () => heard.splice(0), notes: () => notes.splice(0), offs: () => offs.splice(0) };
    const r = await c.run(rig);
    state.results[c.id] = { at: new Date().toISOString(), ...r };
    delete state.failed[c.id];
    save();
  } catch (e) {
    state.error = e.message;
    log(`Stopped: ${e.message}`);
    state.failed[c.id] = { at: new Date().toISOString(), message: e.message, log: state.log.slice(-8) };
  } finally {
    client?.close();
    clearInterval(busy);
    markBusy(false);
    state.running = null;
    render();
  }
}

async function runBcrCheck(c) {
  render();
  let rig = null;
  try {
    rig = await bcrRig();
    const r = await c.run(rig);
    state.results[c.id] = { at: new Date().toISOString(), ...r };
    delete state.failed[c.id];
    save();
  } catch (e) {
    state.error = e.message;
    log(`Stopped: ${e.message}`);
    state.failed[c.id] = { at: new Date().toISOString(), message: e.message, log: state.log.slice(-8) };
  } finally {
    rig?.close();
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
  const f = state.failed[c.id];
  const running = state.running === c.id;
  return h('section', { class: 'check-card' + (running ? ' running' : '') },
    h('h2', {}, h('span', { class: 'n' }, String(c.id)), c.title),
    h('p', {}, c.question),
    h('ul', { class: 'note' }, c.before.map((b) => h('li', {}, b))),
    h('div', { class: 'actions' }, c.manual
      ? c.manual.map((a) => h('button', { type: 'button', class: 'btn', onclick: () => answer(c, a) }, a))
      : h('button', { type: 'button', class: 'btn primary', disabled: !!state.running, onclick: () => runCheck(c) }, running ? 'Running…' : r ? 'Run again' : 'Run')),
    // a stop stays in the card, with the last of its log, until the check runs through
    !running && f && h('div', { class: 'result problem' }, h('b', {}, `Stopped: ${f.message}`), h('pre', { class: 'log' }, f.log.join('\n')),
      h('span', { class: 'note' }, new Date(f.at).toLocaleString())),
    r && h('div', { class: 'result' }, f ? h('span', { class: 'note' }, 'Last result:') : null, h('b', {}, r.summary), r.lines.length ? h('ul', {}, r.lines.map((l) => h('li', {}, l))) : null,
      h('span', { class: 'note' }, new Date(r.at).toLocaleString())),
    running && state.asking && h('div', { class: 'ask' }, h('p', {}, h('b', {}, state.asking.text)),
      h('div', { class: 'actions' }, state.asking.answers.map((a) => h('button', { type: 'button', class: 'btn', onclick: () => reply(a) }, a)))),
    running && h('pre', { class: 'log' }, state.log.join('\n')));
}

function render() {
  replace($('#app'),
    h('header', { class: 'bar' },
      h('div', { class: 'brand' }, 'Night Shift · hardware checks'),
      h('span', { class: 'note' }, state.port ? `On “${state.port}”` : 'Each check puts your config and preset back; nothing goes to flash'),
      h('div', { class: 'grow' }),
      state.error && h('span', { class: 'status' }, state.error),
      h('button', { type: 'button', class: 'btn', onclick: copy }, 'Copy results'),
      h('a', { class: 'btn', href: 'index.html' }, 'Night Shift')),
    h('main', { class: 'checks' }, CHECKS.filter((c) => !c.gig && !c.bcr && !c.rc && !c.steps && !c.tuning).map(card),
      h('h2', { class: 'checks-head' }, 'For the step editor'), CHECKS.filter((c) => c.steps).map(card),
      h('h2', { class: 'checks-head' }, 'For tunings'), CHECKS.filter((c) => c.tuning).map(card),
      h('h2', { class: 'checks-head' }, 'Before a gig'), CHECKS.filter((c) => c.gig).map(card),
      h('h2', { class: 'checks-head' }, 'BCR32 with Rotary Club'), CHECKS.filter((c) => c.rc).map(card),
      h('h2', { class: 'checks-head' }, 'BCR32, day one (stock firmware)'), CHECKS.filter((c) => c.bcr).map(card),
      h('section', { class: 'check-card' }, h('h2', {}, 'Results'), h('pre', { class: 'log' }, resultsText()))));
}

render();
