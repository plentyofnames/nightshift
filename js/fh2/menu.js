// Operating the FH-2's menus remotely, like a person at the panel: 48H presses and turns, and
// reading back where it is (41H the screen, 43H/44H the open item). Used for the settings that
// no dump carries (the Settings menu). See fh2-notes.md, "The FH-2's menus over
// the remote control".
//
// Every step is checked before the next: it only turns while nothing is open (a turn on an open
// setting would change it), checks that what opens is what the list showed, and backs out at
// the first surprise. Whatever happens, it ends by closing what is open (left, never a turn)
// and going back to the overview.

export const SETTINGS_PAGES = ['General page 1', 'General page 2', 'General page 3'];

export class MenuError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reads the FH-2's own settings, changing nothing. `client` is an Fh2 (client.js). Returns
// [{ page, items: [{ name, value }] }]: the General pages, MIDI Forwarding (one item per route,
// "USB A → DIN"), History Inclusion, USB Device Name, and each USB device type's page
// ("USB: Launchpad X"). `onStep(text)` reports progress.
// The guarded moves both readers make: an event and a pause, a screen line, whether anything is
// open (43H answers "Sorry" then), the open item's name, and turning a menu to an item.
function walker(client, wait) {
  const step = async (event) => {
    await client.remote(event);
    await sleep(wait);
  };
  const line = async (i) => (await client.screenText()).lines[i].trim();
  const nothingOpen = async () => (await client.itemName()) === 'Sorry';
  const expect = async (name, where) => {
    const got = await client.itemName();
    if (got !== name) throw new MenuError(`“${got}” where “${name}” was expected (${where})`);
  };
  const turnTo = async (want, max) => {
    for (let k = 0; k <= max; k++) {
      if ((await line(2)) === want) return;
      if (!(await nothingOpen())) throw new MenuError('a setting is open where a menu was expected');
      await step('cw');
    }
    throw new MenuError(`didn’t find “${want}” in the menu`);
  };
  // back to the overview, whatever is open (left first: a long hold with a setting open wasn't tried)
  const home = async () => {
    try {
      if (!(await nothingOpen())) await step('left');
      await step('home');
    } catch {}
  };
  return { step, line, nothingOpen, expect, turnTo, home };
}

