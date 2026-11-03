// The Scenes tab: one config and its scenes (presets), where each goes in the FH-2's flash,
// which program change calls it, what it changes against the first scene, and what in it this
// config doesn't use. The FH-2 itself doesn't tie presets to configs; this page does.

import { h } from '../../vendor/lilypad/js/dom.js';
import { selectInput } from './controls.js';
import { SLOTS } from '../patch/scenes.js';

// `m`: { configName, configSlot, programChannel (0 off, 1–16), scenesOnly,
//        scenes: [{ name, slot, current, onModule, differences, fit }] }
// `act`: { setScene(i), setSlot('config' | i, slot), saveAll(), toggleScenesOnly(), setProgramChannel(ch) }
export function renderScenes(m, act) {
  const slotOptions = [[0, '—'], ...SLOTS.map((n) => [n, `slot ${n}`])];
  const taken = m.scenes.map((s) => s.slot).filter(Boolean);
  const twice = new Set(taken.filter((n, i) => taken.indexOf(n) !== i));
  const ready = m.configSlot && m.scenes.every((s) => s.slot) && !twice.size;
  const first = m.scenes[0]?.name;

  const rows = m.scenes.map((s, i) => h('tr', { class: s.current ? 'current' : '' },
    h('td', {}, h('button', { type: 'button', class: 'linkish', onclick: () => act.setScene(i) }, s.name),
      s.onModule ? h('span', { class: 'tag on-module' }, 'on the FH-2') : null),
    h('td', {}, selectInput(`Flash slot of scene ${s.name}`, s.slot ?? 0, slotOptions, (v) => act.setSlot(i, v || null)),
      twice.has(s.slot) ? h('small', { class: 'warn' }, 'used twice') : null),
    h('td', { class: 'pc' }, m.programChannel && s.slot ? `${s.slot} on ch ${m.programChannel}` : '—'),
    h('td', {}, i === 0 ? h('span', { class: 'dim' }, 'the first scene') : s.differences.length ? s.differences.join(', ') : h('span', { class: 'dim' }, `the same as ${first}`)),
    h('td', {}, s.fit.length ? s.fit.map((f) => h('div', { class: 'warn' }, f)) : h('span', { class: 'dim' }, 'fits'))));

  return h('section', { class: 'scenes-page' },
    h('h2', {}, `Scenes of “${m.configName}”`),
    h('div', { class: 'scenes-controls' },
      h('label', {}, 'Config goes to ', selectInput('Flash slot of the config', m.configSlot ?? 0, slotOptions, (v) => act.setSlot('config', v || null))),
      h('label', {}, 'Switch scenes by program change on ', selectInput('Preset program change channel', m.programChannel, [[0, 'off'], ...Array.from({ length: 16 }, (_, c) => [c + 1, `ch ${c + 1}`])], act.setProgramChannel)),
      h('button', { type: 'button', class: 'btn', 'aria-pressed': m.scenesOnly ? 'true' : 'false', onclick: act.toggleScenesOnly,
        title: 'Only what a scene holds can change' }, m.scenesOnly ? 'Scenes only: on' : 'Scenes only: off')),
    h('table', { class: 'scenes-table' },
      h('thead', {}, h('tr', {}, ['Scene', 'Flash slot', 'Program change', `Changes against ${first ?? 'the first'}`, 'Fit'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows)),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn primary', disabled: !ready, onclick: act.saveAll,
        title: ready ? '' : 'Give the config and every scene a slot of its own first' }, 'Save all to flash')),
    m.programChannel ? h('p', { class: 'note' }, 'Program change N loads slot N (check 17).') : null);
}
