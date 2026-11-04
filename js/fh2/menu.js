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
export async function readSettings(client, { pages = SETTINGS_PAGES, wait = 200, onStep, more = true } = {}) {
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
