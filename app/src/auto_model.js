// SPDX-License-Identifier: GPL-3.0-only
// The automations screen, model (no interface): what can start an automation or be tested in its
// condition, as pickers, and each piece in plain language. Format and generator: auto_gen.js.
//
// A picker item's value is a key: 'zb|<addr>|<attr>', 'tuya|<device>|<dp>', 'tconn|<device>|1' (or
// 0 for disconnected), 'rule|<Tasmota trigger>'. Zigbee and Tuya are offered the same way: every
// attribute or DP the device has (its state, what was seen, the rules, the import's codes, the
// catalogue), read-only ones included (a trigger reads them).
import { sorted, shown, zbTriggerAttrs, seenAttrs } from './rules_devices.js';
import { sheetRows } from './sheet_model.js';

const SEP = '|';

// the trigger (or state) a key stands for, with its comparison
export function fromKey(key, op, value, devices) {
  const [k, a, b] = String(key || '').split(SEP);
  const cmp = { op: op || '', value: op ? (value == null ? '' : String(value)) : '' };
  if (k === 'zb') {
    const d = (devices || {})[a];
    return { src: 'zigbee', addr: a, name: d && d.name ? d.name : '', attr: b, ...cmp };
  }
  if (k === 'tuya') return { src: 'tuya', dev: a, dp: b, ...cmp };
  if (k === 'tconn') return { src: 'tuyaconn', dev: a, on: b === '1' };
  if (k === 'rule') return { src: 'rule', pat: String(key).slice(5) + (op ? op + (value == null ? '' : value) : '') };
  return null;
}

// a Tasmota trigger's text split: `Power1#State=1` -> { subject: 'Power1#State', op: '=', value: '1' }
export function splitRule(pat) {
  const m = /^(.*?[^\s=<>!])\s*(!=|>=|<=|==|=|>|<)\s*(.*)$/.exec(String(pat || '').trim());
  return m ? { subject: m[1], op: m[2], value: m[3] } : { subject: String(pat || '').trim(), op: '', value: '' };
}

// a trigger or a state's comparison, wherever it is kept: { op, value }
export const cmpOf = t => (t && t.src === 'rule' ? splitRule(t.pat) : { op: (t && t.op) || '', value: (t && t.value) || '' });

// the key of a trigger or a state (the comparison apart)
export function keyOf(t) {
  if (!t) return '';
  if (t.src === 'zigbee') return ['zb', t.addr, t.attr].join(SEP);
  if (t.src === 'tuya') return ['tuya', t.dev, t.dp].join(SEP);
  if (t.src === 'tuyaconn') return ['tconn', t.dev, t.on ? '1' : '0'].join(SEP);
  if (t.src === 'rule') { const k = splitRule(t.pat).subject; return k ? 'rule' + SEP + k : ''; }
  return '';
}

// a Tuya device's DPs, named by code and catalogue name: [{ dp, label }]
function tuyaDpItems(tuya, name, product) {
  const rows = sheetRows(((tuya && tuya.conf) || {})[name], tuya.nodes[name]);
  const pd = (product && product.dps) || {};
  for (const k in pd) if (!rows.some(r => r.key === k)) rows.push({ key: k, dp: +k, code: '' });
  return rows.sort((x, y) => x.dp - y.dp).map(r => {
    const n = pd[r.key] && pd[r.key].names && pd[r.key].names[0];
    return { dp: r.key, label: (r.code || 'DP ' + r.key) + (n && n !== r.code ? ' (' + n + ')' : '') };
  });
}

// The pickers: [{ group, items: [{ label, value: key }] }]. `withEvents`: the gateway's events and
// the Tuya connections too (a trigger); without, the device values only (a condition reads them now).
// `labels` = { gateway, connected, disconnected }; `events` the gateway's triggers (rules_editor.js).
export function autoGroups(s, labels, events, withEvents) {
  const groups = [];
  if (withEvents) groups.push({ group: labels.gateway, items: events.map(e => ({ label: e, value: 'rule' + SEP + e })) });
  const seen = seenAttrs(s.devices, s.events, s.rules);
  for (const d of sorted(s.devices)) {
    groups.push({ group: 'Zigbee · ' + shown(d), items: zbTriggerAttrs(d, seen).map(a => ({ label: a, value: ['zb', d.addr, a].join(SEP) })) });
  }
  const tuya = s.tuya;
  if (tuya && tuya.state === 'running') {
    for (const name of Object.keys(tuya.nodes).sort((a, b) => a.localeCompare(b))) {
      const items = tuyaDpItems(tuya, name, s.products && s.products[name]).map(x => ({ label: x.label, value: ['tuya', name, x.dp].join(SEP) }));
      if (withEvents) items.push({ label: labels.connected, value: ['tconn', name, '1'].join(SEP) }, { label: labels.disconnected, value: ['tconn', name, '0'].join(SEP) });
      if (items.length) groups.push({ group: 'Tuya · ' + name, items });
    }
  }
  return groups;
}

// A trigger or a state in plain language: "Interrupteur Entrée · Power = 2", "Pergola 1 · switch_led",
// "Pince · connecté". `labels` = { connected, disconnected }
export function describe(t, s, labels) {
  if (!t) return '…';
  const cmp = t.op ? ' ' + t.op + ' ' + t.value : '';
  if (t.src === 'zigbee') {
    const d = ((s && s.devices) || {})[t.addr];
    return (d ? shown(d) : t.name || t.addr) + ' · ' + t.attr + cmp;
  }
  if (t.src === 'tuya') {
    const entry = ((s && s.tuya && s.tuya.conf) || {})[t.dev];
    const codes = (entry && entry.codes) || {};
    const code = Object.keys(codes).find(c => String(codes[c]) === String(t.dp));
    return t.dev + ' · ' + (code || 'DP ' + t.dp) + cmp;
  }
  if (t.src === 'tuyaconn') return t.dev + ' · ' + (t.on ? labels.connected : labels.disconnected);
  return t.pat || '…';
}

// a delay in words: 90 -> "1 min 30 s"
export function duration(sec) {
  const n = Math.max(0, Math.round(+sec || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const r = n % 60;
  return [h ? h + ' h' : '', m ? m + ' min' : '', r || (!h && !m) ? r + ' s' : ''].filter(Boolean).join(' ');
}

// a new automation, empty
export const blankAuto = id => ({ id, name: '', on: true, when: [{ src: 'rule', pat: '' }], cond: null, then: [{ cmd: '' }] });
