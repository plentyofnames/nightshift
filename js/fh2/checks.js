// Hardware checks that answer questions from docs/build-plan.md ("What has to be tested on
// hardware") on the real FH-2. Each reads the FH-2 first, installs a test config (and preset)
// into its RAM, sends CCs or program changes, reads the FH-2 back after each, and then puts the
// config and preset it found back. Nothing is saved to flash. No DOM here: checks.html runs them.
//
// `rig` is { client (an Fh2 on the FH-2's port), send(bytes) (MIDI to the FH-2), log(text),
// wait(ms), hardware, ask(question, answers) (resolves to the answer you pick) }. Every check
// resolves to { summary, lines } for the results.

import { DUMPS, CMD } from './sysex.js';
import { getPath, setPath, diff } from './layout.js';
import { encodeTarget, isUsed, mappingsOf } from '../patch/mappings.js';
import { isPresent } from '../patch/hardware.js';

// While a check runs, checks.html keeps a timestamp here, renewed every second; Night Shift's
// live editing waits while it is fresh, so it doesn't take the test config in or send into it.
export const CHECKS_BUSY_KEY = 'nightshift.checks.busy';
export const checksBusy = (storage) => {
  try {
    return Date.now() - Number(storage.getItem(CHECKS_BUSY_KEY) ?? 0) < 3000;
  } catch {
    return false;
  }
};

const SETTLE_MS = 500; // after an install, as connect.js waits
const CC_MS = 60; // after a CC, before reading what it did
const PC_MS = 600; // after a program change: the FH-2 loads a preset

// ---- test configs

// The channel a check sends on: one no mapping uses (16 if it can), so its CCs reach nothing else.
export function testChannel(config) {
  const used = new Set(mappingsOf(config).map((m) => m.channel));
  for (const ch of [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]) if (!used.has(ch)) return ch;
  return 15;
}

// `config` (values) with CC `cc` on `channel` mapped to setting `t` ({ kind, index, param }) in
// the first free slot. Returns the new values.
export function withMapping(config, t, { channel, cc, relative = false }) {
  const code = encodeTarget(t);
  if (!code) throw new Error(`no mapping can set ${t.kind} ${t.param}`);
  const values = structuredClone(config);
  const slot = values.mapping.findIndex((m) => !isUsed(m));
  if (slot < 0) throw new Error('all 384 mapping slots are in use');
  Object.assign(values.mapping[slot], { status: 0x30 | channel, cc, target: code.target + (relative ? 32 : 0), index: code.index });
  return values;
}

const cc = (channel, n, v) => [0xb0 | channel, n, v];

// ---- the steps every check shares

async function begin(rig) {
  rig.log('Reading the FH-2…');
  const config = await rig.client.pullConfig();
  const preset = await rig.client.pullPreset();
  return { config, preset, original: { config: structuredClone(config.values), preset: structuredClone(preset.values) } };
}

async function install(rig, dump, values, what) {
  rig.log(`Installing ${what} into the FH-2’s RAM…`);
  await rig.client.install(dump, values);
  await rig.wait(SETTLE_MS);
  const off = await rig.client.verifyInstall(dump, values);
  if (off.length) throw new Error(`the FH-2 holds something else for ${off.slice(0, 3).map((x) => x.path.join('.')).join(', ')}`);
}

// Puts back what the FH-2 held before the check: always called, also after a failure.
async function restore(rig, start) {
  rig.log('Putting your config and preset back…');
  await install(rig, start.config, start.original.config, 'your config');
  await install(rig, start.preset, start.original.preset, 'your preset');
  rig.log('Done: the FH-2 holds what it held before.');
}

async function read(rig, path) {
  return getPath((await rig.client.pullPreset()).values, path);
}

async function run(rig, body) {
  const start = await begin(rig);
  try {
    return await body(start);
  } finally {
    await restore(rig, start);
  }
}

// ---- check 19: how a 7-bit CC lands on a setting whose range isn't 0–127

export const SCALED_SETTINGS = [
  { name: 'Euclid 16 pulses', t: { kind: 'euclid', index: 15, param: 'pulses' }, path: ['euclid', 15, 'pulses'], range: [0, 32] },
  { name: 'Euclid 16 steps', t: { kind: 'euclid', index: 15, param: 'steps' }, path: ['euclid', 15, 'steps'], range: [1, 32] },
  { name: 'Euclid 16 rotation', t: { kind: 'euclid', index: 15, param: 'rotation' }, path: ['euclid', 15, 'rotation'], range: [0, 32] },
  { name: 'Euclid 16 reset', t: { kind: 'euclid', index: 15, param: 'reset' }, path: ['euclid', 15, 'reset'], range: [0, 32] },
  { name: 'Voice 16 arp range', t: { kind: 'converter', index: 15, param: 'arpRange' }, path: ['converter', 15, 'arpRange'], range: [1, 3] },
  { name: 'Voice 16 arp latch', t: { kind: 'converter', index: 15, param: 'arpLatch' }, path: ['converter', 15, 'arpLatch'], range: [0, 1] },
  { name: 'Swing type', t: { kind: 'global', index: 0, param: 'swingType' }, path: ['swingType'], range: [0, 7] },
];
const SCALE_CCS = [0, 1, 2, 3, 4, 8, 16, 31, 32, 33, 63, 64, 65, 96, 97, 126, 127]; // 2 and 97 tell the rules apart

