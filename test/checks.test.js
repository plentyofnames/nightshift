// Tests for the hardware checks (js/fh2/checks.js): fitting a CC scaling rule, the test configs,
// and a whole check run against a stand-in FH-2 that puts back what it found.

import { test, assert, eq } from './harness.js';
import { examplePatch } from '../js/patch/example.js';
import { DUMPS, CMD } from '../js/fh2/sysex.js';
import { diff, getPath, setPath } from '../js/fh2/layout.js';
import { mappingsOf } from '../js/patch/mappings.js';
import { parseScl, parseKbm } from '../js/patch/scala.js';
import { EXAMPLE_HARDWARE, DEFAULT_HARDWARE } from '../js/patch/hardware.js';
import { fitScaling, withMapping, testChannel, hiddenOutput, check19, sceneReload, SCALED_SETTINGS, checksBusy, CHECKS_BUSY_KEY, stepNotes, checkSteps, STEP_SEQ, ORDERS, orderOf, changedRuns, bankTestSequence, bankTestDrums, checkNoteBank, checkPlay, checkOrders, checkTuning, TUNING_CASES, TEST_SCL, checkTuningSlots, SCL_12TET, KBM_12, SLOT_CASES } from '../js/fh2/checks.js';

test('which rule a CC scaling follows', () => {
  const round = [0, 1, 2, 4, 64, 127].map((c) => [c, Math.round((c * 32) / 127)]);
  eq(fitScaling(round, [0, 32]).rule, 'linear, rounded');
  const asIs = [0, 1, 2, 31, 32, 64, 127].map((c) => [c, Math.min(32, c)]);
  eq(fitScaling(asIs, [0, 32]).rule, 'as it is');
  const bands = [0, 2, 4, 64, 97, 127].map((c) => [c, Math.floor((c * 33) / 128)]); // CC 2: 0 in bands, 1 rounded; CC 97: 25, rounded down 24
  eq(fitScaling(bands, [0, 32]).rule, 'even bands of 128');
  eq(fitScaling([[0, 5], [127, 5]], [0, 1]).rule, null, 'nothing fits');
});

test('test configs: a free channel, an extra mapping, a jack outside the rack, the busy mark', () => {
  const { config } = examplePatch();
  const ch = testChannel(config.values);
  assert(!mappingsOf(config.values).some((m) => m.channel === ch), 'no mapping on the test channel');
  const values = withMapping(config.values, { kind: 'euclid', index: 15, param: 'pulses' }, { channel: ch, cc: 70 });
  const added = mappingsOf(values).filter((m) => m.channel === ch);
  eq(added.map((m) => [m.cc, m.target.kind, m.target.index, m.target.param, m.relative]), [[70, 'euclid', 15, 'pulses', false]]);
  eq(mappingsOf(config.values).length + 1, mappingsOf(values).length, 'the original is left as it was');
  eq(hiddenOutput(DEFAULT_HARDWARE), 63, 'your rack: CV7·8 is not there');
  assert(hiddenOutput(EXAMPLE_HARDWARE) >= 24, 'with two CV expanders, one past them');
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null };
  eq(checksBusy(storage), false);
  store.set(CHECKS_BUSY_KEY, String(Date.now()));
  eq(checksBusy(storage), true, 'a fresh mark: Night Shift waits');
  store.set(CHECKS_BUSY_KEY, String(Date.now() - 10000));
  eq(checksBusy(storage), false, 'a stale one (the page was closed mid-check): not');
});

// A stand-in FH-2 for a check run: holds a config and a preset, takes installs, and answers the
// test CCs of check 19 with linear rounding.
function standIn() {
  const { config, preset } = examplePatch();
  const fh2 = { config: structuredClone(config.values), preset: structuredClone(preset.values), installs: [] };
  const client = {
    pullConfig: async () => ({ ...config, values: structuredClone(fh2.config) }),
    pullPreset: async () => ({ ...preset, values: structuredClone(fh2.preset) }),
    install: async (dump, values) => {
      fh2.installs.push(dump.kind);
      fh2[dump.kind] = structuredClone(values);
    },
    verifyInstall: async (dump, values) => diff(DUMPS[dump.cmd].layout, values, fh2[dump.kind]),
  };
  const slots = {}; // flash slot → preset values, for program changes (N loads slot N + 1)
  const send = (bytes) => {
    if ((bytes[0] & 0xf0) === 0xc0 && slots[bytes[1] + 1]) fh2.preset = structuredClone(slots[bytes[1] + 1]);
    const s = SCALED_SETTINGS[bytes[1] - 70];
    if ((bytes[0] & 0xf0) !== 0xb0 || !s) return;
    const [lo, hi] = s.range;
    setPath(fh2.preset, s.path, lo + Math.round((bytes[2] * (hi - lo)) / 127));
  };
  return { fh2, slots, original: { config: structuredClone(config.values), preset: structuredClone(preset.values) },
    rig: { client, send, log: () => {}, wait: async () => {}, hardware: DEFAULT_HARDWARE, ask: async (q, answers) => answers[0] } };
}

