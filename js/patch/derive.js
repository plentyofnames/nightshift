// Turns a decoded FH-2 config (and preset, if there is one) into what Night Shift shows:
// sources with their ports, the 128 outputs and what comes out of each, the players that
// make MIDI, the CC mappings, a channel map, resource counts and problems.
//
// Nothing here writes: the FH-2's values stay the truth and this is recomputed after every
// change. Where the manual leaves the output order open, the choice is marked "assumed".

import { mappingsOf } from './mappings.js';
import { jackName, isPresent, isGate, EXAMPLE_HARDWARE } from './hardware.js';
import { RANGES, CONVERTER_TYPES, ALLOCATIONS, SUSTAIN, CLOCK_TYPES, TRIGGER_TYPES, ACCENT_TRIGGER_TYPES, LFO_RESET_TYPES,
  CVMIDI_TYPES, noteName, durationName, lfoHz, gamepadUsage, keyName, arpModeOf, LFO_RESET_EUCLID } from './tables.js';

// `names` are Night Shift's own names beside the dumps (edit.js setName): for sources and players
// by id, and for the gear on a port and channel.
export function derive(config, preset = null, hardware = EXAMPLE_HARDWARE, names = {}) {
  const outputs = Array.from({ length: 128 }, (_, i) => ({
    index: i,
    jack: jackName(i, hardware),
    gate: isGate(i),
    present: isPresent(hardware, i),
    range: i < 64 ? RANGES[config.outputRange[i].value] ?? `range ${config.outputRange[i].value}` : null,
    rangeIndex: i < 64 ? config.outputRange[i].value : null,
    gateLevels: i < 64 ? config.gateLevel[i] : null,
    ports: [], // what generates the voltage
    lfo: null,
    directLevel: preset && i < 64 ? preset.output[i].directLevel : null,
    smoothing: preset && i < 64 ? preset.output[i].smoothing : null,
    controls: [], // mappings that change this output's level, LFO or smoothing
    lfoReset: i < 64 ? lfoResetOf(config.lfoReset[i]) : null,
  }));
  const sources = [];
  const problems = [];
  const mappings = mappingsOf(config);

  const addSource = (s) => {
    if (names[s.id]) {
      s.defaultName = s.name;
      s.name = names[s.id];
    }
    sources.push(s);
    for (const p of s.ports) {
      if (p.output == null) continue;
      if (p.output < 0 || p.output > 127) {
        problems.push({ kind: 'range', source: s.id, message: `${s.name}: ${p.name} points past the last output` });
        continue;
      }
      p.jack = jackName(p.output, hardware);
      p.present = outputs[p.output].present;
      outputs[p.output].ports.push({ source: s.id, name: p.name, layer: !!s.layer, standby: !!s.standby });
    }
    return s;
  };

  // ---- MIDI/CV converters (voices)
  config.converter.forEach((cv, i) => {
    if (!cv.enable) return;
    const s = {
      id: `converter:${i}`, kind: 'voice', index: i, name: `Voice ${i + 1}`, raw: { ...cv },
      mode: CONVERTER_TYPES[cv.type] ?? `type ${cv.type}`,
      voices: cv.type === 0 ? 1 : Math.max(1, cv.voices),
      channel: cv.channel,
      channels: cv.type === 2 ? mpeChannels(cv) : [cv.channel],
      notes: [cv.minNote, cv.maxNote],
      ports: converterPorts(cv, problems, i),
      settings: {
        bendRange: cv.bendRange, bendDown: cv.bendDown === 0 ? null : cv.bendDown - 1,
        allocation: ALLOCATIONS[cv.allocation] ?? cv.allocation, noStealing: !!cv.noStealing,
        sustain: SUSTAIN[cv.sustain] ?? cv.sustain, gatedAftertouch: !!cv.gatedAftertouch,
        monoRetrigger: !!cv.monoRetrigger, interruptGate: !!cv.interruptGate, envZeroStart: !!cv.envZeroStart,
      },
      performance: preset ? converterPreset(preset.converter[i]) : null,
      arpWaits: preset ? arpWaitsOf(cv, preset.converter[i], preset) : null,
      // the arp plays this voice; a copy of it to USB C, USB A or DIN is only shown, not offered
      arpOut: cv.arpToUsbC || cv.arpToUsbA || cv.arpToDin
        ? { channel: cv.arpChannel, usbC: !!cv.arpToUsbC, usbA: !!cv.arpToUsbA, din: !!cv.arpToDin } : null,
      players: [],
      controls: [],
    };
    if (cv.minNote > cv.maxNote) problems.push({ kind: 'notes', source: s.id, message: `${s.name}: lowest note is above the highest, so it plays nothing` });
    if (s.arpWaits?.stopped) problems.push({ kind: 'arp-clock', source: s.id, message: `${s.name}’s arp follows ${s.arpWaits.clock}, which has no pulses, so it plays nothing` });
    addSource(s);
  });

  // ---- clocks, one source for all of them
  const clocks = [];
  config.clock.forEach((c, i) => {
    if (!c.type) return;
    const what = c.type === 1 ? `Clock ${durationName(c.base * c.multiplier)}` : CLOCK_TYPES[c.type] ?? `Clock type ${c.type}`;
    clocks.push({ name: what, output: c.output, clock: i, type: c.type, base: c.base, multiplier: c.multiplier, shift: c.shift, length: c.length });
  });
  if (clocks.length) addSource({ id: 'clocks', kind: 'clock', name: 'Clock & transport', ports: clocks, controls: [] });

  // ---- triggers, one source per MIDI channel
  const byChannel = new Map();
  config.trigger.forEach((t, i) => {
    if (!t.type) return;
    if (!byChannel.has(t.channel)) byChannel.set(t.channel, []);
    const note = t.anyNote ? 'Any note' : `${noteName(t.note)} (${t.note})`;
    const list = byChannel.get(t.channel);
    list.push({ name: note, output: t.output, trigger: i, type: TRIGGER_TYPES[t.type] ?? `type ${t.type}`, typeIndex: t.type, note: t.anyNote ? null : t.note,
      envSet: (t.envSetHigh << 1) | t.envSetLow });
    if (ACCENT_TRIGGER_TYPES.has(t.type)) list.push({ name: `${note} accent`, output: t.output + 1, trigger: i, accent: true });
  });
  for (const [ch, ports] of [...byChannel].sort((a, b) => a[0] - b[0])) {
    addSource({ id: `triggers:${ch}`, kind: 'triggers', name: `Triggers · ch ${ch + 1}`, channel: ch, channels: [ch], ports, players: [], controls: [] });
  }

  // ---- Euclidean patterns. One without a jack still counts when it is a player's or an
  // arpeggiator's clock source, restarts an LFO, or runs: it has pulses in the preset in view
  // (`jackless` below, shown among the players). One that only runs drives nothing yet; the
  // fit check (scenes.js) says so, as the preset may come from another config.
  const players = playersOf(config, preset, { names });
  config.euclid.forEach((e, i) => {
    const ports = [];
    if (!e.outputHigh) ports.push({ name: 'Pulses', output: e.output });
    if (!e.offOutputHigh) ports.push({ name: 'Off steps', output: e.offOutput });
    const p = preset?.euclid[i];
    const clocks = clockedBy(config, preset, players, names, i);
    const restarts = config.lfoReset.flatMap((r, o) => (r.type === LFO_RESET_EUCLID && r.number === i ? [o] : []));
    const used = clocks.length > 0 || restarts.length > 0;
    if (!ports.length && !used && !(p?.pulses > 0)) return;
    addSource({
      id: `euclid:${i}`, kind: 'euclid', index: i, name: `Euclid ${i + 1}`, ports, controls: [], clocks, restarts, used,
      pattern: p ? { pulses: p.pulses, steps: p.steps, rotation: p.rotation, rate: p.rate ? durationName(p.rate) : 'external clock', ratePulses: p.rate, gate: p.gate, accent: p.accent, reset: p.reset } : null,
      idle: p ? p.pulses === 0 : false,
    });
  });

  // ---- shift register random generators
  config.srr.forEach((r, i) => {
    const ports = [];
    if (r.cvOutput) ports.push({ name: 'CV', output: r.cvOutput - 1 });
    if (!r.changeOutputHigh) ports.push({ name: 'Change', output: r.changeOutput });
    if (!r.triggerOutputHigh) ports.push({ name: 'Trigger', output: r.triggerOutput });
    if (!ports.length) return;
    addSource({ id: `srr:${i}`, kind: 'random', index: i, name: `Random ${i + 1}`, ports, controls: [],
      settings: preset ? { ...preset.srr[i] } : null });
  });

  // ---- USB gamepad and keyboard: they write levels directly, on top of whatever else is
  // there, but only while such a device is plugged into USB A. The Init config has both on
  // the first outputs, so they are kept apart as "standby" and not drawn on the jacks.
  const pads = config.gamepad.map((g, i) => (g.usage ? { name: gamepadUsage(g.usage), output: g.output, slot: i } : null)).filter(Boolean);
  if (pads.length) addSource({ id: 'gamepad', kind: 'hid', layer: true, standby: true, name: 'USB gamepad', ports: pads, controls: [] });
  const keys = config.keyboard.map((k, i) => (k.type ? { name: `Key ${keyName(k.key)}`, output: k.output, slot: i } : null)).filter(Boolean);
  if (keys.length) addSource({ id: 'keyboard', kind: 'hid', layer: true, standby: true, name: 'USB keyboard', ports: keys, controls: [] });

  // ---- mappings onto outputs, LFOs on outputs
  for (const m of mappings) {
    if (m.target.kind === 'output') outputs[m.target.index].controls.push(m);
  }
  // An output's LFO is on with depth and a shape, with a CC on any of its settings (a depth knob
  // may start at zero), or when Night Shift marked it (keep:lfo:n, edit.js keep).
  if (preset) {
    for (let i = 0; i < 64; i++) {
      const p = preset.output[i];
      const byCc = outputs[i].controls.some((m) => LFO_KEYS.includes(m.target.param));
      const lfo = lfoOf(p, byCc || !!names[`keep:lfo:${i}`]);
      if (lfo) outputs[i].lfo = lfo;
      outputs[i].lfoRaw = lfoRaw(p);
    }
  }

  // ---- outputs nothing generates: an LFO, a level set by a CC, or a stored level: one off the
  // bottom of its range, or marked by Night Shift (keep:level:n), as 0 V on a 0–10 V jack looks
  // exactly like an unused one
  const knobs = new Map();
  const levels = [];
  for (let i = 0; i < 64; i++) {
    const o = outputs[i];
    if (o.ports.some((p) => !p.layer)) continue;
    const dc = o.controls.find((m) => m.target.param === 'directLevel');
    if (o.lfo) {
      addSource({ id: `lfo:${i}`, kind: 'lfo', index: i, name: `LFO ${o.jack}`, ports: [{ name: 'LFO', output: i }],
        lfo: o.lfo, centre: o.directLevel, controls: [] });
      o.lfo.alone = true;
    } else if (dc) {
      if (!knobs.has(dc.channel)) knobs.set(dc.channel, []);
      knobs.get(dc.channel).push({ name: `CC ${dc.cc}`, output: i, cc: dc.cc, channel: dc.channel, relative: dc.relative, slot: dc.slot });
    } else if (o.directLevel || names[`keep:level:${i}`]) {
      levels.push({ name: `Level ${o.directLevel}`, output: i, level: o.directLevel });
    }
  }
  for (const [ch, ports] of [...knobs].sort((a, b) => a[0] - b[0])) {
    addSource({ id: `knobs:${ch}`, kind: 'knobs', name: `CC → CV · ch ${ch + 1}`, channel: ch, ports, controls: [] });
  }
  if (levels.length) addSource({ id: 'levels', kind: 'level', name: 'Stored levels', ports: levels, controls: [] });

  // ---- mappings onto sources
  for (const m of mappings) {
    const t = m.target;
    const id = t.kind === 'converter' ? `converter:${t.index}` : t.kind === 'euclid' ? `euclid:${t.index}` : t.kind === 'srr' ? `srr:${t.index}`
      : t.kind === 'output' ? (sources.find((s) => s.kind === 'lfo' && s.index === t.index)?.id) : null;
    const s = id && sources.find((x) => x.id === id);
    if (s) s.controls.push(m);
  }

  // ---- parked sources: every jack they use is outside the rack (the Init config puts its
  // unused Euclid patterns on GT3/16). A Euclid there that clocks or restarts something is a
  // Euclid without a jack instead, as is one with no jack at all.
  for (const s of sources) {
    s.parked = s.ports.length > 0 && s.ports.every((p) => p.present === false);
    if (s.kind === 'euclid' && s.ports.every((p) => p.present === false) && (s.used || !s.ports.length)) {
      s.parked = false;
      s.jackless = true;
    }
  }

  // ---- collisions, on the jacks you have
  for (const o of outputs) {
    if (!o.present) continue;
    const gens = o.ports.filter((p) => !p.layer);
    if (gens.length > 1) {
      problems.push({ kind: 'collision', output: o.index, message: `${o.jack}: ${gens.map((p) => `${nameOf(sources, p.source)} ${p.name}`).join(' and ')} share this output` });
    }
    if (o.gate && gens.some((p) => !gateFriendly(sources, p))) {
      problems.push({ kind: 'gate-only', output: o.index, message: `${o.jack} is a gate output, but carries a CV` });
    }
  }

  for (const s of sources) {
    if (!s.channels) continue;
    s.players = players.filter((p) => p.internal && s.channels.includes(p.channel));
  }
  for (const p of players) {
    p.plays = p.internal ? sources.filter((s) => s.channels?.includes(p.channel)).map((s) => s.id) : [];
  }
  return {
    hardware, outputs, sources, mappings, players, problems,
    channels: channelMap(sources, players, mappings),
    resources: resourcesOf(config, preset, mappings, outputs, sources),
    globals: globalsOf(config, preset),
  };
}

