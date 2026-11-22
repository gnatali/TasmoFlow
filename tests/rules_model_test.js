// SPDX-License-Identifier: GPL-3.0-only
// Unit tests of the rule model (app/src/rules_model.js, rules_lint.js). Run: node tests/rules_model_test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const esbuild = require('esbuild');

const SRC = path.join(__dirname, '..', 'app', 'src');
// the modules are plain ES modules: bundle them to CommonJS for Node
const out = esbuild.buildSync({
  stdin: { contents: "export * from './rules_model.js'; export * from './rules_lint.js'; export * from './rules_devices.js'; export * from './rules_conflicts.js'; export * from './rules_guided_model.js'; export * from './tuya_model.js'; export * from './tuya_colour.js'; export * from './rename_model.js'; export * from './sheet_model.js';", resolveDir: SRC },
  loader: { '.css': 'text' }, define: { __BUILD__: '""' },
  bundle: true, format: 'cjs', write: false, logLevel: 'silent'
}).outputFiles[0].text;
// i18n.js (used by tuya_model.js) reads the browser's storage when it loads
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.document = { documentElement: {} };
// tuya_colour.js reaches tuya.js and state.js, which read the page's config when they load
globalThis.window = { addEventListener() {} };      // rules.js (reached through tuya.js, rename.js) listens for beforeunload
const m = { exports: {} };
new Function('module', 'exports', out)(m, m.exports);
const { renameRefs, nameError, controlsFor, sendName, lightControls, arcValue, parseColour, formatColour, colourToRgb, findConflicts, commandInfo, zbKey, zbTriggers, zbActions, tuyaActions, describeSubject, describeCommand, usableKey, tuyaTriggers, describeTrigger, describeConnection, keyMismatch, seenAttrs, zbTriggerAttrs, triggersOf, flatRule, guidedDevices, seenValues, triggerOptions, learn, guidedBlock, parseRuleSet, serializeRuleSet, parseBlock, serializeBlock, edited, newBlock, parseCommands, writeCommands, lintRule, splitBlocks, sheetRows, showValue, identity, parentOf, zbIdentity, zbProduct, zbLink, zbRows, ruleRefs, matchProducts, confidence, catalogueText, tuyaDps, ZB_SET } = m.exports;

let n = 0;
const ok = (name, f) => { f(); n++; };

ok('plain block', () => {
  const b = parseBlock('on Button1#State=3 do Power2 toggle endon');
  assert.deepStrictEqual([b.kind, b.subject, b.op, b.value, b.cond, b.then, b.else], ['sentence', 'Button1#State', '=', '3', null, ['Power2 toggle'], null]);
});
ok('trigger without value', () => {
  const b = parseBlock('on System#Boot do Power1 1 endon');
  assert.deepStrictEqual([b.subject, b.op, b.value], ['System#Boot', '', '']);
});
ok('operators', () => {
  for (const op of ['=', '!=', '>', '<', '>=', '<=']) {
    const b = parseBlock(`on Tele-ENERGY#Power${op}100 do Power1 0 endon`);
    assert.strictEqual(b.kind, 'sentence'); assert.strictEqual(b.op, op); assert.strictEqual(b.value, '100');
  }
});
ok('backlog list', () => {
  const b = parseBlock('on System#Boot do Backlog Delay 50; Power1 1 endon');
  assert.deepStrictEqual(b.then, ['Delay 50', 'Power1 1']);
});
ok('if / else', () => {
  const b = parseBlock('on Button1#State=3 do if ((Var1>1) and (Var2<3)) Power1 1 else Power1 0 endif endon');
  assert.strictEqual(b.cond, '(Var1>1) and (Var2<3)');
  assert.deepStrictEqual(b.then, ['Power1 1']); assert.deepStrictEqual(b.else, ['Power1 0']);
});
ok('if without else, with backlog', () => {
  const b = parseBlock('on Rules#Timer=1 do if (Var1==1) Backlog Power1 1; Var1 0 endif endon');
  assert.strictEqual(b.else, null); assert.deepStrictEqual(b.then, ['Power1 1', 'Var1 0']);
});
ok('elseif: any number, with or without else', () => {
  const b = parseBlock('on Button1#State=3 do if (Var1==1) Power1 1 elseif (Var1==2) Backlog Power1 0; Power2 1 elseif ((Var1>3) and (Var2<1)) Power3 1 else Power1 2 endif endon');
  assert.strictEqual(b.kind, 'sentence');
  assert.deepStrictEqual(b.then, ['Power1 1']);
  assert.deepStrictEqual(b.elifs, [{ cond: 'Var1==2', then: ['Power1 0', 'Power2 1'] }, { cond: '(Var1>3) and (Var2<1)', then: ['Power3 1'] }]);
  assert.deepStrictEqual(b.else, ['Power1 2']);
  const c = parseBlock('on Button1#State=3 do if (Var1==1) Power1 1 elseif (Var1==2) Power1 0 endif endon');
  assert.deepStrictEqual([c.elifs.length, c.else], [1, null]);
  assert.deepStrictEqual(parseBlock('on x#y do if (Var1==1) Power1 1 endif endon').elifs, []);
});
ok('several triggers: neighbouring blocks with the same actions are one sentence, read and written back unchanged', () => {
  const text = 'on Button1#State=3 do Power2 toggle endon on Button2#State>1 do Power2 toggle endon on System#Boot do Power2 toggle endon on Time#Minute=5 do Power3 1 endon';
  const blocks = parseRuleSet(text);
  assert.strictEqual(blocks.length, 2);
  assert.deepStrictEqual(triggersOf(blocks[0]), [{ subject: 'Button1#State', op: '=', value: '3' }, { subject: 'Button2#State', op: '>', value: '1' }, { subject: 'System#Boot', op: '', value: '' }]);
  assert.strictEqual(serializeRuleSet(blocks), splitBlocks(text).join('\n'));              // never rewritten
  // not neighbours, or other actions: not merged
  assert.strictEqual(parseRuleSet('on a#b do Power1 1 endon on c#d do Power2 1 endon on e#f do Power1 1 endon').length, 3);
  assert.strictEqual(parseRuleSet('on a#b do if (Var1==1) Power1 1 endif endon on c#d do Power1 1 endon').length, 2);
  assert.strictEqual(parseRuleSet('on a#b do Power1 1 endon on c#d and e#f do Power1 1 endon').length, 2);   // "and" between triggers: raw
});
ok('several triggers: one block per trigger when written, an empty extra trigger is left out', () => {
  const b = { ...newBlock(), subject: 'Button1#State', op: '=', value: '3', then: ['Power2 toggle'], more: [{ subject: 'System#Boot', op: '', value: '' }, { subject: ' ', op: '', value: '' }] };
  assert.strictEqual(serializeBlock(b), 'on Button1#State=3 do Power2 toggle endon\non System#Boot do Power2 toggle endon');
  const c = { ...b, cond: 'Var1==1', elifs: [{ cond: 'Var1==2', then: ['Power2 off', 'Var1 0'] }], else: ['Power2 on'], more: [{ subject: 'Wifi#Connected', op: '', value: '' }] };
  const text = serializeBlock(c);
  assert.strictEqual(text, 'on Button1#State=3 do if (Var1==1) Power2 toggle elseif (Var2==2) Backlog Power2 off; Var1 0 else Power2 on endif endon\non Wifi#Connected do if (Var1==1) Power2 toggle elseif (Var1==2) Backlog Power2 off; Var1 0 else Power2 on endif endon'.replace('Var2==2', 'Var1==2'));
  assert.strictEqual(lintRule(flatRule(text)), null);
  const back = parseRuleSet(text);                                                               // read back as one sentence
  assert.strictEqual(back.length, 1);
  assert.deepStrictEqual([back[0].elifs, back[0].else, back[0].more.length], [c.elifs, ['Power2 on'], 1]);
});
ok('what stays raw', () => {
  for (const t of [
    'on Power1#State=1 and Power2#State=1 do Power3 1 endon',            // two triggers
    'on Button1#State=3 do if (Var1==1) Power1 1 elseif (Var1==2) if (Var2==1) Power1 0 endif endif endon',   // nested if, even in an elseif
    'on Button1#State=3 do if (Var1==1) Power1 1 elseif Power1 0 endif endon',                                // elseif without a condition
    'on Button1#State=3 do if (Var1==1) Power1 1 elseif (Var1==2) else Power1 0 endif endon',                 // an empty branch
    'on Button1#State=3 do if (Var1==1) Power1 1 else Power1 0 elseif (Var1==2) Power1 2 endif endon',        // elseif after else
    'on Button1#State=3 do if (Var1==1) if (Var2==1) Power1 1 endif endif endon',
    'on x#y= do Power1 1 endon',                                        // operator without value
    'on x#y do endon'                                                   // empty body
  ]) assert.strictEqual(parseBlock(t).kind, 'raw', t);
});
ok('"on" and "off" in a command are arguments', () => {
  const b = parseBlock('on Button1#State=3 do Power1 on endon');
  assert.deepStrictEqual(b.then, ['Power1 on']);
});

