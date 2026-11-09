// Tests for the open findings of the code review of 2026-11-08 (docs/review-2026-11-08.md), fixed
// 2026-11-09: what each finding showed, now the other way round.

import { test, assert, eq } from './harness.js';
import { apply, History, removeSource, voiceChannel, useInput, INPUT_USES, setDirectLevel, setConverter } from '../js/patch/edit.js';
import { freeCcs, freeEuclid } from '../js/patch/alloc.js';
import { validHardware } from '../js/patch/hardware.js';
import { derive } from '../js/patch/derive.js';
import { examplePatch } from '../js/patch/example.js';
import { blankConfig, blankPreset } from '../js/patch/blank.js';
import { remote, parseDump, buildDump, bodyOf, dumpMessage, CMD, message } from '../js/fh2/sysex.js';
import { Fh2 } from '../js/fh2/client.js';
import { pagesOf, pageNameKey } from '../js/ec4/pages.js';
import { bcrPagesOf } from '../js/rotary/pages.js';

const values = (p) => ({ config: p.config.values, preset: p.preset.values });

test('a removed voice lets go of its arp’s clock, so a Euclid handed out again isn’t still its clock', () => {
  const p = { ...examplePatch(), names: {} };
  apply(p, setConverter(0, { arpClock: 2 }));
  const voice = derive(p.config.values, p.preset.values).sources.find((s) => s.kind === 'voice' && s.index === 0);
  apply(p, removeSource(values(p), voice));
  eq(p.config.values.converter[0].arpClock, 0);
  eq(p.config.values.converter[0].enable, 0);
  assert(freeEuclid(p.config.values) >= 0);
});

test('an MPE voice moved to another channel keeps its zone’s size, below 16 or above the others', () => {
  const mono = { type: 0, channel: 3, lastMpeChannel: 15 };
  eq(voiceChannel(mono, 6), { channel: 6 });
  const lower = { type: 2, channel: 0, lastMpeChannel: 4 }; // ch 1, members 2–5
  eq(voiceChannel(lower, 9), { channel: 9, lastMpeChannel: 13 });
  eq(voiceChannel(lower, 13), { channel: 13, lastMpeChannel: 15 }, 'capped at 16');
  eq(voiceChannel(lower, 15), { channel: 15, lastMpeChannel: 11 }, 'global on 16: members below it');
  const upper = { type: 2, channel: 15, lastMpeChannel: 10 }; // ch 16, members 15–11
  eq(voiceChannel(upper, 0), { channel: 0, lastMpeChannel: 5 });
});

test('an input that doesn’t send inside the FH-2 is sent inside when its use is picked again', () => {
  const p = { ...examplePatch(), names: {} };
  const type = INPUT_USES.indexOf('modulation');
  apply(p, [['enable', 1], ['type', type], ['toInternal', 0], ['toUsbC', 1]].map(([k, v]) => ({ dump: 'config', path: ['cvMidi', 0, k], value: v })));
  const view = derive(p.config.values, p.preset.values);
  eq(useInput(values(p), view, 0, 'modulation'), [{ dump: 'config', path: ['cvMidi', 0, 'toInternal'], value: 1 }]);
  apply(p, useInput(values(p), view, 0, 'modulation'));
  eq(useInput(values(p), derive(p.config.values, p.preset.values), 0, 'modulation'), [], 'inside now: nothing to do');
});

test('a rack with one address twice isn’t taken', () => {
  eq(validHardware({ version: 2, cv: [1, 1], gt: [0] }), null);
  eq(validHardware({ version: 2, cv: [1], gt: [0, 0] }), null);
  assert(validHardware({ version: 2, cv: [1, 2], gt: [0, 1] }));
});

test('a scene removed takes its own steps out of the undo list, not the config’s made while it was in view', () => {
  const p = { config: blankConfig(), preset: blankPreset(), names: {} };
  const h = new History();
  h.do(p, 'level in scene 1', setDirectLevel(1, 100), { scene: 1 });
  h.do(p, 'config and level in scene 1', [{ dump: 'config', path: ['tempoMin'], value: 70 }, ...setDirectLevel(2, 50)], { scene: 1 });
  h.do(p, 'level in scene 2', setDirectLevel(3, 30), { scene: 2 });
  h.dropScene(1);
  eq(h.done.map((s) => [s.label, s.meta.scene, s.changes.map((c) => c.dump)]),
    [['config and level in scene 1', null, ['config']], ['level in scene 2', 1, ['preset']]]);
  h.undo(p);
  h.undo(p);
  eq(p.config.values.tempoMin, blankConfig().values.tempoMin, 'the config change still undoes');
});

test('CC n + 32 is blocked only behind a 14-bit setting', () => {
  const cfg = blankConfig().values;
  const map = (slot, cc, target, index) => Object.assign(cfg.mapping[slot], { status: 0x31, cc, target, index });
  map(0, 16, 9, 0); // ch 2 CC 16: a Euclid's pulses (7-bit)
  map(1, 5, 1, 0); // ch 2 CC 5: output 1's direct level (14-bit)
  const free = freeCcs(cfg, 1).map((c) => c.cc);
  assert(free.includes(48), 'CC 48 is free behind a 7-bit CC 16');
  assert(!free.includes(37), 'CC 37 is the fine half of a level on CC 5');
});

