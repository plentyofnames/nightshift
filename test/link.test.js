// Tests for the live link: the FH-2's values in four characters and as CCs, the TEXT and CC
// messages sent to the EC4, 14-bit knobs joined from their two CCs, and the link acting only
// while the EC4 is on setup 15.

import { test, assert, eq } from './harness.js';
import { examplePatch } from '../js/patch/example.js';
import { valueOf, valueText, ccFor, fromCc, pathOf } from '../js/ec4/values.js';
import { Ec4Link, Cc14, textMessage, ccBytes } from '../js/ec4/link.js';
import { settingKey, settingOf, SETUP } from '../js/ec4/pages.js';
import { voltsToLevel } from '../js/patch/tables.js';

const key = (kind, index, param) => settingKey({ kind, index, param });

test('values in four characters, in FH-2 units', () => {
  const range = () => 1; // ±5 V
  eq(valueText(key('output', 3, 'directLevel'), voltsToLevel(2.5, 1), { range }), '2.50');
  eq(valueText(key('output', 3, 'directLevel'), voltsToLevel(-2.5, 1), { range }), '-2.5');
  eq(valueText(key('output', 3, 'lfoLevel'), 8192), '50%');
  eq(valueText(key('output', 3, 'lfoTempoBase'), 6), '1/16');
  eq(valueText(key('output', 3, 'lfoSaw'), 64), '0');
  eq(valueText(key('converter', 0, 'arpMode'), 11), 'UP');
  eq(valueText(key('converter', 0, 'arpMode'), 0), 'OFF');
  eq(valueText(key('converter', 0, 'transpose'), 76), '+12');
  eq(valueText(key('converter', 0, 'arpLatch'), 1), 'ON');
  eq(valueText(key('converter', 0, 'envAttackShape'), 64), 'LIN');
  eq(valueText(key('euclid', 0, 'rate'), 0), 'EXT');
  eq(valueText(key('euclid', 0, 'reset'), 0), 'OFF');
  eq(valueText(key('global', 0, 'tempo'), 1201), '120');
  eq(valueText(key('global', 0, 'tempo'), 995), '99.5');
  eq(valueText(key('global', 0, 'swingType'), 2), '8TH');
  eq(valueText(key('converter', 0, 'arpAdd'), null), null, 'commands have no value');
  for (const v of [0, 3000, 16383]) assert(valueText(key('output', 0, 'lfoSpeed'), v).length <= 4);
});

test('a setting’s value in the preset, and the CC that stands for it', () => {
  const { preset } = examplePatch();
  const p = preset.values;
  eq(valueOf(p, key('euclid', 0, 'pulses')), p.euclid[0].pulses);
  eq(valueOf(p, key('global', 0, 'tempo')), p.tempo);
  eq(valueOf(p, key('drumLane', 2, 'rate')), p.drumSequencer[0].lane[2].rate);
  eq(pathOf(settingOf(key('noteSequencer', 0, 'position'))), null, 'positions keep no value');
  eq(valueOf(p, key('global', 0, 'displayMode')), null);
  // 0–127 settings go as they are; 14-bit ones as 0–16383, or their top 7 bits on a 7-bit knob
  eq(ccFor(key('converter', 0, 'envAttack'), 40), 40);
  eq(ccFor(key('output', 0, 'directLevel'), 12345, 14), 12345);
  eq(ccFor(key('output', 0, 'directLevel'), 12345, 7), 12345 >> 7);
  eq(fromCc(key('output', 0, 'directLevel'), 96, 7), 96 << 7);
  // scaled ones: an estimate, both ways
  eq(ccFor(key('euclid', 0, 'pulses'), 16), 64);
  eq(fromCc(key('euclid', 0, 'pulses'), 64), 16);
  eq(ccFor(key('converter', 0, 'arpLatch'), 1), 127);
  eq(ccFor(key('global', 0, 'tempo'), 1200), null, 'tempo’s CC range is the config’s (check 18)');
});

