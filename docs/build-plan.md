# Night Shift: build plan

Written 2026-10-28, after design rounds 1–3. The mockups are on a private design canvas. Facts about the module, the EC4 and the existing tools: [fh2-notes.md](fh2-notes.md).

## Principles

1. **Same stack as Lilypad and Expert Sleepers' own tools.**
   - Plain HTML, CSS and ES modules, with no build step and no dependencies.
   - Runs in Chrome or Edge (Web MIDI with SysEx).
   - Hosted like Lilypad, on GitHub Pages under plentyofnam.es. Locally, `python3 -m http.server` is enough.
2. **The FH-2's bytes are the truth.**
   - Config and preset dumps are decoded into named fields, but the original buffer is kept. An edit writes only its own fields, so bytes we don't understand survive.
   - Everything else is recomputed from those fields after every change: sources, jacks, players, pages.
   - So a config made on the front panel or in the official tool still opens correctly.
3. **Names live beside the bytes, not in them.**
   - The FH-2 only stores 16-character config and preset names.
   - The editor's own data goes in a small sidecar in the project file, keyed by FH-2 object (converter 2, LFO 5, …): source names and colours, declared MIDI devices, scene names, hardware setup, EC4 pages.
   - A config pulled from an FH-2 with no sidecar gets automatic names ("Voice 1").
4. **Mock devices first, hardware last.**
   - Every feature is built and tested against two in-page fakes:
     - recorded dumps from the real FH-2 plus a small stand-in that answers the same SysEx (`test/standin.js`); a fuller fake FH-2 only if the UI work in M1/M2 needs one;
     - Lilypad's demo EC4.
   - Each milestone ends with a short hardware check on the real rig.
5. **Logic without the page.** Everything that matters lives in modules with no DOM code, tested with Deno the way Lilypad's `test/run.js` does it. The UI stays thin.
6. **MIT licence.** No code is taken from FH2Edit (GPLv3); it is only used to cross-check facts. The byte layouts come from the MIT-licensed official tools (github.com/expertsleepersltd/FH-2_tools).

## Code layout

```
index.html, style.css
js/
  fh2/       FH-2 bytes and talking to the module
    layout.js         field types and the codec: decode a dump body into named fields, write changed fields back
    config.js         field table for config v11 (firmware 2.0), from makeSysEx/parseConfigDump
    preset.js         field table for presets (v8), from the preset tool
    sysex.js          framing F0 00 21 27 2F <cmd>, dump parsing and building
    client.js         one request at a time with timeouts: version 22H, dumps 21H/23H,
                      install 10H/13H, save to flash 18H/19H, screen text 41H, names 49H/4AH
    menu.js           operating the FH-2's menus remotely (48H) and reading them back (41H/43H/44H),
                      to read and set the settings that have no SysEx of their own
    (test/standin.js  a minimal FH-2 for the tests: holds a config and a preset, answers the same messages)
  patch/     the editor's own model (what you see on screen)
    derive.js         FH-2 fields → sources, jacks, layers, players, mappings;
                      anything it can't explain becomes an "Unexplained" source showing raw fields
    edit.js           operations that write FH-2 fields; each returns a diff for undo
    alloc.js          voice output blocks (fixed order, stride, gate expander), resource counts,
                      internal channel plan, CC allocation with 14-bit pairing
    scenes.js         one config, several presets
    project.js        project file: config bytes + scene preset bytes + sidecar (JSON)
  ec4/       controller side
    pages.js          page templates per source type, the LIVE page, pages → EC4 setup 16
    link.js           SELECT / STATE / TOUCH / TEXT live link, value texts in FH-2 units, thru on/off
  ui/        views: rack, sources, inspector, add flow, jack chain, voice, MIDI map,
             controllers, source page, connections; Lilypad-style h()/replace() helpers
vendor/lilypad/      git submodule, pinned
test/                Deno tests + hardware check scripts
```

## Sharing code with Lilypad

**Recommendation:** add Lilypad as a git submodule and import its modules directly:
- `proto.js` (controlfrog protocol);
- `device.js` (request/reply client);
- `midi.js` (Web MIDI transport);
- `model.js` (EC4 memory map, for writing setup 16);
- `mock.js`, `demo.js` and `syx.js` (the demo EC4).

