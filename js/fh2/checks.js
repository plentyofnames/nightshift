// Hardware checks that answer questions from docs/build-plan.md ("What has to be tested on
// hardware") on the real FH-2. Each reads the FH-2 first, installs a test config (and preset)
// into its RAM, sends CCs or program changes, reads the FH-2 back after each, and then puts the
// config and preset it found back. Nothing is saved to flash. No DOM here: checks.html runs them.
//
// `rig` is { client (an Fh2 on the FH-2's port), send(bytes) (MIDI to the FH-2), log(text),
// wait(ms), hardware, ask(question, answers) (resolves to the answer you pick), heard() (the CCs
// that came in on the FH-2's port since the last call) }. Every check resolves to { summary, lines }.

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

// Puts back what the FH-2 held before the check: always called, also after a failure. With
// `preset: false` the preset stays as the check left it (a scene reloaded from flash).
async function restore(rig, start, { preset = true } = {}) {
  rig.log(preset ? 'Putting your config and preset back…' : 'Putting your config back…');
  await install(rig, start.config, start.original.config, 'your config');
  if (preset) await install(rig, start.preset, start.original.preset, 'your preset');
  rig.log(preset ? 'Done: the FH-2 holds what it held before.' : 'Done: the FH-2 holds your config and the scene as saved.');
}

async function read(rig, path) {
  return getPath((await rig.client.pullPreset()).values, path);
}

