// SPDX-License-Identifier: GPL-3.0-only
// Device pickers of the sentence editor: triggers and commands built from the gateway's Zigbee
// and Tuya devices, and plain-language names for the ones that match.
//
// Zigbee, from Tasmota's source (tasmota/tasmota_xdrv_driver/xdrv_23_zigbee_2a_devices_impl.ino,
// Z_Device::jsonPublishAttrList): a message is published as {"ZbReceived":{"<key>":{...}}} and
// a rule trigger reads ZbReceived#<key>#<attribute>. The key is the friendly name only when
// SetOption83 is on (flag4.zigbee_use_names) and the device has one, else the short address
// "0x%04X". ZbSend takes the device as a name or an address: the address never changes.
import { controlsFor, sendName } from './tuya_model.js';

// attributes that are not something a rule waits for
const NOT_ATTRS = new Set(['Device', 'Endpoint', 'Endpoints', 'LinkQuality', 'Name', 'Quality', 'Zone', 'ZoneStatus',
  'IEEEAddr', 'ModelId', 'Manufacturer', 'Reachable', 'LastSeen', 'LastSeenEpoch', 'Status', 'Config', 'Time']);

export const isAddr = s => /^0x[0-9a-f]{4}$/i.test(s);
// a name a rule trigger can carry: no space, and none of the characters that end or split a trigger
export const usableKey = k => /^[^\s#=<>!|"']+$/.test(k);

const named = d => d.name && !isAddr(d.name) && d.name !== d.addr;
// the key Tasmota writes for this device
export const zbKey = (d, useNames) => (useNames && named(d) ? d.name : d.addr);
const shown = d => (named(d) ? d.name : d.addr);

const byName = (a, b) => shown(a).localeCompare(shown(b));
const sorted = devices => Object.values(devices || {}).sort(byName);

export const zbAttrs = d => Object.keys(d.attrs || {}).filter(k => !NOT_ATTRS.has(k));

// [{ group, items: [{ label, value }] }]: one group per Zigbee device, one item per attribute
// it reported. `skipped`: how many devices had a name no trigger can carry.
export function zbTriggers(devices, useNames) {
  const groups = [];
  let skipped = 0;
  for (const d of sorted(devices)) {
    const key = zbKey(d, useNames);
    if (!usableKey(key)) { skipped++; continue; }
    const attrs = zbAttrs(d);
    groups.push({ group: shown(d), items: (attrs.length ? attrs : ['Power']).map(a => ({ label: a, value: 'ZbReceived#' + key + '#' + a })) });
  }
  return { groups, skipped };
}

const zbSend = (addr, power) => 'ZbSend {"device":"' + addr + '","send":{"Power":"' + power + '"}}';

// switching a Zigbee device on, off, or over: `labels` = { On, Off, Toggle } in the user's language
export function zbActions(devices, labels) {
  const groups = [];
  for (const d of sorted(devices)) {
    if (!zbAttrs(d).includes('Power')) continue;
    groups.push({ group: shown(d), items: ['On', 'Off', 'Toggle'].map(p => ({ label: labels[p], value: zbSend(d.addr, p) })) });
  }
  return groups;
}

// Tuya devices, through TuyaSend: a switch gives on, off and toggle, a slider a command to
// complete with the value. A name with a comma goes by its id (sendName), or is left out.
export function tuyaActions(tuya, labels) {
  const groups = [];
  if (!tuya || tuya.state !== 'running') return groups;
  for (const name of Object.keys(tuya.nodes).sort((a, b) => a.localeCompare(b))) {
    const entry = tuya.conf && tuya.conf[name];
    const addr = sendName(name, entry);
    if (!addr) continue;
    const items = [];
    for (const c of controlsFor(tuya.nodes[name], entry)) {
      if (c.kind === 'switch') {
        for (const [v, k] of [['true', 'On'], ['false', 'Off'], ['toggle', 'Toggle']]) {
          items.push({ label: c.label + ' · ' + labels[k], value: 'TuyaSend ' + addr + ',' + c.dp + ',' + v });
        }
      } else if (c.kind === 'range') {
        items.push({ label: c.label + ' …', value: 'TuyaSend ' + addr + ',' + c.dp + ',' });
      }
    }
    if (items.length) groups.push({ group: 'Tuya · ' + name, items });
  }
  return groups;
}

// plain-language form of a trigger subject, or null
export function describeSubject(subject, devices, useNames) {
  const m = /^ZbReceived#([^#]+)#(.+)$/i.exec(subject);
  if (!m) return null;
  const d = Object.values(devices || {}).find(x => zbKey(x, useNames) === m[1] || x.addr.toLowerCase() === m[1].toLowerCase());
  return d ? shown(d) + ' · ' + m[2] : null;
}

// the name of the Tuya device a `TuyaSend` argument stands for (its id when the name has a comma)
function tuyaShown(arg, tuya) {
  const conf = (tuya && tuya.conf) || {};
  for (const name in conf) if (sendName(name, conf[name]) === arg && name !== arg) return name;
  return arg;
}

// plain-language form of a command, or null; `labels` = { On, Off, Toggle } as verbs
export function describeCommand(cmd, devices, labels, tuya) {
  let m = /^ZbSend\s*\{"device":"([^"]+)","send":\{"Power":"(On|Off|Toggle)"\}\}$/.exec(cmd);
  if (m) {
    const d = Object.values(devices || {}).find(x => x.addr.toLowerCase() === m[1].toLowerCase() || x.name === m[1]);
    return labels[m[2]] + ' ' + (d ? shown(d) : m[1]);
  }
  m = /^TuyaSend\s+([^,]+),(\d+),(true|false|toggle)$/i.exec(cmd);
  if (m) return labels[{ true: 'On', false: 'Off', toggle: 'Toggle' }[m[3].toLowerCase()]] + ' ' + tuyaShown(m[1], tuya) + ' (DP ' + m[2] + ')';
  return null;
}
