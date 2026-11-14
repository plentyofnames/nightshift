// The patch view's stage: source cards on the left, the rack on the right, and cables from
// the selected source to its jacks. MIDI cables run in a gutter on the cards' left side,
// from each player to what it plays. Everything sits at computed positions, so the cables
// can be drawn without measuring the page.

import { INPUT_SHORT } from './inputs.js';
import { inputUse } from '../patch/edit.js';
import { h } from '../../vendor/lilypad/js/dom.js';
import { rack } from '../patch/hardware.js';
import { icon, subline, shortLabel, sourceList, playerLine } from './look.js';

const GX = 40; // the gutter for MIDI cables, left of the cards
const CARD_W = 290;
const CARD_STEP = 64; // 56 + 8
const HEAD = 26;
const RX = GX + 360;
const RY = 40;
// The panels on one grid of jack rows, as on the hardware: an expander's 8 jacks on rows 0–7, the
// FH-2's outputs on rows 4–7 (two columns), its inputs X and Y and its USB ports on rows 2–3.
const PANEL_H = 572;
const W = { fh2: 200, cv: 100, gt: 100 };
const ROW0 = 108; // the first row, under the module's name
const PITCH = 56;
const rowY = (r) => ROW0 + PITCH * r;
const FH2_COLS = [52, 148];
const JACK_R = 13; // .jack is 26 px

// A BCR32 track (a voice with its extras, patch/bcrtracks.js) has a group of its own.
const of = (...kinds) => (s) => !s.track && kinds.includes(s.kind);
const GROUPS = [
  ['BCR32 tracks', (s) => !!s.track],
  ['Notes', of('voice', 'triggers')],
  ['Modulation', of('lfo', 'random')],
  ['Control', of('knobs', 'level')],
  ['Timing', of('clock', 'euclid')],
  ['USB devices', of('hid')],
];

// A small arp symbol after a voice's name while its arp is on; orange while it waits for a clock.
function arpMark(s) {
  if (!s.performance?.arp) return null;
  const w = s.arpWaits;
  return h('span', { class: 'arp-mark' + (w ? ' waits' : ''),
    title: !w ? 'Arpeggiator on' : w.stopped ? `Arp follows ${w.clock}, which has no pulses: plays nothing` : `Arp on at rate Ext: plays only while ${w.clock} runs` }, icon('arp', 12));
}

// FH-2 jack positions inside its panel.
const FH2_OUT = (i) => ({ x: FH2_COLS[i < 4 ? 0 : 1], y: rowY(4 + (i % 4)) });
const EXP_OUT = (j) => ({ x: 50, y: rowY(j) });

// "plays 2": the voices a shift register's notes play inside the FH-2.
const playsOfIn = (view) => (s) => {
  const n = view.players.find((p) => p.card === s.id)?.plays.length ?? 0;
  return n ? `plays ${n}` : '';
};