async function run(rig, body, options) {
  const start = await begin(rig);
  try {
    return await body(start);
  } finally {
    await restore(rig, start, options);
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
  // the shift register's, with the FH-2's own names for them read off its screen (it shows the
  // shift register a CC just changed)
  { name: 'Random 16 direction', t: { kind: 'srr', index: 15, param: 'direction' }, path: ['srr', 15, 'direction'], range: [0, 2], screen: true },
  { name: 'Random 16 length', t: { kind: 'srr', index: 15, param: 'length' }, path: ['srr', 15, 'length'], range: [1, 32] },
  { name: 'Random 16 scale', t: { kind: 'srr', index: 15, param: 'scale' }, path: ['srr', 15, 'scale'], range: [0, 18], screen: true },
  { name: 'Random 16 key', t: { kind: 'srr', index: 15, param: 'key' }, path: ['srr', 15, 'key'], range: [0, 24], screen: true },
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
      const shown = new Map(); // stored value → the screen's top lines, where the FH-2 shows it
      for (const v of SCALE_CCS) {
        rig.send(cc(channel, 70 + k, v));
        await rig.wait(CC_MS);
        const got = await read(rig, s.path);
        samples.push([v, got]);
        if (s.screen && rig.client.screenText && !shown.has(got)) {
          shown.set(got, (await rig.client.screenText()).lines.slice(0, 3).map((l) => l.trim()).filter(Boolean).join(' / '));
        }
      }
      const fit = fitScaling(samples, s.range);
      fits.push(fit.rule);
      rig.log(`${s.name}: ${samples.map(([c, v]) => `${c}→${v}`).join(' ')}`);
      lines.push(`${s.name} (${s.range[0]}–${s.range[1]}): ${fit.rule ?? `none fits; nearest ${fit.best}, ${fit.misses} off`} · ${samples.map(([c, v]) => `${c}→${v}`).join(', ')}`);
      if (shown.size) lines.push(`${s.name} on the FH-2's screen: ${[...shown].map(([v, t]) => `${v}: ${t || '(nothing)'}`).join('; ')}`);
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

// ---- checks 3 and 25: does the EC4 follow a scene change? You turn a knob on the EC4 first, so
// the FH-2 differs from the scene; the check then reloads the scene the FH-2 is in by program
// change on USB C, as Logic would, sees the values go back, and asks whether the EC4's knob went
// back too. Which way it could have heard of it depends on the FH-2's settings, set before the run.
// The FH-2 keeps the scene as saved afterwards (only your turn is gone), so the EC4 stays in step.

export function sceneReload(rig, scenes, question) {
  return run(rig, async (start) => {
    const ch = start.config.values.presetProgramChannel; // 0 off, else 1–16
    if (!ch) throw new Error('scenes by program change are off: set a channel on the Scenes tab');
    const name = start.preset.values.name.trim();
    const s = scenes.find((x) => x.slot && x.name?.trim() === name);
    if (!s) throw new Error(`the FH-2 holds “${name}”, which is none of your saved scenes: Save all first`);
    rig.heard?.();
    rig.send([0xc0 | (ch - 1), s.slot - 1]);
    await rig.wait(PC_MS);
    const ccs = rig.heard?.() ?? null;
    const now = (await rig.client.pullPreset()).values;
    const back = diff(DUMPS[CMD.INSTALL_PRESET].layout, start.original.preset, now).length;
    rig.log(`program change ${s.slot - 1} on ch ${ch} → “${now.name.trim()}”, ${back} value${back === 1 ? '' : 's'} back to the scene’s`);
    const lines = [`program change ${s.slot - 1} on ch ${ch}: “${now.name.trim()}” reloaded, ${back} value${back === 1 ? '' : 's'} back to the scene’s`];
    if (ccs) lines.push(ccs.length ? `the FH-2 sent ${ccs.length} CC${ccs.length === 1 ? '' : 's'} to USB C (ch ${[...new Set(ccs.map((c) => (c[0] & 15) + 1))].join(', ')})` : 'the FH-2 sent no CCs to USB C');
    if (!back) return { summary: 'Nothing differed from the scene: turn a knob on the EC4 first', lines };
    const answer = await rig.ask(question, ['Went back', 'After Func + Group', 'Stayed']);
    return { summary: `EC4: ${answer.toLowerCase()}`, lines };
  }, { preset: false });
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

// ---- steps, day one (build plan, the step editor): how a note sequencer's step becomes a note,
// and what a sequencer bank dump holds.

// The test sequence, on note sequencer 4: steps 1–16 go through the 16 degrees at octave 3, steps
// 17–24 through the 8 octaves at degree 0, steps 25–32 stay at degree 0, octave 3 (to find the
// start); root 0, 1/16, one gate per step.
export const STEP_SEQ = 3;
export function stepTestPreset(preset) {
  const values = structuredClone(preset);
  const q = values.noteSequencer[STEP_SEQ];
  q.step.forEach((s, k) => Object.assign(s, { degree: k < 16 ? k : 0, octave: k < 16 ? 3 : k < 24 ? k - 16 : 3,
    length: 0, ratchet: 0, reset: 0, gatesLow: 1, gatesHigh: 0, skip: 0, mute: 0 }));
  Object.assign(q, { start: 0, end: 31, rate: 6, gateLength: 64, reset: 0, rootNote: 0, direction: 0, permutation: 0 });
  values[`noteSequencerActive${STEP_SEQ}`] = 1;
  values[`noteSequencerMute${STEP_SEQ}`] = 0;
  return values;
}
// The test config: that sequencer alone sends to USB C (the Mac), on `channel`, and nowhere else.
export function stepTestConfig(config, channel) {
  const values = structuredClone(config);
  const off = (x) => Object.assign(x, { toUsbC: 0 });
  values.noteSequencer.forEach(off);
  values.drumSequencer.forEach(off);
  values.srr.forEach(off);
  values.cvMidi.forEach(off);
  Object.assign(values.noteSequencer[STEP_SEQ], { channel, toInternal: 0, toUsbA: 0, toUsbC: 1, toDin: 0, toSelect: 0 });
  return values;
}

// From the notes heard (note numbers in order), one pass of the test sequence: the 32 in a row whose
// last 8 are the same note as their 1st and 20th (degree 0, octave 3). { base (that note), degree:
// 16 offsets from it, octave: 8 offsets } or null. Failing that, a pass from step 1 cut short (the
// clock stopped early, as in your first run): at least 17 notes, the ones after the 16th whole
// octaves from the first; then `partial`, and only the octaves heard.
export function stepNotes(notes) {
  for (let i = 0; i + 32 <= notes.length; i++) {
    const w = notes.slice(i, i + 32);
    const base = w[24];
    if (w.slice(24).every((n) => n === base) && w[0] === base && w[19] === base && w.slice(16, 24).some((n) => n !== base)) {
      return { base, degree: w.slice(0, 16).map((n) => n - base), octave: w.slice(16, 24).map((n) => n - base) };
    }
  }
  const base = notes[0];
  const octaves = notes.slice(16, 24);
  if (notes.length >= 17 && octaves.every((n) => (n - base) % 12 === 0) && (notes.length < 20 || notes[19] === base)) {
    return { base, degree: notes.slice(0, 16).map((n) => n - base), octave: octaves.map((n) => n - base), partial: true };
  }
  return null;
}

export function checkSteps(rig) {
  return run(rig, async (start) => {
    const channel = testChannel(start.config.values);
    await install(rig, start.config, stepTestConfig(start.config.values, channel), `a test config (note sequencer ${STEP_SEQ + 1} to USB C, ch ${channel + 1})`);
    await install(rig, start.preset, stepTestPreset(start.preset.values), 'a test sequence');
    rig.notes();
    await rig.ask('Start the clock (Logic, or the FH-2’s own) and let it run for about 4 bars, then stop it.', ['Done']);
    const heard = rig.notes().filter((m) => (m[0] & 15) === channel).map((m) => m[1]);
    rig.log(`${heard.length} notes on ch ${channel + 1}`);
    const r = stepNotes(heard);
    if (!r) return { summary: heard.length ? 'No whole pass of the test sequence: let it run longer' : 'No notes came: did the clock run?', lines: [`heard: ${heard.slice(0, 40).join(' ')}`] };
    const lines = [`degree 0, octave 3, root 0: note ${r.base}`,
      `degrees 0–15 (semitones from degree 0): ${r.degree.join(' ')}`,
      `octaves ${r.partial ? `0–${r.octave.length - 1}` : '0–7'} (semitones from octave 3): ${r.octave.join(' ')}`];
    if (r.partial) lines.push('from one pass cut short, taken to start at step 1');
    return { summary: `Degrees: ${r.degree.join(' ')} · octave 3 = note ${r.base}`, lines };
  });
}

// The banks: how long each dump is, the active one and bank 1 (read only).
export async function checkBanks(rig) {
  const lines = [];
  for (const [what, get] of [['note sequencer bank', (i) => rig.client.sequencerBank(i)], ['drum sequencer bank', (i) => rig.client.drumBank(i)]]) {
    for (const i of [0, 1]) {
      const m = await get(i);
      const head = [...m.slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
      rig.log(`${what} ${i || 'active'}: ${m.length} bytes`);
      lines.push(`${what} ${i ? i : '(active)'}: ${m.length} bytes, starting ${head}`);
    }
  }
  return { summary: lines.map((l) => l.split(',')[0]).join(' · '), lines };
}

// ---- what a bank holds (S3 note, S4 drum): a known sequence saved into two slots on the Launchpad,
// the bank read before and after each save. The active bank is put back at the end, the slots too.

// A note sequence whose fields all differ, to find each in the bank: steps through the degrees,
// octaves, lengths and mutes, ratchet on every other, gates off/on/tie in turn, a skip on 30, a
// reset on 31; first 3, last 30, rate 12, gate 77, reset 5, root 3, direction 2, permutation 1.
export function bankTestSequence(preset, j = 0) {
  const values = structuredClone(preset);
  const q = values.noteSequencer[j];
  q.step.forEach((s, k) => {
    const gates = Array.from({ length: 8 }, (_, n) => (k + n) % 3);
    Object.assign(s, { degree: k % 16, octave: k % 8, length: k % 8, ratchet: k % 2, reset: k === 30 ? 1 : 0, skip: k === 29 ? 1 : 0, mute: k % 8,
      gatesLow: gates.slice(0, 7).reduce((v, g, n) => v | (g << (2 * n)), 0), gatesHigh: gates[7] });
  });
  Object.assign(q, { start: 2, end: 29, rate: 12, gateLength: 77, reset: 5, rootNote: 3, direction: 2, permutation: 1 });
  return values;
}
// A drum sequence likewise: lane i has steps k on where (k + i) % 3 > 0, accented where (k + i) % 5 === 0
// (and on); lane i's first i, last 31 − i, rate 6 + i, reset i + 1, lanes 3 and 6 muted; reset 9.
export function bankTestDrums(preset) {
  const values = structuredClone(preset);
  const d = values.drumSequencer[0];
  d.lane.forEach((l, i) => {
    const on = (k) => (k + i) % 3 > 0;
    const acc = (k) => on(k) && (k + i) % 5 === 0;
    for (let m = 0; m < 4; m++) {
      const nib = (f, from) => [0, 1, 2, 3].reduce((v, n) => v | (f(m * 8 + from + n) ? 1 << n : 0), 0);
      l.hitsLow[m].value = nib(on, 0);
      l.hitsHigh[m].value = nib(on, 4);
      l.accentsLow[m].value = nib(acc, 0);
      l.accentsHigh[m].value = nib(acc, 4);
    }
    Object.assign(l, { start: i, end: 31 - i, rate: 6 + i, reset: i + 1, mute: i === 3 || i === 6 ? 1 : 0 });
  });
  d.reset = 9;
  return values;
}

// Where two bank messages differ: [{ from, to }] runs of changed byte offsets.
export function changedRuns(a, b) {
  const runs = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    const last = runs.at(-1);
    if (last && i - last.to <= 4) last.to = i; // short gaps belong to the same run
    else runs.push({ from: i, to: i });
  }
  return runs;
}
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');

function bankCheck(rig, { read, preset, what, where }) {
  return run(rig, async (start) => {
    const before = await read();
    try {
      await install(rig, start.preset, preset(start.preset.values), `a test ${what}`);
      await rig.ask(`On the Launchpad: ${where}, and press the first slot (top left). Then Done.`, ['Done']);
      const one = await read();
      await rig.ask('The same into the slot right of it. Then Done.', ['Done']);
      const two = await read();
      const r1 = changedRuns(before, one);
      const r2 = changedRuns(one, two);
      const span = (r) => (r.length ? `${r[0].from}–${r.at(-1).to} (${r.reduce((n, x) => n + x.to - x.from + 1, 0)} bytes in ${r.length} runs)` : 'nothing');
      const lines = [`message: ${before.length} bytes, header ${hex(before.slice(0, 10))}`,
        `first save changed bytes ${span(r1)}`, `second save changed bytes ${span(r2)}`];
      if (r1.length && r2.length) lines.push(`second slot starts ${r2[0].from - r1[0].from} bytes after the first`);
      if (r1.length) lines.push(`first slot as saved, from byte ${r1[0].from}: ${hex(one.slice(r1[0].from, Math.min(r1.at(-1).to + 1, r1[0].from + 400)))}`);
      return { summary: r1.length ? `A slot: bytes ${span(r1)}; the next ${r2.length ? `${r2[0].from - r1[0].from} bytes on` : 'unchanged'}` : 'Nothing changed: was it saved into the active bank?', lines };
    } finally {
      rig.log('Putting your bank back…');
      await rig.client.installBank(before);
      await rig.wait(SETTLE_MS);
    }
  });
}

export const checkNoteBank = (rig) => bankCheck(rig, { read: () => rig.client.sequencerBank(0), preset: (p) => bankTestSequence(p, 0), what: 'note sequence on note sequencer 1',
  where: 'note sequencer 1, Settings view (9/4): hold Save (2/9, red)' });
export const checkDrumBank = (rig) => bankCheck(rig, { read: () => rig.client.drumBank(0), preset: bankTestDrums, what: 'drum sequence',
  where: 'the drum sequencer’s overview: hold Save (6/9, red)' });

// ---- how sequences play (S5, S6): the four note sequencers at once, each to the Mac (USB C) on a
// channel of its own (13–16), nothing else sent there; one clock run each.

const PLAY_CHANNELS = [12, 13, 14, 15];
function playConfig(config) {
  const values = structuredClone(config);
  const off = (x) => Object.assign(x, { toUsbC: 0 });
  [values.noteSequencer, values.drumSequencer, values.srr, values.cvMidi].forEach((list) => list.forEach(off));
  values.noteSequencer.forEach((q, j) => Object.assign(q, { channel: PLAY_CHANNELS[j], toInternal: 0, toUsbA: 0, toUsbC: 1, toDin: 0, toSelect: 0 }));
  return values;
}
// `specs[j]`: { seq (its settings), step(k) (each step's fields) } for sequencer j. Unset steps are silent.
export function playPreset(preset, specs) {
  const values = structuredClone(preset);
  specs.forEach((sp, j) => {
    const q = values.noteSequencer[j];
    q.step.forEach((s, k) => Object.assign(s, { degree: 0, octave: 3, length: 0, ratchet: 0, reset: 0, gatesLow: 0, gatesHigh: 0, skip: 0, mute: 0 }, sp.step(k)));
    Object.assign(q, { start: 0, end: 7, rate: 6, gateLength: 64, reset: 0, rootNote: 0, direction: 0, permutation: 0 }, sp.seq);
    values[`noteSequencerActive${j}`] = 1;
    values[`noteSequencerMute${j}`] = 0;
  });
  return values;
}
const scale8 = (k) => (k < 8 ? { degree: k, gatesLow: 1 } : {}); // steps 1–8: C D E F G A B C, one gate each

// The step orders the manual names, for 8 steps (0-based), as one repeating cycle each.
export const ORDERS = {
  Forwards: [0, 1, 2, 3, 4, 5, 6, 7], Reverse: [7, 6, 5, 4, 3, 2, 1, 0], Alt: [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1],
  Alt2: [0, 1, 2, 3, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1, 0], 'Odd/Even': [0, 2, 4, 6, 1, 3, 5, 7], Halves: [0, 4, 1, 5, 2, 6, 3, 7], Inwards: [0, 7, 1, 6, 2, 5, 3, 4],
};
// The steps heard (as 0–7, by each note's rank among the notes heard), and the order they follow:
// a name of ORDERS, 'random' (every step, in no fixed order), or null.
export function orderOf(notes) {
  const ranks = [...new Set(notes)].sort((a, b) => a - b);
  const steps = notes.map((n) => ranks.indexOf(n));
  const fits = (cycle) => cycle.some((_, at) => steps.every((s, i) => s === cycle[(at + i) % cycle.length]));
  const name = steps.length >= 10 ? Object.keys(ORDERS).find((k) => fits(ORDERS[k])) : null;
  return { steps, lowest: ranks[0], spread: ranks.map((n) => n - ranks[0]), order: name ?? (ranks.length === 8 && steps.length >= 24 ? 'random' : null) };
}

// Installs the test sequences and runs them. A value the FH-2 keeps otherwise (out of its range)
// doesn't stop the run: what it holds is handed back (`held`, the sequencers' settings as read
// after the install), to be reported. { heard (per sequencer: note-ons { note, t }), offs (note-offs
// alike), held }.
async function playRun(rig, start, specs, seconds) {
  await install(rig, start.config, playConfig(start.config.values), 'a test config (the note sequencers to USB C, ch 13–16)');
  const values = playPreset(start.preset.values, specs);
  rig.log('Installing four test sequences into the FH-2’s RAM…');
  await rig.client.install(start.preset, values);
  await rig.wait(SETTLE_MS);
  // read back, once more after a pause should it not answer at once; your FH-2 didn't answer at all
  // with the test sequences in (2026-11-06; it did again once your preset was back), so then the run
  // goes on without it: the notes are what count
  let now = null;
  for (const pause of [0, 3000]) {
    try {
      await rig.wait(pause);
      now = await rig.client.pullPreset();
      break;
    } catch {
      rig.log(pause ? 'Still no answer: going on without reading them back.' : 'No answer yet; asking again…');
    }
  }
  if (now) {
    const off = diff(DUMPS[CMD.INSTALL_PRESET].layout, values, now.values);
    if (off.length) rig.log(`the FH-2 keeps something else for ${off.map((x) => x.path.join('.')).join(', ')}`);
  }
  const held = (now ?? { values }).values.noteSequencer;
  // notes already on their way: the clock was running before it was asked for
  const early = rig.notes().length;
  rig.offs?.();
  await rig.ask(`Start the clock and let it run for about ${seconds} s, then stop it.`, ['Done']);
  const ons = rig.notes();
  const offs = rig.offs?.() ?? [];
  rig.log(`${ons.length} notes`);
  const by = (list) => PLAY_CHANNELS.map((ch) => list.filter((m) => (m[0] & 15) === ch).map((m) => ({ note: m[1], t: m[3] ?? 0 })));
  const about = `${now ? 'read back after the install' : 'not read back: the FH-2 didn’t answer'}; ${early} notes before the clock was asked for`;
  return { heard: by(ons), offs: by(offs), held, about };
}

// S5: the root (sequencers 1–3 at roots 2, 7 and 11, within the octave the Launchpad's keys set:
// with 19 and 60 your FH-2 stopped answering), the directions 1–3 (on those same three), and how
// often each mute level mutes (sequencer 4: steps 1–8 at mute 0–7, fast).
export const PLAY_ROOTS = [2, 7, 11];
export function checkPlay(rig) {
  return run(rig, async (start) => {
    const roots = PLAY_ROOTS;
    const specs = [...roots.map((r, j) => ({ seq: { rootNote: r, direction: j + 1 }, step: scale8 })),
      { seq: { rate: 2 }, step: (k) => (k < 8 ? { degree: k, gatesLow: 1, mute: k } : {}) }];
    const { heard, held, about } = await playRun(rig, start, specs, 30);
    const orders = roots.map((r, j) => orderOf(heard[j].map((x) => x.note)));
    const lines = roots.map((r, j) => {
      const o = orders[j];
      const kept = held[j].rootNote === r && held[j].direction === j + 1 ? '' : ` (the FH-2 keeps root ${held[j].rootNote}, direction ${held[j].direction})`;
      return heard[j].length ? `direction ${j + 1}, root ${r}${kept}: lowest note ${o.lowest} (root 0 gives 48), notes ${o.spread.join(' ')} above it, order ${o.order ?? `unclear (${o.steps.slice(0, 20).join(' ')})`}`
        : `direction ${j + 1}, root ${r}${kept}: no notes`;
    });
    const m = orderOf(heard[3].map((x) => x.note));
    const passes = m.steps.filter((s) => s === 0).length;
    const muted = [1, 2, 3, 4, 5, 6, 7].map((k) => (passes ? Math.round(100 * (1 - m.steps.filter((s) => s === k).length / passes)) : null));
    lines.push(passes ? `mute 1–7 over ${passes} passes, % of passes muted: ${muted.join(' ')}` : 'mutes: no notes');
    lines.push(`notes per sequencer: ${heard.map((x) => x.length).join(', ')}`, `test sequences ${about}`);
    const summary = `Directions 1–3: ${orders.map((o) => o.order ?? '?').join(', ')} · roots ${roots.join(', ')} (kept as ${held.slice(0, 3).map((q) => q.rootNote).join(', ')}) → +${orders.map((o) => (o.lowest == null ? '?' : o.lowest - 48)).join(', +')}`
      + (passes ? ` · mutes 1–7: ${muted.join(' ')} %` : '');
    return { summary: heard.some((x) => x.length) ? summary : 'No notes came: did the clock run?', lines };
  });
}

// S6: the permutations 1–3 (sequencers 1–3), and the rhythm (sequencer 4, a short gate so ratchets
// can't run into each other; note-ons and note-offs timed): A 4 sub-steps, B the same with ratchet,
// C 2 with ratchet, D on then tie, E one. (Your first run: a tie plays its note too; B, at gate 64,
// sent one note.)
export const RHYTHM = [{ degree: 0, length: 3, gatesLow: 85 }, { degree: 1, length: 3, ratchet: 1, gatesLow: 85 }, { degree: 2, length: 1, ratchet: 1, gatesLow: 5 },
  { degree: 3, length: 1, gatesLow: 9 }, { degree: 4, gatesLow: 1 }];
// One pass of the rhythm, from its first A to the next: "A 0 /A 20 A 125 …" (/ a note-off, ms from A).
export function rhythmPass(ons, offs) {
  const names = 'ABCDE';
  const ranks = [...new Set(ons.map((x) => x.note))].sort((a, b) => a - b);
  const events = [...ons.map((x) => ({ ...x, on: true })), ...offs.map((x) => ({ ...x, on: false }))].sort((a, b) => a.t - b.t);
  const first = events.findIndex((e) => e.on && ranks.indexOf(e.note) === 0);
  if (first < 0) return null;
  const t0 = events[first].t;
  const out = [];
  for (const e of events.slice(first)) {
    const n = names[ranks.indexOf(e.note)] ?? '?';
    if (e.on && n === 'A' && out.length && out.some((x) => x.startsWith('E'))) break; // the next pass
    out.push(`${e.on ? '' : '/'}${n} ${Math.round(e.t - t0)}`);
  }
  return out.join(' ');
}
export function checkOrders(rig) {
  return run(rig, async (start) => {
    const specs = [1, 2, 3].map((p) => ({ seq: { permutation: p }, step: scale8 }));
    specs.push({ seq: { end: RHYTHM.length - 1, gateLength: 16 }, step: (k) => RHYTHM[k] ?? {} });
    const { heard, offs, about } = await playRun(rig, start, specs, 15);
    const lines = [1, 2, 3].map((p, j) => {
      const o = orderOf(heard[j].map((x) => x.note));
      return heard[j].length ? `permutation ${p}: ${o.order ?? `unclear (${o.steps.slice(0, 20).join(' ')})`}` : `permutation ${p}: no notes`;
    });
    const pass = heard[3].length ? rhythmPass(heard[3], offs[3]) : null;
    lines.push(pass ? `rhythm (A 4 sub-steps, B 4 with ratchet, C 2 with ratchet, D on then tie, E one; ms from A, / a note-off): ${pass}` : 'rhythm: no notes', `test sequences ${about}`);
    return { summary: heard.some((x) => x.length) ? `Permutations 1–3: ${lines.slice(0, 3).map((l) => l.split(': ')[1]).join(', ')}` : 'No notes came: did the clock run?', lines };
  });
}
