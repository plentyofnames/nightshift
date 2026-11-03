// The patch view's stage: source cards on the left, the rack on the right, and cables from
// the selected source to its jacks. MIDI cables run in a gutter on the cards' left side,
// from each player to what it plays. Everything sits at computed positions, so the cables
// can be drawn without measuring the page.

import { h } from '../../vendor/lilypad/js/dom.js';
import { rack } from '../patch/hardware.js';
import { icon, subline, shortLabel, sourceList, playerLine } from './look.js';

const GX = 40; // the gutter for MIDI cables, left of the cards
const CARD_W = 290;
const CARD_STEP = 64; // 56 + 8
const HEAD = 26;
const RX = GX + 360;
const RY = 40;
const PANEL_H = 707;
const W = { fh2: 224, cv: 112, gt: 112 };

const GROUPS = [
  ['Notes', ['voice', 'triggers']],
  ['Modulation', ['lfo', 'random']],
  ['Control', ['knobs', 'level']],
  ['Timing', ['clock', 'euclid']],
  ['USB devices', ['hid']],
];

// A small arp symbol after a voice's name while its arp is on; orange while it waits for a clock.
function arpMark(s) {
  if (!s.performance?.arp) return null;
  const w = s.arpWaits;
  return h('span', { class: 'arp-mark' + (w ? ' waits' : ''),
    title: !w ? 'Arpeggiator on' : w.stopped ? `Arp follows ${w.clock}, which has no pulses: plays nothing` : `Arp on at rate Ext: plays only while ${w.clock} runs` }, icon('arp', 12));
}

// FH-2 jack positions inside its panel.
const FH2_OUT = (i) => ({ x: i < 4 ? 62 : 162, y: 362 + 70 * (i % 4) });
const EXP_OUT = (j) => ({ x: 56, y: 140 + 68 * j });

