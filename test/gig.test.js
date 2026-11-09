// Tests for the pre-gig checklist (js/patch/gig.js) and the fingerprints it compares.

import { test, assert, eq } from './harness.js';
import { checklist } from '../js/patch/gig.js';
import { fingerprint } from '../js/hash.js';

const fh2Pages = ({ sendCcs = '1', order = '1', startPreset = '2 Verse', startConfig = '1 Live', forward = 'Off' } = {}) => ({
  at: '2026-11-04T20:00:00Z',
  pages: [
    { page: 'General page 1', items: [{ name: 'Startup preset', value: startPreset }, { name: 'Startup configuration', value: startConfig }] },
    { page: 'General page 3', items: [{ name: 'Send CCs on preset ld', value: sendCcs }, { name: '14 bit CC byte order', value: order }] },
    { page: 'MIDI Forwarding', items: [{ name: 'USB C → USB A', value: forward }, { name: 'USB A → USB C', value: 'On' }] },
  ],
});
const view = { mappings: [{ cc: 1 }, { cc: 33 }], players: [] };
const good = () => ({
  config: { slot: 1, fp: 'c1', values: { presetProgramChannel: 3, softTakeover: 0 } },
  scenes: [{ name: 'Verse', slot: 2, fp: 's1' }, { name: 'Chorus', slot: 3, fp: 's2' }],
  view,
  fh2: fh2Pages(),
  held: { flash: { at: '2026-11-04T19:00:00Z', configs: { 1: 'c1' }, presets: { 2: 's1', 3: 's2' } }, ec4: { at: '2026-11-04T19:30:00Z', fp: 'e1', fw: [0, 12] } },
  ec4: { pages: 3, fp: 'e1', synced: 20, max: 64 },
});
const levels = (groups) => Object.fromEntries(groups.flatMap((g) => g.items.map((i) => [i.id, i.level])));
const item = (groups, id) => groups.flatMap((g) => g.items).find((i) => i.id === id);

test('the checklist: everything in order', () => {
  const g = checklist(good());
  eq(g.map((x) => x.id), ['scenes', 'fh2', 'ec4']);
  eq(levels(g), { slots: 'ok', saved: 'ok', program: 'ok', sendccs: 'ok', '14bit': 'ok', 'startup-config': 'ok', 'startup-preset': 'ok', pages: 'ok', fw: 'ok' });
  eq(item(g, 'startup-preset').text, 'Starts with Verse (preset slot 2)');
});

test('the checklist: a new patch, nothing done yet', () => {
  const c = { ...good(), held: {}, fh2: null };
  c.config = { ...c.config, slot: null };
  c.scenes = [{ name: 'Verse', slot: null, fp: 's1' }, { name: 'Chorus', slot: 3, fp: 's2' }];
  const g = checklist(c);
  eq(item(g, 'slots'), { id: 'slots', level: 'warn', action: 'scenes', text: 'No flash slot for the config, Verse' });
  eq(item(g, 'saved'), undefined, 'no saving question before the slots are there');
  eq(item(g, 'read'), { id: 'read', level: 'todo', action: 'readFh2', text: 'Not read from the FH-2 yet' });
  eq([item(g, 'pages').level, item(g, 'pages').action], ['todo', 'send']);
  eq(item(g, 'fw'), undefined, 'the firmware is known only from a send');
});

test('the checklist: what changed since saving and sending, and settings to change on the panel', () => {
  const c = good();
  c.scenes[1].fp = 's2-edited';
  c.config.fp = 'c1-edited';
  c.ec4.fp = 'e2';
  c.fh2 = fh2Pages({ sendCcs: '0', order: '0', startPreset: '1 Init' });
  c.held.ec4.fw = [0, 11];
  c.scenes.push({ name: 'Bridge', slot: 3, fp: 's3' });
  let g = checklist(c);
  eq(item(g, 'slots').text, 'slot 3 used twice');
  c.scenes.pop();
  g = checklist(c);
  eq(item(g, 'saved'), { id: 'saved', level: 'warn', action: 'saveAll', text: 'Changed since saving: the config, Chorus' });
  eq(item(g, 'pages').level, 'warn');
  eq(item(g, 'sendccs').level, 'warn');
  eq(item(g, '14bit').level, 'warn');
  eq(item(g, 'startup-preset').text, 'Starts with preset slot 1 “Init”; Verse is in slot 2 (Startup preset, page 1)');
  eq(item(g, 'fw').level, 'note', '0.11: only the 14-bit knobs');
  // forwarding to USB A carries the scene changes instead
  c.fh2 = fh2Pages({ sendCcs: '0', forward: 'On' });
  eq(item(checklist(c), 'sendccs').level, 'ok');
  // one scene: no program change line; past the cap: a warning
  c.scenes = [c.scenes[0]];
  c.ec4.synced = 70;
  g = checklist(c);
  eq(item(g, 'program'), undefined);
  eq(item(g, 'cap').level, 'warn');
  // no 14-bit CC in the patch: the byte order doesn't matter
  eq(item(checklist({ ...c, view: { mappings: [{ cc: 40 }], players: [] } }), '14bit'), undefined);
});

test('fingerprints tell bytes apart', () => {
  eq(fingerprint(new Uint8Array([])), '811c9dc5');
  assert(fingerprint(Uint8Array.from([1, 2, 3])) !== fingerprint(Uint8Array.from([1, 2, 4])));
  eq(fingerprint(Uint8Array.from([1, 2, 3])), fingerprint(Uint8Array.from([1, 2, 3])));
});

test('what was written to flash and the EC4 is kept in the project file', async () => {
  const { projectToJson, projectFromJson } = await import('../js/patch/project.js');
  const { examplePatch } = await import('../js/patch/example.js');
  const { config, preset } = examplePatch();
  const held = { flash: { at: '2026-11-04T19:00:00Z', configs: { 1: 'aa' }, presets: { 2: 'bb' } }, ec4: { at: '2026-11-04T19:30:00Z', fp: 'cc', fw: [0, 12] } };
  const back = projectFromJson(projectToJson({ config, scenes: [preset], scene: 0, names: {}, hardware: null, slots: { config: 1, scenes: [2] }, held }));
  eq(back.held, held);
  // an older file has none; a broken part is left out
  const text = JSON.parse(projectToJson({ config, scenes: [preset], scene: 0, names: {}, hardware: null }));
  eq(projectFromJson(JSON.stringify({ ...text, held: undefined })).held, {});
  eq(projectFromJson(JSON.stringify({ ...text, held: { flash: { at: 3 }, ec4: { at: 'x', fp: 'y', fw: 'z' } } })).held, { ec4: { at: 'x', fp: 'y', fw: null } });
});
