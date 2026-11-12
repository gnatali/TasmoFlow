// SPDX-License-Identifier: GPL-3.0-only
// Local Tuya devices, model: what each DP means, from the Matter bindings of tuya.json.
// TasmoFlow never shows, stores or sends a local key: TuyaConfig already masks it.
import { t } from './i18n.js';

// TuyaConfig loads the whole of tuya.json: the driver itself refuses below 30 KB free
export const MIN_HEAP_KB = 32;

// { name: entry } for the devices and the sub-devices of a Tuya gateway
export function indexConfig(conf) {
  const map = {};
  if (!conf || !Array.isArray(conf.devices)) return null;
  for (const d of conf.devices) {
    map[d.name] = d;
    for (const c of d.children || []) map[c.name] = c;
  }
  return map;
}

// What `TuyaSend` takes as device: it cuts its argument at the first two commas, so a name with
// a comma cannot be given. The driver also accepts a device id (`find_node`), which TuyaConfig
// gives for Wi-Fi devices and Tuya gateways (not for their sub-devices, only known by `cid`):
// used instead of the name then. null = cannot be addressed (no id, or TuyaConfig not read).
// The id is not a secret (the local key is, and never reaches the interface).
export function sendName(name, entry) {
  if (!name.includes(',')) return name;
  const id = entry && entry.id;
  return typeof id === 'string' && id && !id.includes(',') ? id : null;
}

const num = (v, d) => (v == null ? d : +v);
const dpOf = (b, key, d) => String(b[key] != null ? b[key] : d);

// Controls to show, from the Matter bindings of tuya.json (they say what each DP means).
// { kind: 'switch'|'range'|'read', label, dp, ... }
export function controlsFor(node, entry) {
  const out = [];
  for (const b of (entry && entry.matter) || []) {
    // `enabled: false` only takes the binding out of Matter (and `TuyaActive`): it still says what
    // each DP means, so the controls are shown all the same
    const label = b.ep || b.type;
    const type = b.type || '';
    if (type === 'relay' || type === 'relay_power' || /^light\d$/.test(type)) {
      out.push({ kind: 'switch', label, dp: dpOf(b, 'dp', type[0] === 'l' ? 20 : 1) });
    } else if (type === 'fan') {
      out.push({ kind: 'switch', label, dp: dpOf(b, 'dp', 60) });
      out.push({ kind: 'range', label: t('speed'), dp: dpOf(b, 'dp_speed', 62),
        min: num(b.speed_min, 1), max: num(b.speed_max, 6), percent: false });
    }
    if (/^light[123]$/.test(type)) {
      out.push({ kind: 'range', label: t('dimmer'), dp: dpOf(b, 'dp_bri', 22),
        min: num(b.bri_min, 10), max: num(b.bri_max, 1000), percent: true });
    }
    if (type === 'light2') {
      out.push({ kind: 'range', label: t('colortemp'), dp: dpOf(b, 'dp_ct', 23), min: 0, max: 1000, percent: true });
    }
    if (type === 'relay_power') {
      for (const [k, name, unit] of [['power', 'Power', 'W'], ['voltage', 'Voltage', 'V'], ['current', 'Current', 'A']]) {
        if (b['dp_' + k] != null) out.push({ kind: 'read', label: name, dp: String(b['dp_' + k]), div: num(b['div_' + k], 1), unit });
      }
    }
    if (type === 'temp' || type === 'humidity') {
      out.push({ kind: 'read', label: type === 'temp' ? 'Temperature' : 'Humidity', dp: dpOf(b, 'dp', 1),
        div: num(b.div, 10), unit: type === 'temp' ? '°C' : '%' });
    }
  }
  const sensors = (entry && entry.sensors) || {};
  for (const label in sensors) {
    const [dp, div, unit] = sensors[label];
    out.push({ kind: 'read', label, dp: String(dp), div: num(div, 1), unit: unit || '' });
  }
  if (!out.length) {   // no binding: the boolean DPs can still be toggled
    for (const dp in node.dps) if (typeof node.dps[dp] === 'boolean') out.push({ kind: 'switch', label: 'DP ' + dp, dp });
  }
  return out;
}
