// Players: the FH-2's own MIDI makers (note and drum sequencers, shift-register notes,
// arpeggiator out, CV→MIDI). Their inspector, setting one up, and the "Played by" section of
// a voice or trigger kit, which wires a sequencer to it.

import { h, $, modal } from '../../vendor/lilypad/js/dom.js';
import { icon, chip, playerLine, KIND_NAMES } from './look.js';
import { selectInput, perScene, ec4Label } from './controls.js';
import { clockSourceInput } from './editors.js';
import { DIVISIONS, noteName } from '../patch/tables.js';
import { playersOf } from '../patch/derive.js';
import { suggestChannel, freeEuclid } from '../patch/alloc.js';
import { playerFields, setPlayer, setPlayerRate, wirePlayer, unwirePlayer, moveToChannel, setLaneNote, setName, deviceKey, addEuclidWithoutJack } from '../patch/edit.js';

const DEST_NAMES = { internal: 'FH-2 (internal)', usbC: 'USB C', usbA: 'USB A', din: 'DIN', select: 'Select bus' };
const CHANNELS = Array.from({ length: 16 }, (_, c) => [c, String(c + 1)]);
const NOTES = Array.from({ length: 128 }, (_, n) => [n, `${noteName(n)} (${n})`]);
const section = (title, ...rows) => h('section', { class: 'section' }, h('h3', {}, title), rows);
const field = (label, ...control) => h('div', { class: 'erow' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, control));
const allPlayers = (values) => playersOf(values.config, values.preset, { all: true, names: values.names });

// ---- the inspector of one player

