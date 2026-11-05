// SPDX-License-Identifier: GPL-3.0-only
// Tests de bout en bout : chargeur /tf et interface, contre tools/mock_gateway.py.
// Usage : python3 tools/pack_tapp.py && node tests/e2e.js [dossier des captures]
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'app', 'app.js'));
const VERSION = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
const CDN = `https://gnatali.github.io/TasmoFlow/v${VERSION}/app.js`;
const SHOTS = process.argv[2];
const SRI = execFileSync('python3', [path.join(ROOT, 'tools', 'pack_tapp.py')], { encoding: 'utf8' })
  .match(/SRI : (\S+)/)[1];

function mock(args) {
  const p = spawn('python3', [path.join(ROOT, 'tools', 'mock_gateway.py'), ...args], { stdio: 'ignore' });
  return p;
}
const wait = ms => new Promise(f => setTimeout(f, ms));
const jsBody = body => ({ body, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } });

(async () => {
  const mocks = [mock([]), mock(['--web', '8081', '--api', '8385', '--cdn', CDN, '--sri', SRI])];
  await wait(1000);
  const browser = await chromium.launch();
  const results = [];
  const ctxOpts = { locale: 'fr-FR', viewport: { width: 1280, height: 800 } };
  const src = p => p.evaluate(() => window.TASMOFLOW && window.TASMOFLOW.source);
  const cards = p => p.waitForSelector('article.card >> nth=2', { timeout: 6000 });

  async function test(name, fn) {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      await fn(page);
      if (errors.length) throw new Error('erreur JS : ' + errors.join(' | '));
      results.push([name, true]);
    } catch (e) {
      results.push([name, false, e.message.split('\n')[0]]);
    }
    await ctx.close();
  }
  async function expectSource(p, s) {
    await cards(p);
    const got = await src(p);
    if (got !== s) throw new Error(`source ${got}, attendu ${s}`);
  }

  await test('sans GitHub : copie locale', async p => {
    await p.goto('http://localhost:8080/tf');
    await expectSource(p, 'local');
  });
  await test('GitHub valide', async p => {
    await p.route(CDN, r => r.fulfill(jsBody(APP)));
    await p.goto('http://localhost:8081/tf');
    await expectSource(p, 'github');
  });
  await test('empreinte SRI fausse : copie locale', async p => {
    await p.route(CDN, r => r.fulfill(jsBody(Buffer.concat([APP, Buffer.from('\n//x')]))));
    await p.goto('http://localhost:8081/tf');
    await expectSource(p, 'local');
  });
  await test('GitHub lent (5 s) : copie locale apres 3 s, une seule interface', async p => {
    await p.route(CDN, async r => { await wait(5000); try { await r.fulfill(jsBody(APP)); } catch (e) {} });
    await p.goto('http://localhost:8081/tf');
    await expectSource(p, 'local');
    await wait(2500);
    const n = await p.locator('header').count();
    if (n !== 1) throw new Error(`${n} interfaces`);
  });
  await test('GitHub et copie locale absents : message', async p => {
    await p.route(CDN, r => r.abort());
    await p.route('http://localhost:8385/app.js', r => r.abort());
    await p.goto('http://localhost:8081/tf');
    await p.waitForFunction(() => /introuvable/.test(document.body.textContent), null, { timeout: 4000 });
  });
  await test('parcours : basculer, evenements, console, diagnostic, anglais', async p => {
    await p.goto('http://localhost:8080/tf');
    await cards(p);
    await p.waitForSelector('.badge.ok', { timeout: 5000 });
    const lamp = () => p.locator('article.card', { hasText: 'Lampe salon' });
    const before = /Power 1/.test((await lamp().innerText()).replace(/\n/g, ' '));
    await lamp().getByRole('button').click();
    await p.waitForFunction(on => {
      const c = [...document.querySelectorAll('article.card')].find(a => a.textContent.includes('Lampe salon'));
      return /Power 1/.test(c.innerText.replace(/\n/g, ' ')) === on;
    }, !before, { timeout: 4000 });
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'appareils.png') });
    await p.getByRole('button', { name: 'Événements' }).click();
    await p.waitForSelector('ol.ev li', { timeout: 3000 });
    await p.getByRole('button', { name: 'Console' }).click();
    await p.locator('input').fill('ZbInfo');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => /Simulated/.test(document.querySelector('pre').textContent), null, { timeout: 3000 });
    await p.getByRole('button', { name: 'Diagnostic' }).click();
    await p.waitForSelector('dl');
    await p.getByRole('button', { name: 'English' }).click();
    await p.getByRole('button', { name: 'Devices' }).waitFor({ timeout: 2000 });
  });
  {
    const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 360, height: 760 }, colorScheme: 'dark' });
    const p = await ctx.newPage();
    await p.goto('http://localhost:8080/tf');
    await cards(p);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    results.push(['mobile 360 px sans debordement', !overflow]);
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'mobile-sombre.png'), fullPage: true });
    await ctx.close();
  }

  await browser.close();
  mocks.forEach(m => m.kill());
  let failed = 0;
  for (const [name, ok, why] of results) {
    console.log(`${ok ? 'ok    ' : 'ECHEC '} ${name}${why ? ' : ' + why : ''}`);
    if (!ok) failed++;
  }
  process.exit(failed ? 1 : 0);
})();
