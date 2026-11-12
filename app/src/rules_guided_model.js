// SPDX-License-Identifier: GPL-3.0-only
// Guided mode, the logic without the screen: which devices can start a rule, what a device can
// be seen doing, what a message just received teaches, and the block that comes out of the choices.
import { zbKey, usableKey, zbAttrs, triggerAttrs, shown, sorted } from './rules_devices.js';

// readings a device sends by itself: when the interface listens to every device, these are not
// "what the user just did"
export const PERIODIC = new Set(['BatteryPercentage', 'BatteryVoltage', 'Temperature', 'Humidity', 'Pressure', 'Illuminance',
  'Illuminance_Lux', 'Voltage', 'Current', 'ActivePower']);

// a value a rule trigger can compare with `=`: one word
const WORD = /^[\w.+-]+$/;
const scalar = v => (typeof v === 'string' || typeof v === 'number') && WORD.test(String(v)) ? String(v) : null;

// The Zigbee devices that can start a rule: [{ addr, label, key, attrs }], and how many were left
// out (a name with a space cannot be written in a trigger).
export function guidedDevices(devices, useNames) {
  const list = [];
  let skipped = 0;
  for (const d of sorted(devices)) {
    const key = zbKey(d, useNames);
    if (!usableKey(key)) { skipped++; continue; }
    const attrs = zbAttrs(d);
    list.push({ addr: d.addr, label: shown(d), key, attrs: attrs.length ? attrs : ['Power'] });
  }
  return { list, skipped };
}

// The values `attr` of a device was seen with, in the messages received and in its last state
// (at most 6): what to offer after "it reports ...".
export function seenValues(events, device, attr) {
  const out = [];
  const add = v => { v = scalar(v); if (v != null && !out.includes(v) && out.length < 6) out.push(v); };
  for (const ev of events || []) if (ev.type === 'zigbee' && ev.device === device.addr && ev.attrs) add(ev.attrs[attr]);
  if (device.attrs) add(device.attrs[attr]);
  return out;
}

// What a device can be told apart by, for an attribute: [{ kind, op, value }]. `Power` is 1 or 0
// in Tasmota's Zigbee messages; anything else offers "every time" and the values seen.
export function triggerOptions(attr, values) {
  if (attr === 'Power') {
    return [{ kind: 'on', op: '=', value: '1' }, { kind: 'off', op: '=', value: '0' }, { kind: 'any', op: '', value: '' }];
  }
  return [{ kind: 'any', op: '', value: '' }, ...values.map(v => ({ kind: 'value', op: '=', value: v }))];
}

// The first message received after `base` (the sequence number when listening began) that shows what
// the user just did: from `addr` if one is chosen, else from any device, readings sent by themselves
// left out. Returns { seq, addr, name, attr, op, value } or null. `events` is newest first.
export function learn(events, base, addr) {
  for (let i = (events || []).length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type !== 'zigbee' || ev.seq <= base || !ev.attrs || (addr && ev.device !== addr)) continue;
    const attr = triggerAttrs(ev.attrs).find(a => addr || !PERIODIC.has(a));
    if (!attr) continue;
    const v = scalar(ev.attrs[attr]);
    return { seq: ev.seq, addr: ev.device, name: ev.name, attr, op: v != null ? '=' : '', value: v != null ? v : '' };
  }
  return null;
}

// The rule block from the choices: `pick` = { addr, attr, op, value }, `then` = commands.
// null when the device cannot be written in a trigger.
export function guidedBlock(pick, then, devices, useNames) {
  const d = (devices && devices[pick.addr]) || { addr: pick.addr, name: '' };
  const key = zbKey(d, useNames);
  if (!usableKey(key)) return null;
  return { kind: 'sentence', subject: 'ZbReceived#' + key + '#' + pick.attr, op: pick.op, value: pick.value, cond: null,
    then: then.map(c => c.trim()).filter(Boolean), else: null, src: null };
}
