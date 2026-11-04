// The pre-gig checklist (the Gig tab): what has to be right before playing without a computer,
// each line { id, level, text, action }. level: 'ok', 'warn' (change something), 'todo' (not
// known yet, or not done), 'note'. action: what Night Shift can do about it ('readFh2', 'saveAll',
// 'sendEc4', 'scenes'), or none where only the module's panel can change it. No DOM here.
//
// Night Shift can't read the FH-2's flash slots or the EC4 without loading or reading them, so
// `held` is what it wrote there itself: { flash: { at, configs: { slot: fp }, presets: { slot: fp } },
// ec4: { at, fp, fw: [major, minor] } }, kept with the patch. A line compares that with the
// fingerprints of what you see now.

import { settingsByName, settingsWarnings } from '../fh2/menu.js';

const date = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const slotOf = (text) => {
  const m = /^\s*(\d+)\s*(.*)$/.exec(text ?? '');
  return m ? { slot: Number(m[1]), name: m[2].trim() } : null;
};
const fwText = (fw) => (fw ? `${fw[0]}.${fw[1]}` : '?');
const fwAtLeast = (fw, major, minor) => !!fw && (fw[0] > major || (fw[0] === major && fw[1] >= minor));

// `config`: { slot, fp, values }; `scenes`: [{ name, slot, fp }]; `view`: derive's; `fh2`: the
// FH-2's settings as last read ({ at, pages }) or null; `ec4`: { pages (how many), fp (of the pages
// as they would be written now, in the format `held.ec4.fw` takes), synced, max }.
export function checklist({ config, scenes, view, fh2, held = {}, ec4 }) {
  return [
    { id: 'scenes', title: 'Scenes and flash', items: scenesItems(config, scenes, held.flash) },
    { id: 'fh2', title: 'FH-2 settings', note: fh2 ? `read ${date(fh2.at)}` : null, items: fh2Items(config, scenes, view, fh2) },
    { id: 'ec4', title: 'EC4', items: ec4Items(ec4, held.ec4) },
  ];
}

function scenesItems(config, scenes, flash) {
  const out = [];
  const name = (s, i) => s.name || `Scene ${i + 1}`;
  const noSlot = scenes.map((s, i) => (s.slot ? null : name(s, i))).filter(Boolean);
  const bySlot = new Map();
  scenes.forEach((s) => s.slot && bySlot.set(s.slot, (bySlot.get(s.slot) ?? 0) + 1));
  const twice = [...bySlot].filter(([, n]) => n > 1).map(([slot]) => slot);
  if (!config.slot || noSlot.length || twice.length) {
    const what = [!config.slot && 'the config', ...noSlot].filter(Boolean);
    out.push({ id: 'slots', level: 'warn', action: 'scenes',
      text: [what.length && `No flash slot for ${what.join(', ')}`, twice.length && `slot ${twice.join(', ')} used twice`].filter(Boolean).join('; ') });
  } else {
    out.push({ id: 'slots', level: 'ok', text: `Config in slot ${config.slot}, ${scenes.length === 1 ? 'the scene' : 'scenes'} in ${scenes.map((s) => s.slot).join(', ')}` });
  }
  if (config.slot && !noSlot.length && !twice.length) {
    const changed = [
      flash?.configs?.[config.slot] !== config.fp && 'the config',
      ...scenes.map((s, i) => (flash?.presets?.[s.slot] !== s.fp ? name(s, i) : null)),
    ].filter(Boolean);
    if (!flash) out.push({ id: 'saved', level: 'todo', action: 'saveAll', text: 'Not saved to flash from Night Shift yet' });
    else if (changed.length) out.push({ id: 'saved', level: 'warn', action: 'saveAll', text: `Changed since saving: ${changed.join(', ')}` });
    else out.push({ id: 'saved', level: 'ok', text: `All saved to flash (${date(flash.at)})` });
  }
  if (scenes.length > 1) {
    const ch = config.values.presetProgramChannel;
    out.push(ch
      ? { id: 'program', level: 'ok', text: `Scenes by program change on ch ${ch} (program N loads slot N + 1)` }
      : { id: 'program', level: 'warn', action: 'scenes', text: 'No program change channel: scenes can only be switched on the panel' });
  }
  return out;
}

