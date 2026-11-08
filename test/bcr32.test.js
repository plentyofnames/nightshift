// Tests for the BCR32's SysEx helpers (js/bcr32/sysex.js) and its day-one checks
// (js/bcr32/checks.js), against a stand-in BCR32.

import { test, assert, eq } from './harness.js';
import { productQuery, productOf, presetRead, bclLineOf, presetName, pairOrder, relativeCode } from '../js/bcr32/sysex.js';
import { bcrIdentify, bcr14bit, bcrRelative, bcrRings, bcr14Rings, bcrPreset } from '../js/bcr32/checks.js';

const reply = (...data) => [0xf0, 0x00, 0x20, 0x32, 0x00, 0x64, ...data, 0xf7];
const bcl = (n, text) => reply(0x20, n >> 7, n & 127, ...[...text].map((c) => c.charCodeAt(0)));

test('BCR32 SysEx: the two reads, the product reply, BCL lines', () => {
  eq(productQuery(), [0xf0, 0x00, 0x20, 0x32, 0x7f, 0x64, 0x00, 0xf7]);
  eq(presetRead(), [0xf0, 0x00, 0x20, 0x32, 0x7f, 0x64, 0x40, 0x7f, 0xf7], 'the working preset');
  eq(productOf(reply(0x00, 0x01, 0, 0, 1, 0, 3)), { device: 0, version: [1, 0, 3], text: '1.0.3' });
  eq(productOf(reply(0x00, 0x01, 0x00, 0x00, 0x00, 0x38, 0x00)).text, '0.56.0', 'the capture from firmware 0.56.0');
  eq(productOf(reply(0x20, 0, 0)), null, 'not a product reply');
  eq(bclLineOf(bcl(130, '$encoder 1')), { index: 130, text: '$encoder 1' });
  eq(presetName(['$rev BCR32', '$preset', "  .name 'Night Shift 1'", '$end']), 'Night Shift 1');
});

test('what the knobs send: the 14-bit order and the relative codes', () => {
  const msb = [[0xbf, 1, 64], [0xbf, 33, 10], [0xbf, 1, 64], [0xbf, 33, 20]];
  eq(pairOrder(msb), { msbFirst: 2, lsbFirst: 0, pairs: [{ channel: 15, cc: 1 }] });
  eq(pairOrder([[0xb0, 33, 10], [0xb0, 1, 64]]).lsbFirst, 1);
  eq(pairOrder([[0xb0, 1, 64], [0xb1, 33, 10]]).msbFirst, 0, 'another channel is no pair');
  eq([relativeCode(1, 127).code, relativeCode(65, 63).code, relativeCode(65, 1).code, relativeCode(64, 64).code], ['1/127', '65/63', 'sign', 'other']);
  eq([relativeCode(1, 127).fh2, relativeCode(65, 63).fh2, relativeCode(65, 1).fh2], [true, true, false]);
  eq([relativeCode(1, 65).code, relativeCode(1, 65).fh2, relativeCode(3, 125).code, relativeCode(3, 67).code], ['sign', false, '1/127', 'sign'],
    'your Rel3 (check B3): 1 up, 65 down is a sign bit, not two’s complement');
});

// A stand-in BCR32: `onSend(bytes)` gives its answers (they come a moment later, as over USB);
// `turns` are what you do on it, handed to whatever listens, one per wait.
function standIn({ onSend = () => [], turns = [] } = {}) {
  const listeners = new Set();
  const deliver = (m) => [...listeners].forEach((f) => f(m));
  const queue = [...turns];
  const sent = [];
  const asked = [];
  const rig = {
    ports: { ins: ['BCR-32 CTRL', 'BCR-32 ZAQ'], outs: ['BCR-32 CTRL', 'BCR-32 ZAQ'], ctrl: 'BCR-32 CTRL' },
    send: (b) => {
      sent.push(b);
      const answers = onSend(b);
      setTimeout(() => answers.forEach(deliver), 0);
    },
    listen: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    next: (filter) => new Promise((resolve) => {
      const f = (m) => {
        const r = filter(m);
        if (r == null) return;
        listeners.delete(f);
        resolve(r);
      };
      listeners.add(f);
      setTimeout(() => {
        while (listeners.has(f) && queue.length) deliver(queue.shift());
        if (listeners.has(f)) {
          listeners.delete(f);
          resolve(null);
        }
      }, 1);
    }),
    wait: async () => {
      await new Promise((r) => setTimeout(r, 0));
      if (queue.length && listeners.size) deliver(queue.shift());
    },
    log: () => {},
    ask: async (q, answers) => {
      asked.push(q);
      return answers[0];
    },
  };
  return { rig, sent, asked };
}

