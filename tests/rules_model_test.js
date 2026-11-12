// SPDX-License-Identifier: GPL-3.0-only
// Unit tests of the rule model (app/src/rules_model.js, rules_lint.js). Run: node tests/rules_model_test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const esbuild = require('esbuild');

const SRC = path.join(__dirname, '..', 'app', 'src');
// the modules are plain ES modules: bundle them to CommonJS for Node
const out = esbuild.buildSync({
  stdin: { contents: "export * from './rules_model.js'; export * from './rules_lint.js'; export * from './rules_devices.js'; export * from './rules_conflicts.js'; export * from './tuya_model.js'; export * from './tuya_colour.js';", resolveDir: SRC },
  loader: { '.css': 'text' }, define: { __BUILD__: '""' },
  bundle: true, format: 'cjs', write: false, logLevel: 'silent'
}).outputFiles[0].text;
// i18n.js (used by tuya_model.js) reads the browser's storage when it loads
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.document = { documentElement: {} };
// tuya_colour.js reaches tuya.js and state.js, which read the page's config when they load
globalThis.window = {};
const m = { exports: {} };
new Function('module', 'exports', out)(m, m.exports);
const { controlsFor, sendName, lightControls, parseColour, formatColour, colourToRgb, findConflicts, commandInfo, zbKey, zbTriggers, zbActions, tuyaActions, describeSubject, describeCommand, usableKey, parseRuleSet, serializeRuleSet, parseBlock, serializeBlock, edited, newBlock, parseCommands, writeCommands, lintRule, splitBlocks } = m.exports;

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

console.log(`ok     rule model (${n} checks)`);