export async function readSettings(client, { pages = SETTINGS_PAGES, wait = 200, onStep, more = true } = {}) {
  const { step, line, nothingOpen, expect, turnTo } = walker(client, wait);
  const fields = (text) => text.trim().split(/\s{2,}/).filter(Boolean);

  // a list of settings (a General page, a USB device): press, read, left, turn, once round
  const readList = async (title) => {
    const items = [];
    let first = null;
    for (let k = 0; k < 40; k++) {
      if (!(await nothingOpen())) throw new MenuError('a setting is open where the list was expected');
      const listed = await line(2);
      if (first === null) first = listed;
      else if (listed === first) break;
      await step('press');
      const name = await client.itemName();
      const value = await client.itemValue();
      await step('left');
      if (name !== listed) throw new MenuError(`“${name}” opened where “${listed}” was expected`);
      if (!(await nothingOpen())) throw new MenuError(`${name} didn’t close`);
      items.push({ name, value: value.text });
      onStep?.(`${title}: ${name}`);
      await step('cw');
    }
    return items;
  };

  // MIDI Forwarding: one screen, "from" and "to" pick the route, its On/Off shows on the "to"
  // line. Only "from" and "to" are ever edited; the cursor never goes to the On/Off.
  //
  // The screen remembers where its cursor was and whether a field was being edited, so first
  // get to a known place: the cursor on "to", nothing being edited. On "from" or "to" a turn is
  // always harmless: it moves the cursor, or (if that field is being edited) only picks another
  // route; 43H afterwards says which happened.
  const toToField = async () => {
    for (let k = 0; k < 4; k++) {
      const at = await client.itemName();
      if (at === 'MIDI Forwarding from') {
        await step('cw');
        if ((await client.itemName()) === 'MIDI Forwarding to') return; // moved: nothing was being edited
        await step('press'); // "from" was being edited: stop
      } else if (at === 'MIDI Forwarding to') {
        await step('ccw');
        if ((await client.itemName()) === 'MIDI Forwarding from') { // moved back: nothing was being edited
          await step('cw');
          return;
        }
        await step('press'); // "to" was being edited: stop
      } else {
        throw new MenuError(`MIDI Forwarding’s cursor is on “${at}” (a route’s On/Off): move it to “from” on the module, then read again`);
      }
    }
    throw new MenuError('couldn’t find the cursor in MIDI Forwarding');
  };

  const readForwarding = async () => {
    await toToField();
    await expect('MIDI Forwarding to', 'moving to “to”');
    const items = [];
    const froms = [];
    for (let k = 0; k < 8; k++) {
      const src = fields(await line(1))[1];
      if (froms.includes(src)) break;
      froms.push(src);
      await step('press'); // edit "to"
      const tos = [];
      for (let j = 0; j < 8; j++) {
        const [, dst, value = '?'] = fields(await line(2));
        if (tos.includes(dst)) break;
        tos.push(dst);
        items.push({ name: `${src} → ${dst}`, value });
        onStep?.(`MIDI Forwarding: ${src} → ${dst}`);
        await step('cw');
        await expect('MIDI Forwarding to', 'choosing a destination');
      }
      await step('press'); // stop editing "to"
      await step('ccw'); // cursor back to "from"
      await expect('MIDI Forwarding from', 'moving back to “from”');
      await step('press');
      await step('cw'); // the next source
      await step('press');
      await step('cw'); // cursor to "to"
      await expect('MIDI Forwarding to', 'after the next source');
    }
    await step('ccw'); // leave the cursor on "from", nothing being edited, as the module first opens it
    await expect('MIDI Forwarding from', 'leaving');
    return items;
  };

  // History Inclusion: a message type and its On/Off; only the type is ever edited. It too may
  // have been left with the type being edited: a turn tells (it changes the type while editing,
  // else moves the cursor to the On/Off, which a turn back undoes without changing anything).
  const readHistory = async () => {
    await expect('Include in history', 'on opening (the cursor may be on a type’s On/Off: move it back on the module)');
    await step('cw');
    if ((await client.itemName()) !== 'Include in history') {
      await step('ccw'); // it had moved to the On/Off: back, and start editing the type
      await expect('Include in history', 'moving back to the type');
      await step('press');
    }
    const items = [];
    for (let k = 0; k < 20; k++) {
      const [type, value = '?'] = fields(await line(1));
      if (items.some((i) => i.name === type)) break;
      items.push({ name: type, value });
      onStep?.(`History: ${type}`);
      await step('cw');
      await expect('Include in history', 'choosing a type');
    }
    await step('press'); // stop editing
    return items;
  };

  const result = [];
  try {
    await step('home');
    if ((await client.screenText()).mode !== 0) throw new MenuError('the display didn’t go back to the overview');
    await step('press');
    await turnTo('Settings', 10);
    await step('press');
    if ((await line(0)) !== 'Settings') throw new MenuError('the Settings menu didn’t open');
    for (const page of pages) {
      await turnTo(page, 12);
      await step('press');
      if ((await line(0)) !== page) throw new MenuError(`${page} didn’t open`);
      result.push({ page, items: await readList(page) });
      await step('left'); // back to the Settings list, still on this page
    }
    if (more) {
      await turnTo('MIDI Forwarding', 12);
      await step('press');
      result.push({ page: 'MIDI Forwarding', items: await readForwarding() });
      await step('left');

      await turnTo('History Inclusion', 12);
      await step('press');
      result.push({ page: 'History Inclusion', items: await readHistory() });
      await step('left');

      await turnTo('USB Device Name', 12);
      await step('press');
      await expect('USB Device Name', 'on opening'); // a name editor: read, never turn
      const name = (await client.itemValue()).text.split('\x01')[0].trim();
      result.push({ page: 'USB Device Name', items: [{ name: 'Name', value: name || 'FH-2 (default)' }] });
      await step('left');

      await turnTo('USB Device Settings', 12);
      await step('press');
      if ((await line(0)) !== 'USB Device Settings') throw new MenuError('USB Device Settings didn’t open');
      const devices = [];
      for (let k = 0; k < 16; k++) {
        const device = await line(2);
        if (devices.includes(device)) break;
        devices.push(device);
        await step('press');
        if ((await line(0)) !== device) throw new MenuError(`${device} didn’t open`);
        result.push({ page: `USB: ${device}`, items: await readList(device) });
        await step('left'); // back to the device list
        await step('cw');
      }
      await step('left'); // back to Settings
    }
  } finally {
    try {
      if (!(await nothingOpen())) await step('left');
      await step('home');
    } catch {}
  }
  return result;
}

