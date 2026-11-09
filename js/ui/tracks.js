// A BCR32 track's panel (docs/build-plan.md, "How a track shows up", your design 2026-11-09): its
// outputs switched on and off, the jack its row starts on and where its gates go. The voice's own
// settings (glide, envelope…) follow it, as for any voice (editors.js voiceEditor).

import { h } from '../../vendor/lilypad/js/dom.js';
import { selectInput } from './controls.js';
import { trackValues, trackLayout, trackPlan, trackEdits, trackStart } from '../patch/bcrtracks.js';

const field = (label, ...control) => h('div', { class: 'erow' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, control));

export function trackEditor(view, s, act) {
  const t = s.track.data;
  const layout = trackLayout(s);
  const set = (label, next) => {
    try {
      act.edit(`${s.name}: ${label}`, trackEdits(act.values(), view, t, s, { ...layout, ...next }));
    } catch (e) {
      act.status(`Couldn’t: ${e.message}`, true);
    }
  };
  const toggle = (v) => h('label', { class: 'check', title: v.how ? '' : v.why }, h('input', {
    type: 'checkbox', checked: layout.on.has(v.value), disabled: !v.how, 'data-key': `${s.name} ${v.value}`,
    onchange: (e) => {
      const on = new Set(layout.on);
      if (e.target.checked) on.add(v.value);
      else on.delete(v.value);
      set(`${v.value} ${e.target.checked ? 'on' : 'off'}`, { on });
    },
  }), v.value);
  const cvJacks = view.outputs.slice(0, 64).filter((o) => o.present).map((o) => [o.index, o.jack]);
  const gateJacks = view.outputs.slice(64).filter((o) => o.present).map((o) => [o.index, o.jack]);
  const plan = trackPlan(view, t, layout, s.id);
  const fits = plan.problems.length ? trackStart(view, t, layout, s.id) : null;
  const off = trackValues(t).filter((v) => !v.how && v.why);
  return [
    h('p', { class: 'note' }, `ch ${t.channel + 1} · ${t.machine}${t.muted ? ' · muted' : ''} · set on the BCR32`),
    h('h4', {}, 'Outputs'),
    h('div', { class: 'checks' }, trackValues(t).map(toggle)),
    off.length ? h('p', { class: 'note' }, off.map((v) => `${v.value}: ${v.why}`).join(' · ')) : null,
    h('div', { class: 'erows' },
      field('Starts at', selectInput(`Start jack of ${s.name}`, layout.start, cvJacks, (v) => set(`from ${view.outputs[v].jack}`, { start: v }))),
      field('Gates from', selectInput(`Gates of ${s.name}`, layout.gatesFrom, [[0, 'CV jacks, after the rest'], ...gateJacks],
        (v) => set(v ? `gates from ${view.outputs[v].jack}` : 'gates on CV jacks', { gatesFrom: v })))),
    plan.problems.map((x) => h('p', { class: 'problem' }, x.message)),
    fits != null && fits !== layout.start ? h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => set(`from ${view.outputs[fits].jack}`, { start: fits }) },
      `Start at ${view.outputs[fits].jack}: it fits there`)) : null,
  ];
}
