// Turns a decoded FH-2 config (and preset, if there is one) into what Night Shift shows:
// sources with their ports, the 128 outputs and what comes out of each, the players that
// make MIDI, the CC mappings, a channel map, resource counts and problems.
//
// Nothing here writes: the FH-2's values stay the truth and this is recomputed after every
// change. Where the manual leaves the output order open, the choice is marked "assumed".

import { mappingsOf } from './mappings.js';
import { jackName, isPresent, isGate, DEFAULT_HARDWARE } from './hardware.js';
import { RANGES, CONVERTER_TYPES, ALLOCATIONS, SUSTAIN, CLOCK_TYPES, TRIGGER_TYPES, ACCENT_TRIGGER_TYPES, LFO_RESET_TYPES,
  CVMIDI_TYPES, noteName, durationName, lfoHz } from './tables.js';

export function derive(config, preset = null, hardware = DEFAULT_HARDWARE) {
  const outputs = Array.from({ length: 128 }, (_, i) => ({
    index: i,
    jack: jackName(i),
    gate: isGate(i),
    present: isPresent(hardware, i),
    range: i < 64 ? RANGES[config.outputRange[i].value] ?? `range ${config.outputRange[i].value}` : null,
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
    sources.push(s);
    for (const p of s.ports) {
      if (p.output == null) continue;
      if (p.output < 0 || p.output > 127) {
        problems.push({ kind: 'range', source: s.id, message: `${s.name}: ${p.name} points past the last output` });
        continue;
      }
      p.jack = jackName(p.output);
      p.present = outputs[p.output].present;
      outputs[p.output].ports.push({ source: s.id, name: p.name, layer: !!s.layer });
    }
    return s;
  };

  // ---- MIDI/CV converters (voices)
  config.converter.forEach((cv, i) => {
    if (!cv.enable) return;
    const s = {
      id: `converter:${i}`, kind: 'voice', index: i, name: `Voice ${i + 1}`,
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
      arpOut: cv.arpToUsbC || cv.arpToUsbA || cv.arpToDin
        ? { channel: cv.arpChannel, usbC: !!cv.arpToUsbC, usbA: !!cv.arpToUsbA, din: !!cv.arpToDin } : null,
      players: [],
      controls: [],
    };
    if (cv.minNote > cv.maxNote) problems.push({ kind: 'notes', source: s.id, message: `${s.name}: lowest note is above the highest, so it plays nothing` });
    addSource(s);
  });

  // ---- clocks, one source for all of them
  const clocks = [];
  config.clock.forEach((c, i) => {
    if (!c.type) return;
    const what = c.type === 1 ? `Clock ${durationName(c.base * c.multiplier)}` : CLOCK_TYPES[c.type] ?? `Clock type ${c.type}`;
    clocks.push({ name: what, output: c.output, clock: i, shift: c.shift, length: c.length });
  });
  if (clocks.length) addSource({ id: 'clocks', kind: 'clock', name: 'Clock & transport', ports: clocks, controls: [] });

  // ---- triggers, one source per MIDI channel
  const byChannel = new Map();
  config.trigger.forEach((t, i) => {
    if (!t.type) return;
    if (!byChannel.has(t.channel)) byChannel.set(t.channel, []);
    const note = t.anyNote ? 'Any note' : `${noteName(t.note)} (${t.note})`;
    const list = byChannel.get(t.channel);
    list.push({ name: note, output: t.output, trigger: i, type: TRIGGER_TYPES[t.type] ?? `type ${t.type}`, note: t.anyNote ? null : t.note });
    if (ACCENT_TRIGGER_TYPES.has(t.type)) list.push({ name: `${note} accent`, output: t.output + 1, trigger: i, accent: true });
  });
  for (const [ch, ports] of [...byChannel].sort((a, b) => a[0] - b[0])) {
    addSource({ id: `triggers:${ch}`, kind: 'triggers', name: `Triggers · ch ${ch + 1}`, channel: ch, channels: [ch], ports, players: [], controls: [] });
  }

  // ---- Euclidean patterns
  config.euclid.forEach((e, i) => {
    const ports = [];
    if (!e.outputHigh) ports.push({ name: 'Pulses', output: e.output });
    if (!e.offOutputHigh) ports.push({ name: 'Off steps', output: e.offOutput });
    if (!ports.length) return;
    const p = preset?.euclid[i];
    addSource({
      id: `euclid:${i}`, kind: 'euclid', index: i, name: `Euclid ${i + 1}`, ports, controls: [],
      pattern: p ? { pulses: p.pulses, steps: p.steps, rotation: p.rotation, rate: p.rate ? durationName(p.rate) : 'external clock', gate: p.gate, accent: p.accent, reset: p.reset } : null,
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

  // ---- USB gamepad and keyboard: they write levels directly, usually on top of something else
  const pads = config.gamepad.map((g, i) => (g.usage ? { name: `Gamepad ${g.usage}`, output: g.output, slot: i } : null)).filter(Boolean);
  if (pads.length) addSource({ id: 'gamepad', kind: 'hid', layer: true, name: 'USB gamepad', ports: pads, controls: [] });
  const keys = config.keyboard.map((k, i) => (k.type ? { name: `Key ${k.key}`, output: k.output, slot: i } : null)).filter(Boolean);
  if (keys.length) addSource({ id: 'keyboard', kind: 'hid', layer: true, name: 'USB keyboard', ports: keys, controls: [] });

  // ---- mappings onto outputs, LFOs on outputs
  for (const m of mappings) {
    if (m.target.kind === 'output') outputs[m.target.index].controls.push(m);
  }
  if (preset) {
    for (let i = 0; i < 64; i++) {
      const lfo = lfoOf(preset.output[i]);
      if (lfo) outputs[i].lfo = lfo;
    }
  }

  // ---- outputs nothing generates: an LFO, a level set by a CC, or a stored level
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
      knobs.get(dc.channel).push({ name: `CC ${dc.cc}`, output: i, cc: dc.cc });
    } else if (o.directLevel) {
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

  // ---- collisions
  for (const o of outputs) {
    const gens = o.ports.filter((p) => !p.layer);
    if (gens.length > 1) {
      problems.push({ kind: 'collision', output: o.index, message: `${o.jack}: ${gens.map((p) => `${nameOf(sources, p.source)} ${p.name}`).join(' and ')} share this output` });
    }
    if (o.gate && gens.some((p) => !gateFriendly(sources, p))) {
      problems.push({ kind: 'gate-only', output: o.index, message: `${o.jack} is a gate output, but carries a CV` });
    }
  }

  const players = playersOf(config, preset);
  for (const s of sources) {
    if (!s.channels) continue;
    s.players = players.filter((p) => p.internal && s.channels.includes(p.channel));
  }

  return {
    hardware, outputs, sources, mappings, players, problems,
    channels: channelMap(sources, players, mappings),
    resources: resourcesOf(config, preset, mappings, outputs),
    globals: globalsOf(config, preset),
  };
}

// The order in the manual: CV, Gate, VelGate, Velocity, RelVel, Trigger, Pressure, MPE Y,
// Envelope, per voice; then Aftertouch, Para gate and Bend. With a base gate, Gate and
// Trigger (per voice) and Para gate move to the gate expander in the same order.
// Assumed: Random comes last per voice (the manual's list predates it), and the shared
// outputs follow the voices at base + voices × stride.
function converterPorts(cv, problems, i) {
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
    portamento: p.portamento, transpose: p.transpose,
    envelope: { attack: p.envAttack, decay: p.envDecay, sustain: p.envSustain, release: p.envRelease, range: p.envRange, depth: p.envDepth, velocityDepth: p.envVelocityDepth },
    randomDepth: p.randomDepth,
    scala: p.scalaEnable ? { enable: p.scalaEnable, scl: p.scalaScl, kbm: p.scalaKbm } : null,
  };
}

// An LFO counts as on when it has depth and at least one shape (saw is centred at 64).
function lfoOf(o) {
  const shapes = { sine: o.lfoSine, square: o.lfoSquare, triangle: o.lfoTriangle, saw: o.lfoSaw - 64, random: o.lfoRandom, noise: o.lfoNoise };
  if (!o.lfoLevel || !Object.values(shapes).some(Boolean)) return null;
  return {
    level: o.lfoLevel, shapes, pulseWidth: o.lfoPulseWidth, phase: o.lfoPhase, fade: o.lfoFade,
    synced: !!o.lfoSynced,
    rate: o.lfoSynced ? durationName(o.lfoTempoBase * o.lfoTempoMultiplier) : `≈ ${lfoHz(o.lfoSpeed).toFixed(2)} Hz`,
  };
}

function lfoResetOf(r) {
  if (!r.type) return null;
  return { type: LFO_RESET_TYPES[r.type] ?? r.type, channel: r.channel, number: r.number };
}

function gateFriendly(sources, p) {
  const s = sources.find((x) => x.id === p.source);
  if (!s) return true;
  if (s.kind === 'clock' || s.kind === 'triggers' || s.kind === 'euclid' || s.kind === 'hid') return true;
  if (s.kind === 'random') return p.name !== 'CV';
  if (s.kind === 'voice') return /Gate|Trigger/.test(p.name);
  return false;
}

const nameOf = (sources, id) => sources.find((s) => s.id === id)?.name ?? id;

// Things inside the FH-2 that make MIDI.
function playersOf(config, preset) {
  const players = [];
  const dests = (x) => ({ internal: !!x.toInternal, usbC: !!x.toUsbC, usbA: !!x.toUsbA, din: !!x.toDin, select: !!x.toSelect });
  config.noteSequencer.forEach((q, j) => {
    const d = dests(q);
    if (!Object.values(d).some(Boolean)) return;
    players.push({ id: `noteSequencer:${j}`, kind: 'sequencer', name: `Note sequencer ${j + 1}`, channel: q.channel, ...d,
      active: preset ? !!preset['noteSequencerActive' + j] : null });
  });
  config.drumSequencer.forEach((q) => {
    const d = dests(q);
    if (!Object.values(d).some(Boolean)) return;
    players.push({ id: 'drumSequencer', kind: 'drums', name: 'Drum sequencer', channel: q.channel, ...d,
      notes: q.laneNote.map((n) => n.value), active: preset ? !!preset.drumSequencerActive : null });
  });
  config.srr.forEach((r, i) => {
    const d = dests(r);
    if (!Object.values(d).some(Boolean)) return;
    players.push({ id: `srrNotes:${i}`, kind: 'random', name: `Random ${i + 1} notes`, channel: r.channel, ...d });
  });
  config.cvMidi.forEach((c, i) => {
    if (!c.enable) return;
    const what = CVMIDI_TYPES[c.type] ?? `type ${c.type}`;
    players.push({ id: `cvMidi:${i}`, kind: 'input', name: `Input ${'XY'[i]} → ${what}${c.type === 0 ? ` ${c.number}` : ''}`,
      channel: c.channel, type: what, number: c.number, ...dests(c) });
  });
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

function resourcesOf(config, preset, mappings, outputs) {
  const count = (list, f) => list.filter(f).length;
  return {
    converters: [count(config.converter, (c) => c.enable), 16],
    clocks: [count(config.clock, (c) => c.type), 32],
    triggers: [count(config.trigger, (t) => t.type), 64],
    euclids: [count(config.euclid, (e) => !e.outputHigh || !e.offOutputHigh), 16],
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
