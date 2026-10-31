# Night Shift: build plan

Written 2026-10-28, after design rounds 1–3. Mockups: https://claude.ai/artifact/TB5bu5hZkNGuxcySwEAdtF. Facts about the module, the EC4 and the existing tools: [fh2-notes.md](fh2-notes.md).

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
    sysex.js          framing F0 00 21 27 2F <cmd>, 7-bit helpers (safe short, signed char)
    schema-config.js  field table for config v11 (firmware 2.0), from makeSysEx/parseConfigDump
    schema-preset.js  field table for presets, from the preset tool
    codec.js          decode(bytes) → { fields, raw }; encode(fields, raw) → bytes
    client.js         one request at a time with timeouts: version 22H, dumps 21H/23H,
                      install 10H/13H, save to flash 18H/19H, screen text 41H, names 49H/4AH
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

### M3: EC4 pages and live link (v0.2)
- Lilypad submodule and EC4 connection.
- Night Shift owns setup 16: it reads, changes and writes only that setup, never the others.
- **Pages:**
  - a page template per source type, made when the source is added, plus the LIVE page;
  - the page editor (artboard 8) and the Controllers view (artboard 6).
- **CCs:** allocated on ch 2. One FH-2 mapping per setting, shared by every page that shows it. Values below CC 32 are kept free for 14-bit pairs.
- **Live link:**
  - SELECT, STATE and TOUCH;
  - value texts in FH-2 units, resent after every page change.
- **Connection modes and Night Shift's own thru:**
  - Setting up: Night Shift's thru on.
  - With Logic: Night Shift's thru off.
  - Live: no computer.
- **Pre-gig checklist** (artboard 9).
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
- FH-2 screen shown in the status bar.

## What has to be tested on hardware

Each item is listed with the milestone that needs it.

| # | question | needed for | fallback |
|---|---|---|---|
| 1 | Config and preset round-trip byte-identical; installing while running causes no glitches | M0 | Install only when the transport is stopped |
| 2 | Two mappings on the same channel/CC both work (macro knob) | M3 | One mapping per CC; pages share CCs instead (already planned) |
| 3 | "Send CCs on preset ld" reaches devices on USB A | M3 | Live mode without value sync; a snapshot from the EC4 instead |
| 4 | 14-bit order: the EC4 sends MSB then LSB, but the FH-2 defaults to LSB first | M3 | Set FH-2 Settings › "14 bit CC byte order" to MSB first (added to the checklist), or use 7-bit |
| 5 | The overview screen text (42H) contains the last received MIDI message | M2 | Learn only from controllers on the Mac, or by declaring the channel/CC |
| 6 | Logic: EC4 thru on ch 2, recording, controlfrog SysEx arriving at the FH-2 | M3 | Filter SysEx in Logic's input settings |
| 7 | Installing a config moves outputs (stuck notes or voltage jumps) | M2 | Warn, and offer "send on stop" |

## The hard parts

- **`derive.js`:** turning any config, including one made elsewhere, into a sensible picture. Unexplained sources are the safety net. Tests use real dumps plus generated edge cases.
- **`alloc.js`:** voice blocks in a fixed output order, collision checks, internal channels and CCs.
- **Install behaviour on the real module:** item 7 above.

## Decisions for you

1. **Name and repo:**
   - is "Night Shift" the name, or do you have a better one?
   - repo `plentyofnames/<name>`, public, served at `plentyofnam.es/<name>`?
2. **Lilypad:** share it as a submodule (recommended), or copy the four modules in?
3. **Where to build:** this folder (`~/Documents/Claude Code/FH-2`) as the repo? It currently holds only `docs/`.
4. **v0.1 scope:** M0 to M2 as above, with the EC4 coming in v0.2. Or should the EC4 pages come earlier, with fewer source types?
