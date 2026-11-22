// SPDX-License-Identifier: GPL-3.0-only
// Details sheets of the devices, model (no interface). Zigbee and Tuya devices get the same sheet
// (Guillaume, 22 November 2026: both families are treated the same way): identity, link, one row
// per value (a Zigbee attribute, a Tuya DP) with what uses it and where the value comes from, and
// the rule sets that name the device. The dialogs are in sheet.js.
//
// Zigbee sources: `ZbStatus3 <device>` (Tasmota, xdrv_23_zigbee_A_impl.ino CmndZbStatus, then
// Z_Device::jsonDumpSingleDevice mode 3 in xdrv_23_zigbee_2a_devices_impl.ino: Device, Name,
// IEEEAddr, ModelId, Manufacturer, Endpoints, Config, HueEmulation/Matter when off, the last known
// data attributes, Reachable, BatteryPercentage, BatteryLastSeenEpoch, LastSeen, LastSeenEpoch,
// LinkQuality), answered as the command's response, and the Zigbee events.
// Tuya sources (firmware berry/tuya_local.be; feasibility note docs/investigations/tuya-device-details-2026-11.md):
// `TuyaConfig <device>` (the tuya.json entry, key masked as "***" and never shown), `TuyaStatus`
// (the DPs the driver keeps) and the `Tuya` events (every DP that changes).

const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = keys => keys.filter(Boolean).map(esc).join('|');

// ---- Tuya

// a Matter binding's keys that name a DP: `dp`, then `dp_bri`, `dp_ct`, `dp_mode`, `dp_colour`,
// `dp_power`, `dp_voltage`, `dp_current`... (TuyaBinding.dps_used)
const DP_KEY = /^dp(_\w+)?$/;

// The DPs of a device, sorted by number: [{ key, dp, code, value, has, src, at, uses }]. `src`:
// 'event' (seen in an event at `at`, ms), 'gateway' (from TuyaStatus), '' (no value known). `uses`:
// [{ kind: 'matter', ep, role, type, enabled } | { kind: 'sensor', label, div, unit } | { kind: 'rule', n, how }].
export function sheetRows(entry, node, rules, name) {
  const rows = {};
  const row = dp => {
    const k = String(dp);
    if (!/^\d+$/.test(k)) return null;
    return rows[k] || (rows[k] = { key: k, dp: +k, code: '', value: undefined, has: false, src: '', at: 0, uses: [] });
  };
  const e = entry || {};
  for (const code in e.codes || {}) { const r = row(e.codes[code]); if (r) r.code = code; }
  for (const b of e.matter || []) {
    for (const k in b) {
      if (!DP_KEY.test(k) || b[k] == null) continue;
      const r = row(b[k]);
      if (r) r.uses.push({ kind: 'matter', ep: b.ep || b.type || '', role: k === 'dp' ? '' : k.slice(3), type: b.type || '', enabled: b.enabled !== false });
    }
  }
  const sensors = e.sensors || {};
  for (const label in sensors) {
    const s = sensors[label];
    const r = Array.isArray(s) ? row(s[0]) : null;
    if (r) r.uses.push({ kind: 'sensor', label, div: +s[1] || 1, unit: s[2] || '' });
  }
  for (const u of tuyaRuleUses(rules, name, e)) { const r = row(u.dp); if (r && !r.uses.some(x => x.kind === 'rule' && x.n === u.n)) r.uses.push({ kind: 'rule', n: u.n, how: 'cmd' }); }
  setValues(rows, row, node && node.dps, node && node.seen);
  return Object.values(rows).sort((a, b) => a.dp - b.dp);
}

// values and their source, for both families: `state` the values known, `seen` when each was last
// seen in an event (ms; state.js notes it)
function setValues(rows, row, state, seen) {
  for (const k in state || {}) {
    const r = row(k);
    if (!r) continue;
    r.value = state[k];
    r.has = true;
    r.src = seen && seen[k] ? 'event' : 'gateway';
    r.at = (seen && seen[k]) || 0;
  }
}

// `TuyaSend <name or id>,<dp or code>,...` in the rule sets: [{ n, dp }]
function tuyaRuleUses(rules, name, entry) {
  const out = [];
  const keys = alt([name, entry && entry.id]);
  if (!keys) return out;
  const re = new RegExp('TuyaSend\\s+(?:' + keys + ')\\s*,\\s*([\\w]+)\\s*,', 'gi');
  for (const r of (rules && rules.rules) || []) {
    for (const m of String(r.text || '').matchAll(re)) {
      const dp = /^\d+$/.test(m[1]) ? m[1] : (entry && entry.codes && entry.codes[m[1]]);
      if (dp != null) out.push({ n: r.n, dp: String(dp) });
    }
  }
  return out;
}

// The Tuya gateway a sub-device belongs to (its name), or '': `conf` is the interface's index
// { name: entry } (tuya_model.js, indexConfig), where a gateway's entry lists its `children`.
export function parentOf(name, conf) {
  for (const k in conf || {}) {
    if ((conf[k].children || []).some(c => c.name === name)) return k;
  }
  return '';
}