// The order in the manual: CV, Gate, VelGate, Velocity, RelVel, Trigger, Pressure, MPE Y,
// Envelope, per voice; then Aftertouch, Para gate and Bend. With a base gate, Gate and
// Trigger (per voice) and Para gate move to the gate expander in the same order.
// Assumed: Random comes last per voice (the manual's list predates it), and the shared
// outputs follow the voices at base + voices × stride.
export function converterPorts(cv, problems = [], i = 0) {
  const perVoice = [];
  if (cv.cvOut) perVoice.push('Pitch');
  if (cv.gateOut) perVoice.push('Gate');
  if (cv.velGateOut) perVoice.push('Velocity gate');
  if (cv.velocityOut) perVoice.push(cv.velocityOut === 2 ? 'Velocity (inverted)' : 'Velocity');
  if (cv.releaseVelocityOut) perVoice.push(cv.releaseVelocityOut === 2 ? 'Release velocity (inverted)' : 'Release velocity');
  if (cv.triggerOut) perVoice.push('Trigger');
  if (cv.pressureOut) perVoice.push('Pressure');
  if (cv.type === 2 && cv.mpeYcc) perVoice.push('MPE Y');
  if (cv.envelopeOut) perVoice.push('Envelope');
  if (cv.randomOut) perVoice.push('Random');
  const shared = [];
  if (cv.aftertouchOut) shared.push('Aftertouch');
  if (cv.paraGateOut) shared.push('Para gate');
  if (cv.bendOut === 1) shared.push('Bend');
  if (cv.bendOut === 2) shared.push('Bend up', 'Bend down');

  const voices = cv.type === 0 ? 1 : Math.max(1, cv.voices);
  const onGates = cv.baseGate >= 64;
  const isGateName = (n) => n === 'Gate' || n === 'Trigger';
  const cvPer = onGates ? perVoice.filter((n) => !isGateName(n)) : perVoice;
  const gtPer = onGates ? perVoice.filter(isGateName) : [];
  const cvShared = onGates ? shared.filter((n) => n !== 'Para gate') : shared;
  const stride = cv.type !== 0 && cv.stride > 0 ? cv.stride : cvPer.length;
  if (cv.type !== 0 && cv.stride > 0 && cv.stride < cvPer.length) {
    problems.push({ kind: 'stride', source: `converter:${i}`, message: `Voice ${i + 1}: the gap between voices (${cv.stride}) is smaller than the ${cvPer.length} outputs per voice` });
  }
  const label = (n, v) => (voices > 1 ? `${n} ${v + 1}` : n);
  const ports = [];
  for (let v = 0; v < voices; v++) {
    cvPer.forEach((n, k) => ports.push({ name: label(n, v), role: n, voice: v, output: cv.baseOutput + v * stride + k }));
  }
  cvShared.forEach((n, k) => ports.push({ name: n, role: n, output: cv.baseOutput + voices * stride + k }));
  if (onGates) {
    for (let v = 0; v < voices; v++) {
      gtPer.forEach((n, k) => ports.push({ name: label(n, v), role: n, voice: v, output: cv.baseGate + v * gtPer.length + k }));
    }
    if (cv.paraGateOut) ports.push({ name: 'Para gate', role: 'Para gate', output: cv.baseGate + voices * gtPer.length });
  }
  return ports;
}