export function playerInspector(view, colors, id, onSelect, act) {
  const p = view.players.find((x) => x.id === id) ?? allPlayers(act.values()).find((x) => x.id === id);
  if (!p) return [h('p', { class: 'note' }, 'This player isn’t set up any more.')];
  const f = playerFields(p.id);
  const set = (what, obj) => act.edit(`${what} of ${p.name}`, setPlayer(p.id, obj));
  const parts = [h('div', { class: 'ins-head', style: `--src:${colors.get(p.id) ?? 'var(--faint)'}` },
    h('span', { class: 'icon' }, icon(p.kind, 22)),
    h('div', { class: 'grow' }, h('h2', {}, p.name), h('span', { class: 'kind' }, `${KIND_NAMES[p.kind] ?? 'Player'} · makes MIDI, not voltage`)),
    h('button', { type: 'button', class: 'btn small', onclick: () => act.rename(p.id, p.name, p.defaultName) }, 'Rename…'))];

  // channel and where it sends
  const box = (d) => h('label', { class: 'check' }, h('input', {
    type: 'checkbox', checked: !!p[d], 'data-key': `${p.id} ${d}`,
    onchange: (e) => set(`Sending to ${DEST_NAMES[d]}`, { dests: { [d]: e.target.checked } }),
  }), DEST_NAMES[d]);
  // the gear on each port it sends to, by name ("Disting mk4"), kept beside the dumps
  const gear = ['usbC', 'usbA', 'din', 'select'].filter((d) => p[d]).map((d) => field(`On ${DEST_NAMES[d]}`, h('input', {
    type: 'text', class: 'text', placeholder: 'what’s there? (e.g. Disting mk4)', value: p.devices?.[d] ?? '', 'aria-label': `Gear on ${DEST_NAMES[d]} ch ${p.channel + 1}`, 'data-key': `gear ${d}`,
    onchange: (e) => act.edit(`Gear on ${DEST_NAMES[d]} ch ${p.channel + 1}: ${e.target.value.trim() || 'none'}`, setName(deviceKey(d, p.channel), e.target.value)),
  })));
  parts.push(section('Sends',
    h('div', { class: 'erows' }, field('MIDI channel', selectInput(`Channel of ${p.name}`, p.channel, CHANNELS, (v) => set('Channel', { channel: v })))),
    h('div', { class: 'checks' }, Object.keys(f.dests).map(box)),
    gear.length ? h('div', { class: 'erows' }, gear) : null));

  // what it plays inside the FH-2
  const plays = p.plays.map((sid) => view.sources.find((s) => s.id === sid)).filter(Boolean);
  parts.push(section('Plays inside the FH-2', plays.length
    ? plays.map((s) => h('div', { class: 'row' }, h('button', { type: 'button', class: 'linkish', onclick: () => onSelect({ source: s.id }) }, s.name), chip(`ch ${p.channel + 1}`, colors.get(s.id))))
    : h('p', { class: 'note' }, p.internal ? `Nothing listens on ch ${p.channel + 1}.` : 'Doesn’t send to the FH-2.')));

  // its clock
  if (f.rate && p.rate != null) {
    parts.push(section('Clock', h('div', { class: 'erows' },
      perScene(field(p.kind === 'sequencer' ? ec4Label('Steps at', `noteSequencer:${p.index}:rate`, act.ec4) : 'Steps at', selectInput(`Rate of ${p.name}`, p.rate, [[0, 'Ext: its clock source'], ...DIVISIONS], (v) => act.edit(`Rate of ${p.name}`, setPlayerRate(p.id, v))))),
      // the clock source only counts at rate Ext, so it only shows then
      p.rate === 0 ? field('Clock source', clockSourceInput(view, act, `Clock source of ${p.name}`, p.clock,
        (v, made) => act.edit(made.length ? `${p.name} clocked by a new Euclid ${v}` : `Clock source of ${p.name}`, [...made, ...setPlayer(p.id, { clock: v })]))) : null),
    null));
  }

  // the drum sequencer's lanes and which triggers they hit
  if (p.kind === 'drums') {
    const kit = view.sources.find((s) => s.kind === 'triggers' && s.channel === p.channel);
    const hit = (note) => kit?.ports.filter((x) => !x.accent && (x.note === note || x.note == null)).map((x) => x.jack).join(', ');
    parts.push(section('Lanes', h('div', { class: 'erows' }, p.notes.map((n, lane) => field(`Lane ${lane + 1}`,
      selectInput(`Note of lane ${lane + 1}`, n, NOTES, (v) => act.edit(`Note of lane ${lane + 1}`, setLaneNote(lane, v))),
      h('span', { class: 'lane-hit' }, hit(n) ? `→ ${hit(n)}` : '—'))))));
  }

  if (p.kind === 'input') parts.push(h('p', { class: 'note' }, 'Scaling: in the config tool for now.'));
  parts.push(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn',
    onclick: () => act.edit(`Stopped ${p.name}`, setPlayer(p.id, { dests: Object.fromEntries(Object.keys(f.dests).map((d) => [d, false])) })) }, 'Stop sending')));
  return parts;
}

// ---- "Played by" for a voice or a trigger kit