export function renderStage(view, colors, selected, onSelect) {
  const nodes = [];
  const anchors = new Map(); // source id → { x, y }
  const midiAt = new Map(); // source or player id → y of its card's middle, for MIDI cables

  // ---- source cards
  let y = 40;
  nodes.push(h('div', { class: 'stage-title', style: `left:${GX}px;width:${CARD_W}px` }, h('span', {}, 'Sources')));
  for (const [title, kinds] of GROUPS) {
    const list = view.sources.filter((s) => kinds.includes(s.kind) && !s.parked && !s.jackless);
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
  for (const p of view.players) {
    const on = selected?.player === p.id;
    midiAt.set(p.id, y + 28);
    nodes.push(h('button', {
      type: 'button', class: 'card', 'aria-pressed': on ? 'true' : 'false',
      style: `top:${y}px;left:${GX}px;--src:${colors.get(p.id) ?? 'var(--faint)'}`, onclick: () => onSelect({ player: p.id }),
    },
    h('span', { class: 'icon' }, icon(p.kind === 'random' ? 'random' : p.kind)),
    h('span', { class: 'txt' }, h('span', { class: 'name' }, p.name), h('span', { class: 'sub' }, playerLine(p))),
    h('span', { class: 'count' }, p.plays.length ? `plays ${p.plays.length}` : '')));
    y += CARD_STEP;
  }
  // Euclid patterns without a jack: they only clock players or restart LFOs
  for (const s of view.sources.filter((x) => x.jackless)) {
    const on = selected?.source === s.id;
    midiAt.set(s.id, y + 28);
    nodes.push(h('button', {
      type: 'button', class: 'card' + (s.idle ? ' idle' : ''), 'aria-pressed': on ? 'true' : 'false',
      style: `top:${y}px;left:${GX}px;--src:${colors.get(s.id)}`, onclick: () => onSelect({ source: s.id }),
    },
    h('span', { class: 'icon' }, icon(s.kind)),
    h('span', { class: 'txt' }, h('span', { class: 'name' }, s.name), h('span', { class: 'sub' }, `${subline(s)} · no jack`)),
    h('span', { class: 'count' }, s.clocks.length ? `clocks ${s.clocks.length}` : s.restarts.length ? `restarts ${s.restarts.length}` : '')));
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
    if (m.kind === 'fh2') nodes.push(...fh2Inputs(x, view, colors, selected));
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
    const label = clash ? `${gens.length} sources!` : src ? shortLabel(src, src.ports.find((p) => p.output === out) ?? shown) : '+ add';
    const anySelected = selectedSources.length > 0;
    nodes.push(h('span', { class: 'jack-num', style: `left:${pos.x - 36}px;top:${pos.y - 7}px` }, pos.num));
    nodes.push(h('button', {
      type: 'button', class: 'jack' + (clash ? ' clash' : '') + (selected?.output === out ? ' selected' : ''),
      'aria-label': `Jack ${o.jack}: ${src ? label : 'nothing'}`,
      style: `left:${pos.x - 15}px;top:${pos.y - 15}px` + (color && !clash ? `;--ring:${on ? color : color + '88'};--ring-w:${on ? 4 : 2}px` : ''),
      onclick: () => onSelect({ output: out, sources: o.ports.map((p) => p.source) }),
    }));
    nodes.push(h('span', {
      class: 'jack-label' + (src ? ' used' : '') + (src && anySelected && !on ? ' dim' : '') + (on ? ' on' : ''),
      style: `left:${pos.x - 52}px;top:${pos.y + 18}px` + (color ? `;--src:${color}` : ''),
    }, label));
    if (o.lfo && !o.lfo.alone) nodes.push(h('span', { class: 'jack-extra', style: `left:${pos.x - 52}px;top:${pos.y + 31}px` }, '+ LFO'));
  }

  // ---- cables for the selected source(s)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'cables');
  const stageW = x;
  const stageH = Math.max(RY + PANEL_H + 110, cardsBottom + 10);
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
  const pairs = view.players.flatMap((p) => p.plays.filter((sid) => midiAt.has(sid) && midiAt.has(p.id)).map((sid) => [p, sid]));
  pairs.forEach(([p, sid], k) => {
    const y1 = midiAt.get(p.id);
    const y2 = midiAt.get(sid);
    const bulge = Math.min(GX - 6, 12 + Math.abs(y1 - y2) / 14 + (k % 3) * 4);
    const on = selected?.player === p.id || selected?.source === sid;
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
  nodes.push(h('div', { class: 'stage-foot', style: `left:${RX}px;top:${RY + PANEL_H + 20}px;width:${rackW}px` },

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
      h('div', { class: 'fh2-display', style: 'left:37px;top:62px' },
        h('div', {}, h('span', {}, (g.name || 'config').slice(0, 16))),
        h('div', {}, h('span', {}, (g.presetName || '').slice(0, 12)), h('span', {}, g.tempo ? g.tempo.toFixed(1) : ''))),
      h('span', { class: 'knob', style: 'left:53px;top:141px;width:18px;height:18px;background:#2c2f36;border:2px solid #4a4e57' }),
      h('span', { class: 'knob', style: 'left:140px;top:128px;width:44px;height:44px;background:#1c1e23;border:3px solid #3a3d44' }),
      h('span', { class: 'usb', style: 'left:47px;top:212px;width:30px;height:16px;border-radius:2px' }),
      h('span', { class: 'panel-text', style: 'left:12px;top:232px' }, 'USB A'),
      h('span', { class: 'usb', style: 'left:52px;top:280px;width:20px;height:10px;border-radius:5px' }),
      h('span', { class: 'panel-text', style: 'left:12px;top:296px' }, 'USB C'),
    );
  }
  return h('div', { class: 'module', style: `left:${x}px;top:${RY}px;width:${w}px` }, parts);
}

// Inputs X and Y: what they are used for, if they turn CV into MIDI.
function fh2Inputs(x, view, colors) {
  const out = [];
  ['X', 'Y'].forEach((name, i) => {
    const p = view.players.find((pl) => pl.id === `cvMidi:${i}`);
    const cx = x + 162;
    const cy = RY + 220 + 65 * i;
    out.push(h('span', { class: 'jack-num', style: `left:${cx - 36}px;top:${cy - 7}px` }, name));
    out.push(h('span', { class: 'jack', role: 'img', 'aria-label': `Input ${name}: ${p ? p.name : 'not used for CV to MIDI'}`, style: `left:${cx - 15}px;top:${cy - 15}px;cursor:default` }));
    out.push(h('span', { class: 'jack-label' + (p ? ' used' : ''), style: `left:${cx - 52}px;top:${cy + 18}px;--src:${p ? '#9cc9ff' : '#8a91a0'}` },
      p ? `in → ${p.type}${p.type === 'CC' ? ' ' + p.number : ''}` : 'in'));
  });
  return out;
}
