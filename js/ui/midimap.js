// The read-only MIDI map: who sends and who listens on each channel.

import { h } from '../../vendor/lilypad/js/dom.js';
import { PARAM_NAMES } from '../patch/tables.js';

export function renderMidiMap(view, colors) {
  const rows = [h('div', { class: 'mrow head' }, h('span', {}, 'CH'), h('span', {}, 'SENT INSIDE THE FH-2'), h('span', {}, 'LISTENING'))];
  let free = [];
  const flushFree = () => {
    if (!free.length) return;
    const label = free.length === 1 ? `${free[0] + 1}` : `${free[0] + 1}–${free[free.length - 1] + 1}`;
    rows.push(h('div', { class: 'mrow' }, h('span', { class: 'ch', style: 'color:var(--faint)' }, label), h('span', { class: 'note' }, '—'), h('span', { class: 'note' }, 'free')));
    free = [];
  };
  for (const c of view.channels) {
    if (!c.senders.length && !c.listeners.length) {
      free.push(c.channel);
      continue;
    }
    flushFree();
    rows.push(h('div', { class: 'mrow' },
      h('span', { class: 'ch' }, String(c.channel + 1)),
      h('span', { class: 'list' }, c.senders.length ? c.senders.map((s) => h('span', { class: 'tag' }, s.name)) : h('span', { class: 'note' }, 'only from outside')),
      h('span', { class: 'list' }, groupListeners(c.listeners).map((l) =>
        h('span', { class: 'tag', style: l.source ? `--src:${colors.get(l.source)}` : undefined }, h('i'), l.text)))));
  }
  flushFree();
  return [
    h('div', { class: 'midimap' }, rows),
  ];
}

// One tag per source, and the CC mappings of a channel summarised.
function groupListeners(list) {
  const out = list.filter((l) => l.source).map((l) => ({ source: l.source, text: `${l.name} · ${l.what}` }));
  const ccs = list.filter((l) => l.mapping != null);
  if (ccs.length) {
    const shown = ccs.slice(0, 6).map((l) => `${l.name} ${PARAM_NAMES[l.what] ?? l.what}`).join(', ');
    out.push({ text: ccs.length > 6 ? `${shown} and ${ccs.length - 6} more` : shown });
  }
  return out;
}