None of these touch the page, so they work unchanged. That gives one implementation of the controlfrog protocol, and fixes flow both ways.

**What it costs:** those modules become a small public interface that both apps depend on. If that starts to hurt, split them into their own small repo later. GitHub Pages builds public submodules, so hosting still works.

**Also planned:** exporting an `ec4profile` JSON in the format of Lilypad's `docs/profiles.md`, so a page can be opened in Lilypad too. This answers that draft's open question Q6 the other way round: Night Shift owns the FH-2 config and generates the EC4 pages from it.

**Only one app can talk to the EC4 at a time.** If Lilypad has the EC4 open, Night Shift says so and doesn't take the unit over silently.

## Milestones

### M0: bytes (no UI yet)
- Repo, skeleton and test runner.
- Config and preset field tables, transcribed from the official tools.
- Codec that round-trips the official tool's own files and the factory defaults.
- FH-2 client, tested against a small stand-in FH-2 (no full mock; decided 2026-10-31).
- **Hardware check H0 (with you):**
  - pull config and preset from your FH-2, decode, encode, and compare: they must be byte-identical;
  - send them back unchanged: this must change nothing;
  - request the version.

**Done when** your real dumps round-trip byte for byte.

**H0 done (2026-11-03)** with your FH-2 (firmware v2.0.0, config and preset "Init"), using `tools/fh2dump.py`:
- Both dumps rebuild byte for byte from the decoded values alone, starting from zeros (config 4144 bytes, preset 4436). The layouts account for every byte.
- Installing each one unchanged and reading it back gave identical bytes, and pulling both once more afterwards did too: installing one doesn't touch the other.
- What showed up in the Init config:
  - All 16 Euclid patterns have their Pulses output at 127 *without* the high bit, which reads as GT3/16. Their Off-steps outputs are None (127 with the bit). The official tool reads it the same way, and the module's own menu says GT3/16 too (you checked). So the Init config parks unused Euclids there.
  - 23 gamepad entries and 8 keyboard keys (1–8) sit on outputs: the firmware's defaults, active only with a USB gamepad or keyboard on USB A.