test('a check run measures, then puts the config and preset back', async () => {
  const { fh2, original, rig } = standIn();
  const r = await check19(rig);
  eq(r.summary, 'Every setting: linear, rounded');
  eq(r.lines.length, SCALED_SETTINGS.length);
  eq(fh2.installs, ['config', 'config', 'preset'], 'the test config, then yours and your preset back');
  eq(diff(DUMPS[CMD.INSTALL_CONFIG].layout, original.config, fh2.config).length, 0, 'config as before');
  eq(diff(DUMPS[CMD.INSTALL_PRESET].layout, original.preset, fh2.preset).length, 0, 'preset as before');
  eq(getPath(fh2.preset, ['swingType']), original.preset.swingType);
  // a failure halfway still puts everything back
  const b = standIn();
  let calls = 0;
  const pull = b.rig.client.pullPreset;
  b.rig.client.pullPreset = async () => {
    if (++calls === 5) throw new Error('no reply');
    return pull();
  };
  let failed = false;
  try {
    await check19(b.rig);
  } catch {
    failed = true;
  }
  assert(failed, 'the error comes through');
  eq(diff(DUMPS[CMD.INSTALL_CONFIG].layout, b.original.config, b.fh2.config).length, 0, 'config back after a failure');
});

test('a scene reload: your turn goes, your answer, the scene stays as saved', async () => {
  const { fh2, slots, original, rig } = standIn();
  fh2.config.presetProgramChannel = 3;
  slots[4] = structuredClone(original.preset); // the scene as saved in flash slot 4
  setPath(fh2.preset, ['euclid', 0, 'pulses'], (getPath(original.preset, ['euclid', 0, 'pulses']) + 3) % 33); // you turned a knob
  const scenes = [{ name: 'Other', slot: 2 }, { name: original.preset.name, slot: 4 }];
  let asked = '';
  const ccs = [[0xb1, 20, 99]]; // in before the check: not counted
  const send = rig.send;
  rig.send = (bytes) => {
    send(bytes);
    if ((bytes[0] & 0xf0) === 0xc0) ccs.push([0xb1, 20, 64]); // the FH-2's CCs on preset load
  };
  rig.heard = () => ccs.splice(0);
  rig.ask = async (q, answers) => ((asked = q), answers[0]);
  const r = await sceneReload(rig, scenes, 'Back?');
  eq(asked, 'Back?');
  eq(r.summary, 'EC4: went back');
  eq(r.lines, [`program change 3 on ch 3: “${original.preset.name.trim()}” reloaded, 1 value back to the scene’s`, 'the FH-2 sent 1 CC to USB C (ch 2)']);
  eq(diff(DUMPS[CMD.INSTALL_PRESET].layout, original.preset, fh2.preset).length, 0, 'the scene as saved, not your turn');
  eq(fh2.installs, ['config'], 'only the config put back');
  // nothing turned: no question, a hint instead
  const b = standIn();
  b.fh2.config.presetProgramChannel = 3;
  b.slots[4] = structuredClone(b.original.preset);
  b.rig.ask = async () => assert(false, 'not asked');
  eq((await sceneReload(b.rig, scenes, 'Back?')).summary, 'Nothing differed from the scene: turn a knob on the EC4 first');
  // a preset that is none of the scenes: a clear error, before anything is sent
  const c = standIn();
  c.fh2.config.presetProgramChannel = 3;
  let error = '';
  try {
    await sceneReload(c.rig, [{ name: 'Other', slot: 2 }], 'Back?');
  } catch (e) {
    error = e.message;
  }
  assert(error.includes('none of your saved scenes'), error);
});

