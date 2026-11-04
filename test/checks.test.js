// Tests for the hardware checks (js/fh2/checks.js): fitting a CC scaling rule, the test configs,
// and a whole check run against a stand-in FH-2 that puts back what it found.

import { test, assert, eq } from './harness.js';
import { examplePatch } from '../js/patch/example.js';
import { DUMPS, CMD } from '../js/fh2/sysex.js';
import { diff, getPath, setPath } from '../js/fh2/layout.js';
import { mappingsOf } from '../js/patch/mappings.js';
import { EXAMPLE_HARDWARE, DEFAULT_HARDWARE } from '../js/patch/hardware.js';
import { fitScaling, withMapping, testChannel, hiddenOutput, check19, sceneReload, SCALED_SETTINGS, checksBusy, CHECKS_BUSY_KEY } from '../js/fh2/checks.js';

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
