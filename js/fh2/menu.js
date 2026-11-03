// Operating the FH-2's menus remotely, like a person at the panel: 48H presses and turns, and
// reading back where it is (41H the screen, 43H/44H the open item). Used for the settings that
// no dump carries (the Settings menu's General pages). See fh2-notes.md, "The FH-2's menus over
// the remote control".
//
// Every step is checked before the next: it only turns while nothing is open (a turn on an open
// setting would change it), checks that what opens is what the list showed, and backs out at
// the first surprise. Whatever happens, it ends by closing what is open (left, never a turn)
// and going back to the overview.

export const SETTINGS_PAGES = ['General page 1', 'General page 2', 'General page 3'];

export class MenuError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reads every setting on `pages`, changing nothing. `client` is an Fh2 (client.js).
// Returns [{ page, items: [{ name, value }] }]. `onStep(text)` reports progress.
export async function readSettings(client, { pages = SETTINGS_PAGES, wait = 200, onStep } = {}) {
  const step = async (event) => {
    await client.remote(event);
    await sleep(wait);
  };
  const line = async (i) => (await client.screenText()).lines[i].trim();
  const nothingOpen = async () => (await client.itemName()) === 'Sorry';
  const turnTo = async (want, max) => {
    for (let k = 0; k <= max; k++) {
      if ((await line(2)) === want) return;
      if (!(await nothingOpen())) throw new MenuError('a setting is open where a menu was expected');
      await step('cw');
    }
    throw new MenuError(`didn’t find “${want}” in the menu`);
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
      const items = [];
      let first = null;
      for (let k = 0; k < 40; k++) {
        if (!(await nothingOpen())) throw new MenuError('a setting is open where the list was expected');
        const listed = await line(2);
        if (first === null) first = listed;
        else if (listed === first) break; // round the list once
        await step('press');
        const name = await client.itemName();
        const value = await client.itemValue();
        await step('left');
        if (name !== listed) throw new MenuError(`“${name}” opened where “${listed}” was expected`);
        if (!(await nothingOpen())) throw new MenuError(`${name} didn’t close`);
        items.push({ name, value: value.text });
        onStep?.(`${page}: ${name}`);
        await step('cw');
      }
      result.push({ page, items });
      await step('left'); // back to the Settings list, still on this page
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
// Each { level: 'warn' | 'note', text }.
export function settingsWarnings(byName, view) {
  const out = [];
  const on = (name) => (byName[name] ?? '').trim().startsWith('1');
  const off = (name) => (byName[name] ?? '').trim().startsWith('0');
  const sendsTo = (d) => view.players.filter((p) => p[d]).map((p) => p.name);
  if (off('Enable DIN MIDI out') && sendsTo('din').length) out.push({ level: 'warn', text: `DIN MIDI out is off, but ${sendsTo('din').join(', ')} send${sendsTo('din').length > 1 ? '' : 's'} to DIN: nothing comes out there.` });
  if (off('Enable Select Bus out') && sendsTo('select').length) out.push({ level: 'warn', text: `The Select Bus output is off, but ${sendsTo('select').join(', ')} send to it.` });
  for (const port of ['DIN', 'USB A', 'USB C']) {
    if (on(`Local off ${port}`)) out.push({ level: 'warn', text: `Local off ${port} is on: MIDI arriving there doesn’t reach the voices, triggers or CC mappings (it may still be forwarded).` });
  }
  const fine = view.mappings.some((m) => m.cc < 32);
  if (off('14 bit CC byte order') && fine) out.push({ level: 'note', text: '14-bit CCs are read LSB first. The EC4’s 14-bit knobs send MSB first, so for them this needs to be 1.' });
  if (on('Always load direct')) out.push({ level: 'note', text: 'Always load direct is on: a preset’s stored levels also land on jacks that carry a voice or another source.' });
  return out;
}
