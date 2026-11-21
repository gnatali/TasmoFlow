// SPDX-License-Identifier: GPL-3.0-only
// Renaming a device, model (no interface): what a rule set says of the old name, and which new
// names are refused. The dialog is in rename.js.
import { isAddr } from './rules_devices.js';

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The rule set `text` with the references to a renamed device rewritten: { text, n } (n: how many).
// Zigbee: ref = { trigFrom, trigTo } for the ZbReceived#<key># triggers (the key is the name with
// SetOption83 on, else the address: nothing to change then), { from, to } for ZbSend's "device".
// Tuya: { from, to } for TuyaSend <name>, and TuyaConnected#Name / TuyaDisconnected#Name.
export function renameRefs(text, kind, ref) {
  let n = 0;
  const sub = (re, f) => { text = text.replace(re, (...m) => { n++; return f(...m); }); };
  const { from, to, trigFrom, trigTo } = ref;
  if (kind === 'zigbee') {
    if (trigFrom && trigTo && trigFrom !== trigTo) {
      sub(new RegExp('(ZbReceived#)' + esc(trigFrom) + '(?=#|\\s*[=<>!|]|\\s+do\\b|$)', 'gi'), (m, a) => a + trigTo);
    }
    if (from && to) sub(new RegExp('("device"\\s*:\\s*")' + esc(from) + '"', 'gi'), (m, a) => a + to + '"');
  } else if (from && to) {
    sub(new RegExp('(TuyaSend\\s+)' + esc(from) + '(\\s*,)', 'gi'), (m, a, b) => a + to + b);
    sub(new RegExp('(Tuya(?:Dis)?Connected#Name\\s*=\\s*)' + esc(from) + '(?=\\s+do\\b)', 'gi'), (m, a) => a + to);
  }
  return { text, n };
}

// Why a new name is refused (a text key), or null. A comma would cut ZbName and TuyaSend (both
// split their argument at commas), a double quote ZbSend's JSON, a semicolon a Backlog.
export function nameError(kind, to, old, addr, s) {
  if (to === old) return 'rn_same';
  if (/[,;"]/.test(to)) return 'rn_chars';
  const used = names => names.some(n => n && n.toLowerCase() === to.toLowerCase());
  if (kind === 'zigbee') {
    if (to.length > 32) return 'rn_long';                // ZbName cuts at 32 characters
    if (isAddr(to)) return 'rn_addr';
    if (to && used(Object.values(s.devices || {}).filter(d => d.addr !== addr).map(d => String(d.name || '')))) return 'rn_used';
  } else {
    if (!to) return 'rn_empty';
    if (used(Object.keys((s.tuya || {}).nodes || {}).filter(n => n !== old))) return 'rn_used';
  }
  return null;
}
