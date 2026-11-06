// Tests for tunings (js/patch/scala.js): reading .scl and .kbm files, the files kept in the
// project, and a voice's tuning in the preset.

import { test, assert, eq } from './harness.js';
import { examplePatch } from '../js/patch/example.js';
import { apply } from '../js/patch/edit.js';
import { parseScl, parseKbm, asciiText, scalaFiles, fileChange, slotLabel, voiceTuning, setTuning, scalaMismatch } from '../js/patch/scala.js';
import { TEST_SCL, TEST_KBM, SCL_12TET, KBM_12 } from '../js/fh2/checks.js';

const MEANTONE = `! meanquar.scl
!
1/4-comma meantone scale. Pietro Aaron's temperament (1523)
 12
!
 76.04900
 193.15686
 310.26471
 5/4
 503.42157
 579.47057
 696.57843
 25/16
 889.73529
 1006.84314
 1082.89214
 2/1
`;

test('.scl files: description, notes, and what’s wrong with a broken one', () => {
  eq(parseScl(MEANTONE), { ok: true, description: "1/4-comma meantone scale. Pietro Aaron's temperament (1523)", count: 12 });
  eq(parseScl(TEST_SCL), { ok: true, description: 'Night Shift test: 5 equal steps per octave', count: 5 });
  eq(parseScl('only a description').ok, false);
  eq(parseScl('desc\n 3\n 100.0\n 200.0\n').error, '3 notes, but 2 given');
  eq(parseScl('desc\n 2\n 100.0\n wobble\n').error, '“wobble” is no pitch');
});

test('.kbm files: the seven numbers and the map', () => {
  eq(parseKbm(TEST_KBM), { ok: true, size: 0, reference: 60, frequency: 261.625565, octave: 5, degrees: [] });
  const twelve = '! 12-key map\n12\n0\n127\n60\n69\n440.0\n12\n0\n1\n2\n3\n4\n5\n6\n7\n8\n9\nx\n11\n';
  eq(parseKbm(twelve), { ok: true, size: 12, reference: 69, frequency: 440, octave: 12, degrees: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11] });
  eq(parseKbm('12\n0\n127\n60\n69\n440.0\n12\n0\n1\n').error, 'a map of 12 keys expected');
  eq(parseKbm('0\n0\n127\n').error, 'fewer than its 7 numbers');
});

test('the files kept in the project, and a voice’s tuning', () => {
  eq(asciiText('café → x\r\n'), 'caf? ? x\n');
  const { config, preset } = examplePatch();
  const p = { config, preset, names: {} };
  apply(p, [fileChange('scl', 5, { name: 'meanquar', text: MEANTONE })]);
  const files = scalaFiles(p.names, 'scl');
  eq([files[4].slot, files[4].name, files[4].text === MEANTONE, files.filter(Boolean).length], [5, 'meanquar', true, 1]);
  eq([slotLabel(files, 5), slotLabel(files, 6)], ['5: meanquar', '6']);
  apply(p, [fileChange('scl', 5, null)]);
  eq(scalaFiles(p.names, 'scl').filter(Boolean).length, 0, 'forgotten');
  apply(p, setTuning(2, { enable: 1, scl: 5, kbm: 1 }));
  eq(voiceTuning(p.preset.values.converter[2]), { enable: 1, scl: 5, kbm: 1 });
  eq([p.preset.values.converter[2].scalaScl, p.preset.values.converter[2].scalaKbm], [4, 0], 'slot n as n − 1, as your FH-2 counts them (check T2)');
});

test('pairs that may give Scala Error: a linear map, or a map past the scale', () => {
  eq(scalaMismatch(SCL_12TET, KBM_12), null, 'the pair that played in check T2');
  eq(scalaMismatch(TEST_SCL, TEST_KBM), 'a linear map (size 0) gave Scala Error on your FH-2', 'the pair that didn’t');
  const five = '! 5 keys\n5\n0\n127\n60\n60\n261.63\n5\n0\n1\n2\n3\n4\n';
  eq(scalaMismatch(TEST_SCL, five), null);
  eq(scalaMismatch(TEST_SCL, KBM_12), 'the map reaches degree 12, the scale has 5 notes');
  eq(scalaMismatch(null, KBM_12), null, 'a scale Night Shift doesn’t know: only the map is checked');
});