const SETS = [
  '',
  'on Button1#State=3 do Power2 toggle endon',
  'on Time#Minute=60 do Power1 0 endon on System#Boot do Backlog Delay 50; Power1 1 endon',
  'ON Button1#State=3 DO BACKLOG power1 1; power2 1 ENDON',
  'on a#b=1 and c#d=2 do Power1 1 endon on x#y>3 do if (Var1==1) Power1 1 else Power1 0 endif endon'
];
ok('opening a rule set never rewrites it', () => {
  for (const s of SETS) {
    const blocks = parseRuleSet(s);
    assert.strictEqual(serializeRuleSet(blocks), splitBlocks(s).join('\n'), s);
  }
});
ok('not a plain list of blocks', () => {
  assert.strictEqual(parseRuleSet('Power1 on'), null);
  assert.strictEqual(parseRuleSet('on x#y do Power1 1'), null);
});
ok('an edited block is written again, others stay', () => {
  const blocks = parseRuleSet('on Time#Minute=60 do Power1 0 endon on System#Boot do Backlog delay 50; power1 1 endon');
  blocks[0] = edited(blocks[0], { value: '30' });
  assert.strictEqual(serializeRuleSet(blocks), 'on Time#Minute=30 do Power1 0 endon\non System#Boot do Backlog delay 50; power1 1 endon');
});
ok('serialization of every shape, parsed back to the same sentence', () => {
  const shapes = [
    { subject: 'System#Boot', op: '', value: '', cond: null, then: ['Power1 1'], else: null },
    { subject: 'Button1#State', op: '=', value: '3', cond: null, then: ['Power1 1', 'Delay 10', 'Power1 0'], else: null },
    { subject: 'Rules#Timer', op: '=', value: '1', cond: 'Var1==1', then: ['Power1 1'], else: ['Power1 0'] },
    { subject: 'Time#Minute', op: '>=', value: '30', cond: '(Var1>1) and (Var2<3)', then: ['Power1 1', 'Var1 0'], else: null },
    { subject: 'Time#Minute', op: '=', value: '30', cond: 'Var1==1', then: ['Power1 1'], elifs: [{ cond: 'Var1==2', then: ['Power1 0'] }, { cond: 'Var1==3', then: ['Power2 1', 'Power3 1'] }], else: ['Power1 2'] }
  ];
  for (const s of shapes) {
    const text = serializeBlock({ kind: 'sentence', more: [], elifs: [], ...s, src: null });
    const b = parseBlock(text);
    assert.deepStrictEqual({ subject: b.subject, op: b.op, value: b.value, cond: b.cond, then: b.then, elifs: b.elifs, else: b.else }, { elifs: [], ...s }, text);
    assert.strictEqual(lintRule(text), null, text);
  }
});
ok('commands', () => {
  assert.deepStrictEqual(parseCommands('Backlog a 1; b 2;'), ['a 1', 'b 2']);
  assert.strictEqual(writeCommands(['a 1', ' ', 'b 2']), 'Backlog a 1; b 2');
  assert.strictEqual(writeCommands(['a 1']), 'a 1');
});
ok('lint: empty trigger and the rest', () => {
  assert.strictEqual(lintRule('on  do Power1 1 endon'.replace('  ', ' ')), 'lintTrigger');
  assert.strictEqual(lintRule(serializeBlock(newBlock())), 'lintTrigger');
  assert.strictEqual(lintRule('Power1 on'), 'lintOn');
  assert.strictEqual(lintRule('on a#b do Power1 1'), 'lintEndon');
});