test('the BCR32 checks against a stand-in', async () => {
  // which firmware
  let s = standIn({ onSend: (b) => (b[6] === 0x00 ? [reply(0x00, 0x01, 0, 0, 1, 0, 3)] : []) });
  eq((await bcrIdentify(s.rig)).summary, 'Firmware 1.0.3 (device 0)');
  eq((await bcrIdentify(standIn().rig)).summary, 'No answer on BCR-32 CTRL');
  // the 14-bit order
  const turn = Array.from({ length: 8 }, (_, k) => [[0xb0, 2, 60 + k], [0xb0, 34, k * 9]]).flat();
  s = standIn({ turns: turn });
  const r14 = await bcr14bit(s.rig);
  eq([r14.summary, r14.lines[1]], ['MSB first, as your FH-2 is set', 'pair on ch 1: CC 2 and 34']);
  // three relative modes, a notch up and down each
  s = standIn({ turns: [[0xb0, 20, 1], [0xb0, 20, 127], [0xb0, 20, 65], [0xb0, 20, 63], [0xb0, 20, 65], [0xb0, 20, 1]] });
  const rel = await bcrRelative(s.rig);
  eq(rel.summary, 'The FH-2 takes Rel1, Rel2');
  eq(rel.lines[2], 'Rel3 (ch 1 CC 20): 65 up, 1 down: a sign bit, the FH-2 reads it wrong');
  // the LED rings: a sweep to the knob turned, to the CTRL port only
  s = standIn({ turns: [[0xb3, 40, 10], [0xb3, 40, 11], [0xb3, 40, 97]] });
  const rings = await bcrRings(s.rig);
  eq(rings.summary, 'Rings follow CCs on BCR-32 CTRL; turning goes on from the value sent');
  assert(s.sent.length > 20 && s.sent.every((b) => b[0] === 0xb3 && b[1] === 40), 'only that knob’s CC');
  eq(s.sent.at(-1), [0xb3, 40, 96], 'left at three quarters, away from 11');
  s = standIn({ turns: [[0xb3, 40, 100], [0xb3, 40, 101], [0xb3, 40, 102]] });
  eq((await bcrRings(s.rig)).summary, 'Rings follow CCs on BCR-32 CTRL; turning goes on from the knob’s own value', 'only the ring followed');
  // 14-bit: the pair found, swept coarse half first, and the notch read as a whole value
  s = standIn({ turns: [[0xb1, 2, 64], [0xb1, 34, 0], [0xb1, 2, 64], [0xb1, 2, 32], [0xb1, 34, 10]] });
  const r14r = await bcr14Rings(s.rig);
  eq(r14r.summary, 'The ring follows 14-bit pairs; turning goes on from the value sent');
  eq(s.sent.slice(-2), [[0xb1, 2, 32], [0xb1, 34, 0]], 'ending at 4096, away from 8192');
  assert(s.sent.every((b, i) => b[1] === (i % 2 ? 34 : 2)), 'always the coarse half first');
  // the working preset as BCL
  const lines = ['$rev BCR32', '$preset', "  .name 'Init'", '$encoder 1', '  .easypar CC 1 1 0 127 absolute', '$end'];
  s = standIn({ onSend: (b) => (b[6] === 0x40 ? lines.map((t, n) => bcl(n, t)) : []) });
  const pr = await bcrPreset(s.rig);
  eq([pr.summary, pr.lines.length], ['6 lines, “Init”', 6]);
  eq(s.sent, [presetRead(0x7f)], 'one read, nothing else');
});
