// Tests for menu.js: reading the FH-2's own settings by walking its menus, against the
// stand-in's model of them (standin.js MenuModel).

import { test, assert, eq } from './harness.js';
import { Fh2 } from '../js/fh2/client.js';
import { readSettings, readCalibrations, calibrationOf, loadCalibration, setStartupCalibration, startAutoCalibration, watchAutoCalibration, finishAutoCalibration, nameCalibration, saveCalibration, calibrationSlot, settingsByName, MenuError } from '../js/fh2/menu.js';
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
  eq(pages.map((p) => [p.page, p.items.length]).slice(0, 6), [['General page 1', 3], ['General page 2', 2], ['General page 3', 2], ['MIDI Forwarding', 12], ['History Inclusion', 5], ['USB Device Name', 1]]);
  eq(pages.length, 14, 'and the eight USB device types');
  const all = settingsByName(pages);
  eq([all['USB A → DIN'], all['DIN → USB A'], all['CC'], all['Name']], ['On', 'Off', 'On', 'FH-2 (default)']);
  eq(pages.find((p) => p.page === 'USB: Launchpad Mini Mk3').items.map((i) => i.value), ['0', '1']);
  eq(settingsByName(pages)['Enable DIN MIDI out'], '0');
  eq(settingsByName(pages)['14 bit CC byte order'], '0');
  eq(fh2.menu.changes, 0, 'no turn on an open setting');
  assert(!fh2.menu.pressed.includes('Reset Settings'), 'Reset Settings never pressed');
  eq(fh2.menu.level, 'overview', 'back on the overview');
  eq(steps.length, 7 + 12 + 5 + 16);
});

