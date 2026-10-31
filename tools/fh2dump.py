#!/usr/bin/env python3
"""Pull config and preset dumps from an FH-2 over CoreMIDI, and send one back (hardware check H0).

  fh2dump.py ports                                   list MIDI ports
  fh2dump.py pull [OUT_DIR] [--port NAME]            version, names, config.syx and preset.syx
                                                     (default OUT_DIR: test/local, git-ignored)
  fh2dump.py install FILE.syx [--port NAME] [--yes]  send a config or preset dump, pull it back
                                                     and compare the bodies byte by byte

Pulling only asks the module for data: nothing on it changes. Installing replaces the FH-2's
current config or preset in RAM (not in flash), so it asks first unless --yes is given.
The default port is the first one whose name contains "FH-2".

Run with:  conda run --no-capture-output -n claude python tools/fh2dump.py pull
"""
import os
import sys
import time

import rtmidi

HEADER = [0xF0, 0x00, 0x21, 0x27, 0x2F]
REQ_CONFIG, REQ_VERSION, REQ_PRESET = 0x21, 0x22, 0x23
REQ_CONFIG_NAME, REQ_PRESET_NAME = 0x49, 0x4A
INSTALL_CONFIG, INSTALL_PRESET, MESSAGE = 0x10, 0x13, 0x32
TIMEOUT_S = 5


def arg(args, flag, default=None):
    return args[args.index(flag) + 1] if flag in args else default


def open_ports(want):
    inp, out = rtmidi.MidiIn(), rtmidi.MidiOut()
    ins, outs = inp.get_ports(), out.get_ports()
    pick = lambda names: next((i for i, n in enumerate(names) if want.lower() in n.lower()), None)
    i, o = pick(ins), pick(outs)
    if i is None or o is None:
        sys.exit(f"no MIDI port matching {want!r}: inputs {ins}, outputs {outs}")
    inp.ignore_types(sysex=False, timing=True, active_sense=True)
    inp.open_port(i)
    out.open_port(o)
    print(f"using {ins[i]!r}")
    return inp, out


def request(inp, out, cmd, reply):
    while inp.get_message():  # drop anything queued
        pass
    out.send_message(HEADER + [cmd, 0xF7])
    t0 = time.time()
    while time.time() - t0 < TIMEOUT_S:
        m = inp.get_message()
        if m and m[0][:5] == HEADER and len(m[0]) > 6 and m[0][5] == reply:
            return bytes(m[0])
        time.sleep(0.002)
    sys.exit(f"no reply to {cmd:02X}H within {TIMEOUT_S} s")


def text(msg):
    return msg[6:-1].split(b"\0")[0].decode("ascii", "replace")


def pull(out_dir, want):
    inp, out = open_ports(want)
    print("version:", text(request(inp, out, REQ_VERSION, MESSAGE)))
    print("config: ", text(request(inp, out, REQ_CONFIG_NAME, REQ_CONFIG_NAME)))
    print("preset: ", text(request(inp, out, REQ_PRESET_NAME, REQ_PRESET_NAME)))
    os.makedirs(out_dir, exist_ok=True)
    for name, cmd, reply in [("config", REQ_CONFIG, INSTALL_CONFIG), ("preset", REQ_PRESET, INSTALL_PRESET)]:
        msg = request(inp, out, cmd, reply)
        path = os.path.join(out_dir, name + ".syx")
        with open(path, "wb") as f:
            f.write(msg)
        version = sum(b << (7 * i) for i, b in enumerate(msg[8:12]))
        print(f"{name}: {len(msg)} bytes, version {version} -> {path}")


def install(path, want, yes):
    with open(path, "rb") as f:
        msg = f.read()
    if list(msg[:5]) != HEADER or msg[5] not in (INSTALL_CONFIG, INSTALL_PRESET) or msg[-1] != 0xF7:
        sys.exit(f"{path} is not an FH-2 config or preset dump")
    kind = "config" if msg[5] == INSTALL_CONFIG else "preset"
    if not yes and input(f"Replace the FH-2's current {kind} (RAM only) with {path}? [y/N] ").lower() != "y":
        sys.exit("nothing sent")
    inp, out = open_ports(want)
    out.send_message(list(msg))
    time.sleep(0.5)
    back = request(inp, out, REQ_CONFIG if kind == "config" else REQ_PRESET, msg[5])
    a, b = msg[8:-1], back[8:-1]
    diffs = [i for i in range(min(len(a), len(b))) if a[i] != b[i]]
    if len(a) == len(b) and not diffs:
        print(f"{kind} installed and read back identical ({len(back)} bytes)")
    else:
        print(f"{kind} read back differs: lengths {len(a)}/{len(b)}, {len(diffs)} bytes differ")
        for i in diffs[:40]:
            print(f"  body offset {i}: sent {a[i]:3d}, read back {b[i]:3d}")
        sys.exit(1)


def main(args):
    if not args or args[0] in ("-h", "--help"):
        sys.exit(__doc__)
    want = arg(args, "--port", "FH-2")
    if args[0] == "ports":
        print("inputs: ", rtmidi.MidiIn().get_ports())
        print("outputs:", rtmidi.MidiOut().get_ports())
    elif args[0] == "pull":
        rest = [a for a in args[1:] if not a.startswith("--") and a != want]
        here = os.path.dirname(os.path.abspath(__file__))
        pull(rest[0] if rest else os.path.join(here, "..", "test", "local"), want)
    elif args[0] == "install" and len(args) > 1:
        install(args[1], want, "--yes" in args)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
