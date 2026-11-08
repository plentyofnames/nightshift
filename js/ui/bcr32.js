// The BCR32 tab: Night Shift's knobs on the BCR32's four pages (Rotary Club's controller), four
// rows of eight like the knobs. Night Shift's own knobs in their source's colour; the other knobs
// and the keys as the BCR32 has them (Eye of Providence's), dimmed: Night Shift leaves them alone.
// A free knob takes any setting; "+ Half for…" puts an object's template in a free half.

import { h } from '../../vendor/lilypad/js/dom.js';
import { MODE_NAMES, SPEEDS, sweepOf } from '../ec4/feel.js';
import { PAGES, KNOBS, ROW, freeHalf } from '../rotary/pages.js';

const DRAG = 'text/x-bcr32-knob'; // 'page|index'
const dragged = (e) => {
  const [page, i] = (e.dataTransfer.getData(DRAG) || '').split('|');
  return page !== '' && page != null ? { page: Number(page), index: Number(i) } : null;
};

// `bcr`: rotary/pages.js bcrPagesOf; `sel`: { page, knob }; `act`: { select(page, knob), pick(page, knob),
// takeOff(page, knob, push), move(from, to), putHalf(objPage), halves ([{ page, name }]), clear(page),
// rename(page), map(), send(), busy, note, link ({ page, controller } or null), unstored, thru,
// toggleThru(), speed, setSpeed(v), setFeel(key, mode), device ({ foreign: Map 'p:i' → { name, sends },
// pages: [{ name, keys, usb }] } or null: the image as last read) }.
export function renderBcr32(view, bcr, colors, sel, act) {
  const p = Math.max(0, Math.min(PAGES - 1, sel?.page ?? 0));
  const page = bcr.pages[p];
  const knob = sel?.knob ?? null;
  const dev = act.device;
  const foreign = (q, i) => dev?.foreign.get(`${q}:${i}`) ?? null;
  const sourceName = (id) => view.sources.find((s) => s.id === id)?.name ?? view.players.find((x) => x.id === id)?.name ?? null;
  const colorOf = (c) => (c?.source && colors.get(c.source)) || 'var(--faint)';
  const nameOf = (q) => bcr.pages[q].name ?? (dev?.pages[q]?.name || `P${q + 1}`);

  const { unmapped } = bcr;
  const head = h('div', { class: 'ec4-head' },
    unmapped.length > 0 && h('button', { type: 'button', class: 'btn primary', disabled: act.busy, onclick: act.map,
      title: `Adds a CC mapping on ch ${bcr.channel + 1} for each that has none (undoable)` }, `Give ${unmapped.length} a CC`),
    h('button', { type: 'button', class: 'btn' + (unmapped.length ? '' : ' primary'), disabled: act.busy || unmapped.length > 0, onclick: act.send,
      title: unmapped.length ? 'Give every knob and push a CC first' : 'Writes Night Shift’s knobs; other knobs and the keys stay as they are' }, act.link ? 'Store on BCR32' : 'Send to BCR32'),
    act.unstored && h('span', { class: 'note warn-note', title: 'Stored, they stay after power-off' }, 'Not stored'),
    h('span', { class: 'note' }, `${bcr.count} knob${bcr.count === 1 ? '' : 's'} · CCs on ch ${bcr.channel + 1}`),
    h('span', { class: 'note', title: act.note || '' }, !act.link ? 'BCR32 not linked' : act.link.controller ? `Linked · BCR32 on page ${act.link.page + 1}` : 'Linked · sequencer showing'),
    h('span', { class: 'ec4-speed', title: 'How far you turn for a whole setting, the same for all (EC4 too)' }, 'Knob speed ',
      SPEEDS.map(([v, label]) => h('button', { type: 'button', class: 'btn small', 'aria-pressed': act.speed === v ? 'true' : 'false', onclick: () => act.speed !== v && act.setSpeed(v) }, label))),
    h('button', { type: 'button', class: 'btn small', 'aria-pressed': act.thru ? 'true' : 'false', onclick: act.toggleThru,
      title: 'Passes Night Shift’s BCR32 knobs on to the FH-2. Off while Logic does that.' }, act.thru ? 'Thru on' : 'Thru off'));

  const halfOk = freeHalf(bcr, p, (q, i) => !!foreign(q, i)) >= 0;
  const pages = h('nav', { class: 'ec4-groups', 'aria-label': 'Pages' },
    bcr.pages.map((pg, q) => {
      const mine = pg.cells.filter((c, i) => c || pg.pushes[i]).length;
      return h('button', { type: 'button', 'aria-pressed': q === p ? 'true' : 'false', style: '--src:var(--text)',
        onclick: () => act.select(q, null),
        ondragover: (e) => q !== p && e.dataTransfer.types.includes(DRAG) && (e.preventDefault(), e.currentTarget.classList.add('drop')),
        ondragleave: (e) => e.currentTarget.classList.remove('drop'),
        ondrop: (e) => {
          e.preventDefault();
          const d = dragged(e);
          if (d) act.toPage(d, q);
        } },
      h('span', { class: 'n' }, `T${q + 1}`),
      h('span', { class: 'name' }, nameOf(q)),
      h('span', { class: 'src', title: 'Night Shift’s knobs on it' }, mine ? `${mine} knob${mine === 1 ? '' : 's'}` : '—'));
    }),
    act.halves.length > 0 && h('select', { class: 'ec4-add', 'aria-label': 'Fill a free half of this page', disabled: !halfOk,
      title: halfOk ? 'An object’s template into a free half of this page' : 'No free half on this page',
      onchange: (e) => e.target.value && act.putHalf(e.target.value) },
    h('option', { value: '' }, '+ Half for…'), act.halves.map((o) => h('option', { value: o.page }, o.name))));

  const address = (c) => (!c.map ? 'no CC yet'
    : `ch ${c.map.channel + 1} · CC ${c.map.cc}${c.map.bits === 14 ? '/' + (c.map.cc + 32) : ''}${c.map.relative ? ' · rel' : ''}`);
  const tile = (i) => {
    const c = page.cells[i];
    const push = page.pushes[i];
    const other = foreign(p, i);
    const mine = c || push;
    const cls = 'tile' + (mine ? '' : other ? ' foreign' : ' free') + (c && !c.map ? ' unmapped' : '') + (c?.gone ? ' gone' : '') + (mine && other ? ' clash' : '');
    return h('button', {
      type: 'button', class: cls, style: `--src:${colorOf(c ?? push)};grid-column:${(i % ROW) + 1 + (i % ROW >= 4 ? 1 : 0)}`, // a gap between the halves
      'aria-label': c ? `Knob ${i + 1}: ${c.label}` : push ? `Knob ${i + 1}: push ${push.label}` : other ? `Knob ${i + 1}: ${other.name || 'another app’s'}` : `Knob ${i + 1}: free, add a setting`,
      'aria-pressed': (mine || other) && i === knob ? 'true' : 'false',
      onclick: () => (mine || other ? act.select(p, i) : act.pick(p, i)),
      draggable: !!mine,
      ondragstart: (e) => {
        e.dataTransfer.setData(DRAG, `${p}|${i}`);
        e.dataTransfer.effectAllowed = 'move';
      },
      ondragover: (e) => e.dataTransfer.types.includes(DRAG) && (e.preventDefault(), e.currentTarget.classList.add('drop')),
      ondragleave: (e) => e.currentTarget.classList.remove('drop'),
      ondrop: (e) => {
        e.preventDefault();
        const d = dragged(e);
        if (d) act.move(d, { page: p, index: i });
      },
    },
    h('span', { class: 'short' }, c ? c.short : push ? '····' : other ? (other.name || '····') : '····'),
    h('span', { class: 'label' }, c ? c.label : push ? 'free knob' : other ? other.sends : '+ add'),
    push && h('span', { class: 'push' }, `push: ${push.label}`),
    c && h('span', { class: 'addr' }, address(c)),
    mine && other && h('span', { class: 'addr clash-note', title: 'Send asks before writing over it' }, `BCR32 has ${other.name || 'another knob'}`));
  };
  const knobs = h('div', { class: 'ec4-knobs bcr-knobs' }, Array.from({ length: KNOBS }, (_, i) => tile(i)));
  const keys = dev?.pages[p] && h('div', { class: 'bcr-keys', title: 'Keys 1–16 as the BCR32 has them: not Night Shift’s' },
    dev.pages[p].keys.map((k, j) => h('span', { class: k.sends ? '' : 'none', title: `Key ${j + 1}${k.sends ? `: ${k.sends}` : ': off'}` }, k.name || (k.sends ? '····' : ''))));

  const face = h('section', { class: 'ec4-face', 'aria-label': `Page ${p + 1}` },
    h('div', { class: 'ec4-title' },
      h('h3', {}, `Page ${p + 1} · `, h('span', { class: 'mono' }, nameOf(p)), page.name ? null : h('span', { class: 'dim' }, dev?.pages[p]?.name ? ' (the BCR32’s name)' : '')),
      h('span', { class: 'actions' },
        h('button', { type: 'button', class: 'btn small', onclick: () => act.rename(p), title: 'Four characters, shown on the BCR32' }, 'Rename'),
        page.cells.some(Boolean) || page.pushes.some(Boolean) ? h('button', { type: 'button', class: 'btn small', onclick: () => act.clear(p), title: 'Night Shift’s knobs off this page; undoable' }, 'Clear') : null)),
    dev?.pages[p] && !dev.pages[p].usb && (page.cells.some(Boolean) || page.pushes.some(Boolean))
      && h('p', { class: 'note warn-note' }, 'This page doesn’t send on USB (Eye of Providence’s outputs)'),
    keys, knobs);

  // the selected place: Night Shift's knob or push, or another app's knob
  const c = knob != null ? page.cells[knob] : null;
  const push = knob != null ? page.pushes[knob] : null;
  const other = knob != null ? foreign(p, knob) : null;
  const row = (k, v) => h('div', { class: 'erow' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));
  const placeRow = knob != null && row('Place', h('select', { 'aria-label': `Place of knob ${knob + 1}`, onchange: (e) => act.move({ page: p, index: knob }, { page: p, index: Number(e.target.value) }) },
    page.cells.map((x, i) => h('option', { value: String(i), selected: i === knob },
      `${i + 1}${i === knob ? '' : x ? ` · swap with ${x.short}` : page.pushes[i] ? ' · swap with a push' : foreign(p, i) ? ` · ${foreign(p, i).name || 'another’s'}` : ' · free'}`))));
  const pageRow = knob != null && row('Page', h('select', { 'aria-label': `Page of knob ${knob + 1}`, onchange: (e) => act.toPage({ page: p, index: knob }, Number(e.target.value)) },
    bcr.pages.map((_, q) => h('option', { value: String(q), selected: q === p }, `${q + 1} · ${nameOf(q)}`))));
  const clash = other && (c || push) && row('On the BCR32', `${other.name || 'a knob'} · ${other.sends} (another app’s): Send asks first`);
  let detail = null;
  if (c) {
    detail = h('aside', { class: 'ec4-knob', 'aria-label': 'Selected knob' },
      h('h3', {}, `Knob ${knob + 1} · `, h('span', { class: 'mono', style: `color:${colorOf(c)}` }, c.short)),
      h('div', { class: 'erows' },
        row('Controls', c.gone ? 'gone from the patch' : `${sourceName(c.source) ?? 'Global'} · ${c.label.toLowerCase()}`),
        row('Sends', address(c)),
        row('Resolution', !c.map ? '—' : c.map.relative ? 'relative (up/down)' : c.map.bits === 14 ? '14-bit' : '7-bit'),
        c.feel && row('Feel', h('select', { 'aria-label': `Feel of knob ${knob + 1}`, onchange: (e) => act.setFeel(c.key, e.target.value || null) },
          h('option', { value: '', selected: c.feel === c.feelDefault && !c.feelMine }, `Default: ${c.feelDefault}`),
          MODE_NAMES.map((m) => h('option', { value: m, selected: c.feelMine && c.feel === m }, `${m}${sweepOf(m) && c.map.bits === 7 ? ` · ${sweepOf(m)} steps` : ''}`)))),
        row('Push', push ? [`${push.gone ? 'gone from the patch' : push.label} · ${address(push)} `,
          h('button', { type: 'button', class: 'btn small', onclick: () => act.takeOff(p, knob, true) }, 'Take off')] : '—'),
        placeRow, pageRow, clash),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => act.takeOff(p, knob, false), title: 'Off the BCR32; the EC4 keeps its own' }, 'Take off')));
  } else if (push) {
    detail = h('aside', { class: 'ec4-knob', 'aria-label': 'Selected push' },
      h('h3', {}, `Push ${knob + 1} · `, h('span', { class: 'mono', style: `color:${colorOf(push)}` }, push.short)),
      h('div', { class: 'erows' }, row('Controls', push.gone ? 'gone from the patch' : `${sourceName(push.source) ?? 'Global'} · ${push.label.toLowerCase()}`),
        row('Sends', address(push)), placeRow, pageRow, clash),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => act.pick(p, knob), title: 'A setting on the knob above it' }, '+ Knob'),
        h('button', { type: 'button', class: 'btn', onclick: () => act.takeOff(p, knob, true) }, 'Take push off')));
  } else if (other) {
    detail = h('aside', { class: 'ec4-knob', 'aria-label': 'Another app’s knob' },
      h('h3', {}, `Knob ${knob + 1} · `, h('span', { class: 'mono dim' }, other.name || '····')),
      h('div', { class: 'erows' }, row('Sends', other.sends), row('Belongs to', 'another app (Eye of Providence)')),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => act.pick(p, knob), title: 'Send asks before writing over it' }, 'Put a setting here')));
  }
  return h('div', { class: 'ec4-page' }, head, h('div', { class: 'ec4 bcr' }, pages, face, detail ?? h('div')));
}