test('steps into notes: one pass of the test sequence found in what was heard, from anywhere in it', () => {
  const pass = (base, deg, oct) => [...deg.map((d) => base + d), ...oct.map((o) => base + o), ...Array(8).fill(base)];
  const deg = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const oct = [-36, -24, -12, 0, 12, 24, 36, 48];
  const heard = [...pass(48, deg, oct).slice(10), ...pass(48, deg, oct), ...pass(48, deg, oct).slice(0, 5)];
  eq(stepNotes(heard), { base: 48, degree: deg, octave: oct });
  eq(stepNotes(pass(48, deg, oct).slice(3)), null, 'no whole pass, and not from step 1');
  // your first run: steps 1–19, then the clock stopped
  const yours = [48, 50, 52, 53, 55, 57, 59, 60, 49, 51, 53, 54, 56, 58, 60, 61, 12, 24, 36];
  eq(stepNotes(yours), { base: 48, degree: [0, 2, 4, 5, 7, 9, 11, 12, 1, 3, 5, 6, 8, 10, 12, 13], octave: [-36, -24, -12], partial: true });
  eq(stepNotes(yours.slice(0, 12)), null, 'too short');
});

test('the steps check plays the test sequence to USB C only, reads it, and puts everything back', async () => {
  const { fh2, original, rig } = standIn();
  const semis = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24, 26]; // a made-up mapping
  let played = [];
  rig.notes = () => played.splice(0);
  rig.ask = async (q, answers) => {
    const q4 = fh2.preset.noteSequencer[STEP_SEQ];
    const ch = fh2.config.noteSequencer[STEP_SEQ].channel;
    eq([fh2.config.noteSequencer[STEP_SEQ].toUsbC, fh2.config.noteSequencer[STEP_SEQ].toInternal, fh2.config.noteSequencer.filter((x) => x.toUsbC).length], [1, 0, 1], 'only it sends to the Mac');
    const notes = q4.step.map((s) => 12 + 12 * s.octave + semis[s.degree]);
    played = [...notes.slice(20), ...notes, ...notes].map((n) => [0x90 | ch, n, 100]);
    return answers[0];
  };
  const r = await checkSteps(rig);
  eq(r.lines[1], `degrees 0–15 (semitones from degree 0): ${semis.join(' ')}`);
  eq(r.lines[0], 'degree 0, octave 3, root 0: note 48');
  eq(diff(DUMPS[CMD.INSTALL_CONFIG].layout, original.config, fh2.config).length + diff(DUMPS[CMD.INSTALL_PRESET].layout, original.preset, fh2.preset).length, 0, 'all back');
});

test('step orders: each of the manual’s, found from anywhere in it; random when no cycle fits', () => {
  const scale = [48, 50, 52, 53, 55, 57, 59, 60];
  for (const [name, cycle] of Object.entries(ORDERS)) {
    const heard = Array.from({ length: 40 }, (_, i) => scale[cycle[(i + 3) % cycle.length]]);
    eq(orderOf(heard).order, name, name);
  }
  const shuffled = [3, 7, 0, 2, 2, 5, 1, 6, 4, 0, 7, 3, 5, 6, 1, 4, 2, 0, 7, 7, 3, 1, 6, 5, 4, 2].map((k) => scale[k] + 7);
  eq([orderOf(shuffled).order, orderOf(shuffled).lowest, orderOf(shuffled).spread], ['random', 55, [0, 2, 4, 5, 7, 9, 11, 12]]);
});

test('bank test patterns: every field differs, and the runs of changed bytes are found', () => {
  const { preset } = examplePatch();
  const q = bankTestSequence(preset.values).noteSequencer[0];
  eq([q.start, q.end, q.rate, q.gateLength, q.reset, q.rootNote, q.direction, q.permutation], [2, 29, 12, 77, 5, 3, 2, 1]);
  eq([q.step[5].degree, q.step[5].octave, q.step[5].length, q.step[5].ratchet, q.step[5].mute, q.step[30].reset, q.step[29].skip], [5, 5, 5, 1, 5, 1, 1]);
  const d = bankTestDrums(preset.values).drumSequencer[0];
  eq([d.reset, d.lane[3].mute, d.lane[2].start, d.lane[2].end, d.lane[2].rate], [9, 1, 2, 29, 8]);
  const a = new Uint8Array(100);
  const b = Uint8Array.from(a);
  b[10] = 1; b[12] = 2; b[40] = 3; b[41] = 4;
  eq(changedRuns(a, b), [{ from: 10, to: 12 }, { from: 40, to: 41 }]);
});

