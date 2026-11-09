// check_bcr32_sim.js - Night Shift's BCR32 writer and live link against Rotary Club's own C code:
// the firmware repository's simulated controller (its `make build/host/sim_ctl`; the protocol and the
// controller as the firmware wires them, through its USB-MIDI reassembly).
//
//   deno run --allow-run --allow-read tools/check_bcr32_sim.js <path to sim_ctl>
//
// Another app (as Eye of Providence would) first puts its knobs and a key on page 1. Then Night
// Shift reads the image, writes its own knobs with their FH-2 sync entries and RELOADs; the image
// read back must have every other byte as it was. Then knobs are turned in the simulator (Night
// Shift's send their CCs on the pages channel, 14-bit ones MSB then LSB; the other app's its own),
// and the live link's value texts, values, RAM edits, page turns and touch events are checked.

import { derive } from '../js/patch/derive.js';
import { examplePatch } from '../js/patch/example.js';
import { apply } from '../js/patch/edit.js';
import { pagesOf } from '../js/ec4/pages.js';
import { bcrPagesOf, putObject, knobOf } from '../js/rotary/pages.js';
import { wanted, plan, writePlan, readImage, emptyHeld, editsFor, knobBytes } from '../js/rotary/image.js';
import { Bcr32Link } from '../js/rotary/link.js';
import * as R from '../vendor/eyeofprovidence/js/model.js';
import { Device } from '../vendor/eyeofprovidence/js/device.js';
import { host, unframe } from '../vendor/eyeofprovidence/js/proto.js';
import { parseTracks, trackLine, hasTracks, TRACKS_SPACE } from '../js/rotary/tracks.js';

const simPath = Deno.args[0];
if (!simPath) {
  console.log('usage: deno run --allow-run --allow-read tools/check_bcr32_sim.js <path to sim_ctl>');
  Deno.exit(2);
}
const sim = new Deno.Command(simPath, { stdin: 'piped', stdout: 'piped', stderr: 'null' }).spawn();
const writer = sim.stdin.getWriter();
const reader = sim.stdout.pipeThrough(new TextDecoderStream()).getReader();
let buf = '';
let fails = 0;
let passes = 0;

async function line() {
  for (;;) {
    const i = buf.indexOf('\n');
    if (i >= 0) {
      const l = buf.slice(0, i);
      buf = buf.slice(i + 1);
      return l;
    }
    const { value, done } = await reader.read();
    if (done) throw new Error('sim_ctl ended');
    buf += value;
  }
}
async function say(text) {
  await writer.write(new TextEncoder().encode(text + '\n'));
  const out = [];
  for (;;) {
    const l = await line();
    if (l === 'OK') return out;
    out.push(l);
  }
}

const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const bytesOf = (l) => Uint8Array.from(l.trim().split(/\s+/), (h) => parseInt(h, 16));

// The simulator as a transport for Eye of Providence's Device: SysEx as hex lines, channel
// messages as MIDI in (IN st d1 d2); its replies back through onmessage, its MIDI out collected.
const transport = {
  name: 'sim_ctl',
  onmessage: null,
  chain: Promise.resolve(),
  midi: [],
  screen: '',
  send(bytes) {
    const lines = [];
    if (bytes[0] === 0xf0) lines.push(hexOf(bytes));
    else for (let k = 0; k + 2 < bytes.length; k += 3) lines.push(`IN ${hexOf(bytes.subarray(k, k + 3))}`);
    this.chain = this.chain.then(async () => {
      for (const l of lines) this.take(await say(l));
    });
  },
  take(out) {
    for (const l of out) {
      if (l.startsWith('F0')) {
        const b = bytesOf(l);
        queueMicrotask(() => this.onmessage?.(b));
      } else if (l.startsWith('MIDI ')) this.midi.push(l.slice(5));
      else if (l.startsWith('SCREEN ')) this.screen = l.slice(7);
    }
  },
  // a line for the simulated panel (TURN, PUSH, KEY, MODE, SCREEN) after what is queued
  async panel(text) {
    await this.chain;
    this.midi = [];
    const out = await say(text);
    this.take(out);
    await new Promise((r) => setTimeout(r, 0));
    return this.midi;
  },
  close() {},
};

function check(cond, what, got) {
  if (cond) passes++;
  else {
    fails++;
    console.log(`FAIL ${what}${got !== undefined ? ` (${JSON.stringify(got)})` : ''}`);
  }
}