// The rules a CC value might be turned into a setting by, and which of them the samples fit.
const RULES = {
  'as it is': (c, [lo, hi]) => Math.max(lo, Math.min(hi, c)),
  'linear, rounded': (c, [lo, hi]) => lo + Math.round((c * (hi - lo)) / 127),
  'linear, rounded down': (c, [lo, hi]) => lo + Math.floor((c * (hi - lo)) / 127),
  'even bands of 128': (c, [lo, hi]) => lo + Math.floor((c * (hi - lo + 1)) / 128),
  'even bands from 0, held at the lowest': (c, [lo, hi]) => Math.max(lo, Math.floor((c * (hi + 1)) / 128)), // Euclid steps (measured)
};
export function fitScaling(samples, range) {
  const misses = Object.entries(RULES).map(([rule, f]) => [rule, samples.filter(([c, v]) => f(c, range) !== v).length]);
  misses.sort((a, b) => a[1] - b[1]);
  return { rule: misses[0][1] === 0 ? misses[0][0] : null, best: misses[0][0], misses: misses[0][1] };
}

export function check19(rig) {
  return run(rig, async (start) => {
    const channel = testChannel(start.config.values);
    let values = start.config.values;
    SCALED_SETTINGS.forEach((s, k) => { values = withMapping(values, s.t, { channel, cc: 70 + k }); });
    await install(rig, start.config, values, `a test config (CCs 70–${69 + SCALED_SETTINGS.length} on ch ${channel + 1})`);
    const lines = [];
    const fits = [];
    for (const [k, s] of SCALED_SETTINGS.entries()) {
      const samples = [];
      for (const v of SCALE_CCS) {
        rig.send(cc(channel, 70 + k, v));
        await rig.wait(CC_MS);
        samples.push([v, await read(rig, s.path)]);
      }
      const fit = fitScaling(samples, s.range);
      fits.push(fit.rule);
      rig.log(`${s.name}: ${samples.map(([c, v]) => `${c}→${v}`).join(' ')}`);
      lines.push(`${s.name} (${s.range[0]}–${s.range[1]}): ${fit.rule ?? `none fits; nearest ${fit.best}, ${fit.misses} off`} · ${samples.map(([c, v]) => `${c}→${v}`).join(', ')}`);
    }
    const all = new Set(fits);
    return { summary: all.size === 1 && fits[0] ? `Every setting: ${fits[0]}` : 'Not one rule for all: see the lines', lines };
  });
}

// ---- check 23: Soft takeover with a 14-bit knob

// An output outside the rack, so what the check does to it can't be heard.
export function hiddenOutput(hardware) {
  for (let o = 63; o >= 8; o--) if (!isPresent(hardware, o)) return o;
  return null;
}

export function check23(rig) {
  return run(rig, async (start) => {
    const o = hiddenOutput(rig.hardware);
    if (o == null) throw new Error('every CV output is in your rack: no jack to test on without hearing it');
    const channel = testChannel(start.config.values);
    let values = withMapping(start.config.values, { kind: 'output', index: o, param: 'directLevel' }, { channel, cc: 20 });
    values = withMapping(values, { kind: 'output', index: o, param: 'smoothing' }, { channel, cc: 70 }); // 7-bit
    values.softTakeover = 1;
    await install(rig, start.config, values, `a test config (Soft takeover on, ch ${channel + 1}: CC 20/52 → output ${o + 1}'s level, CC 70 → its smoothing)`);
    const preset = structuredClone(start.preset.values);
    setPath(preset, ['output', o, 'directLevel'], 8192);
    setPath(preset, ['output', o, 'smoothing'], 64);
    await install(rig, start.preset, preset, 'a test preset (that output’s level at 8192 and smoothing at 64, their middles)');
    const lines = [];
    // a knob far off, then nearer, then across the value: where does the FH-2 start following?
    const series = async (label, values, sendOne, path, middle) => {
      let picked = null;
      for (const v of values) {
        rig.send(sendOne(v));
        await rig.wait(CC_MS);
        const now = await read(rig, path);
        rig.log(`${label} knob ${v} → ${now}`);
        lines.push(`${label} knob at ${v}: ${now}`);
        if (picked == null && now !== middle) picked = v;
      }
      return picked == null ? 'never followed' : picked === values[0] ? 'jumps' : `waits, then follows from ${picked}`;
    };
    const fine = await series('14-bit', [2000, 6000, 8000, 8300, 10000, 3000], (v) => [...cc(channel, 20, v >> 7), ...cc(channel, 52, v & 127)], ['output', o, 'directLevel'], 8192);
    const coarse = await series('7-bit', [10, 40, 60, 66, 90, 20], (v) => cc(channel, 70, v), ['output', o, 'smoothing'], 64);
    return { summary: `With Soft takeover on: a 14-bit knob ${fine}, a 7-bit knob ${coarse}`, lines };
  });
}

