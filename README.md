# Night Shift

A patch editor for the **Expert Sleepers FH-2** that works from the output side: you look at your rack, pick a jack, and say what should come out of it. The FH-2's configurations and presets, its MIDI channels and its CC mappings are worked out for you. A Faderfox EC4 running [controlfrog](https://github.com/plentyofnames/lilypad) gets a page of knobs for every source.

> **Unofficial.** Night Shift is not made, endorsed or supported by Expert Sleepers. FH-2 is their product; their own tools are at [expert-sleepers.co.uk](https://www.expert-sleepers.co.uk/fh2firmware.html).

## Status

Version 0.1 (milestones M0–M2). What it does:
- Open a config and its presets (`.syx` files, a Night Shift project, or pulled from the FH-2 over Web MIDI) and see your rack, what comes out of every jack, who plays each voice, and which CCs control what.
- Click a free jack to add a voice (mono or poly, gates on the expander or not), a trigger, a fixed voltage, a MIDI knob, an LFO, a clock, a transport signal or a Euclidean rhythm. Night Shift finds room in the FH-2 and won't put anything on top of another source.
- Edit every one of them: LFOs and envelopes drawn as you change them, Euclid patterns, voice outputs and layout, arpeggiators, trigger notes and types, knob CCs (or learn them from a controller on the computer).
- Players: note and drum sequencers, shift-register notes, inputs: wire them to voices and trigger kits, send them out to other gear, clock them from the tempo, the external clock or a Euclid pattern.
- Scenes: several presets for one config. Names for everything, and for the gear on each port, kept in a project file.
- Undo and redo everything. Send the result to the FH-2 (it's read back and compared) and save it to the module's flash.

Changes go into the FH-2's RAM until you save to flash. Save project keeps everything on your computer; Save .syx keeps the config and the scene in view, for the FH-2 or Expert Sleepers' tools. Next (v0.2): pages for the Faderfox EC4 and a live link.

**Try it:** [plentyofnam.es/nightshift](https://plentyofnam.es/nightshift/) (Chrome or Edge for Web MIDI), or the [example patch](https://plentyofnam.es/nightshift/?example).

The plan, the design notes and the facts about the module are in [docs/](docs/). [docs/fh2-components.md](docs/fh2-components.md) lists what every part of the FH-2 takes and gives, and what Night Shift assumes about it.

Plain HTML, CSS and JS modules, no build step and no dependencies, like [Lilypad](https://github.com/plentyofnames/lilypad), which is included as a submodule (`vendor/lilypad`). Clone with `--recurse-submodules`.

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
| `js/ui/`, `js/app.js` | the patch view, the "+ add" dialog, the editors, players, scenes, the MIDI map, talking to the FH-2 |
| `test/` | Deno/browser tests, the official tools as fixtures, a stand-in FH-2 |
| `tools/fh2dump.py` | pulls dumps from the real module and sends them back (hardware check H0) |

## License

MIT, see [LICENSE](LICENSE). `test/official/` holds Expert Sleepers' FH-2 tools under their own MIT licence.
