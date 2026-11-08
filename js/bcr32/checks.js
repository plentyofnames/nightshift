// The BCR32's day-one checks (checks.html, "BCR32"): what Night Shift has to know before it
// writes presets for it (build plan, M4). Nothing is written to the BCR32: it is asked which
// firmware it runs and for its working preset as text, and plain CCs are sent to one knob of its
// CTRL port. Never to a ZAQ port, where CCs on the sequencer's remote channel recall patterns
// and change steps (community protocol, §9). Your BCR32 shows the Mac one port (check B1), so
// keep off the remote channel. No DOM here.
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

// The rings, and whether a knob's value follows CCs coming in: after a sweep its ring ends away
// from where the knob was (at a quarter or three quarters); one notch right then sends on from
// there if its value followed, or from its own value if only the ring did (then the knob would
// make the FH-2's setting jump, as a stale EC4 knob would). Your BCR32 (2026-11-06): the rings
// follow CCs on absolute knobs, with a ring mode on; not on relative ones.
const sameKnob = (k) => (m) => {
  const c = ccOf(m);
  return c && c[0] === k[0] && c[1] === k[1] ? c : null;
};
const follows = (now, end, was) => now != null && Math.abs(now - end) <= Math.max(1, Math.abs(was - end) / 2);

export async function bcrRings(rig) {
  rig.log('Turn the knob to test (absolute, 7-bit)…');
  const k = await rig.next(ccOf, 20000);
  if (!k) return { summary: 'No knob turned', lines: [] };
  let was = k[2];
  const stop = rig.listen((m) => {
    const c = sameKnob(k)(m);
    if (c) was = c[2];
  });
  await rig.wait(800);
  stop();
  const end = was < 64 ? 96 : 32;
  rig.log(`Sending ${where(k)} from 0 to 127 and back to ${end} on ${rig.ports.ctrl}…`);
  const sweep = [...Array.from({ length: 16 }, (_, i) => i * 8), 127, ...Array.from({ length: 16 }, (_, i) => 120 - i * 8).filter((v) => v > end), end];
  for (const v of sweep) {
    rig.send([k[0], k[1], v]);
    await rig.wait(40);
  }
  const a = await rig.ask(`Did its LED ring move with it, ending at ${end > 64 ? 'three quarters' : 'a quarter'}?`, ['Moved', 'Didn’t move']);
  const ring = a === 'Moved' ? `Rings follow CCs on ${rig.ports.ctrl}` : `Rings don’t follow CCs on ${rig.ports.ctrl}`;
  const lines = [`knob on ${where(k)}, at ${was}; sent on ${rig.ports.ctrl}, ending at ${end}: ${a.toLowerCase()}`];
  rig.log('Now turn it one notch right…');
  const n = await rig.next(sameKnob(k), 15000);
  if (!n) return { summary: ring, lines: [...lines, 'no notch turned'] };
  const on = follows(n[2], end, was);
  lines.push(`one notch right sent ${n[2]}: ${on ? `on from ${end}, the value sent` : `not on from ${end}`}`);
  return { summary: `${ring}; turning goes on ${on ? 'from the value sent' : 'from the knob’s own value'}`, lines };
}

// The same for a knob on absolute 14-bit (a CC below 32 and the one 32 above): the pair goes
// out coarse half first, as your FH-2 sends it.
export async function bcr14Rings(rig) {
  rig.log('Turn the knob to test (absolute 14-bit, a CC below 32) a few notches…');
  const got = [];
  const stop = rig.listen((m) => {
    const c = ccOf(m);
    if (c) got.push(c);
  });
  for (let t = 0; t < 40 && !pairOrder(got).pairs.length; t++) await rig.wait(500);
  await rig.wait(800);
  stop();
  const pair = pairOrder(got).pairs[0];
  if (!pair) return { summary: 'No 14-bit pair came: set a knob to absolute 14-bit on a CC below 32', lines: [] };
  const status = 0xb0 | pair.channel;
  const name = `ch ${pair.channel + 1} CC ${pair.cc}/${pair.cc + 32}`;
  const value = (msgs) => { // the knob's last whole value in `msgs`
    let msb = null;
    let v = null;
    for (const [s, c, x] of msgs) {
      if (s !== status) continue;
      if (c === pair.cc) msb = x;
      else if (c === pair.cc + 32 && msb != null) v = msb * 128 + x;
    }
    return v;
  };
  const was = value(got) ?? 8192;
  const end = was >= 8192 ? 4096 : 12288;
  rig.log(`Sending ${name} from 0 to 16383 and back to ${end}, coarse half first…`);
  const sweep = [...Array.from({ length: 16 }, (_, i) => i * 1024), 16383, ...Array.from({ length: 16 }, (_, i) => 15360 - i * 1024).filter((v) => v > end), end];
  for (const v of sweep) {
    rig.send([status, pair.cc, v >> 7]);
    rig.send([status, pair.cc + 32, v & 127]);
    await rig.wait(40);
  }
  const a = await rig.ask(`Did its LED ring move with it, ending at ${end > 8192 ? 'three quarters' : 'a quarter'}?`, ['Moved', 'Didn’t move']);
  const ring = a === 'Moved' ? 'The ring follows 14-bit pairs' : 'The ring doesn’t follow 14-bit pairs';
  const lines = [`knob on ${name}, at ${was}; sent ending at ${end}: ${a.toLowerCase()}`];
  rig.log('Now turn it one notch right…');
  const after = [];
  const stop2 = rig.listen((m) => {
    const c = ccOf(m);
    if (c) after.push(c);
  });
  for (let t = 0; t < 30 && value(after) == null; t++) await rig.wait(500);
  stop2();
  const now = value(after);
  if (now == null) return { summary: ring, lines: [...lines, 'no notch turned'] };
  const on = follows(now, end, was);
  lines.push(`one notch right sent ${now}: ${on ? `on from ${end}, the value sent` : `not on from ${end}`}`);
  return { summary: `${ring}; turning goes on ${on ? 'from the value sent' : 'from the knob’s own value'}`, lines };
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
