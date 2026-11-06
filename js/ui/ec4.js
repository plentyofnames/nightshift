// The EC4 tab: Night Shift's pages on the Faderfox EC4 (setup 15), one per object whose
// settings are switched on (in the Patch tab), plus LIVE, laid out like the knobs. Pick a knob
// to see what it controls and to put it on LIVE; a free knob takes any other setting of the
// page's object (on LIVE, of any object).

import { halfFree } from '../ec4/pages.js';
import { MODE_NAMES, SPEEDS, sweepOf } from '../ec4/feel.js';
import { h } from '../../vendor/lilypad/js/dom.js';
import { SETUP, KNOBS, GROUPS } from '../ec4/pages.js';

// A knob being dragged: 'page|index' (dataTransfer only says what it holds once dropped).
const DRAG = 'text/x-ec4-knob';
const dragged = (e) => {
  const [page, i] = (e.dataTransfer.getData(DRAG) || '').split('|');
  return page ? { page, i: Number(i) } : null;
};

// `model`: pagesOf(); `sel`: { page, knob } or null. `act`: { select(page, knob), pick(page,
// knob) (a free knob), takeOff(page, knob), off(key), live(key, livePage or null for a new one),
// addLive(), removeLive(pageId), move(page, from, to), toLive(fromPage, knob, livePage),
// addPage(pageId), whole(pageId), map(), send(), rename(pageId), stray (mappings on no page),
// tidy(), busy, note (the EC4's state, one line), link ({ ours, setup, group } while linked,
// else null), thru, toggleThru() }. Knobs are dragged to another place (they swap) or onto a
// LIVE page in the list. A place holds a knob, a push, or both; a push alone is selected like a knob
// (and taken off there). Pages past the 16th can be opened too, to take things off them.
export function renderEc4(view, model, colors, sel, act) {
  const { pages, extra, unmapped, channel } = model;
  const hidden = model.hidden ?? [];
  const page = [...pages, ...extra, ...hidden].find((p) => p.id === sel?.page) ?? pages[0];
  const first = page ? page.cells.findIndex((c, i) => c || page.pushes[i]) : -1;
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
    // with controlfrog 0.13 the EC4 shows your edits from its RAM already: this stores them
    h('button', { type: 'button', class: 'btn' + (unmapped.length ? '' : ' primary'), disabled: act.busy || unmapped.length > 0 || !pages.length, onclick: act.send,
      title: unmapped.length ? 'Give every knob and push a CC first' : `Writes the pages to EC4 setup ${SETUP + 1}; other setups stay as they are` }, act.link?.edits ? 'Store on EC4' : 'Send to EC4'),
    act.unstored && h('span', { class: 'note warn-note', title: 'The EC4 shows them from its RAM; stored, they stay after power-off' }, 'Not stored'),
    h('span', { class: 'note' }, `Setup ${SETUP + 1} · ${pages.length} page${pages.length === 1 ? "" : "s"} · CCs on ch ${channel + 1}`),
    h('span', { class: 'note', title: act.note || '' }, !act.link ? 'EC4 not linked'
      : act.link.ours ? `Linked · EC4 on page ${act.link.group + 1}` : `EC4 on setup ${act.link.setup + 1}`),
    // how fast every knob turns, unless you picked otherwise for one (feel.js)
    h('span', { class: 'ec4-speed', title: 'How far you turn for a whole setting, the same for all' }, 'Knob speed ',
      SPEEDS.map(([v, label]) => h('button', { type: 'button', class: 'btn small', 'aria-pressed': act.speed === v ? 'true' : 'false', onclick: () => act.speed !== v && act.setSpeed(v) }, label))),
    h('button', { type: 'button', class: 'btn small', 'aria-pressed': act.thru ? 'true' : 'false', onclick: act.toggleThru,
      title: 'Passes the EC4’s knobs on to the FH-2. Off while Logic does that.' }, act.thru ? 'Thru on' : 'Thru off'),
    act.stray.length > 0 && h('span', { class: 'note' }, `${act.stray.length} CCs on no page`,
      ' ', h('button', { type: 'button', class: 'btn small', onclick: act.tidy, title: act.stray.map((s) => s.label).join(', ') }, 'Remove them')),
    // knobs mapped before they were relative by default; the 14-bit ones stay in step through the
    // live link or the EC4's FH-2 sync, so Soft takeover would only make them wait (your call, 2026-11-04)
    act.relative.keys.length > 0 && h('span', { class: 'note' }, `${act.relative.keys.length} relative knob${act.relative.keys.length === 1 ? '' : 's'}`,
      ' ', h('button', { type: 'button', class: 'btn small', onclick: () => act.makeAbsolute(act.relative), title: 'The EC4 can show their values then (controlfrog 0.12 keeps them in step); Send to EC4 afterwards' }, 'Make absolute')),
    act.softTakeover && pages.some((pg) => pg.cells.some((c) => c?.map?.bits === 14)) && h('span', { class: 'note warn-note' }, 'Soft takeover on: not needed with the FH-2 sync',
      ' ', h('button', { type: 'button', class: 'btn small', onclick: act.turnOffSoftTakeover, title: 'With it, a knob waits until it passes the FH-2’s value' }, 'Turn off')));

  // objects without a page yet: a page for one takes its whole template
  const pageIds = new Set([...pages, ...extra].map((p) => p.id));
  const hasTemplate = (o) => o.template.cells.some(Boolean) || o.template.pushes.some(Boolean);
  const without = [...new Map(model.objects.filter((o) => !pageIds.has(o.page) && hasTemplate(o)).map((o) => [o.page, o])).values()];
  const addPage = without.length > 0 && h('select', { class: 'ec4-add', 'aria-label': 'Add a page', onchange: (e) => e.target.value && act.addPage(e.target.value) },
    h('option', { value: '' }, '+ Page for…'), without.map((o) => h('option', { value: o.page }, o.page === 'sequencers' ? 'Note sequencers' : o.name)));

  const room = pages.length + extra.length < GROUPS;
  const groups = h('nav', { class: 'ec4-groups', 'aria-label': 'Pages' },
    pages.map((pg) => h('button', { type: 'button', 'aria-pressed': pg === page ? 'true' : 'false', style: `--src:${pg.source ? colors.get(pg.source) ?? 'var(--faint)' : 'var(--text)'}`,
      onclick: () => act.select(pg.id, null),
      // a LIVE page takes a knob dropped on it
      ondragover: (e) => pg.live && e.dataTransfer.types.includes(DRAG) && (e.preventDefault(), e.currentTarget.classList.add('drop')),
      ondragleave: (e) => e.currentTarget.classList.remove('drop'),
      ondrop: (e) => {
        e.preventDefault();
        const d = dragged(e);
        if (d && pg.live) act.toLive(d.page, d.i, pg.id);
      } },
      h('span', { class: 'n' }, String(pg.group + 1)),
      h('span', { class: 'name' }, pg.name),
      h('span', { class: 'src' }, pg.live ? 'yours' : pg.sub ?? sourceName(pg.source) ?? ''))),
    extra.length > 0 && h('p', { class: 'problem' }, `${extra.length} more don’t fit: `, extra.map((pg, k) => [k ? ', ' : '',
      h('button', { type: 'button', class: 'linkish', onclick: () => act.select(pg.id, null), title: 'Open it, to take things off it' }, pg.name)])),
    hidden.length > 0 && h('p', { class: 'note' }, 'Hidden: ', hidden.map((pg, k) => [k ? ', ' : '',
      h('button', { type: 'button', class: 'linkish', onclick: () => act.select(pg.id, null), title: 'Off the EC4, its knobs and CCs kept' }, pg.name)])),
    addPage,
    h('button', { type: 'button', class: 'btn small ec4-add-live', disabled: !room, onclick: act.addLive,
      title: room ? 'A page of your own, from any source' : `${GROUPS} pages at most` }, '+ LIVE page'));

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
    style: `--src:${colorOf(c ?? page.pushes[i])}`,
    'aria-label': c ? `Knob ${i + 1}: ${c.label}` : page.pushes[i] ? `Knob ${i + 1}: free, push: ${page.pushes[i].label}` : `Knob ${i + 1}: free, add a setting`,
    'aria-pressed': (c || page.pushes[i]) && i === knob ? 'true' : 'false',
    onclick: () => (c || page.pushes[i] ? act.select(page.id, i) : act.pick(page.id, i)),
    draggable: !!(c || page.pushes[i]),
    ondragstart: (e) => {
      e.dataTransfer.setData(DRAG, `${page.id}|${i}`);
      e.dataTransfer.effectAllowed = 'move';
    },
    ondragover: (e) => e.dataTransfer.types.includes(DRAG) && (e.preventDefault(), e.currentTarget.classList.add('drop')),
    ondragleave: (e) => e.currentTarget.classList.remove('drop'),
    ondrop: (e) => {
      e.preventDefault();
      const d = dragged(e);
      if (d && d.page === page.id) act.move(page.id, d.i, i);
      else if (d && page.live) act.toLive(d.page, d.i, page.id);
    },
  },
  h('span', { class: 'short' }, c ? c.short : '····'),
  h('span', { class: 'label' }, c ? c.label : page.pushes[i] ? 'free knob' : '+ add'),
  page.pushes[i] && h('span', { class: 'push' }, `push: ${page.pushes[i].label}`),
  c && h('span', { class: 'addr' }, address(c), !page.live && c.lives?.length ? ` · ${c.lives.map((id) => model.lives.find((l) => l.id === id)?.name).join(', ')}` : ''))));

  const face = h('section', { class: 'ec4-face', 'aria-label': `Page ${page.name}` },
    h('div', { class: 'ec4-title' },
      h('h3', {}, page.group != null ? `Page ${page.group + 1} · ` : page.hidden ? 'Hidden · ' : 'Doesn’t fit · ', h('span', { class: 'mono' }, page.name),
        page.shared ? h('span', { class: 'dim' }, ` + ${page.shared.name} below`) : null),
      h('span', { class: 'actions' },
        // its place among the pages, on the EC4 or not, and a group shared with another half-page
        !page.hidden && [h('button', { type: 'button', class: 'btn small', 'aria-label': 'Earlier', title: 'One page earlier', disabled: page === pages[0], onclick: () => act.movePage(page.id, -1) }, '◀'),
          h('button', { type: 'button', class: 'btn small', 'aria-label': 'Later', title: 'One page later', disabled: page === [...pages, ...extra].at(-1), onclick: () => act.movePage(page.id, 1) }, '▶')],
        h('button', { type: 'button', class: 'btn small', onclick: () => act.hide(page.id, !page.hidden), title: page.hidden ? 'Back on the EC4' : 'Off the EC4; its knobs and CCs stay' }, page.hidden ? 'Show' : 'Hide'),
        page.shared ? h('button', { type: 'button', class: 'btn small', onclick: () => act.split(page.id), title: `${page.shared.name} back on a page of its own` }, 'Split')
          : halfFree(page) && (() => {
            const others = [...pages, ...extra, ...hidden].filter((pg) => pg !== page && halfFree(pg));
            return others.length > 0 && h('select', { class: 'ec4-share', 'aria-label': 'Share this page’s group with', title: 'Its top two rows here, the other page’s below',
              onchange: (e) => e.target.value && act.share(page.id, e.target.value) }, h('option', { value: '' }, 'Share with…'), others.map((pg) => h('option', { value: pg.id }, pg.name)));
          })(),
        fillable && h('button', { type: 'button', class: 'btn small', onclick: () => act.whole(page.id), title: 'Switches on the rest of the template' }, 'Whole page'),
        h('button', { type: 'button', class: 'btn small', onclick: () => act.rename(page.id), title: 'Four characters, shown on the EC4' }, 'Rename'),
        page.live && h('button', { type: 'button', class: 'btn small', onclick: () => act.removeLive(page.id), title: 'Its knobs come off it; undoable' }, 'Remove page'))),
    display, knobs);

  const c = page.cells[knob];
  const push = page.pushes[knob];
  const row = (k, v) => h('div', { class: 'erow' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));
  // the push under the knob: what it does, and taking it off (its CC goes too, if Night Shift added it)
  const pushRow = row('Push', push ? [`${push.gone ? 'gone from the patch' : push.label} · ${address(push)} `,
    h('button', { type: 'button', class: 'btn small', onclick: () => act.off(push.key), title: 'Off the EC4' }, 'Take off')] : '—');
  const placeRow = row('Place', h('select', { 'aria-label': `Place of knob ${knob + 1}`, onchange: (e) => act.move(page.id, knob, Number(e.target.value)) },
    page.cells.map((x, i) => h('option', { value: String(i), selected: i === knob },
      `${i + 1}${i === knob ? '' : x ? ` · swap with ${x.short}` : page.pushes[i] ? ` · swap with push ${page.pushes[i].label.toLowerCase()}` : ' · free'}`))));
  const pushOnly = !c && push && h('aside', { class: 'ec4-knob', 'aria-label': 'Selected push' },
    h('h3', {}, `Push ${knob + 1} · `, h('span', { class: 'mono', style: `color:${colorOf(push)}` }, push.short)),
    h('div', { class: 'erows' }, row('Controls', push.gone ? 'gone from the patch' : `${sourceName(push.source) ?? 'Global'} · ${push.label.toLowerCase()}`),
      row('Sends', address(push)), placeRow),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => act.pick(page.id, knob), title: 'A setting on the knob above it' }, '+ Knob'),
      h('button', { type: 'button', class: 'btn', onclick: () => act.off(push.key), title: 'Off the EC4' }, 'Take push off')));
  const detail = pushOnly || c && h('aside', { class: 'ec4-knob', 'aria-label': 'Selected knob' },
    h('h3', {}, `Knob ${knob + 1} · `, h('span', { class: 'mono', style: `color:${colorOf(c)}` }, c.short)),
    h('div', { class: 'erows' },
      row('Controls', c.gone ? 'gone from the patch' : `${sourceName(c.source) ?? 'Global'} · ${c.label.toLowerCase()}`),
      row('Sends', address(c)),
      row('Resolution', !c.map ? '—' : c.map.relative ? 'relative (up/down)' : c.map.bits === 14 ? '14-bit' : '7-bit'),
      c.feel && row('Feel', h('select', { 'aria-label': `Feel of knob ${knob + 1}`, onchange: (e) => act.setFeel(c.key, e.target.value || null) },
        h('option', { value: '', selected: c.feel === c.feelDefault && !c.feelMine }, `Default: ${c.feelDefault}`),
        MODE_NAMES.map((m) => h('option', { value: m, selected: c.feelMine && c.feel === m }, `${m}${sweepOf(m) && c.map.bits === 7 ? ` · ${sweepOf(m)} steps` : ''}`)))),
      pushRow,
      placeRow),
    // on a LIVE page of your own: each LIVE page is a button (on it, or off it; from a LIVE page, moved there)
    h('div', { class: 'actions' },
      model.lives.filter((l) => l.id !== page.id).map((l) => {
        const here = c.lives?.includes(l.id);
        return h('button', { type: 'button', class: 'btn', 'aria-pressed': page.live ? 'false' : here ? 'true' : 'false', disabled: !here && l.full,
          onclick: () => (page.live ? act.toLive(page.id, knob, l.id) : act.live(c.key, l.id)),
          title: !here && l.full ? `${l.name} is full (${KNOBS} knobs)` : page.live ? `Moves it to ${l.name}` : here ? `Takes it off ${l.name}` : `Puts it on ${l.name} too` },
        page.live ? `To ${l.name}` : here ? `On ${l.name}` : `Put on ${l.name}`);
      }),
      !page.live && !model.lives.length && h('button', { type: 'button', class: 'btn', disabled: !room, onclick: () => act.live(c.key, null),
        title: 'A page of your own, from any source' }, 'Put on LIVE'),
      h('button', { type: 'button', class: 'btn', onclick: () => (page.live ? act.takeOff(page.id, knob) : act.off(c.key)),
        title: page.live ? '' : 'Off the EC4, LIVE pages included' }, page.live ? `Take off ${page.name}` : 'Take off')));

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
