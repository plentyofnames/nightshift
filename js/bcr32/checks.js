// The BCR32's day-one checks (checks.html, "BCR32"): what Night Shift has to know before it
// writes presets for it (build plan, M4). Nothing is written to the BCR32: it is asked which
// firmware it runs and for its working preset as text, and plain CCs are sent to one knob of its
// CTRL port. Never to the ZAQ port, where CCs on the sequencer's remote channel recall patterns
// and change steps (community protocol, §9). No DOM here.
//
// `rig`: { ports: { ins, outs, ctrl } (names), send(bytes) (to CTRL), next(filter, ms) (the first
// message `filter` maps to something, or null after `ms`), listen(fn) (every message; returns a
// stop function), log(text), ask(question, answers), wait(ms) }. Each resolves to { summary, lines }.

import { productQuery, productOf, presetRead, bclLineOf, presetName, pairOrder, relativeCode } from './sysex.js';

const ccOf = (m) => (m.length === 3 && (m[0] & 0xf0) === 0xb0 ? [...m] : null);
const where = (m) => `ch ${(m[0] & 15) + 1} CC ${m[1]}`;

export async function bcrIdentify(rig) {
  const lines = [`MIDI in: ${rig.ports.ins.join(', ') || 'none'}`, `MIDI out: ${rig.ports.outs.join(', ')}`];
  rig.log(`Asking ${rig.ports.ctrl} which firmware it runs…`);
  rig.send(productQuery());
  const p = await rig.next(productOf, 1500);
  if (!p) return { summary: `No answer on ${rig.ports.ctrl}`, lines };
  rig.log(`Firmware ${p.text}, device ${p.device}`);
  return { summary: `Firmware ${p.text} (device ${p.device})`, lines };
}

export async function bcr14bit(rig) {
  rig.log('Turn the knob set to absolute 14-bit, slowly, for a few seconds…');
  const got = [];
  const stop = rig.listen((m) => {
    const c = ccOf(m);
    if (c) got.push(c);
  });
  for (let t = 0; t < 30; t++) {
    await rig.wait(500);
    const r = pairOrder(got);
    if (r.msbFirst + r.lsbFirst >= 8) break;
  }
  stop();
  const r = pairOrder(got);
  const lines = [`${got.length} CCs: ${r.msbFirst} pairs with the coarse half (MSB) first, ${r.lsbFirst} with the fine half first`,
    ...r.pairs.map((x) => `pair on ch ${x.channel + 1}: CC ${x.cc} and ${x.cc + 32}`)];
  if (!r.msbFirst && !r.lsbFirst) return { summary: 'No 14-bit pair came: set a knob to absolute 14-bit on a CC below 32', lines };
  return { summary: r.msbFirst >= r.lsbFirst ? 'MSB first, as your FH-2 is set' : 'LSB first: your FH-2 reads MSB first', lines };
}

export async function bcrRelative(rig) {
  const lines = [];
  const takes = [];
  for (const mode of ['Rel1', 'Rel2', 'Rel3']) {
    if ((await rig.ask(`Set a knob to ${mode} (7-bit), then Ready.`, ['Ready', 'Skip'])) === 'Skip') continue;
    rig.log(`${mode}: turn it one notch right…`);
    const up = await rig.next(ccOf, 15000);
    if (!up) {
      lines.push(`${mode}: nothing came`);
      continue;
    }
    await rig.wait(500); // what else that turn sent
    rig.log(`${mode}: now one notch left…`);
    const down = await rig.next((m) => {
      const c = ccOf(m);
      return c && c[0] === up[0] && c[1] === up[1] ? c : null;
    }, 15000);
    if (!down) {
      lines.push(`${mode} (${where(up)}): ${up[2]} up, nothing down`);
      continue;
    }
    const r = relativeCode(up[2], down[2]);
    if (r.fh2) takes.push(mode);
    lines.push(`${mode} (${where(up)}): ${r.text}`);
    await rig.wait(500);
  }
  if (!lines.length) return { summary: 'Skipped', lines };
  return { summary: takes.length ? `The FH-2 takes ${takes.join(', ')}` : 'The FH-2 takes none of them', lines };
}

export async function bcrRings(rig) {
  rig.log('Turn the knob to test (absolute, 7-bit)…');
  const k = await rig.next(ccOf, 20000);
  if (!k) return { summary: 'No knob turned', lines: [] };
  await rig.wait(800);
  rig.log(`Sending ${where(k)} from 0 to 127 and back on ${rig.ports.ctrl}…`);
  const sweep = [...Array.from({ length: 16 }, (_, i) => i * 8), 127, ...Array.from({ length: 16 }, (_, i) => 120 - i * 8)];
  for (const v of sweep) {
    rig.send([k[0], k[1], v]);
    await rig.wait(40);
  }
  rig.send([k[0], k[1], 64]);
  const a = await rig.ask('Did its LED ring move with it (ending in the middle)?', ['Moved', 'Didn’t move']);
  const lines = [`knob on ${where(k)}; sent on ${rig.ports.ctrl}: ${a.toLowerCase()}`];
  return { summary: a === 'Moved' ? `Rings follow CCs on ${rig.ports.ctrl}` : `Rings don’t follow CCs on ${rig.ports.ctrl}`, lines };
}

export async function bcrPreset(rig) {
  rig.log('Asking for the working preset as BCL (controller mode, sequencer stopped)…');
  const lines = [];
  const stop = rig.listen((m) => {
    const l = bclLineOf(m);
    if (l) lines.push(l.text);
  });
  rig.send(presetRead(0x7f));
  const start = Date.now();
  let seen = 0;
  let quiet = 0;
  while (!lines.some((l) => l.trim() === '$end') && Date.now() - start < 45000) {
    await rig.wait(250);
    quiet = lines.length === seen ? quiet + 250 : 0;
    seen = lines.length;
    if (quiet >= 3000) break;
  }
  stop();
  if (!lines.length) return { summary: 'No preset came: is it in controller mode, with the sequencer stopped?', lines: [] };
  const done = lines.some((l) => l.trim() === '$end');
  const name = presetName(lines);
  rig.log(`${lines.length} lines${done ? '' : ', cut short'}`);
  return { summary: `${lines.length} lines${name ? `, “${name}”` : ''}${done ? '' : ' (no $end: cut short)'}`, lines: lines.slice(0, 24) };
}