export function renderStage(view, colors, selected, onSelect) {
  const playsOf = playsOfIn(view);
  const nodes = [];
  const anchors = new Map(); // source id → { x, y }
  const midiAt = new Map(); // source or player id → y of its card's middle, for MIDI cables

  // ---- source cards
  let y = 40;
  nodes.push(h('div', { class: 'stage-title', style: `left:${GX}px;width:${CARD_W}px` }, h('span', {}, 'Sources')));
  for (const [title, inGroup] of GROUPS) {
    const list = view.sources.filter((s) => inGroup(s) && !s.parked && !s.jackless);
    if (!list.length) continue;
    nodes.push(h('div', { class: 'group-title', style: `top:${y}px;left:${GX}px` }, title));
    y += HEAD;
    for (const s of list) {
      const on = selected?.source === s.id || selected?.sources?.includes(s.id);
      const color = colors.get(s.id);
      anchors.set(s.id, { x: GX + CARD_W + 1, y: y + 28 });
      midiAt.set(s.id, y + 28);
      nodes.push(h('button', {
        type: 'button', class: 'card' + (s.idle || s.standby ? ' idle' : ''), 'aria-pressed': on ? 'true' : 'false',
        style: `top:${y}px;left:${GX}px;--src:${color}`, onclick: () => onSelect({ source: s.id }),
      },
      h('span', { class: 'icon' }, icon(s.kind)),
      h('span', { class: 'txt' }, h('span', { class: 'name' }, s.name, arpMark(s)), h('span', { class: 'sub' }, subline(s))),
      h('span', { class: 'count' }, `${s.ports.length} ${s.ports.length === 1 ? 'jack' : 'jacks'}`)));
      nodes.push(h('span', { class: 'anchor' + (on ? ' on' : ''), style: `left:${GX + CARD_W - 4}px;top:${y + 23}px;--src:${color}` }));
      y += CARD_STEP;
    }
    y += 10;
  }
  // ---- players: they make MIDI, not voltage, so they have no jacks
  nodes.push(h('div', { class: 'group-title', style: `top:${y}px;left:${GX}px` }, 'Players'));
  y += HEAD;
  for (const p of view.players.filter((x) => !x.card)) { // a shift register's notes show on its own card
    const on = selected?.player === p.id;
    midiAt.set(p.id, y + 28);
    nodes.push(h('button', {
      type: 'button', class: 'card', 'aria-pressed': on ? 'true' : 'false',
      style: `top:${y}px;left:${GX}px;--src:${colors.get(p.id) ?? 'var(--faint)'}`, onclick: () => onSelect({ player: p.id }),
    },
    h('span', { class: 'icon' }, icon(p.kind === 'random' ? 'random' : p.kind)),
    h('span', { class: 'txt' }, h('span', { class: 'name' }, p.name), h('span', { class: 'sub' }, p.kind === 'input' && p.typeIndex === 0 ? `moves ${p.targets.length} · ch ${p.channel + 1} CC ${p.number}` : playerLine(p))),
    h('span', { class: 'count' }, p.plays.length ? `plays ${p.plays.length}` : '')));
    y += CARD_STEP;
  }
  // Euclid patterns and shift registers without a jack: they clock players, restart LFOs, or play notes
  for (const s of view.sources.filter((x) => x.jackless)) {
    const on = selected?.source === s.id;
    midiAt.set(s.id, y + 28);
    nodes.push(h('button', {
      type: 'button', class: 'card' + (s.idle ? ' idle' : ''), 'aria-pressed': on ? 'true' : 'false',
      style: `top:${y}px;left:${GX}px;--src:${colors.get(s.id)}`, onclick: () => onSelect({ source: s.id }),
    },
    h('span', { class: 'icon' }, icon(s.kind)),
    h('span', { class: 'txt' }, h('span', { class: 'name' }, s.name), h('span', { class: 'sub' }, `${subline(s)} · no jack`)),
    h('span', { class: 'count' }, s.kind === 'random' ? playsOf(s) : s.clocks.length ? `clocks ${s.clocks.length}` : s.restarts.length ? `restarts ${s.restarts.length}` : '')));
    y += CARD_STEP;
  }
  nodes.push(h('button', { type: 'button', class: 'btn add-player', style: `top:${y}px;left:${GX}px`, onclick: () => onSelect({ addPlayer: true }) }, 'Set up a player…'));
  y += 44 + 10;

  const parked = view.sources.filter((s) => s.parked);
  if (parked.length) {
    const on = selected?.parked || parked.some((s) => s.id === selected?.source);
    const jacks = [...new Set(parked.flatMap((s) => s.ports.map((p) => p.jack)))];
    nodes.push(h('div', { class: 'group-title', style: `top:${y}px;left:${GX}px` }, 'Outside your rack'));
    y += HEAD;
    nodes.push(h('button', {
      type: 'button', class: 'card idle', 'aria-pressed': on ? 'true' : 'false',
      style: `top:${y}px;left:${GX}px;--src:var(--faint)`, onclick: () => onSelect({ parked: true }),
    },
    h('span', { class: 'icon' }, icon(parked[0].kind)),
    h('span', { class: 'txt' }, h('span', { class: 'name' }, sourceList(parked)), h('span', { class: 'sub' }, `on ${jacks.join(', ')}`)),
    h('span', { class: 'count' }, `${parked.length} ${parked.length === 1 ? 'source' : 'sources'}`)));
    y += CARD_STEP + 10;
  }
  const cardsBottom = y;

  // ---- the rack
  const modules = rack(view.hardware);
  const jackPos = new Map(); // output → { x, y }
  let x = RX;
  const rackW = modules.reduce((w, m) => w + W[m.kind] + 4, -4);
  nodes.push(h('div', { class: 'stage-title', style: `left:${RX}px;width:${rackW}px` },
    h('span', {}, 'Rack ', h('small', {}, '· ' + modules.map((m) => m.name).join(' + ')))));
  for (const m of modules) {
    const w = W[m.kind];
    nodes.push(modulePanel(m, x, w, view));
    m.outputs.forEach((out, j) => {
      const p = m.kind === 'fh2' ? FH2_OUT(j) : EXP_OUT(j);
      jackPos.set(out, { x: x + p.x, y: RY + p.y, num: String(j + 1) });
    });
    if (m.kind === 'fh2') nodes.push(...fh2Inputs(x, view, colors, selected, onSelect));
    x += w + 4;
  }

  // ---- jacks
  const selectedOutputs = new Set();
  const selectedSources = selected?.source ? [selected.source] : selected?.sources ?? [];
  for (const id of selectedSources) {
    const s = view.sources.find((x) => x.id === id);
    s?.ports.forEach((p) => p.output != null && selectedOutputs.add(p.output));
  }
  for (const [out, pos] of jackPos) {
    const o = view.outputs[out];
    const gens = o.ports.filter((p) => !p.layer);
    const shown = gens[0] ?? o.ports.find((p) => !p.standby);
    const src = shown && view.sources.find((s) => s.id === shown.source);
    const color = src ? colors.get(src.id) : null;
    const on = selectedOutputs.has(out);
    const clash = gens.length > 1;
    const label = clash ? `${gens.length} sources!` : src ? shortLabel(src, src.ports.find((p) => p.output === out) ?? shown) : 'free';
    const anySelected = selectedSources.length > 0;
    nodes.push(h('span', { class: 'jack-num', style: `left:${pos.x - 34}px;top:${pos.y - 7}px` }, pos.num));
    nodes.push(h('button', {
      type: 'button', class: 'jack' + (clash ? ' clash' : '') + (selected?.output === out ? ' selected' : ''),
      'aria-label': `Jack ${o.jack}: ${src ? label : 'nothing'}`,
      style: `left:${pos.x - JACK_R}px;top:${pos.y - JACK_R}px` + (color && !clash ? `;--ring:${on ? color : color + '88'};--ring-w:${on ? 4 : 2}px` : ''),
      onclick: () => onSelect({ output: out, sources: o.ports.map((p) => p.source) }),
    }));
    nodes.push(h('span', {
      class: 'jack-label' + (src ? ' used' : '') + (src && anySelected && !on ? ' dim' : '') + (on ? ' on' : ''),
      style: `left:${pos.x - 48}px;top:${pos.y + JACK_R + 2}px` + (color ? `;--src:${color}` : ''),
    }, label));
    if (o.lfo && !o.lfo.alone) nodes.push(h('span', { class: 'jack-extra', style: `left:${pos.x - 48}px;top:${pos.y + JACK_R + 14}px` }, '+ LFO'));
  }

  // ---- cables for the selected source(s)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'cables');
  const stageW = x;
  const stageH = Math.max(RY + PANEL_H + 84, cardsBottom + 10);
  svg.setAttribute('width', stageW);
  svg.setAttribute('height', stageH);
  for (const id of selectedSources) {
    const s = view.sources.find((x) => x.id === id);
    const a = anchors.get(id);
    if (!s || !a) continue;
    const color = colors.get(id);
    for (const p of s.ports) {
      const j = jackPos.get(p.output);
      if (!j) continue;
      const dx = j.x - a.x;
      const d = `M ${a.x} ${a.y} C ${Math.round(a.x + dx * 0.45)} ${a.y + 40}, ${Math.round(j.x - dx * 0.25)} ${j.y + 60}, ${j.x} ${j.y}`;
      for (const cls of ['shadow', 'cable']) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('class', cls);
        if (cls === 'cable') path.setAttribute('stroke', color);
        svg.append(path);
      }
      const plug = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      plug.setAttribute('cx', j.x);
      plug.setAttribute('cy', j.y);
      plug.setAttribute('r', 9);
      plug.setAttribute('fill', color);
      svg.append(plug);
    }
  }
  // ---- MIDI cables, in the gutter: faint always, bright when either end is selected
  const cardOf = (p) => p.card ?? p.id; // a shift register's notes start from its own card
  const pairs = view.players.flatMap((p) => p.plays.filter((sid) => midiAt.has(sid) && midiAt.has(cardOf(p))).map((sid) => [p, sid]));
  pairs.forEach(([p, sid], k) => {
    const y1 = midiAt.get(cardOf(p));
    const y2 = midiAt.get(sid);
    const bulge = Math.min(GX - 6, 12 + Math.abs(y1 - y2) / 14 + (k % 3) * 4);
    const on = selected?.player === p.id || selected?.source === sid || selected?.source === p.card;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${GX} ${y1} C ${GX - bulge} ${y1}, ${GX - bulge} ${y2}, ${GX} ${y2}`);
    path.setAttribute('class', 'midi' + (on ? ' on' : ''));
    path.setAttribute('stroke', colors.get(p.id) ?? 'currentColor');
    svg.append(path);
    for (const yy of [y1, y2]) {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', GX);
      dot.setAttribute('cy', yy);
      dot.setAttribute('r', on ? 4 : 3);
      dot.setAttribute('fill', colors.get(p.id) ?? 'currentColor');
      dot.setAttribute('class', 'midi-end' + (on ? ' on' : ''));
      svg.append(dot);
    }
  });
  // ---- clock links, also in the gutter: a Euclid pattern to what it clocks or restarts
  for (const s of view.sources.filter((x) => x.kind === 'euclid' && midiAt.has(x.id))) {
    const to = [...s.clocks.filter((c) => c.now).map((c) => c.select.player ?? c.select.source), ...s.restarts.map((o) => `lfo:${o}`)];
    to.filter((id) => midiAt.has(id)).forEach((id, k) => {
      const y1 = midiAt.get(s.id);
      const y2 = midiAt.get(id);
      const bulge = Math.min(GX - 4, 8 + Math.abs(y1 - y2) / 12 + (k % 3) * 3);
      const on = selected?.source === s.id || selected?.player === id || selected?.source === id;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${GX} ${y1} C ${GX - bulge} ${y1}, ${GX - bulge} ${y2}, ${GX} ${y2}`);
      path.setAttribute('class', 'clock-link' + (on ? ' on' : ''));
      path.setAttribute('stroke', colors.get(s.id) ?? 'currentColor');
      svg.append(path);
    });
  }
  nodes.push(svg);

  // ---- resources under the rack
  const r = view.resources;
  const pill = (name, v) => v && h('span', { class: 'pill' }, `${name} ${v[0]}/${v[1]}`);
  nodes.push(h('div', { class: 'stage-foot', style: `left:${RX}px;top:${RY + PANEL_H + 16}px;width:${rackW}px` },

    h('div', { class: 'pills', 'aria-label': 'FH-2 resources in use' },
      pill('MIDI→CV', r.converters), pill('Clocks', r.clocks), pill('Triggers', r.triggers), pill('Euclid', r.euclids),
      pill('Random', r.randoms), pill('CC maps', r.mappings), r.lfos && h('span', { class: 'pill' }, `LFOs ${r.lfos[0]}`))));

  return h('div', { class: 'stage', style: `width:${stageW}px;height:${stageH}px` }, nodes);
}

