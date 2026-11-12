// SPDX-License-Identifier: GPL-3.0-only
// Device pickers of the sentence editor: triggers and commands built from the gateway's Zigbee
// and Tuya devices, and plain-language names for the ones that match.
//
// Zigbee, from Tasmota's source (tasmota/tasmota_xdrv_driver/xdrv_23_zigbee_2a_devices_impl.ino,
// Z_Device::jsonPublishAttrList): a message is published as {"ZbReceived":{"<key>":{...}}} and
// a rule trigger reads ZbReceived#<key>#<attribute>. The key is the friendly name only when
// SetOption83 is on (flag4.zigbee_use_names) and the device has one, else the short address
// "0x%04X". ZbSend takes the device as a name or an address: the address never changes.
//
// Device connected (Tasmota source, tasmota/tasmota_xdrv_driver/xdrv_23_zigbee_8_parsers.ino,
// Z_ReceiveEndDeviceAnnonce, firmware commit 43d9409): when a paired device is powered up again (or
// joins), Tasmota publishes {"ZbState":{"Status":30,"IEEEAddr":...,"ShortAddr":"0x1234",...}} and runs
// the rules on it: the trigger is ZbState#ShortAddr=0x1234 (a rule trigger tests one value; the
// other ZbState messages of that device, during pairing, match it too). `Reachable` only ever
// goes out as false (xdrv_23_zigbee_6_0_commands.ino, Z_Unreachable): no trigger for "back".
// Tuya: the firmware's driver publishes {"TuyaConnected":{"Name":...}} and {"TuyaDisconnected":...}
// (berry/tuya_local.be of the firmware repository; older builds do not).
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
export const shown = d => (named(d) ? d.name : d.addr);

const byName = (a, b) => shown(a).localeCompare(shown(b));
export const sorted = devices => Object.values(devices || {}).sort(byName);

// the attributes of a message (or of a device's last state) a rule can wait for
export const triggerAttrs = attrs => Object.keys(attrs || {}).filter(k => !NOT_ATTRS.has(k));
export const zbAttrs = d => triggerAttrs(d.attrs);

// [{ group, items: [{ label, value }] }]: one group per Zigbee device, one item per attribute
// it reported. `skipped`: how many devices had a name no trigger can carry.
// `labels` = { connected }: adds "device connected" to each device. An item with `op` and `val` sets
// the comparison too (the trigger is the subject, the operator and the value together).
export function zbTriggers(devices, useNames, labels) {
  const groups = [];
  let skipped = 0;
  for (const d of sorted(devices)) {
    const key = zbKey(d, useNames);
    if (!usableKey(key)) { skipped++; continue; }
    const attrs = zbAttrs(d);
    const items = (attrs.length ? attrs : ['Power']).map(a => ({ label: a, value: 'ZbReceived#' + key + '#' + a }));
    if (labels) items.push({ label: labels.connected, value: 'ZbState#ShortAddr', op: '=', val: d.addr });
    groups.push({ group: shown(d), items });
  }
  return { groups, skipped };
}

// a name that can stand as the value of a rule trigger: none of the characters that split or compare it
const usableValue = n => n.trim() === n && /^[^=<>!|$%]+$/.test(n) && !/\s(do|endon|break)\s/i.test(' ' + n + ' ');

// Tuya devices connecting and disconnecting (see above); `labels` = { connected, disconnected }
export function tuyaTriggers(tuya, labels) {
  const groups = [];
  if (!tuya || tuya.state !== 'running') return groups;
  for (const name of Object.keys(tuya.nodes).sort((a, b) => a.localeCompare(b))) {
    if (!usableValue(name)) continue;
    groups.push({ group: 'Tuya · ' + name, items: [
      { label: labels.connected, value: 'TuyaConnected#Name', op: '=', val: name },
      { label: labels.disconnected, value: 'TuyaDisconnected#Name', op: '=', val: name }] });
  }
  return groups;
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

// a device connecting or disconnecting, in plain language (`Lampe · connecté`), or null for any other
// trigger { subject, op, value }; `labels` = { connected, disconnected }
export function describeConnection(tr, devices, labels) {
  if (tr.op !== '=') return null;
  if (/^ZbState#ShortAddr$/i.test(tr.subject)) {
    const d = Object.values(devices || {}).find(x => x.addr.toLowerCase() === tr.value.trim().toLowerCase());
    return d ? shown(d) + ' · ' + labels.connected : null;
  }
  if (/^Tuya(Dis)?connected#Name$/i.test(tr.subject) && tr.value.trim()) {
    return tr.value.trim() + ' · ' + (/^TuyaDis/i.test(tr.subject) ? labels.disconnected : labels.connected);
  }
  return null;
}

// a trigger in plain language: the device and what it does (`Lampe · Power = 1`, `Lampe · connecté`), or as written
export function describeTrigger(tr, devices, useNames, labels) {
  return describeConnection(tr, devices, labels)
    || (describeSubject(tr.subject, devices, useNames) || tr.subject || '…') + (tr.op ? ' ' + tr.op + ' ' + tr.value : '');
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
