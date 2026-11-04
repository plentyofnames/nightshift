// The EC4 tab: Night Shift's pages on the Faderfox EC4 (setup 15), one per object whose
// settings are switched on (in the Patch tab), plus LIVE, laid out like the knobs. Pick a knob
// to see what it controls and to put it on LIVE; a free knob takes any other setting of the
// page's object (on LIVE, of any object).

import { h } from '../../vendor/lilypad/js/dom.js';
import { SETUP, KNOBS } from '../ec4/pages.js';

// `model`: pagesOf(); `sel`: { page, knob } or null. `act`: { select(page, knob), pick(page,
// knob) (a free knob), takeOff(page, knob), off(key), live(key), addPage(pageId), whole(pageId),
// map(), send(), rename(pageId), stray (mappings on no page), tidy(), busy, note (the EC4's
// state, one line), link ({ ours, setup, group } while linked, else null), thru, toggleThru() }.
export function renderEc4(view, model, colors, sel, act) {
  const { pages, extra, unmapped, channel } = model;
  const page = pages.find((p) => p.id === sel?.page) ?? pages[0];
  const first = page ? page.cells.findIndex(Boolean) : -1;
  const knob = page && sel?.page === page.id && sel.knob != null ? sel.knob : first;
  const sourceName = (id) => view.sources.find((s) => s.id === id)?.name ?? view.players.find((p) => p.id === id)?.name ?? null;
  const colorOf = (c) => (c?.source && colors.get(c.source)) || 'var(--faint)';

  const pushKeys = new Set(pages.flatMap((pg) => pg.pushes.filter(Boolean).map((c) => c.key)));
  const nPushes = unmapped.filter((k) => pushKeys.has(k)).length;
  const nKnobs = unmapped.length - nPushes;
  const what = [nKnobs && `${nKnobs} knobs`, nPushes && `${nPushes} pushes`].filter(Boolean).join(' and ');
  const head = h('div', { class: 'ec4-head' },
    unmapped.length > 0 && h('button', { type: 'button', class: 'btn primary', disabled: act.busy, onclick: act.map,
      title: `Adds a CC mapping on ch ${channel + 1} for each that has none (undoable)` }, `Give ${what} a CC`),
    h('button', { type: 'button', class: 'btn' + (unmapped.length ? '' : ' primary'), disabled: act.busy || unmapped.length > 0 || !pages.length, onclick: act.send,
      title: unmapped.length ? 'Give every knob and push a CC first' : `Writes the pages to EC4 setup ${SETUP + 1}; other setups stay as they are` }, 'Send to EC4'),
    h('span', { class: 'note' }, `Setup ${SETUP + 1} · ${pages.length} page${pages.length === 1 ? "" : "s"} · CCs on ch ${channel + 1}`),
    h('span', { class: 'note', title: act.note || '' }, !act.link ? 'EC4 not linked'
      : act.link.ours ? `Linked · EC4 on page ${act.link.group + 1}` : `EC4 on setup ${act.link.setup + 1}`),
    h('button', { type: 'button', class: 'btn small', 'aria-pressed': act.thru ? 'true' : 'false', onclick: act.toggleThru,
      title: 'Passes the EC4’s knobs on to the FH-2. Off while Logic does that.' }, act.thru ? 'Thru on' : 'Thru off'),
    act.stray.length > 0 && h('span', { class: 'note' }, `${act.stray.length} CCs on no page`,
      ' ', h('button', { type: 'button', class: 'btn small', onclick: act.tidy, title: act.stray.map((s) => s.label).join(', ') }, 'Remove them')),
    // knobs mapped before they were relative by default; the 14-bit ones stay in step through the
    // live link or the EC4's FH-2 sync, so Soft takeover would only make them wait (your call, 2026-11-04)
    act.relative.keys.length > 0 && h('span', { class: 'note' }, `${act.relative.keys.length} absolute knob${act.relative.keys.length === 1 ? '' : 's'}`,
      ' ', h('button', { type: 'button', class: 'btn small', onclick: () => act.makeRelative(act.relative), title: 'They can’t jump then; Send to EC4 afterwards' }, 'Make relative')),
    act.softTakeover && pages.some((pg) => pg.cells.some((c) => c?.map?.bits === 14)) && h('span', { class: 'note warn-note' }, 'Soft takeover on: not needed with the FH-2 sync',
      ' ', h('button', { type: 'button', class: 'btn small', onclick: act.turnOffSoftTakeover, title: 'With it, a knob waits until it passes the FH-2’s value' }, 'Turn off')));

  // objects without a page yet: a page for one takes its whole template
  const pageIds = new Set([...pages, ...extra].map((p) => p.id));
  const hasTemplate = (o) => o.template.cells.some(Boolean) || o.template.pushes.some(Boolean);
  const without = [...new Map(model.objects.filter((o) => !pageIds.has(o.page) && hasTemplate(o)).map((o) => [o.page, o])).values()];
  const addPage = without.length > 0 && h('select', { class: 'ec4-add', 'aria-label': 'Add a page', onchange: (e) => e.target.value && act.addPage(e.target.value) },
    h('option', { value: '' }, '+ Page for…'), without.map((o) => h('option', { value: o.page }, o.page === 'sequencers' ? 'Note sequencers' : o.name)));

  const groups = h('nav', { class: 'ec4-groups', 'aria-label': 'Pages' },
    pages.map((pg) => h('button', { type: 'button', 'aria-pressed': pg === page ? 'true' : 'false', style: `--src:${pg.source ? colors.get(pg.source) ?? 'var(--faint)' : 'var(--text)'}`,
      onclick: () => act.select(pg.id, null) },
      h('span', { class: 'n' }, String(pg.group + 1)),
      h('span', { class: 'name' }, pg.name),
      h('span', { class: 'src' }, pg.live ? 'yours' : pg.sub ?? sourceName(pg.source) ?? ''))),
    extra.length > 0 && h('p', { class: 'problem' }, `${extra.length} more don’t fit: ${extra.map((p) => p.name).join(', ')}`),
    addPage);

  if (!page) {
    return h('div', { class: 'ec4-page' }, head, h('div', { class: 'ec4' }, groups,
      h('p', { class: 'note' }, 'Click a setting’s name in the Patch tab to put it on the EC4.')));
  }
  const fillable = !page.live && model.objects.filter((o) => page.objects.includes(o.id))
    .some((o) => [...o.template.cells, ...o.template.pushes].some((k) => k && !model.on.has(k)));

  const address = (c) => (!c.map ? 'no CC yet'
    : `ch\u00a0${c.map.channel + 1} · CC\u00a0${c.map.cc}${c.map.bits === 14 ? '/' + (c.map.cc + 32) : ''}${c.map.relative ? ' · rel' : ''}`);
  const display = h('div', { class: 'ec4-display', role: 'img', 'aria-label': `EC4 display: ${page.cells.map((c) => c?.short ?? '').join(' ')}` },
    page.cells.map((c, i) => h('span', { class: i === knob ? 'on' : '' }, c ? c.short : '')));
  const knobs = h('div', { class: 'ec4-knobs' }, page.cells.map((c, i) => h('button', {
    type: 'button', class: 'tile' + (c ? '' : ' free') + (c && !c.map ? ' unmapped' : '') + (c?.gone ? ' gone' : ''),
    'aria-pressed': c && i === knob ? 'true' : 'false', style: `--src:${colorOf(c)}`,
    'aria-label': c ? `Knob ${i + 1}: ${c.label}` : `Knob ${i + 1}: free, add a setting`,
    onclick: () => (c ? act.select(page.id, i) : act.pick(page.id, i)),
  },
  h('span', { class: 'short' }, c ? c.short : '····'),
  h('span', { class: 'label' }, c ? c.label : '+ add'),
  page.pushes[i] && h('span', { class: 'push' }, `push: ${page.pushes[i].label}`),
  c && h('span', { class: 'addr' }, address(c), c.onLive && !page.live ? ' · LIVE' : ''))));

  const face = h('section', { class: 'ec4-face', 'aria-label': `Page ${page.name}` },
    h('div', { class: 'ec4-title' },
      h('h3', {}, `Page ${page.group + 1} · `, h('span', { class: 'mono' }, page.name)),
      h('span', { class: 'actions' },
        fillable && h('button', { type: 'button', class: 'btn small', onclick: () => act.whole(page.id), title: 'Switches on the rest of the template' }, 'Whole page'),
        h('button', { type: 'button', class: 'btn small', onclick: () => act.rename(page.id), title: 'Four characters, shown on the EC4' }, 'Rename'))),
    display, knobs);

  const c = page.cells[knob];
  const push = page.pushes[knob];
  const row = (k, v) => h('div', { class: 'erow' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));
  const detail = c && h('aside', { class: 'ec4-knob', 'aria-label': 'Selected knob' },
    h('h3', {}, `Knob ${knob + 1} · `, h('span', { class: 'mono', style: `color:${colorOf(c)}` }, c.short)),
    h('div', { class: 'erows' },
      row('Controls', c.gone ? 'gone from the patch' : `${sourceName(c.source) ?? 'Global'} · ${c.label.toLowerCase()}`),
      row('Sends', address(c)),
      row('Resolution', !c.map ? '—' : c.map.relative ? 'relative (up/down)' : c.map.bits === 14 ? '14-bit' : '7-bit'),
      row('Push', push ? `${push.label} · ${address(push)}` : '—')),
    h('div', { class: 'actions' },
      !page.live && h('button', { type: 'button', class: 'btn', disabled: !c.onLive && model.liveFull, onclick: () => act.live(c.key),
        title: model.liveFull && !c.onLive ? `LIVE is full (${KNOBS} knobs)` : 'LIVE is a page of your own, from any source' },
      c.onLive ? 'Take off LIVE' : 'Put on LIVE'),
      h('button', { type: 'button', class: 'btn', onclick: () => (page.live ? act.takeOff(page.id, knob) : act.off(c.key)),
        title: page.live ? '' : 'Off the EC4, LIVE included' }, page.live ? 'Take off LIVE' : 'Take off')));

  return h('div', { class: 'ec4-page' }, head, h('div', { class: 'ec4' }, groups, face, detail));
}

