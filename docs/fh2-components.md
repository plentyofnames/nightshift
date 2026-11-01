# FH-2 components: inputs, outputs and what Night Shift assumes

A list of everything inside the FH-2 that makes, takes or shapes a signal, so the editor treats each one correctly. Please go through it and correct it.

**How to review:**
- Tick `[x]` what is right.
- Where something is wrong, edit the line or add a line under it starting with **→**.
- Add anything missing.
- IDs (O3, V6, …) are for talking about a line.

**Where each statement comes from:**
- **[manual]**: FH-2 manual 2.0.
- **[tool]**: Expert Sleepers' config/preset tool source.
- **[you]**: you told me.
- **[guess]**: my inference, not checked anywhere.

Lines marked **(NS)** are things Night Shift's code already relies on.

## 1. Outputs

- [ ] **O1** [manual] 64 CV outputs: 8 on the FH-2, 8 per FHX-8CV (up to 7). 14-bit DACs. Any CV output can carry any function.
- [ ] **O2** [manual] Each CV output has a range set in the config: 0–10 V, ±5 V, 0–1 V, 0–5 V or 0–8 V.
- [ ] **O3** [manual] Gate outputs come from an FHX-8GT (GT0/1–8 for address 0), with an optional ESX-8GT on top (GT0/9–16). They only carry gate-type functions: gates, triggers, clocks, Euclid patterns.
- [ ] **O4** [guess] Gate outputs are on/off only. Velocity triggers, accent levels and Euclid accents can't show their level there; they need a CV output.
- [ ] **O5** [manual] Each CV output is built the same way: one generator (a converter output, a clock, a trigger, a Euclid pattern, a shift register, or the direct level), plus the output's LFO and any envelope, then smoothing, then the range.
- [ ] **O6** [manual] The direct level is what comes out when nothing else generates on that output (and it centres the LFO then). A converter or clock on the same output **replaces** it rather than adding to it. A preset load skips direct levels on such outputs unless "Always load direct" is set.
  - **→ Night Shift's jack mockup shows an "offset" added to a pitch: that is wrong if this line is right.**
- [ ] **O7** [guess] (NS) Only one generator per output works. If two functions point at the same output, the result is undefined, so Night Shift flags it as a problem.
- [ ] **O8** [manual] Smoothing (a low-pass on the sum) is set per output in the preset, and can be mapped to a CC.
- [ ] **O9** [manual] Gate levels (low/high DAC codes) are set per CV output in the config. They are used when that output carries a gate, trigger or clock.
- [ ] **O10** [manual] Calibrations (70 flash slots) belong to an output: a calibration made on one output can't be used on another.

## 2. Inputs X and Y

- [ ] **I1** [manual] Two inputs, preferably 0–5 V. They act as digital or analogue (12-bit) inputs depending on use.
- [ ] **I2** [manual] X is the external clock input, scaled by "Ext clock multiplier" (1–96; 24 = quarter notes, 1 = 24 ppqn).
- [ ] **I3** [manual] Y can be run/stop for the external clock ("Run/Stop on Y"), or toggle or gate the internal clock ("Y toggle", "Y gate").
- [ ] **I4** [manual] An input turned into MIDI (section 14) can't be used as a clock input any more.
- [ ] **I5** [guess] There is no other way to use CV in the FH-2. To modulate a setting with CV you go through CV→MIDI and a CC mapping (section 14).

## 3. Clock, tempo and transport

- [ ] **T1** [manual] Everything runs on 24 ppqn. Rates are given in pulses: 24 = 1/4, 12 = 1/8, 6 = 1/16, 8 = 1/8 triplet, 96 = 1 bar.
- [ ] **T2** [manual] The clock comes from one of:
  - the internal tempo (stored in the preset);
  - tap tempo;
  - X (analogue);
  - MIDI clock from USB A, USB C or DIN. Each port can be set to ignore clock.
- [ ] **T3** [manual] Tap tempo: the left button (a setting), or a MIDI note or CC (config).
- [ ] **T4** [manual] Start/stop of the internal clock: a note or CC (toggle or gate), Y (toggle or gate), or MIDI Machine Control (a setting).
- [ ] **T5** [manual] Tempo by CC (config: channel, CC, min and max tempo). Also CCs for nudge faster/slower and tempo ±0.1.
- [ ] **T6** [manual] Swing (preset) is off, 16th, 8th or a tuplet option, plus an amount and step positions. It applies to everything on the internal timebase: clocks, Euclid patterns, sequencers.
- [ ] **T7** [guess] "Rate 0 = external" for arpeggiators, Euclid patterns, sequencers and shift registers means pulses on input X, not MIDI clock ticks.

## 4. MIDI/CV converters ("voices")

