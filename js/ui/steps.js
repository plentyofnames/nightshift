// The Steps tab: the four note sequencers and the drum sequencer of the scene in view, step by step,
// and the sequencer banks as files. A note sequence is lanes over its 32 steps (the note, the
// rhythm of sub-steps, the flags); a click on a step opens its editor below them, a click on a
// sub-step turns it off, on, or into a tie. The drum sequencer is a grid of 8 lanes × 32 steps
// (off, on, accent), each lane with its own range, rate, reset and mute. Everything here is the
// scene's preset: undoable, and sent to the FH-2 as your other edits are.

import { h } from '../../vendor/lilypad/js/dom.js';
import { numberInput, selectInput, perScene } from './controls.js';
import { DIVISIONS, noteName } from '../patch/tables.js';
import { playerLine } from './look.js';
import { noteSequence, setStep, setSequence, setSequenceOn, nextGate, stepPitch, stepNote, pitchLines, degreeName, drumSequence, setDrumStep, nextDrum, setLane, setDrums,
  DIRECTIONS, PERMUTATIONS, SEQUENCERS, STEPS, GATES } from '../patch/steps.js';

const field = (label, ...control) => h('label', { class: 'steps-field' }, h('span', {}, label), control);
const toggle = (label, on, onclick, title = '') => h('button', { type: 'button', class: 'btn small', 'aria-pressed': on ? 'true' : 'false', title, onclick }, label);
const RATES = (v) => {
  const list = [[0, 'Ext'], ...DIVISIONS];
  return list.some(([n]) => n === v) ? list : [...list, [v, `${v} pulses`]];
};
const range = (n) => Array.from({ length: n }, (_, i) => i);

// `sel`: { seq: 0–3, 'drums' or 'banks', step, lane }. `act`: { edit, select(sel), banks: {
// export(kind, index), import(kind) }, busy }.
export function renderSteps(view, values, sel, act) {
  if (!values.preset) return h('div', { class: 'steps-page' }, h('p', { class: 'note' }, 'No preset loaded: the steps are in the preset.'));
  const at = sel?.seq ?? 0;
  const player = (j) => view.players.find((p) => p.id === `noteSequencer:${j}`);
  const nav = h('nav', { class: 'steps-nav', 'aria-label': 'Sequencers' },
    range(SEQUENCERS).map((j) => h('button', { type: 'button', class: 'btn', 'aria-pressed': at === j ? 'true' : 'false', title: player(j) ? playerLine(player(j)) : 'Sends nowhere',
      onclick: () => act.select({ seq: j }) }, `Note seq ${j + 1}`, h('small', {}, player(j)?.plays.length ? ` · plays ${player(j).plays.map((id) => view.sources.find((s) => s.id === id)?.name).join(', ')}` : player(j) ? '' : ' · silent'))),
    h('button', { type: 'button', class: 'btn', 'aria-pressed': at === 'drums' ? 'true' : 'false', onclick: () => act.select({ seq: 'drums' }) }, 'Drums'),
    h('button', { type: 'button', class: 'btn', 'aria-pressed': at === 'banks' ? 'true' : 'false', onclick: () => act.select({ seq: 'banks' }) }, 'Banks'));
  const body = at === 'banks' ? banks(act) : at === 'drums' ? drums(values, sel, act) : notes(values, at, sel, act);
  return h('div', { class: 'steps-page' }, nav, body);
}

// ---- a note sequencer