// ---- device pickers
const devs = {
  '0x1A2B': { addr: '0x1A2B', name: 'Bouton', attrs: { Click: 'single', Endpoint: 1, LinkQuality: 90, BatteryPercentage: 80 } },
  '0x3C4D': { addr: '0x3C4D', name: '0x3C4D', attrs: { Power: 0, Dimmer: 100, Device: '0x3C4D' } },
  '0x5E6F': { addr: '0x5E6F', name: 'Capteur bureau', attrs: { Temperature: 21 } }
};
const lab = { On: 'allumer', Off: 'éteindre', Toggle: 'basculer' };
ok('Zigbee key: name only with SetOption83 and a name', () => {
  assert.strictEqual(zbKey(devs['0x1A2B'], true), 'Bouton');
  assert.strictEqual(zbKey(devs['0x1A2B'], false), '0x1A2B');
  assert.strictEqual(zbKey(devs['0x3C4D'], true), '0x3C4D');
});
ok('Zigbee triggers: attributes, addresses, names with a space kept', () => {
  let r = zbTriggers(devs, false);
  assert.strictEqual(r.skipped, 0);
  const all = r.groups.flatMap(g => g.items.map(i => i.value));
  assert.deepStrictEqual(all.sort(), ['ZbReceived#0x1A2B#BatteryPercentage', 'ZbReceived#0x1A2B#Click', 'ZbReceived#0x3C4D#Dimmer',
    'ZbReceived#0x3C4D#Power', 'ZbReceived#0x5E6F#Temperature']);
  r = zbTriggers(devs, true);
  assert.strictEqual(r.skipped, 0);                                    // Tasmota takes a trigger up to " DO ": spaces are fine
  const named = r.groups.flatMap(g => g.items.map(i => i.value));
  assert.ok(named.includes('ZbReceived#Bouton#Click') && named.includes('ZbReceived#Capteur bureau#Temperature'));
  assert.ok(usableKey('Capteur bureau') && usableKey('Bouton') && usableKey('Lumière entrée'));
  for (const k of ['Prise#2', 'A=B', 'a<b', 'x|y', 'say "hi"', "l'entrée", ' Lampe', 'Lampe ', 'Lampe  salon', 'Lampe do salon', 'Haut or bas', 'Fin endon'])
    assert.ok(!usableKey(k), k);
});
ok('Zigbee triggers of a button: Power though ZbInfo keeps only its battery, and what was seen', () => {
  // an SNZB-01P as Tasmota's ZbInfo gives it (Guillaume's gateway, 21 November 2026)
  const btn = { '0x922D': { addr: '0x922D', name: 'Interrupteur Entrée', attrs: { Device: '0x922D', Name: 'Interrupteur Entrée', IEEEAddr: '0xF044D3FFFE9BE8C4',
    ModelId: 'SNZB-01P', Manufacturer: 'eWeLink', Endpoints: [1], Config: [], Reachable: false, BatteryPercentage: 100,
    BatteryLastSeenEpoch: 1795278874, LastSeen: 727, LastSeenEpoch: 1795297826, LinkQuality: 102 } } };
  assert.deepStrictEqual(zbTriggerAttrs(btn['0x922D']), ['Power', 'BatteryPercentage']);
  const r = zbTriggers(btn, true, { connected: 'connecté' });
  assert.deepStrictEqual(r.groups[0].items.map(i => i.value), ['ZbReceived#Interrupteur Entrée#Power', 'ZbReceived#Interrupteur Entrée#BatteryPercentage', 'ZbState#ShortAddr']);
  // seen in the event stream and in the rule sets (by address or by name, any case)
  const seen = seenAttrs(btn, [{ type: 'zigbee', device: '0x922D', attrs: { Device: '0x922D', Action: 'single', LinkQuality: 90 } }, { type: 'tuya', device: 'x' }],
    { rules: [{ text: 'on ZbReceived#0x922d#Power=1 do Power1 on endon on ZbReceived#interrupteur entrée#Hold do Power2 on endon on ZbReceived#0x1111#Power do x endon' }] });
  assert.deepStrictEqual([...seen['0x922d']].sort(), ['Action', 'Hold', 'Power']);
  assert.deepStrictEqual(zbTriggerAttrs(btn['0x922D'], seen), ['BatteryPercentage', 'Action', 'Power', 'Hold']);
  assert.deepStrictEqual(guidedDevices(btn, false, seen).list[0].attrs, zbTriggerAttrs(btn['0x922D'], seen));   // the guided mode offers the same
  // a sensor keeps its readings, without Power; nothing reported: Power
  assert.deepStrictEqual(zbTriggerAttrs({ addr: '0x1', attrs: { Temperature: 20, BatteryPercentage: 50 } }), ['Temperature', 'BatteryPercentage']);
  assert.deepStrictEqual(zbTriggerAttrs({ addr: '0x2', attrs: {} }), ['Power']);
});
ok('Zigbee trigger with a space in the name: read as a sentence, written back the same', () => {
  const t = 'on ZbReceived#Capteur bureau#Temperature>25 do Power1 on endon';
  const b = parseBlock(t);
  assert.deepStrictEqual([b.kind, b.subject, b.op, b.value], ['sentence', 'ZbReceived#Capteur bureau#Temperature', '>', '25']);
  assert.strictEqual(serializeBlock(b), t);
  assert.strictEqual(parseBlock('on ZbReceived#Capteur bureau#Temperature do Power1 on endon').subject, 'ZbReceived#Capteur bureau#Temperature');
  assert.strictEqual(describeSubject('ZbReceived#Capteur bureau#Temperature', devs, true), 'Capteur bureau · Temperature');
});
ok('Zigbee trigger key that SetOption83 makes wrong: found, with its fix', () => {
  // SetOption83 on: Tasmota writes the name, a trigger by address never fires
  assert.deepStrictEqual(keyMismatch('ZbReceived#0x1A2B#Click', devs, true), { want: 'name', device: 'Bouton', fixed: 'ZbReceived#Bouton#Click' });
  assert.deepStrictEqual(keyMismatch('ZbReceived#0x5E6F#Temperature', devs, true).fixed, 'ZbReceived#Capteur bureau#Temperature');
  // off: the address is written, a trigger by name never fires
  assert.deepStrictEqual(keyMismatch('ZbReceived#bouton#Click', devs, false), { want: 'addr', device: 'Bouton', fixed: 'ZbReceived#0x1A2B#Click' });
  // right ones, an unnamed device, other triggers
  assert.strictEqual(keyMismatch('ZbReceived#Bouton#Click', devs, true), null);
  assert.strictEqual(keyMismatch('ZbReceived#0x1A2B#Click', devs, false), null);
  assert.strictEqual(keyMismatch('ZbReceived#0x3C4D#Power', devs, true), null);
  assert.strictEqual(keyMismatch('ZbReceived#0x9999#Power', devs, true), null);
  assert.strictEqual(keyMismatch('Power1#State', devs, true), null);
  // a name no trigger can carry: no key would fire, nothing to offer
  assert.strictEqual(keyMismatch('ZbReceived#0x7777#Power', { '0x7777': { addr: '0x7777', name: 'A#B', attrs: {} } }, true), null);
});
ok('Zigbee triggers: device information is not an event', () => {
  const r = zbTriggers({ '0x1': { addr: '0x1', name: '0x1', attrs: { IEEEAddr: 'x', ModelId: 'y', Manufacturer: 'z', Endpoints: [1], Reachable: true, Power: 1 } } }, false);
  assert.deepStrictEqual(r.groups[0].items.map(i => i.label), ['Power']);
});
ok('Zigbee actions: only devices with Power, by address', () => {
  const g = zbActions(devs, lab);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].items[2].value, 'ZbSend {"device":"0x3C4D","send":{"Power":"Toggle"}}');
});
ok('Tuya actions: switches, sliders, no comma in a name', () => {
  const tuya = { state: 'running', nodes: { Fan: { dps: { 20: false } }, 'A,B': { dps: { 20: true } } },
    conf: { Fan: { matter: [{ ep: 'Light', type: 'light1', dp: 20, dp_bri: 22 }] } } };
  const g = tuyaActions(tuya, lab);
  assert.strictEqual(g.length, 1);
  const v = g[0].items.map(i => i.value);
  assert.ok(v.includes('TuyaSend Fan,20,toggle') && v.includes('TuyaSend Fan,22,'));
  assert.deepStrictEqual(tuyaActions({ state: 'disabled' }, lab), []);
});
ok('Tuya actions: a name with a comma goes by its id, none without one', () => {
  const tuya = { state: 'running', nodes: { 'Salon, TV': { dps: { 20: false } }, 'Cuisine, bas': { dps: { 20: false } }, 'Sub,1': { dps: {} } },
    conf: { 'Salon, TV': { id: 'abc123', matter: [{ ep: 'TV', type: 'light0', dp: 20 }] }, 'Cuisine, bas': { matter: [{ ep: 'x', type: 'light0' }] } } };
  const g = tuyaActions(tuya, lab);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].group, 'Tuya · Salon, TV');
  assert.ok(g[0].items.map(i => i.value).includes('TuyaSend abc123,20,toggle'));
  assert.strictEqual(sendName('Fan', null), 'Fan');
  assert.strictEqual(sendName('A,B', null), null);
  assert.strictEqual(sendName('A,B', { id: 'x1' }), 'x1');
  assert.strictEqual(describeCommand('TuyaSend abc123,20,true', devs, lab, tuya), 'allumer Salon, TV (DP 20)');
  assert.strictEqual(describeCommand('TuyaSend abc123,20,true', devs, lab), 'allumer abc123 (DP 20)');
});
ok('Tuya light2/light3: one panel per binding replaces the shared sliders; colour_data_v2 helpers', () => {
  const entry = { matter: [{ ep: 'Guirlande', type: 'light3', dp: 20, dp_mode: 21, dp_bri: 22, dp_colour: 24, bri_min: 10, bri_max: 1000 }] };
  const base = controlsFor({ dps: {} }, entry);
  assert.ok(base.some(x => x.kind === 'range' && x.dp === '22'));                  // the shared (light) dimmer
  const cs = lightControls(base, entry);
  assert.ok(!cs.some(x => x.kind === 'range'));
  const p = cs.find(x => x.kind === 'light');
  assert.deepStrictEqual([p.dp, p.modeDp, p.briDp, p.bmin, p.bmax, p.ctDp], ['24', '21', '22', 10, 1000, null]);
  assert.strictEqual(typeof p.render, 'function');
  assert.strictEqual(p.swDp, '20');
  assert.strictEqual(lightControls([], { matter: [{ type: 'light3', dp: 31 }] }).find(x => x.kind === 'light').swDp, '31');
  assert.strictEqual(lightControls(controlsFor({ dps: {} }, { matter: [{ type: 'light3' }] }), { matter: [{ type: 'light3' }] }).find(x => x.kind === 'light').dp, '24');
  assert.strictEqual(lightControls(controlsFor({ dps: {} }, { matter: [{ type: 'light3', dp_ct: 23 }] }), { matter: [{ type: 'light3', dp_ct: 23 }] }).find(x => x.kind === 'light').ctDp, '23');
  const l2 = { matter: [{ type: 'light2', dp_ct: 23 }] };
  const base2 = controlsFor({ dps: {} }, l2);
  assert.strictEqual(base2.filter(x => x.kind === 'range').length, 2);                // shared dimmer + colour temperature
  const cs2 = lightControls(base2, l2);
  assert.ok(!cs2.some(x => x.kind === 'range'));
  const p2 = cs2.find(x => x.kind === 'light');
  assert.deepStrictEqual([p2.colour, p2.briDp, p2.ctDp, p2.modeDp], [false, '22', '23', '21']);
  assert.strictEqual(lightControls(controlsFor({ dps: {} }, { matter: [{ type: 'light2' }] }), { matter: [{ type: 'light2' }] }).find(x => x.kind === 'light').ctDp, '23');
  assert.strictEqual(p.colour, true);
  assert.deepStrictEqual(lightControls([], null), []);
  // colour temperature arc: bottom left 0 %, top 50 %, bottom right 100 %, the gap at the bottom snaps to the near end
  assert.strictEqual(arcValue(-70.7, 70.7), 0);
  assert.strictEqual(arcValue(0, -100), 50);
  assert.strictEqual(arcValue(70.7, 70.7), 100);
  assert.strictEqual(arcValue(-10, 100), 0);
  assert.strictEqual(arcValue(10, 100), 100);
  assert.strictEqual(arcValue(-100, 0), 17);
  assert.strictEqual(arcValue(100, 0), 83);
  assert.deepStrictEqual(parseColour('00f003e803e8'), { h: 240, s: 1000, v: 1000 });
  assert.deepStrictEqual(parseColour('0000000003e8'), { h: 0, s: 0, v: 1000 });
  assert.strictEqual(parseColour('nope'), null);
  assert.strictEqual(parseColour(60), null);
  assert.strictEqual(formatColour(0, 1000, 1000), '000003e803e8');
  assert.strictEqual(formatColour(240, 500, 10), '00f0' + '01f4' + '000a');
  assert.strictEqual(formatColour(400, -5, 2000), '0168' + '0000' + '03e8');       // clamped
  for (const str of ['000003e803e8', '007803e803e8', '0168000003e8', '00b401f4012c']) {
    const c = parseColour(str);
    assert.strictEqual(formatColour(c.h, c.s, c.v), str);
  }
  assert.strictEqual(colourToRgb({ h: 0, s: 1000, v: 1000 }), '#ff0000');
  assert.strictEqual(colourToRgb({ h: 120, s: 1000, v: 1000 }), '#00ff00');
  assert.strictEqual(colourToRgb({ h: 240, s: 1000, v: 1000 }), '#0000ff');
  assert.strictEqual(colourToRgb({ h: 0, s: 0, v: 1000 }), '#ffffff');
  assert.strictEqual(colourToRgb({ h: 90, s: 1000, v: 0 }), '#000000');
});
ok('plain-language names', () => {
  assert.strictEqual(describeSubject('ZbReceived#0x1A2B#Click', devs, false), 'Bouton · Click');
  assert.strictEqual(describeSubject('ZbReceived#Bouton#Click', devs, true), 'Bouton · Click');
  assert.strictEqual(describeSubject('System#Boot', devs, false), null);
  assert.strictEqual(describeCommand('ZbSend {"device":"0x3C4D","send":{"Power":"Toggle"}}', devs, lab), 'basculer 0x3C4D');
  assert.strictEqual(describeCommand('TuyaSend Fan,20,true', devs, lab), 'allumer Fan (DP 20)');
  assert.strictEqual(describeCommand('Power1 on', devs, lab), null);
});

