// The guided auto-calibration (a jack's panel, "Calibrate…", your idea, 2026-11-05): what to patch,
// then the FH-2's own screen, live while it runs (a screenshot about twice a second), so the curve
// can be judged before it is accepted; then Accept or Abandon once the FH-2 asks "Accept?".
// Closing the dialog while it runs abandons the run.

import { h, $, replace } from '../../vendor/lilypad/js/dom.js';

const POLL_MS = 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// `start()`, `watch()` → { rows, asks }, `finish(accept)`: from menu.js, on an open FH-2 client.
// Resolves to 'accepted', 'abandoned' or null (cancelled before it started).
export function calibrationDialog({ jack, start, watch, finish }) {
  return new Promise((resolve) => {
    const dialog = $('dialog');
    const screen = h('canvas', { width: 128, height: 32, class: 'fh2-screen', role: 'img', 'aria-label': 'The FH-2’s screen' });
    const s = { phase: 'patch', error: '', polling: false, result: null };
    const body = h('div', { class: 'modal calibrate' });

    const draw = (rows) => {
      const ctx = screen.getContext('2d');
      const img = ctx.createImageData(128, 32);
      rows.forEach((r, y) => r.forEach((v, x) => {
        const i = 4 * (128 * y + x);
        img.data.set(v ? [130, 230, 255, 255] : [6, 10, 14, 255], i);
      }));
      ctx.putImageData(img, 0, 0);
    };
    const close = (result) => {
      s.polling = false;
      dialog.close();
      resolve(result);
    };
    const end = async (accept) => {
      s.polling = false;
      s.phase = 'finishing';
      render();
      try {
        await finish(accept);
        s.result = accept ? 'accepted' : 'abandoned';
        s.phase = 'done';
      } catch (e) {
        s.error = e.message;
        s.phase = accept ? 'asks' : 'error'; // an early Accept leaves the run going
        if (accept) poll();
      }
      render();
    };
    const poll = async () => {
      if (s.polling) return;
      s.polling = true;
      while (s.polling) {
        try {
          const w = await watch();
          draw(w.rows);
          if (w.asks && s.phase === 'running') {
            s.phase = 'asks';
            render();
          }
        } catch (e) {
          s.error = `No screen from the FH-2: ${e.message}`;
          render();
        }
        await sleep(POLL_MS);
      }
    };
    const go = async () => {
      s.phase = 'starting';
      render();
      try {
        await start();
        s.phase = 'running';
        render();
        poll();
      } catch (e) {
        s.error = e.message;
        s.phase = 'error';
        render();
      }
    };

    const btn = (label, onclick, primary = false, disabled = false) => h('button', { type: 'button', class: primary ? 'primary' : '', disabled, onclick }, label);
    const view = () => {
      const note = (t) => h('p', { class: 'note' }, t);
      const err = s.error ? h('p', { class: 'problem' }, s.error) : null;
      switch (s.phase) {
        case 'patch':
          return [h('h2', {}, `Calibrate jack ${jack}`),
            h('ol', { class: 'note' }, h('li', {}, `Jack ${jack} → the VCO’s pitch input.`), h('li', {}, 'The VCO’s output (a triangle or sine) → the FH-2’s input X.')),
            note('The FH-2 steps the jack through its voltages and draws the VCO’s curve. X’s clock is off meanwhile.'),
            h('div', { class: 'modal-buttons' }, btn('Cancel', () => close(null)), btn('Start', go, true))];
        case 'starting':
          return [h('h2', {}, `Calibrate jack ${jack}`), note('Starting…')];
        case 'running':
        case 'asks':
          return [h('h2', {}, `Calibrating jack ${jack}`), screen, err,
            note(s.phase === 'asks' ? 'Done. A good curve rises evenly. Unplug the VCO from input X first, then accept.' : 'Measuring: the curve is drawn as it goes.'),
            h('div', { class: 'modal-buttons' }, btn('Abandon', () => end(false)), btn('Accept', () => end(true), true, s.phase !== 'asks'))];
        case 'finishing':
          return [h('h2', {}, `Calibrating jack ${jack}`), screen, note('…')];
        case 'done':
          return [h('h2', {}, s.result === 'accepted' ? `Jack ${jack} calibrated` : 'Abandoned'), screen,
            note(s.result === 'accepted' ? 'In use on the jack now, until power-off. Saving it to a slot comes next.' : `Jack ${jack} keeps the calibration it had.`),
            h('div', { class: 'modal-buttons' }, btn('Close', () => close(s.result), true))];
        default:
          return [h('h2', {}, `Calibrate jack ${jack}`), err, h('div', { class: 'modal-buttons' }, btn('Close', () => close(null), true))];
      }
    };
    const render = () => replace(body, view());

    // Escape: before the start, cancel; while it runs, abandon
    dialog.oncancel = (e) => {
      e.preventDefault();
      if (s.phase === 'patch' || s.phase === 'error') close(null);
      else if (s.phase === 'running' || s.phase === 'asks') end(false);
      else if (s.phase === 'done') close(s.result);
    };
    dialog.replaceChildren(body);
    render();
    dialog.showModal();
  });
}