function notes(values, j, sel, act) {
  const q = noteSequence(values.preset, j);
  const name = `note sequencer ${j + 1}`;
  const k = sel?.step ?? null;
  const set = (what, obj) => act.edit(`${what} of ${name}`, setSequence(j, obj));
  const step = (i, what, obj) => act.edit(`Step ${i + 1} of ${name}: ${what}`, setStep(j, i, obj));
  const inRange = (i) => i >= q.start && i <= q.end;
  const pick = (i) => act.select({ seq: j, step: i === k ? null : i });

  const settings = perScene(h('div', { class: 'steps-settings' },
    field('Rate', selectInput(`Rate of ${name}`, q.rate, RATES(q.rate), (v) => set('Rate', { rate: v }))),
    field('Gate', numberInput(`Gate length of ${name}`, q.gateLength, { min: 0, max: 127 }, (v) => set('Gate length', { gateLength: v })), q.gateLength ? '' : ' trigger'),
    field('Reset', numberInput(`Reset of ${name}`, q.reset, { min: 0, max: 127 }, (v) => set('Reset', { reset: v })), q.reset ? ' beats' : ' never'),
    field('Root', numberInput(`Root of ${name}`, q.rootNote, { min: 0, max: 127 }, (v) => set('Root', { rootNote: v }))),
    field('Direction', selectInput(`Direction of ${name}`, q.direction, DIRECTIONS.map((d, i) => [i, d]), (v) => set('Direction', { direction: v }))),
    field('Order', selectInput(`Permutation of ${name}`, q.permutation, PERMUTATIONS.map((d, i) => [i, d]), (v) => set('Permutation', { permutation: v }))),
    h('span', { class: 'note' }, `Steps ${q.start + 1}–${q.end + 1}`),
    toggle('On', q.active, () => act.edit(`${name} ${q.active ? 'off' : 'on'}`, setSequenceOn(j, { active: !q.active })), 'Runs in this scene'),
    toggle('Mute', q.muted, () => act.edit(`${name} ${q.muted ? 'unmuted' : 'muted'}`, setSequenceOn(j, { muted: !q.muted })))));

  const pitchOf = (s) => stepNote(s, q.rootNote);
  const low = Math.min(...q.steps.map(pitchOf));
  const high = Math.max(...q.steps.map(pitchOf), low + 1);
  const col = (i, ...children) => h('div', { class: 'steps-col' + (inRange(i) ? '' : ' out') + (i === k ? ' sel' : '') }, children);
  const grid = h('div', { class: 'steps-grid', style: `--steps:${STEPS}` },
    h('span', { class: 'lane-label' }, 'Step'),
    q.steps.map((s, i) => col(i, h('button', { type: 'button', class: 'step-num', 'aria-pressed': i === k ? 'true' : 'false', 'aria-label': `Step ${i + 1}`, onclick: () => pick(i) }, String(i + 1)))),
    h('span', { class: 'lane-label' }, 'Note'),
    q.steps.map((s, i) => col(i, h('button', { type: 'button', class: 'step-note', 'aria-label': `Step ${i + 1}: ${stepPitch(s, q.rootNote)}`, onclick: () => pick(i) },
      h('span', { class: 'bar', style: `height:${6 + Math.round((30 * (pitchOf(s) - low)) / (high - low))}px` }), h('span', { class: 'txt' }, pitchLines(s, q.rootNote).map((t) => h('span', {}, t)))))),
    h('span', { class: 'lane-label' }, 'Rhythm'),
    q.steps.map((s, i) => col(i, h('div', { class: 'step-gates' + (s.ratchet ? ' ratchet' : '') },
      s.gates.slice(0, s.length).map((g, n) => h('button', { type: 'button', class: `gate g${g}`, 'aria-label': `Step ${i + 1}, ${s.ratchet ? 'ratchet' : 'sub-step'} ${n + 1}: ${GATES[g]}`,
        onclick: () => step(i, `${GATES[nextGate(g)]} at ${n + 1}`, { gates: s.gates.map((x, m) => (m === n ? nextGate(g) : x)) }) }))))),
    h('span', { class: 'lane-label' }, 'Flags'),
    q.steps.map((s, i) => col(i, h('span', { class: 'step-flags' }, [s.reset && 'R', s.skip && 'S', s.mute && `M${s.mute}`].filter(Boolean).join(' ')))));

  return [settings, perScene(grid), k == null ? h('p', { class: 'note' }, 'Click a step to edit it; a sub-step turns off, on, or into a tie.') : perScene(stepEditor(q, k, step, set))];
}

function stepEditor(q, k, step, set) {
  const s = q.steps[k];
  const buttons = (n, from, now, label, change) => h('span', { class: 'steps-buttons' }, range(n).map((i) => h('button', { type: 'button', class: 'btn small',
    'aria-pressed': i + from === now ? 'true' : 'false', onclick: () => i + from !== now && change(i + from) }, label(i + from))));
  return h('section', { class: 'step-editor', 'aria-label': `Step ${k + 1}` },
    h('h3', {}, `Step ${k + 1} · ${stepPitch(s, q.rootNote)}`),
    h('div', { class: 'erows' },
      // as on the Launchpad: the scale's eight, and the eight between them
      row('Note', buttons(8, 0, s.degree, (d) => degreeName(d, q.rootNote), (v) => step(k, degreeName(v, q.rootNote), { degree: v })),
        buttons(8, 8, s.degree, (d) => degreeName(d, q.rootNote), (v) => step(k, degreeName(v, q.rootNote), { degree: v }))),
      row('Octave', buttons(8, 0, s.octave, String, (v) => step(k, `octave ${v}`, { octave: v }))),
      row('Length', buttons(8, 1, s.length, String, (v) => step(k, `${v} sub-steps`, { length: v })),
        toggle('Ratchet', s.ratchet, () => step(k, s.ratchet ? 'no ratchet' : 'ratchet', { ratchet: !s.ratchet }), 'The sub-steps share one step')),
      row('Mute', buttons(8, 0, s.mute, (v) => (v ? String(v) : 'Never'), (v) => step(k, v ? `mute ${v}` : 'never muted', { mute: v }))),
      row('Flags', toggle('Reset', s.reset, () => step(k, s.reset ? 'no reset' : 'reset', { reset: !s.reset }), 'The sequence starts again here'),
        toggle('Skip', s.skip, () => step(k, s.skip ? 'played' : 'skipped', { skip: !s.skip }))),
      row('Range', h('button', { type: 'button', class: 'btn small', disabled: k > q.end, onclick: () => set('Start', { start: k }) }, 'Starts here'),
        h('button', { type: 'button', class: 'btn small', disabled: k < q.start, onclick: () => set('End', { end: k }) }, 'Ends here'))));
}
const row = (label, ...v) => h('div', { class: 'erow' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, v));