// ---- conflicts
ok('command info: what a command switches', () => {
  assert.deepStrictEqual(commandInfo('Power2 TOGGLE'), { target: 'Power2', verb: 'toggle' });
  assert.deepStrictEqual(commandInfo('Power 1'), { target: 'Power1', verb: 'on' });
  assert.deepStrictEqual(commandInfo('ZbSend {"device":"0x3C4D","send":{"Power":"Off"}}'), { target: 'zb:0x3c4d', verb: 'off' });
  assert.deepStrictEqual(commandInfo('TuyaSend Fan,20,true'), { target: 'tuya:fan#20', verb: 'on' });
  assert.strictEqual(commandInfo('Delay 10'), null);
  assert.strictEqual(commandInfo('TuyaSend Fan,62,3'), null);
});
ok('conflicts: toggles cancel, orders contradict, duplicates, disabled sets and other triggers ignored', () => {
  const sets = [
    { n: 1, on: true, text: 'on Button1#State=3 do Power2 toggle endon on Time#Minute=5 do Power1 on endon' },
    { n: 2, on: true, text: 'on Button1#State=3 do Backlog Delay 5; Power2 toggle endon on Time#Minute=5 do Power1 off endon on Button1#State=2 do Power2 toggle endon' },
    { n: 3, on: false, text: 'on Button1#State=3 do Power2 toggle endon' }
  ];
  const c = findConflicts(sets);
  assert.strictEqual(c.length, 2);
  const cancel = c.find(x => x.kind === 'cancel');
  assert.deepStrictEqual([cancel.target, cancel.where.map(w => w.n + ':' + w.i)], ['Power2', ['1:0', '2:0']]);
  assert.strictEqual(c.find(x => x.kind === 'contradict').target, 'Power1');
  assert.strictEqual(findConflicts([{ n: 1, on: true, text: 'on a#b do Power1 on endon on a#b do Power1 on endon' }])[0].kind, 'duplicate');
  assert.strictEqual(findConflicts([{ n: 1, on: true, text: 'on a#b do if (Var1==1) Power1 on else Power1 off endif endon' }]).length, 0);   // one block, two branches
});