function mpeChannels(cv) {
  const out = [];
  if (cv.channel === 15) for (let c = 14; c >= cv.lastMpeChannel; c--) out.push(c);
  else for (let c = cv.channel + 1; c <= cv.lastMpeChannel; c++) out.push(c);
  return [cv.channel, ...out];
}

function converterPreset(p) {
  return {
    arp: p.arpMode > 10 ? { mode: p.arpMode, range: p.arpRange, gate: p.arpGate, latch: p.arpLatch, rate: p.arpRate ? durationName(p.arpRate) : 'external clock', reset: p.arpReset } : null,
    arpRaw: { mode: p.arpMode, range: p.arpRange, gate: p.arpGate, latch: p.arpLatch, rate: p.arpRate, reset: p.arpReset },
    portamento: p.portamento, transpose: p.transpose,
    envelope: { attack: p.envAttack, decay: p.envDecay, sustain: p.envSustain, release: p.envRelease, range: p.envRange, depth: p.envDepth, velocityDepth: p.envVelocityDepth,
      attackShape: p.envAttackShape, decayShape: p.envDecayShape, releaseShape: p.envReleaseShape },
    randomDepth: p.randomDepth,
    scala: p.scalaEnable ? { enable: p.scalaEnable, scl: p.scalaScl, kbm: p.scalaKbm } : null,
  };
}