- [ ] **V1** [manual] 16 converters. Each is mono, poly or MPE; poly and MPE have up to 16 voices.
- [ ] **V2** [manual] Input:
  - MIDI notes on one channel, between a lowest and a highest note (that's how a keyboard split works);
  - MPE: the global channel plus member channels up to "last channel". Global channel 16 means the upper zone, counting down.
- [ ] **V3** [manual] Converters also listen to:
  - pitch bend, with a range and an optional separate down range;
  - channel aftertouch;
  - poly aftertouch, or MPE per-note pressure;
  - sustain CC 64 and sostenuto CC 66 (optional);
  - the MPE Y CC;
  - CC 120/123 (all notes off).
- [ ] **V4** [manual] (NS) Per-voice outputs, from the base output, in this fixed order, each only if switched on:
  - Pitch, Gate, Velocity gate, Velocity (or inverted), Release velocity (or inverted), Trigger, Pressure, MPE Y (MPE only), Envelope;
  - Random: **[guess]** last.
  Then the shared outputs: Aftertouch, Para gate, Bend (one output, or up and down).
- [ ] **V5** [manual] Stride sets the spacing from one voice's outputs to the next (poly/MPE).
- [ ] **V6** [guess] (NS) Stride 0 means no gap: the voices sit back to back.
- [ ] **V7** [guess] (NS) The shared outputs start at base + voices × stride, right after the last voice.
- [ ] **V8** [manual] (NS) With a base gate, Gate and Trigger (per voice) and then Para gate move to the gate outputs from that base, in the same order. Everything else stays on CV outputs.
- [ ] **V9** [manual] Voice allocation: round robin, lowest voice, unison, unison 2, note range, alternating, random. Plus a "no stealing" option.
- [ ] **V10** [manual] More switches:
  - mono retrigger;
  - interrupt gate (a short dip for legato notes);
  - envelope zero start;
  - legato velocity (global).
- [ ] **V11** [manual] Per converter in the preset:
  - portamento (mono and unison only);
  - transpose.
  Global transpose is in the config.
- [ ] **V12** [manual] The Random output gives a new random voltage on each note, scaled by the preset's "Random depth".
- [ ] **V13** [manual] Each converter can use a Scala scale (.scl/.kbm) or MTS.
- [ ] **V14** [guess] (NS) Converters hear MIDI from every port and from the internal players alike. Nothing filters by port except the global "Local off" settings.

## 5. Arpeggiators (one per converter)

- [ ] **A1** [manual] Settings, in the preset:
  - mode (off when the value is 0–10);
  - range (1–3 octaves);
  - gate length (0 = fixed trigger);
  - latch;
  - rate (24 ppqn);
  - reset after N quarter notes.
- [ ] **A2** [manual] Rate 0: clocked by the external clock or by one of the Euclid patterns (config).
- [ ] **A3** [manual] Live commands by CC: add, remove, rest, truncate, transpose, transpose in key, set root.
- [ ] **A4** [manual] On poly/MPE converters, each arpeggio note takes the next voice (round robin).
- [ ] **A5** [manual] The arpeggio can also be sent out as MIDI (channel; USB C, USB A, DIN), but not to the internal MIDI.
- [ ] **A6** [guess] Arpeggio notes keep the velocity of the held note.

## 6. Envelopes (one ADSR per converter, per voice)

- [ ] **E1** [manual] Attack, decay, sustain, release. Plus:
  - a time range (200 ms – 50 s);
  - depth (bipolar around 64);
  - velocity depth;
  - attack, decay and release shapes.
  All in the preset, all mappable.
- [ ] **E2** [manual] It only comes out if the converter's Envelope output is on.
- [ ] **E3** [manual] A trigger of type "Envelope" borrows one converter's envelope settings ("Env set") and uses the note's velocity.

## 7. Triggers

- [ ] **G1** [manual] 64 triggers.
  - Input: one MIDI note, or any note, on a channel.
  - Output: one output.
  - The accent types also use the next output up.
- [ ] **G2** [manual] Types: trigger, gate, velocity trigger and velocity gate (level from velocity), accent trigger and accent gate (accent at velocity ≥ 96), toggle, on/off trigger, envelope, velocity (a held level).
- [ ] **G3** [manual] Trigger length is global (config, 1–100 ms).
- [ ] **G4** [guess] (NS) Night Shift groups triggers by MIDI channel into one "Triggers" source per channel (a drum kit).

## 8. Clocks

- [ ] **C1** [manual] 32 clocks, following the current clock source. Types:
  - clock;
  - run gate, and its inverted form (stop gate);
  - pulses on start/continue, on stop, on all of them, on start only, and on start/stop.
- [ ] **C2** [manual] Rate = base × multiplier (24 ppqn). Shift moves the clock earlier by N pulses. Length is in ms, or 0 for a 50% square wave.
- [ ] **C3** [manual] A clock can restart LFOs without coming out of a jack: point it at an expander output you don't have.
- [ ] **C4** [manual] Swing applies to clocks.

## 9. Euclidean patterns

- [ ] **U1** [manual] 16 patterns. Settings, in the preset:
  - steps (up to 32), pulses (0 = off) and rotation;
  - rate (24 ppqn; 0 = external clock);
  - gate length (0 = fixed trigger);
  - accent rate (non-accented pulses are scaled down by the global "Euclidean accent");
  - reset after N quarter notes.
- [ ] **U2** [manual] Outputs (config): a pulse output and an off-step output, each optional.
- [ ] **U3** [manual] A pattern can clock arpeggiators, note sequencers and shift registers (when their rate is 0) and restart LFOs, without coming out of a jack.
- [ ] **U4** [manual] Editable on a Launchpad, and every setting can be mapped to a CC.

## 10. Shift register random generators

- [ ] **R1** [manual] [you] 16 generators. Each needs a clock:
  - normally its rate (24 ppqn) on the FH-2's clock;
  - with rate 0, its clock source (config): the external clock, or a Euclid pattern.
- [ ] **R2** [manual] Direction forwards, backwards or stop. **The default is stop**, so it does nothing until that changes.
- [ ] **R3** [manual] Length in bits. Randomness: 64 is most random; 127 is locked; 0 is locked with the inverse every other pass.
- [ ] **R4** [manual] Attenuator (range of the CV). Quantisation:
  - a scale and key (a list of 16 scales);
  - "MIDI-octave" or "MIDI-exact" from notes held on its notes-input channel.
- [ ] **R5** [manual] Outputs, each optional:
  - CV (a CV output);
  - Change: a gate when the CV changes;
  - Trigger: a gate when the first bit is set.
  Gate length 0 means the global trigger length.
- [ ] **R6** [manual] It can also send its (quantised) notes as MIDI on a channel: to the internal MIDI (to drive a converter, e.g. for Scala) and/or to the ports.
- [ ] **R7** [guess] Change and Trigger can go to the gate expander. The CV needs a CV output.
- [ ] **R8** [guess] Its MIDI notes have a fixed velocity.

## 11. Note sequencers

- [ ] **N1** [manual] 4 sequencers. They **only make MIDI notes**, on a channel, sent to internal and/or USB C, USB A, DIN, Select. To get voltage they need a converter (or triggers) listening on that channel.
- [ ] **N2** [you] There is no velocity: every note has the same velocity. [guess] It's probably 127 or 100; which one matters for velocity outputs and accent triggers.
- [ ] **N3** [manual] Up to 32 steps. Per step:
  - a note, as a degree within the octave;
  - an octave;
  - a rhythm column: up to 8 step times long, or up to 8 ratchets, each part on, off or tied (a tie slurs into the next note, with portamento if the converter has it);
  - reset, skip, and mute with 6 probability levels.
- [ ] **N4** [manual] Per sequence:
  - gate length (0 = trigger);
  - rate (24 ppqn; 0 = external clock or a Euclid pattern, set in the config);
  - reset after N quarter notes;
  - start/end;
  - root note (transpose);
  - direction (forwards, reverse, alternating ×2, random ×3);
  - permutation (straight, odd/even, halves, inwards).
- [ ] **N5** [manual] Editing needs a Launchpad Mini Mk3, X or Pro Mk3 (or the original Pro) with "Takeover" on, or SysEx 4CH. Rate, reset, gate length and position can be mapped to CCs.
- [ ] **N6** [manual] The current sequences are part of the preset. A bank of 28 sequences, shared by the four, lives outside the preset; there are 8 banks in flash.
- [ ] **N7** [guess] Night Shift will always pair a note sequencer with a mono converter (pitch + gate) on a free internal channel. Nothing else turns its notes into voltage.

## 12. Drum sequencer

- [ ] **D1** [manual] One drum sequencer: 8 lanes × 32 steps, each step on, off or accented. Each lane plays one MIDI note (default 36–43; set in the config). **Velocity is 64, or 127 when accented.**
- [ ] **D2** [manual] Per lane: start/end, rate, reset, mute. Plus a global reset.
- [ ] **D3** [manual] It only makes MIDI, so it drives triggers (internally) or external gear.
- [ ] **D4** [guess] Night Shift will pair each lane with one trigger, using an accent trigger when the lane has accents.

## 13. LFOs (one per CV output)

- [ ] **L1** [manual] Each CV output has its own LFO, added to whatever the output carries. With nothing else on the output, it swings around the direct level.
- [ ] **L2** [manual] Speed is 0.1–10 Hz on a log scale, or synced (base × multiplier). Whichever was set last wins.
- [ ] **L3** [guess] (NS) The preset's "use musical" flag says whether the LFO is synced.
- [ ] **L4** [manual] Shape: a mix of sine, square (with pulse width), triangle, saw (64 = none, below 64 falling), random and noise. Plus an overall level, phase, and fade-in after a restart.
- [ ] **L5** [manual] Restart on: a CC, a note, any note of a converter, a converter's para gate going high, a poly voice that uses this output, a clock, or a Euclid pulse.
- [ ] **L6** [guess] (NS) An LFO counts as on when its level is above 0 and some shape is non-zero.
- [ ] **L7** [guess] Gate outputs have no LFO.

## 14. CV→MIDI (inputs X and Y)

- [ ] **M1** [manual] Each input can become a MIDI stream on a channel:
  - CC (0 V and 5 V set the values);
  - trigger (note on above 1 V, note off below 0.5 V);
  - note (X is the pitch, Y the gate; the note number is what 0 V plays);
  - program change;
  - aftertouch.
- [ ] **M2** [manual] The result goes to the internal MIDI (it then drives converters, triggers and CC mappings like any MIDI) and/or to USB A, USB C, DIN and Select. This is the only way to modulate an FH-2 setting with a CV.

## 15. USB gamepad and computer keyboard

- [ ] **H1** [manual] Gamepad: 32 slots. A button gives a gate; an axis gives a level, through a scale and an offset.
- [ ] **H2** [manual] Keyboard: 32 slots, press/release or press only, each with its own DAC values.
- [ ] **H3** [guess] (NS) These write the output directly, on top of anything else there. Night Shift shows them as a layer and doesn't count them as a clash.

## 16. CC mappings

- [ ] **P1** [manual] 384 mappings. Each is a channel + CC (only CCs) → one target, with an optional relative mode (two conventions, recognised automatically).
- [ ] **P2** [tool] What can be mapped:
  - **per output:** direct level, LFO speed, LFO level, each shape, pulse width, phase, fade, synced base and multiplier, smoothing;
  - **per converter:** the arpeggiator settings and commands, portamento, transpose, envelope (A, D, S, R, range, depth, velocity depth, shapes), random depth;
  - **per Euclid pattern:** all 7 settings;
  - **per shift register:** all 8;
  - **per note sequencer:** rate, reset, gate length, position;
  - **drum sequencer:** reset and position, and per lane rate, reset, position;
  - **global:** tempo, swing type and amount, display mode and item, nudge, tempo ±0.1.
- [ ] **P3** [manual] 14-bit via CC n + n+32 (n < 32) works for the direct level, LFO speed and LFO level. A setting chooses whether the fine half comes first or second (default: first).
- [ ] **P4** [manual] A CC's 0–127 covers the whole range of the setting. A mapping can't be limited to part of the range; only the tempo CC has a min and max.
- [ ] **P5** [guess] Two mappings may use the same channel and CC, so one knob can drive several settings. Unverified.
- [ ] **P6** [manual] Soft takeover is a config switch. "Send CCs on preset ld" (a setting) sends every mapped value out when a preset loads.

## 17. MIDI inside the FH-2

- [ ] **B1** [manual] USB A (host, hubs allowed), USB C, DIN, the Select Bus and the internal players all merge into one set of 16 channels. Everything listening filters by channel only.
- [ ] **B2** [manual] Forwarding is set per pair of ports: off, on, or clock only. "Local off" per port ignores that port's input but still forwards it.
- [ ] **B3** [guess] Internal MIDI is never forwarded to the ports. A player has to send it out itself.

## 18. What is stored where

- [ ] **S1** [manual] The **config** holds structure and mappings; the **preset** holds values. 30 slots of each in flash.
  Stored apart from both: sequence banks, calibrations (70), and Scala files (32 .scl + 32 .kbm).
- [ ] **S2** [manual] Program change can load presets (channel set in the config) and configs (channel set in the settings).
- [ ] **S3** [manual] At startup the FH-2 can load a given config and preset, or the last ones used.
- [ ] **S4** [manual] Installing over SysEx changes only RAM. Saving to a flash slot is separate (18H/19H).
- [ ] **S5** [manual] There is no SysEx message for the settings (forwarding, local off, send CCs on preset load, 14-bit order, startup, …), and they are in neither the config nor the preset.
- [ ] **S6** [manual] [tool] A program can still operate the menus like a person: `48H` presses and turns the controls, and `43H`/`44H`/`41H` read back the current item's name and value and the screen. Expert Sleepers' accessibility tool (`fh2_access.html`) works this way. Night Shift could use it to read, and carefully set, the few settings that matter, checking every step.
