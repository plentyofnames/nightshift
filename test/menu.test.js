// Tests for menu.js: reading the FH-2's own settings by walking its menus, against the
// stand-in's model of them (standin.js MenuModel).

import { test, assert, eq } from './harness.js';
import { Fh2 } from '../js/fh2/client.js';
import { readSettings, settingsByName, MenuError } from '../js/fh2/menu.js';
import { screenTextOf, message, CMD } from '../js/fh2/sysex.js';
import { Fh2StandIn, MenuModel } from './standin.js';

const setUp = (menu) => {
  const fh2 = new Fh2StandIn({});
  if (menu) fh2.menu = menu;
  return { fh2, client: new Fh2(fh2.transport(), { timeout: 500 }) };
};

test('the menu walk reads every setting and changes nothing', async () => {
  const { fh2, client } = setUp();
  const steps = [];
  const pages = await readSettings(client, { wait: 0, onStep: (s) => steps.push(s) });
  eq(pages.map((p) => [p.page, p.items.length]), [['General page 1', 3], ['General page 2', 2], ['General page 3', 2]]);
  eq(settingsByName(pages)['Enable DIN MIDI out'], '0');
  eq(settingsByName(pages)['14 bit CC byte order'], '0');
  eq(fh2.menu.changes, 0, 'no turn on an open setting');
  assert(!fh2.menu.pressed.includes('Reset Settings'), 'Reset Settings never pressed');
  eq(fh2.menu.level, 'overview', 'back on the overview');
  eq(steps.length, 7);
});

test('the walk starts from wherever the display is', async () => {
  const menu = new MenuModel();
  Object.assign(menu, { level: 'page', page: 'General page 2', back: 1, i: 1 }); // left inside a page
  const { client } = setUp(menu);
  const pages = await readSettings(client, { wait: 0 });
  eq(pages.length, 3);
  eq(menu.changes, 0);
});

test('a surprise stops the walk, closes what is open and goes home, changing nothing', async () => {
  const menu = new MenuModel();
  menu.itemName = function () { return this.level === 'open' ? 'Something else' : 'Sorry'; };
  const { client } = setUp(menu);
  let err = null;
  try {
    await readSettings(client, { wait: 0 });
  } catch (e) {
    err = e;
  }
  assert(err instanceof MenuError, `stopped with a MenuError, got ${err}`);
  eq(err.message, '“Something else” opened where “Contrast” was expected');
  eq([menu.changes, menu.level], [0, 'overview']);
});

test('screen text keeps its blanks when the FH-2 sends them as 0 bytes', () => {
  const chars = [...'Settings'].map((c) => c.charCodeAt(0));
  const body = [...chars, ...new Array(64 - chars.length).fill(0), ...[...'General page 1'].map((c) => c.charCodeAt(0))];
  const s = screenTextOf(message(CMD.SCREEN_TEXT, [1, ...body, ...new Array(128 - body.length).fill(0)]));
  eq([s.mode, s.lines[0].trim(), s.lines[2].trim(), s.lines[3]], [1, 'Settings', 'General page 1', ' '.repeat(32)]);
});

test('settings that work against the patch are pointed out', async () => {
  const { derive } = await import('../js/patch/derive.js');
  const { blankConfig, blankPreset } = await import('../js/patch/blank.js');
  const { apply, setPlayer, addKnob } = await import('../js/patch/edit.js');
  const { settingsWarnings } = await import('../js/fh2/menu.js');
  const p = { config: blankConfig(), preset: blankPreset() };
  const v0 = derive(p.config.values, p.preset.values);
  const read = { 'Enable DIN MIDI out': '0', '14 bit CC byte order': '0', 'Local off USB A': '1', 'Always load direct': '0' };
  eq(settingsWarnings(read, v0).map((w) => w.level), ['warn'], 'only local off, with nothing sending to DIN and no 14-bit CCs');
  apply(p, setPlayer('noteSequencer:2', { channel: 4, dests: { din: true } }));
  apply(p, addKnob({ config: p.config.values, preset: p.preset.values }, 3, 1, 12));
  const v = derive(p.config.values, p.preset.values);
  eq(settingsWarnings(read, v).map((w) => w.text.slice(0, 22)), ['DIN MIDI out is off, b', 'Local off USB A is on:', '14-bit CCs are read LS']);
});
