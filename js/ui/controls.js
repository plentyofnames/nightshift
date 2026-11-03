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