// A stand-in bank: a save writes the test sequence's start, end and rate into slot n at 300 · n.
function bankRig() {
  const s = standIn();
  let bank = new Uint8Array(8199).fill(0);
  bank.set([0xf0, 0x00, 0x21, 0x27, 0x2f, 0x15, 0x00, 0x01], 0);
  const original = Uint8Array.from(bank);
  let slot = 0;
  s.rig.client.sequencerBank = async () => Uint8Array.from(bank);
  s.rig.client.installBank = async (bytes) => { bank = Uint8Array.from(bytes); };
  s.rig.ask = async (q, answers) => {
    const qq = s.fh2.preset.noteSequencer[0];
    bank.set([qq.start, qq.end, qq.rate], 100 + 300 * slot++);
    return answers[0];
  };
  return { ...s, original, bank: () => bank };
}

test('the note bank check: where each save lands, then your bank back', async () => {
  const b = bankRig();
  const r = await checkNoteBank(b.rig);
  eq(r.lines[1], 'first save changed bytes 100–102 (3 bytes in 1 runs)');
  eq(r.lines[3], 'second slot starts 300 bytes after the first');
  eq(r.lines[4], 'first slot as saved, from byte 100: 02 1d 0c', 'start 2, end 29, rate 12');
  eq([...b.bank()], [...b.original], 'the bank put back');
});

// A stand-in that plays the four test sequences: each step's note by the measured scale, in its order.
function playRig(muteChance = (k) => k / 10) {
  const s = standIn();
  let played = [];
  s.rig.notes = () => played.splice(0);
  const semis = [0, 2, 4, 5, 7, 9, 11, 12, 1, 3, 5, 6, 8, 10, 12, 13];
  const cycles = { 0: ORDERS.Forwards, 1: ORDERS.Reverse, 2: ORDERS.Alt, 3: ORDERS.Alt2 };
  const perms = { 1: ORDERS['Odd/Even'], 2: ORDERS.Halves, 3: ORDERS.Inwards };
  let rand = 1;
  const next = () => ((rand = (rand * 48271) % 2147483647) / 2147483647);
  s.rig.ask = async (q, answers) => {
    let t = 0;
    s.fh2.preset.noteSequencer.forEach((q4, j) => {
      const ch = s.fh2.config.noteSequencer[j].channel;
      const steps = q4.end === 3 ? [0, 1, 2, 3] : q4.permutation ? perms[q4.permutation] : cycles[q4.direction];
      for (let pass = 0; pass < 20; pass++) {
        for (const k of steps) {
          const st = q4.step[k];
          if (st.mute && next() < muteChance(st.mute)) continue;
          const n = 12 * (st.octave + 1) + q4.rootNote + semis[st.degree];
          const subs = st.length + 1;
          for (let g = 0; g < subs; g++) {
            const gate = (st.gatesLow >> (2 * g)) & 3;
            t += st.ratchet ? 125 / subs : 125;
            if (gate === 1) played.push([0x90 | ch, n, 100, t]);
          }
        }
      }
    });
    return answers[0];
  };
  return s;
}

test('S5 against a stand-in: roots add, directions 1–3, mute chances', async () => {
  const { rig, fh2, original } = playRig();
  const r = await checkPlay(rig);
  assert(r.summary.startsWith('Directions 1–3: Reverse, Alt, Alt2 · roots 2, 7, 11 (kept as 2, 7, 11) → +2, +7, +11'), r.summary);
  assert(/mute 1–7 over 20 passes/.test(r.lines[3]), r.lines[3]);
  eq(diff(DUMPS[CMD.INSTALL_PRESET].layout, original.preset, fh2.preset).length, 0, 'your preset back');
});

test('S6 against a stand-in: permutations 1–3, and the rhythm timed', async () => {
  const { rig } = playRig();
  const r = await checkOrders(rig);
  eq(r.summary, 'Permutations 1–3: Odd/Even, Halves, Inwards');
  assert(r.lines[3].endsWith('A 0 A 125 A 250 A 375 B 406 B 438 B 469 B 500 C 563 C 625 D 750 E 1000'), r.lines[3]);
});

test('S5 says what the FH-2 keeps when a value is out of its range, and goes on', async () => {
  const { rig, fh2 } = playRig();
  const install = rig.client.install;
  rig.client.install = async (dump, values) => {
    await install(dump, values);
    if (dump.kind === 'preset') fh2.preset.noteSequencer.forEach((q) => { q.rootNote = Math.min(q.rootNote, 6); }); // as if it took 0–6 only
  };
  const r = await checkPlay(rig);
  assert(r.summary.includes('(kept as 2, 6, 6)'), r.summary);
  assert(r.lines[1].includes('(the FH-2 keeps root 6, direction 2)'), r.lines[1]);
});