// An LFO counts as on when it has depth and at least one shape (saw is centred at 64).
// `on`: it counts as on whatever its depth and shapes (a CC on one of its settings, or a mark).
function lfoOf(o, on = false) {
  const shapes = { sine: o.lfoSine, square: o.lfoSquare, triangle: o.lfoTriangle, saw: o.lfoSaw - 64, random: o.lfoRandom, noise: o.lfoNoise };
  if (!on && (!o.lfoLevel || !Object.values(shapes).some(Boolean))) return null;
  return {
    raw: lfoRaw(o),
    level: o.lfoLevel, shapes, pulseWidth: o.lfoPulseWidth, phase: o.lfoPhase, fade: o.lfoFade,
    synced: !!o.lfoSynced,
    rate: o.lfoSynced ? durationName(o.lfoTempoBase * o.lfoTempoMultiplier) : `≈ ${lfoHz(o.lfoSpeed).toFixed(2)} Hz`,
  };
}

// The preset's LFO fields of an output, as stored.
const LFO_KEYS = ['lfoLevel', 'lfoSpeed', 'lfoTempoBase', 'lfoTempoMultiplier', 'lfoSine', 'lfoSquare', 'lfoTriangle', 'lfoPulseWidth',
  'lfoSaw', 'lfoRandom', 'lfoNoise', 'lfoFade', 'lfoSynced', 'lfoPhase'];
