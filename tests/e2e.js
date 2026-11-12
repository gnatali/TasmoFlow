// SPDX-License-Identifier: GPL-3.0-only
// End-to-end tests: /tf loader and interface, against tools/mock_gateway.py.
// Usage: node tests/e2e.js [screenshot folder]   (builds the interface and the .tapp first)
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// fixed version: the tests must not depend on the tags of the clone (the update tests install older ones)
process.env.TF_VERSION = process.env.TF_VERSION || '9.9.9';
execFileSync('node', [path.join(ROOT, 'tools', 'build_app.js')], { stdio: 'inherit' });
const APP = fs.readFileSync(path.join(ROOT, 'dist', 'app.js'));
const VERSION = process.env.TF_VERSION;
const CDN = `https://gnatali.github.io/TasmoFlow/v${VERSION}/app.js`;
const SHOTS = process.argv[2];
const PAGES = 'https://gnatali.github.io/TasmoFlow/';
const UPD = PAGES + 'latest.json';
const DEVUPD = PAGES + 'dev/latest.json';
const TAPP_URL = PAGES + `v${VERSION}/TasmoFlow.tapp`;
// pack first: the .tapp read below must be the one built with this run's version
const SRI = execFileSync('python3', [path.join(ROOT, 'tools', 'pack_tapp.py')], { encoding: 'utf8' })
  .match(/SRI: (\S+)/)[1];
const TAPP = fs.readFileSync(path.join(ROOT, 'dist', 'TasmoFlow.tapp'));
const TAPP_SHA = require('crypto').createHash('sha256').update(TAPP).digest('hex');

function mock(args) {
  const p = spawn('python3', [path.join(ROOT, 'tools', 'mock_gateway.py'), ...args], { stdio: 'ignore' });
  return p;
}
const wait = ms => new Promise(f => setTimeout(f, ms));
const jsBody = body => ({ body, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } });

