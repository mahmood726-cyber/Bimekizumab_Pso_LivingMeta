/*
 * Minimal smoke / numerical-anchor test for the standalone stat modules.
 * Run: node tests/smoke.test.js   (exit 0 = pass, exit 1 = fail)
 *
 * The browser modules early-return when `window` is undefined, so we provide a
 * minimal global `window` and load the module source into the current realm.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function ok(cond, msg) {
  if (cond) { console.log('  PASS ' + msg); }
  else { console.error('  FAIL ' + msg); failures++; }
}
function approx(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 1e-9 : tol); }

// ---- 1. every standalone JS module parses (syntax smoke) ----
const jsDir = path.join(__dirname, '..', 'assets', 'js');
const mods = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
ok(mods.length > 0, 'found standalone JS modules to load (' + mods.length + ')');

// shared sandbox with a minimal browser-ish window so modules that self-hook
// DOM events at load time don't throw. We only need them to register; the
// numerical anchor below exercises the pure stat function.
const noop = () => {};
const fakeEl = new Proxy({}, {
  get: (_t, k) => (k === 'classList' ? { add: noop, remove: noop, toggle: noop, contains: () => false }
    : k === 'style' ? {}
    : typeof k === 'string' && /^(addEventListener|removeEventListener|appendChild|setAttribute|insertAdjacentHTML|querySelector|querySelectorAll|matches|closest|click|focus)$/.test(k) ? noop
    : ''),
  set: () => true,
});
const fakeDoc = {
  readyState: 'complete',
  addEventListener: noop, removeEventListener: noop,
  createElement: () => fakeEl, getElementById: () => null,
  querySelector: () => null, querySelectorAll: () => [],
  body: fakeEl, head: fakeEl, documentElement: fakeEl,
};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: noop,
  document: fakeDoc, MutationObserver: function () { return { observe: noop, disconnect: noop }; },
};
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
sandbox.window.removeEventListener = noop;
sandbox.window.escapeHtml = s => String(s == null ? '' : s);
vm.createContext(sandbox);

for (const f of mods) {
  const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
  try { vm.runInContext(src, sandbox, { filename: f }); ok(true, 'loaded ' + f); }
  catch (e) { ok(false, 'loaded ' + f + ' (' + e.message + ')'); }
}

// ---- 2. numerical anchor: additive contrast CNMA on disjoint components ----
// Two contrasts with disjoint single components estimate each component exactly;
// residuals are zero -> Q=0, tau2=0, beta == observed te.
const fit = sandbox.window.WideGapCNMA && sandbox.window.WideGapCNMA.fit;
ok(typeof fit === 'function', 'WideGapCNMA.fit is exposed');
if (typeof fit === 'function') {
  const out = fit([
    { A: ['X'], B: [], te: 1.0, se: 0.5 },
    { A: ['Y'], B: [], te: 2.0, se: 0.5 },
  ]);
  const ix = out.comps.indexOf('X'), iy = out.comps.indexOf('Y');
  ok(approx(out.beta[ix], 1.0), 'CNMA beta[X] == 1.0 (got ' + out.beta[ix] + ')');
  ok(approx(out.beta[iy], 2.0), 'CNMA beta[Y] == 2.0 (got ' + out.beta[iy] + ')');
  ok(approx(out.Q, 0, 1e-9), 'CNMA Q == 0 for exact-fit design (got ' + out.Q + ')');
  ok(out.tau2 === 0, 'CNMA tau2 floored at 0 (got ' + out.tau2 + ')');
  ok(out.cov[ix][ix] > 0 && isFinite(out.cov[ix][ix]), 'CNMA cov diagonal finite & positive');
}

if (failures) { console.error('\n' + failures + ' check(s) FAILED'); process.exit(1); }
console.log('\nAll smoke checks passed');
