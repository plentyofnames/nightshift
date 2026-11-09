// The guided auto-calibration (a jack's panel, "Calibrate…", your idea, 2026-11-05): what to patch,
// then the run. The FH-2 doesn't answer while it measures (your test, 2026-11-05), so Night Shift
// waits a few seconds, then asks for its screen about once a second; the first answer is the curve,
// shown here so it can be judged, then Accept (once it asks "Accept?") or Abandon (your idea).
// Closing the dialog while it runs abandons the run. Accepted, it can be named and saved into an
// empty flash slot, or over one of the jack's own (the FH-2 can't delete one), and loaded at
// power-on.

import { h, $, replace } from '../../vendor/lilypad/js/dom.js';
import { CALIBRATION_NAME_LENGTH as NAME_LENGTH } from '../fh2/menu.js';

const WAIT_MS = 5000; // before the first question
const POLL_MS = 1000; // between questions, each waiting for its answer
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// `start()`, `watch()` → { rows, asks } (answered once the run is over), `finish(accept)`, `save({ name, slot, onStep })` →
// { slot, name } (`replace`: over one of the jack's own), `powerOn(slot)`: from menu.js, on an open
// FH-2 client. `free`: the empty slots as last read, or null (then the first empty one is found on
// the module); `own`: the jack's saved ones, [{ slot, name }]. Resolves to 'saved', 'accepted',
// 'abandoned' or null (cancelled before it started).
export function calibrationDialog({ jack, start, watch, finish, save, powerOn, free = null, own = [] }) {
  return new Promise((resolve) => {
    const dialog = $('dialog');
    const screen = h('canvas', { width: 128, height: 32, class: 'fh2-screen', role: 'img', 'aria-label': 'The FH-2’s screen' });
    const s = { phase: 'patch', error: '', shown: false, polling: false, result: null,
      name: today(), slot: free?.[0] ?? (free ? own[0]?.slot ?? null : null), atPowerOn: true, step: '', saved: null, powerOnError: '' };
    const replacing = () => own.some((o) => o.slot === s.slot);
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
        s.phase = accept && save ? 'keep' : 'done';
      } catch (e) {
        s.error = e.message;
        s.phase = accept ? 'asks' : 'error';
      }
      render();
    };
    // after a wait, its screen until it asks "Accept?"; no answer means it is still measuring
    const poll = async () => {
      s.polling = true;
      await sleep(WAIT_MS);
      while (s.polling && s.phase === 'running') {
        try {
          const w = await watch();
          if (!s.polling) break;
          draw(w.rows);
          s.shown = true;
          if (w.asks) {
            s.polling = false;
            s.phase = 'asks';
          }
          render();
        } catch {} // still measuring
        if (s.polling) await sleep(POLL_MS);
      }
    };
    // name it (the FH-2 takes ASCII), save it, then load it at power-on if asked
    const keep = async () => {
      const name = s.name.replace(/[^\x20-\x7e]/g, '').trim().slice(0, NAME_LENGTH);
      Object.assign(s, { phase: 'saving', error: '', step: 'Starting…' });
      render();
      try {
        s.saved = await save({ name: name || undefined, slot: s.slot, replace: replacing(), onStep: (t) => { s.step = `${t[0].toUpperCase()}${t.slice(1)}…`; render(); } });
      } catch (e) {
        Object.assign(s, { phase: 'keep', error: `Stopped: ${e.message}` });
        return render();
      }
      if (s.atPowerOn && powerOn) {
        s.step = 'Setting it at power-on…';
        render();
        try {
          await powerOn(s.saved.slot);
        } catch (e) {
          s.powerOnError = e.message;
        }
      }
      Object.assign(s, { phase: 'saved', result: 'saved' });
      render();
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
      const shot = s.shown ? screen : null;
      switch (s.phase) {
        case 'patch':
          return [h('h2', {}, `Calibrate jack ${jack}`),
            h('ol', { class: 'note' }, h('li', {}, `Jack ${jack} → the VCO’s pitch input.`), h('li', {}, 'The VCO’s output (a triangle or sine) → the FH-2’s input X.')),
            note('The FH-2 steps the jack through its voltages and draws the VCO’s curve. X’s clock is off meanwhile.'),
            h('div', { class: 'modal-buttons' }, btn('Cancel', () => close(null)), btn('Start', go, true))];
        case 'starting':
          return [h('h2', {}, `Calibrate jack ${jack}`), note('Starting…')];
        case 'running':
          return [h('h2', {}, `Calibrating jack ${jack}`), shot, err,
            note('Measuring. The curve shows here when it’s done.'),
            h('div', { class: 'modal-buttons' }, btn('Abandon', () => end(false)), btn('Accept', null, true, true))];
        case 'asks':
          return [h('h2', {}, `Calibrating jack ${jack}`), screen, err,
            note('A good curve rises evenly. Unplug the VCO from input X first, then accept.'),
            h('div', { class: 'modal-buttons' }, btn('Abandon', () => end(false)), btn('Accept', () => end(true), true))];
        case 'finishing':
          return [h('h2', {}, `Calibrating jack ${jack}`), shot, note('…')];
        case 'keep': {
          const full = free && !free.length && !own.length;
          const options = [...(free ?? []).map((n) => [n, `${n} (empty)`]), ...own.map((o) => [o.slot, `${o.slot}: replace${o.name ? ` “${o.name}”` : ''}`]),
            ...(free && !free.length ? [] : [[null, 'First empty']])];
          return [h('h2', {}, `Jack ${jack} calibrated`), shot,
            note('In use on the jack until power-off. Save it to keep it.'), err,
            h('div', { class: 'fields calibrate-save' },
              h('label', { class: 'field' }, h('span', {}, 'Name'), h('input', { type: 'text', class: 'text', maxlength: NAME_LENGTH, value: s.name,
                'aria-label': 'Calibration name', oninput: (e) => { s.name = e.target.value; } })),
              h('label', { class: 'field' }, h('span', {}, 'Slot'), full ? h('span', { class: 'problem' }, 'No empty slot')
                : h('select', { 'aria-label': 'Calibration slot', onchange: (e) => { s.slot = e.target.value ? Number(e.target.value) : null; render(); } },
                  options.map(([n, t]) => h('option', { value: n == null ? '' : String(n), selected: n === s.slot }, t)))),
              h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.atPowerOn, onchange: (e) => { s.atPowerOn = e.target.checked; } }), 'At power-on')),
            h('div', { class: 'modal-buttons' }, btn('Not now', () => close('accepted')), btn(replacing() ? `Replace slot ${s.slot}` : 'Save', keep, true, full))];
        }
        case 'saving':
          return [h('h2', {}, `Saving jack ${jack}’s calibration`), shot, note(s.step)];
        case 'saved':
          return [h('h2', {}, `Saved in slot ${s.saved.slot}`), shot,
            note(`${s.saved.name ? `“${s.saved.name}”, f` : 'F'}or jack ${jack}.${s.atPowerOn && !s.powerOnError ? ' Loads at power-on.' : ''}`),
            s.powerOnError ? h('p', { class: 'problem' }, `Not set at power-on: ${s.powerOnError}`) : null,
            h('div', { class: 'modal-buttons' }, btn('Close', () => close('saved'), true))];
        case 'done':
          return [h('h2', {}, s.result === 'accepted' ? `Jack ${jack} calibrated` : 'Abandoned'), shot,
            note(s.result === 'accepted' ? 'In use on the jack until power-off.' : `Jack ${jack} keeps the calibration it had.`),
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
      else if (s.phase === 'done' || s.phase === 'saved') close(s.result);
      else if (s.phase === 'keep') close('accepted');
    };
    dialog.replaceChildren(body);
    render();
    dialog.showModal();
  });
}