test('the walk starts from wherever the display is', async () => {
  const menu = new MenuModel();
  Object.assign(menu, { level: 'page', page: 'General page 2', back: 1, i: 1 }); // left inside a page
  const { client } = setUp(menu);
  const pages = await readSettings(client, { wait: 0 });
  eq(pages.length, 14);
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

test('settings read as numbers are shown in words', async () => {
  const { settingText } = await import('../js/fh2/menu.js');
  eq([settingText('Enable DIN MIDI out', '0'), settingText('Ignore clock USB A', '1'), settingText('Accessibility', '0 Off')], ['Off', 'On', 'Off']);
  eq([settingText('14 bit CC byte order', '0'), settingText('Show counter', '2'), settingText('Config prog change ch', '0')], ['LSB first', 'Elapsed time', 'Off']);
  eq([settingText('Top-level encoder', '1 Tempo'), settingText('Startup preset', '1 Init'), settingText('Display blank', '15'), settingText('Startup note seq bank', '0 <none>')],
    ['Tempo', '1 Init', '15', 'None']);
  eq(settingText('Tuner pitch reference', '440.0'), '440.0');
});

test('MIDI Forwarding and History Inclusion are read wherever their cursors were left', async () => {
  const left = [
    { forwarding: { field: 1, editing: false }, note: 'cursor on “to”' },
    { forwarding: { field: 1, editing: true }, note: 'editing “to”' },
    { forwarding: { field: 0, editing: true }, note: 'editing “from”' },
    { historyIncl: { editing: true }, note: 'editing the type' },
  ];
  for (const { forwarding, historyIncl, note } of left) {
    const menu = new MenuModel();
    Object.assign(menu.forwarding, forwarding);
    Object.assign(menu.historyIncl, historyIncl);
    const { client } = setUp(menu);
    const pages = await readSettings(client, { wait: 0 });
    eq(pages.find((p) => p.page === 'MIDI Forwarding').items.length, 12, note);
    eq(pages.find((p) => p.page === 'History Inclusion').items.length, 5, note);
    eq(menu.changes, 0, `${note}: nothing changed`);
    eq([menu.forwarding.field, menu.forwarding.editing], [0, false], `${note}: left on “from”, as the module first opens it`);
  }
});

test('reading twice in a row works, and an On/Off left under the cursor stops the walk unchanged', async () => {
  const menu = new MenuModel();
  const { client } = setUp(menu);
  await readSettings(client, { wait: 0 });
  await readSettings(client, { wait: 0 });
  eq(menu.changes, 0);
  for (const where of ['forwarding', 'historyIncl']) {
    const m = new MenuModel();
    m[where].field = where === 'forwarding' ? 2 : 1; // someone left the cursor on an On/Off
    const { client: c } = setUp(m);
    let err = null;
    try {
      await readSettings(c, { wait: 0 });
    } catch (e) {
      err = e;
    }
    assert(err instanceof MenuError, `${where}: stopped`);
    eq([m.changes, m.level], [0, 'overview'], `${where}: nothing changed, back home`);
  }
});

test('reading the calibrations: every slot and each output’s startup slot, changing and loading nothing', async () => {
  const calibrations = Array.from({ length: 70 }, (_, k) => (k < 4 ? { output: k, name: '' } : k === 9 ? { output: 6, name: 'MOOG' } : null));
  const startup = Array.from({ length: 64 }, (_, o) => (o < 4 ? o + 1 : o === 6 ? 10 : o === 7 ? 3 : 0));
  const menu = new MenuModel({ calibrations, startup });
  const { client } = setUp(menu);
  const steps = [];
  const r = await readCalibrations(client, { outputs: 16, wait: 0, onStep: (s) => steps.push(s) });
  eq(r.slots.length, 70);
  eq(r.slots.filter((s) => s.output != null).map((s) => [s.slot, s.output, s.name]), [[1, 0, ''], [2, 1, ''], [3, 2, ''], [4, 3, ''], [10, 6, 'MOOG']]);
  eq(r.startup.slice(0, 9).map((x) => [x.output, x.slot, x.match]),
    [[0, 1, true], [1, 2, true], [2, 3, true], [3, 4, true], [4, 0, false], [5, 0, false], [6, 10, true], [7, 3, false], [8, 0, false]],
    'output 8 starts with slot 3, which is output 3’s: no match');
  eq(r.startup.length, 16);
  eq([menu.changes, menu.loaded, menu.level], [0, [], 'overview'], 'nothing changed, nothing loaded, back on the overview');
  eq(menu.pressed.filter((p) => /Basic|Save|Reset|Auto|Name/.test(p)), [], 'never Basic, Save, Reset, Name or Auto-calibrate');
  eq(menu.startupState.output, 0, 'the Startup page left on output 1');
  eq(steps.length, 70 + 16);
});

test('reading the calibrations starts from wherever the display is', async () => {
  const menu = new MenuModel();
  Object.assign(menu, { level: 'loadcal', slot: 12 }); // left inside Load calibration
  const { client } = setUp(menu);
  const r = await readCalibrations(client, { outputs: 8, wait: 0 });
  eq([r.slots.filter((s) => s.output != null).length, r.startup.map((x) => x.slot).join(' ')], [4, '1 2 3 4 0 0 0 0']);
  eq([menu.changes, menu.loaded], [0, []]);
});

test('one jack’s calibrations from what was read', () => {
  const cal = { slots: [{ slot: 1, output: 0, name: '' }, { slot: 2, output: 7, name: '' }, { slot: 5, output: 0, name: 'MOOG' }],
    startup: [{ output: 0, slot: 5, match: true }, { output: 1, slot: 0, match: false }] };
  eq(calibrationOf(cal, 0), { startup: 5, match: true, saved: [1, 5] });
  eq(calibrationOf(cal, 1), { startup: 0, match: false, saved: [] });
  eq(calibrationOf(cal, 7), { startup: null, match: false, saved: [2] }, 'past the outputs read: its saved slots only');
  eq(calibrationOf(null, 0).startup, null);
});

test('loading a calibration now: the right slot, checked to be that jack’s', async () => {
  const menu = new MenuModel();
  const { client } = setUp(menu);
  await loadCalibration(client, { slot: 3, output: 2, wait: 0 });
  eq([menu.loaded, menu.changes, menu.level], [[3], 0, 'overview']);
  eq(menu.startup.slice(0, 4), [1, 2, 3, 4], 'power-on slots as they were');
  for (const [slot, output, why] of [[5, 4, 'slot 5 is empty'], [2, 0, 'slot 2 is output 2’s, not output 1’s']]) {
    let error = '';
    try {
      await loadCalibration(client, { slot, output, wait: 0 });
    } catch (e) {
      error = e.message;
    }
    eq(error, `${why}`);
  }
  eq([menu.loaded, menu.level], [[3], 'overview'], 'nothing else loaded, back on the overview');
});

test('setting a jack’s power-on calibration changes that one setting only', async () => {
  const calibrations = Array.from({ length: 70 }, (_, k) => (k < 4 ? { output: k, name: '' } : k === 9 ? { output: 6, name: '' } : null));
  const menu = new MenuModel({ calibrations });
  const { client } = setUp(menu);
  const before = [...menu.startup];
  eq(await setStartupCalibration(client, { output: 6, slot: 10, wait: 0 }), { output: 6, slot: 10, match: true });
  eq(menu.startup.map((s, o) => (o === 6 ? before[o] : s)), before, 'no other output changed');
  eq([menu.startup[6], menu.loaded, menu.level], [10, [], 'overview']);
  eq(menu.pressed.filter((p) => p === 'Basic'), [], 'never Basic');
  // back to none, the other way round
  eq(await setStartupCalibration(client, { output: 1, slot: 0, wait: 0 }), { output: 1, slot: 0, match: false });
  eq(menu.startup.slice(0, 8), [1, 0, 3, 4, 0, 0, 10, 0]);
});

test('your case: jack 1 to none, from pages left where you looked on the module', async () => {
  const menu = new MenuModel();
  Object.assign(menu, { slot: 36 }); // Load calibration left at slot 37
  menu.startupState.output = 8; // Startup left on output 9
  const { client } = setUp(menu);
  eq(await setStartupCalibration(client, { output: 0, slot: 0, wait: 0 }), { output: 0, slot: 0, match: false }, 'a calibration of 0 shows as “(None)” in 44H: read off the line');
  eq([menu.startup.slice(0, 4), menu.loaded, menu.level], [[0, 2, 3, 4], [], 'overview']);
  const r = await readCalibrations(client, { outputs: 8, wait: 0 });
  eq(r.slots.filter((s) => s.output != null).map((s) => s.slot), [1, 2, 3, 4], 'every slot, starting from 37');
  eq(r.startup.map((x) => x.slot), [0, 2, 3, 4, 0, 0, 0, 0]);
  eq(menu.slot, 36, 'Load calibration left where it was found');
  await loadCalibration(client, { slot: 2, output: 1, wait: 0 }); // from 37: the shorter way, over 70
  eq(menu.loaded, [2]);
});

test('a surprise after the turn: it stops, says so, and hands back what the page shows', async () => {
  const menu = new MenuModel();
  const { client } = setUp(menu);
  const turn = menu.event.bind(menu);
  let jumped = false;
  menu.event = (e) => { // the setting jumps by two on its first turn
    turn(e);
    if (!jumped && menu.level === 'startup' && menu.startupState.field === 1 && menu.startupState.editing && (e === 2 || e === 3)) {
      jumped = true;
      turn(e);
    }
  };
  let error = null;
  try {
    await setStartupCalibration(client, { output: 2, slot: 0, wait: 0 });
  } catch (e) {
    error = e;
  }
  eq(error.message, 'the calibration went from 3 to 1, not 2: check output 3’s startup calibration on the module');
  eq(error.shown, { output: 2, slot: 1, match: false });
  eq(menu.level, 'overview');
});

test('Startup remembers its cursor: Night Shift leaves it on Output, and stops if it finds it on Calibration', async () => {
  const menu = new MenuModel();
  const { client } = setUp(menu);
  // read, change, read, change: each leaves the page as the next expects
  await readCalibrations(client, { outputs: 8, wait: 0 });
  eq(await setStartupCalibration(client, { output: 1, slot: 0, wait: 0 }), { output: 1, slot: 0, match: false });
  eq(menu.startupState.field === 0 && !menu.startupState.editing, true, 'cursor on Output, nothing open');
  eq((await readCalibrations(client, { outputs: 8, wait: 0 })).startup.map((x) => x.slot), [1, 0, 3, 4, 0, 0, 0, 0]);
  eq(await setStartupCalibration(client, { output: 1, slot: 2, wait: 0 }), { output: 1, slot: 2, match: true });
  eq(menu.startup.slice(0, 4), [1, 2, 3, 4]);
  // left on Calibration, and no screenshots to tell whether that field is open: no turn, a clear message
  Object.assign(menu.startupState, { field: 1, editing: true });
  menu.picture = () => null;
  const before = [...menu.startup];
  let error = '';
  try {
    await setStartupCalibration(client, { output: 0, slot: 0, wait: 0 });
  } catch (e) {
    error = e.message;
  }
  assert(error.startsWith('Startup’s cursor is on Calibration'), error);
  eq(menu.startup, before, 'nothing changed');
});

test('the cursor box in real screenshots of Startup: dotted round a closed field, solid round an open one', async () => {
  const { fieldFocus } = await import('../js/fh2/menu.js');
  const { OUTPUT_CURSOR, OUTPUT_OPEN, CALIBRATION_CURSOR, rowsOf } = await import('./fixtures-startup.js');
  const { screenshotOf, screenshotMessage } = await import('../js/fh2/sysex.js');
  eq(fieldFocus(rowsOf(OUTPUT_CURSOR)), { top: 0, open: false });
  eq(fieldFocus(rowsOf(OUTPUT_OPEN)), { top: 0, open: true });
  eq(fieldFocus(rowsOf(CALIBRATION_CURSOR)), { top: 10, open: false });
  eq(fieldFocus(rowsOf('')), null, 'no box');
  const rows = rowsOf(CALIBRATION_CURSOR);
  eq(screenshotOf(screenshotMessage(rows)), rows, 'the 33H packing both ways');
});

test('with screenshots Night Shift sets Startup right itself, also with Calibration left open', async () => {
  const menu = new MenuModel();
  const { client } = setUp(menu);
  Object.assign(menu.startupState, { field: 1, editing: true }); // left open on Calibration
  const before = [...menu.startup];
  eq(await setStartupCalibration(client, { output: 2, slot: 0, wait: 0 }), { output: 2, slot: 0, match: false });
  eq(menu.startup.map((s, o) => (o === 2 ? before[o] : s)), before, 'closed with a press, cursor moved with nothing open: only output 3 changed');
  eq([menu.startupState.field, menu.startupState.editing], [0, false]);
  // and reading from the same state
  Object.assign(menu.startupState, { field: 1, editing: false });
  eq((await readCalibrations(client, { outputs: 4, wait: 0 })).startup.map((x) => x.slot), [1, 2, 0, 4]);
});

test('auto-calibration: picks the jack’s output, starts, shows the curve, accepts or abandons', async () => {
  const menu = new MenuModel();
  Object.assign(menu.autoState, { field: 1, editing: false, output: 6 }); // left on GO! with output 7
  const { client } = setUp(menu);
  await startAutoCalibration(client, { output: 2, wait: 0 });
  eq([menu.runs, menu.level], [[3], 'autorun'], 'started on output 3, not the 7 it was left on');
  let w = await watchAutoCalibration(client);
  eq([w.asks, w.rows.length, w.rows[31][0]], [false, 32, 1], 'the curve so far, no question yet');
  let early = '';
  try {
    await finishAutoCalibration(client, { accept: true, wait: 0 });
  } catch (e) {
    early = e.message;
  }
  eq([early, menu.accepted, menu.level], ['it doesn’t ask “Accept?” yet', [], 'autorun'], 'no accepting before it asks: the run goes on');
  // wait for the question, accept
  for (let k = 0; k < 5 && !w.asks; k++) w = await watchAutoCalibration(client);
  w = await watchAutoCalibration(client);
  eq(w.asks, true);
  await finishAutoCalibration(client, { accept: true, wait: 0 });
  eq([menu.accepted, menu.level], [[3], 'overview']);
  // and abandoning one
  await startAutoCalibration(client, { output: 0, wait: 0 });
  await finishAutoCalibration(client, { accept: false, wait: 0 });
  eq([menu.abandoned.at(-1), menu.accepted, menu.level], [1, [3], 'overview']);
  eq(menu.changes, 0, 'nothing else changed');
});

test('auto-calibration starts only where it can see the cursor, from an open Output field too', async () => {
  const menu = new MenuModel();
  Object.assign(menu.autoState, { field: 0, editing: true, output: 4 }); // the Output field left open
  const { client } = setUp(menu);
  await startAutoCalibration(client, { output: 5, wait: 0 });
  eq(menu.runs, [6]);
  await finishAutoCalibration(client, { accept: false, wait: 0 });
  // without screenshots: no run at all
  menu.picture = () => null;
  let error = '';
  try {
    await startAutoCalibration(client, { output: 0, wait: 0 });
  } catch (e) {
    error = e.message;
  }
  eq([error, menu.runs.length, menu.level], ['no screenshot from the FH-2: its cursor can’t be seen', 1, 'overview']);
});

const failure = async (work) => {
  try {
    await work();
  } catch (e) {
    return e.message;
  }
  return '';
};

test('saving a calibration: named first, the jack’s output, an empty slot, checked on the slot after', async () => {
  const menu = new MenuModel();
  menu.autoState.output = 2; // jack 3 was just calibrated: Save calibration opens on it
  const { client } = setUp(menu);
  const steps = [];
  const r = await saveCalibration(client, { output: 5, slot: 7, name: 'Plaits', wait: 0, onStep: (s) => steps.push(s) });
  eq(r, { slot: 7, output: 5, name: 'Plaits' });
  eq(menu.savedCals, [{ slot: 7, output: 6, name: 'Plaits' }], 'output 6 into slot 7, turned there from 69');
  eq([menu.calibrations[6], menu.changes, menu.level], [{ output: 5, name: 'Plaits' }, 0, 'overview'], 'no turn or press in the name editor');
  eq(steps, ['naming it', 'picking the output', 'finding the slot', 'saving into slot 7']);
  eq(await calibrationSlot(client, { slot: 7, wait: 0 }), { output: 5, name: 'Plaits' }, 'Load calibration shows it');
  eq(menu.loaded, [], 'and nothing was loaded');
});

test('saving a calibration: never over a used slot; without a slot, the first empty one', async () => {
  const menu = new MenuModel();
  const { client } = setUp(menu);
  eq(await failure(() => saveCalibration(client, { output: 0, slot: 3, name: 'x', wait: 0 })), 'slot 3 isn’t empty (output 3’s)');
  eq([menu.savedCals, menu.calibrations[2], menu.level], [[], { output: 2, name: '' }, 'overview']);
  // slots 1–4 used (yours), so slot 5, found from wherever the page opens
  const r = await saveCalibration(client, { output: 0, wait: 0 });
  eq([r.slot, menu.savedCals.map((c) => c.slot)], [5, [5]]);
  menu.calibrations = menu.calibrations.map(() => ({ output: 9, name: '' }));
  eq(await failure(() => saveCalibration(client, { output: 0, wait: 0 })), 'no empty slot');
  eq(menu.savedCals.length, 1);
});

test('saving a calibration: a name the FH-2 doesn’t take stops it before anything is saved', async () => {
  const menu = new MenuModel();
  menu.takesNames = false;
  const { client } = setUp(menu);
  eq(await failure(() => saveCalibration(client, { output: 0, slot: 9, name: 'Mangrove', wait: 0 })), 'the FH-2 took the name as “”, not “Mangrove”');
  eq([menu.savedCals, menu.level], [[], 'overview']);
});

test('saving a calibration: “Are you sure?” answered, and a page that moves on read back on Load calibration', async () => {
  const menu = new MenuModel();
  Object.assign(menu, { saveAsks: true, saveThen: 'outputs' });
  menu.slot = 40; // Load calibration left at slot 41
  const { client } = setUp(menu);
  const r = await saveCalibration(client, { output: 1, slot: 12, name: 'DPO', wait: 0 });
  eq([r, menu.savedCals.length, menu.loaded, menu.level], [{ slot: 12, output: 1, name: 'DPO' }, 1, [], 'overview']);
  // saved nowhere (the FH-2 ignores the press): it says so
  menu.save = () => {};
  menu.saveAsks = false;
  eq(await failure(() => saveCalibration(client, { output: 1, slot: 13, wait: 0 })), 'slot 13 doesn’t show output 2’s calibration after saving: check it on the module');
});

test('Save calibration reopened on its slots: back to the outputs first', async () => {
  const menu = new MenuModel();
  menu.saveKeepsPlace = true;
  Object.assign(menu.saveState, { step: 1, output: 9, slot: 20 }); // left on output 10's slots
  const { client } = setUp(menu);
  const r = await saveCalibration(client, { output: 3, slot: 6, wait: 0 });
  eq([r.slot, menu.savedCals], [6, [{ slot: 6, output: 4, name: '' }]]);
});

test('replacing a calibration: only the same jack’s slot, and only when asked to', async () => {
  const menu = new MenuModel();
  menu.saveAsks = 'used';
  const { client } = setUp(menu);
  // slot 3 holds output 3's (yours): refused without `replace`
  eq(await failure(() => saveCalibration(client, { output: 2, slot: 3, name: 'New', wait: 0 })), 'slot 3 isn’t empty (output 3’s)');
  eq(await failure(() => saveCalibration(client, { output: 2, slot: 2, name: 'New', replace: true, wait: 0 })), 'slot 2 is output 2’s, not output 3’s');
  eq(menu.savedCals, []);
  const steps = [];
  const r = await saveCalibration(client, { output: 2, slot: 3, name: 'New', replace: true, wait: 0, onStep: (t) => steps.push(t) });
  eq([r, menu.savedCals, steps.at(-1)], [{ slot: 3, output: 2, name: 'New' }, [{ slot: 3, output: 3, name: 'New' }], 'replacing slot 3'], 'asked “Are you sure?” and answered');
  // a replace the FH-2 ignores: the slot still shows the old name
  menu.save = () => {};
  eq(await failure(() => saveCalibration(client, { output: 2, slot: 3, name: 'Newer', replace: true, wait: 0 })), 'slot 3 doesn’t show the new calibration after saving: check it on the module');
  eq(menu.level, 'overview');
});