// ---- another app's knobs and key on page 1 (the right half's top row; key 1)
const others = R.blankImage();
R.ensureHeader(others);
for (let c = 4; c < 8; c++) {
  R.setEncoder(others, 0, c, 'type', R.T.CCAB);
  R.setEncoder(others, 0, c, 'channel', 9);
  R.setEncoder(others, 0, c, 'number', 70 + c);
  R.setEncoder(others, 0, c, 'mode', 3);
  R.setName(others, 0, c, `RY${c}`);
}
R.setPush(others, 0, R.keyCell(0), 'type', R.PT.NOTE);
R.setName(others, 0, R.keyCell(0), 'Kick');

const dev = new Device(transport);
const info = await dev.identify();
check(info.fwMajor === 0 && info.fwMinor >= 23 && info.info[0] === 0x52, 'IDENTIFY: Rotary Club 0.23 or later', [info.fwMajor, info.fwMinor]);
for (let a = 0; a < R.SIZE; a += 256) await dev.write(a, others.subarray(a, a + 256));
await dev.reload();

// ---- Night Shift's knobs: an LFO in page 1's left half, a voice in page 3's right half
const p = { ...examplePatch(), names: {} };
const view = () => derive(p.config.values, p.preset.values, undefined, p.names);
const ec4 = () => pagesOf(view(), p.names);
const bcr = () => bcrPagesOf(ec4(), p.names);
for (const [obj, page, half] of [['lfo:4', 0, 0], ['converter:0', 2, 1]]) {
  const r = putObject(p.config.values, view(), p.names, ec4(), bcr(), obj, page, half);
  if (r.error) throw new Error(r.error);
  apply(p, r.changes);
}
const sync = { tempoMin: p.config.values.tempoMin, programChannel: p.config.values.presetProgramChannel };
const img = await readImage(dev);
check(R.readCell(img, 0, 4).name === 'RY4', 'READ: the other app’s knob is there');
const want = wanted(bcr(), view(), sync);
const pl = plan(img, want, emptyHeld());
check(pl.conflicts.length === 0, 'nothing in the way', pl.conflicts);
await writePlan(dev, pl);
const back = await readImage(dev);
let same = true;
for (let a = 0; a < R.SIZE; a++) if (back[a] !== pl.next[a]) same = false;
check(same, 'READ back: the image as planned');
let outside = 0;
for (let a = 0; a < R.SIZE; a++) {
  const l = R.locate(a);
  const ours = (l.cell != null && l.cell < 32 && want.knobs.has(`${l.page}:${l.cell}`)) || (a >= R.A.SYNC && a < R.A.SYNC + 8);
  if (!ours && back[a] !== others[a]) outside++;
}
check(outside === 0, 'every byte outside Night Shift’s knobs and the sync header as the other app left it', outside);

// ---- turning knobs
const b = bcr();
const ch = b.channel;
const rate = b.pages[0].cells[knobOf(0, 14)]; // the LFO's rate: 14-bit
const sine = b.pages[0].cells[knobOf(0, 4)];
let out = await transport.panel(`TURN ${knobOf(0, 4)} 1`);
check(out.length === 1 && out[0].startsWith(`7 B${ch.toString(16).toUpperCase()} ${sine.map.cc.toString(16).toUpperCase().padStart(2, '0')} `), `SINE: CC ${sine.map.cc} on ch ${ch + 1}, to every output`, out);
out = await transport.panel(`TURN ${knobOf(0, 14)} 1`);
const msb = rate.map.cc.toString(16).toUpperCase().padStart(2, '0');
const lsb = (rate.map.cc + 32).toString(16).toUpperCase().padStart(2, '0');
check(out.length === 2 && out[0].split(' ')[2] === msb && out[1].split(' ')[2] === lsb, `RATE: 14-bit, CC ${rate.map.cc} then ${rate.map.cc + 32}`, out);
await transport.panel('SCREEN');
check(/^ *\d+\.\d+\|RATE/.test(transport.screen), 'table C: the rate in Hz on the screen, without a host text', transport.screen);
await transport.panel(`TURN ${knobOf(0, 0)} 1`);
await transport.panel('SCREEN');
check(/^ *\d+PQ\|SYNC/.test(transport.screen), 'table C: the LFO’s sync base in PPQN', transport.screen);
out = await transport.panel('TURN 4 1');
check(out.length === 1 && out[0] === '7 B9 4A 03', 'the other app’s knob: CC 74 on ch 10, as it was', out);
out = await transport.panel('KEY 0 1');
check(out.length === 1 && out[0].startsWith('7 90 '), 'key 1: its note', out);
await transport.panel('KEY 0 0');
const voice = b.pages[2].cells.find(Boolean);
await dev.select(2);
out = await transport.panel(`TURN ${b.pages[2].cells.indexOf(voice)} 1`);
check(out.length >= 1 && out[0].split(' ')[2] === voice.map.cc.toString(16).toUpperCase().padStart(2, '0'), `page 3: ${voice.short} sends its CC`, out);
await dev.select(0);

