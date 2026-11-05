// The panel of input X or Y (click the jack on the FH-2 in the rack): what it turns its CV into,
// inside the FH-2. Modulation sends a CC on a channel of its own, mapped to the settings it moves
// (pick them here; each also shows "← X" beside its name). Triggers and notes are players, wired
// to a trigger kit or a voice in their "Played by"; scenes are program changes on the Scenes-by-PC
// channel; aftertouch goes to the voices on its channel. An input in use takes no clock (X is the
// FH-2's clock input; Y may run and stop the clock), and notes take the other input as the gate.

import { h } from '../../vendor/lilypad/js/dom.js';
import { icon } from './look.js';
import { numberInput, selectInput } from './controls.js';
import { playerSends } from './players.js';
import { noteName } from '../patch/tables.js';
import { INPUT_USES, inputUse, useInput, setInput, modulateFrom } from '../patch/edit.js';
import { objectsOf, settingKey } from '../ec4/pages.js';

const section = (title, ...rows) => h('section', { class: 'section' }, h('h3', {}, title), rows);
const field = (label, ...control) => h('div', { class: 'erow' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, control));
const NOTES = Array.from({ length: 128 }, (_, n) => [n, `${noteName(n)} (${n})`]);
const WORDS = { off: 'Off', modulation: 'Modulation', triggers: 'Triggers', notes: 'Notes', scenes: 'Scenes', aftertouch: 'Aftertouch' };
export const INPUT_SHORT = { modulation: 'mod', triggers: 'trig', notes: 'notes', scenes: 'scenes', aftertouch: 'AT', other: 'MIDI' };

// Why `use` can't be picked for input `inp` now, or null.
function blocked(view, inp, use) {
  const other = view.inputs[1 - inp.index];
  if (use === 'off') return null;
  if (inp.gateFor) return `It is the gate of input ${other.name}’s notes`;
  if (inp.index === 1 && inp.clockUse) return `Y is ${inp.clockUse} (Settings tab: external clock, start/stop)`;
  if (use === 'notes' && (other.player || (other.index === 1 && other.clockUse))) return `Notes take input ${other.name} as their gate, and it’s in use`;
  return null;
}

