// SPDX-License-Identifier: GPL-3.0-only
// Rules that get in each other's way: two blocks that fire on the same trigger and act on the same
// device. Two toggles cancel out, an "on" and an "off" contradict, the same order twice is
// redundant. Only enabled rule sets count, only blocks the sentence model understands, and only
// commands that name what they act on (Power<n>, ZbSend Power, TuyaSend with true/false/toggle).
import { parseRuleSet } from './rules_model.js';

const VERB = { on: 'on', 1: 'on', true: 'on', off: 'off', 0: 'off', false: 'off', toggle: 'toggle', 2: 'toggle' };

// { target, verb } of a command that switches something, or null
export function commandInfo(cmd) {
  let m = /^power(\d*)\s+(on|off|toggle|1|0|2|true|false)$/i.exec(cmd.trim());
  if (m) return { target: 'Power' + (m[1] || '1'), verb: VERB[m[2].toLowerCase()] };
  m = /^ZbSend\s*\{"device":"([^"]+)","send":\{"Power":"(On|Off|Toggle)"\}\}$/.exec(cmd.trim());
  if (m) return { target: 'zb:' + m[1].toLowerCase(), verb: VERB[m[2].toLowerCase()] };
  m = /^TuyaSend\s+([^,]+),(\d+),(true|false|toggle)$/i.exec(cmd.trim());
  if (m) return { target: 'tuya:' + m[1].toLowerCase() + '#' + m[2], verb: VERB[m[3].toLowerCase()] };
  return null;
}

// sets: [{ n, on, text }] -> [{ subject, op, value, target, cmd, kind, where: [{ n, i }] }]
// kind: 'cancel' (all toggles), 'contradict' (different orders), 'duplicate' (same order)
export function findConflicts(sets) {
  const groups = new Map();
  for (const s of sets) {
    if (!s.on) continue;
    (parseRuleSet(s.text) || []).forEach((b, i) => {
      if (b.kind !== 'sentence') return;
      const trig = (b.subject + b.op + b.value).replace(/\s+/g, '').toLowerCase();
      for (const cmd of [...b.then, ...(b.else || [])]) {
        const info = commandInfo(cmd);
        if (!info) continue;
        const key = trig + '|' + info.target;
        if (!groups.has(key)) groups.set(key, { subject: b.subject, op: b.op, value: b.value, target: info.target, cmd, entries: [] });
        groups.get(key).entries.push({ n: s.n, i, verb: info.verb });
      }
    });
  }
  const out = [];
  for (const g of groups.values()) {
    const blocks = new Set(g.entries.map(e => e.n + ':' + e.i));
    if (blocks.size < 2) continue;
    const verbs = new Set(g.entries.map(e => e.verb));
    const kind = verbs.size > 1 ? 'contradict' : verbs.has('toggle') ? 'cancel' : 'duplicate';
    const where = [];
    for (const e of g.entries) if (!where.some(w => w.n === e.n && w.i === e.i)) where.push({ n: e.n, i: e.i });
    out.push({ subject: g.subject, op: g.op, value: g.value, target: g.target, cmd: g.cmd, kind, where });
  }
  return out;
}
