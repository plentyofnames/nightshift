// Tests for the hardware checks (js/fh2/checks.js): fitting a CC scaling rule, the test configs,
// and a whole check run against a stand-in FH-2 that puts back what it found.

import { test, assert, eq } from './harness.js';
import { examplePatch } from '../js/patch/example.js';
import { DUMPS, CMD } from '../js/fh2/sysex.js';
import { diff, getPath, setPath } from '../js/fh2/layout.js';
import { mappingsOf } from '../js/patch/mappings.js';
import { EXAMPLE_HARDWARE, DEFAULT_HARDWARE } from '../js/patch/hardware.js';
import { fitScaling, withMapping, testChannel, hiddenOutput, check19, SCALED_SETTINGS, checksBusy, CHECKS_BUSY_KEY } from '../js/fh2/checks.js';

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
  const send = (bytes) => {
    const s = SCALED_SETTINGS[bytes[1] - 70];
    if ((bytes[0] & 0xf0) !== 0xb0 || !s) return;
    const [lo, hi] = s.range;
    setPath(fh2.preset, s.path, lo + Math.round((bytes[2] * (hi - lo)) / 127));
  };
  return { fh2, original: { config: structuredClone(config.values), preset: structuredClone(preset.values) },
    rig: { client, send, log: () => {}, wait: async () => {}, hardware: DEFAULT_HARDWARE } };
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