// The identity lines of a Tuya device, in order: [[key, value]], empty values left out. Never the key.
export function identity(name, entry, node, conf) {
  const e = entry || {};
  const n = node || {};
  const out = [
    ['name', name],
    ['id', e.id],
    ['cid', e.cid],
    ['parent', parentOf(name, conf)],
    ['ip', n.ip || e.ip],
    ['version', n.version || e.version],
    ['children', (e.children || []).map(c => c.name).join(', ')],
    ['keep', Array.isArray(e.keep) ? e.keep.join(', ') : e.keep]
  ];
  return out.filter(([, v]) => v != null && v !== '');
}

// ---- Zigbee

// what ZbStatus3 gives besides the data attributes: identity and link, shown apart
const ZB_ID = ['Device', 'Name', 'IEEEAddr', 'ModelId', 'Manufacturer', 'Endpoints', 'Config', 'HueEmulation', 'Matter', 'Endpoint'];
const ZB_LINK = ['Reachable', 'BatteryPercentage', 'BatteryLastSeenEpoch', 'LastSeen', 'LastSeenEpoch', 'LinkQuality'];
const NOT_ROW = new Set([...ZB_ID, ...ZB_LINK]);

// The identity lines of a Zigbee device: [[key, value]]. `st`: the ZbStatus3 object, or null
// (then what /api/devices gave). Endpoints: their numbers.
export function zbIdentity(d, st) {
  const s = st || {};
  const ep = s.Endpoints;
  const eps = Array.isArray(ep) ? ep.join(', ') : ep && typeof ep === 'object' ? Object.keys(ep).join(', ') : '';
  const out = [
    ['name', d.name && d.name !== d.addr ? d.name : s.Name],
    ['addr', d.addr],
    ['ieee', s.IEEEAddr],
    ['endpoints', eps],
    ['kind', d.router ? 'router' : 'endDevice'],
    ['matter', s.Matter === false ? 'off' : ''],
    ['hue', s.HueEmulation === false ? 'off' : '']
  ];
  return out.filter(([, v]) => v != null && v !== '');
}

// The product lines of a Zigbee device (the same section as a Tuya device's identification): [[key, value]]
export const zbProduct = (d, st) => [['model', (st && st.ModelId) || d.model], ['manuf', (st && st.Manufacturer) || d.manufacturer]]
  .filter(([, v]) => v != null && v !== '');

// The link lines: { lqi, seen (s), reachable, battery, batterySeen (epoch s) }, from ZbStatus3 when
// read, else from the device list; `now` in ms
export function zbLink(d, st, now) {
  const s = st || {};
  const since = d.seenAt ? Math.round((now - d.seenAt) / 1000) : s.LastSeen != null ? s.LastSeen : d.lastseen;
  return {
    lqi: d.lqi != null ? d.lqi : s.LinkQuality,
    seen: since,
    reachable: d.reachable === false ? false : s.Reachable != null ? s.Reachable : d.reachable,
    battery: s.BatteryPercentage != null ? s.BatteryPercentage : d.battery != null && d.battery >= 0 ? d.battery : null,
    batterySeen: s.BatteryLastSeenEpoch || null
  };
}

// One row per attribute, sorted by name: [{ key, value, has, src, at, uses }]: the last known state
// (ZbStatus3 or the device list), what the events brought, and the attributes the rule sets wait
// for or send. uses: [{ kind: 'rule', n, how: 'trigger'|'cmd' }].
export function zbRows(d, st, rules, useNames) {
  const rows = {};
  const row = k => (NOT_ROW.has(k) ? null : rows[k] || (rows[k] = { key: k, value: undefined, has: false, src: '', at: 0, uses: [] }));
  const state = {};
  for (const k in st || {}) if (!NOT_ROW.has(k)) state[k] = st[k];
  Object.assign(state, d.attrs || {});           // the device list's, then what the events brought
  for (const u of zbRuleUses(rules, d)) {
    const r = row(u.attr);
    if (r && !r.uses.some(x => x.n === u.n && x.how === u.how)) r.uses.push({ kind: 'rule', n: u.n, how: u.how });
  }
  setValues(rows, row, state, d.seen);
  return Object.values(rows).sort((a, b) => a.key.localeCompare(b.key));
}

// the attributes a rule set waits for (ZbReceived#<name or address>#<attr>) or sends (ZbSend
// {"device":"<name or address>","send":{"<attr>":...}}) for this device: [{ n, attr, how }]
function zbRuleUses(rules, d) {
  const out = [];
  const keys = alt([d.addr, d.name && d.name !== d.addr ? d.name : '']);
  const trig = new RegExp('ZbReceived#(?:' + keys + ')#(\\w+)', 'gi');
  const send = new RegExp('"device"\\s*:\\s*"(?:' + keys + ')"\\s*,\\s*"send"\\s*:\\s*\\{\\s*"(\\w+)"', 'gi');
  for (const r of (rules && rules.rules) || []) {
    const text = String(r.text || '');
    for (const m of text.matchAll(trig)) out.push({ n: r.n, attr: m[1], how: 'trigger' });
    for (const m of text.matchAll(send)) out.push({ n: r.n, attr: m[1], how: 'cmd' });
  }
  return out;
}