export function lfoRaw(o) {
  return Object.fromEntries(LFO_KEYS.map((k) => [k, o[k]]));
}

function lfoResetOf(r) {
  if (!r.type) return null;
  return { type: LFO_RESET_TYPES[r.type] ?? r.type, typeIndex: r.type, channel: r.channel, number: r.number };
}

function gateFriendly(sources, p) {
  const s = sources.find((x) => x.id === p.source);
  if (!s) return true;
  if (s.kind === 'clock' || s.kind === 'triggers' || s.kind === 'euclid' || s.kind === 'hid') return true;
  if (s.kind === 'random') return p.name !== 'CV';
  if (s.kind === 'voice') return /^(Gate|Trigger|Para gate)( \d+)?$/.test(p.name); // not Velocity gate: gate outputs are always 10 V
  return false;
}

const nameOf = (sources, id) => sources.find((s) => s.id === id)?.name ?? id;

// Whether port `port` (by name) of source `s` replaces its jack's direct level instead of adding
// to it: a voice's pitch does (your test, 2026-11-03), and gate-type outputs take their voltage
// from the jack's gate levels. To every other CV-type output the level is added, as an offset.
// (Unlike gateFriendly, a velocity gate counts as gate-type here: it is a gate on a CV jack.)
export function replacesLevel(s, port) {
  if (['clock', 'triggers', 'euclid', 'hid'].includes(s.kind)) return true;
  if (s.kind === 'random') return port !== 'CV';
  if (s.kind === 'voice') return /^(Pitch|Gate|Trigger|Velocity gate|Para gate)( \d+)?$/.test(port);
  return false;
}