// ---- a small EC4 beside the rack: the page of the selected source, its knobs in the EC4's
// 4 × 4 order, each joined by a faint line to its setting in the inspector (sketchLines).

export function ec4Sketch(page, colors, linked) {
  if (!page) return null;
  const colorOf = (c) => (c?.source && colors.get(c.source)) || 'var(--faint)';
  return h('div', { class: 'ec4-sketch', role: 'img', 'aria-label': `EC4 page ${page.name}: ${page.cells.map((c) => c?.short ?? '-').join(' ')}` },
    h('div', { class: 'head' }, h('span', { class: 'mono' }, page.name), h('span', {}, linked ? 'on the EC4' : `EC4 page ${page.group + 1}`)),
    h('div', { class: 'grid' }, page.cells.map((c, i) => h('span', { class: 'kn' + (c ? '' : ' free'), 'data-knob': c?.key ?? '',
      style: `--src:${colorOf(c)}`, title: c ? `Knob ${i + 1}: ${c.label}` : `Knob ${i + 1}: free` }, h('i'), h('b', {}, c ? c.short : '')))));
}

const SVG = 'http://www.w3.org/2000/svg';

// Draws (again) the lines from the sketch's knobs to their settings in the inspector, in one
// SVG over the page; none for a setting scrolled out of sight.
export function sketchLines() {
  let svg = document.getElementById('ec4-lines');
  if (!svg) {
    svg = document.createElementNS(SVG, 'svg');
    svg.id = 'ec4-lines';
    svg.setAttribute('aria-hidden', 'true');
    document.body.append(svg);
  }
  svg.replaceChildren();
  const sketch = document.querySelector('.ec4-sketch');
  if (!sketch) return;
  for (const k of sketch.querySelectorAll('[data-knob]')) {
    const key = k.dataset.knob;
    const row = key && document.querySelector(`.inspector [data-ec4="${CSS.escape(key)}"]`);
    if (!row) continue;
    const a = k.querySelector('i').getBoundingClientRect();
    const b = row.getBoundingClientRect();
    if (b.bottom < 0 || b.top > innerHeight || !b.width) continue;
    const [x1, y1, x2, y2] = [a.right, a.top + a.height / 2, b.left - 3, b.top + b.height / 2];
    const mid = x1 + (x2 - x1) / 2;
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`);
    path.setAttribute('stroke', getComputedStyle(k).getPropertyValue('--src').trim() || 'currentColor');
    svg.append(path);
  }
}
