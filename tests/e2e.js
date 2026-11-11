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
  // the rule set `n` of the Rules screen: its tab, then its panel
  const rule = async (p, n) => { await p.getByRole('tab', { name: new RegExp('^Rule' + n) }).click(); return p.getByRole('tabpanel'); };
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
    // rules: read, enable/disable, restore, but no editor
    await p.getByRole('button', { name: 'Règles' }).click();
    const r3 = await rule(p, 3);
    await r3.getByRole('button', { name: 'éteint' }).click();
    await r3.getByRole('button', { name: 'allumé' }).waitFor({ timeout: 4000 });
    await (await rule(p, 1)).getByText('Button1#State=3').waitFor();
    if (await p.locator('textarea').count()) throw new Error('rule editor in the light interface');
    if (await p.getByRole('button', { name: 'Phrases' }).count()) throw new Error('sentence editor in the light interface');
    await p.getByRole('button', { name: 'Appareils' }).click();
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
  await test('rules: read, long text in a POST, syntax check, previous copy, restore, flags, Berry rules', async p => {
    await openFull(p);
    await p.getByRole('button', { name: 'Règles' }).click();
    const r1 = await rule(p, 1);
    const box = r1.getByRole('textbox');
    await box.waitFor({ timeout: 4000 });
    const original = await box.inputValue();
    if (!/Button1#State=3/.test(original)) throw new Error('Rule1 text not shown');
    // a text that is not a rule: advice, and no saving
    await box.fill('Power1 on');
    await r1.getByRole('alert').filter({ hasText: 'doit commencer par' }).waitFor();
    if (!(await r1.getByRole('button', { name: 'Enregistrer' }).isDisabled())) throw new Error('save allowed');
    await box.fill('on Power1#State=1 do Power2 1');
    await r1.getByRole('alert').filter({ hasText: 'endon' }).waitFor();
    // longer than a request line: sent in a POST body
    const long = Array.from({ length: 24 }, (_, i) => `on Time#Minute=${i} do Power1 0 endon`).join('\n');
    await box.fill(long);
    await r1.getByText(/Plus de 512 caractères/).waitFor();
    await r1.getByRole('button', { name: 'Enregistrer' }).click();
    await r1.getByText(/Enregistré/).waitFor({ timeout: 4000 });
    const stored = await p.evaluate(async t => (await (await fetch('http://localhost:8384/api/rules?t=' + t)).json()).rules[0].text,
      '0123456789abcdef0123456789abcdef');
    if (stored !== long.replace(/\n/g, ' ')) throw new Error('stored text differs (line breaks must not reach the gateway)');
    const shown = await box.inputValue();
    if (shown !== long) throw new Error('one block per line expected');
    // the previous version is kept, and restoring it brings it back
    await r1.getByText('Copie précédente').click();
    await r1.locator('details pre').getByText('Button1#State=3').waitFor();
    p.once('dialog', d => d.accept());
    await r1.getByRole('button', { name: 'Restaurer cette copie' }).click();
    await r1.getByText('Copie restaurée.').waitFor({ timeout: 4000 });
    if ((await box.inputValue()) !== original) throw new Error('restored text differs');
    // flags and Berry rules
    await (await rule(p, 2)).getByRole('checkbox', { name: 'une seule fois' }).click();
    await p.waitForFunction(async t => (await (await fetch('http://localhost:8384/api/rules?t=' + t)).json()).rules[1].once,
      '0123456789abcdef0123456789abcdef', { timeout: 4000 });
    await p.getByRole('tab', { name: /Règles Berry/ }).click();
    await p.locator('ul.berry').getByText('Button1#State').waitFor();
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'rules.png'), fullPage: true });
  });
  await test('sentence editor: tiles, edit in a dialog, add, condition, delete, raw block, save', async p => {
    await openFull(p);
    await p.getByRole('button', { name: 'Règles' }).click();
    const stored = n => p.evaluate(async ([t, n]) => (await (await fetch('http://localhost:8384/api/rules?t=' + t)).json()).rules[n - 1].text,
      ['0123456789abcdef0123456789abcdef', n]);
    const r1 = await rule(p, 1);
    await r1.getByRole('button', { name: 'Phrases' }).click();
    await r1.locator('.tile').getByText('Button1#State = 3').waitFor();          // one tile per rule
    // the edit form opens over the page, in a dialog
    await r1.getByRole('button', { name: 'Modifier' }).click();
    const dlg = p.getByRole('dialog');
    await dlg.waitFor();
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'dialog.png') });
    await dlg.getByLabel('Valeur').fill('1');
    // a condition and an else branch
    await dlg.getByRole('checkbox', { name: 'Si' }).check();
    await dlg.getByLabel('Si', { exact: true }).last().fill('Var1==1');
    await dlg.getByRole('checkbox', { name: 'Sinon' }).check();
    await dlg.getByLabel('Sinon 1').fill('Power2 off');
    // a second command in Then
    await dlg.getByRole('button', { name: 'Ajouter une commande' }).first().click();
    await dlg.getByLabel('Alors 2').fill('Var1 0');
    await dlg.getByRole('button', { name: 'Terminé' }).click();
    await dlg.waitFor({ state: 'hidden' });
    await r1.locator('.tile .chip', { hasText: 'Var1==1' }).waitFor();             // the tile shows the condition
    // a new rule: a tile to add one, an empty one cannot be saved
    await r1.getByRole('button', { name: /Ajouter une règle/ }).click();
    await dlg.waitFor();
    if (!(await r1.getByRole('button', { name: 'Enregistrer' }).isDisabled())) throw new Error('an empty block can be saved');
    await dlg.getByLabel('Alors 1').fill('Power1 on');
    // the suggestions stay available once a field holds a value
    await dlg.getByRole('combobox', { name: 'Suggestions' }).nth(0).selectOption('Time#Minute');
    if ((await dlg.getByLabel('Quand').inputValue()) !== 'Time#Minute') throw new Error('suggestion not applied');
    await dlg.getByLabel('Quand').fill('System#Boot');
    await p.keyboard.press('Escape');                                              // Escape closes the dialog
    await dlg.waitFor({ state: 'hidden' });
    await r1.getByRole('alert').filter({ hasText: /déclencheur est vide/ }).count();   // (the trigger is filled now: no alert)
    await r1.getByRole('button', { name: 'Enregistrer' }).click();
    await r1.getByText(/Enregistré/).waitFor({ timeout: 4000 });
    const want = 'on Button1#State=1 do if (Var1==1) Backlog Power2 toggle; Var1 0 else Power2 off endif endon on System#Boot do Power1 on endon';
    if ((await stored(1)) !== want) throw new Error('stored: ' + (await stored(1)));
    // the text view shows the same, one block per line
    await r1.getByRole('button', { name: 'Texte' }).click();
    const lines = (await r1.getByRole('textbox').inputValue()).split('\n');
    if (lines.length !== 2) throw new Error('expected 2 lines, got ' + lines.length);
    // opening a rule set in sentences never rewrites it (Rule2: two blocks, one with Backlog)
    const r2 = await rule(p, 2);
    await r2.getByRole('button', { name: 'Phrases' }).click();
    await r2.locator('.tile').getByText('System#Boot').first().waitFor();
    if (!(await r2.getByRole('button', { name: 'Enregistrer' }).isDisabled())) throw new Error('Rule2 changed without edit');
    // delete a block
    await r2.locator('.tile').first().getByRole('button', { name: 'Supprimer' }).click();
    await r2.getByRole('button', { name: 'Enregistrer' }).click();
    await r2.getByText(/Enregistré/).waitFor({ timeout: 4000 });
    if (!/^on System#Boot do Backlog/.test(await stored(2))) throw new Error('block not deleted: ' + (await stored(2)));
    // a block that does not fit a sentence stays text, as a grey tile
    const r1b = await rule(p, 1);
    await r1b.getByRole('button', { name: 'Texte' }).click();
    await r1b.getByRole('textbox').fill('on Power1#State=1 and Power2#State=1 do Power3 1 endon');
    await r1b.getByRole('button', { name: 'Phrases' }).click();
    await r1b.locator('.tile.raw').getByText(/n'entre pas dans une phrase/).waitFor();
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'sentences.png'), fullPage: true });
  });
  await test('device pickers: Zigbee trigger and action, Tuya action, plain-language tile', async p => {
    await openFull(p);
    await p.getByRole('button', { name: 'Règles' }).click();
    const r3 = await rule(p, 3);
    await r3.getByRole('button', { name: 'Phrases' }).click();
    await r3.getByRole('button', { name: /Ajouter une règle/ }).click();
    const dlg = p.getByRole('dialog');
    await dlg.waitFor();
    const picks = dlg.getByRole('combobox', { name: 'Suggestions' });
    await picks.nth(0).selectOption('ZbReceived#0x3C4D#Power');           // trigger: a Zigbee device attribute
    if ((await dlg.getByLabel('Quand').inputValue()) !== 'ZbReceived#0x3C4D#Power') throw new Error('trigger not filled');
    // device information (IEEEAddr, ModelId...) is not an event to wait for
    if (await dlg.locator('option[value$="#IEEEAddr"], option[value$="#ModelId"]').count()) throw new Error('device information offered as a trigger');
    await dlg.getByLabel('Comparaison').selectOption('=');
    await dlg.getByLabel('Valeur').fill('1');
    await picks.nth(1).selectOption('ZbSend {"device":"0x3C4D","send":{"Power":"Toggle"}}');   // the first Then
    await dlg.getByRole('button', { name: 'Ajouter une commande' }).click();
    await dlg.getByRole('combobox', { name: 'Suggestions' }).nth(2).selectOption('TuyaSend Ventilateur,20,toggle');
    await dlg.getByRole('button', { name: 'Terminé' }).click();
    await r3.locator('.tile .chip', { hasText: 'Lampe salon · Power = 1' }).waitFor();             // plain language
    await r3.locator('.tile .chip', { hasText: /basculer Lampe salon/ }).waitFor();
    await r3.locator('.tile .chip', { hasText: /basculer .*\(DP 20\)/ }).waitFor();
    await r3.getByRole('button', { name: 'Enregistrer' }).click();
    await r3.getByText(/Enregistré/).waitFor({ timeout: 4000 });
    const text = await p.evaluate(async t => (await (await fetch('http://localhost:8384/api/rules?t=' + t)).json()).rules[2].text,
      '0123456789abcdef0123456789abcdef');
    const want = 'on ZbReceived#0x3C4D#Power=1 do Backlog ZbSend {"device":"0x3C4D","send":{"Power":"Toggle"}}; TuyaSend Ventilateur,20,toggle endon';
    if (text !== want) throw new Error('stored: ' + text);
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'pickers.png'), fullPage: true });
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
    // the Rules screen on a phone: tabs, tiles, and the dialog stay inside the screen
    try {
      await p.getByRole('button', { name: 'Règles' }).click();
      const panel = await rule(p, 1);
      await panel.getByRole('button', { name: 'Phrases' }).click();
      await panel.locator('.tile').first().waitFor();
      const tilesOverflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'mobile-rules.png'), fullPage: true });
      await panel.getByRole('button', { name: 'Modifier' }).first().click();
      await p.getByRole('dialog').waitFor();
      const box = await p.getByRole('dialog').boundingBox();
      if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'mobile-dialog.png') });
      results.push(['mobile 360 px: rules tiles and dialog inside the screen', !tilesOverflow && box.x >= 0 && box.x + box.width <= 360]);
    } catch (e) { results.push(['mobile 360 px: rules tiles and dialog inside the screen', false, e.message.split('\n')[0]]); }
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