// ---- calibrations (the menus as walked on 2026-11-05, fh2-notes.md)
//
// Positions and values are read off the screen lines, whose form the walk showed ("Load
// calibration 12", "For output 3", "Output      5", "Calibration 0  (None)"): 44H gives a
// calibration of 0 as text, not as a number (your test, 2026-11-05). Each page may open where it
// was left on the module, so every walk starts from wherever it finds itself.

function calibrationPages(client, wait) {
  const w = walker(client, wait);
  const num = (re, i) => async () => {
    const m = re.exec(await w.line(i));
    return m ? Number(m[1]) : null;
  };
  const slotShown = num(/^Load calibration\s+(\d+)/, 0);
  const outputShown = num(/^Output\s+(\d+)/, 0);
  const calibrationShown = async () => {
    const l = await w.line(1);
    const m = /^Calibration\s+(\d+)/.exec(l);
    return m ? { slot: Number(m[1]), match: /Match!/.test(l) } : null;
  };
  // turns a field or list one step at a time towards `want`, checking each step (`wrap`: the
  // number of values when it wraps round, for the shorter way)
  const turnValue = async (shown, want, { wrap = 0, what, onTurn } = {}) => {
    let v = await shown();
    if (v == null) throw new MenuError(`no ${what} on the screen`);
    while (v !== want) {
      const up = wrap ? (want - v + wrap) % wrap <= wrap / 2 : want > v;
      await w.step(up ? 'cw' : 'ccw');
      onTurn?.();
      const next = up ? (wrap && v === wrap ? 1 : v + 1) : (wrap && v === 1 ? wrap : v - 1);
      const now = await shown();
      if (now !== next) throw new MenuError(`the ${what} went from ${v} to ${now ?? '?'}, not ${next}`);
      v = now;
    }
  };
  const open = async (path) => {
    await w.home();
    if ((await client.screenText()).mode !== 0) throw new MenuError('the display didn’t go back to the overview');
    await w.step('press');
    for (const [item, max, title] of path) {
      await w.turnTo(item, max);
      await w.step('press');
      if (title && (await w.line(0)) !== title) throw new MenuError(`${item} didn’t open`);
    }
  };
  const toCalibrations = () => open([['Calibrations', 10, 'Calibrations'], ['Load calibration', 10, null]]);
  // Which field of Startup the cursor is on, and whether it is open, from a screenshot (fieldFocus),
  // or null without one.
  const focus = async () => {
    try {
      const f = fieldFocus(await client.screenshot());
      return f && { field: f.top < 6 ? 'Output' : 'Calibration', open: f.open };
    } catch {
      return null;
    }
  };
  const mustBe = async (field, open, where) => {
    const f = await focus();
    if (f && (f.field !== field || f.open !== open)) throw new MenuError(`the ${f.field} field is ${f.open ? 'open' : 'under the cursor'} where the ${field} field should be ${open ? 'open' : 'under the cursor'} (${where})`);
  };
  // Startup remembers where its cursor was, and whether a field is open (your FH-2, 2026-11-05).
  // A press closes an open field without changing it, and a turn with nothing open only moves the
  // cursor, so with screenshots the page is set right without a turn that could change a setting:
  // the cursor on Output, nothing open. Without them, the cursor on Calibration stops the walk.
  const toStartup = async () => {
    await open([['Settings', 10, 'Settings'], ['Calibration', 12, 'Calibration'], ['Startup', 3, null]]); // never Basic
    for (let k = 0; k < 3; k++) {
      const f = await focus();
      if (!f || (f.field === 'Output' && !f.open)) break;
      await w.step(f.open ? 'press' : 'ccw');
    }
    const f = await focus();
    if (f && (f.field !== 'Output' || f.open)) throw new MenuError('Startup’s cursor wouldn’t go back to Output');
    const at = await client.itemName();
    if (at === 'Calibration') {
      throw new MenuError('Startup’s cursor is on Calibration: on the FH-2 (Settings › Calibration › Startup) press first if its number is being edited, then turn to Output, and try again');
    }
    if (at !== 'Output') throw new MenuError(`“${at}” where “Output” was expected (on opening Startup)`);
  };
  return { ...w, slotShown, outputShown, calibrationShown, turnValue, toCalibrations, toStartup, mustBe };
}

