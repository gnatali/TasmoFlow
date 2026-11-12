// SPDX-License-Identifier: GPL-3.0-only
// Unit tests of the rule model (app/src/rules_model.js, rules_lint.js). Run: node tests/rules_model_test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const esbuild = require('esbuild');

const SRC = path.join(__dirname, '..', 'app', 'src');
// the modules are plain ES modules: bundle them to CommonJS for Node
const out = esbuild.buildSync({
  stdin: { contents: "export * from './rules_model.js'; export * from './rules_lint.js'; export * from './rules_devices.js'; export * from './rules_conflicts.js'; export * from './rules_guided_model.js'; export * from './tuya_model.js'; export * from './tuya_colour.js';", resolveDir: SRC },
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
const { controlsFor, sendName, lightControls, arcValue, parseColour, formatColour, colourToRgb, findConflicts, commandInfo, zbKey, zbTriggers, zbActions, tuyaActions, describeSubject, describeCommand, usableKey, tuyaTriggers, describeTrigger, describeConnection, triggersOf, flatRule, guidedDevices, seenValues, triggerOptions, learn, guidedBlock, parseRuleSet, serializeRuleSet, parseBlock, serializeBlock, edited, newBlock, parseCommands, writeCommands, lintRule, splitBlocks } = m.exports;

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
ok('guided: devices that can start a rule, name or address as SetOption83 says, spaces left out', () => {
  const byAddr = guidedDevices(GZ, false);
  assert.deepStrictEqual(byAddr.list.map(d => d.key), ['0x9999', '0x1A2B', '0x5E6F', '0x3C4D', '0x7788']);   // by the name shown: the unnamed first
  assert.strictEqual(byAddr.skipped, 0);
  const byName = guidedDevices(GZ, true);
  assert.strictEqual(byName.skipped, 4);                                                  // every name here has a space but 0x9999's (none)
  assert.deepStrictEqual(byName.list.map(d => d.key), ['0x9999']);
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
  assert.strictEqual(guidedBlock({ addr: '0x7788', attr: 'Power', op: '', value: '' }, ['Power1 on'], GZ, true), null);   // "Prise cuisine bas": no name in a trigger
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

console.log(`ok     rule model (${n} checks)`);
