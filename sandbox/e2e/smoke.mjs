// Headless smoke test in demo mode: runs every starter example, checks Python output, flies the
// simulated drone to completion, checks the task list and the (simulated) plan status, and fails
// on page errors or CSP violations.
//   BASE_URL=http://localhost:3010 SCREENSHOT_DIR=/tmp/shots node e2e/smoke.mjs
//   (HTTPS dev server with a self-signed cert is fine: certificate errors are ignored.)
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3010/';
const OUT = process.env.SCREENSHOT_DIR ?? path.resolve('e2e-results');
const TAG = process.env.TAG ?? 'dev';
mkdirSync(OUT, { recursive: true });

const problems = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  const text = msg.text();
  if (msg.type() === 'error' || /Content Security Policy|securitypolicyviolation/i.test(text)) {
    problems.push(`console.${msg.type()}: ${text}`);
  }
});
await page.exposeFunction('__cspViolation', (v) => problems.push(`CSP violation: ${v}`));
await page.addInitScript(() => {
  document.addEventListener('securitypolicyviolation', (e) =>
    window.__cspViolation(`${e.violatedDirective} blocked ${e.blockedURI}`),
  );
});

const shot = (name) => page.screenshot({ path: path.join(OUT, `${TAG}-${name}.png`), fullPage: true });
const consoleText = () => page.getByTestId('console-output').innerText();

const t0 = Date.now();
await page.goto(BASE_URL);
await page.getByTestId('python-status').filter({ hasText: 'Python: ready' }).waitFor({ timeout: 60_000 });
console.log(`Python ready after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await shot('0-ready');

async function runExample(title, expectText) {
  await page.getByLabel('Starter example').selectOption({ label: title });
  await page.getByRole('button', { name: '▶ Run' }).click();
  await page.getByTestId('console-output').filter({ hasText: /✓ Finished|Traceback|Error/ }).waitFor({ timeout: 60_000 });
  const out = await consoleText();
  if (!out.includes('✓ Finished')) throw new Error(`${title} failed:\n${out}`);
  if (!out.includes(expectText)) throw new Error(`${title}: expected "${expectText}" in:\n${out}`);
  console.log(`OK  ${title}`);
  return out;
}

await runExample('1. List plans', 'Tank 3 follow-up');
await shot('1-list-plans');

await runExample('2. Verify a plan', '[FAIL (3)] BWT 3P / Draft – needs review');
await shot('2-verify-plan');

const taskStates = async () =>
  page.getByRole('list', { name: 'Plan tasks' }).getByRole('listitem').evaluateAll((rows) =>
    rows.map((r) => ({ text: r.textContent ?? '', active: r.getAttribute('aria-current') === 'true' })),
  );

async function expectMidFlight(label) {
  await page.getByRole('list', { name: 'Plan tasks' }).locator('[aria-current="true"]').waitFor({ timeout: 20_000 });
  const rows = await taskStates();
  const active = rows.filter((r) => r.active);
  if (active.length !== 1 || !/en route|inspecting/.test(active[0].text)) {
    throw new Error(`${label}: expected one active task, got ${JSON.stringify(rows)}`);
  }
  console.log(`OK  ${label} mid-flight: ${active[0].text.replace(/\s+/g, ' ')}`);
}

async function waitLanded(label, expectInspected) {
  await page.getByLabel('Speed').selectOption('25');
  await page.getByTestId('flight-phase').filter({ hasText: 'Landed' }).waitFor({ timeout: 90_000 });
  const rows = await taskStates();
  const inspected = rows.filter((r) => /inspected/.test(r.text)).length;
  if (inspected !== expectInspected) throw new Error(`${label}: ${inspected} inspected rows: ${JSON.stringify(rows)}`);
  if (rows.some((r) => r.active || /pending|en route|inspecting/.test(r.text))) {
    throw new Error(`${label}: unfinished rows after landing: ${JSON.stringify(rows)}`);
  }
  console.log(`OK  ${label} landed, ${inspected}/${rows.length} rows inspected`);
}

const planStatus = () => page.getByTestId('plan-status').innerText();

await runExample('3. Fly the mission', 'Mission demo-plan-followup: 8/8 tasks inspected');
const out3 = await consoleText();
if (!out3.includes('simulated: plan demo-plan-followup → Complete (not written to CDF)')) {
  throw new Error(`3: no simulated status update in:\n${out3}`);
}
await page.getByLabel('Speed').selectOption('10');
await page.getByRole('button', { name: 'Restart' }).click();
await page.waitForTimeout(2500);
await expectMidFlight('3');
if ((await planStatus()) !== 'Ready') throw new Error(`3: pill should still say Ready mid-flight: ${await planStatus()}`);
await shot('3a-task-panel-mid-flight');
await waitLanded('3', 8);
const summary = await page.getByTestId('mission-summary').innerText();
if (!/Tasks inspected\s*8 \/ 8/.test(summary)) throw new Error(`unexpected summary: ${summary}`);
if ((await planStatus()) !== 'Complete') throw new Error(`plan status pill: ${await planStatus()}`);
console.log('OK  drone flew to completion, plan pill Complete:', summary.replace(/\s+/g, ' '));
await shot('3b-landed-plan-complete');

// The (simulated) status change is visible to later scripts...
await runExample('1. List plans', 'Tank 3 follow-up');
if (!/Complete\s+Tank 3 follow-up/.test(await consoleText())) throw new Error('list: follow-up not Complete');
console.log('OK  plans.list() sees the simulated Complete');

await runExample('4. Hand-fly with poses', 'Mission demo-plan-ndt-sweep:');
await page.getByLabel('Speed').selectOption('10');
await page.getByRole('button', { name: 'Restart' }).click();
await page.waitForTimeout(3000);
await expectMidFlight('4');
await shot('4a-hand-fly-mid-flight');
await waitLanded('4', 6);
if ((await planStatus()) !== 'Ready') throw new Error(`4: plan status pill: ${await planStatus()}`);
await shot('4b-hand-fly-landed');

// ...until Reload, which fetches fresh data.
await page.getByRole('button', { name: 'Reload' }).click();
await page.getByTestId('data-summary').filter({ hasText: '4 plans' }).waitFor({ timeout: 10_000 });
await runExample('1. List plans', 'Tank 3 follow-up');
if (!/Ready\s+Tank 3 follow-up/.test(await consoleText())) throw new Error('reload did not reset the simulated status');
console.log('OK  Reload drops the simulated status change');

// Stop: an infinite loop must be stoppable and Python must come back.
await page.getByLabel('Starter example').selectOption({ label: '1. List plans' });
await page.locator('.cm-content').click();
await page.keyboard.press('ControlOrMeta+a');
await page.keyboard.type('while True:\n    pass\n');
await page.getByRole('button', { name: '▶ Run' }).click();
await page.getByRole('button', { name: '■ Stop' }).waitFor({ state: 'visible' });
await page.waitForTimeout(500);
await page.getByRole('button', { name: '■ Stop' }).click();
await page.getByTestId('console-output').filter({ hasText: 'Stopped by user' }).waitFor({ timeout: 10_000 });
await page.getByTestId('python-status').filter({ hasText: 'Python: ready' }).waitFor({ timeout: 60_000 });
console.log('OK  stop + restart');
await shot('5-after-stop');

await browser.close();
if (problems.length) {
  console.error('Problems:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('Smoke test passed');
