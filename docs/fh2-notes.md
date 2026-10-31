# FH-2 output-first editor: working notes

Written 2026-10-28 while researching round 1 of the design.
Mockups: https://claude.ai/artifact/TB5bu5hZkNGuxcySwEAdtF

## Sources reviewed

- FH-2 user manual v2.0 (firmware 2.0, 17 Apr 2025, still the latest).
- Official config tool 2.0 and preset tool 1.24, at expert-sleepers.co.uk/webapps. Source: github.com/expertsleepersltd/FH-2_tools (MIT).
- FH2Edit, github.com/spgarbet/FH2Edit (GPLv3, started Sept 2026).

## FH-2 facts that shape the editor

**Outputs**
- The FH-2 has 8 CV outputs.
- An FHX-8CV adds 8 outputs (4HP, up to 7 of them). The FH-2 numbers them 9–64; the web tool calls them 1/1–7/8.
- An FHX-8GT adds 8 gate outputs (4HP, up to 4, address set by jumper 0–3). The FH-2 numbers them 65–128 in blocks of 16: 8 of its own, then 8 for an attached ESX-8GT. The web tool calls them 0/1–3/16.
- Gate outputs accept only gate-type functions: gates, triggers, clocks, Euclid patterns.
- My rig (2 × CV, 2 × GT) is outputs 1–8, 9–24, then 65–72 and 81–88, assuming the GTs are jumpered 0 and 1.

**Inputs X and Y**
- Used for external clock, run/stop, tap tempo or start/stop.
- Or used for CV→MIDI: CC, trigger, note (X is pitch and Y is the gate), program change or aftertouch. The result goes to any MIDI port and/or the FH-2's internal MIDI.

**How one output is built** (manual, "Signal flow")
- Chain: one generator, plus LFO and envelope, then smoothing, then range.
- Generators: MIDI/CV converter, clock, trigger, Euclid pattern or direct level.
- LFO *n* is tied to output *n*. Direct level *n* is the centre of that LFO and also works as an offset on top of any generator. So an LFO on a pitch jack gives vibrato.
- Range and gate levels are set per output (config). Calibrations are per output too (70 flash slots).

**Resource limits**
- 16 MIDI/CV converters, each with its own arpeggiator and envelope.
- 32 clocks, 64 triggers, 16 Euclid patterns, 16 shift-register random generators (SRR).
- 4 note sequencers and 1 drum sequencer with 8 lanes.
- 384 CC mappings.
- 32 HID gamepad slots and 32 HID keyboard slots.
- Flash: 30 config slots, 30 preset slots, 8 + 8 sequencer banks.

**Converter output layout: the big constraint**
- A converter's outputs are contiguous, in a fixed order, starting at its Base output.
- Per voice, in order: CV, Gate, VelGate, Velocity, RelVel, Trigger, Pressure, MPE-Y, Envelope, Random. Each voice is offset by Stride.
- After the voices come the shared outputs: Aftertouch, ParaGate, Bend (1 or 2 outputs).
- Setting Base gate moves Gate, Trigger and ParaGate to GT outputs, in the same order.
- So the UI must treat a voice as a block, not as freely patched cables.

**Other layout rules**
- An "Acc Trig" or "Acc Gate" trigger also uses output + 1 for the accent.
- A clock or Euclid pattern used only to reset an LFO can point at an unused expander slot. The manual suggests this workaround itself; the editor should hide it.

**MIDI routing: the transparency problem**
- All inputs (USB A, USB C, DIN, Select Bus and internal) merge into one stream of 16 channels.
- Consumers filter only by channel, and converters also by note range.
- Per-port control is limited to global "Local off DIN / USB A / USB C" and to forwarding.
- So internal routes need channels that nothing external sends on, and the editor has to own a channel plan.
- Things that produce MIDI: note sequencers (channel, plus destinations internal / USB C / USB A / DIN), the drum sequencer (channel plus a note per lane), SRR (optional notes), arpeggiators (MIDI out) and CV→MIDI.
- Things that consume MIDI: converters (channel and note range), triggers (channel and note, or any note), CC mappings, LFO resets, tap tempo, start/stop, program change and SRR "notes input".

**Config vs preset**
- Config is structure plus CC mappings.
- Preset holds the values: tempo, swing, direct levels, LFOs, smoothing, arp, portamento, transpose, Scala, envelopes, Euclid and SRR parameters, and the current sequences.
- Sequencer banks are separate from both.
- A program change on a set channel loads presets (or configs).

**SysEx**
- 10H installs a config and 13H installs a preset.
- 18H and 19H save to flash.
- 21H and 23H request dumps.
- 22H requests the version.
- 01H and 41H are screenshot and screen-as-text.
- 43H and 44H request a parameter's name and value.

## The existing tools

**Official tools**
- One giant table per function type.
- Config and preset are two separate apps.
- The only output-centric part is the "Output Configurator", and it only maps CCs to LFOs and direct levels.