// What an arpeggiator that is on waits for at rate Ext, or null: { clock, stopped }. The voice
// plays only its arpeggio, so without that clock it plays nothing: the external clock may not
// be running, and a Euclid pattern with no pulses never steps (`stopped`).
function arpWaitsOf(cv, p, preset) {
  if (!p || arpModeOf(p.arpMode)?.[1] === 'Off' || p.arpRate !== 0) return null;
  if (!cv.arpClock) return { clock: 'the external clock', stopped: false };
  const e = preset.euclid[cv.arpClock - 1];
  return { clock: `Euclid ${cv.arpClock}`, stopped: !e || e.pulses === 0 };
}

// What Euclid pattern `i` clocks: players, shift registers (as the random source they are on
// their jacks, the usual case), and arpeggiators (as their voice), whose clock source it is,
// with what selecting one shows. `now`: their rate is Ext, so it does.
function clockedBy(config, preset, players, names, i) {
  const onJacks = (r) => r.cvOutput || !r.changeOutputHigh || !r.triggerOutputHigh;
  const out = players.filter((p) => p.clock === i + 1 && !(p.kind === 'random' && onJacks(config.srr[p.index])))
    .map((p) => ({ id: p.id, name: p.name, now: p.rate === 0, select: { player: p.id } }));
  config.srr.forEach((r, k) => {
    if (r.clock !== i + 1 || !onJacks(r)) return;
    const id = `srr:${k}`;
    out.push({ id, name: names[id] ?? `Random ${k + 1}`, now: preset?.srr[k].rate === 0, select: { source: id } });
  });
  config.converter.forEach((cv, k) => {
    if (!cv.enable || cv.arpClock !== i + 1) return;
    const a = preset?.converter[k];
    const id = `converter:${k}`;
    out.push({ id, name: `${names[id] ?? `Voice ${k + 1}`}’s arpeggiator`, now: !!a && a.arpRate === 0 && arpModeOf(a.arpMode)?.[1] !== 'Off', select: { source: id } });
  });
  return out;
}