const GZ = {
  '0x1A2B': { addr: '0x1A2B', name: 'Bouton salon', attrs: { Click: 'single', BatteryPercentage: 87, LinkQuality: 120 } },
  '0x3C4D': { addr: '0x3C4D', name: 'Lampe salon', attrs: { Power: 0, Dimmer: 180 } },
  '0x5E6F': { addr: '0x5E6F', name: 'Capteur bureau', attrs: { Temperature: 21.4 } },
  '0x7788': { addr: '0x7788', name: 'Prise cuisine bas', attrs: { Power: 1 } },          // a name with a space
  '0x9999': { addr: '0x9999', name: '', attrs: {} }                                       // nothing reported yet
};
ok('guided: devices that can start a rule, name or address as SetOption83 says', () => {
  const byAddr = guidedDevices(GZ, false);
  assert.deepStrictEqual(byAddr.list.map(d => d.key), ['0x9999', '0x1A2B', '0x5E6F', '0x3C4D', '0x7788']);   // by the name shown: the unnamed first
  assert.strictEqual(byAddr.skipped, 0);
  const byName = guidedDevices(GZ, true);
  assert.strictEqual(byName.skipped, 0);                                                  // names with a space are fine
  assert.deepStrictEqual(byName.list.map(d => d.key), ['0x9999', 'Bouton salon', 'Capteur bureau', 'Lampe salon', 'Prise cuisine bas']);
  assert.deepStrictEqual(byAddr.list.find(d => d.addr === '0x9999').attrs, ['Power']);    // like the pickers: Power by default
  assert.deepStrictEqual(byAddr.list.find(d => d.addr === '0x1A2B').attrs, ['Click', 'BatteryPercentage']);
});
ok('guided: values seen, options of an attribute', () => {
  const ev = [{ type: 'zigbee', device: '0x1A2B', attrs: { Click: 'double' } }, { type: 'zigbee', device: '0x1A2B', attrs: { Click: 'long' } },
    { type: 'zigbee', device: '0x1A2B', attrs: { Click: 'double' } }, { type: 'zigbee', device: '0x3C4D', attrs: { Click: 'other' } },
    { type: 'tuya', name: 'x', dps: {} }, { type: 'zigbee', device: '0x1A2B', attrs: { Click: 'two words' } }];
  assert.deepStrictEqual(seenValues(ev, GZ['0x1A2B'], 'Click'), ['double', 'long', 'single']);   // events, then the last state; no repeat, one word only
  assert.deepStrictEqual(triggerOptions('Click', ['single']).map(o => [o.kind, o.op, o.value]), [['any', '', ''], ['value', '=', 'single']]);
  assert.deepStrictEqual(triggerOptions('Power', []).map(o => [o.kind, o.op, o.value]), [['on', '=', '1'], ['off', '=', '0'], ['any', '', '']]);
});
ok('guided: learning from the messages received', () => {
  const ev = [   // newest first, like the interface keeps them
    { seq: 9, type: 'zigbee', device: '0x1A2B', name: 'Bouton salon', attrs: { Device: '0x1A2B', Click: 'single', Endpoint: 1, LinkQuality: 120 } },
    { seq: 8, type: 'zigbee', device: '0x5E6F', name: 'Capteur bureau', attrs: { Device: '0x5E6F', Temperature: 21.4, Endpoint: 1 } },
    { seq: 7, type: 'tuya', name: 'Pince', dps: { 131: 1 } },
    { seq: 5, type: 'zigbee', device: '0x3C4D', name: 'Lampe salon', attrs: { Power: 1 } }];
  assert.strictEqual(learn(ev, 9, ''), null);                                             // nothing after seq 9
  assert.deepStrictEqual(learn(ev, 5, ''), { seq: 9, addr: '0x1A2B', name: 'Bouton salon', attr: 'Click', op: '=', value: 'single' });   // the temperature is a reading sent by itself: skipped
  assert.strictEqual(learn(ev, 5, '0x5E6F').attr, 'Temperature');                         // but wanted when that device is the one chosen
  assert.strictEqual(learn(ev, 5, '0x3C4D'), null);                                       // nothing new from the lamp
  assert.strictEqual(learn(ev, 0, '').seq, 5);                                            // the first one heard, not the last
  assert.deepStrictEqual(learn([{ seq: 1, type: 'zigbee', device: '0x1', attrs: { Zone: 'x', ZoneStatus: 1, Led: { a: 1 } } }], 0, ''), { seq: 1, addr: '0x1', name: undefined, attr: 'Led', op: '', value: '' });   // an object has no value to compare
});
ok('guided: the block written, with the name or the address', () => {
  const b = guidedBlock({ addr: '0x1A2B', attr: 'Click', op: '=', value: 'single' }, ['ZbSend {"device":"0x3C4D","send":{"Power":"Toggle"}}', ' '], GZ, false);
  assert.strictEqual(serializeBlock(b), 'on ZbReceived#0x1A2B#Click=single do ZbSend {"device":"0x3C4D","send":{"Power":"Toggle"}} endon');
  assert.strictEqual(serializeBlock(guidedBlock({ addr: '0x9999', attr: 'Power', op: '', value: '' }, ['Power1 on'], { '0x9999': { addr: '0x9999', name: 'Prise' } }, true)),
    'on ZbReceived#Prise#Power do Power1 on endon');
  assert.strictEqual(serializeBlock(guidedBlock({ addr: '0x7788', attr: 'Power', op: '', value: '' }, ['Power1 on'], GZ, true)),
    'on ZbReceived#Prise cuisine bas#Power do Power1 on endon');                          // a name with a space
  assert.strictEqual(guidedBlock({ addr: '0x1', attr: 'Power', op: '', value: '' }, ['Power1 on'], { '0x1': { addr: '0x1', name: 'A=B' } }, true), null);   // no trigger can carry it
  assert.strictEqual(parseBlock(serializeBlock(b)).kind, 'sentence');                    // the editor reads it back
});

const LAB = { connected: 'connecté', disconnected: 'déconnecté' };
ok('device connected: Zigbee ZbState announce by short address, Tuya by name, plain language, nothing for others', () => {
  const dev = { '0x1A2B': { addr: '0x1A2B', name: 'Lampe salon', attrs: { Power: 1 } } };
  const z = zbTriggers(dev, false, LAB).groups[0].items;
  assert.deepStrictEqual(z.map(i => [i.label, i.value, i.op, i.val]), [['Power', 'ZbReceived#0x1A2B#Power', undefined, undefined], ['connecté', 'ZbState#ShortAddr', '=', '0x1A2B']]);
  assert.strictEqual(zbTriggers(dev, false).groups[0].items.length, 1);                       // without labels: as before
  const tuya = { state: 'running', nodes: { 'Ventilateur': {}, 'Salon, TV': {}, 'a=b': {}, 'x do y': {}, ' sp': {} } };
  const tt = tuyaTriggers(tuya, LAB);
  assert.deepStrictEqual(tt.map(g => g.group), ['Tuya · Salon, TV', 'Tuya · Ventilateur']);      // a name that would split or compare the trigger is left out
  assert.deepStrictEqual(tt[1].items.map(i => [i.value, i.op, i.val]), [['TuyaConnected#Name', '=', 'Ventilateur'], ['TuyaDisconnected#Name', '=', 'Ventilateur']]);
  assert.deepStrictEqual(tuyaTriggers({ state: 'disabled', nodes: {} }, LAB), []);
  const tr = (subject, op, value) => ({ subject, op, value });
  assert.strictEqual(describeConnection(tr('ZbState#ShortAddr', '=', '0x1a2b'), dev, LAB), 'Lampe salon · connecté');
  assert.strictEqual(describeConnection(tr('ZbState#ShortAddr', '=', '0x9999'), dev, LAB), null);   // unknown device: as written
  assert.strictEqual(describeConnection(tr('TuyaDisconnected#Name', '=', 'Salon, TV'), dev, LAB), 'Salon, TV · déconnecté');
  assert.strictEqual(describeConnection(tr('TuyaConnected#Name', '', ''), dev, LAB), null);
  assert.strictEqual(describeTrigger(tr('ZbReceived#0x1A2B#Power', '=', '1'), dev, false, LAB), 'Lampe salon · Power = 1');
  assert.strictEqual(describeTrigger(tr('ZbState#ShortAddr', '=', '0x9999'), dev, false, LAB), 'ZbState#ShortAddr = 0x9999');
  // written and read back as any other trigger
  const text = serializeBlock({ ...newBlock(), subject: 'ZbState#ShortAddr', op: '=', value: '0x1A2B', then: ['Power1 on'], more: [tr('TuyaConnected#Name', '=', 'Salon, TV')] });
  assert.strictEqual(text, 'on ZbState#ShortAddr=0x1A2B do Power1 on endon\non TuyaConnected#Name=Salon, TV do Power1 on endon');
  assert.strictEqual(lintRule(flatRule(text)), null);
  assert.deepStrictEqual(triggersOf(parseRuleSet(text)[0]).map(x => x.value), ['0x1A2B', 'Salon, TV']);
});
ok('conflicts: a sentence with several triggers fires on each, branches count', () => {
  const sets = [
    { n: 1, on: true, text: 'on Button1#State=3 do Power2 toggle endon on Button2#State=1 do Power2 toggle endon' },       // one sentence, two triggers
    { n: 2, on: true, text: 'on Button2#State=1 do if (Var1==1) Power1 on elseif (Var1==2) Power2 toggle endif endon' }     // toggles Power2 on Button2 too, in an elseif
  ];
  const c = findConflicts(sets);
  assert.strictEqual(c.length, 1);
  assert.deepStrictEqual([c[0].kind, c[0].target, c[0].subject, c[0].where.map(w => w.n + ':' + w.i)], ['cancel', 'Power2', 'Button2#State', ['1:0', '2:0']]);
  assert.strictEqual(findConflicts([{ n: 1, on: true, text: 'on a#b do Power1 on endon on c#d do Power1 on endon' }]).length, 0);   // two triggers of one sentence do not clash with each other
});