**FH2Edit**
- A list of output rows, each with icons for its sources, plus an editor panel on the right.
- Merges config and preset into one view.
- Treats the arpeggiator and envelope as separate sources, though in the firmware they belong to a converter.
- Sequencers live in separate tabs.
- MIDI routing view and gate-expander support are still TODO.
- GPLv3, so reusing its code would make our project GPL.

## Round 1 design direction (see mockups)

1. **Rack first.** The main view is a picture of the rack. Every jack shows what comes out of it, and empty jacks say "+ add".
2. **Sources** are the things that make voltage: Voice, Drum triggers, LFO, Random, MIDI knob, Fixed voltage, Clock & transport, Euclid, Gamepad. Their cables are drawn only while the source is selected.
3. **Players** are the things that make MIDI: keyboards, sequencers, input X. They are an attribute of a voice ("Played by …"), never something you patch to a jack. The editor allocates internal channels for them from 16 downwards and creates the converter or triggers.
4. **Honest constraints.** A voice is a fixed-order block. An LFO and an offset are layers on a jack. Gate expanders only accept gate sources. A resource meter shows what's left.
5. **Patch + scenes.** A patch is a config. Scenes are presets that share it. Values stored per scene get a dot, and scenes map to program change.
6. **MIDI map view.** Shows senders and listeners per channel, and warns about the merged-bus problem.
7. **Escape hatch.** A "Show raw FH-2 settings" option on each object.

## Round 2: controllers and knobs (2026-10-28)

### The user's gear

- **Live:** Launchpad Mini, a Faderfox (model not confirmed yet), maybe an Arturia MiniLab 3.
- **On order:** Behringer BCR32. It's the BCR2000 reborn: 32 encoders and 20 buttons, DIN MIDI, sync, 4 CV/gate pairs, and the built-in "Zaquencer" 4-track, 32-step sequencer.
- **Computer:** Logic, connected over USB C.

### FH-2 facts relevant to controllers

- **Setting "Send CCs on preset ld".** Loading a preset sends out every mapped CC. This lets LED rings and displays follow scene changes.
- **Relative CCs.** Both conventions (1/127 and 65/63) are detected automatically. Each mapping has a relative flag.
- **Soft takeover** is a global config switch.
- **CC range.** A CC's 0–127 is scaled onto the parameter's range. There is no per-mapping min/max, except for the tempo CC.
- **14-bit pairing.** Direct levels, LFO speed and LFO level pair CC *n* (0–31) with CC *n*+32, unless *n*+32 is mapped to something else.
- **Learn on the module itself.** Hold the encoder on the mapping screen.
- **Launchpads.** Only the Mini Mk3, X and Pro Mk3 (and the original Pro) get the native sequencer/Euclid surface. An older Launchpad Mini is treated as a generic controller.
- **Per-device USB settings:** "Echo MIDI" and "Takeover".
- **What can be mapped** (official tool): direct level; all LFO parameters and smoothing; portamento, transpose, envelope A/D/S/R/range/depth/velocity depth and shapes, random depth; arp parameters; Euclid parameters; SRR parameters; sequencer rate, reset, gate and position; tempo, swing, display, nudge.

### How the editor can "learn" a knob

The controllers plug into the FH-2's USB A port; the editor talks to the FH-2 over USB C. Options:

1. **Forwarding.** Turn on FH-2 forwarding USB A → USB C. The editor then sees the controller's messages on the FH-2 port. Bonus: Logic can record the MiniLab.
2. **Screen text.** If forwarding is off, poll SysEx 41H. The overview screen's bottom line shows the last received message as source/channel/type/byte1/byte2. Only works while the display is on the overview.
3. **Direct connection.** Plug the controller into the computer while editing.

### Controller profiles

- A profile turns a raw (channel, CC) pair into a name, like "Faderfox · encoder 5".
- Known layouts are drawn from a profile. Unknown controllers are "taught": touch each control once, in order.

### Faderfox EC4 (the user's model, confirmed)

**Hardware**
- 16 push encoders, each push button with its own command, plus 7 function buttons.
- A 4×20 OLED. It shows encoder names (4 characters each) in a 4×4 grid matching the encoders, plus values.
- 16 setups, each with 16 groups of 16 encoders.

**Per-encoder settings**
- Type: CC rel. 1, CC rel. 2, CC absolute, CC 14-bit absolute, NRPN, pitch bend, program change, note.
- Channel and number.
- Lower and upper limit, so range limiting can happen on the controller even though the FH-2 has none per mapping.
- Display scale, acceleration and a 4-character name.
- Group and setup names (4 characters each).
- "Data feedback": the EC4 takes in incoming values, so with "Send CCs on preset ld" its absolute encoders stay in sync on scene change.

**Programming it from Night Shift**
- The setup SysEx format is documented. See `doc/faderfox sysex data format EC4 V2.txt` in github.com/privatepublic-de/faderfox-editor (MIT, made with Faderfox; EC4 firmware 2.00).
- Plan: Night Shift writes its own EC4 setup (e.g. setup 16) and leaves the user's other setups alone.
- Setup names can only be sent along with "all setups"; group and encoder names can be sent per setup.