export function inputInspector(view, colors, i, onSelect, act) {
  const inp = view.inputs[i];
  const p = inp.player ? view.players.find((x) => x.id === inp.player) : null;
  const use = inputUse(p);
  const values = act.values();
  const name = `Input ${inp.name}`;
  const parts = [h('div', { class: 'ins-head', style: `--src:${p ? colors.get(p.id) ?? 'var(--faint)' : 'var(--faint)'}` },
    h('span', { class: 'icon' }, icon('input', 22)),
    h('div', { class: 'grow' }, h('h2', {}, name), h('span', { class: 'kind' }, 'CV in → MIDI, inside the FH-2')))];

  // what it does: a button per use
  const pick = (u) => act.edit(u === 'off' ? `${name} off` : `${name}: ${WORDS[u].toLowerCase()}`, useInput(values, view, i, u));
  parts.push(section('Turns CV into',
    h('div', { class: 'actions input-uses' }, ['off', ...INPUT_USES].map((u) => {
      const why = u === use ? null : blocked(view, inp, u);
      return h('button', { type: 'button', class: 'btn', 'aria-pressed': u === use ? 'true' : 'false', disabled: !!why, title: why ?? '', onclick: () => u !== use && pick(u) }, WORDS[u]);
    })),
    p && inp.index === 0 ? h('p', { class: 'note' }, 'X is also the FH-2’s clock input: while it turns CV into MIDI, it takes no clock.') : null,
    inp.gateFor ? h('p', { class: 'note' }, `The gate of input ${view.inputs[1 - i].name}’s notes.`) : null));
  if (!p) return parts;

  const set = (what, obj) => act.edit(`${what} of ${name}`, setInput(i, obj));
  const num = (label, key, min, max) => numberInput(`${label} of ${name}`, p[key], { min, max }, (v) => set(label, { [key]: v }));
  if (use === 'modulation') {
    // the settings it moves, and one more from any source's
    const objects = objectsOf(view);
    const named = new Map(objects.flatMap((o) => o.knobs.map((c) => [c.key, `${o.name} · ${c.label.toLowerCase()}`])));
    const moved = new Set(p.targets.map((m) => settingKey(m.target)));
    const add = h('select', { 'aria-label': `A setting for ${name} to move`, onchange: (e) => {
      const c = objects.flatMap((o) => o.knobs).find((x) => x.key === e.target.value);
      if (c) act.edit(`${name} moves ${named.get(c.key)}`, modulateFrom(values, p, c.setting));
    } }, h('option', { value: '' }, '+ Setting…'),
    objects.map((o) => {
      const free = o.knobs.filter((c) => !moved.has(c.key));
      return free.length ? h('optgroup', { label: o.name }, free.map((c) => h('option', { value: c.key }, c.label))) : null;
    }));
    parts.push(section('Moves',
      p.targets.length ? h('div', { class: 'erows' }, p.targets.map((m) => {
        const key = settingKey(m.target);
        return field(named.get(key) ?? key, h('button', { type: 'button', class: 'remove', 'aria-label': `${name} stops moving ${named.get(key) ?? key}`,
          title: 'Stops moving it (the mapping goes)', onclick: () => act.edit(`${name} no longer moves ${named.get(key) ?? key}`, [{ dump: 'config', path: ['mapping', m.slot, 'status'], value: 0x7f }]) }, '×'));
      })) : h('p', { class: 'note' }, 'Nothing yet: pick a setting.'),
      add));
    parts.push(section('Range',
      h('div', { class: 'erows' },
        field('At 0 V', num('CC at 0 V', 'level0v', 0, 127)),
        field('At 5 V', num('CC at 5 V', 'level5v', 0, 127))),
      h('p', { class: 'note' }, `CC values the settings get (each over its own range). 5 V below 0 V turns it round. Sent on ch ${p.channel + 1} · CC ${p.number}, inside the FH-2.`)));
    return parts;
  }
  if (use === 'triggers') parts.push(section('Trigger', h('div', { class: 'erows' }, field('Note', selectInput(`Note of ${name}`, p.number, NOTES, (v) => set('Note', { number: v }))))));
  if (use === 'notes') {
    parts.push(section('Notes', h('div', { class: 'erows' },
      field('At 0 V', selectInput(`Base note of ${name}`, p.number, NOTES, (v) => set('Base note', { number: v }))),
      field('Code at 0 V', num('Input code at 0 V', 'level0v', -8192, 8191)),
      field('Code at 5 V', num('Input code at 5 V', 'level5v', -8192, 8191))),
    h('p', { class: 'note' }, `Input ${view.inputs[1 - i].name} is the gate. The codes stand for 0 V and 5 V: 0 and 4096 to start, then tweak them to tune the input.`)));
  }
  if (use === 'scenes') {
    const pc = values.config.presetProgramChannel;
    parts.push(section('Scenes', h('div', { class: 'erows' },
      field('At 0 V', num('Program at 0 V', 'level0v', 0, 127)),
      field('At 5 V', num('Program at 5 V', 'level5v', 0, 127))),
    !pc ? h('p', { class: 'problem' }, 'Scenes by PC is off: give it a channel in the Settings tab.')
      : p.channel !== pc - 1 ? h('p', { class: 'problem' }, `Scenes change by PC on ch ${pc}, this sends on ch ${p.channel + 1}.`, ' ',
        h('button', { type: 'button', class: 'btn small', onclick: () => set('Channel', { channel: pc - 1 }) }, `Use ch ${pc}`))
      : h('p', { class: 'note' }, 'Program n loads the preset in slot n + 1.')));
    return parts;
  }
  // triggers, notes and aftertouch play on a channel: where they send, and what they play
  parts.push(...playerSends(view, colors, p, onSelect, act));
  return parts;
}