ok('rename: Zigbee triggers (SetOption83 on) and ZbSend, whole names only', () => {
  const text = 'on ZbReceived#Lampe#Power=1 do ZbSend {"device":"Lampe","send":{"Power":0}} endon on ZbReceived#Lampe2#Power do Power1 on endon on ZbReceived#lampe do Power2 on endon';
  const r = renameRefs(text, 'zigbee', { trigFrom: 'Lampe', trigTo: 'Plafonnier', from: 'Lampe', to: 'Plafonnier' });
  assert.strictEqual(r.n, 3);
  assert.strictEqual(r.text, 'on ZbReceived#Plafonnier#Power=1 do ZbSend {"device":"Plafonnier","send":{"Power":0}} endon on ZbReceived#Lampe2#Power do Power1 on endon on ZbReceived#Plafonnier do Power2 on endon');
  // SetOption83 off: triggers carry the address, only ZbSend by name changes; a name removed: the address
  const off = renameRefs(text, 'zigbee', { trigFrom: '0x1A2B', trigTo: '0x1A2B', from: 'Lampe', to: '0x1A2B' });
  assert.strictEqual(off.n, 1);
  assert.ok(off.text.includes('"device":"0x1A2B"') && off.text.includes('ZbReceived#Lampe#Power=1'));
  // a device named for the first time with SetOption83 on: its address triggers take the name
  assert.strictEqual(renameRefs('on ZbReceived#0x1A2B#Power=1 do Power1 on endon', 'zigbee', { trigFrom: '0x1A2B', trigTo: 'Lampe', from: '', to: 'Lampe' }).text, 'on ZbReceived#Lampe#Power=1 do Power1 on endon');
  // no trigger can carry the new name: triggers left alone
  assert.strictEqual(renameRefs('on ZbReceived#Lampe#Power do Power1 on endon', 'zigbee', { trigFrom: 'Lampe', trigTo: null, from: 'Lampe', to: 'Lampe#2' }).n, 0);
  // names with a space: "Lampe" is not the start of "Lampe salon", and a space can be renamed
  const sp = renameRefs('on ZbReceived#Lampe salon#Power=1 do Power1 on endon on ZbReceived#Lampe#Power = 1 do Power2 on endon on ZbReceived#Lampe do Power3 on endon', 'zigbee', { trigFrom: 'Lampe', trigTo: 'Plafond haut' });
  assert.strictEqual(sp.n, 2);
  assert.strictEqual(sp.text, 'on ZbReceived#Lampe salon#Power=1 do Power1 on endon on ZbReceived#Plafond haut#Power = 1 do Power2 on endon on ZbReceived#Plafond haut do Power3 on endon');
  assert.strictEqual(renameRefs('on ZbReceived#Lampe salon#Power=1 do Power1 on endon', 'zigbee', { trigFrom: 'Lampe salon', trigTo: 'Salon' }).text, 'on ZbReceived#Salon#Power=1 do Power1 on endon');
});
ok('rename: Tuya TuyaSend and connection triggers, regex characters escaped', () => {
  const text = 'on TuyaConnected#Name=Pince (garage) do TuyaSend Pince (garage),1,true endon on TuyaDisconnected#Name=Pince (garage) do Backlog TuyaSend Pince (garage), 1,false; TuyaSend Pince (garage) 2,1,true endon';
  const r = renameRefs(text, 'tuya', { from: 'Pince (garage)', to: 'Pince' });
  assert.strictEqual(r.n, 4);
  assert.strictEqual(r.text, 'on TuyaConnected#Name=Pince do TuyaSend Pince,1,true endon on TuyaDisconnected#Name=Pince do Backlog TuyaSend Pince, 1,false; TuyaSend Pince (garage) 2,1,true endon');
  assert.strictEqual(renameRefs('on Power1#State do TuyaSend Pincette,1,true endon', 'tuya', { from: 'Pince', to: 'X' }).n, 0);
});
ok('rename: names refused', () => {
  const s = { devices: { '0x1A2B': { addr: '0x1A2B', name: 'Lampe' }, '0x3C4D': { addr: '0x3C4D', name: 'Bouton' } }, tuya: { nodes: { Pince: {}, Ventilateur: {} } } };
  assert.strictEqual(nameError('zigbee', 'bouton', 'Lampe', '0x1A2B', s), 'rn_used');
  assert.strictEqual(nameError('zigbee', 'a,b', 'Lampe', '0x1A2B', s), 'rn_chars');
  assert.strictEqual(nameError('zigbee', '0x9999', 'Lampe', '0x1A2B', s), 'rn_addr');
  assert.strictEqual(nameError('zigbee', 'x'.repeat(33), 'Lampe', '0x1A2B', s), 'rn_long');
  assert.strictEqual(nameError('zigbee', '', 'Lampe', '0x1A2B', s), null);          // removes the name
  assert.strictEqual(nameError('zigbee', 'LAMPE', 'Lampe', '0x1A2B', s), null);     // a case change
  assert.strictEqual(nameError('tuya', '', 'Pince', null, s), 'rn_empty');
  assert.strictEqual(nameError('tuya', 'ventilateur', 'Pince', null, s), 'rn_used');
  assert.strictEqual(nameError('tuya', 'Pince garage', 'Pince', null, s), null);
});