test('the FH-2’s panel takes only its own events; a short dump names its version', () => {
  let threw = false;
  try {
    remote('typo');
  } catch {
    threw = true;
  }
  eq(threw, true);
  const { config } = examplePatch();
  const msg = buildDump(config);
  const short = dumpMessage(config.cmd, bodyOf(msg).slice(0, 100));
  let text = '';
  try {
    parseDump(short);
  } catch (e) {
    text = e.message;
  }
  assert(/100 bytes, version \d+: Night Shift knows version \d+/.test(text), text);
});

test('a late reply to a timed-out request doesn’t answer the next one', async () => {
  const sent = [];
  const transport = { name: 'late test', onmessage: null, send: (b) => sent.push(b), close() {} };
  const fh2 = new Fh2(transport, { timeout: 40 });
  const reply = (text) => transport.onmessage(message(CMD.MESSAGE, [...text].map((c) => c.charCodeAt(0))));
  let first = null;
  try {
    await fh2.version();
  } catch (e) {
    first = e.name;
  }
  eq(first, 'TimeoutError');
  const next = fh2.version();
  setTimeout(() => reply('OLD'), 10); // the first request's answer, late
  setTimeout(() => reply('NEW'), 70); // the second's
  eq(await next, 'NEW');
  eq(sent.length, 2);
});

test('a page name of nothing showable falls back to its own', () => {
  const p = { ...examplePatch(), names: {} };
  const view = derive(p.config.values, p.preset.values);
  p.names[pageNameKey('euclid:0')] = 'ÄÖÜ';
  p.names['ec4:add:euclid:0'] = 'euclid:0:0:pulses';
  const m = pagesOf(view, p.names);
  eq(m.pages.find((pg) => pg.id === 'euclid:0')?.name, 'EUC1');
  p.names['bcr:page:2'] = 'ÄÖÜ';
  eq(bcrPagesOf(m, p.names).pages[1].name, null, 'the BCR32 keeps its own');
});

test('the Euclid accent rate: a note value in the editor, OFF or its clocks on a knob (as table C shows it alone)', async () => {
  const { valueText } = await import('../js/ec4/values.js');
  const { divisionOptions } = await import('../js/ui/controls.js');
  eq([valueText('euclid:0:accent', 0), valueText('euclid:0:accent', 24)], ['OFF', '24']);
  const opts = divisionOptions(24, [[0, 'Off: no accents']]);
  eq([opts[0], opts.find(([n]) => n === 24)?.[1]], [[0, 'Off: no accents'], '1/4']);
  eq(divisionOptions(37, [[0, 'Off']]).at(-1), [37, '37 pulses'], 'an off-list value stays');
});

test('Get takes the FH-2’s changes and keeps yours; Send names what changed on the module', async () => {
  const { mergeFromModule, changedOutside, placesText } = await import('../js/patch/sync.js');
  const { DUMPS } = await import('../js/fh2/sysex.js');
  const { config } = examplePatch();
  const L = DUMPS[config.cmd].layout;
  const base = structuredClone(config.values);
  const mine = structuredClone(base);
  const theirs = structuredClone(base);
  mine.converter[0].channel = 5; // yours, not sent
  theirs.converter[1].channel = 6; // changed on the module
  theirs.converter[0].channel = 7; // both changed: yours stays
  theirs.mapping[3].cc = 99;
  const m = mergeFromModule(L, base, mine, theirs);
  eq(m.take.map((t) => [t.path.join('.'), t.value]), [['converter.1.channel', 6], ['mapping.3.cc', 99]]);
  eq(m.kept.map((p) => p.join('.')), ['converter.0.channel']);
  eq(placesText(changedOutside(L, base, mine, theirs).map((d) => d.path)), 'voice 1, voice 2, CC mapping 4');
  mine.mapping[3].cc = 99; // the module changed it to what you have: nothing to warn about
  eq(placesText(changedOutside(L, base, mine, theirs).map((d) => d.path)), 'voice 1, voice 2');
});

test('what the FH-2 held when last read or sent goes with the project', async () => {
  const { projectToJson, projectFromJson } = await import('../js/patch/project.js');
  const { config, preset } = examplePatch();
  const base = { config: structuredClone(config.values), preset: structuredClone(preset.values), scene: 0 };
  base.config.converter[0].channel = 9;
  const back = projectFromJson(projectToJson({ config, scenes: [preset], scene: 0, names: {}, hardware: null, base }));
  eq([back.base.config.converter[0].channel, back.base.scene, back.base.preset.name], [9, 0, preset.values.name]);
  eq(projectFromJson(projectToJson({ config, scenes: [preset], scene: 0, names: {}, hardware: null })).base, null, 'none: null');
});