**Learning a knob on the EC4**
- First pre-format Night Shift's setup so every encoder sends a unique channel/CC.
- Then "turn the knob" identifies the encoder unambiguously, and Night Shift rewrites that encoder's name, range and type.

**To verify:** the byte order of the EC4's 14-bit CC (the FH-2 expects the low 7 bits first). The manual cites the Faderfox UC3 as compatible.

## Round 3: controlfrog + Lilypad, one EC4 page per source (2026-10-28)

The user already runs **controlfrog**, their own custom EC4 firmware, together with **Lilypad**, a Web MIDI editor (MIT; github.com/plentyofnames/lilypad, live at plentyofnam.es/lilypad).
- Source: `~/Documents/Claude Code/Faderfox EC4/ec4-fw`, with `editor/` = Lilypad as a submodule.
- Protocol: `docs/protocol.md` there. Controller behaviour: `docs/control.md`. Profiles draft: `docs/profiles.md`.
- The stock-EC4 SysEx notes above are superseded for this user.
- The BCR32 is left out for now; it is months away.

### controlfrog features Night Shift would use

Framing is `F0 7D 45 43 34 <cmd> … F7`. The EEPROM layout is unchanged from stock.
- **READ / WRITE / RELOAD:** write only Night Shift's setup (e.g. setup 16 "FH2"). Groups become pages: one page per source, plus a mixed "LIVE" page.
- **SELECT and the `21` STATE event:** a two-way live link. Selecting a source in Night Shift turns the EC4 to that source's page. Changing group on the EC4 selects that source in Night Shift.
- **TOUCH events (`31`):** "touch a knob to pick it", with no MIDI forwarding needed.
- **`28` TEXT (firmware 0.10):** per-cell 4-character labels and value texts. Values can show in FH-2 units (1BAR, SAW, 5/16). These texts are RAM only and dropped on every group change, so Night Shift resends them after each STATE.
- **"Send values on group change"** (EEPROM `0x0007`), plus the FH-2's "Send CCs on preset ld": no jumps on page or scene changes.
- **Shared values:** values belong to the MIDI address. One setting placed on two pages (its own page and LIVE) shares one CC and stays in sync, with only one FH-2 mapping.
- **One host at a time** on the EC4: Lilypad and Night Shift can't both be connected.

### Integration choice (open)

- (a) Night Shift talks to controlfrog directly, reusing Lilypad's `proto.js` / `device.js` (same author, MIT).
- (b) Night Shift exports an `ec4profile` JSON (format in `profiles.md`) for Lilypad to apply.
- Either way, this answers the draft's Q6: Night Shift owns the FH-2 config and generates the EC4 pages from it.

### Topology (settled by the user, 2026-10-28)

There are three situations. The patch, pages and channels are the same in all of them; only the path changes.

1. **Setting up / testing:** EC4 on the Mac over USB.
   - Night Shift's own thru forwards the EC4 to the FH-2 over USB C.
   - The full live link works: SELECT, STATE, TOUCH and value texts.
2. **With Logic:** EC4 on the Mac over USB.
   - Logic forwards the EC4 to the FH-2 and records it. One External MIDI track to the FH-2 on ch 2 records every EC4 page, and Logic plays the moves back as FH-2 automation.
   - Night Shift's thru must be off, so nothing is sent twice.
   - The live link still works while Night Shift is open.
3. **Live:** EC4 and Launchpad on the FH-2's USB A, through a hub, with no computer.
   - Names come from setup 16 stored on the EC4.
   - Values show in EC4 scales, so Night Shift should pick scales that read well alone (ON/OFF, ±63, %).
   - Pages are switched on the EC4 itself.
   - Scene sync relies on the FH-2's "Send CCs on preset ld" going out to USB A.

**Pre-gig checklist** (mocked in artboard 9).

Night Shift can do these:
- write and select EC4 setup 16;
- turn on the EC4's "send values on group change";
- save the config and presets to FH-2 flash (18H / 19H);
- check the channels.

The user must do these by hand, because FH-2 Settings can't be set over SysEx:
- "Send CCs on preset ld" = 1;
- Startup = last used config and preset;
- "14 bit CC byte order" = MSB first. The EC4's 14-bit mode sends MSB then LSB; the FH-2 defaults to LSB first. Verify on hardware.

### Page templates (mocked up)

- **LFO:** SYNC MULT DPTH OFFS / SINE TRI SAW SQR / PW RAND NOIS SMTH / PHAS FADE RATE.
- **Euclid:** PULS STEP ROT RATE / GATE ACNT RSET.
- **Shift register:** RAND LEN RATE ATTN / SCAL KEY GATE DIR.
- **Voice:** glide, envelope, transpose, arp.
- **Clock:** TEMP SWNG STYP, with start/stop on a push.
- **LFO 14-bit:** depth and free rate get CCs below 32, with n+32 reserved as the fine part.

### To verify

- Can two mappings share one (channel, CC)? That would make one knob a macro over several settings.
- What exactly does the 42H screen text contain on the overview screen?
- Which Launchpad Mini generation does the user have?