ok('Tuya sheet: DPs from the codes, the bindings, the sensors and the state, with their source', () => {
  // the shape of a real entry (Pergola 1, 22 November 2026), id left out
  const entry = { name: 'Pergola 1', ip: '192.168.1.27', version: '3.4', key: '***', keep: [21, 22, 24],
    matter: [{ ep: 'Pergola 1', type: 'light3', enabled: false, dp: 20, dp_bri: 22, dp_mode: 21, dp_colour: 24, bri_min: 10, bri_max: 1000 }],
    codes: { switch_led: 20, work_mode: 21, bright_value_v2: 22, colour_data_v2: 24, countdown_1: 26, do_not_disturb: 34 },
    sensors: { Puissance: [19, 10, 'W'] } };
  const node = { connected: true, ip: '192.168.1.27', version: '3.4', dps: { 20: false, 22: 1000, 34: false, 26: 30, 19: 1234 }, seen: { 26: 5000 } };
  const rows = sheetRows(entry, node);
  assert.deepStrictEqual(rows.map(r => r.dp), [19, 20, 21, 22, 24, 26, 34]);
  const r = dp => rows.find(x => x.dp === dp);
  assert.deepStrictEqual([r(22).code, r(22).src, r(22).uses], ['bright_value_v2', 'gateway', [{ kind: 'matter', ep: 'Pergola 1', role: 'bri', type: 'light3', enabled: false }]]);
  assert.deepStrictEqual([r(26).src, r(26).at, r(26).uses], ['event', 5000, []]);
  assert.deepStrictEqual([r(21).has, r(21).src, r(21).uses[0].role], [false, '', 'mode']);
  assert.strictEqual(r(20).uses[0].role, '');                                                     // the binding's main DP
  const lab = { on: 'allumé', off: 'éteint' };
  assert.strictEqual(showValue(r(19), lab), '123.4 W');                                           // a sensor, divided
  assert.strictEqual(showValue(r(34), lab), 'éteint');
  assert.strictEqual(showValue(r(22), lab), '1000');
  assert.strictEqual(showValue(r(21), lab), '');
  assert.deepStrictEqual(sheetRows(null, null), []);
  assert.deepStrictEqual(sheetRows({ codes: { x: 'a' }, matter: [{ dp: null }] }, { dps: { foo: 1 } }), []);   // nothing that is not a DP number
});
ok('Tuya sheet: identity, never the key; a sub-device and its gateway', () => {
  const conf = { Passerelle: { name: 'Passerelle', id: 'gw1', key: '***', ip: '10.0.0.2', version: '3.3', children: [{ name: 'Capteur', cid: 'c1' }] } };
  conf.Capteur = conf.Passerelle.children[0];
  const id = identity('Passerelle', conf.Passerelle, { ip: '10.0.0.2', version: '3.3' }, conf);
  assert.deepStrictEqual(id, [['name', 'Passerelle'], ['id', 'gw1'], ['ip', '10.0.0.2'], ['version', '3.3'], ['children', 'Capteur']]);
  assert.ok(!JSON.stringify(id).includes('***'));
  assert.deepStrictEqual(identity('Capteur', conf.Capteur, null, conf), [['name', 'Capteur'], ['cid', 'c1'], ['parent', 'Passerelle']]);
  assert.strictEqual(parentOf('Autre', conf), '');
  assert.deepStrictEqual(identity('L', { keep: 'all' }, null, {}), [['name', 'L'], ['keep', 'all']]);
});

ok('Tuya sheet: DPs that the rule sets send to, by number or code', () => {
  const entry = { id: 'abc', codes: { switch_led: 20, bright_value_v2: 22 } };
  const rules = { rules: [{ n: 1, on: true, text: 'on Power1#State=1 do TuyaSend Pergola 1,switch_led,true endon' },
    { n: 2, on: false, text: 'on Time#Minute=60 do Backlog TuyaSend abc,22,500; TuyaSend Autre,20,true endon on TuyaConnected#Name=Pergola 1 do Power1 on endon' }],
    berry: [{ rule: 'TuyaConnected#Name=pergola 1', id: 'x' }, { rule: 'Mqtt#Connected', id: 'nil' }] };
  const rows = sheetRows(entry, { dps: {} }, rules, 'Pergola 1');
  assert.deepStrictEqual(rows.find(r => r.dp === 20).uses, [{ kind: 'rule', n: 1, how: 'cmd' }]);
  assert.deepStrictEqual(rows.find(r => r.dp === 22).uses, [{ kind: 'rule', n: 2, how: 'cmd' }]);   // by its id
  assert.deepStrictEqual(ruleRefs('tuya', rules, ['Pergola 1', 'abc']), { sets: [{ n: 1, on: true, refs: 1 }, { n: 2, on: false, refs: 2 }], berry: ['TuyaConnected#Name=pergola 1'] });
  assert.deepStrictEqual(ruleRefs('tuya', null, ['x']), { sets: [], berry: [] });
});
ok('Zigbee sheet: identity, link and attributes from ZbStatus3, the events and the rules', () => {
  // ZbStatus3 of the SNZB-01P button (Guillaume's gateway), IEEE address made up
  const st = { Device: '0x922D', Name: 'Interrupteur Entrée', IEEEAddr: '0x00124B0000000001', ModelId: 'SNZB-01P', Manufacturer: 'eWeLink',
    Endpoints: [1], Config: [], Reachable: false, BatteryPercentage: 100, BatteryLastSeenEpoch: 1795278874, LastSeen: 727, LastSeenEpoch: 1795297826, LinkQuality: 102 };
  const d = { addr: '0x922D', name: 'Interrupteur Entrée', model: 'SNZB-01P', manufacturer: 'eWeLink', lqi: 102, battery: 100, lastseen: 700, router: false,
    attrs: { BatteryPercentage: 100, Power: 2 }, seen: { Power: 9000 }, seenAt: 9000 };
  assert.deepStrictEqual(zbIdentity(d, st), [['name', 'Interrupteur Entrée'], ['addr', '0x922D'], ['ieee', '0x00124B0000000001'], ['endpoints', '1'], ['kind', 'endDevice']]);
  assert.deepStrictEqual(zbProduct(d, st), [['model', 'SNZB-01P'], ['manuf', 'eWeLink']]);            // the same section as a Tuya product
  assert.deepStrictEqual(zbProduct({ addr: '0x3' }, null), []);
  assert.deepStrictEqual(zbIdentity({ addr: '0x1', router: true }, { Endpoints: { 1: {}, 2: {} }, Matter: false }), [['addr', '0x1'], ['endpoints', '1, 2'], ['kind', 'router'], ['matter', 'off']]);
  assert.deepStrictEqual(zbLink(d, st, 19000), { lqi: 102, seen: 10, reachable: false, battery: 100, batterySeen: 1795278874 });
  assert.strictEqual(zbLink({ addr: '0x2', lastseen: 5 }, null, 0).seen, 5);
  const rules = { rules: [{ n: 1, on: true, text: 'on ZbReceived#0x922D#Power=1 do TuyaSend Récepteur radio,2,toggle endon' },
    { n: 3, on: true, text: 'on ZbReceived#interrupteur entrée#Hold do ZbSend {"device":"Interrupteur Entrée","send":{"Power":"Off"}} endon on ZbState#ShortAddr=0x922D do Power1 on endon' }], berry: [] };
  const rows = zbRows(d, st, rules, true);
  assert.deepStrictEqual(rows.map(r => r.key), ['Hold', 'Power']);            // identity and link kept apart; Hold only from a rule
  const pw = rows.find(r => r.key === 'Power');
  assert.deepStrictEqual([pw.value, pw.src, pw.at, pw.uses], [2, 'event', 9000, [{ kind: 'rule', n: 1, how: 'trigger' }, { kind: 'rule', n: 3, how: 'cmd' }]]);
  assert.deepStrictEqual([rows[0].has, rows[0].uses], [false, [{ kind: 'rule', n: 3, how: 'trigger' }]]);
  assert.deepStrictEqual(ruleRefs('zigbee', rules, ['0x922D', 'Interrupteur Entrée']).sets, [{ n: 1, on: true, refs: 1 }, { n: 3, on: true, refs: 3 }]);
  // a sensor: its readings from ZbStatus3, source gateway
  const t = zbRows({ addr: '0x5', attrs: {} }, { Device: '0x5', Temperature: 21.4, LinkQuality: 9 }, null, false);
  assert.deepStrictEqual(t.map(r => [r.key, r.value, r.src]), [['Temperature', 21.4, 'gateway']]);
});

