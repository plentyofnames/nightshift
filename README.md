# Night Shift

A patch editor for the **Expert Sleepers FH-2** that works from the output side: you look at your rack, pick a jack, and say what should come out of it. The FH-2's configurations and presets, its MIDI channels and its CC mappings are worked out for you. A Faderfox EC4 running [controlfrog](https://github.com/plentyofnames/lilypad) gets a page of knobs for every source.

> **Unofficial.** Night Shift is not made, endorsed or supported by Expert Sleepers. FH-2 is their product; their own tools are at [expert-sleepers.co.uk](https://www.expert-sleepers.co.uk/fh2firmware.html).

## Status

Milestone **M1**, read only: open a config and preset (from `.syx` files or pulled from the FH-2 over Web MIDI) and see your rack, what comes out of every jack, who plays each voice, and which CCs control what. Nothing is written to the module yet; editing comes with v0.1 (M2).

**Try it:** [plentyofnam.es/nightshift](https://plentyofnam.es/nightshift/) (Chrome or Edge for Web MIDI), or the [example patch](https://plentyofnam.es/nightshift/?example).

The plan, the design notes and the facts about the module are in [docs/](docs/).

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
| `js/patch/example.js` | the example patch from the mockups, built as a real config and preset |
| `js/ui/`, `js/app.js` | the read-only patch view and MIDI map |
| `test/` | Deno/browser tests, the official tools as fixtures, a stand-in FH-2 |
| `tools/fh2dump.py` | pulls dumps from the real module and sends them back (hardware check H0) |

## License

MIT, see [LICENSE](LICENSE). `test/official/` holds Expert Sleepers' FH-2 tools under their own MIT licence.
