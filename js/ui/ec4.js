// The EC4 tab: Night Shift's pages on the Faderfox EC4 (setup 15), one per source plus LIVE,
// laid out like the knobs. Pick a knob to see what it controls and to put it on LIVE.

import { h } from '../../vendor/lilypad/js/dom.js';
import { SETUP, KNOBS } from '../ec4/pages.js';

// `model`: pagesOf(); `sel`: { page, knob } or null. `act`: { select(page, knob), map(),
// send(), live(key), rename(pageId), busy, note (the EC4's state, one line) }.
export function renderEc4(view, model, colors, sel, act) {
  const { pages, extra, unmapped, channel } = model;
  const page = pages.find((p) => p.id === sel?.page) ?? pages[0];
  const first = page ? page.cells.findIndex(Boolean) : -1;
  const knob = page && sel?.page === page.id && sel.knob != null ? sel.knob : first;
  const sourceName = (id) => view.sources.find((s) => s.id === id)?.name ?? view.players.find((p) => p.id === id)?.name ?? null;
  const colorOf = (c) => (c?.source && colors.get(c.source)) || 'var(--faint)';

  const head = h('div', { class: 'ec4-head' },
    unmapped.length > 0 && h('button', { type: 'button', class: 'btn primary', disabled: act.busy, onclick: act.map,
      title: `Adds a CC mapping on ch ${channel + 1} for each knob that has none (undoable)` }, `Give ${unmapped.length} knobs a CC`),
    h('button', { type: 'button', class: 'btn' + (unmapped.length ? '' : ' primary'), disabled: act.busy || unmapped.length > 0 || !pages.length, onclick: act.send,
      title: unmapped.length ? 'Give every knob a CC first' : `Writes the pages to EC4 setup ${SETUP + 1}; other setups stay as they are` }, 'Send to EC4'),
    h('span', { class: 'note' }, `Setup ${SETUP + 1} · ${pages.length} pages · CCs on ch ${channel + 1}`),
    act.note && h('span', { class: 'note' }, act.note));

  const groups = h('nav', { class: 'ec4-groups', 'aria-label': 'Pages' },
    pages.map((pg) => h('button', { type: 'button', 'aria-pressed': pg === page ? 'true' : 'false', style: `--src:${pg.source ? colors.get(pg.source) ?? 'var(--faint)' : 'var(--text)'}`,
      onclick: () => act.select(pg.id, null) },
      h('span', { class: 'n' }, String(pg.group + 1)),
      h('span', { class: 'name' }, pg.name),
      h('span', { class: 'src' }, pg.live ? 'yours' : pg.sub ?? sourceName(pg.source) ?? ''))),
    extra.length > 0 && h('p', { class: 'problem' }, `${extra.length} more don’t fit: ${extra.map((p) => p.name).join(', ')}`));

  if (!page) return h('div', { class: 'ec4-page' }, head, h('p', { class: 'note' }, 'Nothing a knob could change yet.'));

  const address = (c) => (!c.map ? 'no CC yet'
    : `ch\u00a0${c.map.channel + 1} · CC\u00a0${c.map.cc}${c.map.bits === 14 ? '/' + (c.map.cc + 32) : ''}${c.map.relative ? ' · rel' : ''}`);
  const display = h('div', { class: 'ec4-display', role: 'img', 'aria-label': `EC4 display: ${page.cells.map((c) => c?.short ?? '').join(' ')}` },
    page.cells.map((c, i) => h('span', { class: i === knob ? 'on' : '' }, c ? c.short : '')));
  const knobs = h('div', { class: 'ec4-knobs' }, page.cells.map((c, i) => h('button', {
    type: 'button', class: 'tile' + (c ? '' : ' free') + (c && !c.map ? ' unmapped' : '') + (c?.gone ? ' gone' : ''),
    'aria-pressed': i === knob ? 'true' : 'false', style: `--src:${colorOf(c)}`, disabled: !c,
    'aria-label': c ? `Knob ${i + 1}: ${c.label}` : `Knob ${i + 1}: free`, onclick: () => act.select(page.id, i),
  },
  h('span', { class: 'short' }, c ? c.short : '····'),
  h('span', { class: 'label' }, c ? c.label : 'free'),
  c && h('span', { class: 'addr' }, address(c), c.onLive && !page.live ? ' · LIVE' : ''))));

  const face = h('section', { class: 'ec4-face', 'aria-label': `Page ${page.name}` },
    h('div', { class: 'ec4-title' },
      h('h3', {}, `Page ${page.group + 1} · `, h('span', { class: 'mono' }, page.name)),
      h('button', { type: 'button', class: 'btn small', onclick: () => act.rename(page.id), title: 'Four characters, shown on the EC4' }, 'Rename')),
    display, knobs);

  const c = page.cells[knob];
  const row = (k, v) => h('div', { class: 'erow' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));
  const detail = c && h('aside', { class: 'ec4-knob', 'aria-label': 'Selected knob' },
    h('h3', {}, `Knob ${knob + 1} · `, h('span', { class: 'mono', style: `color:${colorOf(c)}` }, c.short)),
    h('div', { class: 'erows' },
      row('Controls', c.gone ? 'gone from the patch' : `${sourceName(c.source) ?? 'Global'} · ${c.label.toLowerCase()}`),
      row('Sends', address(c)),
      row('Resolution', !c.map ? '—' : c.map.relative ? 'relative (up/down)' : c.map.bits === 14 ? '14-bit' : '7-bit')),
    h('button', { type: 'button', class: 'btn', disabled: !c.onLive && model.liveFull, onclick: () => act.live(c.key),
      title: model.liveFull && !c.onLive ? `LIVE is full (${KNOBS} knobs)` : 'LIVE is a page of your own, from any source' },
    c.onLive || page.live ? 'Take off LIVE' : 'Put on LIVE'));

  return h('div', { class: 'ec4-page' }, head, h('div', { class: 'ec4' }, groups, face, detail));
}