export function playedBy(view, s, act, onSelect, colors) {
  const ch = s.kind === 'voice' && s.channels.length > 1
    ? `ch ${s.channels[0] + 1} (MPE ${s.channels[1] + 1}–${s.channels[s.channels.length - 1] + 1})` : `ch ${s.channel + 1}`;
  const rows = s.players.map((p) => h('div', { class: 'box player-box', style: `--src:${colors.get(p.id) ?? 'var(--faint)'}` },
    h('span', {}, h('button', { type: 'button', class: 'linkish', onclick: () => onSelect({ player: p.id }) }, p.name),
      h('div', { class: 'sub' }, `internal MIDI ${ch}${p.din || p.usbA || p.usbC ? ' · also sent out' : ''}`)),
    h('button', { type: 'button', class: 'remove', 'aria-label': `Stop ${p.name} playing ${s.name}`, title: 'Stop it playing this',
      onclick: () => act.edit(`${p.name} no longer plays ${s.name}`, unwirePlayer(p.id)) }, '×')));
  rows.push(h('div', { class: 'box' }, `MIDI ${ch} from outside`, h('div', { class: 'sub' },
    s.kind === 'voice' ? `notes ${noteName(s.notes[0])}–${noteName(s.notes[1])} · USB A, USB C, DIN or Select Bus` : 'USB A, USB C, DIN or Select Bus')));

  // wiring a sequencer to it
  const values = act.values();
  // what can play it: sequencers; the drum sequencer for a kit; the notes of a shift register in
  // use; an input turned into notes (or triggers, for a kit)
  const canPlay = (p) => {
    if (s.players.some((x) => x.id === p.id)) return false;
    switch (p.kind) {
      case 'sequencer': return true;
      case 'drums': return s.kind === 'triggers';
      case 'random': return view.sources.some((x) => x.id === `srr:${p.index}`) || view.players.some((x) => x.id === p.id);
      case 'input': return p.type === 'Note' || (s.kind === 'triggers' && p.type === 'Trigger');
      default: return false;
    }
  };
  const candidates = allPlayers(values).filter(canPlay);
  const status = (p) => {
    const sends = p.internal || p.usbC || p.usbA || p.din || p.select;
    if (!sends) return 'free';
    const now = view.players.find((x) => x.id === p.id);
    const names = now?.plays.map((id) => view.sources.find((x) => x.id === id)?.name).filter(Boolean) ?? [];
    return names.length ? `now plays ${names.join(', ')}` : playerLine(p);
  };
  const picker = h('div', { class: 'erows' }, field(s.players.length ? 'Also from' : 'Play it from', selectInput(`Play ${s.name} from`, '', [['', 'Choose a player…'], ...candidates.map((p) => [p.id, `${p.name} · ${status(p)}`])],
    (id) => {
      if (!id) return;
      const p = candidates.find((x) => x.id === id);
      const changes = wirePlayer(id, s.channel);
      // a drum sequencer whose lanes miss the kit's notes gets them, in order
      if (p.kind === 'drums') {
        const notes = s.ports.filter((x) => !x.accent && x.note != null).map((x) => x.note);
        if (notes.length && !notes.every((n) => p.notes.includes(n))) notes.slice(0, 8).forEach((n, lane) => changes.push(...setLaneNote(lane, n)));
      }
      act.edit(`${p.name} plays ${s.name}`, changes);
    })));
  // one player is the usual case; a second one (two sequencers into a poly voice) stays possible, out of the way
  rows.push(s.players.length ? h('details', { class: 'more' }, h('summary', {}, 'Add another player…'), picker) : picker);

  if (s.players.length) {
    const quiet = suggestChannel(values.config);
    const canMove = quiet !== s.channel && !(s.kind === 'voice' && s.channels.length > 1); // an MPE zone stays put
    rows.push(canMove
        ? h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => act.edit(`${s.name} and its players moved to ch ${quiet + 1}`, moveToChannel(s, quiet)) },
          `Keep it to the FH-2: move to ch ${quiet + 1}`))
        : null);
  }
  return section('Played by', rows);
}

// ---- a shift register's clock, shown with the random source on its jacks (its notes, when it
// sends them, are a player with the same clock)

export function randomClock(view, s, act) {
  const rate = s.settings?.rate;
  if (rate == null) return null;
  const id = `srrNotes:${s.index}`;
  const clock = act.values().config.srr[s.index].clock;
  return section('Clock', h('div', { class: 'erows' },
    perScene(field(ec4Label('Steps at', `srr:${s.index}:rate`, act.ec4), selectInput(`Rate of ${s.name}`, rate, [[0, 'Ext: its clock source'], ...DIVISIONS],
      (v) => act.edit(`Rate of ${s.name}`, setPlayerRate(id, v))))),
    rate === 0 ? field('Clock source', clockSourceInput(view, act, `Clock source of ${s.name}`, clock,
      (v, made) => act.edit(made.length ? `${s.name} clocked by a new Euclid ${v}` : `Clock source of ${s.name}`, [...made, ...setPlayer(id, { clock: v })]))) : null));
}

// ---- what a Euclid pattern clocks, and the LFOs it restarts

export function euclidClocks(view, s, onSelect) {
  const link = (label, sel, note) => h('div', { class: 'row' }, h('button', { type: 'button', class: 'linkish', onclick: () => onSelect(sel) }, label), h('span', { class: 'v' }, note));
  return [
    s.clocks?.length ? section('Clocks', s.clocks.map((c) => link(c.name, c.select, c.now ? 'now (its rate is Ext)' : 'when its rate is Ext'))) : null,
    s.restarts?.length ? section('Restarts', s.restarts.map((o) => link(`LFO on ${view.outputs[o].jack}`, { output: o }, 'on every pulse'))) : null,
  ];
}

