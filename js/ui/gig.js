// The Gig tab: the pre-gig checklist (patch/gig.js), one line per thing to have right before
// playing without a computer, with a button where Night Shift can do it.

import { h } from '../../vendor/lilypad/js/dom.js';

const ACTIONS = { readFh2: 'Read FH-2 settings', saveAll: 'Save all', sendEc4: 'Send to EC4', scenes: 'Scenes tab' };

// `groups`: checklist(); `act`: { readFh2(), saveAll(), sendEc4(), scenes(), checks(), busy }
export function renderGig(groups, act) {
  const all = groups.flatMap((g) => g.items);
  const open = all.filter((i) => i.level === 'warn' || i.level === 'todo').length;
  const line = (i) => h('div', { class: `gig-item ${i.level}` },
    h('span', { class: 'dot', 'aria-label': { ok: 'fine', warn: 'to change', todo: 'not done yet', note: 'note' }[i.level] }),
    h('span', { class: 'text' }, i.text),
    i.action && h('button', { type: 'button', class: 'btn', disabled: act.busy, onclick: act[i.action] }, ACTIONS[i.action]));
  return h('section', { class: 'gig-page' },
    h('h2', {}, 'Before a gig', h('span', { class: open ? 'count warn' : 'count ok' }, open ? `${open} to do` : 'all set')),
    groups.map((g) => h('div', { class: 'section gig-group' },
      h('h3', {}, g.title, g.note && h('span', { class: 'note' }, ` · ${g.note}`)),
      g.items.map(line))),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: act.checks, title: 'Tests on the FH-2 and EC4 themselves (scene changes, power-on, Func + Group)' }, 'Hardware checks')));
}