- What Night Shift does about it:
  - A source whose jacks are all outside your rack goes into one "Outside your rack" card, and collisions there aren't reported. It isn't hidden completely: a parked Euclid or clock can still restart an LFO or clock a sequencer.
  - The gamepad and keyboard are dimmed "only with a … on USB A" sources. They aren't drawn on the jacks; a jack's inspector lists them under "With a USB device on USB A". Usages and keys have names now (Y, Button 5, Key 1).
  - Still to do in M2: a parked Euclid counts as free when the add flow looks for one (the pill still says Euclid 16/16, the FH-2's slots in use).

### M1: see your FH-2 (read only)
- Hardware setup: FH-2, CV expanders 1 and 2, gate expanders 0 and 1. Rack drawing with a label at every jack.
- `derive.js` turns the config into the things you see:
  - converters become voice blocks, including gate-expander gates and stride;
  - each LFO becomes a layer on its jack;
  - direct levels plus their CC mappings become knobs or stored levels;
  - clocks, Euclid patterns and shift-register outputs stay what they are;
  - triggers are grouped by channel into drum triggers;
  - sequencers, shift-register notes and CV→MIDI become players, matched to voices by channel.
- Inspector, MIDI map and resource counter, all read only.
- Pull from the FH-2, or open a `.syx` from the official tool.

**Done when** your current setup looks right, and nothing that should be explained shows up as "Unexplained".

### M2: edit and send (first working version, v0.1)
- **Sources you can add, edit and remove:**
  - Voice (mono or poly), with outputs, start jack, gates on the expander, gap between voices, and collision checks;
  - LFO on any CV jack;
  - Clock, including run/start/stop;
  - Euclid;
  - Knob (CC → stored level);
  - Fixed voltage.
- **Jacks:** the "+ add" flow, plus range, gate levels, smoothing and offset.
- **Players:**
  - declared external devices (MiniLab on ch 1, …);
  - note sequencers and the drum sequencer, connected through internal channels picked automatically.
- **Scenes:** one config with presets A/B/C, and dots on the values stored per scene.
- **Undo/redo and saving:**
  - undo and redo;
  - Send to FH-2 (into RAM);
  - Save to a flash slot;
  - save and open project files;
  - export a `.syx` the official tool can open.
- **Learning a knob without the EC4:** declare the channel and CC, or read the last received message from the FH-2's screen text.

**Done when** you can build the example patch from scratch on the real FH-2, it behaves as the mockups say, and the official tool opens what Night Shift wrote.

**Built in two halves (decided 2026-11-03):**
- **M2a:**
  1. The edit core: every edit is a list of field changes, so undo and redo come for free.
  2. Send to FH-2 (config and preset into RAM, then read back and compared) and save to flash, with a mark when Night Shift and the module differ. Sending is a button for now; sending as you edit waits for check 7.
  3. Jack settings: range, offset, smoothing, gate levels.
     - Steps 1–3 done 2026-11-03. You tested Send to FH-2 on the module from Chrome: it worked.
  4. The "+ add" flow on an empty jack, and removing a source, for: fixed voltage, MIDI knob, LFO, clock, transport, Euclid. `alloc.js` finds free FH-2 slots (a parked Euclid counts as free) and suggests CCs.
     - Done 2026-11-03: clicking a free jack opens the dialog; gate jacks offer only clocks, transport and Euclid. A × on each row of a jack's inspector takes that source off the jack; a source's inspector can remove it from all its jacks. Source colours now stay put when sources are added.
  5. Editors for those sources (artboard 3 for the LFO, with its waveform).
     - Done 2026-11-03:
       - LFO: two cycles drawn from the shape mix (redrawn while a slider moves); timing, rate or cycle, depth, the seven shapes, phase, fade, restart (never, a clock, a Euclid; a CC or note set elsewhere is kept); a note about the double jump of check 14.
       - An LFO can also go on top of another source ("Add an LFO on top": 5 Hz sine at 5 %) and be edited and removed from the jack's inspector.
       - Euclid: the pattern drawn as steps, all seven settings.
       - Clocks and transport: signal, rate, pulse, shift per clock.
       - Knobs: channel, CC (free ones, 14-bit marked), relative, the current level.
       - Stored levels: in volts.
     - Hardware check H2: you tried it on the module (2026-11-03): "looks fine". **M2a done.**
- **M2b:** voices (poly, stride, base gate), triggers, players (sequencers, external gear like the Disting, "clocked by"), scenes A/B/C, project files with names, learning a knob.
  - **Voices done 2026-11-03:**
    - "Pitch & gate" in the add dialog: mono or poly, voices, a MIDI channel nothing else uses (CC channels last), outputs per voice and shared, gates on CV jacks or on the gate expander (the first free run long enough).
    - A preview shows every jack the voice would use and what is in the way. Add stays disabled until it fits, and offers a start jack where it does.
    - The voice editor: mode, voices, allocation, stealing; channel (and MPE range), note range, who else is on the channel; output switches, start jack, gates, gap; the layout per voice with clashes; bend, transpose, glide, sustain pedal, retrigger, legato gate; the envelope drawn (shape only) with A/D/S/R, depth, velocity depth, shapes, time range.
    - New voices write the gap between voices explicitly, as the Init config does, instead of relying on stride 0 (check 11); while the gap is "back to back" it follows the outputs.
    - Fixed: the blank preset had transpose 0 (64 semitones down) and envelope settings unlike Init's; it now uses Init's (64 = middle).
    - Fixed: in the add dialog, choosing a "No"/"off" option (knob Relative, gates on CV jacks) actually set it to yes.
    - Glide (your question): the manual (v2.0, "Portamento") says it's always fingered, a glide time between notes played legato, on mono voices and in Unison only; there is no mode to pick. The editor says so, and says when a voice won't glide.
    - Fixed: "Mono retrig" was labelled as retriggering each note. The manual: it decides whether a note that sounds again when you release a key (another one still held) fires the trigger and envelope. Now "Returning note".
    - Added the global "Legato velocity" (mono voices keep the first note's velocity through a phrase) and "Envelope zero start" to the voice editor.
  - **Triggers done 2026-11-03** (called "Trigger", not "drum trigger": they serve any gate):
    - "Trigger" in the add dialog: the channel most triggers already use (else a quiet one), the next free note there (C2 for a new kit), any note, the type, and for Envelope the voice whose envelope settings it borrows. Gate jacks only offer gate-type triggers. Accent types take the next jack up too, and the preview marks the jack that's in the way.
    - The editor (one source per channel): the kit's channel (moves all its triggers), the global trigger length, and per trigger its note, type and envelope source. Removing an accent trigger frees both its jacks.
    - You tried them on the module: they work.
  - **Players done 2026-11-03** (no step editing; a graphical sequence editor can come later):
    - A "Players" group on the stage: note sequencers, the drum sequencer, shift-register notes, arpeggiator out, CV→MIDI, each with its channel, where it sends and its clock.
    - The player inspector: channel, destinations (FH-2, USB C, USB A, DIN, Select), what it plays inside the FH-2, rate and clock source (at rate Ext: the external clock or a Euclid), the drum sequencer's lane notes with the trigger jacks they hit, "Stop sending".
    - "Played by" on a voice or trigger kit: pick a sequencer to play it (the list says which are free and what the others play now); a drum sequencer's lanes take the kit's notes if they don't match; × unwires; "Keep it to the FH-2: move to ch N" moves the source and its players to a channel nothing else uses.
    - A Euclid's inspector lists what it clocks. "Set up a player…" makes a free sequencer send somewhere, e.g. to a Disting on DIN; naming that gear comes with project files.
    - MIDI cables in a gutter left of the cards join players to what they play. A second player hides behind "Add another player…".
    - "Played by" also offers the notes of a shift register in use, and an input in note mode (trigger mode too, for a trigger kit).
    - The voice editor has an Arpeggiator section (manual: "Arpeggiators"): mode (the preset stores ranges; Night Shift writes each range's start), range in octaves, rate, clock source at rate Ext, gate (0 = trigger), latch, reset, and MIDI out (channel, USB C, USB A, DIN). With MIDI out on, the arp also shows as a player.
    - The blank preset now has Init's arp (range 1, gate 64, rate 1/8) and sequencer rates (1/4, 1/16, 1/8, 1/4); it had 0s, which meant range 0 and every sequencer on Ext.
    - The shift register as a source of its own (random CV, change and trigger outputs, its settings) stays in M4.
  - **Names, project files, scenes and learning done 2026-11-03 (M2 complete):**
    - Names beside the bytes: sources and players can be renamed, and the gear on a port and channel named ("Disting mk4" on DIN ch 5, shown in the player's line). Renaming is an edit like any other, so it undoes.
    - Project files (`.nightshift.json`): the config, every scene and the names, with the dumps kept as the FH-2's own bytes, plus the rack. Open… takes a project or `.syx` dumps; several presets in `.syx` files become scenes.
    - Scenes: one config, several presets, as tabs in the bar. + copies the scene in view, − removes it (after asking), clicking the active tab renames it (the preset's own 16-character name). Edits, Send and Save .syx work on the scene in view; undo first goes back to the scene a step was made in. The mark says when another scene is the one on the FH-2.
    - Learning a knob: "Learn" in the add dialog and in the knob editor takes the next CC from any controller connected to this computer. A controller on the FH-2's USB A waits for hardware check 5.
    - Not tried on the module yet: learning with the EC4 on the Mac (needs Chrome), and a scene sent and saved. Saving each scene to its own flash slot isn't offered yet: send a scene, then save, which uses the slot last loaded or saved.
  - **USB gamepad and keyboard entries can be switched off** (your request, 2026-11-03): one at a time with the × on a jack, or all at once from the source. It sets Usage or Type to "--" and leaves the output alone, so the official tool's `0xFF` bug can't happen. Sending that to the module is hardware check 16.

### Next UI round (your ideas, stashed 2026-11-03)
- **No start screen.** Night Shift connects to the real FH-2 as soon as it opens and pulls its config and preset. The example and opening a `.syx` move into the bar (or a menu).
- **Keep the last patch in the browser.** Store the config and preset (and whether they were sent) in the browser's storage after every change. If the FH-2 can't be reached on start, open that copy instead, marked "not on the FH-2", so a patch can be made away from the rack and sent later.
  - No popup for which to keep (your call): Night Shift shows the stored copy, reads the FH-2 in the background, and the mark beside the patch name says whether they differ. **Send to FH-2** and **Get from FH-2** (today's Pull) decide. Getting could become an undoable step, so it needs no "drop your changes?" question either.
  - Today's mark compares with what Night Shift last sent or pulled, so it can't see changes made on the module's panel or in another tool. Reading the module on start (and after a reconnect) fixes that.
  - Browser storage can be cleared or blocked (private windows), so Save .syx stays the safe copy.

### M3: EC4 pages and live link (v0.2)
- Lilypad submodule and EC4 connection.
- Night Shift owns setup 16: it reads, changes and writes only that setup, never the others.
- **Pages:**
  - a page template per source type, made when the source is added, plus the LIVE page;
  - the page editor (artboard 8) and the Controllers view (artboard 6).
- **CCs:** allocated on ch 2. One FH-2 mapping per setting, shared by every page that shows it. Values below CC 32 are kept free for 14-bit pairs.
- **Knob types:** direct levels, LFO speed and LFO level as 14-bit absolute with acceleration; the rest relative or 7-bit absolute (review item 9).
- **Live link:**
  - SELECT, STATE and TOUCH;
  - value texts in FH-2 units, resent after every page change.
- **Connection modes and Night Shift's own thru:**
  - Setting up: Night Shift's thru on.
  - With Logic: Night Shift's thru off.
  - Live: no computer.
- **Pre-gig checklist** (artboard 9).
- **FH-2 settings through the menus** (`menu.js`). The settings have no SysEx of their own, but the FH-2 can be operated like a person at the panel: `48H` presses and turns the controls, and `43H`/`44H`/`41H` read back where the menu is and what it shows (Expert Sleepers' accessibility tool works this way). Two steps:
  1. **Read only first.** Walk to each setting the checklist needs, read its value, and walk back. The checklist then shows the real state:
     - Send CCs on preset ld;
     - 14 bit CC byte order;
     - Startup config/preset;
     - Local off and forwarding for USB A and USB C;
     - Ignore clock per port.
  2. **Then setting them**, once reading has worked on your FH-2:
     - one setting at a time, after you confirm;
     - checking the item name before every press and the value after;
     - backing out with the left button at the first surprise.
  - Rules for both:
    - nothing runs while you could be touching the module;
    - item names are matched by text, so a firmware with a different menu fails safely instead of pressing blindly;
    - every step is logged.
- **Hardware check H3:**
  - 14-bit order between the EC4 and the FH-2;
  - one setting on two pages;
  - scene change sending values back to an EC4 on USB A;
  - Logic forwarding and recording;
  - controlfrog's own SysEx passing through Logic without upsetting the FH-2.

**Done when** the EC4 follows the editor and the other way round, in both the setting-up and the Logic setup, and works on its own on the FH-2's USB A.

### M4 and later (v0.3+)
- Full shift-register editing.
- Drum triggers with accent, velocity and envelope types.
- Inputs X and Y as modulation into any setting.
- HID gamepad and keyboard.
- Scala/MTS per voice.
- Calibrations per jack.
- MiniLab 3 profile; BCR32 when it arrives.
- Sequencer bank import/export.
- A graphical editor for the note and drum sequencers' steps (your idea, 2026-11-03). The players in M2b leave the steps alone, so nothing there stands in its way.
- FH-2 screen shown in the status bar.
- **Graphical LFOs and envelopes** (your idea, 2026-11-02): draw what the settings make, and redraw it as you turn a knob.
  - LFO: one cycle of the shape mix (sine, square with its pulse width, triangle, saw, random, noise), with level, phase and fade-in.
  - Envelope: the ADSR curve with its shapes, range and depth.

## What has to be tested on hardware

Each item is listed with the milestone that needs it.

| # | question | needed for | fallback |
|---|---|---|---|
| 1 | Config and preset round-trip byte-identical (**done 2026-11-03**, see H0); installing while running causes no glitches | M0 | Install only when the transport is stopped |
| 2 | Two mappings on the same channel/CC both work (macro knob) | M3 | One mapping per CC; pages share CCs instead (already planned) |
| 3 | "Send CCs on preset ld" reaches devices on USB A | M3 | Live mode without value sync; a snapshot from the EC4 instead |
| 4 | 14-bit order: the EC4 sends MSB then LSB, but the FH-2 defaults to LSB first | M3 | Set FH-2 Settings › "14 bit CC byte order" to MSB first (added to the checklist), or use 7-bit |
| 5 | The overview screen text (42H) contains the last received MIDI message | M2 | Learn only from controllers on the Mac, or by declaring the channel/CC |
| 6 | Logic: EC4 thru on ch 2, recording, controlfrog SysEx arriving at the FH-2 | M3 | Filter SysEx in Logic's input settings |
| 7 | Installing a config moves outputs (stuck notes or voltage jumps) | M2 | Warn, and offer "send on stop" |
| 8 | The menus can be walked remotely and read back reliably: 43H/44H name every Settings item, and long-holding the left button always gets back to the overview | M3 | Show the checklist's settings as "check on the module" |
| 9 | Setting a value remotely sticks and is stored with the settings (survives a power cycle) | M3 | Read only: Night Shift reports, you change it on the panel |
| 10 | How an output combines (O5–O7): does a converter or clock replace the direct level? Is the LFO added on top of a generator? Is an LFO on its own centred on the direct level? **How:** patch the output into input X, turn X into CV→MIDI CC on a spare channel, and read the CC values while switching the parts on and off. X takes 0–5 V and the CC is 7-bit, so set the output to 0–5 V and use small levels | M2 | Treat the direct level as "only when nothing else is there", and the LFO as added |
| 11 | Voice layout (V6–V8): stride 0 = back to back; shared outputs after the last voice; where Random goes; whether stride also spaces the gate outputs. The base-gate rule itself is settled (see the review section below). Quick to check | M2 | Keep the derived picture marked "assumed" for those cases |
| 12 | ~~Relative CCs on 14-bit settings: how big is one step?~~ **Measured 2026-11-01** (fh2-notes.md): relative mappings are 7-bit, one step = 128 of 16383 | — | Decided: 14-bit absolute with acceleration (see the review section) |
| 13 | Swing: does it shift the clocks, Euclid patterns and sequencers as the manual says, and at the internal 24 ppqn? You're practically certain it does | later | — (information only) |
| 14 | LFO sync and restart (L2, L5): is a synced LFO only tempo-synced, or also locked to the beat? With a restart from a clock at the LFO's own rate, does a saw jump twice (once at the end of its cycle, again at the reset a few ms later)? Can a clock that aims at no real output still restart an LFO? Needs a scope: input X is far too slow for a few milliseconds | M2 | Night Shift notes the double-jump risk when a synced LFO is restarted by a clock; restart from a Euclid pattern instead |
| 15 | Arpeggio notes keep the held note's velocity (A6); still unclear, low priority | later | — |
| 16 | Gamepad and keyboard entries with Usage/Type "--" do nothing on their output, whatever output is set. (The official tool's "None" for these outputs sends `0xFF` inside the SysEx; see fh2-notes.md, "The existing tools") | M2 | Night Shift never writes None there: it switches an entry off through Usage/Type, and keeps every byte 7-bit |

## From your review of fh2-components.md (2026-11-01)

What changes in Night Shift because of your answers:

1. **Gate outputs are always 10 V** (O4). A velocity or accent level can't come out of GT1/GT2. Night Shift warns when a level-type output (velocity trigger/gate, accent level, Euclid accent, envelope, velocity) lands there, and the add flow offers CV jacks for those first.
2. **"Clocked by" is a connection of its own** (T7, A2, R1, N4). With rate 0, an arpeggiator, a note sequencer or a shift register follows its clock source: the external clock or one of the 16 Euclid patterns. "Very useful", so it gets shown like a cable:
   - `derive.js` reads `arpClock`, `noteSequencer.clock` and `srr.clock`;
   - the inspector says "clocked by Euclid 3";
   - the add flow lets you pick a Euclid as the clock.
3. **Players can play external gear too** (N7, D4, B3). A sequencer or a shift register can send its MIDI out to TRS/DIN or USB as well as, or instead of, a voice inside the FH-2. Example: a Disting mk4 used as a sampler gets its sequence from an FH-2 sequencer.
   - Night Shift models external instruments as destinations: a named device on a port and channel.
   - A sequencer can then be "played into" the Disting just like into a voice.
   - The add flow and the MIDI map need this; the mockups only showed internal routing.
4. **Clock comes from MIDI, not input X** (I2). Your clock is Logic over USB C or the Analog Rytm over TRS MIDI. Input X is unused. The connection setups and the MIDI map should show which port the clock comes from, and that X is free for CV→MIDI.
5. **Euclid accents on their own jack** (section 9). Idea: a second Euclid pattern linked to the first (same steps, rate and rotation; its pulses are the accents) gives a separate accent gate. Night Shift could offer this as one "Euclid with accents" source that sets up and keeps both patterns in step.
6. **No "offset" on a generated jack**, unless check 10 says otherwise (O5–O7). Take it out of the jack-chain design for now.
7. **USB gamepad and keyboard:** skipped for now (section 15).
8. **Base gate (V4, V8), settled (2026-11-02):** the base gate can only point at a gate expander. When it is set, the trigger-like outputs (Gate and Trigger per voice, then Para gate) go to the gate outputs one after another from the base gate. The CV-like ones fill the CV outputs one after another from the base output, with no holes where the gates would have been. Without a base gate, everything sits on the CV outputs in V4's order. `derive.js` already works this way; check 11 covers the remaining details (stride, Random).
9. **14-bit everywhere it exists, with acceleration** (check 12). Relative mappings are 7-bit (one step = 128), so they can't give 14-bit. Instead:
   - Direct levels, LFO speed and LFO level are the only settings the FH-2 takes as 14-bit. On the EC4 they become **CC absolute 14-bit (CCAh) with acceleration**: fine steps when you turn slowly, fast sweeps when you turn quickly. CCAh only works on CC 0–31 (paired with n+32), which is why those CCs are kept free.
   - Absolute knobs jump if the EC4 and the FH-2 disagree, so the live link must keep them in step: values written to controlfrog when a page opens, and on preset load ("Send CCs on preset ld", check 3).
   - Everything else on the FH-2 is 7-bit anyway (Euclid pulses, sequencer settings and so on) and stays relative or 7-bit absolute, whichever suits the setting.
10. **LFO restart from a clock** (check 14). If a synced LFO is only tempo-synced, a restart from a clock at its own rate can make a saw jump twice: once at the end of its cycle, then again at the reset a few ms later. Easy to avoid with the right rates, so Night Shift notes it in the inspector rather than forbidding it.

## The hard parts

- **`derive.js`:** turning any config, including one made elsewhere, into a sensible picture. Unexplained sources are the safety net. Tests use real dumps plus generated edge cases.
- **`alloc.js`:** voice blocks in a fixed output order, collision checks, internal channels and CCs.
- **Install behaviour on the real module:** item 7 above.

## Decided

- **Name:** Night Shift. Repo `plentyofnames/nightshift`, public, served at plentyofnam.es/nightshift.
- **Lilypad:** a git submodule (`vendor/lilypad`).
- **Mock FH-2:** none; recorded dumps plus a small stand-in for the tests.
- **v0.1 scope:** M0 to M2, with the EC4 in v0.2.
- **Rack names:** CV1, CV2… and GT1, GT2… in rack order. Each gate module maps to a block of 8 internal outputs (an FHX-8GT with an ESX-8GT = GT0/1–8 and GT0/9–16).
- **FH-2 settings:** read them through the menus first, set them only after that works (M3).