function modulePanel(m, x, w, view) {
  // Gate blocks 1–8 of an address are an FHX-8GT, 9–16 the ESX-8GT attached to it.
  const titles = { fh2: ['FH-2', '', 'FACTOTUM'], cv: ['FHX-8CV', m.name, m.internal], gt: [m.block & 1 ? 'ESX-8GT' : 'FHX-8GT', m.name, m.internal] };
  const [title, tag, foot] = titles[m.kind];
  const parts = [
    h('span', { class: 'screw', style: 'left:6px;top:6px' }),
    h('span', { class: 'screw', style: 'right:6px;bottom:6px' }),
    h('div', { class: 'm-title' }, title),
    h('div', { class: 'm-tag' }, tag),
    h('div', { class: 'm-foot' }, foot),
  ];
  if (m.kind === 'fh2') {
    const g = view.globals;
    parts.push(
      h('div', { class: 'fh2-display', style: 'left:25px;top:52px' },
        h('div', {}, h('span', {}, (g.name || 'config').slice(0, 16))),
        h('div', {}, h('span', {}, (g.presetName || '').slice(0, 12)), h('span', {}, g.tempo ? g.tempo.toFixed(1) : ''))),
      h('span', { class: 'knob', style: `left:${FH2_COLS[0] - 11}px;top:${rowY(1) - 22}px;width:18px;height:18px;background:#2c2f36;border:2px solid #4a4e57` }),
      h('span', { class: 'knob', style: `left:${FH2_COLS[1] - 25}px;top:${rowY(1) - 35}px;width:44px;height:44px;background:#1c1e23;border:3px solid #3a3d44` }),
      // USB A and USB C, standing as on the module, on the rows of inputs X and Y
      h('span', { class: 'usb', title: 'USB A', style: `left:${FH2_COLS[0] - 10}px;top:${rowY(2) - 17}px;width:16px;height:30px;border-radius:2px` }),
      h('span', { class: 'usb', title: 'USB C', style: `left:${FH2_COLS[0] - 7}px;top:${rowY(3) - 12}px;width:10px;height:20px;border-radius:5px` }),
    );
  }
  return h('div', { class: 'module', style: `left:${x}px;top:${RY}px;width:${w}px;height:${PANEL_H}px` }, parts);
}

