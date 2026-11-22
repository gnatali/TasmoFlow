// SPDX-License-Identifier: GPL-3.0-only
// Details sheet of a local Tuya device, model (no interface): what the gateway knows of it, each
// value with where it comes from. The dialog is in tuya_sheet.js.
//
// Sources (firmware berry/tuya_local.be; feasibility note docs/investigations/tuya-device-details-2026-11.md):
// - `TuyaConfig <device>`: the tuya.json entry (name, id, ip, version, codes, matter, sensors, keep,
//   cid/children), key masked as "***" and never shown here;
// - `TuyaStatus`: connected, IP, version, and the DPs the driver keeps (booleans, the DPs a Matter
//   binding or a sensor uses, `keep`);
// - the `Tuya` events: every DP that changes, used or not, while the interface is open.

// a Matter binding's keys that name a DP: `dp`, then `dp_bri`, `dp_ct`, `dp_mode`, `dp_colour`,
// `dp_power`, `dp_voltage`, `dp_current`... (TuyaBinding.dps_used)
const DP_KEY = /^dp(_\w+)?$/;

// The DPs of a device, sorted by number: [{ dp, code, value, has, src, at, uses }]. `src`: 'event'
// (seen in an event at `at`, ms), 'gateway' (from TuyaStatus), '' (no value known). `uses`:
// [{ kind: 'matter', ep, role, type, enabled } | { kind: 'sensor', label, div, unit }].
export function sheetRows(entry, node) {
  const rows = {};
  const row = dp => {
    const k = String(dp);
    if (!/^\d+$/.test(k)) return null;
    return rows[k] || (rows[k] = { dp: +k, code: '', value: undefined, has: false, src: '', at: 0, uses: [] });
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
  const dps = (node && node.dps) || {};
  const seen = (node && node.seen) || {};
  for (const k in dps) {
    const r = row(k);
    if (!r) continue;
    r.value = dps[k];
    r.has = true;
    r.src = seen[k] ? 'event' : 'gateway';
    r.at = seen[k] || 0;
  }
  return Object.values(rows).sort((a, b) => a.dp - b.dp);
}

// A value as text: a sensor's reading divided, with its unit; booleans as on/off (`labels`
// { on, off }); anything else as Tuya sent it.
export function showValue(r, labels) {
  if (!r.has) return '';
  const v = r.value;
  if (typeof v === 'boolean') return v ? labels.on : labels.off;
  const s = r.uses.find(u => u.kind === 'sensor');
  if (s && typeof v === 'number') return +(v / s.div).toFixed(3) + (s.unit ? ' ' + s.unit : '');
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

// The Tuya gateway a sub-device belongs to (its name), or '': `conf` is the interface's index
// { name: entry } (tuya_model.js, indexConfig), where a gateway's entry lists its `children`.
export function parentOf(name, conf) {
  for (const k in conf || {}) {
    if ((conf[k].children || []).some(c => c.name === name)) return k;
  }
  return '';
}

// The identity lines, in order: [[key, value]], empty values left out. Never the key.
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
