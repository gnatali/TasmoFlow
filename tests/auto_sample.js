// SPDX-License-Identifier: GPL-3.0-only
// Writes the Berry the interface generates for a set of sample automations (app/src/auto_gen.js),
// for tests/tf_auto_test.be, which runs it on standard Berry with a fake Tasmota.
// Usage: node tests/auto_sample.js > auto.be
const path = require('path');
const esbuild = require('esbuild');
const out = esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'app', 'src', 'auto_gen.js')], bundle: true, format: 'cjs', write: false }).outputFiles[0].text;
const m = { exports: {} };
new Function('module', 'exports', out)(m, m.exports);
const { generate } = m.exports;

// the same automations as tests/tf_auto_test.be expects (keep them in step)
module.exports.SAMPLE = [
  // a button lights the porch, then off 5 minutes after the last press
  { id: 'a1', name: 'Entrée "porche"', on: true,
    when: [{ src: 'zigbee', addr: '0x922D', name: 'Interrupteur Entrée', attr: 'Power', op: '=', value: '2' }],
    cond: null,
    then: [{ cmd: 'TuyaSend Récepteur radio,2,true' }, { wait: 300, restart: true }, { cmd: 'TuyaSend Récepteur radio,2,false' }] },
  // a Tuya DP of one device, only if a Zigbee lamp is off and the other DP above 500
  { id: 'a2', name: 'Pergola', on: true,
    when: [{ src: 'tuya', dev: 'Pergola 1', dp: '20', op: '=', value: 'true' }, { src: 'rule', pat: 'Power1#State=1' }],
    cond: { mode: 'all', items: [{ src: 'zigbee', addr: '0x3C4D', attr: 'Power', op: '=', value: '0' }, { src: 'tuya', dev: 'Pergola 1', dp: '22', op: '>', value: '500' }] },
    then: [{ cmd: 'ZbSend {"device":"0x3C4D","send":{"Power":"On"}}' }] },
  // disabled: not generated
  { id: 'a3', name: 'Off', on: false, when: [{ src: 'rule', pat: 'System#Boot' }], cond: null, then: [{ cmd: 'Power1 off' }] },
  // a Tuya device coming back, any condition of two
  { id: 'a4', name: 'Retour', on: true, when: [{ src: 'tuyaconn', dev: 'Pince', on: true }],
    cond: { mode: 'any', items: [{ src: 'tuya', dev: 'Pince', dp: '1', op: '=', value: 'on' }, { src: 'zigbee', addr: '0x3C4D', attr: 'Dimmer', op: '>=', value: '100' }] },
    then: [{ wait: 2, restart: false }, { cmd: 'Power2 toggle' }] }
];
if (require.main === module) process.stdout.write(generate(module.exports.SAMPLE));
