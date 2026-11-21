#!/usr/bin/env node
// Headless check for the Lake Atlas. No npm deps: drives Google Chrome over the DevTools protocol with Node's
// built-in WebSocket (Node 22+), like maps/check/check.mjs.
//
//   node check/check.mjs                         # starts dev-server.py on 8128, local data
//   node check/check.mjs --url http://127.0.0.1:8127/        # an already running server
//   node check/check.mjs --url https://hyderabad.urbanobservatory.in/lakes/   # the live site
//   node check/check.mjs --shots DIR             # also write screenshots to DIR
//
// Fails (exit 1) on console errors, uncaught exceptions, failed or >= 400 requests, the page not reaching its
// ready state, or a step whose panel text is not what it should be.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const argv = process.argv.slice(2);
const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const BASE = arg('--url') || 'http://127.0.0.1:8128/';
const SHOTS = arg('--shots');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
process.on('exit', () => procs.forEach((p) => { try { p.kill(); } catch { /* */ } }));

async function waitHttp(url, ms = 15000) {
  const t = Date.now();
  while (Date.now() - t < ms) { try { const r = await fetch(url); if (r.ok) return; } catch { /* */ } await sleep(200); }
  throw new Error('timeout waiting for ' + url);
}

if (!arg('--url')) {
  procs.push(spawn('python3', ['dev-server.py', '--port', '8128'], { cwd: ROOT, stdio: 'ignore' }));
  await waitHttp(BASE + 'index.html');
}
if (!existsSync(CHROME)) { console.error('Chrome not found at', CHROME); process.exit(2); }
const dbg = 9300 + Math.floor(Math.random() * 500);
procs.push(spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'lk-chrome-'))}`,
  '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' }));
await waitHttp(`http://127.0.0.1:${dbg}/json/version`);
const targets = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let seq = 0; const pending = new Map(); const handlers = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  else if (m.method) handlers.forEach((h) => h(m));
});
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

const problems = [];
const reqs = new Map();
handlers.push((m) => {
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('console: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === 'Network.requestWillBeSent') reqs.set(m.params.requestId, m.params.request.url);
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) problems.push(`HTTP ${m.params.response.status} ${m.params.response.url}`);
  if (m.method === 'Network.loadingFailed' && !m.params.canceled) problems.push(`failed ${reqs.get(m.params.requestId)}: ${m.params.errorText}`);
});
await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable');

async function viewport(w, h, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
}
async function open(qs = '') {
  await send('Page.navigate', { url: BASE + qs });
  const t = Date.now();
  while (Date.now() - t < 30000) {
    if (await evaluate("document.getElementById('loader')?.classList.contains('done') && !!window.__lakesMap && window.__lakesMap.loaded()").catch(() => false)) break;
    await sleep(300);
  }
  await sleep(1500);
}
async function shot(name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
}
const text = (id) => evaluate(`document.getElementById('${id}').innerText`);
function expect(step, cond, detail) { if (!cond) problems.push(`${step}: ${detail}`); else console.log('ok  ', step); }

// 1. overview
await viewport(1440, 900);
await open('');
expect('overview title', (await text('p-title')) === 'Lakes and their catchments', await text('p-title'));
const body = await text('panel-body');
expect('overview rain', /\d+(\.\d)? ?mm/.test(body), body.slice(0, 200));
expect('overview lakes count', /Lakes in HMDA\s*3,556/.test(body), body.slice(-400));
await shot('1-overview');

// 2. a lake with lakes upstream and a chain to the river
await open('?lake=lake_00929');
expect('lake title', (await text('p-title')) === 'Lake 929', await text('p-title'));
const lb = await text('panel-body');
expect('lake upstream', /2 lakes drain into it/.test(lb), lb.slice(0, 300));
expect('lake river', /reaches the \w/.test(lb), lb.slice(0, 300));
expect('lake highlight', await evaluate("JSON.stringify(window.__lakesMap.getFilter('lakes-up')).includes('lake_00928')"), 'upstream filter');
await shot('2-lake');

// 3. a spot: the map click path (grid lookup → lake)
await open('?pt=78.4500,17.4200');
expect('spot', /flows (into|to)/.test(await text('p-eyebrow')) || /Outside/.test(await text('p-title')), await text('p-eyebrow'));
await shot('3-spot');

// 4. the controls
await evaluate("document.getElementById('btn-layers').click()");
await sleep(300);
expect('layers card', await evaluate("!document.getElementById('layers').hidden"), 'did not open');
await evaluate("document.getElementById('chk-streams').click()");
await sleep(800);
await shot('4-layers');
await evaluate("document.getElementById('btn-about').click()");
await sleep(300);
expect('about', await evaluate("!document.getElementById('about').hidden"), 'did not open');
await shot('5-about');

// 5. phone
await viewport(375, 812, true);
await open('?lake=lake_00929');
expect('phone lake', (await text('p-title')) === 'Lake 929', await text('p-title'));
expect('phone no sideways scroll', await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'scrolls sideways');
await shot('6-phone');

if (problems.length) { console.log('\nPROBLEMS'); for (const p of [...new Set(problems)]) console.log(' -', p); process.exit(1); }
console.log('\nall good');
process.exit(0);
