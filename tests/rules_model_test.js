// SPDX-License-Identifier: GPL-3.0-only
// Unit tests of the rule model (app/src/rules_model.js, rules_lint.js). Run: node tests/rules_model_test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const esbuild = require('esbuild');

const SRC = path.join(__dirname, '..', 'app', 'src');
// the modules are plain ES modules: bundle them to CommonJS for Node
const out = esbuild.buildSync({
  stdin: { contents: "export * from './rules_model.js'; export * from './rules_lint.js'; export * from './rules_devices.js';", resolveDir: SRC },
  loader: { '.css': 'text' }, define: { __BUILD__: '""' },
  bundle: true, format: 'cjs', write: false, logLevel: 'silent'
}).outputFiles[0].text;
// i18n.js (used by tuya_model.js) reads the browser's storage when it loads
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.document = { documentElement: {} };
const m = { exports: {} };
new Function('module', 'exports', out)(m, m.exports);
const { zbKey, zbTriggers, zbActions, tuyaActions, describeSubject, describeCommand, usableKey, parseRuleSet, serializeRuleSet, parseBlock, serializeBlock, edited, newBlock, parseCommands, writeCommands, lintRule, splitBlocks } = m.exports;

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
ok('what stays raw', () => {
  for (const t of [
    'on Power1#State=1 and Power2#State=1 do Power3 1 endon',            // two triggers
    'on Button1#State=3 do if (Var1==1) Power1 1 elseif (Var1==2) Power1 0 endif endon',
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
    { subject: 'Time#Minute', op: '>=', value: '30', cond: '(Var1>1) and (Var2<3)', then: ['Power1 1', 'Var1 0'], else: null }
  ];
  for (const s of shapes) {
    const text = serializeBlock({ kind: 'sentence', ...s, src: null });
    const b = parseBlock(text);
    assert.deepStrictEqual({ subject: b.subject, op: b.op, value: b.value, cond: b.cond, then: b.then, else: b.else }, s, text);
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
ok('Zigbee triggers: attributes, addresses, names with a space left out', () => {
  let r = zbTriggers(devs, false);
  assert.strictEqual(r.skipped, 0);
  const all = r.groups.flatMap(g => g.items.map(i => i.value));
  assert.deepStrictEqual(all.sort(), ['ZbReceived#0x1A2B#BatteryPercentage', 'ZbReceived#0x1A2B#Click', 'ZbReceived#0x3C4D#Dimmer',
    'ZbReceived#0x3C4D#Power', 'ZbReceived#0x5E6F#Temperature']);
  r = zbTriggers(devs, true);
  assert.strictEqual(r.skipped, 1);                                    // "Capteur bureau" has a space
  assert.ok(r.groups.flatMap(g => g.items.map(i => i.value)).includes('ZbReceived#Bouton#Click'));
  assert.ok(!usableKey('Capteur bureau') && usableKey('Bouton'));
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
ok('plain-language names', () => {
  assert.strictEqual(describeSubject('ZbReceived#0x1A2B#Click', devs, false), 'Bouton · Click');
  assert.strictEqual(describeSubject('ZbReceived#Bouton#Click', devs, true), 'Bouton · Click');
  assert.strictEqual(describeSubject('System#Boot', devs, false), null);
  assert.strictEqual(describeCommand('ZbSend {"device":"0x3C4D","send":{"Power":"Toggle"}}', devs, lab), 'basculer 0x3C4D');
  assert.strictEqual(describeCommand('TuyaSend Fan,20,true', devs, lab), 'allumer Fan (DP 20)');
  assert.strictEqual(describeCommand('Power1 on', devs, lab), null);
});

console.log(`ok     rule model (${n} checks)`);