test('S5 goes on without the read-back when the FH-2 doesn’t answer with the test sequences in', async () => {
  const { rig } = playRig();
  const pull = rig.client.pullPreset;
  let calls = 0;
  rig.client.pullPreset = async () => {
    calls++;
    if (calls === 2 || calls === 3) throw new Error('no reply to FH-2 command 23H'); // both read-backs, as on your FH-2
    return pull();
  };
  const r = await checkPlay(rig);
  assert(r.summary.startsWith('Directions 1–3: Reverse, Alt, Alt2'), r.summary);
  eq(r.lines.at(-1), 'test sequences not read back: the FH-2 didn’t answer; 0 notes before the clock was asked for');
});

test('S5 asks the FH-2 again when it doesn’t answer at once after the install', async () => {
  const { rig } = playRig();
  const pull = rig.client.pullPreset;
  let calls = 0;
  rig.client.pullPreset = async () => {
    if (++calls === 2) throw new Error('no reply to FH-2 command 23H'); // the read-back right after the test sequences
    return pull();
  };
  const r = await checkPlay(rig);
  assert(r.summary.startsWith('Directions 1–3: Reverse, Alt, Alt2'), r.summary);
});

test('T1: a test voice outside the rack plays a note per tuning choice, the screen read each time', async () => {
  const { rig, fh2, original } = standIn();
  const installed = [];
  rig.client.installScl = async (slot, text) => installed.push(['scl', slot, text.split('\n')[2]]);
  rig.client.installKbm = async (slot) => installed.push(['kbm', slot]);
  const sent = [];
  rig.send = (b) => sent.push(b);
  rig.client.screenText = async () => {
    const c = fh2.preset.converter.find((x) => x.scalaEnable) ?? null;
    return { mode: 0, lines: [c ? `Scala ${c.scalaEnable}` : '12-TET', '', '', ''] };
  };
  const r = await checkTuning(rig);
  eq(installed, [['scl', 32, 'Night Shift test: 5 equal steps per octave'], ['kbm', 32]]);
  eq(r.lines.length, TUNING_CASES.length + 1);
  eq(r.lines[1], 'enable 1, .scl 31, .kbm 31 → 60: Scala 1 · 61: Scala 1');
  eq(sent.filter((b) => (b[0] & 0xf0) === 0x90).length, 2 * TUNING_CASES.length, 'notes 60 and 61 per choice');
  eq(diff(DUMPS[CMD.INSTALL_PRESET].layout, original.preset, fh2.preset).length + diff(DUMPS[CMD.INSTALL_CONFIG].layout, original.config, fh2.config).length, 0, 'config and preset back');
  assert(TEST_SCL.includes(' 5\n'), 'five notes');
});

test('T2: ordinary files in slots 1 and 32, the 5-step one in 2, and what each number reaches', async () => {
  eq([parseScl(SCL_12TET).ok, parseScl(SCL_12TET).count, parseKbm(KBM_12).ok, parseKbm(KBM_12).size], [true, 12, true, 12]);
  const { rig, fh2 } = standIn();
  const slots = { scl: {}, kbm: {} };
  rig.client.installScl = async (slot, text) => { slots.scl[slot] = text; };
  rig.client.installKbm = async (slot, text) => { slots.kbm[slot] = text; };
  rig.send = () => {};
  // as if the numbers counted from 0: number n is slot n + 1
  rig.client.screenText = async () => {
    const c = fh2.preset.converter.find((x) => x.scalaEnable);
    const scl = c && slots.scl[c.scalaScl + 1];
    return { mode: 0, lines: ['', '', `D 61: ${scl === SCL_12TET ? '277.18 Hz' : scl === TEST_SCL ? '300.53 Hz' : 'Scala Error'}`, ''] };
  };
  const r = await checkTuningSlots(rig);
  eq(r.summary, 'Note 61 (12-TET 277.18 Hz, 5-step 300.53 Hz): 0 → 277.18 Hz · 1 → 300.53 Hz · 2 → Scala Error · 31 → 277.18 Hz · 32 → Scala Error');
  eq(Object.keys(slots.scl), ['1', '2', '32']);
  eq(r.lines.length, SLOT_CASES.length + 1);
});