// ---- the drum sequencer

function drums(values, sel, act) {
  const d = drumSequence(values.preset, values.config);
  const li = sel?.lane ?? 0;
  const lane = d.lanes[li];
  const name = `lane ${li + 1}`;
  const settings = perScene(h('div', { class: 'steps-settings' },
    field('Reset all', numberInput('Reset of the drum sequencer', d.reset, { min: 0, max: 127 }, (v) => act.edit('Reset of the drum sequencer', setDrums({ reset: v }))), d.reset ? ' beats' : ' never'),
    toggle('On', d.active, () => act.edit(`Drum sequencer ${d.active ? 'off' : 'on'}`, setDrums({ active: !d.active })), 'Runs in this scene'),
    toggle('Mute', d.muted, () => act.edit(`Drum sequencer ${d.muted ? 'unmuted' : 'muted'}`, setDrums({ muted: !d.muted })))));
  const grid = h('div', { class: 'steps-grid drums', style: `--steps:${STEPS}` },
    h('span', { class: 'lane-label' }, ''),
    range(STEPS).map((i) => h('span', { class: 'step-num plain' }, String(i + 1))),
    d.lanes.map((l) => [
      h('button', { type: 'button', class: 'lane-label linkish' + (l.index === li ? ' on' : '') + (l.mute ? ' muted' : ''), onclick: () => act.select({ seq: 'drums', lane: l.index }),
        title: `Lane ${l.index + 1}: note ${l.note}${l.mute ? ', muted' : ''}` }, `${l.index + 1} · ${noteName(l.note)}`),
      l.steps.map((v, i) => h('button', { type: 'button', class: `drum d${v}` + (i >= l.start && i <= l.end ? '' : ' out'), 'aria-label': `Lane ${l.index + 1}, step ${i + 1}: ${['off', 'on', 'accent'][v]}`,
        onclick: () => act.edit(`Lane ${l.index + 1}, step ${i + 1}: ${['off', 'on', 'accent'][nextDrum(v)]}`, setDrumStep(values.preset, l.index, i, nextDrum(v))) })),
    ]));
  const set = (what, obj) => act.edit(`${what} of ${name}`, setLane(li, obj));
  const laneEditor = h('section', { class: 'step-editor', 'aria-label': `Lane ${li + 1}` },
    h('h3', {}, `Lane ${li + 1} · ${noteName(lane.note)}`),
    h('div', { class: 'steps-settings' },
      field('First', numberInput(`First step of ${name}`, lane.start + 1, { min: 1, max: lane.end + 1 }, (v) => set('First step', { start: v - 1 }))),
      field('Last', numberInput(`Last step of ${name}`, lane.end + 1, { min: lane.start + 1, max: STEPS }, (v) => set('Last step', { end: v - 1 }))),
      field('Rate', selectInput(`Rate of ${name}`, lane.rate, RATES(lane.rate), (v) => set('Rate', { rate: v }))),
      field('Reset', numberInput(`Reset of ${name}`, lane.reset, { min: 0, max: 127 }, (v) => set('Reset', { reset: v })), lane.reset ? ' beats' : ' never'),
      toggle('Mute', lane.mute, () => set(lane.mute ? 'Unmuted' : 'Muted', { mute: !lane.mute }))),
    h('p', { class: 'note' }, 'Click a step: off, on, accent. The lane’s note is in its player panel.'));
  return [settings, perScene(grid), perScene(laneEditor)];
}

// ---- the banks: 8 note and 8 drum sequencer banks in flash (28 sequences each), and the active ones

function banks(act) {
  const list = (kind, title) => h('section', { class: 'step-editor' }, h('h3', {}, title),
    h('div', { class: 'steps-buttons' },
      h('button', { type: 'button', class: 'btn small', disabled: act.busy, onclick: () => act.banks.export(kind, 0), title: 'The one in use, as a .syx file' }, 'Export active'),
      range(8).map((i) => h('button', { type: 'button', class: 'btn small', disabled: act.busy, onclick: () => act.banks.export(kind, i + 1), title: `Bank ${i + 1} in flash, as a .syx file` }, `Bank ${i + 1}`))),
    h('div', { class: 'steps-buttons' }, h('button', { type: 'button', class: 'btn small', disabled: act.busy, onclick: () => act.banks.import(kind), title: 'A .syx file of such a bank becomes the active one (RAM)' }, 'Import into active…')));
  return [list('notes', 'Note sequencer banks'), list('drums', 'Drum sequencer banks'),
    h('p', { class: 'note' }, '28 sequences per bank, as one file. To keep an import: Sequencer Banks › Save on the FH-2.')];
}