// ---- setting up a player that sends nowhere yet (e.g. a sequencer for a Disting on DIN), or a
// Euclid pattern without a jack, to clock players and shift registers or restart LFOs

const EUCLID = 'euclid';

export async function setUpPlayerDialog(view, values) {
  const kinds = ['sequencer', 'drums', 'random'];
  const free = allPlayers(values).filter((p) => kinds.includes(p.kind) && !(p.internal || p.usbC || p.usbA || p.din || p.select)
    && (p.kind !== 'random' || view.sources.some((s) => s.id === `srr:${p.index}`)));
  const euclid = freeEuclid(values.config, view.hardware) >= 0;
  if (!free.length && !euclid) throw new Error('every sequencer already sends somewhere, and every Euclid is in use');
  const f = { id: free[0]?.id ?? EUCLID, channel: suggestChannel(values.config), dests: { din: true }, pulses: 4, steps: 16, rate: 6 };
  const num = (key, min, max) => h('input', { type: 'number', class: 'num', min, max, value: f[key], 'aria-label': key,
    oninput: (e) => { f[key] = Math.max(min, Math.min(max, Number(e.target.value) || 0)); } });
  const forPlayer = h('div', { class: 'fields' },
    h('label', { class: 'field' }, h('span', {}, 'MIDI channel'), selectInput('MIDI channel', f.channel, CHANNELS, (v) => { f.channel = v; })),
    h('div', { class: 'field wide' }, h('span', {}, 'Sends to'), h('div', { class: 'checks' }, Object.entries(DEST_NAMES).map(([d, name]) =>
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!f.dests[d], onchange: (e) => { f.dests[d] = e.target.checked; } }), name)))),
    h('p', { class: 'note' }, 'For gear outside the FH-2, leave “FH-2 (internal)” off.'));
  const forEuclid = h('div', { class: 'fields' },
    h('label', { class: 'field' }, h('span', {}, 'Pulses'), num('pulses', 1, 32)),
    h('label', { class: 'field' }, h('span', {}, 'Steps'), num('steps', 1, 32)),
    h('label', { class: 'field' }, h('span', {}, 'Step rate'), selectInput('Step rate', f.rate, DIVISIONS, (v) => { f.rate = v; })),
    h('p', { class: 'note' }, 'No jack: pick it as a clock source or an LFO restart.'));
  const show = () => { // style, not `hidden`: .fields sets its own display
    forPlayer.style.display = f.id === EUCLID ? 'none' : '';
    forEuclid.style.display = f.id === EUCLID ? '' : 'none';
  };
  const choices = [...free.map((p) => [p.id, p.name]), ...(euclid ? [[EUCLID, 'A Euclid (no jack)']] : [])];
  const body = h('div', { class: 'fields' },
    h('label', { class: 'field' }, h('span', {}, 'Player'), selectInput('Player', f.id, choices, (v) => { f.id = v; show(); })),
    forPlayer, forEuclid);
  show();
  const ok = await modal($('dialog'), {
    title: 'Set up a player',
    body,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Set up', value: true, primary: true }],
  });
  if (!ok) return null;
  if (f.id === EUCLID) {
    const e = addEuclidWithoutJack(values, view.hardware, { pulses: f.pulses, steps: f.steps, rate: f.rate });
    return { select: { source: `euclid:${e.index}` }, label: `Euclid ${e.index + 1}, ${f.pulses} of ${f.steps}, without a jack`, changes: e.changes };
  }
  const p = free.find((x) => x.id === f.id);
  const dests = Object.fromEntries(Object.keys(playerFields(f.id).dests).map((d) => [d, !!f.dests[d]]));
  return { id: f.id, label: `${p.name} sends on ch ${f.channel + 1}`, changes: setPlayer(f.id, { channel: f.channel, dests }) };
}