// The FH-2's calibrations, changing nothing: what each of the 70 flash slots holds, by turning
// through Calibrations › Load calibration without pressing (a press would load one), and which
// slot each of the first `outputs` outputs loads at power-on, by turning the Output field of
// Settings › Calibration › Startup (never its Calibration field). { slots: [{ slot, output
// (0-based) or null, name }], startup: [{ output, slot (0 none), match }] }.
export async function readCalibrations(client, { outputs = 16, wait = 200, onStep } = {}) {
  const p = calibrationPages(client, wait);
  const result = { slots: [], startup: [] };
  try {
    await p.toCalibrations();
    await p.expect('Load calibration', 'on opening');
    const seen = new Map();
    for (let k = 0; k < 70; k++) { // all the way round, from wherever it opened, back to there
      const slot = await p.slotShown();
      if (slot == null || seen.has(slot)) throw new MenuError(`slot ${slot ?? '?'} came round again after ${seen.size}`);
      const { lines } = await client.screenText();
      const m = /^For output (\d+)/.exec(lines[2].trim());
      seen.set(slot, { slot, output: m ? Number(m[1]) - 1 : null, name: m ? lines[1].trim() : '' });
      onStep?.(`calibration slot ${slot}`);
      await p.step('cw'); // picks the next slot; only a press would load one
      await p.expect('Load calibration', 'turning through the slots');
    }
    result.slots = [...seen.values()].sort((a, b) => a.slot - b.slot);
    await p.step('left'); // leaves without loading
    if (!(await p.nothingOpen())) throw new MenuError('Load calibration didn’t close');

    await p.toStartup();
    await p.step('press'); // the Output field: turning it now only shows another output
    await p.expect('Output', 'on opening the output field');
    await p.turnValue(p.outputShown, 1, { what: 'output' });
    for (let o = 1; o <= outputs; o++) {
      if (o > 1) await p.turnValue(p.outputShown, o, { what: 'output' });
      const c = await p.calibrationShown();
      if (!c) throw new MenuError(`no calibration line for output ${o}`);
      result.startup.push({ output: o - 1, ...c });
      onStep?.(`startup calibration of output ${o}`);
    }
    await p.turnValue(p.outputShown, 1, { what: 'output' });
    await p.step('press'); // closes the Output field: the page remembers an open one
    await p.expect('Output', 'closing the output field');
    await p.step('left'); // leaves the page
  } finally {
    await p.home();
  }
  return result;
}

// The first two changes Night Shift makes through the FH-2's menus (your call, 2026-11-05). Each
// step is checked before the next; at the first surprise it backs out (left, then the overview)
// and says where.

// Loads calibration slot `slot` (1–70) onto `output` (0-based) now, in RAM; what loads at power-on
// stays as it is. Calibrations › Load calibration, turned to the slot, checked to be that
// output's, then pressed (pressed again if it asks "Are you sure?").
export async function loadCalibration(client, { slot, output, wait = 200 } = {}) {
  const p = calibrationPages(client, wait);
  try {
    await p.toCalibrations();
    await p.expect('Load calibration', 'on opening');
    await p.turnValue(p.slotShown, slot, { wrap: 70, what: 'slot' });
    const m = /^For output (\d+)/.exec(await p.line(2));
    if (!m) throw new MenuError(`slot ${slot} is empty`);
    if (Number(m[1]) - 1 !== output) throw new MenuError(`slot ${slot} is output ${m[1]}’s, not output ${output + 1}’s`);
    await p.step('press'); // loads it
    if ((await client.screenText()).lines.some((l) => /sure/i.test(l))) await p.step('press');
  } finally {
    await p.home();
  }
}