// Things inside the FH-2 that make MIDI. Each sends on one channel to some of internal, USB C,
// USB A, DIN and Select. Sequencers and shift registers step at `rate` (24 ppqn pulses, from the
// preset); at rate 0 they follow `clock`: 0 the external clock, n Euclid pattern n. An arpeggiator
// isn't one: it plays its own voice (its copy out as MIDI is on the voice, `arpOut`).
// Players that send nowhere are left out (`all: true` lists every slot, for picking one).
export function playersOf(config, preset, { all = false, names = {} } = {}) {
  const players = [];
  const dests = (x) => ({ internal: !!x.toInternal, usbC: !!x.toUsbC, usbA: !!x.toUsbA, din: !!x.toDin, select: !!x.toSelect });
  const used = (d) => all || Object.values(d).some(Boolean);
  config.noteSequencer.forEach((q, j) => {
    const d = dests(q);
    if (!used(d)) return;
    const p = preset?.noteSequencer[j];
    players.push({ id: `noteSequencer:${j}`, kind: 'sequencer', index: j, name: `Note sequencer ${j + 1}`, channel: q.channel, ...d,
      clock: q.clock, rate: p ? p.rate : null, active: preset ? !!preset['noteSequencerActive' + j] : null });
  });
  config.drumSequencer.forEach((q) => {
    const d = dests(q);
    if (!used(d)) return;
    players.push({ id: 'drumSequencer', kind: 'drums', index: 0, name: 'Drum sequencer', channel: q.channel, ...d,
      notes: q.laneNote.map((n) => n.value), laneRates: preset ? preset.drumSequencer[0].lane.map((l) => l.rate) : null,
      active: preset ? !!preset.drumSequencerActive : null });
  });
  config.srr.forEach((r, i) => {
    const d = dests(r);
    if (!used(d)) return;
    players.push({ id: `srrNotes:${i}`, kind: 'random', index: i, name: `Random ${i + 1} notes`, channel: r.channel, ...d,
      clock: r.clock, rate: preset ? preset.srr[i].rate : null });
  });
  config.cvMidi.forEach((c, i) => {
    if (!c.enable) return;
    const what = CVMIDI_TYPES[c.type] ?? `type ${c.type}`;
    players.push({ id: `cvMidi:${i}`, kind: 'input', index: i, name: `Input ${'XY'[i]} → ${what}${c.type === 0 ? ` ${c.number}` : ''}`,
      channel: c.channel, type: what, number: c.number, ...dests(c) });
  });
  // given names, and the gear named on each port the player sends to
  for (const p of players) {
    if (names[p.id]) {
      p.defaultName = p.name;
      p.name = names[p.id];
    }
    p.devices = Object.fromEntries(['usbC', 'usbA', 'din', 'select'].filter((d) => p[d] && names[`device:${d}:${p.channel}`]).map((d) => [d, names[`device:${d}:${p.channel}`]]));
  }
  return players;
}

// Who sends and who listens on each MIDI channel. Only the FH-2's own players are known
// as senders; external devices come from the patch's sidecar (later).
function channelMap(sources, players, mappings) {
  const ch = Array.from({ length: 16 }, (_, i) => ({ channel: i, senders: [], listeners: [] }));
  for (const p of players) if (p.internal) ch[p.channel].senders.push({ player: p.id, name: p.name });
  for (const s of sources) {
    if (s.kind === 'voice') s.channels.forEach((c) => ch[c].listeners.push({ source: s.id, name: s.name, what: `notes ${noteName(s.notes[0])}–${noteName(s.notes[1])}` }));
    if (s.kind === 'triggers') ch[s.channel].listeners.push({ source: s.id, name: s.name, what: 'notes' });
  }
  for (const m of mappings) ch[m.channel].listeners.push({ mapping: m.slot, name: `CC ${m.cc}`, what: m.target.param ?? m.target.kind });
  return ch;
}

function resourcesOf(config, preset, mappings, outputs, sources) {
  const count = (list, f) => list.filter(f).length;
  return {
    converters: [count(config.converter, (c) => c.enable), 16],
    clocks: [count(config.clock, (c) => c.type), 32],
    triggers: [count(config.trigger, (t) => t.type), 64],
    euclids: [count(sources, (s) => s.kind === 'euclid'), 16],
    randoms: [count(config.srr, (r) => r.cvOutput || !r.changeOutputHigh || !r.triggerOutputHigh), 16],
    mappings: [mappings.length, 384],
    lfos: preset ? [count(outputs, (o) => o.lfo), 64] : null,
  };
}

function globalsOf(config, preset) {
  return {
    triggerLength: config.triggerLength, transpose: config.transpose, softTakeover: !!config.softTakeover,
    presetProgramChannel: config.presetProgramChannel || null,
    tempo: preset ? preset.tempo / 10 : null,
    swing: preset ? { type: preset.swingType, amount: preset.swingAmount } : null,
    name: config.name.trim(), presetName: preset ? preset.name.trim() : null,
  };
}