test('the messages for the EC4: value texts and knob values', () => {
  eq([...textMessage(1, 2, ['UP', null])], [0xf0, 0x7d, 0x45, 0x43, 0x34, 0x28, 1, 2, 2, 0x55, 0x50, 0x20, 0x20, 0, 0, 0, 0, 0xf7],
    'one knob’s text padded to four characters, the next one removed');
  eq([...textMessage(1, 0, ['1/16−'])].slice(9, 13), [0x31, 0x2f, 0x31, 0x36], 'four characters at most');
  eq([...textMessage(1, 0, ['−5'])].slice(9, 11), [0x20, 0x35], 'what the EC4 can’t show becomes a space');
  eq([...ccBytes({ channel: 1, number: 12, value: 8192 + 5, bits: 14 })], [0xb1, 12, 64, 0xb1, 44, 5], 'MSB, then LSB on CC + 32');
  eq([...ccBytes({ channel: 1, number: 70, value: 99, bits: 7 })], [0xb1, 70, 99]);
});

test('a 14-bit knob’s two CCs make one value', () => {
  const j = new Cc14();
  const hires = (ch, cc) => ch === 1 && cc === 12;
  eq(j.take([0xb1, 12, 64], hires), [], 'the MSB alone is not a value yet');
  eq(j.take([0xb1, 44, 5], hires), [{ channel: 1, cc: 12, value: 8197, bits: 14 }]);
  eq(j.take([0xb1, 70, 9], hires), [{ channel: 1, cc: 70, value: 9, bits: 7 }]);
  eq(j.take([0x91, 60, 100], hires), [], 'notes are not knobs');
});

// a stand-in for Lilypad's Device: answers GET_STATE and SELECT, records what is sent
function fakeDevice(setup, group) {
  const d = new EventTarget();
  d.sent = [];
  d.chain = Promise.resolve();
  d.transport = { send: (bytes) => d.sent.push([...bytes]) };
  d.state = { setup, group };
  d.getState = async () => ({ ...d.state });
  d.select = async (s, g) => {
    d.selected = [s, g];
    d.state = { setup: s, group: g };
    return { ...d.state };
  };
  d.touchEvents = async (on) => (d.touch = on);
  d.close = () => {};
  d.event = (setup2, group2) => {
    d.state = { setup: setup2, group: group2 };
    d.dispatchEvent(new CustomEvent('state', { detail: { setup: setup2, group: group2 } }));
  };
  return d;
}

test('the link acts only on setup 15, and sends only what changed', async () => {
  const d = fakeDevice(15, 3); // setup 16: the MDMM's
  const link = new Ec4Link(d, { fwMajor: 0, fwMinor: 10 });
  const seen = [];
  link.addEventListener('state', (e) => seen.push(e.detail));
  await link.start();
  eq([link.ours, d.touch], [false, true]);
  await link.select(2);
  eq(d.selected, undefined, 'never turns another setup’s EC4 to setup 15');
  await link.show([{ text: 'UP', cc: null }]);
  eq(d.sent, [], 'nothing shown on another setup');
  d.event(SETUP, 0);
  eq(link.ours, true);
  await link.select(2);
  eq(d.selected, [SETUP, 2]);
  const knobs = Array(16).fill(null);
  knobs[0] = { text: 'UP', cc: { channel: 1, number: 70, value: 11, bits: 7 } };
  knobs[3] = { text: '2.50', cc: null };
  await link.show(knobs);
  await d.chain;
  eq(d.sent.length, 2, 'the knob’s CC and one TEXT for knobs 1–4');
  eq(d.sent[0], [0xb1, 70, 11]);
  eq(d.sent[1].slice(5, 9), [0x28, 1, 0, 4]);
  await link.show(knobs);
  await d.chain;
  eq(d.sent.length, 2, 'the same again sends nothing');
  d.event(SETUP, 1);
  await link.show(knobs);
  await d.chain;
  eq(d.sent.length, 4, 'a new page: everything again (the EC4 dropped its texts)');
  const old = new Ec4Link(fakeDevice(SETUP, 0), { fwMajor: 0, fwMinor: 9 });
  await old.start();
  await old.show(knobs);
  eq(old.device.sent.map((m) => m[0]), [0xb1], 'before controlfrog 0.10: the CC, no texts');
  eq(seen.map((s) => s.setup), [15, SETUP, SETUP, SETUP]);
});