// Makes `output` (0-based) load calibration `slot` (1–70, 0 none) at power-on: Settings ›
// Calibration › Startup, the Output field turned to the output, then the Calibration field to
// the slot. Resolves to { output, slot, match } as the page then shows it. An error after the
// setting was turned carries `shown`: what the page showed when it stopped.
export async function setStartupCalibration(client, { output, slot, wait = 200 } = {}) {
  const p = calibrationPages(client, wait);
  let turned = false;
  let shown = null;
  let at = null; // where the page stands, for leaving it as reading expects: 'output' (the Output field open), 'cursor' (on Calibration), 'calibration' (open)
  try {
    await p.toStartup();
    await p.step('press'); // the Output field: turning it only shows another output
    at = 'output';
    await p.expect('Output', 'on opening the output field');
    await p.turnValue(p.outputShown, output + 1, { what: 'output' });
    await p.step('press'); // closes the Output field
    at = null;
    await p.mustBe('Output', false, 'before moving the cursor');
    await p.step('cw'); // the cursor onto the Calibration field (were the Output field still open, it would show the next output: caught here)
    at = 'cursor';
    await p.expect('Calibration', 'moving to the calibration field');
    if ((await p.outputShown()) !== output + 1) throw new MenuError('the output moved instead of the cursor');
    await p.mustBe('Calibration', false, 'before opening the calibration field');
    await p.step('press'); // opens it: from here a turn changes the setting
    at = 'calibration';
    await p.expect('Calibration', 'on opening the calibration field');
    await p.mustBe('Calibration', true, 'before turning the calibration');
    await p.turnValue(async () => (await p.calibrationShown())?.slot ?? null, slot, { what: 'calibration', onTurn: () => { turned = true; } });
    await p.step('press'); // closes it
    at = 'cursor';
    const c = await p.calibrationShown();
    shown = c;
    if (c?.slot !== slot) throw new MenuError(`the page shows calibration ${c?.slot ?? '?'}, not ${slot}`);
    await p.step('ccw'); // the cursor back onto Output, where the next walk expects it
    await p.expect('Output', 'moving the cursor back to Output');
    at = null;
    return { output, ...c };
  } catch (e) {
    if (turned) {
      shown ??= await p.calibrationShown().catch(() => null);
      e.shown = shown && { output, ...shown };
      e.message += `: check output ${output + 1}’s startup calibration on the module`;
    }
    // leave the page as reading expects it: what Night Shift opened closed, the cursor on Output
    try {
      if (at === 'output') await p.step('press');
      if (at === 'calibration') {
        await p.step('press');
        at = 'cursor';
      }
      if (at === 'cursor' && (await client.itemName()) === 'Calibration') {
        await p.step('ccw');
        if ((await client.itemName()) !== 'Output') e.message += ' (its cursor stayed on Calibration)';
      }
    } catch {}
    throw e;
  } finally {
    await p.home();
  }
}

// Where the cursor is on a page like Startup, from a screenshot (rows of 0/1): the FH-2 draws a
// dotted box round the value the cursor is on, and a solid one while that field is open (your
// FH-2, 2026-11-05: Output's box spans rows 0–10, Calibration's 10–22). { top (the box's top row),
// open }, or null when no box is seen. An edge is 10 lit pixels in a row (solid) or 5 lit pixels
// two apart with gaps between (dotted); text has neither.
export function fieldFocus(rows) {
  for (let y = 0; y < rows.length; y++) {
    const r = rows[y];
    for (let x = 0; x + 9 < r.length; x++) {
      if (r.slice(x, x + 10).every(Boolean)) return { top: y, open: true };
      if ([0, 2, 4, 6, 8].every((k) => r[x + k]) && [1, 3, 5, 7].every((k) => !r[x + k])) return { top: y, open: false };
    }
  }
  return null;
}