// ---- check 18: what tempo each value of the tempo CC means

export function check18(rig) {
  return run(rig, async (start) => {
    const channel = testChannel(start.config.values);
    const values = withMapping(start.config.values, { kind: 'global', index: 0, param: 'tempo' }, { channel, cc: 77 });
    const { tempoMin, tempoMax } = start.config.values;
    await install(rig, start.config, values, `a test config (ch ${channel + 1} CC 77 → tempo)`);
    const lines = [`config tempoMin ${tempoMin}, tempoMax ${tempoMax}`];
    for (const v of [0, 1, 32, 64, 96, 126, 127]) {
      rig.send(cc(channel, 77, v));
      await rig.wait(CC_MS);
      const t = await read(rig, ['tempo']);
      rig.log(`CC ${v} → ${t / 10} BPM`);
      lines.push(`CC ${v}: ${t / 10} BPM`);
    }
    return { summary: `${lines[1].replace('CC 0: ', 'CC 0 → ')} … ${lines.at(-1).replace('CC 127: ', 'CC 127 → ')}`, lines };
  });
}

// ---- checks 3 and 25: does the EC4 follow a scene change? Night Shift sends the program change
// for your second scene on USB C, as Logic would, sees that the FH-2 loaded it, and asks what the
// EC4 did. Which way it could have heard of it depends on the FH-2's settings, set before the run.

export async function sceneSwitch(rig, scenes, question) {
  return run(rig, async (start) => {
    const ch = start.config.values.presetProgramChannel; // 0 off, else 1–16
    if (!ch) throw new Error('scenes by program change are off: set a channel on the Scenes tab');
    const kept = scenes.filter((s) => s.slot && s.name);
    if (kept.length < 2) throw new Error('needs two scenes with slots, saved with Save all');
    const s = kept[1];
    rig.send([0xc0 | (ch - 1), s.slot - 1]);
    await rig.wait(PC_MS);
    const name = (await rig.client.pullPreset()).values.name.trim();
    rig.log(`program change ${s.slot - 1} on ch ${ch} → “${name}”`);
    const lines = [`program change ${s.slot - 1} on ch ${ch}: the FH-2 loaded “${name}”${name === s.name.trim() ? '' : `, not “${s.name.trim()}”`}`];
    const answer = await rig.ask(question(s.name.trim()), ['Followed', 'After Func + Group', 'Didn’t follow']);
    return { summary: `EC4: ${answer.toLowerCase()}`, lines };
  });
}

// ---- check 17: which preset slot a program change loads

// `scenes`: [{ name, slot }] from the project kept in Night Shift (slots 1–30), to compare with.
export function check17(rig, scenes = []) {
  return run(rig, async (start) => {
    const configured = start.config.values.presetProgramChannel; // 0 off, else 1–16
    let channel = configured ? configured - 1 : testChannel(start.config.values);
    if (!configured) {
      const values = structuredClone(start.config.values);
      values.presetProgramChannel = channel + 1;
      await install(rig, start.config, values, `a test config (presets by program change on ch ${channel + 1})`);
    }
    const programs = [...new Set([0, 1, 2, ...scenes.flatMap((s) => (s.slot ? [s.slot - 1, s.slot] : []))])].filter((p) => p >= 0 && p < 128).sort((a, b) => a - b);
    const loaded = [];
    for (const p of programs) {
      rig.send([0xc0 | channel, p]);
      await rig.wait(PC_MS);
      const preset = await rig.client.pullPreset();
      loaded.push({ program: p, name: preset.values.name.trim(), values: preset.values });
      rig.log(`program change ${p} → “${preset.values.name.trim()}”`);
    }
    const lines = loaded.map((l) => `program change ${l.program}: “${l.name}”`);
    let summary = 'See which preset each program change loaded';
    const known = scenes.filter((s) => s.slot && s.name);
    if (known.length) {
      const byName = (p) => loaded.find((l) => l.program === p)?.name;
      const zero = known.filter((s) => byName(s.slot) === s.name.trim()).length;
      const one = known.filter((s) => byName(s.slot - 1) === s.name.trim()).length;
      summary = one > zero ? 'Program change N loads slot N + 1' : zero > one ? 'Program change N loads slot N' : 'Not clear from the names: see the lines';
      const base = one > zero ? -1 : 0;
      for (const s of known) {
        const l = loaded.find((x) => x.program === s.slot + base);
        const same = l && s.values ? diff(DUMPS[CMD.INSTALL_PRESET].layout, s.values, l.values).length : null;
        lines.push(`scene “${s.name.trim()}” in slot ${s.slot}: ${l ? `loads “${l.name}”${same == null ? '' : same === 0 ? ', the same as in Night Shift' : `, ${same} values differ from Night Shift’s`}` : 'not loaded'}`);
      }
    }
    if (!configured) lines.push(`(program changes were off in your config; the test used ch ${channel + 1})`);
    return { summary, lines };
  });
}