(async () => {
  const TOKEN_B = 'fedcba9876543210fedcba9876543210';
  const mocks = [mock(['--cdn', CDN, '--sri', SRI]), mock(['--web', '8081', '--api', '8385', '--cdn', CDN, '--sri', SRI, '--token', TOKEN_B, '--name', 'Passerelle B', '--no-tuya']),
    // gateways one version behind: the /tf page checks the update manifest of its channel
    mock(['--web', '8082', '--api', '8386', '--cdn', CDN, '--sri', SRI, '--version', '0.0.9', '--upd', UPD]),
    mock(['--web', '8083', '--api', '8387', '--cdn', CDN, '--sri', SRI, '--version', '0.1.0-dev.aaaaaaa', '--upd', DEVUPD]),
    // drivers: Zigbee then Tuya starting (delays counted from the first request), Tuya disabled, Zigbee never up
    mock(['--web', '8084', '--api', '8388', '--cdn', CDN, '--sri', SRI, '--zb-delay', '3', '--tuya-delay', '7']),
    mock(['--web', '8085', '--api', '8389', '--cdn', CDN, '--sri', SRI, '--tuya-disabled']),
    mock(['--web', '8086', '--api', '8390', '--cdn', CDN, '--sri', SRI, '--zb-delay', '3600', '--tuya-disabled'])];
  await wait(1000);
  const browser = await chromium.launch();
  const results = [];
  const ctxOpts = { locale: 'fr-FR', viewport: { width: 1280, height: 800 } };
  const src = p => p.evaluate(() => window.TASMOFLOW && window.TASMOFLOW.source);
  // the rule set `n` of the Rules screen: its accordion section, opened, then the section's content
  const rule = async (p, n) => {
    const head = p.getByRole('button', { name: new RegExp('^Rule' + n) });
    if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
    return p.getByRole('region', { name: new RegExp('^Rule' + n) });
  };
  // a field of the edit dialog ("Quand", "Alors 1"...): pick an item of its list, or write it
  const choose = async (dlg, label, option) => {
    await dlg.getByRole('button', { name: new RegExp('^' + label + ' :') }).click();
    await dlg.getByRole('option', { name: option, exact: true }).click();
  };
  const write = async (dlg, label, text) => {
    await choose(dlg, label, 'Personnalisé…');
    await dlg.getByLabel(label, { exact: true }).fill(text);
  };
  const cards = p => p.waitForSelector('article.card >> nth=2', { timeout: 6000 });

  async function test(name, fn) {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    if (process.env.DEBUG) page.on('requestfailed', r => console.log('requestfailed', r.url().slice(0, 90), r.failure() && r.failure().errorText));
    try {
      await fn(page);
      if (errors.length) throw new Error('JS error: ' + errors.join(' | '));
      results.push([name, true]);
    } catch (e) {
      if (process.env.DEBUG) await page.screenshot({ path: path.join(SHOTS || '/tmp', 'fail-' + results.length + '.png'), fullPage: true }).catch(() => {});
      results.push([name, false, process.env.DEBUG ? e.message : e.message.split('\n')[0]]);
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

  await test('no GitHub: light local copy (device control only: Zigbee and Tuya, no other screen)', async p => {
    await p.route(CDN, r => r.abort());
    await p.goto('http://localhost:8080/tf');
    await expectSource(p, 'local');
    await p.getByRole('status').filter({ hasText: 'Version légère' }).waitFor({ timeout: 2000 });
    await p.getByRole('button', { name: 'Réessayer' }).waitFor();
    // a single screen: no tab bar, and none of the full interface's screens
    if (await p.locator('nav').count()) throw new Error('tab bar in the light interface');
    for (const n of ['Règles', 'Événements', 'Console', 'Passerelles', 'Diagnostic']) {
      if (await p.getByRole('button', { name: n, exact: true }).count()) throw new Error(`${n} tab in the light interface`);
    }
    await p.getByRole('button', { name: /^Appairer/ }).waitFor();
    // Zigbee: the toggle's new state comes back through the event stream
    const lamp = () => p.locator('article.card', { has: p.getByRole('heading', { name: 'Lampe salon' }) });
    const before = /Power 1/.test((await lamp().innerText()).replace(/\n/g, ' '));
    await lamp().getByRole('button', { name: 'Basculer' }).click();
    await p.waitForFunction(on => {
      const c = [...document.querySelectorAll('article.card')].find(a => a.textContent.includes('Lampe salon'));
      return /Power 1/.test(c.innerText.replace(/\n/g, ' ')) === on;
    }, !before, { timeout: 4000 });
    // Tuya: switch and slider
    const fan = p.locator('article.card', { has: p.getByRole('heading', { name: 'Ventilateur', exact: true }) });
    await fan.getByRole('button', { name: 'Lumière ventilateur · éteint' }).click({ timeout: 6000 });
    await fan.getByRole('button', { name: 'Lumière ventilateur · allumé' }).waitFor({ timeout: 4000 });
    await fan.getByLabel('Vitesse').fill('4');
    await p.waitForFunction(async t => {
      const r = await (await fetch('http://localhost:8384/api/cmd?t=' + t + '&c=TuyaStatus%20Ventilateur')).json();
      return r.TuyaStatus.Ventilateur.Dps['62'] === 4;
    }, '0123456789abcdef0123456789abcdef', { timeout: 4000 });
    await fan.getByRole('button', { name: 'Lumière ventilateur · allumé' }).click();             // back as it was
    await fan.getByRole('button', { name: 'Lumière ventilateur · éteint' }).waitFor({ timeout: 4000 });
    // a name with a comma goes by its id; no colour picker in the light interface
    const tv = p.locator('article.card', { has: p.getByRole('heading', { name: 'Salon, TV', exact: true }) });
    await tv.getByRole('button', { name: 'TV · éteint' }).click();
    await tv.getByRole('button', { name: 'TV · allumé' }).waitFor({ timeout: 4000 });
    await tv.getByRole('button', { name: 'TV · allumé' }).click();
    await tv.getByRole('button', { name: 'TV · éteint' }).waitFor({ timeout: 4000 });
    if (await p.locator('input[type=color]').count()) throw new Error('colour picker in the light interface');
    await p.getByText(`v${VERSION} · local · lite`).waitFor();
    await p.getByRole('button', { name: 'English' }).click();
    await p.getByRole('button', { name: 'Toggle' }).first().waitFor({ timeout: 2000 });
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
    // what is being typed survives the events that arrive meanwhile (they re-render the screen)
    await box.fill('on Time#Minute=5 do Power1 0 endon');
    await wait(3500);
    if ((await box.inputValue()) !== 'on Time#Minute=5 do Power1 0 endon') throw new Error('the text being edited was lost');
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
    await p.getByRole('button', { name: /Règles Berry/ }).click();
    await p.locator('ul.berry').getByText('Button1#State').waitFor();
    await p.locator('ul.berry').getByText('TuyaLocal', { exact: true }).waitFor();   // the owner of a rule registered from an object
    await p.locator('pre.code').getByText('tuya_local').first().waitFor();            // autoexec.be, read only
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
    await write(dlg, 'Sinon 1', 'Power2 off');
    // a second command in Then
    await dlg.getByRole('button', { name: 'Ajouter une commande' }).first().click();
    await write(dlg, 'Alors 2', 'Var1 0');
    await dlg.getByRole('button', { name: 'Terminé' }).click();
    await dlg.waitFor({ state: 'hidden' });
    await r1.locator('.tile .chip', { hasText: 'Var1==1' }).waitFor();             // the tile shows the condition
    // a new rule: a tile to add one, an empty one cannot be saved
    await r1.getByRole('button', { name: /Ajouter une règle/ }).click();
    await dlg.waitFor();
    if (!(await r1.getByRole('button', { name: 'Enregistrer' }).isDisabled())) throw new Error('an empty block can be saved');
    await write(dlg, 'Alors 1', 'Power1 on');
    // one field: closed it reads like the tile, open it lists everything with the current item highlighted
    await choose(dlg, 'Quand', 'Time#Minute');
    await dlg.getByRole('button', { name: /^Quand : Time#Minute/ }).click();
    if ((await dlg.getByRole('option', { name: 'Time#Minute', exact: true }).getAttribute('aria-selected')) !== 'true') throw new Error('current item not highlighted');
    await dlg.getByRole('option', { name: 'System#Boot', exact: true }).click();
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
    // in a small window (the report: about 520 px high) the list floats over the dialog, whole
    await p.setViewportSize({ width: 1000, height: 520 });
    await dlg.getByRole('button', { name: /^Alors 1 :/ }).click();
    const pop = dlg.getByRole('listbox');
    await pop.waitFor();
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'list-over-dialog.png') });
    const box = await pop.boundingBox();
    const hit = await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest('.pop')); }, [box.x + box.width / 2, box.y + box.height / 2]);
    if (!(box.y >= 0 && box.y + box.height <= 520 && box.height >= 120 && hit)) throw new Error('list cut off or covered: ' + JSON.stringify(box));
    await p.keyboard.press('Escape');                                    // closes the list, not the dialog
    await pop.waitFor({ state: 'hidden' });
    await dlg.waitFor();
    await choose(dlg, 'Quand', 'Power');                                 // a Zigbee device attribute
    await dlg.getByRole('button', { name: /^Quand : Lampe salon · Power/ }).waitFor();   // closed, it reads like the tile
    await dlg.getByLabel('Comparaison').selectOption('=');
    await dlg.getByLabel('Valeur').fill('1');
    await choose(dlg, 'Alors 1', 'basculer');                           // the first Then: switch the lamp over
    await dlg.getByRole('button', { name: 'Ajouter une commande' }).click();
    await choose(dlg, 'Alors 2', 'Lumière ventilateur · basculer');     // a Tuya device
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
  await test('conflicts: two rule sets toggling the same light on the same event', async p => {
    await openFull(p);
    await p.getByRole('button', { name: 'Règles' }).click();
    const off3 = (await rule(p, 3)).getByRole('button', { name: 'éteint' });         // Rule3 starts switched off
    if (await off3.count()) { await off3.click(); await (await rule(p, 3)).getByRole('button', { name: 'allumé' }).waitFor({ timeout: 4000 }); }
    const same = 'on Button1#State=3 do Power2 toggle endon';
    for (const n of [1, 3]) {
      const r = await rule(p, n);
      await r.getByRole('textbox').fill(same);
      await r.getByRole('button', { name: 'Enregistrer' }).click();
      await r.getByText(/Enregistré/).waitFor({ timeout: 4000 });
    }
    const banner = p.locator('.conflicts');
    await banner.getByText(/Règles qui peuvent se gêner \(1\)/).waitFor({ timeout: 4000 });
    await banner.getByText(/l'effet s'annule/).waitFor();
    await banner.getByText(/Rule1 · règle 1, Rule3 · règle 1/).waitFor();
    // the sets concerned carry a warning sign, wherever the page is scrolled to
    await p.getByRole('button', { name: /^Rule1/ }).getByRole('img', { name: /Règles qui peuvent se gêner/ }).waitFor();
    await p.getByRole('button', { name: /^Rule3/ }).getByRole('img', { name: /Règles qui peuvent se gêner/ }).waitFor();
    if (await p.getByRole('button', { name: /^Rule2/ }).getByRole('img').count()) throw new Error('warning on a rule set that does not clash');
    // a rule set that is switched off does not count
    const r3 = await rule(p, 3);
    await r3.getByRole('button', { name: 'allumé' }).click();
    await banner.waitFor({ state: 'detached', timeout: 4000 });
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'conflicts.png'), fullPage: true });
  });
  // ---- update of the .tapp: gateways on 8082 (releases) and 8083 (test builds) are one version behind
  const reset = (api, version, extra = '') => fetch(`http://localhost:${api}/__test/reset?version=${encodeURIComponent(version)}${extra}`);
  const manifest = (p, url, m) => p.route(url, r => r.fulfill({ json: m, headers: { 'access-control-allow-origin': '*' } }));
  const tappRoute = p => p.route(TAPP_URL, r => r.fulfill({ body: TAPP, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' } }));
  const latest = (extra = {}) => ({ version: VERSION, size: TAPP.length, sha256: TAPP_SHA, tapp: `v${VERSION}/TasmoFlow.tapp`, ...extra });
  await test('update: a newer version puts the light interface up with a button; "Later" opens the GitHub one', async p => {
    await reset(8386, '0.0.9');
    await p.route(CDN, r => r.fulfill(jsBody(APP)));
    await manifest(p, UPD, latest());
    await p.goto('http://localhost:8082/tf');
    await expectSource(p, 'local');
    await p.getByRole('status').filter({ hasText: `disponible : ${VERSION}` }).waitFor();
    await p.getByRole('button', { name: 'Mettre à jour' }).waitFor();
    await p.getByRole('link', { name: 'Plus tard' }).click();
    await p.waitForFunction(() => window.TASMOFLOW && window.TASMOFLOW.source === 'github', null, { timeout: 8000 });
  });
  await test('update: download, upload, checks, restart wait, then the new version loads', async p => {
    await reset(8386, '0.0.9', '&restart=2');
    await p.route(CDN, r => r.fulfill(jsBody(APP)));
    await manifest(p, UPD, latest());
    await tappRoute(p);
    await p.goto('http://localhost:8082/tf');
    await expectSource(p, 'local');
    p.once('dialog', d => d.accept());                                   // "the gateway will restart"
    await p.getByRole('button', { name: 'Mettre à jour' }).click();
    await p.getByText(/Redémarrage de la passerelle/).waitFor({ timeout: 10000 });
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'update-wait.png') });
    // the gateway answers again with the new version: the page reloads, and nothing is left to update
    await p.waitForFunction(v => window.TASMOFLOW && window.TASMOFLOW.source === 'github' && window.TASMOFLOW.version === v, VERSION, { timeout: 30000 });
  });
  await test('update: a restart that does not end stops waiting and points to the Tasmota home page', async p => {
    await reset(8386, '0.0.9', '&never=1');
    await p.addInitScript(() => { window.__TF_UPDATE_WAIT = 5000; });
    await manifest(p, UPD, latest());
    await tappRoute(p);
    await p.goto('http://localhost:8082/tf');
    await expectSource(p, 'local');
    p.once('dialog', d => d.accept());
    await p.getByRole('button', { name: 'Mettre à jour' }).click();
    await p.getByText(/prend plus de temps que prévu/).waitFor({ timeout: 25000 });
    const href = await p.getByRole('link', { name: 'Accueil de Tasmota' }).getAttribute('href');
    if (!/^http:\/\/localhost\/$/.test(href)) throw new Error('home link: ' + href);
    await reset(8386, '0.0.9');
  });
  await test('update: a file whose hash is wrong is refused and nothing changes', async p => {
    await reset(8386, '0.0.9');
    await manifest(p, UPD, latest({ sha256: '0'.repeat(64) }));
    await tappRoute(p);
    await p.goto('http://localhost:8082/tf');
    await expectSource(p, 'local');
    p.once('dialog', d => d.accept());
    await p.getByRole('button', { name: 'Mettre à jour' }).click();
    await p.getByRole('alert').filter({ hasText: /contrôle d'intégrité/ }).waitFor({ timeout: 10000 });
    const st = await (await fetch('http://localhost:8386/api/status?t=0123456789abcdef0123456789abcdef')).json();
    if (st.tasmoflow !== '0.0.9') throw new Error('version changed: ' + st.tasmoflow);
  });
  await test('update: not enough room is said before the download, with the sizes', async p => {
    await reset(8386, '0.0.9', '&free=' + 30 * 1024);                     // 30 KB free, no .bak
    await manifest(p, UPD, latest());
    let fetched = false;
    await p.route(TAPP_URL, r => { fetched = true; r.abort(); });
    await p.goto('http://localhost:8082/tf');
    await expectSource(p, 'local');
    p.once('dialog', d => d.accept());
    await p.getByRole('button', { name: 'Mettre à jour' }).click();
    const need = Math.ceil((TAPP.length + 20 * 1024) / 1024);
    await p.getByRole('alert').filter({ hasText: `Il faut ${need} Ko` }).filter({ hasText: '30 Ko sont disponibles' }).waitFor({ timeout: 10000 });
    if (fetched) throw new Error('the .tapp was downloaded although it cannot fit');
    await reset(8386, '0.0.9');
  });
  await test('update: the old .bak makes room when free space alone is short, and the update goes through', async p => {
    await reset(8386, '0.0.9', '&restart=1&free=' + 30 * 1024 + '&bak=83069');   // 30 KB free + an 81 KB .bak
    await p.route(CDN, r => r.fulfill(jsBody(APP)));
    await manifest(p, UPD, latest());
    await tappRoute(p);
    await p.goto('http://localhost:8082/tf');
    await expectSource(p, 'local');
    p.once('dialog', d => d.accept());
    await p.getByRole('button', { name: 'Mettre à jour' }).click();
    await p.waitForFunction(v => window.TASMOFLOW && window.TASMOFLOW.source === 'github' && window.TASMOFLOW.version === v, VERSION, { timeout: 30000 });
    const r = await (await fetch('http://localhost:8386/api/update_check?t=0123456789abcdef0123456789abcdef&size=1000')).json();
    if (r.bak !== 83069 || r.tapp !== TAPP.length) throw new Error('after the update: ' + JSON.stringify(r));
    await reset(8386, '0.0.9');
  });
  await test('update, test channel: another commit is offered, the same one is not', async p => {
    await p.route(CDN, r => r.fulfill(jsBody(APP)));
    await manifest(p, DEVUPD, latest({ version: '0.1.0-dev.bbbbbbb', tapp: 'TasmoFlow.tapp' }));
    await p.goto('http://localhost:8083/tf');
    await expectSource(p, 'local');
    await p.getByRole('status').filter({ hasText: 'disponible : 0.1.0-dev.bbbbbbb' }).waitFor();
    const q = await p.context().newPage();
    await q.route(CDN, r => r.fulfill(jsBody(APP)));
    await manifest(q, DEVUPD, latest({ version: '0.1.0-dev.aaaaaaa', tapp: 'TasmoFlow.tapp' }));
    await q.goto('http://localhost:8083/tf');
    await q.waitForFunction(() => window.TASMOFLOW && window.TASMOFLOW.source === 'github', null, { timeout: 8000 });
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
    // light3: the colour picker sets the colour mode, then the colour (hhhhssssvvvv)
    const garland = p.locator('article.card', { has: p.getByRole('heading', { name: 'Guirlande', exact: true }) });
    await garland.getByLabel('Couleur').fill('#ff0000');
    await p.waitForFunction(async t => {
      const r = await (await fetch('http://localhost:8384/api/cmd?t=' + t + '&c=TuyaStatus%20Guirlande')).json();
      const d = r.TuyaStatus.Guirlande.Dps;
      return d['24'] === '000003e803e8' && d['21'] === 'colour';
    }, '0123456789abcdef0123456789abcdef', { timeout: 4000 });
    // a name with a comma: controlled by its id; without a known id: readings only, no control
    const tv = p.locator('article.card', { has: p.getByRole('heading', { name: 'Salon, TV', exact: true }) });
    await tv.getByRole('button', { name: 'TV · éteint' }).click();
    await tv.getByRole('button', { name: 'TV · allumé' }).waitFor({ timeout: 4000 });
    const kitchen = p.locator('article.card', { has: p.getByRole('heading', { name: 'Cuisine, bas', exact: true }) });
    await kitchen.waitFor();
    if (await kitchen.getByRole('button').count()) throw new Error('a device that cannot be addressed offers a control');
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'tuya.png'), fullPage: true });
  });
  await test('drivers starting (full): notes, functions off, looks again by itself, then on', async p => {
    await p.route(CDN, r => r.fulfill(jsBody(APP)));
    await p.goto('http://localhost:8084/tf');
    await p.waitForFunction(() => window.TASMOFLOW && window.TASMOFLOW.source === 'github', null, { timeout: 8000 });
    const note = n => p.getByRole('status').filter({ hasText: new RegExp(n + ' démarre') });
    await note('Zigbee').waitFor({ timeout: 4000 });
    if (!(await p.getByRole('button', { name: /^Appairer/ }).isDisabled())) throw new Error('pairing offered while Zigbee starts');
    await p.getByText('la page se met à jour toute seule').first().waitFor();
    // Zigbee comes up (3 s), the next look (every 5 s) enables it without a click; Tuya still waits (7 s)
    await p.getByRole('button', { name: /^Appairer/ }).waitFor({ state: 'visible' });
    await p.locator('article.card', { has: p.getByRole('heading', { name: 'Lampe salon' }) }).waitFor({ timeout: 9000 });
    if (await p.getByRole('button', { name: /^Appairer/ }).isDisabled()) throw new Error('pairing still off');
    await note('Zigbee').waitFor({ state: 'detached', timeout: 2000 });
    await note('Tuya').waitFor({ timeout: 2000 });
    await p.locator('article.card', { has: p.getByRole('heading', { name: 'Ventilateur', exact: true }) }).waitFor({ timeout: 12000 });
    await note('Tuya').waitFor({ state: 'detached', timeout: 2000 });
  });
  await test('Tuya disabled (full): note, no card, nothing polled', async p => {
    await p.route(CDN, r => r.fulfill(jsBody(APP)));
    await p.goto('http://localhost:8085/tf');
    await p.waitForFunction(() => window.TASMOFLOW && window.TASMOFLOW.source === 'github', null, { timeout: 8000 });
    await p.getByRole('status').filter({ hasText: 'Tuya est désactivé' }).waitFor({ timeout: 4000 });
    await wait(1500);
    let polled = 0;
    p.on('request', r => { if (/TuyaEnable|api\/status/.test(decodeURIComponent(r.url()) + (r.postData() || ''))) polled++; });
    await wait(6500);
    if (polled) throw new Error('driver state read again while nothing starts');
    if (await p.getByRole('heading', { name: 'Ventilateur' }).count()) throw new Error('Tuya device shown');
    if (await p.getByRole('button', { name: /^Appairer/ }).isDisabled()) throw new Error('Zigbee is up, pairing must be on');
  });
  await test('drivers off (light): everything off, invitation to reload, no automatic look', async p => {
    await p.route(CDN, r => r.abort());
    await p.goto('http://localhost:8086/tf');
    await p.waitForFunction(() => window.TASMOFLOW && window.TASMOFLOW.source === 'local', null, { timeout: 8000 });
    await p.getByRole('status').filter({ hasText: "Zigbee n'est pas prêt" }).waitFor({ timeout: 4000 });
    await p.getByRole('status').filter({ hasText: "Tuya n'est pas prêt" }).waitFor();
    if (!(await p.getByRole('button', { name: /^Appairer/ }).isDisabled())) throw new Error('pairing offered');
    let polled = 0;
    p.on('request', r => { if (/api\/(status|cmd)/.test(r.url())) polled++; });
    await wait(6500);
    if (polled) throw new Error(polled + ' requests: the light interface must not look again');
    await p.getByRole('button', { name: 'Recharger' }).first().click();
    await p.getByRole('status').filter({ hasText: "Zigbee n'est pas prêt" }).waitFor({ timeout: 4000 });
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