// One output's calibrations, from readCalibrations' result: the slot it loads at power-on (0
// none, null not read), whether that slot is its own, and the slots saved for it.
export function calibrationOf(cal, output) {
  const s = cal?.startup?.find((x) => x.output === output);
  return { startup: s ? s.slot : null, match: !!s?.match, saved: (cal?.slots ?? []).filter((x) => x.output === output).map((x) => x.slot) };
}

// Settings by name, from readSettings' result: { 'Enable DIN MIDI out': '0', … }.
export const settingsByName = (pages) => Object.fromEntries(pages.flatMap((p) => p.items.map((i) => [i.name, i.value])));

// What in the FH-2's own settings (by name, as read) works against the patch (derive's view).
// Each { id, level: 'warn' | 'note', text }.
export function settingsWarnings(byName, view) {
  const out = [];
  const on = (name) => (byName[name] ?? '').trim().startsWith('1');
  const off = (name) => (byName[name] ?? '').trim().startsWith('0');
  const sendsTo = (d) => view.players.filter((p) => p[d]).map((p) => p.name);
  if (off('Enable DIN MIDI out') && sendsTo('din').length) out.push({ id: 'din-out', level: 'warn', text: `DIN MIDI out is off, but ${sendsTo('din').join(', ')} send${sendsTo('din').length > 1 ? '' : 's'} to DIN: nothing comes out there.` });
  if (off('Enable Select Bus out') && sendsTo('select').length) out.push({ id: 'select-out', level: 'warn', text: `The Select Bus output is off, but ${sendsTo('select').join(', ')} send to it.` });
  for (const port of ['DIN', 'USB A', 'USB C']) {
    if (on(`Local off ${port}`)) out.push({ id: `local-off:${port}`, level: 'warn', text: `Local off ${port} is on: MIDI arriving there doesn’t reach the voices, triggers or CC mappings (it may still be forwarded).` });
  }
  const fine = view.mappings.some((m) => m.cc < 32);
  if (off('14 bit CC byte order') && fine) out.push({ id: '14bit', level: 'note', text: '14-bit CCs are read LSB first. The EC4’s 14-bit knobs send MSB first, so for them this needs to be 1.' });
  if (on('Always load direct')) out.push({ id: 'load-direct', level: 'note', text: 'Always load direct is on: a preset’s stored levels also land on jacks that carry a voice or another source.' });
  return out;
}

// A setting's value as read ('1', '0 Off', '15') in words for the Settings tab: On/Off where
// it's a switch, the manual's words where a number stands for a choice, else as the FH-2 shows it.
const SWITCHES = new Set(['Enable DIN MIDI out', 'Clk stop=>LFOs stop', 'Use FH-1 as expander', 'Display flip', 'Menu wrap', 'Accessibility',
  'Wake on MIDI', 'Button exits display', 'Local off DIN', 'Local off USB A', 'Local off USB C', 'Enable MMC', 'Send CCs on preset ld',
  'Ignore clock DIN', 'Ignore clock USB A', 'Ignore clock USB C', 'Always load direct', 'Disable X clocks', 'Disable Y clocks', 'Enable Select Bus out',
  'Echo MIDI', 'Takeover']);
const CHOICES = {
  '14 bit CC byte order': ['LSB first', 'MSB first'],
  'Auto display switch': ['Off', 'On', 'On, not from the converters'],
  'Show counter': ['Off', 'Counter', 'Elapsed time'],
  'MIDI tap tempo': ['Like the panel button', 'Only sets the tempo'],
  'Enable MIDI clock out': ['Off', 'On', 'Clocks only'],
};
export function settingText(name, value) {
  const m = /^(-?\d+)(?:\s+(.*))?$/.exec(value.trim());
  if (!m) return value;
  const n = Number(m[1]);
  if (SWITCHES.has(name) && (n === 0 || n === 1)) return n ? 'On' : 'Off';
  if (CHOICES[name]?.[n]) return CHOICES[name][n];
  if (name === 'Config prog change ch') return n ? `ch ${n}` : 'Off';
  if (/seq bank$/.test(name) && n === 0) return 'None';
  return m[2] && !/^\d/.test(m[2]) && !/^(Startup (preset|configuration))$/.test(name) ? m[2] : value.trim();
}
