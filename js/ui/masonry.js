// Boxes in columns (the Settings tab, your call 2026-11-14): as many columns of at least `min` px as
// fit, the first row in order, then each next box under the column that keeps the whole lowest
// (tried every way for a few boxes, else the shortest column each time). Boxes are positioned, not
// moved, so a field being typed in keeps its focus. Run after each render and on resize.

// The column of each box: heights `hs`, `cols` columns, `gap` px between boxes.
export function columnsFor(hs, cols, gap) {
  const col = hs.map((_, i) => Math.min(i, cols - 1));
  if (hs.length <= cols) return col;
  const first = hs.slice(0, cols).map((x) => x + gap);
  const rest = hs.slice(cols);
  const ways = cols ** rest.length;
  if (ways <= 4096) {
    let best = null;
    for (let w = 0; w < ways; w++) {
      const tops = [...first];
      const pick = [];
      for (let k = 0, x = w; k < rest.length; k++, x = Math.floor(x / cols)) {
        pick.push(x % cols);
        tops[x % cols] += rest[k] + gap;
      }
      const height = Math.max(...tops);
      // lowest; at a tie, the one whose columns are most even
      const spread = tops.reduce((a, t) => a + t * t, 0);
      if (!best || height < best.height - 0.5 || (Math.abs(height - best.height) <= 0.5 && spread < best.spread)) best = { height, spread, pick };
    }
    return [...col.slice(0, cols), ...best.pick];
  }
  const tops = [...first];
  return [...col.slice(0, cols), ...rest.map((x) => {
    const c = tops.indexOf(Math.min(...tops));
    tops[c] += x + gap;
    return c;
  })];
}

// Lays out the children of `el` (position: relative; its children position: absolute). Its new
// height can bring in the page's scroll bar (or take it away), and with it another width: then again.
export function masonry(el, opts = {}) {
  for (let k = 0, width = -1; k < 3 && el.isConnected && el.clientWidth !== width; k++) {
    width = el.clientWidth;
    place(el, width, opts);
  }
}

function place(el, width, { min = 380, gap = 16 } = {}) {
  const items = [...el.children];
  if (!items.length) return;
  const cols = Math.max(1, Math.min(items.length, Math.floor((width + gap) / (min + gap))));
  const cw = Math.floor((width - gap * (cols - 1)) / cols);
  for (const it of items) it.style.width = `${cw}px`;
  const hs = items.map((it) => it.offsetHeight);
  const col = columnsFor(hs, cols, gap);
  const tops = Array(cols).fill(0);
  items.forEach((it, i) => {
    const c = col[i];
    it.style.left = `${c * (cw + gap)}px`;
    it.style.top = `${tops[c]}px`;
    tops[c] += hs[i] + gap;
  });
  el.style.height = `${Math.max(...tops) - gap}px`;
}