function fh2Items(config, scenes, view, fh2) {
  const out = [];
  if (config.values.softTakeover) out.push({ id: 'takeover', level: 'note', text: 'Soft takeover is on: not needed with the FH-2 sync (Settings tab)' });
  if (!fh2) return [{ id: 'read', level: 'todo', action: 'readFh2', text: 'Not read from the FH-2 yet' }, ...out];
  const s = settingsByName(fh2.pages);
  const forwarding = (fh2.pages.find((p) => p.page === 'MIDI Forwarding')?.items ?? []).filter((i) => / → USB A$/.test(i.name) && /^on/i.test(i.value));
  const on = (n) => (s[n] ?? '').trim().startsWith('1');
  if (on('Send CCs on preset ld')) out.unshift({ id: 'sendccs', level: 'ok', text: 'Send CCs on preset ld: scene changes reach the EC4' });
  else if (forwarding.length) out.unshift({ id: 'sendccs', level: 'ok', text: `${forwarding.map((i) => i.name).join(', ')} forwarded: the EC4 hears scene changes (controlfrog 0.12)` });
  else out.unshift({ id: 'sendccs', level: 'warn', text: 'Send CCs on preset ld is off: the EC4 won’t follow scene changes (Settings, page 3)' });
  if (view.mappings.some((m) => m.cc < 32)) {
    out.push(on('14 bit CC byte order')
      ? { id: '14bit', level: 'ok', text: '14-bit CCs MSB first, as the EC4 sends them' }
      : { id: '14bit', level: 'warn', text: '14-bit CCs LSB first: set 14 bit CC byte order to 1 (Settings, page 3)' });
  }
  const startup = (setting, want, what) => {
    const got = slotOf(s[setting]);
    if (!got) return { level: 'note', text: `${setting}: ${(s[setting] ?? '?').trim()}` };
    if (!want) return { level: 'note', text: `Starts with ${what} slot ${got.slot}${got.name ? ` “${got.name}”` : ''}` };
    return got.slot === want.slot
      ? { level: 'ok', text: `Starts with ${want.label} (${what} slot ${got.slot})` }
      : { level: 'warn', text: `Starts with ${what} slot ${got.slot}${got.name ? ` “${got.name}”` : ''}; ${want.label} is in slot ${want.slot} (${setting}, page 1)` };
  };
  out.push({ id: 'startup-config', ...startup('Startup configuration', config.slot && { slot: config.slot, label: 'your config' }, 'config') });
  out.push({ id: 'startup-preset', ...startup('Startup preset', scenes[0]?.slot && { slot: scenes[0].slot, label: scenes[0].name || 'the first scene' }, 'preset') });
  for (const w of settingsWarnings(s, view)) if (w.id !== '14bit') out.push({ id: w.id, level: w.level === 'warn' ? 'warn' : 'note', text: w.text });
  return out;
}

function ec4Items(ec4, sent) {
  if (!ec4.pages) return [{ id: 'pages', level: 'note', text: 'No EC4 pages in this patch' }];
  const out = [];
  if (!sent) out.push({ id: 'pages', level: 'todo', action: 'sendEc4', text: 'Pages not sent to the EC4 from this patch yet' });
  else if (sent.fp !== ec4.fp) out.push({ id: 'pages', level: 'warn', action: 'sendEc4', text: `Pages changed since Send to EC4 (${date(sent.at)})` });
  else out.push({ id: 'pages', level: 'ok', text: `Pages and sync table on the EC4 (${date(sent.at)})` });
  if (sent?.fw) {
    out.push(fwAtLeast(sent.fw, 0, 12)
      ? { id: 'fw', level: 'ok', text: `controlfrog ${fwText(sent.fw)}: its knobs follow the FH-2 at power-on, on Func + Group and on scene changes` }
      : fwAtLeast(sent.fw, 0, 11)
        ? { id: 'fw', level: 'note', text: `controlfrog ${fwText(sent.fw)}: only the 14-bit knobs follow the FH-2` }
        : { id: 'fw', level: 'warn', text: `controlfrog ${fwText(sent.fw)}: the knobs don’t follow the FH-2 by themselves` });
  }
  if (ec4.synced > ec4.max) out.push({ id: 'cap', level: 'warn', text: `${ec4.synced} synced knobs: the EC4 keeps only the first ${ec4.max} in step` });
  return out;
}
