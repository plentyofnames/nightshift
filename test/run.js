// deno run --allow-read test/run.js
import { runTests } from './harness.js';
import './core.test.js';
import './patch.test.js';
import './edit.test.js';
import './menu.test.js';
import './ec4.test.js';
import './link.test.js';
import './live.test.js';
import './checks.test.js';
import './gig.test.js';

const root = new URL('../', import.meta.url);
const failed = await runTests((path) => Deno.readFile(new URL(path, root)).catch(() => null));
Deno.exit(failed ? 1 : 0);
