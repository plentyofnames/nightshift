// A tiny test harness shared by the test files; runs in Deno (test/run.js) and in the browser (test/index.html).

const tests = [];

export const test = (name, fn) => tests.push({ name, fn });

export function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

export function eq(got, want, what = 'value') {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) throw new Error(`${what}: got ${g}, want ${w}`);
}

export function eqBytes(a, b, what = 'bytes') {
  if (a.length !== b.length) throw new Error(`${what}: length ${a.length} != ${b.length}`);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error(`${what}: differ at ${i}: ${a[i]} != ${b[i]}`);
}

export async function runTests(load, print = console.log) {
  let failed = 0;
  for (const t of tests) {
    try {
      const note = await t.fn(load);
      print(`ok   ${t.name}${typeof note === 'string' ? ` (${note})` : ''}`);
    } catch (e) {
      failed++;
      print(`FAIL ${t.name}: ${e.message}`);
    }
  }
  print(failed ? `${failed} of ${tests.length} failed` : `all ${tests.length} passed`);
  return failed;
}
