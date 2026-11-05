# FH-2 output-first editor: working notes

Written 2026-10-28 while researching round 1 of the design.
The design mockups live on a private design canvas.

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
- A stored level doesn't reach a voice's pitch jack (your test, 2026-11-03, with "Always load direct" off): the pitch replaces it, at the latest with the next note. On every other CV-type output it is added, as to an LFO: an offset (your tests, 2026-11-03/04).
- An LFO on its own is added to the jack's stored level (your test, 2026-11-03): the stored level is the LFO's offset, and a knob mapped to it moves the offset live.
- Installing a config or preset into RAM, and reading dumps, don't interrupt what plays; saving to flash does (your notes, 2026-11-04).
- The FH-2's own settings (its Settings menu) are kept in flash: "14 bit CC byte order" stayed on MSB first after a power cycle (your note, 2026-11-04).
- A Euclid pattern with both outputs None still runs; it only stops with no pulses (your note, 2026-11-03). Clocking a shift register from a Euclid pattern without a jack is the usual way to step it.

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

**"None" for an output, and a bug with the gamepad and keyboard** (found 2026-11-02, after the user couldn't set their outputs to None)
- The tool's output menus give "None" the value −1.
- **Euclid patterns** (and the shift register's change and trigger outputs) store it masked to 7 bits, so the byte is 127. That alone would mean GT3/16, so a high bit in the addendum tells them apart: 127 with the bit set is None, 127 without it is GT3/16.
- **Gamepad and keyboard** outputs are written without masking (`arr[c+1] = …_output.value`). "None" goes into the SysEx as `0xFF`, a status byte that has no place there. Checked by running the tool's own `makeSysEx`: gamepad 1 → byte 2957 = `0xFF`, keyboard 1 → byte 3213 = `0xFF`, Euclid 1's off output → `0x7F`. Their records also have no high bit, so None can't be stored there at all. The module then refuses or garbles the config and keeps the old output, which matches what the user saw.
- **The way to switch an entry off** is its Usage (gamepad) or Type (keyboard) set to "--". The output doesn't matter then. Night Shift already reads those entries as unused.

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

**Measured on the module** (2026-11-01, FH-2 firmware v2.0.0, preset dump version 8). CCs went in on ch 15 over USB C, and the direct levels were read back from the preset dump (23H) before and after.
- **Measured with the checks page (2026-11-04):** program change N loads preset slot N + 1. A CC on a setting with a small range lands in even bands of 128/n (Euclid 0–32 in 33 bands, steps held at 1; arp range 1–3; latch 0–1; the swing type only reaches 0–2). With tempoMin = tempoMax = 59 a tempo CC n gives 60 + n BPM. With Soft takeover on, a 14-bit knob still jumps.
- **14-bit pairs, MSB first** (measured 2026-11-04): a value lands only when the coarse half (CC n) is followed by the fine half (CC n + 32). The fine half alone changes nothing; the coarse half alone waits for the next fine half.
- **No fine relative steps** (measured 2026-11-04): with a relative mapping on CC n (below 32), relative values on CC n + 32 change nothing.
- **Relative mappings are 7-bit.** One step moves a direct level by 128 on its 0–16383 scale. 127 steps take it from bottom to top, and the highest value reachable this way is 16256.
- **Larger steps are exact** in both conventions (1/127 two's complement and 65/63 offset): +2, +3, +6 and the negatives move 2, 3 and 6 steps. Each mapping keeps its own convention: two mappings with different conventions decode correctly even when their messages are interleaved.
- **"14 bit CC byte order" is LSB first by default** (confirmed). An MSB-first sender, such as the EC4's 14-bit type (CCAh), then lags one step behind and jumps by up to 127 at each 128 boundary. So for the EC4 the setting must be MSB first.
- **"Send CCs on preset ld":** loading a preset sent nothing to USB C (2026-11-01). **It reaches USB A** (hardware check 3, 2026-11-04): a scene reloaded by program change put the EC4's knob back to the scene's value.
- **SysEx stopped.** After that test the FH-2 no longer answered SysEx on USB C, though it still received CCs. Replugging its USB cable fixed it.

**Consequence for the knobs**
- A relative mapping can't be finer than 1/127 of the range. Fine CV (direct levels, LFO speed and LFO level) needs absolute 14-bit, with "14 bit CC byte order" = MSB first.
- For relative knobs, EC4 acceleration Acc0 or Acc1 suits the 127 steps.

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
- Plan: Night Shift writes its own EC4 setup (setup 15; setup 16 is the MDMM's) and leaves the user's other setups alone.
- Setup names can only be sent along with "all setups"; group and encoder names can be sent per setup.

**Learning a knob on the EC4**
- First pre-format Night Shift's setup so every encoder sends a unique channel/CC.
- Then "turn the knob" identifies the encoder unambiguously, and Night Shift rewrites that encoder's name, range and type.

**Settled (2026-11-01):** the EC4's 14-bit CC sends MSB first and the FH-2 defaults to LSB first, so the FH-2 needs "14 bit CC byte order" = MSB first (see "Measured on the module" above).

## Round 3: controlfrog + Lilypad, one EC4 page per source (2026-10-28)

The user already runs **controlfrog**, their own custom EC4 firmware, together with **Lilypad**, a Web MIDI editor (MIT; github.com/plentyofnames/lilypad, live at plentyofnam.es/lilypad).
- Source: the controlfrog firmware repo (private), with Lilypad as its `editor/` submodule.
- Protocol: `docs/protocol.md` there. Controller behaviour: `docs/control.md`. Profiles draft: `docs/profiles.md`.
- The stock-EC4 SysEx notes above are superseded for this user.
- The BCR32 is left out for now; it is months away.

### controlfrog features Night Shift would use

Framing is `F0 7D 45 43 34 <cmd> … F7`. The EEPROM layout is unchanged from stock.
- **READ / WRITE / RELOAD:** write only Night Shift's setup (setup 15, "FH-2"). Groups become pages: one page per source, plus a mixed "LIVE" page.
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
   - Names come from setup 15 stored on the EC4.
   - Values show in EC4 scales, so Night Shift should pick scales that read well alone (ON/OFF, ±63, %).
   - Pages are switched on the EC4 itself.
   - Scene sync relies on the FH-2's "Send CCs on preset ld" going out to USB A.

**Pre-gig checklist** (mocked in artboard 9).

Night Shift can do these:
- write and select EC4 setup 15;
- turn on the EC4's "send values on group change";
- save the config and presets to FH-2 flash (18H / 19H);
- check the channels.

The user must do these by hand, because FH-2 Settings can't be set over SysEx:
- "Send CCs on preset ld" = 1;
- Startup = last used config and preset;
- "14 bit CC byte order" = MSB first. The EC4's 14-bit mode sends MSB then LSB; the FH-2 defaults to LSB first. Verified on the module (2026-11-01): with the default, MSB-first values lag and jump.

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
- Where does "Send CCs on preset ld" send? On 2026-11-01 nothing came out on USB C. **It does reach USB A** (check 3, 2026-11-04), so live scene sync works.
- What made the FH-2 stop answering SysEx on USB C after the preset-load test, and does it happen again?

## The FH-2's menus over the remote control (walked 2026-11-03, firmware 2.0.0)

Walked with the user at the rack, reading the screen (41H) and the open item (43H/44H) after every event, changing nothing.

**How the menus move**
- On the overview (display mode 0), an **encoder press** (48H 1) opens the main menu (display mode 1).
- In a menu, a **turn** (2 clockwise, 3 counter-clockwise) moves to the next or previous item; menus wrap around (the user's "Menu wrap" is 1).
- **Pressing a submenu** opens it; **pressing a setting** opens it for editing: line 1 shows its name, line 3 its value, and 43H/44H return them ("Contrast", "127"). A turn now would change the value.
- **Left** (4) closes an open setting unchanged (nothing was turned), or goes up one menu level.
- **Long hold on left** (5) goes straight back to the overview, from inside a settings page too. (Not tried with a setting open.)
- With nothing open, 43H answers "Sorry".

**Main menu** (clockwise, wraps): Presets, Configurations, Sequencer Banks, Calibrations, Settings, Misc, Resets.

**Settings** (wraps): General page 1, General page 2, General page 3, Calibration, MIDI Forwarding, History Inclusion, USB Device Name, USB Device Settings, Reset Settings. **Never press Reset Settings.**

**Reading a page safely:** for each item: press, read 43H/44H (and check the name is the one the list showed), left, check nothing is open, turn clockwise; stop when the first item comes round again.

**The user's settings as read (2026-11-03)**

| page | setting | value |
|---|---|---|
| 1 | Contrast | 127 |
| 1 | Top-level encoder | 1 Tempo |
| 1 | Top-level button | 0 Off |
| 1 | Startup preset | 1 Init |
| 1 | Startup configuration | 1 Init |
| 1 | Enable MIDI clock out | 0 Off |
| 1 | Enable DIN MIDI out | **0** (DIN out is off: a sequencer sending to DIN reaches nothing) |
| 1 | Clk stop=>LFOs stop | 1 |
| 1 | Display blank | 15 |
| 1 | Use FH-1 as expander | 0 |
| 1 | Constrain rates | 0 Off |
| 1 | Display flip | 0 |
| 1 | USB reset time | 1 |
| 1 | Tuner pitch reference | 440.0 |
| 1 | Menu wrap | 1 |
| 1 | Accessibility | 0 Off |
| 2 | Wake on MIDI | 1 |
| 2 | Auto display switch | 1 |
| 2 | Button exits display | 1 |
| 2 | Config prog change ch | 0 |
| 2 | Local off DIN / USB A / USB C | 0 / 0 / 0 |
| 2 | SysEx Device ID | 0 |
| 2 | Enable MMC | 0 |
| 3 | Send CCs on preset ld | 1 |
| 3 | Ignore clock DIN / USB A / USB C | 0 / **1** / 0 |
| 3 | Show counter | 0 |
| 3 | Always load direct | 0 |
| 3 | 14 bit CC byte order | **0** (LSB first: the EC4's 14-bit knobs need 1, MSB first) |
| 3 | Nudge amount | 10 |
| 3 | Disable X clocks / Y clocks | 1 / 1 |
| 3 | Max smoothing | 1 |
| 3 | Startup note / drum seq bank | 0 / 0 (none) |
| 3 | MIDI tap tempo | 0 |
| 3 | Enable Select Bus out | 0 |

The overview's line 4 ("C Ch8 St") looks like the last MIDI message received (port, channel, type): to be pinned down for check 5.

**The other Settings sub-menus** (walked 2026-11-03, changing nothing)
- **MIDI Forwarding:** one screen with three fields, "from", "to" and the route's On/Off (shown on the "to" line). A press toggles editing of the field under the cursor; a turn changes it while editing and otherwise moves the cursor. The first time it's opened, the cursor is on "from", not editing; **after that the screen remembers where its cursor was and whether a field was being edited**, across closing it and going home (found 2026-11-03, when a second read met the cursor on "to"). 43H names the field: "MIDI Forwarding from", "MIDI Forwarding to", and for the On/Off the route, e.g. "MIDI Forwarding from USB A to DIN". Reading: edit only "from" and "to", read each route off the "to" line; the cursor never goes to the On/Off. Routes: DIN, USB A, USB C and SEL (Select Bus), each to the other three, plus DIN → DIN. The user's: all Off.
- **History Inclusion:** "Include in history" and a type (Note On/Off, CC, Pitch Bend, Real Time, Aftertouch) with its On/Off on the same line; read by editing only the type. It remembers its cursor and editing state too. 43H names the type field "Include in history" and the On/Off field after its type (e.g. "Note On/Off"). The user's: all On.
- **Finding a remembered cursor safely:** on "from", "to" or the type field a turn is harmless: it moves the cursor, or (while that field is being edited) only picks another route or type. 43H afterwards tells which happened; a press then stops the editing. Night Shift does this before reading and leaves the cursor where the module first had it. If the cursor sits on an On/Off it stops instead (a turn there could change it), and says to move the cursor back on the module.
- **USB Device Name:** a name editor (46H says it's a name; the value ends with a cursor marker). Read, then left; never turned. The user's: blank, so the default name.
- **USB Device Settings:** a list of device types (Generic, Launch Control, Launch Control XL, Launchpad Mini, Launchpad Pro, Launchpad Mini Mk3, Launchpad X, Launchpad Pro Mk3), each a page like the General pages with Echo MIDI and Takeover. The user's: all off, except Takeover on for the Launchpad Mini Mk3.
- Settings › Calibration: walked 2026-11-05, below.

**The Calibrations menus (walked 2026-11-05 with you at the rack, firmware 2.0.0, changing nothing)**
- **Main menu › Calibrations** (wraps): Auto-calibrate, Tuner, Load calibration, Save calibration, Reset calibration, Name calibration, View calibration.
- **Load calibration:** a press opens it at slot 1. 43H/44H give "Load calibration" and the slot number. Line 1 reads "Load calibration *n*", line 3 "For output *m*" or "<Empty>" (an unnamed slot shows no name line). A turn picks the next slot (70, then wraps); **a press would load it**, left leaves without loading. Yours: slots 1–4 for outputs 1–4, unnamed; 5–70 empty.
- **Auto-calibrate:** a page of two fields, "Output *n*" and "GO!", the cursor on Output when it opens. With nothing open a turn moves the cursor (43H "GO!", 44H "Press to begin auto-calibration"); **a press on GO! starts the run**. A press on Output opens it, a turn then changes the output (1 → 2); left from there leaves the page, back to the list. **During a run, screenshots (01H) don't work** (your test, 2026-11-05): Night Shift waits a few seconds, then keeps asking; the first answer is the finished curve.
- **Settings › Calibration** (wraps): Basic, Startup. **Basic** wasn't opened (moving the cursor over a value sets the output to it). **Startup** is the same kind of page: "Output *n*" and "Calibration *k*  Match!" (or "Calibration 0  (None)"), the cursor on Output; a press on Output opens it, a turn shows the next output and its startup slot. Yours: outputs 1–4 load slots 1–4 at power-on (Match!), 5–16 none.
- **These pages remember where they were left** (your FH-2, 2026-11-05): Load calibration reopens at the slot last shown, Startup at the output last shown and with its cursor where it was (on Calibration after a change). On Calibration, 43H can't tell whether the field is open, where a turn changes the setting, but **a screenshot (01H → 33H, 128 × 32 pixels) can** (your idea, 2026-11-05): the FH-2 draws a dotted box round the value the cursor is on and a solid one while that field is open; on Startup, Output's box spans rows 0–10 and Calibration's rows 10–20 (12–22 when open), columns about 71–84. A press toggles a field open and shut. So Night Shift sets Startup right itself before any turn (an open field closed with a press, the cursor moved with nothing open), checks the box again before moving the cursor, opening the Calibration field and turning it, and leaves the cursor on Output with everything closed. Without screenshots it still stops when it finds the cursor on Calibration. Screenshots of these states are in `test/fixtures-startup.js`. 44H gives a calibration of 0 as text ("(None)"); the screen line "Calibration 0  (None)" is read instead.
- **Save calibration** (walked 2026-11-05 after your auto-calibration of output 3; the presses inside it were yours, nothing saved): two steps, as the manual says. (1) A press on it in the list opens a list of outputs: "Output *n*" on line 3 (the cursor line), 43H "Sorry" (no field), no cursor box in the screenshot. It opened at Output 3, the output just calibrated. A turn picks the next output, 1–64, wrapping round (ccw from 1 gives 64). (2) A press picks the output and shows the slots, laid out like Load calibration: line 1 "Save calibration *n*", line 2 the stored name or "<Empty>" (blank for an unnamed one), line 3 "For output *m*" for a used slot; 43H "Save calibration", 44H the slot number. 70 slots, wrapping round (70 → 1). It opened at slot 69 (why 69 is unknown: Night Shift must turn to the slot it wants and check the line). **A press here saves** (manual; not tried, nor whether it asks before overwriting a used slot). Left goes back to the output list, left again to Calibrations.
- **Name calibration:** names "the calibration you are about to save" (manual), so **name first, then save**. A press on it in the list opens a name editor straight away, no slot or output: line 1 "Name calibration", the name on line 2 (yours: empty); 43H "Name calibration", 44H ": cursor at 0 :"; the screenshot shows a dotted box round the first character. As for configuration names (manual): a turn moves the cursor, a press turns the box into an underscore and a turn then changes the character, a press again goes back to the box. Left leaves it unchanged. 47H sets a name item to a string, so Night Shift can write the whole name in one message (not tried here yet).
- **View calibration:** "Out  *n*" on line 1 and that output's calibration curve (it opened at Out 3, the one just calibrated); a turn shows the next output. Changes nothing.
- **Reset calibration** puts an output back to the basic calibration of the settings; stored slots are untouched (manual). Not opened.
- Not opened: Tuner, Reset calibration, Basic.
