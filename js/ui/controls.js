// Inputs for the inspector and the editors. Each commits on change (Enter, leaving the field,
// letting go of a slider), not on every keystroke, and carries a data-key so a redraw keeps
// the focus on it.

import { h } from '../../vendor/lilypad/js/dom.js';
import { RANGE_VOLTS, levelToVolts, voltsToLevel } from '../patch/tables.js';

export function numberInput(label, value, { min, max, step = 1 }, commit) {
  return h('input', {
    type: 'number', class: 'num', 'aria-label': label, 'data-key': label, min, max, step, value,
    onchange: (e) => {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v)) commit(Math.min(max, Math.max(min, v)));
    },
  });
}

export function voltsInput(label, level, range, commit) {
  const [lo, hi] = RANGE_VOLTS[range] ?? RANGE_VOLTS[0];
  return [numberInput(label, levelToVolts(level, range).toFixed(3), { min: lo, max: hi, step: 0.001 }, (v) => commit(voltsToLevel(v, range))), ' V'];
}

// Marks a settings row (with a .k label) as kept per scene, i.e. in the preset: a dot before
// its label. While “Scenes only” is on, only these rows stay editable.
export function perScene(row) {
  row.classList.add('per-scene');
  row.querySelector('.k')?.prepend(h('span', { class: 'scene-dot', title: 'Kept per scene' }));
  return row;
}

// A setting's name that a click puts on the EC4 or takes off again (ec4/pages.js): in its own
// colour when a knob can control the setting, with a ring after it, filled while it is on.
// `ec4` is { state(key) → { on, title } or null, toggle(key) }; without one, or for a setting
// no knob can control, it is the plain text.
export function ec4Label(text, key, ec4) {
  const st = ec4?.state(key);
  if (!st) return text;
  return h('button', { type: 'button', class: 'ec4-able' + (st.on ? ' on' : ''), 'aria-pressed': st.on ? 'true' : 'false', title: st.title,
    onclick: () => ec4.toggle(key) }, text, h('span', { class: 'ec4-dot', 'aria-hidden': 'true' }));
}

// `options` is [[value, text]]; values may be numbers, which come back as numbers.
export function selectInput(label, value, options, commit) {
  return h('select', {
    'aria-label': label, 'data-key': label,
    onchange: (e) => {
      const o = options[e.target.selectedIndex];
      if (o) commit(o[0]);
    },
  }, options.map(([v, text]) => h('option', { value: String(v), selected: String(v) === String(value) }, text)));
}

// A slider with its value shown beside it; `show` formats the value. While dragging, only the
// number updates (and `preview`, if given, for a live drawing); letting go commits.
export function slider(label, value, { min, max, show = String, preview }, commit) {
  const out = h('span', { class: 'slider-value' }, show(value));
  const input = h('input', {
    type: 'range', 'aria-label': label, 'data-key': label, min, max, step: 1, value,
    oninput: (e) => {
      out.textContent = show(+e.target.value);
      preview?.(+e.target.value);
    },
    onchange: (e) => commit(+e.target.value),
  });
  return h('span', { class: 'slider' }, input, out);
}