ok('Tuya catalogue: matched on the DPs, the product id narrowing (real cases of 22 November 2026)', () => {
  // the entries the gateway's devices met in tuya-local (DP numbers as in the files; ids made up)
  const index = { files: [
    ['moes_quad_switch', 'Quad switch', [1, 2, 3, 4, 9, 10, 11, 12, 38, 42, 43, 44, 47, 48], ['quadid']],
    ['relay_switch_remote', 'Relay switch', [1, 9, 38, 42, 43, 44, 47, 49, 50], ['keyGEN']],
    ['aubess_1gang_switch', 'Energy monitor switch', [1, 9, 20, 21, 22, 23, 24, 29, 38, 42, 43, 44, 47], ['keyGEN']],
    ['calex_s45cleare27_light', 'CCT lightbulb', [20, 21, 22, 23, 25, 26, 28, 30, 31, 32, 33, 34], ['keyBULB']],
    ['rgbcw_lightbulb', 'RGBCW lightbulb', [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 41], ['keyBULB']],
    ['pc321ty_energy_meter', 'Power clamp meter', [1, 101, 102], ['keyCLAMP']]] };
  // the 4-channel radio relay: its generic product id names a 1-gang plug and a 1-channel relay, its DPs a quad switch
  const relay = [1, 2, 3, 4, 9, 10, 11, 12, 24, 38, 42, 43, 44, 47, 48, 49, 50];
  const r = matchProducts(index, relay, 'keyGEN');
  assert.strictEqual(r[0].stem, 'moes_quad_switch');
  assert.ok(r[0].score > r[1].score && r[1].key && !r[0].key);
  assert.strictEqual(confidence(r[0]), 'ts_probable');
  // the CCT bulb: its product id names two entries, the DPs choose
  const bulb = matchProducts(index, [20, 21, 22, 23, 25, 26, 28, 30, 31, 32, 33, 41], 'keyBULB');
  assert.deepStrictEqual(bulb.slice(0, 2).map(m => m.stem), ['calex_s45cleare27_light', 'rgbcw_lightbulb']);
  // no DP known (a device not imported): the product id alone
  assert.deepStrictEqual(matchProducts(index, [], 'keyCLAMP').map(m => [m.stem, m.common]), [['pc321ty_energy_meter', 0]]);
  assert.strictEqual(confidence(matchProducts(index, [], 'keyCLAMP')[0]), 'ts_possible');
  assert.strictEqual(confidence({ score: 0.3, common: 2, key: false }), 'ts_uncertain');
  assert.deepStrictEqual(matchProducts(index, [], null), []);
  assert.deepStrictEqual(matchProducts(null, [1], 'x'), []);
  assert.strictEqual(matchProducts(index, relay, null, 1).length, 1);
});
ok('Tuya catalogue: one line per DP', () => {
  assert.strictEqual(catalogueText({ type: 'integer', names: ['light · brightness'], min: 10, max: 1000 }), 'light · brightness · integer 10-1000');
  assert.strictEqual(catalogueText({ type: 'integer', names: ['power'], unit: 'W', scale: 10 }), 'power · integer W ÷10');
  assert.strictEqual(catalogueText({ type: 'string', names: ['mode'], values: ['white', 'colour', 'scene'] }), 'mode · string: white, colour, scene');
  assert.strictEqual(catalogueText({ type: 'string', values: [1, 2, 3, 4, 5, 6, 7, 8, 9] }), 'string: 1, 2, 3, 4, 5, 6, 7, 8…');
  assert.strictEqual(catalogueText(undefined), '');
});

ok('pickers: every writable Tuya DP, from the codes, the catalogue and the state', () => {
  // the 4-channel radio relay (DPs as on the gateway), its catalogue entry abridged
  const entry = { name: 'Récepteur radio', matter: [{ ep: 'Parking', type: 'relay', enabled: false, dp: 1 }],
    codes: { switch_1: 1, switch_2: 2, countdown_1: 9, relay_status: 38, switch_type: 47, test_bit: 24 } };
  const node = { connected: true, dps: { 1: false, 2: true, 24: 5 } };
  const product = { dps: { 1: { type: 'boolean', names: ['switch'] }, 2: { type: 'boolean', names: ['switch'] },
    9: { type: 'integer', names: ['countdown'], min: 0, max: 86399 }, 38: { type: 'string', names: ['power on state'], values: ['off', 'on', 'memory'] },
    47: { type: 'string', names: ['switch_type'], ro: true } } };
  const d = tuyaDps(node, entry, product, new Set(['1']));
  assert.deepStrictEqual(d.map(x => [x.dp, x.label, x.type]), [['2', 'switch_2 (switch)', 'boolean'], ['9', 'countdown_1 (countdown)', 'integer'],
    ['24', 'test_bit', 'integer'], ['38', 'relay_status (power on state)', 'string']]);          // 47 read-only, 1 already a control; 24 typed by its value
  const tuya = { state: 'running', nodes: { 'Récepteur radio': node }, conf: { 'Récepteur radio': entry } };
  const lab = { On: 'allumer', Off: 'éteindre', Toggle: 'basculer' };
  const items = tuyaActions(tuya, lab, { 'Récepteur radio': product })[0].items;
  const v = items.map(i => i.label + ' = ' + i.value);
  assert.ok(v.includes('Parking · basculer = TuyaSend Récepteur radio,1,toggle'));            // the Matter control first
  assert.ok(v.includes('switch_2 (switch) · allumer = TuyaSend Récepteur radio,2,true'));
  assert.ok(v.includes('countdown_1 (countdown) … (0-86399) = TuyaSend Récepteur radio,9,'));
  assert.ok(v.includes('relay_status (power on state) = memory = TuyaSend Récepteur radio,38,memory'));
  assert.ok(!v.some(x => x.includes(',47,')));
  // without the catalogue: the codes alone, typed by the values the gateway keeps
  const bare = tuyaActions(tuya, lab)[0].items.map(i => i.value);
  assert.ok(bare.includes('TuyaSend Récepteur radio,2,toggle') && bare.includes('TuyaSend Récepteur radio,24,') && !bare.some(x => x.includes(',38,')));
  // read back in plain language
  assert.strictEqual(describeCommand('TuyaSend Récepteur radio,38,memory', {}, lab, tuya), 'Récepteur radio · relay_status = memory');
  assert.strictEqual(describeCommand('TuyaSend Récepteur radio,77,5', {}, lab, tuya), 'Récepteur radio · DP 77 = 5');
});
ok('pickers: Zigbee Dimmer and CT, with a value', () => {
  const lamps = { '0x3C4D': { addr: '0x3C4D', name: 'Lampe salon', attrs: { Power: 1, Dimmer: 180, CT: 300 } } };
  const items = zbActions(lamps, { On: 'allumer', Off: 'éteindre', Toggle: 'basculer' })[0].items;
  assert.deepStrictEqual(items.slice(3), [
    { label: 'Dimmer … (0-254)', value: 'ZbSend {"device":"0x3C4D","send":{"Dimmer":127}}', tpl: 'ZbSend {"device":"0x3C4D","send":{"Dimmer":{v}}}' },
    { label: 'CT … (153-500)', value: 'ZbSend {"device":"0x3C4D","send":{"CT":300}}', tpl: 'ZbSend {"device":"0x3C4D","send":{"CT":{v}}}' }]);
  assert.strictEqual(describeCommand('ZbSend {"device":"0x3C4D","send":{"Dimmer":200}}', lamps, {}), 'Lampe salon · Dimmer = 200');
  assert.strictEqual(zbActions({ '0x1': { addr: '0x1', attrs: { Temperature: 20 } } }, {}).length, 0);
  assert.strictEqual(ZB_SET.length, 2);
});

console.log(`ok     rule model (${n} checks)`);
