# Night Shift

A patch editor for the **Expert Sleepers FH-2** that works from the output side: you look at your rack, pick a jack, and say what should come out of it. The FH-2's configurations and presets, its MIDI channels and its CC mappings are worked out for you. A Faderfox EC4 running [controlfrog](https://github.com/plentyofnames/lilypad) and a Behringer BCR32 running Rotary Club get knobs for the settings you pick.

> **Unofficial.** Night Shift is not made, endorsed or supported by Expert Sleepers. FH-2 is their product; their own tools are at [expert-sleepers.co.uk](https://www.expert-sleepers.co.uk/fh2firmware.html).

## Status

What it does (the milestones in [docs/build-plan.md](docs/build-plan.md)):
- It opens on your last patch (kept in the browser) and reads the FH-2 over Web MIDI beside it, so it can say whether they match; Get from FH-2 or Send to FH-2 decides. Or open `.syx` files or a Night Shift project. See your rack, what comes out of every jack, who plays each voice, and which CCs control what.
- Click a free jack to add a voice (mono or poly, gates on the expander or not), a trigger, a fixed voltage, a MIDI knob, an LFO, a clock, a transport signal or a Euclidean rhythm. Night Shift finds room in the FH-2 and won't put anything on top of another source.
- Edit every one of them: LFOs and envelopes drawn as you change them, Euclid patterns, voice outputs and layout, arpeggiators, trigger notes and types, knob CCs (or learn them from a controller on the computer).
- Players: note and drum sequencers, shift-register notes, inputs: wire them to voices and trigger kits, send them out to other gear, clock them from the tempo, the external clock or a Euclid pattern.
- Scenes: several presets for one config. Names for everything, and for the gear on each port, kept in a project file.
- The note and drum sequencers' steps, and their banks; Scala and MTS tunings per voice; the FH-2's own settings and calibrations read from its menus, and a guided auto-calibration per jack.
- Controllers: click a setting's name to put it on a knob. The EC4 (controlfrog) gets a page per source plus pages of your own; the BCR32 (Rotary Club) gets its own four pages, where Night Shift writes only its own knobs. Both keep a live link while connected: their page follows what you select, and their screens show values in FH-2 units. Switch either off in Rack….
- A Gig tab: what has to be right before playing without a computer. Hardware checks (File menu) measure what the docs don't say, on your FH-2.
- Undo and redo everything. Send the result to the FH-2 (it's read back and compared) and save it to the module's flash.

Changes go to the FH-2 only with Send, into its RAM, until you save to flash. Save project keeps everything on your computer; Save .syx keeps the config and the scene in view, for the FH-2 or Expert Sleepers' tools.

**Try it:** [plentyofnam.es/nightshift](https://plentyofnam.es/nightshift/) (Chrome or Edge for Web MIDI), or the [example patch](https://plentyofnam.es/nightshift/?example).

The plan, the design notes and the facts about the module are in [docs/](docs/). [docs/fh2-components.md](docs/fh2-components.md) lists what every part of the FH-2 takes and gives, and what Night Shift assumes about it.

Plain HTML, CSS and JS modules, no build step and no dependencies, like [Lilypad](https://github.com/plentyofnames/lilypad) and [Eye of Providence](https://github.com/plentyofnames/eyeofprovidence), which are included as submodules (`vendor/lilypad` for the EC4, `vendor/eyeofprovidence` for the BCR32). Clone with `--recurse-submodules`.

## Tests

```sh
deno run --allow-read test/run.js
```

Or serve the folder (`python3 -m http.server 8000`) and open <http://localhost:8000/test/>; the app itself is at <http://localhost:8000/>.

The tests run Expert Sleepers' own config and preset encoders (`test/official/`, MIT) with random settings, and check that every field lands where Night Shift's layouts say it does. To also round-trip dumps from your own FH-2, pull them into `test/local/` (git-ignored):

```sh
python3 tools/fh2dump.py pull   # needs: pip install python-rtmidi
```

`tools/fh2dump.py install FILE.syx` sends a dump back and compares what the module then reports.

`tools/check_bcr32_sim.js` runs the BCR32 writer and live link against Rotary Club's own controller code, built as a simulator in its repository (`deno run --allow-run --allow-read tools/check_bcr32_sim.js <path to sim_ctl>`).

## Files

| path | what |
|---|---|
| `js/fh2/layout.js` | field types and the layout codec: decode a dump body into named fields, write changed fields back |
| `js/fh2/config.js` | the config dump, version 11 (firmware 2.0) |
| `js/fh2/preset.js` | the preset dump, version 8 |
| `js/fh2/sysex.js` | FH-2 SysEx framing, commands, dump parsing and building |
| `js/fh2/client.js` | talks to an FH-2 over a MIDI transport, one request at a time |
| `js/patch/derive.js` | turns a config and preset into sources, jacks, players, mappings and problems |
| `js/patch/edit.js` | edits as lists of field changes, checked and undoable; adding and removing sources |
| `js/patch/alloc.js` | finds free FH-2 slots and CCs for new sources, plans voice layouts |
| `js/patch/shapes.js` | the LFO, envelope and Euclid drawings, as numbers |
| `js/patch/project.js` | project files: config, scenes, names and rack in one JSON file |
| `js/patch/example.js` | the example patch from the mockups, built as a real config and preset |
| `js/patch/steps.js`, `scala.js`, `scenes.js`, `gig.js` | sequencer steps and banks, tunings, scenes compared, the pre-gig checklist |
| `js/fh2/menu.js`, `js/fh2/checks.js` | the FH-2's own settings and calibrations through its menus; the hardware checks |
| `js/ec4/` | the EC4's pages, knob feel, setup 15 and its FH-2 sync table, the live link (controlfrog) |
| `js/rotary/` | the BCR32's pages, Night Shift's knobs in its controller image, the live link (Rotary Club) |
| `js/bcr32/` | the BCR32's stock firmware: day-one reads and checks |
| `js/ui/`, `js/app.js` | the patch view, the "+ add" dialog, the editors, players, scenes, steps, settings, the controller tabs, the Gig tab, talking to the FH-2 |
| `checks.html`, `js/checks.js` | the hardware checks page |
| `test/` | Deno/browser tests, the official tools as fixtures, a stand-in FH-2 |
| `tools/fh2dump.py` | pulls dumps from the real module and sends them back (hardware check H0) |
| `tools/check_bcr32_sim.js` | the BCR32 writer against Rotary Club's controller code |

## License

MIT, see [LICENSE](LICENSE). `test/official/` holds Expert Sleepers' FH-2 tools under their own MIT licence.