// Inputs X and Y: what they turn their CV into, if anything; a click opens the input's panel.
function fh2Inputs(x, view, colors, selected, onSelect) {
  const out = [];
  ['X', 'Y'].forEach((name, i) => {
    const p = view.players.find((pl) => pl.id === `cvMidi:${i}`);
    const use = inputUse(p);
    const on = selected?.input === i || selected?.player === `cvMidi:${i}`;
    const cx = x + FH2_COLS[1];
    const cy = RY + rowY(2 + i);
    out.push(h('span', { class: 'jack-num', style: `left:${cx - 34}px;top:${cy - 7}px` }, name));
    out.push(h('button', { type: 'button', class: 'jack' + (on ? ' selected' : ''), 'aria-pressed': on ? 'true' : 'false',
      'aria-label': `Input ${name}: ${p ? `${use}${use === 'modulation' ? `, moves ${p.targets.length}` : ''}` : 'not turning CV into MIDI'}`, title: `Input ${name}`,
      style: `left:${cx - JACK_R}px;top:${cy - JACK_R}px;--src:${p ? colors.get(p.id) ?? '#9cc9ff' : '#8a91a0'}`, onclick: () => onSelect({ input: i }) }));
    out.push(h('span', { class: 'jack-label' + (p ? ' used' : ''), style: `left:${cx - 48}px;top:${cy + JACK_R + 2}px;--src:${p ? colors.get(p.id) ?? '#9cc9ff' : '#8a91a0'}` },
      p ? `in → ${INPUT_SHORT[use] ?? use}` : view.inputs[i].gateFor ? `gate of ${'XY'[1 - i]}` : 'in'));
  });
  return out;
}
