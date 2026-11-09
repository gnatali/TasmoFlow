// SPDX-License-Identifier: GPL-3.0-only
// End-to-end tests: /tf loader and interface, against tools/mock_gateway.py.
// Usage: node tests/e2e.js [screenshot folder]   (builds the interface and the .tapp first)
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
execFileSync('node', [path.join(ROOT, 'tools', 'build_app.js')], { stdio: 'inherit' });
const APP = fs.readFileSync(path.join(ROOT, 'dist', 'app.js'));
const VERSION = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
const CDN = `https://gnatali.github.io/TasmoFlow/v${VERSION}/app.js`;
const SHOTS = process.argv[2];
const SRI = execFileSync('python3', [path.join(ROOT, 'tools', 'pack_tapp.py')], { encoding: 'utf8' })
  .match(/SRI: (\S+)/)[1];

function mock(args) {
  const p = spawn('python3', [path.join(ROOT, 'tools', 'mock_gateway.py'), ...args], { stdio: 'ignore' });
  return p;
}
const wait = ms => new Promise(f => setTimeout(f, ms));
const jsBody = body => ({ body, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } });

(async () => {
  const TOKEN_B = 'fedcba9876543210fedcba9876543210';
  const mocks = [mock(['--cdn', CDN, '--sri', SRI]), mock(['--web', '8081', '--api', '8385', '--cdn', CDN, '--sri', SRI, '--token', TOKEN_B, '--name', 'Passerelle B', '--no-tuya'])];
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
      if (errors.length) throw new Error('JS error: ' + errors.join(' | '));
      results.push([name, true]);
    } catch (e) {
      results.push([name, false, e.message.split('\n')[0]]);
    }
    await ctx.close();
  }
  // the full interface, as GitHub Pages serves it, through the first simulated gateway
  async function openFull(p) {
    await p.route(CDN, r => r.fulfill(jsBody(APP)));
    await p.goto('http://localhost:8080/tf');
    await expectSource(p, 'github');
  }
  async function expectSource(p, s) {
    await cards(p);
    const got = await src(p);
    if (got !== s) throw new Error(`source ${got}, expected ${s}`);
  }

  await test('no GitHub: light local copy (devices, toggle, console, diagnostics; no Gateways tab)', async p => {
    await p.route(CDN, r => r.abort());
    await p.goto('http://localhost:8080/tf');
    await expectSource(p, 'local');
    await p.getByRole('status').filter({ hasText: 'Version légère' }).waitFor({ timeout: 2000 });
    await p.getByRole('button', { name: 'Réessayer' }).waitFor();
    for (const n of ['Passerelles', 'Événements']) {
      if (await p.getByRole('button', { name: n }).count()) throw new Error(`${n} tab in the light interface`);
    }
    const lamp = p.locator('article.card', { has: p.getByRole('heading', { name: 'Lampe salon' }) });
    await lamp.getByRole('button', { name: 'Basculer' }).click();
    await p.locator('article.card', { has: p.getByRole('heading', { name: 'Ventilateur', exact: true }) })
      .getByRole('button', { name: /Lumière ventilateur/ }).waitFor({ timeout: 6000 });
    await p.getByRole('button', { name: 'Console' }).click();
    await p.locator('input').fill('ZbInfo');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => /Simulated/.test(document.querySelector('pre').textContent), null, { timeout: 3000 });
    await p.getByRole('button', { name: 'Diagnostic' }).click();
    await p.waitForSelector('dl');
    await p.getByText(`v${VERSION} · local · lite`).waitFor();
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'lite.png') });
  });
  await test('valid GitHub copy', async p => {
    await p.route(CDN, r => r.fulfill(jsBody(APP)));
    await p.goto('http://localhost:8081/tf');
    await expectSource(p, 'github');
  });
  await test('wrong SRI hash: local copy', async p => {
    await p.route(CDN, r => r.fulfill(jsBody(Buffer.concat([APP, Buffer.from('\n//x')]))));
    await p.goto('http://localhost:8081/tf');
    await expectSource(p, 'local');
  });
  await test('slow GitHub (5 s): local copy after 3 s, a single interface', async p => {
    await p.route(CDN, async r => { await wait(5000); try { await r.fulfill(jsBody(APP)); } catch (e) {} });
    await p.goto('http://localhost:8081/tf');
    await expectSource(p, 'local');
    await wait(2500);
    const n = await p.locator('header').count();
    if (n !== 1) throw new Error(`${n} interfaces`);
  });
  await test('GitHub and local copy missing: message', async p => {
    await p.route(CDN, r => r.abort());
    await p.route('http://localhost:8385/lite.js', r => r.abort());
    await p.goto('http://localhost:8081/tf');
    await p.waitForFunction(() => /not found/.test(document.body.textContent), null, { timeout: 4000 });
  });
  await test('walkthrough: toggle, events, console, diagnostics, English', async p => {
    await openFull(p);
    await p.waitForSelector('.badge.ok', { timeout: 5000 });
    const lamp = () => p.locator('article.card', { hasText: 'Lampe salon' });
    const before = /Power 1/.test((await lamp().innerText()).replace(/\n/g, ' '));
    await lamp().getByRole('button').click();
    await p.waitForFunction(on => {
      const c = [...document.querySelectorAll('article.card')].find(a => a.textContent.includes('Lampe salon'));
      return /Power 1/.test(c.innerText.replace(/\n/g, ' ')) === on;
    }, !before, { timeout: 4000 });
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'devices.png') });
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
  await test('Tuya: cards, switches, slider, readings, event back, offline device', async p => {
    await openFull(p);
    const fan = p.locator('article.card', { has: p.getByRole('heading', { name: 'Ventilateur', exact: true }) });
    await fan.waitFor({ timeout: 6000 });
    await fan.getByRole('button', { name: 'Lumière ventilateur · éteint' }).click();
    await fan.getByRole('button', { name: 'Lumière ventilateur · allumé' }).waitFor({ timeout: 4000 });   // state comes back through the event stream
    await fan.getByLabel('Vitesse').fill('5');
    await p.waitForFunction(async t => {
      const r = await (await fetch('http://localhost:8384/api/cmd?t=' + t + '&c=TuyaStatus%20Ventilateur')).json();
      return r.TuyaStatus.Ventilateur.Dps['62'] === 5;      // the slider's TuyaSend reached the driver
    }, '0123456789abcdef0123456789abcdef', { timeout: 4000 });
    await p.getByText(/Total puissance\s*592 W/).waitFor({ timeout: 2000 });
    const door = p.locator('article.card', { has: p.getByRole('heading', { name: 'Entrée-Porche' }) });
    await door.getByText('déconnecté').waitFor({ timeout: 2000 });
    const lamp = p.locator('article.card', { has: p.getByRole('heading', { name: 'Lampe bureau' }) });
    await lamp.getByLabel('Intensité').waitFor();
    await lamp.getByLabel('Température de couleur').waitFor();
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'tuya.png'), fullPage: true });
  });
  await test('several gateways: bad link, add, test, use, still there after reload, remove', async p => {
    await openFull(p);
    await p.getByRole('heading', { name: 'Tuya' }).waitFor({ timeout: 6000 });
    await p.getByRole('button', { name: 'Passerelles' }).click();
    const link = p.getByLabel('Lien de connexion').last();
    await link.fill('pas un lien');
    await p.locator('form button[type=submit]').click();
    await p.getByRole('alert').waitFor({ timeout: 2000 });
    await p.getByLabel('Nom', { exact: true }).fill('Chambre');
    await link.fill('localhost:8385#' + TOKEN_B);
    await p.locator('form button[type=submit]').click();
    await p.getByRole('button', { name: 'Tester' }).click();
    await p.getByText(/joignable · Passerelle B/).waitFor({ timeout: 6000 });
    await p.getByRole('button', { name: 'Utiliser' }).click();
    await p.getByRole('combobox', { name: 'Passerelle' }).waitFor();
    await p.locator('header .gw', { hasText: 'Passerelle B' }).waitFor({ timeout: 6000 });
    await p.getByRole('button', { name: 'Appareils' }).click();
    await cards(p);
    await wait(800);
    if (await p.getByRole('heading', { name: 'Tuya' }).count()) throw new Error('Tuya shown on a gateway without the driver');
    await p.reload();
    await p.getByRole('combobox', { name: 'Passerelle' }).waitFor({ timeout: 6000 });
    await p.getByRole('button', { name: 'Passerelles' }).click();
    p.once('dialog', d => d.accept());
    await p.getByRole('button', { name: 'Supprimer' }).click();
    await p.getByText('Aucune autre passerelle').waitFor({ timeout: 2000 });
  });
  {
    const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 360, height: 760 }, colorScheme: 'dark' });
    const p = await ctx.newPage();
    await openFull(p);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    results.push(['mobile 360 px without overflow', !overflow]);
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'mobile-dark.png'), fullPage: true });
    await ctx.close();
  }

  await browser.close();
  mocks.forEach(m => m.kill());
  let failed = 0;
  for (const [name, ok, why] of results) {
    console.log(`${ok ? 'ok    ' : 'FAIL  '} ${name}${why ? ' : ' + why : ''}`);
    if (!ok) failed++;
  }
  process.exit(failed ? 1 : 0);
})();