// ---- the live link
const link = new Bcr32Link(dev, info);
const touches = [];
link.addEventListener('touch', (e) => touches.push(e.detail));
await link.start();
await transport.panel('MODE 1');
await dev.getState();
check(link.page === 0 && link.controller, 'STATE: page 1, the controller', [link.page, link.mode]);
const texts = b.pages[0].cells.map((c, i) => (c ? { text: `V${i}`.padStart(4), cc: { channel: c.map.channel, number: c.map.cc, value: c.map.bits === 14 ? 8000 : 100, bits: c.map.bits } } : null));
await link.show(texts);
await dev.getState();
out = await transport.panel(`TURN ${knobOf(0, 4)} 1`);
const v = parseInt(out[0]?.split(' ')[3] ?? '0', 16);
check(out.length === 1 && v > 100 && v <= 110, 'the value Night Shift sent (100) is where the knob turns from', out);
await transport.panel('SCREEN');
check(transport.screen.startsWith(`  V${knobOf(0, 4)}`) || transport.screen.includes(`V${knobOf(0, 4)}`), 'TEXT: the value text on the screen while turned', transport.screen);
await transport.panel('TURN 5 1');
await transport.panel('SCREEN');
check(transport.screen.includes('RY5'), 'the other app’s knob shows no text of Night Shift’s', transport.screen);
check(touches.some((t) => t.kind === 0 && t.index === knobOf(0, 4) && t.page === 0), 'TOUCH: a turned knob comes in', touches);
// RAM edits: SINE becomes its neighbour's record
const now = await readImage(dev);
const edits = editsFor(now, want, emptyHeld(), 0);
check(!edits.has(4) && edits.has(knobOf(0, 4)), 'EDIT only Night Shift’s places');
const moved = new Map([[knobOf(0, 4), knobBytes(now, 0, knobOf(0, 5)).slice(0, 15)]]);
await link.edit(moved, (i) => R.readRecord(now, 0, i));
await dev.getState();
const tri = b.pages[0].cells[knobOf(0, 5)];
out = await transport.panel(`TURN ${knobOf(0, 4)} 1`);
check(out.length === 1 && out[0].split(' ')[2] === tri.map.cc.toString(16).toUpperCase().padStart(2, '0'), 'after EDIT the knob sends what Night Shift put in RAM', out);
// a page turned on the BCR32 (SELECT from Night Shift, then the panel)
await link.select(2);
check(link.page === 2, 'SELECT: page 3', link.page);
const state = [];
link.addEventListener('state', (e) => state.push(e.detail));
await transport.panel('MODE 0');
await dev.getState();
check(!link.controller && state.some((s) => s.mode === 0), 'MODE 0: the sequencer shows', state);

// ---- the tracks (Rotary Club 0.29 on): read as Night Shift reads them; a change sends 35
if (hasTracks(info)) {
  const read = async () => parseTracks(Uint8Array.from([...await dev.read(0, 256, TRACKS_SPACE), ...await dev.read(256, 16, TRACKS_SPACE)]));
  const first = await read();
  const fresh = info.fwMajor > 0 || info.fwMinor >= 30 ? 'Off' : 'M303'; // 0.30 on: a fresh unit's tracks are off
  check(first.tracks.length === 16 && trackLine(first.tracks[0]) === `TR1 ch 1 ${fresh} → USB · α CC 74 · β CC 71`, `space 3: 16 tracks, a fresh unit’s (${fresh})`, trackLine(first.tracks[0]));
  const events = [];
  const was = transport.onmessage;
  transport.onmessage = (b) => {
    const fr = unframe(b);
    if (fr?.cmd === 0x35) events.push(fr.body[0]);
    was(b);
  };
  await transport.panel('TRACK 2 7 3 0 1 30 4 0 0 0 128 0');
  for (let k = 0; k < 5 && !events.length; k++) await transport.panel('SCREEN');
  const second = await read();
  transport.onmessage = was;
  check(events.length === 1 && second.counter === first.counter + 1, 'a track changed: one 35, the counter up', [events, second.counter]);
  check(trackLine(second.tracks[2]) === 'TR3 ch 8 Plaits Chords → USB · α CC 30 · β PB' && second.tracks[2].plaits.timbreCc === null, 'it reads back: Plaits on ch 8, no TIMBRE CC', trackLine(second.tracks[2]));
}

await writer.close();
await sim.status;
console.log(`check_bcr32_sim: ${passes} passed, ${fails} failed`);
Deno.exit(fails ? 1 : 0);