// ---- both

// The rule sets that name a device, and how: [{ n, on, refs }] (refs: how many). Zigbee: its
// triggers (name or address), its connected trigger (ZbState#ShortAddr=<address>), ZbSend; Tuya:
// TuyaSend (name or id), TuyaConnected / TuyaDisconnected. Berry rules naming it: `berry`.
export function ruleRefs(kind, rules, keys) {
  const k = alt(keys);
  if (!k || !rules) return { sets: [], berry: [] };
  const res = kind === 'zigbee'
    ? [new RegExp('ZbReceived#(?:' + k + ')(?=#|\\s*[=<>!|]|\\s+do\\b)', 'gi'), new RegExp('ZbState#ShortAddr\\s*=\\s*(?:' + k + ')\\b', 'gi'),
      new RegExp('"device"\\s*:\\s*"(?:' + k + ')"', 'gi')]
    : [new RegExp('TuyaSend\\s+(?:' + k + ')\\s*,', 'gi'), new RegExp('Tuya(?:Dis)?Connected#Name\\s*=\\s*(?:' + k + ')(?=\\s+do\\b)', 'gi')];
  const sets = [];
  for (const r of rules.rules || []) {
    const text = String(r.text || '');
    const refs = res.reduce((n, re) => n + [...text.matchAll(re)].length, 0);
    if (refs) sets.push({ n: r.n, on: !!r.on, refs });
  }
  const low = keys.filter(Boolean).map(x => String(x).toLowerCase());
  const berry = (rules.berry || []).filter(b => low.some(x => String(b.rule).toLowerCase().includes(x))).map(b => b.rule);
  return { sets, berry };
}

// A value as text: a Tuya sensor's reading divided, with its unit; booleans as on/off (`labels`
// { on, off }); anything else as it was sent.
export function showValue(r, labels) {
  if (!r.has) return '';
  const v = r.value;
  if (typeof v === 'boolean') return v ? labels.on : labels.off;
  const s = r.uses.find(u => u.kind === 'sensor');
  if (s && typeof v === 'number') return +(v / s.div).toFixed(3) + (s.unit ? ' ' + s.unit : '');
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

// ---- Tuya catalogue (catalogue.js, tools/build_catalogue.py)

// The catalogue entries closest to a device, best first (at most `max`): [{ stem, name, score,
// common, size, key }]. Measured on Guillaume's gateway (22 November 2026): a generic product id is
// shared by unrelated products, so the score is the overlap of the DP numbers (Jaccard: common / all
// DPs of both), plus a bonus when the entry lists the device's product id; an entry that only shares
// the product id but not the DPs loses to one that has the device's DPs.
export const KEY_BONUS = 0.15;
export function matchProducts(index, dps, productKey, max = 3) {
  const mine = new Set([...dps].map(Number));
  if (!index || !Array.isArray(index.files) || (!mine.size && !productKey)) return [];
  const out = [];
  for (const [stem, name, list, keys] of index.files) {
    const key = !!productKey && keys.includes(productKey);
    let common = 0;
    for (const d of list) if (mine.has(d)) common++;
    if (!common && !key) continue;
    const jac = common / (mine.size + list.length - common);
    out.push({ stem, name, score: jac + (key ? KEY_BONUS : 0), common, size: list.length, key });
  }
  return out.sort((a, b) => b.score - a.score || a.stem.localeCompare(b.stem)).slice(0, max);
}

// how sure a match is, as a text key: probable (score 0.75 or more), possible (0.5, or the product id
// alone when no DP of the device is known), uncertain
export const confidence = m => (m.score >= 0.75 ? 'ts_probable' : m.score >= 0.5 || (m.key && !m.common) ? 'ts_possible' : 'ts_uncertain');

// what the catalogue says of a DP, in one line: "switch · boolean", "brightness · integer 10-1000",
// "work_mode · string: white, colour, scene"
export function catalogueText(info) {
  if (!info) return '';
  const parts = [(info.names || []).join(', '), info.type].filter(Boolean);
  let s = parts.join(' · ');
  if (info.min != null || info.max != null) s += ' ' + (info.min != null ? info.min : '') + '-' + (info.max != null ? info.max : '');
  if (info.unit) s += ' ' + info.unit;
  if (info.scale != null && info.scale !== 1) s += ' ÷' + info.scale;
  if (Array.isArray(info.values) && info.values.length) s += ': ' + info.values.slice(0, 8).join(', ') + (info.values.length > 8 ? '…' : '');
  return s;
}
